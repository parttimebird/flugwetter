// Grundwind/Böen-Matrix und Soaring-Zuordnung (Marvins Antwort vom 28.11.2026).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gustLabel, gustLevel } from '../src/wind.ts';
import { soaringMode } from '../src/evaluate.ts';
import { goalsMet } from '../src/profile.ts';
import { DEFAULT_CONFIG } from '../src/config.ts';
import type { DimensionKey, DimensionScore, HourMetrics } from '../src/types.ts';
import { loadPilot } from './helpers.ts';

const label = (base: number, gust: number) => gustLabel(gustLevel(base, gust));

test('Matrix: Beispiele aus Marvins Tabelle', () => {
  assert.equal(label(5, 8), 'perfekt, laminar');
  assert.equal(label(5, 10), 'sehr gut');
  assert.equal(label(5, 15), 'gut');
  assert.equal(label(5, 20), 'Böen beachten');
  assert.equal(label(5, 25), 'turbulent');
  assert.equal(label(10, 15), 'perfekt, laminar');
  assert.equal(label(10, 25), 'gut');
  assert.equal(label(15, 20), 'perfekt, laminar');
  assert.equal(label(15, 35), 'deutlich turbulent, kritisch prüfen');
  assert.equal(label(20, 25), 'perfekt, laminar');
  assert.equal(label(20, 30), 'sehr gut');
  assert.equal(label(25, 35), 'gut');
  assert.equal(label(30, 35), 'sehr gut');
  assert.match(label(5, 35), /No-Go/);
  assert.match(label(10, 40), /No-Go/);
  assert.match(label(15, 40), /No-Go/);
});

test('Matrix: gleicher Böenabstand ist bei schwachem Wind weniger kritisch', () => {
  assert.ok(gustLevel(5, 25) < gustLevel(15, 35));
  assert.ok(gustLevel(10, 30) < gustLevel(20, 40));
});

function dims(thermal: number, shear = 1): Record<DimensionKey, DimensionScore> {
  const mk = (key: DimensionKey, score: number): DimensionScore => ({ key, score, level: Math.round(score), sub: '', display: '', label: '', reasons: [] });
  return { wind_comfort: mk('wind_comfort', 3), thermic_character: mk('thermic_character', thermal), shear_turbulence: mk('shear_turbulence', shear), structure_cap: mk('structure_cap', 1) };
}

function soar(base: number, gust: number): HourMetrics {
  return { takeoffWindKmh: base, headwindKmh: base, crosswindKmh: 0, gustKmh: gust, takeoffInSector: true, gustLevel: gustLevel(base, gust) } as HourMetrics;
}

test('Soaring: Chill bei 15–20 km/h laminar ohne Thermik, Flow stärker, Push sehr kräftig oder thermisch', () => {
  assert.equal(soaringMode(soar(17, 20), dims(0.5), DEFAULT_CONFIG), 'chill');
  assert.equal(soaringMode(soar(21, 28), dims(0.5), DEFAULT_CONFIG), 'progress');
  assert.equal(soaringMode(soar(25, 30), dims(0.5), DEFAULT_CONFIG), 'xc');
  assert.equal(soaringMode(soar(17, 22), dims(2.5), DEFAULT_CONFIG), 'xc');
  assert.equal(soaringMode(soar(10, 14), dims(0.5), DEFAULT_CONFIG), null);
  // zu böig ist kein Soaring
  assert.equal(soaringMode(soar(15, 32), dims(0.5), DEFAULT_CONFIG), null);
});

test('Soaring-Stunden erfüllen ihren Modus auch ohne Thermik', () => {
  const pilot = loadPilot();
  const m = { ...soar(17, 20), soaringMode: 'chill' } as HourMetrics;
  assert.deepEqual(goalsMet(dims(0.3), pilot, m), ['chill', 'progress', 'xc']);
  const flow = { ...soar(21, 28), soaringMode: 'progress' } as HourMetrics;
  assert.ok(!goalsMet(dims(0.3), pilot, flow).includes('chill') || pilot.comfort_profile.min_required_scores_for_goal.chill.thermic_character_min === undefined);
});
