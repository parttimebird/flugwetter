// Debriefing: Vorschläge aus Antworten und Vorhersage, Muster pro Startplatz, Migration gespeicherter Profile.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applySuggestion, spotPattern, suggestFromEntry, type DebriefEntry, type ForecastSnapshot } from '../src/debrief.ts';
import { migrateStoredProfile } from '../src/migrate.ts';
import type { DimensionKey, EnvelopeLimits, PersonalZone, PilotProfile } from '../src/types.ts';
import { loadPilot } from './helpers.ts';

function snap(zones: Partial<Record<DimensionKey, PersonalZone>>): ForecastSnapshot {
  const dimZones = { wind_comfort: 'green', thermic_character: 'green', shear_turbulence: 'green', structure_cap: 'green', ...zones } as Record<DimensionKey, PersonalZone>;
  return { zoneLabel: 'lebhaft, thermisch', personalZone: 'yellow', fit: 45, dims: { wind_comfort: 2, thermic_character: 3, shear_turbulence: 2.5, structure_cap: 3 }, dimZones, windKmh: 10, gustKmh: 18, climb: 1.2 };
}

test('Wohl gefühlt in einer Progress-Stunde: Vorschlag mutiger', () => {
  const s = suggestFromEntry({ answers: { feeling: 4, turbulence: 'as', again: 'yes' }, forecast: snap({ shear_turbulence: 'yellow' }) });
  assert.equal(s.length, 1);
  assert.equal(s[0].dim, 'shear_turbulence');
  assert.equal(s[0].delta, 0.25);
});

test('Unwohl und ruppiger als vorhergesagt in einer Komfort-Stunde: Vorschlag vorsichtiger', () => {
  const s = suggestFromEntry({ answers: { feeling: 0, turbulence: 'more', wind: 'more', launch: 'hard' }, forecast: snap({}) });
  assert.deepEqual(s.map((x) => [x.dim, x.delta]), [['shear_turbulence', -0.25], ['wind_comfort', -0.25]]);
});

test('Ohne Vorhersage oder ohne Gefühl kein Vorschlag; schon über Challenge auch keiner', () => {
  assert.equal(suggestFromEntry({ answers: { feeling: 0, turbulence: 'more' } }).length, 0);
  assert.equal(suggestFromEntry({ answers: { turbulence: 'more' }, forecast: snap({}) }).length, 0);
  assert.equal(suggestFromEntry({ answers: { feeling: 0, turbulence: 'more' }, forecast: snap({ shear_turbulence: 'orange' }) }).length, 0);
});

test('Vorschlag anwenden verschiebt alle drei Grenzen und hält die Reihenfolge', () => {
  const env = { shear_turbulence: { comfort: 2, progress: 2.5, challenge: 3 } } as Record<DimensionKey, EnvelopeLimits>;
  applySuggestion(env, { dim: 'shear_turbulence', delta: -0.25 });
  assert.deepEqual(env.shear_turbulence, { comfort: 1.75, progress: 2.25, challenge: 2.75 });
  const top = { wind_comfort: { comfort: 5, progress: 5, challenge: 5 } } as Record<DimensionKey, EnvelopeLimits>;
  applySuggestion(top, { dim: 'wind_comfort', delta: 0.25 });
  assert.deepEqual(top.wind_comfort, { comfort: 5, progress: 5, challenge: 5 });
});

test('Muster pro Startplatz erst ab zwei gleichen Antworten', () => {
  const e = (spotId: string, wind: 'more' | 'less' | 'as'): DebriefEntry => ({ id: Math.random().toString(), createdAt: '', spotId, date: '2026-11-28', hour: 13, answers: { wind }, suggestions: [] });
  assert.deepEqual(spotPattern([e('merkur', 'more')], 'merkur'), []);
  assert.deepEqual(spotPattern([e('merkur', 'more'), e('merkur', 'more'), e('kandel', 'more')], 'merkur'), ['Wind 2× stärker als vorhergesagt']);
});

test('Migration: progress wird Flow, xc wird Push mit Strecken-Option, alte Standardwerte werden ersetzt', () => {
  const defaults = loadPilot();
  const old = structuredClone(defaults) as unknown as { comfort_profile: Record<string, unknown> };
  old.comfort_profile.pilot_profile = 'xc';
  delete old.comfort_profile.xc;
  old.comfort_profile.min_required_scores_for_goal = {
    chill: { thermic_character_min: 1, wind_comfort_max: 3 },
    progress: { thermic_character_min: 2, shear_turbulence_max: 4 },
    xc: { thermic_character_min: 3, wind_comfort_max: 5, shear_turbulence_max: 5 },
  };
  const p = old as unknown as PilotProfile;
  p.character = { style: 'butter' as never, wing: 'B', currency: 'mid', skills: {}, safety: {} };
  migrateStoredProfile(p, defaults);
  assert.equal(p.comfort_profile.pilot_profile, 'push');
  assert.equal(p.comfort_profile.xc, true);
  assert.equal(p.character.style, 'gull');
  const req = p.comfort_profile.min_required_scores_for_goal as Record<string, unknown>;
  assert.equal(req.progress, undefined);
  assert.deepEqual(req.flow, defaults.comfort_profile.min_required_scores_for_goal.flow);
  assert.deepEqual(req.xc, defaults.comfort_profile.min_required_scores_for_goal.xc);
  assert.ok(req.push);
  // selbst eingestellte Werte bleiben
  const own = structuredClone(defaults) as unknown as { comfort_profile: Record<string, unknown> };
  own.comfort_profile.pilot_profile = 'progress';
  own.comfort_profile.min_required_scores_for_goal = { chill: {}, progress: { thermic_character_min: 2.5 } };
  const q = own as unknown as PilotProfile;
  migrateStoredProfile(q, defaults);
  assert.equal(q.comfort_profile.pilot_profile, 'flow');
  assert.deepEqual(q.comfort_profile.min_required_scores_for_goal.flow, { thermic_character_min: 2.5 });
});
