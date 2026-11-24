// Echte Open-Meteo-Antwort vom 24.11.2026 (23:34 Uhr) für alle acht Gelände.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { VARIABLE_CHUNKS, buildUrl, parseResponse } from '../src/openmeteo.ts';
import { evaluateForecast } from '../src/engine.ts';
import { SITE_LIST, SPOTS } from '../src/spots.ts';
import { loadPilot } from './helpers.ts';

const fixture = JSON.parse(readFileSync(new URL('../fixtures/openmeteo_2026-11-24T2334.json', import.meta.url), 'utf8'));

test('URL enthält Modell, Einheiten und Druckflächen', () => {
  const url = buildUrl(SPOTS[0]);
  assert.ok(url.startsWith('https://api.open-meteo.com/v1/forecast?'));
  assert.ok(url.includes('models=icon_seamless'));
  assert.ok(url.includes('wind_speed_unit=ms'));
  assert.ok(url.includes('geopotential_height_850hPa'));
  assert.ok(url.includes('elevation=nan'));
});

test('Teilabfragen decken alle Variablen genau einmal ab', () => {
  const all = VARIABLE_CHUNKS.flat();
  assert.equal(new Set(all).size, all.length);
  for (const v of ['temperature_2m', 'wind_speed_180m', 'geopotential_height_1000hPa', 'relative_humidity_500hPa']) {
    assert.ok(all.includes(v), v);
  }
  // Die gespeicherte Antwort (aus Teilabfragen zusammengesetzt) enthält jede Variable
  for (const site of SITE_LIST) {
    for (const v of all) assert.ok(v in fixture.spots[site.id].hourly, `${site.id}: ${v} fehlt`);
  }
});

test('Jeder Startplatz gehört zu einem Gelände mit Vorhersage', () => {
  assert.equal(SITE_LIST.length, 8);
  assert.equal(SPOTS.length, 13);
  assert.equal(new Set(SPOTS.map((s) => s.id)).size, SPOTS.length, 'IDs eindeutig');
  for (const spot of SPOTS) {
    assert.ok(fixture.spots[spot.site.id], `${spot.id}: keine Vorhersage für ${spot.site.id}`);
    // Startplätze eines Geländes liegen nah beieinander (gleiche Modellzelle oder Nachbarzelle)
    const dLat = (spot.lat - spot.site.lat) * 111;
    const dLon = (spot.lon - spot.site.lon) * 111 * Math.cos((spot.lat * Math.PI) / 180);
    assert.ok(Math.hypot(dLat, dLon) < 2, `${spot.id} liegt zu weit vom Geländepunkt`);
  }
});

test('Antwort wird in ein sauberes Profil übersetzt', () => {
  for (const site of SITE_LIST) {
    const fc = parseResponse(fixture.spots[site.id]);
    assert.equal(fc.hours.length, 120);
    for (const h of fc.hours) {
      assert.ok(h.thermo.length >= 6, `${site.id} ${h.time}: zu wenige Niveaus`);
      assert.ok(h.thermo[0].z >= fc.modelElevation, 'kein Niveau unter dem Modellgelände');
      for (let i = 1; i < h.thermo.length; i++) assert.ok(h.thermo[i].z > h.thermo[i - 1].z);
      for (let i = 1; i < h.wind.length; i++) assert.ok(h.wind[i].z > h.wind[i - 1].z);
      assert.ok(h.thermo.every((l) => l.td <= l.t + 0.01));
    }
  }
});

test('Fehlerantwort von Open-Meteo wird als Fehler gemeldet', () => {
  assert.throws(() => parseResponse({ error: true, reason: 'Daily API request limit exceeded.' } as never), /limit/);
});

test('Komplette Auswertung läuft für alle 13 Startplätze und liefert Tage mit Begründungen', () => {
  const pilot = loadPilot();
  for (const spot of SPOTS) {
    const ev = evaluateForecast(spot, parseResponse(fixture.spots[spot.site.id]), pilot);
    assert.equal(ev.days.length, 5);
    for (const h of ev.hours) {
      for (const d of Object.values(h.dimensions)) {
        assert.ok(d.score >= 0 && d.score <= 5, `${d.key} ${d.score}`);
        assert.ok(d.reasons.length > 0 || !h.isDay);
      }
      if (!h.isDay) assert.equal(h.zone, 'no-go');
      if (h.zone === 'no-go') assert.equal(h.fit.score, 0);
    }
    for (const day of ev.days) assert.ok(day.verdict.length > 0);
  }
});
