// Persönliche Passung: Wie gut passt eine Stunde zu einem Pilotenprofil (user_konfig)?

import type { DimensionKey, DimensionScore, FitResult, Goal, NoGoReason, PilotProfile, Zone } from './types.ts';

const DIM_NAMES: Record<DimensionKey, string> = {
  wind_comfort: 'Wind',
  thermic_character: 'Thermik',
  shear_turbulence: 'Scherung/Turbulenz',
  structure_cap: 'Struktur/Deckel',
};

const GOAL_NAMES: Record<Goal, string> = { chill: 'Chill', progress: 'Progress', xc: 'XC' };

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

export function personalFit(
  dims: Record<DimensionKey, DimensionScore>,
  zone: Zone,
  noGo: NoGoReason[],
  profile: PilotProfile,
): FitResult {
  const met = goalsMet(dims, profile);
  if (noGo.length > 0 || zone === 'no-go') {
    return { score: 0, label: 'No-Go', exceed: {}, goalsMet: [], notes: [] };
  }
  const tol = profile.comfort_profile.tolerance;
  const exceed: FitResult['exceed'] = {};
  const notes: string[] = [];
  let penalty = 0;
  for (const key of Object.keys(dims) as DimensionKey[]) {
    const t = tol[key];
    if (!t) continue;
    const over = dims[key].score - t.max_score_acceptable;
    if (over > 0) {
      exceed[key] = Math.round(over * 10) / 10;
      penalty += over * t.importance_weight;
      notes.push(`${DIM_NAMES[key]} ${dims[key].display} liegt über deiner Grenze ${t.max_score_acceptable}`);
    }
  }
  let score = 100 - 35 * penalty;
  const goal = profile.comfort_profile.pilot_profile;
  if (!met.includes(goal)) {
    score -= 25;
    notes.push(`für dein Ziel ${GOAL_NAMES[goal]} reicht es nicht`);
  }
  score = Math.max(0, Math.min(100, Math.round(score)));
  const label = score >= 80 ? 'passt' : score >= 60 ? 'passt eingeschränkt' : score >= 40 ? 'grenzwertig' : 'nicht für dich';
  return { score, label, exceed, goalsMet: met, notes };
}

export { GOAL_NAMES, DIM_NAMES };
