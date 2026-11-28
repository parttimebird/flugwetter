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
  normalizeMode,
  normalizeStyle,
} from '../src/character.ts';
import { DEFAULT_LAUNCH, dimensionZone, goalsMet, launchCheck, launchPrefsOf, personalFit, personalZone, turbulenceEmoji } from '../src/profile.ts';
import { summarizeDays } from '../src/windows.ts';
import { DEFAULT_CONFIG } from '../src/config.ts';
import type { DimensionKey, DimensionScore, Goal, HourEvaluation, HourMetrics, LaunchPrefs, PilotProfile } from '../src/types.ts';
import { loadPilot } from './helpers.ts';

const DIMS: DimensionKey[] = ['wind_comfort', 'thermic_character', 'shear_turbulence', 'structure_cap'];

function answers(skill: number, safety: number, extra: Partial<CharacterAnswers> = {}): CharacterAnswers {
  return {
    style: 'raven',
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

test('Push reicht erst ab solider Technik und ohne erhöhtes Stressniveau bis in die Challenge-Zone', () => {
  assert.equal(scoreCharacter(answers(2, 4)).pushAdvised, false);
  assert.match(scoreCharacter(answers(2, 4)).pushReason, /31/);
  assert.equal(scoreCharacter(answers(4, 2)).pushAdvised, false);
  assert.equal(scoreCharacter(answers(4, 4)).pushAdvised, true);
});

test('Vogel-Typ setzt Startmodus und Strecken-Option, nie Grenzen', () => {
  assert.equal(scoreCharacter(answers(4, 4, { style: 'gull' })).defaultMode, 'chill');
  assert.equal(scoreCharacter(answers(4, 4)).defaultMode, 'push');
  assert.equal(scoreCharacter(answers(4, 4, { style: 'sparrow' })).defaultMode, 'flow');
  const stork = scoreCharacter(answers(4, 4, { style: 'stork' }));
  assert.equal(stork.defaultMode, 'flow');
  assert.equal(stork.defaultXc, true);
  assert.equal(scoreCharacter(answers(4, 4, { style: 'gull' })).defaultXc, false);
  assert.equal(scoreCharacter(answers(4, 4, { style: 'gull', prefs: { go_xc: 5 } })).defaultXc, true);
  assert.deepEqual(scoreCharacter(answers(4, 4, { style: 'gull' })).envelope, scoreCharacter(answers(4, 4, { style: 'stork' })).envelope);
});

test('Alte Modi werden umgeschrieben: progress wird Flow, xc wird Push mit Strecken-Option', () => {
  assert.deepEqual(normalizeMode('progress'), { mode: 'flow', xc: false });
  assert.deepEqual(normalizeMode('xc'), { mode: 'push', xc: true });
  assert.deepEqual(normalizeMode('chill'), { mode: 'chill', xc: false });
  assert.deepEqual(normalizeMode('quatsch'), { mode: 'flow', xc: false });
});

test('Flugstile aus Schritt 3 werden auf die neuen Typen abgebildet', () => {
  assert.equal(normalizeStyle('relaxed'), 'gull');
  assert.equal(normalizeStyle('scenery'), 'swallow');
  assert.equal(normalizeStyle('progress'), 'raven');
  // erste Fassung des Änderungskonzepts (Essens-Typen)
  assert.equal(normalizeStyle('butter'), 'gull');
  assert.equal(normalizeStyle('community'), 'sparrow');
  assert.equal(normalizeStyle('xc'), 'stork');
  assert.equal(normalizeStyle('hikefly'), 'chough');
  assert.equal(normalizeStyle('chough'), 'chough');
  assert.equal(normalizeStyle('unbekannt'), 'gull');
});

test('Flugstil verschiebt nie die Grenzen', () => {
  const a = scoreCharacter(answers(4, 4, { style: 'gull' })).envelope;
  const b = scoreCharacter(answers(4, 4, { style: 'stork' })).envelope;
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
  const tail = launchMetrics({ takeoffWindKmh: 4, headwindKmh: -4, takeoffInSector: false, gustKmh: 6 });
  assert.equal(launchCheck(tail, { crosswind: 'yes', tailwind: 'no' }, 'push').issues.length, 1);
  assert.equal(launchCheck(tail, { crosswind: 'yes', tailwind: 'light' }, 'flow').issues.length, 1);
  assert.match(launchCheck(tail, { crosswind: 'yes', tailwind: 'light' }, 'flow').issues[0], /Push/);
  assert.equal(launchCheck(tail, { crosswind: 'yes', tailwind: 'light' }, 'push').issues.length, 0);
  // Windstille ist nie ein Problem
  assert.equal(launchCheck(launchMetrics({ takeoffWindKmh: 2, headwindKmh: -2 }), DEFAULT_LAUNCH, 'chill').issues.length, 0);
});

/** Wind aus `deg` Grad neben der Startrichtung */
function angled(speed: number, deg: number, gust: number): HourMetrics {
  const rad = (deg * Math.PI) / 180;
  return launchMetrics({ takeoffWindKmh: speed, headwindKmh: speed * Math.cos(rad), crosswindKmh: speed * Math.sin(rad), gustKmh: gust });
}

test('Startbedingungen: Seitenwind nach Winkel und Böen', () => {
  const light: LaunchPrefs = { crosswind: 'light', tailwind: 'no' };
  const yes: LaunchPrefs = { crosswind: 'yes', tailwind: 'no' };
  // fast von vorn: keine eigene Seitenwind-Grenze
  assert.equal(launchCheck(angled(12, 10, 25), DEFAULT_LAUNCH, 'chill').issues.length, 0);
  // bis 30°: Böen bis 15 (nein) bzw. 20 (leicht, ja)
  assert.equal(launchCheck(angled(10, 25, 14), DEFAULT_LAUNCH, 'chill').issues.length, 0);
  assert.equal(launchCheck(angled(10, 25, 18), DEFAULT_LAUNCH, 'chill').issues.length, 1);
  assert.equal(launchCheck(angled(10, 25, 18), light, 'chill').issues.length, 0);
  // 30–60°: nein nie, leicht bis 10, ja bis 15
  assert.equal(launchCheck(angled(6, 45, 9), DEFAULT_LAUNCH, 'chill').issues.length, 1);
  assert.equal(launchCheck(angled(6, 45, 9), light, 'chill').issues.length, 0);
  assert.equal(launchCheck(angled(8, 45, 13), light, 'chill').issues.length, 1);
  assert.equal(launchCheck(angled(8, 45, 13), yes, 'chill').issues.length, 0);
  // über 60°: nur bei „ja“, dann als Hinweis
  assert.equal(launchCheck(angled(6, 75, 9), light, 'chill').issues.length, 1);
  assert.equal(launchCheck(angled(6, 75, 9), yes, 'chill').issues.length, 0);
  assert.match(launchCheck(angled(6, 75, 9), yes, 'chill').hints[0], /kritisch prüfen/);
});

test('Leichter Rückenwind nur bei Böen unter 10 km/h', () => {
  const pro: LaunchPrefs = { crosswind: 'yes', tailwind: 'light' };
  assert.equal(launchCheck(launchMetrics({ takeoffWindKmh: 4, headwindKmh: -4, gustKmh: 8 }), pro, 'push').issues.length, 0);
  assert.equal(launchCheck(launchMetrics({ takeoffWindKmh: 4, headwindKmh: -4, gustKmh: 12 }), pro, 'push').issues.length, 1);
});

test('Startbedingungen: ohne Rückwärtsaufziehen kein Vorwärtsstart über 25 km/h', () => {
  const strong = launchMetrics({ takeoffWindKmh: 26, headwindKmh: 26 });
  assert.equal(launchCheck(strong, { ...DEFAULT_LAUNCH, reverseLaunch: false }, 'flow').issues.length, 1);
  assert.equal(launchCheck(strong, { ...DEFAULT_LAUNCH, reverseLaunch: true }, 'flow').issues.length, 0);
  const fresh = launchMetrics({ takeoffWindKmh: 12, headwindKmh: 12 });
  assert.equal(launchCheck(fresh, { ...DEFAULT_LAUNCH, reverseLaunch: false }, 'flow').issues.length, 0);
  assert.equal(launchCheck(fresh, { ...DEFAULT_LAUNCH, reverseLaunch: false }, 'flow').hints.length, 1);
});

test('Passt der Start nicht, zählt die Stunde nie als Flugfenster', () => {
  const pilot = withMode(loadPilot(), 'flow');
  pilot.launch = { crosswind: 'no', tailwind: 'no' };
  const m = angled(6, 45, 9);
  const fit = personalFit(dims(1, 2, 1, 3), 'lively', [], pilot, m);
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
  assert.equal(personalZone(dims(1, 2, 1, 2), 'calm', [], env), 'green');
  assert.equal(personalZone(dims(1, 3.5, 1, 2), 'lively', [], env), 'orange');
  assert.equal(personalZone(dims(1, 1, 1, 1), 'calm', [{ code: 'precip', text: 'Regen' }], env), 'no-go');
});

test('Der Tagesmodus bestimmt, bis zu welcher Zone eine Stunde ein Flugfenster ist', () => {
  const pilot = loadPilot();
  const envelope = scoreCharacter(answers(4, 4)).envelope; // solide Technik, stabil
  const calm = dims(1, 1.5, 1, 3);
  // ruhige Luft in der Komfort-Zone: Chill und Flow passen
  assert.ok(personalFit(calm, 'calm', [], withMode(pilot, 'chill', envelope)).score >= 80);
  assert.ok(personalFit(calm, 'calm', [], withMode(pilot, 'flow', envelope)).score >= 80);
  // lebhafte Luft in der Komfort-Zone: Flow ja, Chill nicht
  const lively = dims(1.5, 2.5, 1.5, 3);
  const chillLively = personalFit(lively, 'lively', [], withMode(pilot, 'chill', envelope));
  assert.ok(chillLively.score < DEFAULT_CONFIG.windowMinFit, `Chill ${chillLively.score}`);
  assert.equal(chillLively.label, 'zu lebhaft für Chill');
  assert.ok(personalFit(lively, 'lively', [], withMode(pilot, 'flow', envelope)).score >= 80);
  // Thermik 3: über Komfort (2,5), innerhalb Progress (3,5) → gelb: Flow nicht, Push ja
  const hour = dims(1.5, 3, 1.5, 3);
  const flow = personalFit(hour, 'lively', [], withMode(pilot, 'flow', envelope));
  const push = personalFit(hour, 'lively', [], withMode(pilot, 'push', envelope));
  assert.equal(flow.personalZone, 'yellow');
  assert.ok(flow.score < DEFAULT_CONFIG.windowMinFit, `Flow ${flow.score}`);
  assert.ok(push.score >= 80, `Push ${push.score}`);
  // Turbulenz 3,5 liegt über Challenge (3) → rot, auch in Push kein Fenster
  const rough = personalFit(dims(2, 3, 3.5, 3), 'lively', [], withMode(pilot, 'push', envelope));
  assert.equal(rough.personalZone, 'red');
  assert.ok(rough.score <= 15);
  assert.equal(rough.label, 'zu viel für dich');
});

test('Push reicht bis Challenge nur mit passendem Character, sonst bis Progress', () => {
  const strong = answers(4, 4);
  const shaky = answers(4, 2);
  const env = scoreCharacter(strong).envelope;
  // Thermik zwischen Progress (3,5) und Challenge (4) → orange
  const hour = dims(1.5, 3.75, 1.5, 3);
  const a = withMode(loadPilot(), 'push', env);
  a.character = strong;
  const b = withMode(loadPilot(), 'push', env);
  b.character = shaky;
  const c = withMode(loadPilot(), 'push', env);
  assert.equal(personalFit(hour, 'lively', [], a).personalZone, 'orange');
  assert.ok(personalFit(hour, 'lively', [], a).score >= DEFAULT_CONFIG.windowMinFit);
  assert.ok(personalFit(hour, 'lively', [], b).score < DEFAULT_CONFIG.windowMinFit);
  assert.ok(personalFit(hour, 'lively', [], c).score < DEFAULT_CONFIG.windowMinFit, 'ohne Character bis Progress');
});

test('Strecken-Option: verlangt Thermik und Arbeitshöhe, Soaring zählt nicht', () => {
  const pilot = withMode(loadPilot(), 'flow');
  pilot.comfort_profile.xc = true;
  const good = personalFit(dims(1.5, 2.5, 1.5, 3), 'xc', [], pilot);
  assert.equal(good.xc, true);
  assert.ok(good.score >= 80, `XC ${good.score}`);
  const flat = personalFit(dims(1.5, 1.5, 1.5, 1.5), 'calm', [], pilot);
  assert.ok(flat.score < DEFAULT_CONFIG.windowMinFit);
  assert.ok(flat.notes.some((n) => /Strecke/.test(n)));
  const soar = { takeoffWindKmh: 17, headwindKmh: 17, crosswindKmh: 0, gustKmh: 20, soaringMode: 'chill', cloudBaseMsl: null, workingHeight: 0 } as unknown as HourMetrics;
  assert.ok(personalFit(dims(2.5, 0.5, 1, 1), 'lively', [], pilot, soar).score < DEFAULT_CONFIG.windowMinFit);
});

test('Strecken-Option: Fenster unter drei Stunden zählen nicht', () => {
  const pilot = withMode(loadPilot(), 'flow');
  pilot.comfort_profile.xc = true;
  const d = dims(1.5, 2.5, 1.5, 3);
  const mk = (time: string, dd = d): HourEvaluation =>
    ({ time, isDay: true, dimensions: dd, noGo: [], warnings: [], zone: 'xc', zoneLabel: 'Streckenwetter', fit: personalFit(dd, 'xc', [], pilot) }) as unknown as HourEvaluation;
  const two = summarizeDays([mk('2026-07-12T12:00'), mk('2026-07-12T13:00')], DEFAULT_CONFIG)[0];
  assert.equal(two.windows.length, 0);
  assert.match(two.verdict, /zu kurz/);
  const three = summarizeDays([mk('2026-07-12T12:00'), mk('2026-07-12T13:00'), mk('2026-07-12T14:00')], DEFAULT_CONFIG)[0];
  assert.equal(three.windows.length, 1);
});

test('Startbedingungen pro Startplatz: eigene Böen-Grenze, Seitenwind nur mit passendem Character', () => {
  const pilot = withMode(loadPilot(), 'flow');
  pilot.spot_launch = { kandel: { maxGustKmh: 15, crosswind: 'yes' } };
  const m = angled(10, 25, 18);
  // ohne Character bleibt Seitenwind „nein“: bis 30° Böen bis 15 → schon allgemein zu viel
  assert.equal(launchPrefsOf(pilot, 'kandel').crosswind, 'no');
  assert.equal(launchPrefsOf(pilot, 'kandel').maxGustKmh, 15);
  assert.equal(launchPrefsOf(pilot, 'andere').maxGustKmh, undefined);
  const calmGusts = launchMetrics({ takeoffWindKmh: 10, headwindKmh: 10, gustKmh: 18 });
  assert.equal(personalFit(dims(1.5, 2, 1, 3), 'lively', [], pilot, calmGusts, 'andere').launchIssues.length, 0);
  const fit = personalFit(dims(1.5, 2, 1, 3), 'lively', [], pilot, calmGusts, 'kandel');
  assert.equal(fit.launchIssues.length, 1);
  assert.match(fit.launchIssues[0], /diesen Startplatz/);
  // mit erfahrenem Character gilt das „ja“ pro Startplatz
  pilot.character = answers(5, 5, { currency: 'high', familiar: 'yes' });
  assert.equal(launchPrefsOf(pilot, 'kandel').crosswind, 'yes');
  assert.equal(launchCheck(m, launchPrefsOf(pilot, 'andere'), 'flow').issues.length, 1);
});

test('Vorlieben: Blauthermik pro Pilot auf- oder abgewertet, Abgleiter brauchen keine Thermik', () => {
  const pilot = withMode(loadPilot(), 'flow');
  pilot.comfort_profile.xc = true;
  const blue = { takeoffWindKmh: 5, headwindKmh: 5, crosswindKmh: 0, gustKmh: 8, cloudBaseMsl: null, workingHeight: 900, cape: 0, cloudHigh: 0 } as unknown as HourMetrics;
  const d = dims(1.5, 2.5, 1.5, 3);
  pilot.character = answers(4, 4, { prefs: { blue_ok: 1 } });
  const dislike = personalFit(d, 'xc', [], pilot, blue);
  pilot.character = answers(4, 4, { prefs: { blue_ok: 5 } });
  const like = personalFit(d, 'xc', [], pilot, blue);
  assert.ok(dislike.score < like.score, `${dislike.score} < ${like.score}`);
  assert.ok(like.notes.some((n) => /magst du/.test(n)));
  // Abgleiter: Flow ohne Thermik
  const glider = withMode(loadPilot(), 'flow');
  const noThermal = dims(1, 0.3, 0.5, 1);
  assert.ok(!goalsMet(noThermal, glider, undefined, 'calm').includes('flow'));
  glider.character = answers(4, 4, { prefs: { glides: 5 } });
  assert.ok(goalsMet(noThermal, glider, undefined, 'calm').includes('flow'));
  assert.ok(goalsMet(noThermal, glider, undefined, 'calm').includes('chill'));
});

test('Turbulenz-Emoji nach persönlicher Zone', () => {
  const l = { comfort: 2.5, progress: 3, challenge: 3.5 };
  assert.equal(turbulenceEmoji(0.5, l), '😌');
  assert.equal(turbulenceEmoji(1.5, l), '🙂');
  assert.equal(turbulenceEmoji(2.5, l), '😄');
  assert.equal(turbulenceEmoji(2.75, l), '😐');
  assert.equal(turbulenceEmoji(3.25, l), '🤔');
  assert.equal(turbulenceEmoji(4, l), '❌');
});

test('Ein Flugfenster trägt die anspruchsvollste persönliche Zone seiner Stunden', () => {
  const pilot = withMode(loadPilot(), 'push');
  const mk = (time: string, d: Record<DimensionKey, DimensionScore>): HourEvaluation =>
    ({
      time,
      isDay: true,
      dimensions: d,
      noGo: [],
      warnings: [],
      zone: 'lively',
      zoneLabel: 'lebhaft, thermisch',
      fit: personalFit(d, 'lively', [], pilot),
    }) as unknown as HourEvaluation;
  const hours = [mk('2026-07-12T11:00', dims(1, 2, 1, 3)), mk('2026-07-12T12:00', dims(1, 3, 1.5, 3)), mk('2026-07-12T13:00', dims(1, 2, 1, 3))];
  const [day] = summarizeDays(hours, DEFAULT_CONFIG);
  assert.equal(day.windows.length, 1);
  assert.equal(day.windows[0].personalZone, 'yellow');
  assert.match(day.verdict, /11–14 Uhr Progress/);
});
