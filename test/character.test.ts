// Character, persönliche Zonen und Passung je Tagesmodus.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BASE_ENVELOPE,
  SAFETY_QUESTIONS,
  SKILL_QUESTIONS,
  buildEnvelope,
  envelopeFromTolerance,
  safetyBand,
  scoreCharacter,
  skillBand,
  type CharacterAnswers,
  type Currency,
  type SafetyLevel,
  type SkillLevel,
  type WingClass,
} from '../src/character.ts';
import { dimensionZone, personalFit, personalZone } from '../src/profile.ts';
import { summarizeDays } from '../src/windows.ts';
import { DEFAULT_CONFIG } from '../src/config.ts';
import type { DimensionKey, DimensionScore, Goal, HourEvaluation, PilotProfile } from '../src/types.ts';
import { loadPilot } from './helpers.ts';

const DIMS: DimensionKey[] = ['wind_comfort', 'thermic_character', 'shear_turbulence', 'structure_cap'];

function answers(skill: number, safety: number, extra: Partial<CharacterAnswers> = {}): CharacterAnswers {
  return {
    style: 'progress',
    wing: 'B',
    currency: 'mid',
    skills: Object.fromEntries(SKILL_QUESTIONS.map((q) => [q.id, skill])),
    safety: Object.fromEntries(SAFETY_QUESTIONS.map((q) => [q.id, safety])),
    ...extra,
  };
}

function dims(w: number, t: number, s: number, d: number): Record<DimensionKey, DimensionScore> {
  const mk = (key: DimensionKey, score: number): DimensionScore => ({ key, score, level: Math.round(score), sub: '', display: String(score), label: '', reasons: [] });
  return { wind_comfort: mk('wind_comfort', w), thermic_character: mk('thermic_character', t), shear_turbulence: mk('shear_turbulence', s), structure_cap: mk('structure_cap', d) };
}

function withMode(p: PilotProfile, mode: Goal, envelope = scoreCharacter(answers(4, 4)).envelope): PilotProfile {
  const q = structuredClone(p);
  q.comfort_profile.pilot_profile = mode;
  q.comfort_profile.envelope = envelope;
  return q;
}

test('Bänder für Technik- und Sicherheits-Score wie im Flow-Entwurf', () => {
  assert.equal(skillBand(15).level, 'foundation');
  assert.equal(skillBand(16).level, 'basic');
  assert.equal(skillBand(30).level, 'basic');
  assert.equal(skillBand(31).level, 'solid');
  assert.equal(skillBand(41).level, 'high');
  assert.equal(safetyBand(20).level, 'high_stress');
  assert.equal(safetyBand(21).level, 'mixed');
  assert.equal(safetyBand(31).level, 'stable');
  const r = scoreCharacter(answers(4, 4));
  assert.equal(r.skillTotal, 40);
  assert.equal(r.safetyTotal, 32);
});

test('Grenzen sind immer geordnet: Komfort ≤ Progress ≤ Challenge, alles zwischen 0 und 5', () => {
  for (const skill of Object.keys(BASE_ENVELOPE) as SkillLevel[]) {
    for (const safety of ['high_stress', 'mixed', 'stable'] as SafetyLevel[]) {
      for (const wing of ['A', 'B', 'C', 'D'] as WingClass[]) {
        for (const currency of ['low', 'mid', 'high'] as Currency[]) {
          const { envelope } = buildEnvelope(skill, safety, wing, currency);
          for (const k of DIMS) {
            const e = envelope[k];
            assert.ok(0 <= e.comfort && e.comfort <= e.progress && e.progress <= e.challenge && e.challenge <= 5, `${skill}/${safety}/${wing}/${currency} ${k}: ${JSON.stringify(e)}`);
          }
        }
      }
    }
  }
});

test('Mehr Technik heißt nie engere Grenzen', () => {
  const order: SkillLevel[] = ['foundation', 'basic', 'solid', 'high'];
  for (let i = 1; i < order.length; i++) {
    const lower = buildEnvelope(order[i - 1], 'stable', 'B', 'mid').envelope;
    const higher = buildEnvelope(order[i], 'stable', 'B', 'mid').envelope;
    for (const k of DIMS) {
      for (const level of ['comfort', 'progress', 'challenge'] as const) {
        assert.ok(higher[k][level] >= lower[k][level], `${order[i]} ${k} ${level}`);
      }
    }
  }
});

test('Wackeliges Sicherheitsgefühl, EN-A und wenig Flugpraxis machen die Grenzen vorsichtiger', () => {
  const base = buildEnvelope('solid', 'stable', 'B', 'mid').envelope;
  const stressed = buildEnvelope('solid', 'high_stress', 'B', 'mid').envelope;
  const enA = buildEnvelope('solid', 'stable', 'A', 'mid').envelope;
  const rare = buildEnvelope('solid', 'stable', 'B', 'low').envelope;
  assert.ok(stressed.wind_comfort.progress < base.wind_comfort.progress);
  assert.ok(stressed.shear_turbulence.progress < base.shear_turbulence.progress);
  assert.ok(enA.wind_comfort.progress < base.wind_comfort.progress);
  assert.equal(enA.shear_turbulence.progress, base.shear_turbulence.progress);
  assert.ok(rare.thermic_character.progress < base.thermic_character.progress);
});

test('Abschläge zusammen gehen nie unter die vorsichtigste Zeile der Starttabelle', () => {
  const { envelope, adjustments } = buildEnvelope('basic', 'high_stress', 'A', 'low');
  for (const k of DIMS) {
    const [c, p, x] = BASE_ENVELOPE.foundation[k];
    assert.ok(envelope[k].comfort >= c && envelope[k].progress >= p && envelope[k].challenge >= x, `${k}: ${JSON.stringify(envelope[k])}`);
  }
  // Wind wäre ohne Untergrenze 0,75 / 1,25 / 1,75, also fast windstill
  assert.deepEqual(envelope.wind_comfort, { comfort: 1.5, progress: 2, challenge: 2.5 });
  assert.match(adjustments.join(' '), /vorsichtigste Zeile/);
  // ohne Abschläge bleibt der Hinweis weg
  assert.doesNotMatch(buildEnvelope('basic', 'stable', 'B', 'mid').adjustments.join(' '), /vorsichtigste Zeile/);
});

test('Höhere Schirmklasse gibt nur mit solider Technik mehr Wind, nie mehr Turbulenz', () => {
  const basicB = buildEnvelope('basic', 'stable', 'B', 'mid').envelope;
  const basicC = buildEnvelope('basic', 'stable', 'C', 'mid').envelope;
  assert.deepEqual(basicC, basicB);
  const solidB = buildEnvelope('solid', 'stable', 'B', 'mid').envelope;
  const solidD = buildEnvelope('solid', 'stable', 'D', 'mid').envelope;
  assert.ok(solidD.wind_comfort.challenge > solidB.wind_comfort.challenge);
  assert.equal(solidD.shear_turbulence.challenge, solidB.shear_turbulence.challenge);
});

test('XC empfiehlt der Coach erst ab solider Technik und ohne erhöhtes Stressniveau', () => {
  assert.equal(scoreCharacter(answers(2, 4)).xcAdvised, false);
  assert.match(scoreCharacter(answers(2, 4)).xcReason, /31/);
  assert.equal(scoreCharacter(answers(4, 2)).xcAdvised, false);
  assert.equal(scoreCharacter(answers(4, 4)).xcAdvised, true);
  assert.equal(scoreCharacter(answers(4, 4, { style: 'relaxed' })).defaultMode, 'chill');
  assert.equal(scoreCharacter(answers(4, 4)).defaultMode, 'progress');
});

test('Alte Einzelgrenze wird zur Progress-Grenze, Komfort und Challenge eine halbe Stufe daneben', () => {
  const env = envelopeFromTolerance(loadPilot().comfort_profile.tolerance);
  assert.deepEqual(env.shear_turbulence, { comfort: 2.5, progress: 3, challenge: 3.5 });
  assert.deepEqual(env.wind_comfort, { comfort: 3.5, progress: 4, challenge: 4.5 });
});

test('Persönliche Zone: die anspruchsvollste Dimension entscheidet, feste No-Go-Regeln bleiben No-Go', () => {
  const limits = { comfort: 2, progress: 3, challenge: 4 };
  assert.equal(dimensionZone(2, limits), 'green');
  assert.equal(dimensionZone(2.5, limits), 'yellow');
  assert.equal(dimensionZone(3.5, limits), 'orange');
  assert.equal(dimensionZone(4.5, limits), 'red');
  const env = Object.fromEntries(DIMS.map((k) => [k, limits])) as Record<DimensionKey, typeof limits>;
  assert.equal(personalZone(dims(1, 2, 1, 2), 'chill', [], env), 'green');
  assert.equal(personalZone(dims(1, 3.5, 1, 2), 'progress', [], env), 'orange');
  assert.equal(personalZone(dims(1, 1, 1, 1), 'chill', [{ code: 'precip', text: 'Regen' }], env), 'no-go');
});

test('Der Tagesmodus bestimmt, bis zu welcher Zone eine Stunde ein Flugfenster ist', () => {
  const pilot = loadPilot();
  const envelope = scoreCharacter(answers(4, 4)).envelope; // solide Technik, stabil
  // Thermik 3: über Komfort (2,5), innerhalb Progress (3,5) → gelb
  const hour = dims(1.5, 3, 1.5, 3);
  const chill = personalFit(hour, 'progress', [], withMode(pilot, 'chill', envelope));
  const progress = personalFit(hour, 'progress', [], withMode(pilot, 'progress', envelope));
  assert.equal(chill.personalZone, 'yellow');
  assert.ok(chill.score < DEFAULT_CONFIG.windowMinFit, `Chill ${chill.score}`);
  assert.ok(progress.score >= 80, `Progress ${progress.score}`);
  // Turbulenz 3,5 liegt über Challenge (3) → rot, auch im XC-Modus kein Fenster
  const rough = personalFit(dims(2, 3, 3.5, 3), 'progress', [], withMode(pilot, 'xc', envelope));
  assert.equal(rough.personalZone, 'red');
  assert.ok(rough.score <= 15);
  assert.equal(rough.label, 'zu viel für dich');
});

test('Ein Flugfenster trägt die anspruchsvollste persönliche Zone seiner Stunden', () => {
  const pilot = withMode(loadPilot(), 'progress');
  const mk = (time: string, d: Record<DimensionKey, DimensionScore>): HourEvaluation =>
    ({
      time,
      isDay: true,
      dimensions: d,
      noGo: [],
      warnings: [],
      zone: 'progress',
      zoneLabel: 'lebhaft, thermisch',
      fit: personalFit(d, 'progress', [], pilot),
    }) as unknown as HourEvaluation;
  const hours = [mk('2026-07-12T11:00', dims(1, 2, 1, 3)), mk('2026-07-12T12:00', dims(1, 3, 1.5, 3)), mk('2026-07-12T13:00', dims(1, 2, 1, 3))];
  const [day] = summarizeDays(hours, DEFAULT_CONFIG);
  assert.equal(day.windows.length, 1);
  assert.equal(day.windows[0].personalZone, 'yellow');
  assert.match(day.verdict, /11–14 Uhr Progress/);
});
