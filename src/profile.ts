// Persönliche Passung: In welcher persönlichen Zone liegt eine Stunde, und wie gut passt sie zum Tagesmodus?
//
// Zonen nach Marvins Konzept: grün = Komfort, gelb = Progress, orange = Challenge, rot = Überforderung.
// Der Tagesmodus legt fest, bis zu welcher Zone eine Stunde als Flugfenster zählt: Chill bis grün, Flow bis gelb,
// Push bis orange. Rot zählt nie. Dazu kommen die persönlichen Startbedingungen (Seiten- und Rückenwind,
// Rückwärtsaufziehen): passt der Start nicht zum Character, zählt die Stunde ebenfalls nie.

import type {
  DimensionKey,
  DimensionScore,
  EnvelopeLimits,
  FitResult,
  Goal,
  HourMetrics,
  LaunchPrefs,
  NoGoReason,
  PersonalZone,
  PilotProfile,
  Zone,
} from './types.ts';
import { envelopeFromTolerance } from './character.ts';

const DIM_NAMES: Record<DimensionKey, string> = {
  wind_comfort: 'Wind',
  thermic_character: 'Thermik',
  shear_turbulence: 'Turbulenz / Scherung',
  structure_cap: 'Mögliche Überhöhung / Deckel',
};

/** Anzeigenamen der Tagesmodi (Schlüssel bleiben chill/progress/xc) */
const GOAL_NAMES: Record<Goal, string> = { chill: 'Chill', progress: 'Flow', xc: 'Push' };

/** Vorsichtiger Standard, solange der Pilot nichts anderes angibt */
export const DEFAULT_LAUNCH: LaunchPrefs = { crosswind: 'no', tailwind: 'no' };

/** Grenzen der Startbedingungen in km/h (Startwerte, siehe README) */
export const LAUNCH_LIMITS = {
  /** unter diesem Wind spielt die Richtung keine Rolle */
  calmKmh: 3,
  /** Rückenwind-Anteil ab dem es ein Rückenwind-Start ist */
  tailKmh: 2,
  /** Seitenwind-Anteil innerhalb des Windfensters: ab hier zählt er bei „nein“ bzw. „leicht“ */
  crossNoKmh: 8,
  crossLightKmh: 12,
  /** Wind von außerhalb des Windfensters ist bei „leicht“ bis hierhin noch ok */
  outOfSectorLightKmh: 5,
  /** ab diesem Gegenwind hilft Rückwärtsaufziehen, ab dem zweiten Wert ohne es kein Vorwärtsstart */
  reverseHintKmh: 10,
  reverseRequiredKmh: 25,
};

/**
 * Passt der Start in dieser Stunde zu den Startbedingungen des Piloten?
 * Gibt Gründe zurück, warum nicht (dann kein Flugfenster), und Hinweise, die nur informieren.
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
  if (tail >= L.tailKmh) {
    if (prefs.tailwind !== 'light') issues.push(`Rückenwind am Start (${kmh(tail)}): passt nicht zu deinen Startbedingungen`);
    else if (mode !== 'xc') issues.push(`Rückenwind am Start (${kmh(tail)}): Rückenwind-Starts zeigt die App nur im Modus Push`);
    else hints.push(`leichter Rückenwind am Start (${kmh(tail)}): nur mit sauberem, schnellem Start`);
  } else if (!m.takeoffInSector) {
    const ok = prefs.crosswind === 'yes' || (prefs.crosswind === 'light' && speed < L.outOfSectorLightKmh);
    if (!ok) issues.push(`Seitenwind am Start (${kmh(speed)} von außerhalb des Windfensters): passt nicht zu deinen Startbedingungen`);
    else hints.push(`Seitenwind am Start (${kmh(speed)} von außerhalb des Windfensters)`);
  } else {
    const limit = prefs.crosswind === 'no' ? L.crossNoKmh : prefs.crosswind === 'light' ? L.crossLightKmh : Infinity;
    if (m.crosswindKmh >= limit) issues.push(`Seitenwind-Anteil am Start ${kmh(m.crosswindKmh)}: mehr, als zu deinen Startbedingungen passt`);
  }
  if (m.headwindKmh >= L.reverseRequiredKmh && prefs.reverseLaunch === false) {
    issues.push(`Gegenwind ${kmh(m.headwindKmh)}: ohne Rückwärtsaufziehen empfiehlt die App keinen Vorwärtsstart über ${L.reverseRequiredKmh} km/h`);
  } else if (m.headwindKmh >= L.reverseHintKmh && prefs.reverseLaunch !== true) {
    hints.push(`ab ${L.reverseHintKmh} km/h Gegenwind ist Rückwärtsaufziehen die sicherere Startmethode`);
  }
  return { issues, hints };
}

export function launchPrefsOf(profile: PilotProfile): LaunchPrefs {
  return profile.launch ?? DEFAULT_LAUNCH;
}

export const PZONE_NAMES: Record<PersonalZone, string> = {
  green: 'Komfort',
  yellow: 'Progress',
  orange: 'Challenge',
  red: 'Überforderung',
  'no-go': 'No-Go',
};

const PZONE_RANK: Record<PersonalZone, number> = { green: 0, yellow: 1, orange: 2, red: 3, 'no-go': 4 };

/** bis zu welcher Zone ein Tagesmodus reicht */
export const MODE_ZONE: Record<Goal, PersonalZone> = { chill: 'green', progress: 'yellow', xc: 'orange' };

const MODE_LIMIT: Record<Goal, keyof EnvelopeLimits> = { chill: 'comfort', progress: 'progress', xc: 'challenge' };

export function zoneRank(z: PersonalZone): number {
  return PZONE_RANK[z];
}

export function envelopeOf(profile: PilotProfile): Record<DimensionKey, EnvelopeLimits> {
  return profile.comfort_profile.envelope ?? envelopeFromTolerance(profile.comfort_profile.tolerance);
}

/** Grenze einer Dimension im gewählten Tagesmodus */
export function modeLimit(profile: PilotProfile, key: DimensionKey, mode: Goal = profile.comfort_profile.pilot_profile): number {
  return envelopeOf(profile)[key][MODE_LIMIT[mode]];
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

export function goalsMet(dims: Record<DimensionKey, DimensionScore>, profile: PilotProfile): Goal[] {
  const req = profile.comfort_profile.min_required_scores_for_goal;
  const out: Goal[] = [];
  for (const goal of ['chill', 'progress', 'xc'] as Goal[]) {
    const r = req[goal];
    if (!r) continue;
    if (r.thermic_character_min !== undefined && dims.thermic_character.score < r.thermic_character_min) continue;
    if (r.wind_comfort_max !== undefined && dims.wind_comfort.score > r.wind_comfort_max) continue;
    if (r.shear_turbulence_max !== undefined && dims.shear_turbulence.score > r.shear_turbulence_max) continue;
    if (r.structure_cap_min !== undefined && dims.structure_cap.score < r.structure_cap_min) continue;
    out.push(goal);
  }
  return out;
}

/**
 * Passung 0 bis 100 für den Tagesmodus im Profil:
 * 100 minus Abzüge, wenn eine Dimension über der Grenze des Modus liegt (je wichtiger, desto mehr), minus 25, wenn die
 * Stunde für den Modus nicht reicht (z. B. zu wenig Thermik für XC). Liegt die Stunde in einer Zone über dem Modus,
 * bleibt die Passung unter 50 und die Stunde zählt nicht als Flugfenster; rot bleibt unter 20.
 */
export function personalFit(
  dims: Record<DimensionKey, DimensionScore>,
  zone: Zone,
  noGo: NoGoReason[],
  profile: PilotProfile,
  metrics?: HourMetrics,
): FitResult {
  const mode = profile.comfort_profile.pilot_profile;
  const envelope = envelopeOf(profile);
  let pz = personalZone(dims, zone, noGo, envelope);
  if (pz === 'no-go') {
    return { score: 0, label: 'No-Go', personalZone: pz, mode, exceed: {}, goalsMet: [], notes: [], launchIssues: [] };
  }
  const launch = metrics ? launchCheck(metrics, launchPrefsOf(profile), mode) : { issues: [], hints: [] };
  const met = goalsMet(dims, profile);
  const tol = profile.comfort_profile.tolerance;
  const exceed: FitResult['exceed'] = {};
  const notes: string[] = [];
  let penalty = 0;
  for (const key of Object.keys(dims) as DimensionKey[]) {
    const limits = envelope[key];
    if (!limits) continue;
    const limit = limits[MODE_LIMIT[mode]];
    const over = dims[key].score - limit;
    if (over > 0) {
      exceed[key] = Math.round(over * 10) / 10;
      penalty += over * (tol[key]?.importance_weight ?? 1);
      const z = dimensionZone(dims[key].score, limits);
      notes.push(`${DIM_NAMES[key]} „${dims[key].label}“ liegt über deiner Grenze für ${GOAL_NAMES[mode]} (bei dir ${PZONE_NAMES[z]})`);
    }
  }
  let score = 100 - 35 * penalty;
  if (!met.includes(mode)) {
    score -= 25;
    notes.push(`für ${GOAL_NAMES[mode]} reicht es nicht`);
  }
  // Blauthermik ist nicht automatisch Push-tauglich: ohne Wolken fehlen die Wegweiser. Nur Hinweis, keine Abwertung.
  if (metrics && mode === 'xc' && metrics.cloudBaseMsl === null && metrics.workingHeight >= 500 && dims.thermic_character.score >= 2) {
    notes.push('Blauthermik: keine Quellwolken als Wegweiser, Bärte sind schwerer zu finden');
  }
  notes.push(...launch.hints);
  // Startbedingungen, die nicht passen: wie Überforderung, die Stunde zählt nie als Flugfenster
  if (launch.issues.length > 0) {
    pz = 'red';
    notes.unshift(...launch.issues);
  }
  if (PZONE_RANK[pz] > PZONE_RANK[MODE_ZONE[mode]]) score = Math.min(score, pz === 'red' ? 15 : 45);
  score = Math.max(0, Math.min(100, Math.round(score)));
  const label =
    launch.issues.length > 0
      ? 'Start passt nicht zu dir'
      : pz === 'red'
      ? 'zu viel für dich'
      : score >= 80
        ? 'passt'
        : score >= 60
          ? 'passt eingeschränkt'
          : PZONE_RANK[pz] > PZONE_RANK[MODE_ZONE[mode]]
            ? `über deinem Modus ${GOAL_NAMES[mode]}`
            : 'reicht nicht';
  return { score, label, personalZone: pz, mode, exceed, goalsMet: met, notes, launchIssues: launch.issues };
}

export { GOAL_NAMES, DIM_NAMES };
