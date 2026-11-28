// Einstiegspunkt der Engine: Vorhersage plus Startplatz plus Pilotenprofil ergibt Bewertungen pro Stunde und Tag.

import type { ForecastData, HourEvaluation, HourInput, PilotProfile, Spot, SpotEvaluation } from './types.ts';
import { DEFAULT_CONFIG, type EngineConfig } from './config.ts';
import { checkRules, classifyZone, computeMetrics, scoreDimensions, soaringMode, windHints } from './evaluate.ts';
import { personalFit } from './profile.ts';
import { summarizeDays } from './windows.ts';
import { compass } from './physics.ts';
import { alt100 } from './format.ts';

export function evaluateHour(spot: Spot, hour: HourInput, pilot: PilotProfile, cfg: EngineConfig = DEFAULT_CONFIG): HourEvaluation {
  const metrics = computeMetrics(spot, hour, cfg);
  const dimensions = scoreDimensions(spot, hour, metrics, cfg);
  const { noGo, warnings } = checkRules(spot, hour, metrics, cfg);
  const { zone, label } = classifyZone(dimensions, noGo, cfg);
  metrics.soaringMode = zone === 'no-go' ? null : soaringMode(metrics, dimensions, cfg);
  const fit = personalFit(dimensions, zone, noGo, pilot, metrics);
  const hints = zone === 'no-go' ? [] : windHints(metrics, dimensions, spot);
  return { time: hour.time, isDay: hour.isDay, metrics, dimensions, noGo, warnings, hints, zone, zoneLabel: label, fit, summary: summarize(spot, metrics, dimensions, noGo, label) };
}

function summarize(
  spot: Spot,
  m: HourEvaluation['metrics'],
  d: HourEvaluation['dimensions'],
  noGo: HourEvaluation['noGo'],
  label: string,
): string {
  if (noGo.length > 0) return `${label}: ${noGo.map((r) => r.text).join('; ')}`;
  const parts: string[] = [];
  parts.push(`Thermik ${d.thermic_character.label}`);
  if (m.wStar > 0) parts.push(`Steigen ca. ${m.climbEstimate} m/s`);
  if (m.cloudBaseMsl !== null) parts.push(`Basis ${alt100(m.cloudBaseMsl)}`);
  else if (m.workingHeight > 0) parts.push(`Thermik bis ${alt100(m.thermalTopMsl)}`);
  parts.push(`Grundwind ${Math.round(m.takeoffWindKmh)} km/h aus ${compass(m.takeoffWindDir)}, Böen ${Math.round(m.gustKmh)} km/h`);
  parts.push(d.shear_turbulence.label);
  return `${label}: ${parts.join(', ')}`;
}

export function evaluateForecast(
  spot: Spot,
  forecast: ForecastData,
  pilot: PilotProfile,
  cfg: EngineConfig = DEFAULT_CONFIG,
): SpotEvaluation {
  const hours = forecast.hours.map((h) => evaluateHour(spot, h, pilot, cfg));
  return {
    spot,
    source: forecast.source,
    model: forecast.model,
    fetchedAt: forecast.fetchedAt,
    modelElevation: forecast.modelElevation,
    hours,
    days: summarizeDays(hours, cfg),
  };
}

/**
 * Passung und Tagesfenster für ein anderes Pilotenprofil neu berechnen.
 * Die Wetterbewertung (Kennwerte, Dimensionen, No-Go, Zone) hängt nicht vom Profil ab und bleibt, wie sie ist.
 */
export function rescoreForPilot(ev: SpotEvaluation, pilot: PilotProfile, cfg: EngineConfig = DEFAULT_CONFIG): SpotEvaluation {
  const hours = ev.hours.map((h) => ({ ...h, fit: personalFit(h.dimensions, h.zone, h.noGo, pilot, h.metrics) }));
  return { ...ev, hours, days: summarizeDays(hours, cfg) };
}
