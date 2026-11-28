// Persönliche Passung: In welcher persönlichen Zone liegt eine Stunde, und wie gut passt sie zum Tagesmodus?
//
// Zonen: grün = Komfort, gelb = Progress, orange = Challenge, rot = Überforderung.
// Tagesmodi (seit 28.11.2026):
// - Chill: ruhige, einfache Luft (Lufttyp „ruhig“ oder ruhiges Soaring) und alles in deiner Komfort-Zone.
// - Flow: deine ganze Komfort-Zone. Bedingungen, die du kennst und die dich nicht überfordern.
// - Push: bewusst fordernd, bis in die Progress-Zone; erlaubt es dein Character, bis in die Challenge-Zone.
// Rot zählt nie. Strecke (XC) ist eine eigene Option zu jedem Modus: Sie verlangt Thermik und Arbeitshöhe und Fenster
// von mindestens drei Stunden. Passt der Start nicht zu deinen Startbedingungen, zählt die Stunde ebenfalls nie.

import type {
  DimensionKey,
  DimensionScore,
  EnvelopeLimits,
  FitResult,
  Goal,
  GoalRequirements,
  HourMetrics,
  LaunchPrefs,
  NoGoReason,
  PersonalZone,
  PilotProfile,
  Zone,
} from './types.ts';
import { characterOf, envelopeFromTolerance, type PrefKey } from './character.ts';
import { offFacingDeg } from './evaluate.ts';

const DIM_NAMES: Record<DimensionKey, string> = {
  wind_comfort: 'Wind',
  thermic_character: 'Thermik',
  shear_turbulence: 'Turbulenz / Scherung',
  structure_cap: 'Mögliche Überhöhung / Deckel',
};

const GOAL_NAMES: Record<Goal, string> = { chill: 'Chill', flow: 'Flow', push: 'Push' };
export const GOALS: Goal[] = ['chill', 'flow', 'push'];

/** Vorsichtiger Standard, solange der Pilot nichts anderes angibt */
export const DEFAULT_LAUNCH: LaunchPrefs = { crosswind: 'no', tailwind: 'no' };

/** Grenzen der Startbedingungen (Marvins Antwort vom 28.11.2026; Startwerte, siehe docs/aenderungskonzept.md) */
export const LAUNCH_LIMITS = {
  /** unter diesem Grundwind spielt die Richtung keine Rolle */
  calmKmh: 3,
  /** Rückenwind-Anteil ab dem es ein Rückenwind-Start ist */
  tailKmh: 2,
  /** leichter Rückenwind nur, solange die Böen darunter bleiben */
  tailMaxGustKmh: 10,
  /** bis zu diesem Winkel zur Startrichtung gilt Wind als Gegenwind ohne eigene Seitenwind-Grenze */
  headOnDeg: 15,
  /** Böen-Grenzen (km/h) je Winkel zur Startrichtung und Seitenwind-Toleranz; 0 = nicht erlaubt */
  crossBands: [
    { maxDeg: 30, gust: { no: 15, light: 20, yes: 20 } },
    { maxDeg: 60, gust: { no: 0, light: 10, yes: 15 } },
  ] as { maxDeg: number; gust: Record<'no' | 'light' | 'yes', number> }[],
  /** ab diesem Gegenwind hilft Rückwärtsaufziehen, ab dem zweiten Wert ohne es kein Vorwärtsstart */
  reverseHintKmh: 10,
  reverseRequiredKmh: 25,
};

/**
 * Passt der Start in dieser Stunde zu den Startbedingungen des Piloten?
 * Gibt Gründe zurück, warum nicht (dann kein Flugfenster), und Hinweise, die nur informieren.
 * Seitenwind nach Winkel zur Startrichtung: bis 30° Böen bis 15/20/20 km/h (nein/leicht/ja), 30–60° bis 0/10/15 km/h,
 * über 60° nur bei „ja“ und dann als „kritisch prüfen“. Rückenwind „leicht“ nur im Modus Push und mit Böen unter 10 km/h.
 * Die festen Regeln des Startplatzes (Windfenster ab 8 km/h, Rückenwind ab 5 km/h, Maximalwind) prüft checkRules vorher.
 */
export function launchCheck(m: HourMetrics, prefs: LaunchPrefs, mode: Goal): { issues: string[]; hints: string[] } {
  const L = LAUNCH_LIMITS;
  const issues: string[] = [];
  const hints: string[] = [];
  const speed = m.takeoffWindKmh;
  if (speed < L.calmKmh) return { issues, hints };
  const tail = -m.headwindKmh;
  const kmh = (x: number) => `${Math.round(x)} km/h`;
  const angle = offFacingDeg(m);
  if (tail >= L.tailKmh) {
    if (prefs.tailwind !== 'light') issues.push(`Rückenwind am Start (${kmh(tail)}): passt nicht zu deinen Startbedingungen`);
    else if (mode !== 'push') issues.push(`Rückenwind am Start (${kmh(tail)}): Rückenwind-Starts zeigt die App nur im Modus Push`);
    else if (m.gustKmh >= L.tailMaxGustKmh) issues.push(`Rückenwind am Start mit Böen bis ${kmh(m.gustKmh)}: leichter Rückenwind geht nur bei Böen unter ${L.tailMaxGustKmh} km/h`);
    else hints.push(`leichter Rückenwind am Start (${kmh(tail)}): nur mit sauberem, schnellem Start`);
  } else if (angle > L.headOnDeg) {
    const band = L.crossBands.find((b) => angle <= b.maxDeg);
    if (!band) {
      if (prefs.crosswind !== 'yes') issues.push(`Wind ${angle}° seitlich zur Startrichtung: passt nicht zu deinen Startbedingungen`);
      else hints.push(`Wind ${angle}° seitlich zur Startrichtung: kritisch prüfen, kann schon Lee oder Rückenwind sein`);
    } else {
      const limit = band.gust[prefs.crosswind];
      if (limit === 0) issues.push(`Seitenwind ${angle}° zur Startrichtung: passt nicht zu deinen Startbedingungen`);
      else if (m.gustKmh > limit) issues.push(`Seitenwind ${angle}° zur Startrichtung mit Böen bis ${kmh(m.gustKmh)}: für dich hier höchstens ${limit} km/h`);
      else if (angle > 30) hints.push(`Seitenwind ${angle}° zur Startrichtung`);
    }
  }
  if (prefs.maxGustKmh !== undefined && m.gustKmh > prefs.maxGustKmh) {
    issues.push(`Böen bis ${kmh(m.gustKmh)}: über deiner Grenze für diesen Startplatz (${prefs.maxGustKmh} km/h)`);
  }
  if (m.headwindKmh >= L.reverseRequiredKmh && prefs.reverseLaunch === false) {
    issues.push(`Gegenwind ${kmh(m.headwindKmh)}: ohne Rückwärtsaufziehen empfiehlt die App keinen Vorwärtsstart über ${L.reverseRequiredKmh} km/h`);
  } else if (m.headwindKmh >= L.reverseHintKmh && prefs.reverseLaunch !== true) {
    hints.push(`ab ${L.reverseHintKmh} km/h Gegenwind ist Rückwärtsaufziehen die sicherere Startmethode`);
  }
  return { issues, hints };
}

/** Darf der Pilot Seitenwind überhaupt einstellen? Nur mit Character, der dafür erfahren genug ist. */
export function crosswindAllowed(profile: PilotProfile): boolean {
  return profile.character ? characterOf(profile.character).crosswindUnlocked : false;
}

/**
 * Startbedingungen für eine Stunde: die allgemeinen aus dem Profil, für einen Startplatz überschrieben durch eigene
 * Werte (Seitenwind und Böen-Grenze). Mehr Seitenwind als „nein“ geht auch pro Startplatz nur mit passendem Character.
 */
export function launchPrefsOf(profile: PilotProfile, spotId?: string): LaunchPrefs {
  const base = profile.launch ?? DEFAULT_LAUNCH;
  const own = spotId ? profile.spot_launch?.[spotId] : undefined;
  if (!own) return base;
  const crosswind = own.crosswind && (own.crosswind === 'no' || crosswindAllowed(profile)) ? own.crosswind : base.crosswind;
  return { ...base, crosswind, ...(own.maxGustKmh !== undefined ? { maxGustKmh: own.maxGustKmh } : {}) };
}

export const PZONE_NAMES: Record<PersonalZone, string> = {
  green: 'Komfort',
  yellow: 'Progress',
  orange: 'Challenge',
  red: 'Überforderung',
  'no-go': 'No-Go',
};

const PZONE_RANK: Record<PersonalZone, number> = { green: 0, yellow: 1, orange: 2, red: 3, 'no-go': 4 };

/** Reicht Push bis in die Challenge-Zone? Nur mit Character, der es hergibt; ohne Character bis Progress. */
export function pushReachesChallenge(profile: PilotProfile): boolean {
  return profile.character ? characterOf(profile.character).pushAdvised : false;
}

/** bis zu welcher persönlichen Zone ein Tagesmodus reicht */
export function modeZone(profile: PilotProfile, mode: Goal = profile.comfort_profile.pilot_profile): PersonalZone {
  if (mode === 'push') return pushReachesChallenge(profile) ? 'orange' : 'yellow';
  return 'green';
}

function modeLimitKey(profile: PilotProfile, mode: Goal): keyof EnvelopeLimits {
  if (mode === 'push') return pushReachesChallenge(profile) ? 'challenge' : 'progress';
  return 'comfort';
}

/** Strecken-Option an? */
export function xcOn(profile: PilotProfile): boolean {
  return profile.comfort_profile.xc === true;
}

/** Vorliebe 0–5, oder undefined, wenn nicht beantwortet */
export function prefOf(profile: PilotProfile, key: PrefKey): number | undefined {
  return profile.character?.prefs?.[key];
}

/** Ist die Luft ruhig genug für Chill? Lufttyp „ruhig“ oder ruhiges Soaring. */
export function chillAir(zone: Zone, metrics?: HourMetrics): boolean {
  return zone === 'calm' || metrics?.soaringMode === 'chill';
}

export function zoneRank(z: PersonalZone): number {
  return PZONE_RANK[z];
}

export function envelopeOf(profile: PilotProfile): Record<DimensionKey, EnvelopeLimits> {
  return profile.comfort_profile.envelope ?? envelopeFromTolerance(profile.comfort_profile.tolerance);
}

/** Grenze einer Dimension im gewählten Tagesmodus */
export function modeLimit(profile: PilotProfile, key: DimensionKey, mode: Goal = profile.comfort_profile.pilot_profile): number {
  return envelopeOf(profile)[key][modeLimitKey(profile, mode)];
}

/** Zone einer einzelnen Dimension */
export function dimensionZone(score: number, limits: EnvelopeLimits): PersonalZone {
  if (score > limits.challenge) return 'red';
  if (score > limits.progress) return 'orange';
  if (score > limits.comfort) return 'yellow';
  return 'green';
}

/** Persönliche Zone einer Stunde: die anspruchsvollste Dimension entscheidet. */
export function personalZone(
  dims: Record<DimensionKey, DimensionScore>,
  zone: Zone,
  noGo: NoGoReason[],
  envelope: Record<DimensionKey, EnvelopeLimits>,
): PersonalZone {
  if (noGo.length > 0 || zone === 'no-go') return 'no-go';
  let worst: PersonalZone = 'green';
  for (const key of Object.keys(dims) as DimensionKey[]) {
    const limits = envelope[key];
    if (!limits) continue;
    const z = dimensionZone(dims[key].score, limits);
    if (PZONE_RANK[z] > PZONE_RANK[worst]) worst = z;
  }
  return worst;
}

const GOAL_RANK: Record<Goal, number> = { chill: 0, flow: 1, push: 2 };

function meets(dims: Record<DimensionKey, DimensionScore>, r: GoalRequirements | undefined, skipThermic = false): boolean {
  if (!r) return true;
  if (!skipThermic && r.thermic_character_min !== undefined && dims.thermic_character.score < r.thermic_character_min) return false;
  if (r.wind_comfort_max !== undefined && dims.wind_comfort.score > r.wind_comfort_max) return false;
  if (r.shear_turbulence_max !== undefined && dims.shear_turbulence.score > r.shear_turbulence_max) return false;
  if (r.structure_cap_min !== undefined && dims.structure_cap.score < r.structure_cap_min) return false;
  return true;
}

/**
 * Welche Modi die Stunde erfüllt (nur das Wetter, ohne Zonen). Soaring-Stunden erfüllen ihren Soaring-Modus und alle
 * anspruchsvolleren, auch ohne Thermik; ob der Wind passt, entscheiden die Zonen. Chill braucht zusätzlich ruhige Luft.
 * Wer Abgleiter mag (Vorliebe ab 4), braucht für Chill und Flow keine Thermik.
 */
export function goalsMet(dims: Record<DimensionKey, DimensionScore>, profile: PilotProfile, metrics?: HourMetrics, zone?: Zone): Goal[] {
  const req = profile.comfort_profile.min_required_scores_for_goal;
  const glides = (prefOf(profile, 'glides') ?? 0) >= 4;
  const out: Goal[] = [];
  const soar = metrics?.soaringMode ?? null;
  for (const goal of GOALS) {
    if (goal === 'chill' && zone !== undefined && !chillAir(zone, metrics)) continue;
    if (soar && GOAL_RANK[goal] >= GOAL_RANK[soar]) {
      out.push(goal);
      continue;
    }
    if (meets(dims, req[goal], glides && goal !== 'push')) out.push(goal);
  }
  return out;
}

/** Reicht die Stunde für Strecke? Thermik und Arbeitshöhe nach den XC-Anforderungen; Soaring zählt nicht. */
export function xcMet(dims: Record<DimensionKey, DimensionScore>, profile: PilotProfile): boolean {
  return meets(dims, profile.comfort_profile.min_required_scores_for_goal.xc ?? { thermic_character_min: 2.5, structure_cap_min: 2.5 });
}

/**
 * Passung 0 bis 100 für den Tagesmodus im Profil:
 * 100 minus Abzüge, wenn eine Dimension über der Grenze des Modus liegt (je wichtiger, desto mehr), minus 25, wenn die
 * Stunde für den Modus nicht reicht (mit Strecken-Option: höchstens 55, wenn es für Strecke nicht reicht), und Zu- oder Abschläge aus den Vorlieben. Liegt die Stunde
 * über dem Modus (oder ist sie für Chill zu lebhaft), bleibt die Passung unter 50 und zählt nicht als Flugfenster;
 * rot bleibt unter 20.
 */
export function personalFit(
  dims: Record<DimensionKey, DimensionScore>,
  zone: Zone,
  noGo: NoGoReason[],
  profile: PilotProfile,
  metrics?: HourMetrics,
  spotId?: string,
): FitResult {
  const mode = profile.comfort_profile.pilot_profile;
  const xc = xcOn(profile);
  const envelope = envelopeOf(profile);
  let pz = personalZone(dims, zone, noGo, envelope);
  if (pz === 'no-go') {
    return { score: 0, label: 'No-Go', personalZone: pz, mode, xc, exceed: {}, goalsMet: [], notes: [], launchIssues: [] };
  }
  const launch = metrics ? launchCheck(metrics, launchPrefsOf(profile, spotId), mode) : { issues: [], hints: [] };
  const met = goalsMet(dims, profile, metrics, zone);
  const tol = profile.comfort_profile.tolerance;
  const limitKey = modeLimitKey(profile, mode);
  const exceed: FitResult['exceed'] = {};
  const notes: string[] = [];
  let penalty = 0;
  let overMode = false;
  for (const key of Object.keys(dims) as DimensionKey[]) {
    const limits = envelope[key];
    if (!limits) continue;
    const over = dims[key].score - limits[limitKey];
    if (over > 0) {
      overMode = true;
      exceed[key] = Math.round(over * 10) / 10;
      penalty += over * (tol[key]?.importance_weight ?? 1);
      const z = dimensionZone(dims[key].score, limits);
      notes.push(`${DIM_NAMES[key]} „${dims[key].label}“ liegt über deiner Grenze für ${GOAL_NAMES[mode]} (bei dir ${PZONE_NAMES[z]})`);
    }
  }
  let score = 100 - 35 * penalty;
  const tooLively = mode === 'chill' && !chillAir(zone, metrics);
  if (tooLively) {
    overMode = true;
    notes.push('für Chill ist die Luft zu lebhaft, in Flow passt die Stunde vielleicht');
  } else if (!met.includes(mode)) {
    score -= 25;
    notes.push(`für ${GOAL_NAMES[mode]} reicht es nicht`);
  }
  // Strecken-Option an: nur Streckenstunden zählen als Flugfenster (ausschalten zeigt die übrigen wieder)
  const noXc = xc && !xcMet(dims, profile);
  if (noXc) notes.push('für Strecke reicht es nicht (zu wenig Thermik oder Arbeitshöhe)');
  if (metrics) score += prefAdjust(dims, profile, metrics, mode, xc, notes);
  notes.push(...launch.hints);
  // Startbedingungen, die nicht passen: wie Überforderung, die Stunde zählt nie als Flugfenster
  if (launch.issues.length > 0) {
    pz = 'red';
    notes.unshift(...launch.issues);
  }
  if (pz === 'red') score = Math.min(score, 15);
  else if (overMode || PZONE_RANK[pz] > PZONE_RANK[modeZone(profile, mode)]) score = Math.min(score, 45);
  else if (noXc) score = Math.min(score, 55);
  score = Math.max(0, Math.min(100, Math.round(score)));
  const label =
    launch.issues.length > 0
      ? 'Start passt nicht zu dir'
      : pz === 'red'
        ? 'zu viel für dich'
        : tooLively
          ? 'zu lebhaft für Chill'
          : overMode
            ? `über deinem Modus ${GOAL_NAMES[mode]}`
            : noXc
              ? 'reicht nicht für Strecke'
              : score >= 80
              ? 'passt'
              : score >= 60
                ? 'passt eingeschränkt'
                : 'reicht nicht';
  return { score, label, personalZone: pz, mode, xc, exceed, goalsMet: met, notes, launchIssues: launch.issues };
}

/**
 * Vorlieben aus dem Character: Sie verschieben nie Grenzen, nur wie gut dir eine Stunde gefällt.
 * Gibt den Zu- oder Abschlag zurück und schreibt die Begründung in `notes`.
 */
function prefAdjust(dims: Record<DimensionKey, DimensionScore>, profile: PilotProfile, m: HourMetrics, mode: Goal, xc: boolean, notes: string[]): number {
  let delta = 0;
  const T = dims.thermic_character.score;
  const blue = m.cloudBaseMsl === null && m.workingHeight >= 500 && T >= 2;
  if (blue && (xc || mode === 'push')) {
    const b = prefOf(profile, 'blue_ok');
    if (b !== undefined && b >= 4) notes.push('Blauthermik: keine Quellwolken als Wegweiser, aber das magst du');
    else if (b !== undefined && b <= 2 && xc) {
      delta -= 25;
      notes.push('Blauthermik: ohne Quellwolken als Wegweiser für dich keine Streckenstunde');
    } else notes.push('Blauthermik: keine Quellwolken als Wegweiser, Bärte sind schwerer zu finden');
  }
  if ((prefOf(profile, 'long_thermals') ?? 0) >= 4 && T < 1 && m.soaringMode == null) {
    delta -= 10;
    notes.push('kaum Thermik: eher ein Abgleiter, du willst lange oben bleiben');
  }
  const cr = prefOf(profile, 'cloud_reading');
  if (cr !== undefined && cr <= 2 && m.cape >= 300 && m.cloudBaseMsl !== null) {
    delta -= 15;
    notes.push('Quellwolken können wachsen (CAPE über 300): Wolken lesen ist laut deinen Vorlieben noch nicht deins');
  }
  if (xc && (prefOf(profile, 'avoid_shading') ?? 0) >= 4 && m.cloudHigh >= 70) {
    delta -= 10;
    notes.push('hohe Wolken schatten ab, das stört dich bei Strecke');
  }
  return delta;
}

/**
 * Turbulenz-Gefühl als Emoji, nach deiner persönlichen Zone der Dimension Turbulenz / Scherung:
 * Komfort ruhig 😌, Komfort leicht bewegt 🙂, Komfort und lebhaft 😄, Progress 😐, Challenge 🤔, Überforderung ❌.
 */
export function turbulenceEmoji(score: number, limits: EnvelopeLimits): string {
  const z = dimensionZone(score, limits);
  if (z === 'red') return '❌';
  if (z === 'orange') return '🤔';
  if (z === 'yellow') return '😐';
  if (score <= 1) return '😌';
  if (score <= 2) return '🙂';
  return '😄';
}

export const TURBULENCE_EMOJI_TEXT = 'Turbulenz-Gefühl nach deiner Zone: 😌 ruhig, 🙂 leicht bewegt, 😄 lebhaft und trotzdem in deiner Komfort-Zone, 😐 Progress, 🤔 Challenge, ❌ Überforderung.';

export { GOAL_NAMES, DIM_NAMES };
