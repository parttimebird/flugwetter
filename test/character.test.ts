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
  normalizeStyle,
} from '../src/character.ts';
import { DEFAULT_LAUNCH, dimensionZone, launchCheck, personalFit, personalZone } from '../src/profile.ts';
import { summarizeDays } from '../src/windows.ts';
import { DEFAULT_CONFIG } from '../src/config.ts';
import type { DimensionKey, DimensionScore, Goal, HourEvaluation, HourMetrics, PilotProfile } from '../src/types.ts';
import { loadPilot } from './helpers.ts';

const DIMS: DimensionKey[] = ['wind_comfort', 'thermic_character', 'shear_turbulence', 'structure_cap'];

function answers(skill: number, safety: number, extra: Partial<CharacterAnswers> = {}): CharacterAnswers {
  return {
    style: 'learner',
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

test('Push empfiehlt der Coach erst ab solider Technik und ohne erhöhtes Stressniveau', () => {
  assert.equal(scoreCharacter(answers(2, 4)).xcAdvised, false);
  assert.match(scoreCharacter(answers(2, 4)).xcReason, /31/);
  assert.equal(scoreCharacter(answers(4, 2)).xcAdvised, false);
  assert.equal(scoreCharacter(answers(4, 4)).xcAdvised, true);
  assert.equal(scoreCharacter(answers(4, 4, { style: 'butter' })).defaultMode, 'chill');
  assert.equal(scoreCharacter(answers(4, 4)).defaultMode, 'progress');
  // Punktesammler startet in Push, aber nur, wenn der Character es hergibt
  assert.equal(scoreCharacter(answers(4, 4, { style: 'xc' })).defaultMode, 'xc');
  assert.equal(scoreCharacter(answers(2, 4, { style: 'xc' })).defaultMode, 'progress');
});

test('Flugstile aus Schritt 3 werden auf die neuen Typen abgebildet', () => {
  assert.equal(normalizeStyle('relaxed'), 'butter');
  assert.equal(normalizeStyle('scenery'), 'explorer');
  assert.equal(normalizeStyle('progress'), 'learner');
  assert.equal(normalizeStyle('hikefly'), 'hikefly');
  assert.equal(normalizeStyle('unbekannt'), 'butter');
});

test('Flugstil verschiebt nie die Grenzen', () => {
  const a = scoreCharacter(answers(4, 4, { style: 'butter' })).envelope;
  const b = scoreCharacter(answers(4, 4, { style: 'xc' })).envelope;
  assert.deepEqual(a, b);
});

test('Nicht vertraut mit dem System: kein Zuschlag für EN-C/D, ganz neu sogar vorsichtiger', () => {
  const sure = buildEnvelope('solid', 'stable', 'D', 'mid', 'yes').envelope;
  const partly = buildEnvelope('solid', 'stable', 'D', 'mid', 'partly').envelope;
  const no = buildEnvelope('solid', 'stable', 'D', 'mid', 'no').envelope;
  const plainB = buildEnvelope('solid', 'stable', 'B', 'mid').envelope;
  assert.ok(sure.wind_comfort.progress > partly.wind_comfort.progress);
  assert.deepEqual(partly.wind_comfort, plainB.wind_comfort);
  assert.ok(no.wind_comfort.progress < partly.wind_comfort.progress);
  assert.ok(no.shear_turbulence.progress < partly.shear_turbulence.progress);
});

test('Fragen zu Seiten- und Rückenwind gibt es erst für erfahrene Piloten', () => {
  // wenig Technik: Antworten werden ignoriert, es bleibt bei nein
  const novice = scoreCharacter(answers(2, 4, { crosswind: 'yes', tailwind: 'light' }));
  assert.equal(novice.crosswindUnlocked, false);
  assert.deepEqual([novice.launch.crosswind, novice.launch.tailwind], ['no', 'no']);
  // solide, 20 bis 50 Flüge: Seitenwind ja, Rückenwind noch nicht
  const solid = scoreCharacter(answers(4, 4, { familiar: 'yes', crosswind: 'light', tailwind: 'light' }));
  assert.equal(solid.crosswindUnlocked, true);
  assert.equal(solid.tailwindUnlocked, false);
  assert.deepEqual([solid.launch.crosswind, solid.launch.tailwind], ['light', 'no']);
  // sehr erfahren: beides
  const pro = scoreCharacter(answers(5, 5, { familiar: 'yes', currency: 'high', crosswind: 'yes', tailwind: 'light' }));
  assert.equal(pro.tailwindUnlocked, true);
  assert.deepEqual([pro.launch.crosswind, pro.launch.tailwind], ['yes', 'light']);
  // nicht vertraut mit dem System sperrt beides
  assert.equal(scoreCharacter(answers(5, 5, { familiar: 'partly', currency: 'high' })).crosswindUnlocked, false);
});

function launchMetrics(over: Partial<HourMetrics>): HourMetrics {
  const base = { takeoffWindKmh: 0, takeoffWindDir: 270, takeoffInSector: true, headwindKmh: 0, crosswindKmh: 0, cloudBaseMsl: 1800, workingHeight: 800 };
  return { ...base, ...over } as HourMetrics;
}

test('Startbedingungen: Rückenwind nur sehr erfahren und nur im Modus Push', () => {
  const tail = launchMetrics({ takeoffWindKmh: 4, headwindKmh: -4, takeoffInSector: false });
  assert.equal(launchCheck(tail, { crosswind: 'yes', tailwind: 'no' }, 'xc').issues.length, 1);
  assert.equal(launchCheck(tail, { crosswind: 'yes', tailwind: 'light' }, 'progress').issues.length, 1);
  assert.match(launchCheck(tail, { crosswind: 'yes', tailwind: 'light' }, 'progress').issues[0], /Push/);
  assert.equal(launchCheck(tail, { crosswind: 'yes', tailwind: 'light' }, 'xc').issues.length, 0);
  // Windstille ist nie ein Problem
  assert.equal(launchCheck(launchMetrics({ takeoffWindKmh: 2, headwindKmh: -2 }), DEFAULT_LAUNCH, 'chill').issues.length, 0);
});

test('Startbedingungen: Seitenwind je nach Toleranz', () => {
  const outside = launchMetrics({ takeoffWindKmh: 4, headwindKmh: 0.5, crosswindKmh: 4, takeoffInSector: false });
  assert.equal(launchCheck(outside, DEFAULT_LAUNCH, 'chill').issues.length, 1);
  assert.equal(launchCheck(outside, { crosswind: 'light', tailwind: 'no' }, 'chill').issues.length, 0);
  const outside6 = launchMetrics({ takeoffWindKmh: 6, headwindKmh: 1, crosswindKmh: 6, takeoffInSector: false });
  assert.equal(launchCheck(outside6, { crosswind: 'light', tailwind: 'no' }, 'chill').issues.length, 1);
  assert.equal(launchCheck(outside6, { crosswind: 'yes', tailwind: 'no' }, 'chill').issues.length, 0);
  // im Windfenster, aber schräg: Seitenwind-Anteil 9 km/h
  const oblique = launchMetrics({ takeoffWindKmh: 13, headwindKmh: 9, crosswindKmh: 9 });
  assert.equal(launchCheck(oblique, DEFAULT_LAUNCH, 'chill').issues.length, 1);
  assert.equal(launchCheck(oblique, { crosswind: 'light', tailwind: 'no' }, 'chill').issues.length, 0);
});

test('Startbedingungen: ohne Rückwärtsaufziehen kein Vorwärtsstart über 25 km/h', () => {
  const strong = launchMetrics({ takeoffWindKmh: 26, headwindKmh: 26 });
  assert.equal(launchCheck(strong, { ...DEFAULT_LAUNCH, reverseLaunch: false }, 'progress').issues.length, 1);
  assert.equal(launchCheck(strong, { ...DEFAULT_LAUNCH, reverseLaunch: true }, 'progress').issues.length, 0);
  const fresh = launchMetrics({ takeoffWindKmh: 12, headwindKmh: 12 });
  assert.equal(launchCheck(fresh, { ...DEFAULT_LAUNCH, reverseLaunch: false }, 'progress').issues.length, 0);
  assert.equal(launchCheck(fresh, { ...DEFAULT_LAUNCH, reverseLaunch: false }, 'progress').hints.length, 1);
});

test('Passt der Start nicht, zählt die Stunde nie als Flugfenster', () => {
  const pilot = withMode(loadPilot(), 'progress');
  pilot.launch = { crosswind: 'no', tailwind: 'no' };
  const m = launchMetrics({ takeoffWindKmh: 4, headwindKmh: 0.5, crosswindKmh: 4, takeoffInSector: false });
  const fit = personalFit(dims(1, 2, 1, 3), 'progress', [], pilot, m);
  assert.equal(fit.personalZone, 'red');
  assert.ok(fit.score < DEFAULT_CONFIG.windowMinFit);
  assert.equal(fit.label, 'Start passt nicht zu dir');
  assert.equal(fit.launchIssues.length, 1);
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
