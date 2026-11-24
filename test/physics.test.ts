import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  angleDiff,
  clockTime,
  compass,
  convectiveVelocity,
  dewPointFromRh,
  fromUV,
  inSector,
  lclHeightAboveStart,
  liftParcel,
  moistLapseRate,
  sunTimes,
  rhFromDewPoint,
  toUV,
} from '../src/physics.ts';
import { curve } from '../src/config.ts';

test('Taupunkt aus relativer Feuchte (Magnus)', () => {
  assert.ok(Math.abs(dewPointFromRh(20, 50) - 9.3) < 0.2);
  assert.ok(Math.abs(dewPointFromRh(10, 100) - 10) < 0.01);
  assert.ok(Math.abs(rhFromDewPoint(20, 9.3) - 50) < 1);
});

test('Kondensationsniveau ca. 125 m pro Kelvin Spread', () => {
  assert.equal(Math.round(lclHeightAboveStart(20, 10)), 1250);
  assert.equal(lclHeightAboveStart(10, 12), 0);
});

test('Feuchtadiabate liegt zwischen 3 und 7 K pro km', () => {
  const warm = moistLapseRate(20, 1000) * 1000;
  const cold = moistLapseRate(-10, 700) * 1000;
  assert.ok(warm > 3.5 && warm < 5, `warm ${warm}`);
  assert.ok(cold > 6 && cold < 8.5, `kalt ${cold}`);
});

test('Windvektoren: Hin- und Rückrechnung', () => {
  for (const dir of [0, 45, 90, 180, 250, 359]) {
    const { u, v } = toUV(5, dir);
    const back = fromUV(u, v);
    assert.ok(Math.abs(back.speed - 5) < 1e-9);
    assert.ok(angleDiff(back.dir, dir) < 1e-6, `${dir} -> ${back.dir}`);
  }
  // Westwind weht nach Osten: u positiv
  assert.ok(toUV(5, 270).u > 4.99);
});

test('Sektoren über Nord und Himmelsrichtungen', () => {
  assert.ok(inSector(0, { from: 330, to: 120 }));
  assert.ok(inSector(100, { from: 330, to: 120 }));
  assert.ok(!inSector(200, { from: 330, to: 120 }));
  assert.ok(inSector(250, { from: 205, to: 290 }));
  assert.equal(compass(250), 'WSW');
  assert.equal(compass(90), 'O');
  assert.equal(angleDiff(350, 10), 20);
});

test('Kurven interpolieren linear und halten die Ränder', () => {
  const c: [number, number][] = [
    [0, 0],
    [10, 2],
    [20, 3],
  ];
  assert.equal(curve(c, -5), 0);
  assert.equal(curve(c, 5), 1);
  assert.equal(curve(c, 15), 2.5);
  assert.equal(curve(c, 99), 3);
});

test('Luftpaket: Blauthermik unter einer Inversion', () => {
  // Umgebung 1,5 K kälter als das Paket, trockenadiabatisch bis 1900 m, dann +1 K Inversion
  const thermo = [];
  for (let z = 400; z <= 5000; z += 50) {
    let t: number;
    if (z <= 1900) t = 23.5 - 0.0098 * (z - 400);
    else if (z <= 2100) t = 23.5 - 0.0098 * 1500 + (z - 1900) / 200;
    else t = 23.5 - 0.0098 * 1500 + 1 - 0.005 * (z - 2100);
    thermo.push({ z, t, td: t - 15, p: 1013 * Math.exp(-z / 8400) });
  }
  thermo[0] = { z: 402, t: 25, td: 8, p: 965 };
  const res = liftParcel(thermo, { z: 402, t: 25, td: 8 });
  assert.ok(res.dryTop > 1850 && res.dryTop < 2100, `Top ${res.dryTop}`);
  assert.equal(res.cloudTop, null, 'trocken, keine Wolken');
  assert.ok(res.lcl > 2400);
});

test('w* liegt für einen guten Sommertag bei 2 bis 2,5 m/s', () => {
  const w = convectiveVelocity(240, 1500, 25, 960);
  assert.ok(w > 1.9 && w < 2.5, `w* ${w}`);
  assert.equal(convectiveVelocity(0, 1500, 25, 960), 0);
});

test('Sonnenauf- und -untergang im Schwarzwald (Ortszeit, mit Sommerzeit)', () => {
  const winter = sunTimes(48.0, 8.0, '2026-11-25');
  assert.ok(Math.abs(winter.sunrise - (7 + 50 / 60)) < 0.2, clockTime(winter.sunrise));
  assert.ok(Math.abs(winter.sunset - (16 + 39 / 60)) < 0.2, clockTime(winter.sunset));
  const summer = sunTimes(48.0, 8.0, '2026-06-21');
  assert.ok(Math.abs(summer.sunrise - (5 + 26 / 60)) < 0.2, clockTime(summer.sunrise));
  assert.ok(Math.abs(summer.sunset - (21 + 30 / 60)) < 0.2, clockTime(summer.sunset));
});
