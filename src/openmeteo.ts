// Datenquelle Open-Meteo: baut die Abfrage und übersetzt die Antwort in das neutrale Format der Engine.
// Weitere Quellen (Windy, Meteoblue, Stationen) bekommen später ein eigenes Modul mit derselben Ausgabe.

import type { ForecastData, HourInput, ThermoLevel, WindLevel, Spot } from './types.ts';
import { dewPointFromRh, toUV } from './physics.ts';

export const PRESSURE_LEVELS = [1000, 975, 950, 925, 900, 850, 800, 700, 600, 500];
const AGL_WIND_HEIGHTS = [80, 120, 180];

const SURFACE_VARS = [
  'temperature_2m',
  'dew_point_2m',
  'relative_humidity_2m',
  'surface_pressure',
  'precipitation',
  'rain',
  'showers',
  'precipitation_probability',
  'weather_code',
  'cloud_cover',
  'cloud_cover_low',
  'cloud_cover_mid',
  'cloud_cover_high',
  'visibility',
  'wind_speed_10m',
  'wind_direction_10m',
  'wind_gusts_10m',
  ...AGL_WIND_HEIGHTS.flatMap((h) => [`wind_speed_${h}m`, `wind_direction_${h}m`, `temperature_${h}m`]),
  'cape',
  'convective_inhibition',
  'freezing_level_height',
  'shortwave_radiation',
  'sunshine_duration',
  'is_day',
];

const LEVEL_VARS = ['temperature', 'relative_humidity', 'wind_speed', 'wind_direction', 'geopotential_height'];

export interface OpenMeteoOptions {
  model?: string;
  forecastDays?: number;
  timezone?: string;
}

const levelVars = (levels: number[]) => levels.flatMap((l) => LEVEL_VARS.map((v) => `${v}_${l}hPa`));

/**
 * Die Abfrage in drei Teilen: Bodenwerte, untere und obere Druckflächen.
 * Große Einzelabfragen brechen bei Open-Meteo öfter mit einer Zeitüberschreitung ab, kleine laufen durch.
 */
export const VARIABLE_CHUNKS: string[][] = [SURFACE_VARS, levelVars(PRESSURE_LEVELS.slice(0, 5)), levelVars(PRESSURE_LEVELS.slice(5))];

export function buildUrl(
  spot: Pick<Spot, 'lat' | 'lon'>,
  opts: OpenMeteoOptions = {},
  hourly: string[] = VARIABLE_CHUNKS.flat(),
): string {
  const params = new URLSearchParams({
    latitude: String(spot.lat),
    longitude: String(spot.lon),
    // Keine Höhen-Korrektur: die Bodenwerte gelten für das Modellgelände, passend zu den Druckflächen.
    elevation: 'nan',
    models: opts.model ?? 'icon_seamless',
    timezone: opts.timezone ?? 'Europe/Berlin',
    forecast_days: String(opts.forecastDays ?? 5),
    wind_speed_unit: 'ms',
    hourly: hourly.join(','),
  });
  return `https://api.open-meteo.com/v1/forecast?${params.toString()}`;
}

type Hourly = Record<string, (number | null)[]> & { time: string[] };

export interface OpenMeteoResponse {
  latitude: number;
  longitude: number;
  elevation: number;
  hourly: Hourly;
  error?: boolean;
  reason?: string;
}

function num(h: Hourly, key: string, i: number): number | null {
  const arr = h[key];
  if (!arr) return null;
  const v = arr[i];
  return v === null || v === undefined || Number.isNaN(v) ? null : v;
}

function req(h: Hourly, key: string, i: number, fallback = 0): number {
  return num(h, key, i) ?? fallback;
}

function dropDuplicateHeights<T extends { z: number }>(levels: T[], minGap = 5): T[] {
  return levels.filter((l, i) => i === 0 || l.z - levels[i - 1].z >= minGap);
}

export function parseResponse(json: OpenMeteoResponse, meta: { model?: string; fetchedAt?: string } = {}): ForecastData {
  if (json.error) throw new Error(`Open-Meteo: ${json.reason ?? 'unbekannter Fehler'}`);
  const h = json.hourly;
  const zSurf = json.elevation;
  const hours: HourInput[] = [];

  for (let i = 0; i < h.time.length; i++) {
    const t2m = req(h, 'temperature_2m', i);
    const rh2m = num(h, 'relative_humidity_2m', i);
    // Taupunkt kann durch Rundung minimal über der Temperatur liegen (rel. Feuchte 100 %)
    const td2m = Math.min(t2m, num(h, 'dew_point_2m', i) ?? (rh2m !== null ? dewPointFromRh(t2m, rh2m) : t2m - 5));
    const pSurf = req(h, 'surface_pressure', i, 1013.25 * Math.exp(-zSurf / 8400));

    // Thermodynamisches Profil: Boden (2 m) plus alle Druckflächen oberhalb des Modellgeländes
    const thermo: ThermoLevel[] = [{ z: zSurf + 2, t: t2m, td: td2m, p: pSurf }];
    // Windprofil: 10 m, 80/120/180 m über Grund, dann Druckflächen
    const ws10 = req(h, 'wind_speed_10m', i);
    const wd10 = req(h, 'wind_direction_10m', i);
    const wind: WindLevel[] = [{ z: zSurf + 10, ...toUV(ws10, wd10) }];
    for (const agl of AGL_WIND_HEIGHTS) {
      const ws = num(h, `wind_speed_${agl}m`, i);
      const wd = num(h, `wind_direction_${agl}m`, i);
      if (ws !== null && wd !== null) wind.push({ z: zSurf + agl, ...toUV(ws, wd) });
      // Temperatur über Grund verbessert das Profil in der bodennahen Schicht (Thermikauslösung)
      const ta = num(h, `temperature_${agl}m`, i);
      if (ta !== null) {
        thermo.push({ z: zSurf + agl, t: ta, td: Math.min(ta, td2m - 0.0018 * agl), p: pSurf * Math.exp(-agl / 8400) });
      }
    }

    for (const lev of PRESSURE_LEVELS) {
      const z = num(h, `geopotential_height_${lev}hPa`, i);
      if (z === null) continue;
      // Druckflächen unter oder knapp über dem Modellgelände sind extrapoliert und werden verworfen
      const t = num(h, `temperature_${lev}hPa`, i);
      const rh = num(h, `relative_humidity_${lev}hPa`, i);
      if (t !== null && z > zSurf + 30 && lev < pSurf) {
        thermo.push({ z, t, td: rh !== null ? dewPointFromRh(t, rh) : t - 10, p: lev });
      }
      const ws = num(h, `wind_speed_${lev}hPa`, i);
      const wd = num(h, `wind_direction_${lev}hPa`, i);
      if (ws !== null && wd !== null && z > zSurf + 190) {
        wind.push({ z, ...toUV(ws, wd) });
      }
    }
    thermo.sort((a, b) => a.z - b.z);
    wind.sort((a, b) => a.z - b.z);
    // Liegt eine Druckfläche (fast) auf derselben Höhe wie ein Wert über Grund, bleibt nur der erste
    const thermoClean = dropDuplicateHeights(thermo);
    const windClean = dropDuplicateHeights(wind);

    hours.push({
      time: h.time[i],
      isDay: req(h, 'is_day', i) === 1,
      surface: {
        z: zSurf,
        t2m,
        td2m,
        pSurf,
        ws10,
        wd10,
        gust10: req(h, 'wind_gusts_10m', i, ws10),
        precip: req(h, 'precipitation', i),
        precipProb: num(h, 'precipitation_probability', i),
        weatherCode: req(h, 'weather_code', i),
        cloudCover: req(h, 'cloud_cover', i),
        cloudLow: req(h, 'cloud_cover_low', i),
        cloudMid: req(h, 'cloud_cover_mid', i),
        cloudHigh: req(h, 'cloud_cover_high', i),
        visibility: req(h, 'visibility', i, 50000),
        cape: req(h, 'cape', i),
        swRad: req(h, 'shortwave_radiation', i),
        freezingLevel: num(h, 'freezing_level_height', i),
      },
      thermo: thermoClean,
      wind: windClean,
    });
  }

  return {
    source: 'open-meteo',
    model: meta.model ?? 'icon_seamless',
    fetchedAt: meta.fetchedAt ?? new Date().toISOString(),
    modelElevation: zSurf,
    hours,
  };
}

async function fetchJson(url: string, retries: number): Promise<OpenMeteoResponse> {
  let lastError = '';
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 1500 * attempt));
    const res = await fetch(url);
    const text = await res.text();
    let json: OpenMeteoResponse;
    try {
      json = JSON.parse(text) as OpenMeteoResponse;
    } catch {
      lastError = text.slice(0, 200);
      continue;
    }
    if (json.error && /limit/i.test(json.reason ?? '')) {
      throw new Error(`Open-Meteo: Abruflimit erreicht (${json.reason})`);
    }
    if (json.error) throw new Error(`Open-Meteo: ${json.reason ?? 'unbekannter Fehler'}`);
    return json;
  }
  throw new Error(`Open-Meteo antwortet nicht mit Daten: ${lastError}`);
}

/**
 * Holt die Vorhersage direkt bei Open-Meteo (läuft im Browser und in Node), in drei Teilabfragen.
 * Open-Meteo antwortet gelegentlich mit einem Zeitüberschreitungs-Text statt JSON, deshalb Wiederholungen pro Teil.
 */
export async function fetchRaw(spot: Pick<Spot, 'lat' | 'lon'>, opts: OpenMeteoOptions = {}, retries = 3): Promise<OpenMeteoResponse> {
  let merged: OpenMeteoResponse | null = null;
  for (const chunk of VARIABLE_CHUNKS) {
    const json = await fetchJson(buildUrl(spot, opts, chunk), retries);
    if (!merged) {
      merged = json;
    } else {
      for (const [key, values] of Object.entries(json.hourly)) if (key !== 'time') merged.hourly[key] = values as (number | null)[];
    }
  }
  return merged as OpenMeteoResponse;
}

export async function fetchForecast(spot: Pick<Spot, 'lat' | 'lon'>, opts: OpenMeteoOptions = {}): Promise<ForecastData> {
  const json = await fetchRaw(spot, opts);
  return parseResponse(json, { model: opts.model, fetchedAt: new Date().toISOString() });
}
