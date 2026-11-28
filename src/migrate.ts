// Gespeicherte Pilotenprofile (localStorage) auf den aktuellen Stand bringen.

import type { PilotProfile } from './types.ts';
import { normalizeMode, normalizeStyle, scoreCharacter } from './character.ts';

/**
 * Gespeicherte Profile auf den aktuellen Stand bringen:
 * - Flugstile aus Schritt 3 und die Essens-Typen auf die Vögel umstellen, Startbedingungen aus dem Character nachtragen
 * - Modi chill/progress/xc (bis 28.11.2026) auf Chill/Flow/Push: progress wird Flow, xc wird Push mit Strecken-Option
 * - Mindestanforderungen: alte Standardwerte durch die neuen ersetzen, selbst eingestellte Werte übernehmen
 */
export function migrateStoredProfile(p: PilotProfile, defaults: PilotProfile): void {
  if (p.character) {
    p.character.style = normalizeStyle(p.character.style);
    p.launch ??= scoreCharacter(p.character).launch;
  }
  const cp = p.comfort_profile;
  const { mode, xc } = normalizeMode(String(cp.pilot_profile));
  cp.pilot_profile = mode;
  if (xc) cp.xc = true;
  const req = cp.min_required_scores_for_goal as Record<string, PilotProfile['comfort_profile']['min_required_scores_for_goal']['flow'] | undefined>;
  const fresh = defaults.comfort_profile.min_required_scores_for_goal;
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  const OLD_PROGRESS = { thermic_character_min: 2, shear_turbulence_max: 4 };
  const OLD_XC = { thermic_character_min: 3, wind_comfort_max: 5, shear_turbulence_max: 5 };
  if (req.progress !== undefined) {
    req.flow ??= same(req.progress, OLD_PROGRESS) ? structuredClone(fresh.flow) : req.progress;
    delete req.progress;
  }
  if (req.xc && same(req.xc, OLD_XC)) req.xc = structuredClone(fresh.xc);
  req.flow ??= structuredClone(fresh.flow);
  req.push ??= structuredClone(fresh.push);
  req.xc ??= structuredClone(fresh.xc);
  req.chill ??= structuredClone(fresh.chill);
}

