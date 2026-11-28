// Meteorologische Grundfunktionen: Feuchte, Luftpaket-Aufstieg, Profil-Interpolation, Windvektoren.

import type { ThermoLevel, WindLevel, Sector } from './types.ts';

export const G = 9.81;
export const DRY_LAPSE = 0.0098; // K/m
const LCL_DEW_LAPSE = 0.0018; // K/m, Taupunkt eines Luftpakets beim trockenen Aufstieg
const RD = 287.04;
const CP = 1005;
const LV = 2.501e6;
const EPS = 0.622;

/** Sättigungsdampfdruck (hPa), Magnus-Formel */
export function satVaporPressure(tC: number): number {
  return 6.112 * Math.exp((17.62 * tC) / (243.12 + tC));
}

/** Taupunkt aus Temperatur und relativer Feuchte */
export function dewPointFromRh(tC: number, rh: number): number {
  const r = Math.min(Math.max(rh, 1), 100);
  const gamma = Math.log(r / 100) + (17.62 * tC) / (243.12 + tC);
  return (243.12 * gamma) / (17.62 - gamma);
}

/** Relative Feuchte aus Temperatur und Taupunkt */
export function rhFromDewPoint(tC: number, tdC: number): number {
  return Math.min(100, (100 * satVaporPressure(tdC)) / satVaporPressure(tC));
}

/** Feuchtadiabatischer Temperaturgradient (K/m) */
export function moistLapseRate(tC: number, pHpa: number): number {
  const tK = tC + 273.15;
  const es = satVaporPressure(tC);
  const rs = (EPS * es) / Math.max(pHpa - es, 1);
  const num = G * (1 + (LV * rs) / (RD * tK));
  const den = CP + (LV * LV * rs * EPS) / (RD * tK * tK);
  return num / den;
}

/** Höhe des Kondensationsniveaus über dem Startpunkt (Espy/Henning: ca. 125 m pro Kelvin Spread) */
export function lclHeightAboveStart(tC: number, tdC: number): number {
  return Math.max(0, (tC - tdC) / (DRY_LAPSE - LCL_DEW_LAPSE));
}

/** Lineare Interpolation eines Feldes über die Höhe. Außerhalb wird der Randwert genommen. */
function interp<T extends { z: number }>(levels: T[], z: number, pick: (l: T) => number): number {
  if (levels.length === 0) return NaN;
  if (z <= levels[0].z) return pick(levels[0]);
  for (let i = 1; i < levels.length; i++) {
    const hi = levels[i];
    if (z <= hi.z) {
      const lo = levels[i - 1];
      const f = (z - lo.z) / (hi.z - lo.z);
      return pick(lo) + f * (pick(hi) - pick(lo));
    }
  }
  return pick(levels[levels.length - 1]);
}

export function envTemperature(thermo: ThermoLevel[], z: number): number {
  return interp(thermo, z, (l) => l.t);
}

export function envDewPoint(thermo: ThermoLevel[], z: number): number {
  return interp(thermo, z, (l) => l.td);
}

/** Druck in der Höhe z, logarithmisch interpoliert */
export function envPressure(thermo: ThermoLevel[], z: number): number {
  if (thermo.length === 0) return 1013.25 * Math.exp(-z / 8400);
  const lnp = interp(thermo, z, (l) => Math.log(l.p));
  // oberhalb des obersten Niveaus mit Skalenhöhe weiterrechnen
  const top = thermo[thermo.length - 1];
  if (z > top.z) return top.p * Math.exp(-(z - top.z) / 8000);
  return Math.exp(lnp);
}

export interface WindVector {
  speed: number;
  dir: number;
  u: number;
  v: number;
}

export function toUV(speed: number, dirFrom: number): { u: number; v: number } {
  const rad = (dirFrom * Math.PI) / 180;
  return { u: -speed * Math.sin(rad), v: -speed * Math.cos(rad) };
}

export function fromUV(u: number, v: number): WindVector {
  const speed = Math.hypot(u, v);
  let dir = (Math.atan2(-u, -v) * 180) / Math.PI;
  if (dir < 0) dir += 360;
  return { speed, dir: speed < 0.05 ? 0 : dir, u, v };
}

export function windAt(wind: WindLevel[], z: number): WindVector {
  const u = interp(wind, z, (l) => l.u);
  const v = interp(wind, z, (l) => l.v);
  return fromUV(u, v);
}

/** Liegt die Richtung im Sektor (im Uhrzeigersinn von from bis to)? */
export function inSector(dir: number, s: Sector): boolean {
  const d = ((dir % 360) + 360) % 360;
  const from = ((s.from % 360) + 360) % 360;
  const to = ((s.to % 360) + 360) % 360;
  return from <= to ? d >= from && d <= to : d >= from || d <= to;
}

/** kleinster Winkel zwischen zwei Richtungen (0–180) */
export function angleDiff(a: number, b: number): number {
  const d = Math.abs((((a - b) % 360) + 540) % 360 - 180);
  return d;
}

const COMPASS = ['N', 'NNO', 'NO', 'ONO', 'O', 'OSO', 'SO', 'SSO', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];

export function compass(dir: number): string {
  return COMPASS[Math.round((((dir % 360) + 360) % 360) / 22.5) % 16];
}

export interface ParcelResult {
  /** Höhe, bis zu der ein trockenes Luftpaket Auftrieb hat (m über NN) */
  dryTop: number;
  /** Kondensationsniveau (m über NN) */
  lcl: number;
  /** Cumulus-Obergrenze, falls das Paket das LCL erreicht (m über NN) */
  cloudTop: number | null;
  /** Thermik-Index (Umgebung minus Paket) pro Höhe, nur im aufsteigenden Bereich */
  ti: { z: number; ti: number }[];
}

/**
 * Hebt ein Luftpaket vom Modellboden: trockenadiabatisch bis zum Kondensationsniveau, darüber feuchtadiabatisch.
 * Liefert Thermikobergrenze, Basis und Wolkenobergrenze.
 */
export function liftParcel(thermo: ThermoLevel[], start: { z: number; t: number; td: number }, maxZ = 7000): ParcelResult {
  const step = 25;
  const lcl = start.z + lclHeightAboveStart(start.t, start.td);
  const ti: { z: number; ti: number }[] = [];
  let tp = start.t;
  let dryTop = start.z;
  let cloudTop: number | null = null;
  let buoyantSoFar = true;
  let reachedLcl = false;
  // Erste Meter: das Paket startet mit Umgebungstemperatur am Boden, deshalb ab 20 m prüfen.
  for (let z = start.z + step; z <= maxZ; z += step) {
    const p = envPressure(thermo, z);
    if (z <= lcl) {
      tp -= DRY_LAPSE * step;
    } else {
      reachedLcl = true;
      tp -= moistLapseRate(tp, p) * step;
    }
    const te = envTemperature(thermo, z);
    const diff = te - tp;
    ti.push({ z, ti: diff });
    const buoyant = diff < 0;
    if (!reachedLcl) {
      if (buoyant && buoyantSoFar) dryTop = z;
      if (!buoyant && z - start.z > 50) {
        buoyantSoFar = false;
        break;
      }
    } else {
      if (buoyant) {
        cloudTop = z;
      } else {
        break;
      }
    }
  }
  if (reachedLcl && dryTop < lcl) {
    // Paket hat das LCL mit Auftrieb erreicht
    dryTop = lcl;
  }
  return { dryTop, lcl, cloudTop: reachedLcl && cloudTop !== null ? cloudTop : null, ti };
}

/** Konvektive Geschwindigkeitsskala nach Deardorff (m/s) */
export function convectiveVelocity(sensibleHeatFlux: number, bLDepth: number, tC: number, pHpa: number): number {
  if (sensibleHeatFlux <= 0 || bLDepth <= 0) return 0;
  const rho = (pHpa * 100) / (RD * (tC + 273.15));
  const kinematic = sensibleHeatFlux / (rho * CP);
  return Math.cbrt((G / (tC + 273.15)) * kinematic * bLDepth);
}

// ---------------------------------------------------------------------------
// Sonnenauf- und -untergang (NOAA-Näherung, genau auf wenige Minuten)
// ---------------------------------------------------------------------------

/** Abstand der Zeitzone zu UTC in Stunden für einen Tag (berücksichtigt Sommerzeit) */
export function utcOffsetHours(date: string, timeZone: string): number {
  const [y, m, d] = date.split('-').map(Number);
  const noonUtc = new Date(Date.UTC(y, m - 1, d, 12));
  const hour = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', hourCycle: 'h23' }).format(noonUtc);
  return Number(hour) - 12;
}

/**
 * Sonnenaufgang und -untergang als Dezimalstunden in Ortszeit, z. B. 7.9 = 07:54 Uhr.
 * `date` im Format JJJJ-MM-TT.
 */
export function sunTimes(lat: number, lon: number, date: string, timeZone = 'Europe/Berlin'): { sunrise: number; sunset: number } {
  const [y, m, d] = date.split('-').map(Number);
  const dayOfYear = Math.round((Date.UTC(y, m - 1, d) - Date.UTC(y, 0, 0)) / 86400000);
  const g = ((2 * Math.PI) / 365) * (dayOfYear - 1);
  const eqTime =
    229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const decl =
    0.006918 -
    0.399912 * Math.cos(g) +
    0.070257 * Math.sin(g) -
    0.006758 * Math.cos(2 * g) +
    0.000907 * Math.sin(2 * g) -
    0.002697 * Math.cos(3 * g) +
    0.00148 * Math.sin(3 * g);
  const phi = (lat * Math.PI) / 180;
  const cosHa = Math.cos((90.833 * Math.PI) / 180) / (Math.cos(phi) * Math.cos(decl)) - Math.tan(phi) * Math.tan(decl);
  const ha = (Math.acos(Math.max(-1, Math.min(1, cosHa))) * 180) / Math.PI;
  const offset = utcOffsetHours(date, timeZone);
  const sunriseUtcMin = 720 - 4 * (lon + ha) - eqTime;
  const sunsetUtcMin = 720 - 4 * (lon - ha) - eqTime;
  return { sunrise: sunriseUtcMin / 60 + offset, sunset: sunsetUtcMin / 60 + offset };
}

/** Dezimalstunde als Uhrzeit, z. B. 9.92 → "09:55" */
export function clockTime(hours: number): string {
  const total = Math.round(hours * 60);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

/**
 * Sonnenstand (NOAA-Näherung, auf etwa ein Grad genau) für eine lokale Zeit `JJJJ-MM-TTTHH:MM`.
 * Azimut in Grad im Uhrzeigersinn ab Nord (Richtung, in der die Sonne steht), Höhe in Grad über dem Horizont.
 */
export function sunPosition(lat: number, lon: number, localTime: string, timeZone = 'Europe/Berlin'): { azimuth: number; elevation: number } {
  const date = localTime.slice(0, 10);
  const [y, m, d] = date.split('-').map(Number);
  const localH = Number(localTime.slice(11, 13)) + Number(localTime.slice(14, 16) || 0) / 60;
  const dayOfYear = Math.round((Date.UTC(y, m - 1, d) - Date.UTC(y, 0, 0)) / 86400000);
  const g = ((2 * Math.PI) / 365) * (dayOfYear - 1 + (localH - 12) / 24);
  const eqTime =
    229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const decl =
    0.006918 -
    0.399912 * Math.cos(g) +
    0.070257 * Math.sin(g) -
    0.006758 * Math.cos(2 * g) +
    0.000907 * Math.sin(2 * g) -
    0.002697 * Math.cos(3 * g) +
    0.00148 * Math.sin(3 * g);
  const offset = utcOffsetHours(date, timeZone);
  const trueSolarMin = (localH - offset) * 60 + eqTime + 4 * lon;
  const ha = ((trueSolarMin / 4 - 180) * Math.PI) / 180;
  const phi = (lat * Math.PI) / 180;
  const cosZen = Math.sin(phi) * Math.sin(decl) + Math.cos(phi) * Math.cos(decl) * Math.cos(ha);
  const zen = Math.acos(Math.max(-1, Math.min(1, cosZen)));
  const elevation = 90 - (zen * 180) / Math.PI;
  const az = Math.atan2(Math.sin(ha), Math.cos(ha) * Math.sin(phi) - Math.tan(decl) * Math.cos(phi));
  const azimuth = ((az * 180) / Math.PI + 180 + 360) % 360;
  return { azimuth: Math.round(azimuth), elevation: Math.round(elevation * 10) / 10 };
}
