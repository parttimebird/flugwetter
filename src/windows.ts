// Tageszusammenfassung: zusammenhängende Flugfenster und die wichtigsten Gründe für No-Go.

import type { DaySummary, DimensionKey, FlightWindow, HourEvaluation, PersonalZone, Zone } from './types.ts';
import type { EngineConfig } from './config.ts';
import { PZONE_NAMES, zoneRank } from './profile.ts';

const ZONE_ORDER: Zone[] = ['no-go', 'chill', 'progress', 'xc'];
/** Lufttyp (aus dem Wetter allein), bewusst anders benannt als die Tagesmodi Chill, Progress und XC */
const ZONE_NAMES: Record<Zone, string> = { 'no-go': 'No-Go', chill: 'ruhige Luft', progress: 'lebhafte Luft', xc: 'Streckenwetter' };

const NOGO_TEXT: Record<string, string> = {
  night: 'Nacht',
  storm: 'Gewitter',
  precip: 'Niederschlag',
  fog: 'Nebel oder schlechte Sicht',
  cloud: 'Start in Wolke/Nebel',
  lowbase: 'Basis zu tief',
  wind: 'zu viel Wind am Start',
  gust: 'starke Böen',
  direction: 'Wind aus falscher Richtung am Start',
  danger: 'gefährliche Windrichtung für dieses Gelände',
  zone: 'zu heftige Bedingungen',
  lee: 'Lee (Höhenwind von hinten)',
  hours: 'außerhalb der erlaubten Flugzeit',
};

function hourOf(time: string): number {
  return Number(time.slice(11, 13));
}

function pad(h: number): string {
  return `${String(h).padStart(2, '0')}:00`;
}

function dominantZone(hours: HourEvaluation[]): Zone {
  const counts = new Map<Zone, number>();
  for (const h of hours) counts.set(h.zone, (counts.get(h.zone) ?? 0) + 1);
  let best: Zone = hours[0].zone;
  for (const [zone, c] of counts) {
    const bc = counts.get(best) ?? 0;
    if (c > bc || (c === bc && ZONE_ORDER.indexOf(zone) > ZONE_ORDER.indexOf(best))) best = zone;
  }
  return best;
}

function makeWindow(run: HourEvaluation[]): FlightWindow {
  const keys: DimensionKey[] = ['wind_comfort', 'thermic_character', 'shear_turbulence', 'structure_cap'];
  const dims = {} as Record<DimensionKey, number>;
  for (const k of keys) {
    dims[k] = Math.round((run.reduce((a, h) => a + h.dimensions[k].score, 0) / run.length) * 10) / 10;
  }
  const personalZone = run.reduce<PersonalZone>((worst, h) => (zoneRank(h.fit.personalZone) > zoneRank(worst) ? h.fit.personalZone : worst), 'green');
  return {
    start: pad(hourOf(run[0].time)),
    end: pad(hourOf(run[run.length - 1].time) + 1),
    hours: run.length,
    zone: dominantZone(run),
    personalZone,
    fitMax: Math.max(...run.map((h) => h.fit.score)),
    fitMean: Math.round(run.reduce((a, h) => a + h.fit.score, 0) / run.length),
    dims,
  };
}

export function summarizeDays(hours: HourEvaluation[], cfg: EngineConfig): DaySummary[] {
  const byDate = new Map<string, HourEvaluation[]>();
  for (const h of hours) {
    const d = h.time.slice(0, 10);
    if (!byDate.has(d)) byDate.set(d, []);
    byDate.get(d)!.push(h);
  }
  const days: DaySummary[] = [];
  for (const [date, all] of byDate) {
    const day = all.filter((h) => h.isDay);
    const windows: FlightWindow[] = [];
    let run: HourEvaluation[] = [];
    for (const h of day) {
      const ok = h.zone !== 'no-go' && h.fit.score >= cfg.windowMinFit;
      const contiguous = run.length === 0 || hourOf(h.time) === hourOf(run[run.length - 1].time) + 1;
      if (ok && contiguous) {
        run.push(h);
      } else {
        if (run.length > 0) windows.push(makeWindow(run));
        run = ok ? [h] : [];
      }
    }
    if (run.length > 0) windows.push(makeWindow(run));

    const counts = new Map<string, number>();
    for (const h of day) {
      const codes = new Set(h.noGo.map((r) => r.code));
      if (codes.size === 0 && h.zone === 'no-go') codes.add('zone');
      for (const c of codes) counts.set(c, (counts.get(c) ?? 0) + 1);
    }
    const noGoReasons = [...counts.entries()]
      .filter(([code]) => code !== 'night')
      .sort((a, b) => b[1] - a[1])
      .map(([code, n]) => ({ reason: NOGO_TEXT[code] ?? code, hours: n }));

    const flyable = day.filter((h) => h.zone !== 'no-go');
    const bestHour =
      flyable.length === 0
        ? null
        : flyable.reduce((best, h) =>
            h.fit.score > best.fit.score ||
            (h.fit.score === best.fit.score && h.dimensions.thermic_character.score > best.dimensions.thermic_character.score)
              ? h
              : best,
          );

    let verdict: string;
    if (windows.length > 0) {
      verdict = windows
        .map((w) => `${w.start.slice(0, 2)}–${w.end.slice(0, 2)} Uhr ${PZONE_NAMES[w.personalZone]} (Passung bis ${w.fitMax})`)
        .join(', ');
    } else if (bestHour) {
      verdict = `kein Fenster für dich, beste Stunde ${bestHour.time.slice(11, 13)} Uhr: ${PZONE_NAMES[bestHour.fit.personalZone]}, ${bestHour.fit.label}`;
    } else {
      const top = noGoReasons.slice(0, 2).map((r) => r.reason);
      verdict = top.length > 0 ? `nicht fliegbar: ${top.join(', ')}` : 'nicht fliegbar';
    }
    days.push({ date, windows, bestHour, noGoReasons, verdict });
  }
  return days;
}

export { ZONE_NAMES };
