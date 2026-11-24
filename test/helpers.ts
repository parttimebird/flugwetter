// Hilfsfunktionen für Tests: künstliche Profile, mit denen sich typische Lagen gezielt nachbauen lassen.

import type { HourInput, PilotProfile, Spot, ThermoLevel, WindLevel } from '../src/types.ts';
import { toUV } from '../src/physics.ts';
import { readFileSync } from 'node:fs';

export const TEST_SPOT: Spot = {
  id: 'test',
  name: 'Testhang West',
  site: { id: 'test', name: 'Testgelände', region: 'Test', club: 'Testverein', dhvItem: 0, lat: 48.5, lon: 8.2 },
  lat: 48.5,
  lon: 8.2,
  elevation: 930,
  facing: 250,
  windSector: { from: 205, to: 290 },
  maxWindKmh: 25,
  dangerRules: [],
  notes: [],
  sources: [],
  needsReview: [],
};

export interface SyntheticDay {
  zSurf?: number;
  t2m: number;
  td2m: number;
  /** Temperatur der Umgebung über Höhe (m über NN) */
  envT: (z: number) => number;
  /** Taupunkt-Spread der Umgebung (K), Standard 8 */
  spread?: (z: number) => number;
  /** Wind (m/s) und Richtung über Höhe */
  wind: (z: number) => { speed: number; dir: number };
  swRad?: number;
  isDay?: boolean;
  gust10?: number;
  precip?: number;
  weatherCode?: number;
  cape?: number;
  visibility?: number;
}

export function syntheticHour(d: SyntheticDay): HourInput {
  const zSurf = d.zSurf ?? 400;
  const pAt = (z: number) => 1013.25 * Math.exp(-z / 8400);
  const thermo: ThermoLevel[] = [{ z: zSurf + 2, t: d.t2m, td: d.td2m, p: pAt(zSurf) }];
  for (let z = zSurf + 100; z <= 6000; z += 100) {
    const t = d.envT(z);
    thermo.push({ z, t, td: t - (d.spread ? d.spread(z) : 8), p: pAt(z) });
  }
  const wind: WindLevel[] = [];
  for (let z = zSurf + 10; z <= 6000; z += 100) {
    const w = d.wind(z);
    wind.push({ z, ...toUV(w.speed, w.dir) });
  }
  const w10 = d.wind(zSurf + 10);
  return {
    time: '2026-07-12T13:00',
    isDay: d.isDay ?? true,
    surface: {
      z: zSurf,
      t2m: d.t2m,
      td2m: d.td2m,
      pSurf: pAt(zSurf),
      ws10: w10.speed,
      wd10: w10.dir,
      gust10: d.gust10 ?? w10.speed * 1.4,
      precip: d.precip ?? 0,
      precipProb: null,
      weatherCode: d.weatherCode ?? 1,
      cloudCover: 20,
      cloudLow: 10,
      cloudMid: 0,
      cloudHigh: 0,
      visibility: d.visibility ?? 40000,
      cape: d.cape ?? 0,
      swRad: d.swRad ?? 800,
      freezingLevel: 3500,
    },
    thermo,
    wind,
  };
}

/** Mischungsschicht mit trockenadiabatischem Gradient bis `top`, darüber Inversion und stabile Schichtung */
export function mixedLayer(opts: { zSurf: number; tSurfEnv: number; top: number; invK: number; lapseAbove: number }) {
  return (z: number): number => {
    const tTop = opts.tSurfEnv - 0.0098 * (opts.top - opts.zSurf);
    if (z <= opts.top) return opts.tSurfEnv - 0.0098 * (z - opts.zSurf);
    if (z <= opts.top + 200) return tTop + (opts.invK * (z - opts.top)) / 200;
    return tTop + opts.invK - opts.lapseAbove * (z - opts.top - 200);
  };
}

export function loadPilot(): PilotProfile {
  return JSON.parse(readFileSync(new URL('../config/pilot-standard.json', import.meta.url), 'utf8')) as PilotProfile;
}

export const westWind = (speedAt: (z: number) => number) => (z: number) => ({ speed: speedAt(z), dir: 260 });
