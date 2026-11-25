// Persönliche Passung: In welcher persönlichen Zone liegt eine Stunde, und wie gut passt sie zum Tagesmodus?
//
// Zonen nach Marvins Konzept: grün = Komfort, gelb = Progress, orange = XC-Challenge, rot = Überforderung.
// Der Tagesmodus legt fest, bis zu welcher Zone eine Stunde als Flugfenster zählt: Chill bis grün, Progress bis gelb,
// XC bis orange. Rot zählt nie.

import type {
  DimensionKey,
  DimensionScore,
  EnvelopeLimits,
  FitResult,
  Goal,
  NoGoReason,
  PersonalZone,
  PilotProfile,
  Zone,
} from './types.ts';
import { envelopeFromTolerance } from './character.ts';

const DIM_NAMES: Record<DimensionKey, string> = {
  wind_comfort: 'Wind',
  thermic_character: 'Thermik',
  shear_turbulence: 'Scherung/Turbulenz',
  structure_cap: 'Struktur/Deckel',
};

const GOAL_NAMES: Record<Goal, string> = { chill: 'Chill', progress: 'Progress', xc: 'XC' };

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
): FitResult {
  const mode = profile.comfort_profile.pilot_profile;
  const envelope = envelopeOf(profile);
  const pz = personalZone(dims, zone, noGo, envelope);
  if (pz === 'no-go') {
    return { score: 0, label: 'No-Go', personalZone: pz, mode, exceed: {}, goalsMet: [], notes: [] };
  }
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
      notes.push(`${DIM_NAMES[key]} ${dims[key].display} liegt über deiner Grenze ${limit.toLocaleString('de-DE')} für ${GOAL_NAMES[mode]} (bei dir ${PZONE_NAMES[z]})`);
    }
  }
  let score = 100 - 35 * penalty;
  if (!met.includes(mode)) {
    score -= 25;
    notes.push(`für ${GOAL_NAMES[mode]} reicht es nicht`);
  }
  if (PZONE_RANK[pz] > PZONE_RANK[MODE_ZONE[mode]]) score = Math.min(score, pz === 'red' ? 15 : 45);
  score = Math.max(0, Math.min(100, Math.round(score)));
  const label =
    pz === 'red'
      ? 'zu viel für dich'
      : score >= 80
        ? 'passt'
        : score >= 60
          ? 'passt eingeschränkt'
          : PZONE_RANK[pz] > PZONE_RANK[MODE_ZONE[mode]]
            ? `über deinem Modus ${GOAL_NAMES[mode]}`
            : 'reicht nicht';
  return { score, label, personalZone: pz, mode, exceed, goalsMet: met, notes };
}

export { GOAL_NAMES, DIM_NAMES };
