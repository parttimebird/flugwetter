// Typische Lagen nachgebaut: Die Engine soll sie so einordnen, wie ein erfahrener Pilot es erwarten würde.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateHour } from '../src/engine.ts';
import { TEST_SPOT, loadPilot, mixedLayer, syntheticHour, westWind } from './helpers.ts';

const pilot = loadPilot();

// Sommertag, Mischungsschicht bis 1900 m mit +1 K Inversion darüber, Umgebung 1,2 K kühler als die Bodenluft
const summerProfile = mixedLayer({ zSurf: 400, tSurfEnv: 23.8, top: 1900, invK: 1, lapseAbove: 0.005 });

test('Ruhiger Thermiktag mit Deckel: gut nutzbar, glatt, kein No-Go', () => {
  const h = evaluateHour(
    TEST_SPOT,
    syntheticHour({ t2m: 25, td2m: 11, envT: summerProfile, wind: westWind(() => 2), swRad: 650 }),
    pilot,
  );
  assert.equal(h.noGo.length, 0, JSON.stringify(h.noGo));
  assert.ok(h.metrics.thermalTopMsl > 1800 && h.metrics.thermalTopMsl < 2100, `Top ${h.metrics.thermalTopMsl}`);
  assert.ok(h.metrics.wStar > 1.5 && h.metrics.wStar < 2.4, `w* ${h.metrics.wStar}`);
  assert.ok(h.dimensions.thermic_character.score >= 2 && h.dimensions.thermic_character.score <= 3.8);
  assert.ok(h.dimensions.wind_comfort.score <= 1.5);
  assert.ok(h.dimensions.shear_turbulence.score <= 2, `Scherung ${h.dimensions.shear_turbulence.score}`);
  assert.ok(['lively', 'xc'].includes(h.zone), h.zoneLabel);
  assert.ok(h.fit.score >= 80, `Passung ${h.fit.score}`);
  assert.ok(h.fit.goalsMet.includes('flow'));
});

test('Starker Höhenwind über guter Thermik: windig, zerrissen, No-Go', () => {
  const h = evaluateHour(
    TEST_SPOT,
    syntheticHour({
      t2m: 25,
      td2m: 11,
      envT: summerProfile,
      wind: westWind((z) => 4 + Math.max(0, z - 900) * 0.008),
    }),
    pilot,
  );
  assert.ok(h.metrics.layerMaxWindKmh > 35, `Wind oben ${h.metrics.layerMaxWindKmh}`);
  assert.ok(h.dimensions.shear_turbulence.score >= 3, `Scherung ${h.dimensions.shear_turbulence.score}`);
  assert.ok(h.dimensions.wind_comfort.score >= 4);
  assert.equal(h.zone, 'no-go');
});

test('Ostwind am Westhang: Rückenwind, No-Go', () => {
  const h = evaluateHour(
    TEST_SPOT,
    syntheticHour({ t2m: 25, td2m: 11, envT: summerProfile, wind: () => ({ speed: 4, dir: 80 }) }),
    pilot,
  );
  assert.equal(h.zone, 'no-go');
  assert.ok(h.noGo.some((r) => r.code === 'direction'));
  assert.equal(h.fit.score, 0);
});

test('Gefahrenregel des Geländes greift (Wind darüber)', () => {
  const spot = {
    ...TEST_SPOT,
    dangerRules: [{ sector: { from: 60, to: 200 }, minKmh: 5, level: 'above' as const, reason: 'Rotor bei Südwind' }],
  };
  const h = evaluateHour(
    spot,
    syntheticHour({
      t2m: 25,
      td2m: 11,
      envT: summerProfile,
      // am Start leichter Westwind, darüber Süd
      wind: (z) => (z < 1000 ? { speed: 2, dir: 250 } : { speed: 5, dir: 180 }),
    }),
    pilot,
  );
  assert.ok(h.noGo.some((r) => r.code === 'danger'), JSON.stringify(h.noGo));
});

test('Winterinversion mit Hochnebel: keine Thermik, Start in der Wolke', () => {
  const h = evaluateHour(
    TEST_SPOT,
    syntheticHour({
      t2m: 1,
      td2m: 0.8,
      // bis 1100 m feucht und kalt, darüber warm und trocken
      envT: (z) => (z < 1100 ? 1 - 0.004 * (z - 400) : 4 + 0.001 * (z - 1100)),
      spread: (z) => (z < 1100 ? 0.1 : 10),
      wind: westWind(() => 1.5),
      swRad: 120,
    }),
    pilot,
  );
  assert.ok(h.dimensions.thermic_character.score <= 0.5);
  assert.ok(h.noGo.some((r) => r.code === 'cloud'), JSON.stringify(h.noGo));
});

test('Labile, feuchte Luft: Überentwicklung erkannt', () => {
  const h = evaluateHour(
    TEST_SPOT,
    syntheticHour({
      t2m: 28,
      td2m: 18,
      envT: (z) => 26.5 - 0.0095 * (z - 400),
      spread: () => 3,
      wind: westWind(() => 2),
      cape: 1400,
    }),
    pilot,
  );
  assert.ok(h.metrics.cloudBaseMsl !== null, 'Cumulus erwartet');
  assert.ok(h.dimensions.thermic_character.score >= 4.5);
  assert.equal(h.zone, 'no-go');
});

test('Nacht und Regen sind immer No-Go', () => {
  const night = evaluateHour(TEST_SPOT, syntheticHour({ t2m: 15, td2m: 10, envT: summerProfile, wind: westWind(() => 2), isDay: false }), pilot);
  assert.ok(night.noGo.some((r) => r.code === 'night'));
  const rain = evaluateHour(
    TEST_SPOT,
    syntheticHour({ t2m: 15, td2m: 13, envT: summerProfile, wind: westWind(() => 2), precip: 1.2, weatherCode: 61 }),
    pilot,
  );
  assert.ok(rain.noGo.some((r) => r.code === 'precip'));
});

test('Soaring-Wind ohne Thermik ist lebhafte Luft, nicht ruhig', () => {
  const h = evaluateHour(
    TEST_SPOT,
    syntheticHour({
      t2m: 10,
      td2m: 2,
      envT: (z) => 10 - 0.005 * (z - 400),
      wind: westWind(() => 5),
      gust10: 6,
      swRad: 100,
    }),
    pilot,
  );
  assert.equal(h.noGo.length, 0, JSON.stringify(h.noGo));
  assert.equal(h.zone, 'lively', h.zoneLabel);
});

test('Persönliche Toleranz senkt die Passung', () => {
  const strict = structuredClone(pilot);
  strict.comfort_profile.tolerance.thermic_character.max_score_acceptable = 1;
  const input = syntheticHour({ t2m: 25, td2m: 11, envT: summerProfile, wind: westWind(() => 2), swRad: 650 });
  const normal = evaluateHour(TEST_SPOT, input, pilot);
  const careful = evaluateHour(TEST_SPOT, input, strict);
  assert.ok(careful.fit.score < normal.fit.score - 30, `${careful.fit.score} vs ${normal.fit.score}`);
  assert.ok(careful.fit.exceed.thermic_character !== undefined);
});

test('Höhenwind von hinten bei ruhigem Start wird als Lee erkannt', () => {
  const h = evaluateHour(
    TEST_SPOT,
    syntheticHour({
      t2m: 20,
      td2m: 8,
      envT: summerProfile,
      // am Start fast windstill, ab 1100 m Ostwind 5 m/s
      wind: (z) => (z < 1050 ? { speed: 0.5, dir: 250 } : { speed: 5, dir: 80 }),
    }),
    pilot,
  );
  assert.ok(h.noGo.some((r) => r.code === 'lee'), JSON.stringify(h.noGo));
});

test('Start im Wald: schon schwacher Seitenwind ist No-Go, am freien Hang nur ein Hinweis', () => {
  // 6 km/h aus Süd am Westhang: Seitenwind
  const input = syntheticHour({ t2m: 25, td2m: 11, envT: summerProfile, wind: () => ({ speed: 1.7, dir: 180 }), swRad: 650 });
  const open = evaluateHour(TEST_SPOT, input, pilot);
  assert.ok(!open.noGo.some((r) => r.code === 'direction'), JSON.stringify(open.noGo));
  assert.ok(open.warnings.some((w) => w.includes('schwacher Wind')));
  const lane = evaluateHour({ ...TEST_SPOT, needsHeadwind: true }, input, pilot);
  assert.ok(lane.noGo.some((r) => r.code === 'direction'), JSON.stringify(lane.noGo));
});

test('Start im Wald bei Windstille: Hinweis auf fehlenden Gegenwind', () => {
  const input = syntheticHour({ t2m: 25, td2m: 11, envT: summerProfile, wind: westWind(() => 0.5), swRad: 650 });
  const lane = evaluateHour({ ...TEST_SPOT, needsHeadwind: true }, input, pilot);
  assert.ok(lane.warnings.some((w) => w.includes('klaren Gegenwind')), JSON.stringify(lane.warnings));
  const open = evaluateHour(TEST_SPOT, input, pilot);
  assert.ok(!open.warnings.some((w) => w.includes('klaren Gegenwind')));
});

test('Thermik über der Luftraumgrenze gibt einen Hinweis', () => {
  const input = syntheticHour({ t2m: 25, td2m: 11, envT: summerProfile, wind: westWind(() => 2), swRad: 650 });
  const spot = { ...TEST_SPOT, airspace: { floorMsl: 1676, note: 'Luftraum D ab 1676 m' } };
  const h = evaluateHour(spot, input, pilot);
  assert.ok(h.metrics.thermalTopMsl > 1676);
  assert.ok(h.warnings.some((w) => w.includes('Luftraum D ab 1676 m')), JSON.stringify(h.warnings));
  const low = evaluateHour({ ...spot, airspace: { floorMsl: 3000, note: 'Luftraum D ab 3000 m' } }, input, pilot);
  assert.ok(!low.warnings.some((w) => w.includes('Luftraum')));
});

test('Schwacher, aber direkter Rückenwind ist No-Go', () => {
  // 6 km/h aus Ost am Westhang: unter der allgemeinen Richtungsgrenze von 8 km/h, aber genau von hinten
  const input = syntheticHour({ t2m: 25, td2m: 11, envT: summerProfile, wind: (z) => ({ speed: z < 1100 ? 1.7 : 1, dir: 75 }), swRad: 650 });
  const h = evaluateHour(TEST_SPOT, input, pilot);
  assert.ok(h.noGo.some((r) => r.code === 'direction' && r.text.startsWith('Rückenwind')), JSON.stringify(h.noGo));
});

test('Flugzeiten laut Auflage: vor 2 h nach Sonnenaufgang und nach 1 h vor Sonnenuntergang No-Go', () => {
  const spot = { ...TEST_SPOT, operatingHours: { afterSunriseH: 2, beforeSunsetH: 1 } };
  const at = (time: string) => ({ ...syntheticHour({ t2m: 12, td2m: 2, envT: summerProfile, wind: westWind(() => 2), swRad: 300 }), time });
  // 25.11.: Sonnenaufgang ca. 07:50, Sonnenuntergang ca. 16:40
  assert.ok(evaluateHour(spot, at('2026-11-25T09:00'), pilot).noGo.some((r) => r.code === 'hours'));
  assert.ok(!evaluateHour(spot, at('2026-11-25T10:00'), pilot).noGo.some((r) => r.code === 'hours'));
  assert.ok(!evaluateHour(spot, at('2026-11-25T15:00'), pilot).noGo.some((r) => r.code === 'hours'));
  assert.ok(evaluateHour(spot, at('2026-11-25T16:00'), pilot).noGo.some((r) => r.code === 'hours'));
  // ohne Auflage keine Einschränkung
  assert.ok(!evaluateHour(TEST_SPOT, at('2026-11-25T09:00'), pilot).noGo.some((r) => r.code === 'hours'));
});

test('Neues Pilotenprofil ändert nur Passung und Fenster, nicht die Wetterbewertung', async () => {
  const { evaluateForecast, rescoreForPilot } = await import('../src/engine.ts');
  const input = syntheticHour({ t2m: 25, td2m: 11, envT: summerProfile, wind: westWind(() => 2), swRad: 650 });
  const fc = { source: 'test', model: 'test', fetchedAt: '2026-07-12T08:00:00Z', modelElevation: 400, hours: [input] };
  const ev = evaluateForecast(TEST_SPOT, fc, pilot);
  const strict = structuredClone(pilot);
  strict.comfort_profile.tolerance.thermic_character.max_score_acceptable = 1;
  const re = rescoreForPilot(ev, strict);
  assert.equal(re.hours[0].zone, ev.hours[0].zone);
  assert.deepEqual(re.hours[0].dimensions, ev.hours[0].dimensions);
  assert.ok(re.hours[0].fit.score < ev.hours[0].fit.score, `${re.hours[0].fit.score} < ${ev.hours[0].fit.score}`);
  assert.ok(re.hours[0].fit.notes.some((n) => n.includes('Thermik')));
});
