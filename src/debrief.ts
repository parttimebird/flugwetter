// Debriefing (erste, einfache Fassung des Flugtagebuchs): Nach dem Flug beantwortest du ein paar kurze Fragen. Die App
// legt die Vorhersage dieser Stunde an diesem Startplatz daneben und schlägt vor, deine Zonen eine Viertelstufe
// vorsichtiger oder mutiger zu stellen. Übernommen wird ein Vorschlag nur, wenn du ihn bestätigst.

import type { DimensionKey, EnvelopeLimits, HourEvaluation, PersonalZone } from './types.ts';
import { dimensionZone } from './profile.ts';

export type Compare = 'less' | 'as' | 'more';

export interface DebriefAnswers {
  /** Start: leicht, okay, schwierig */
  launch?: 'easy' | 'ok' | 'hard';
  /** Wind im Vergleich zur Vorhersage */
  wind?: Compare;
  /** Turbulenz im Vergleich zur Vorhersage */
  turbulence?: Compare;
  /** Thermik im Vergleich zur Vorhersage */
  thermal?: Compare;
  /** Basis bzw. Arbeitshöhe erreicht? */
  base?: 'yes' | 'no';
  /** Abschattung durch hohe Wolken */
  shading?: 'none' | 'some' | 'much';
  /** Würdest du so wieder fliegen? */
  again?: 'yes' | 'maybe' | 'no';
  /** Gefühl im Flug, 0 (gar nicht wohl) bis 4 (rundum wohl) */
  feeling?: number;
}

/** Was die App für diese Stunde vorhergesagt hatte (gespeichert, weil die Vorhersage später nicht mehr da ist) */
export interface ForecastSnapshot {
  zoneLabel: string;
  personalZone: PersonalZone;
  fit: number;
  dims: Record<DimensionKey, number>;
  /** persönliche Zone je Dimension, mit den Grenzen zum Zeitpunkt des Eintrags */
  dimZones: Record<DimensionKey, PersonalZone>;
  windKmh: number;
  gustKmh: number;
  climb: number;
}

export interface Suggestion {
  dim: DimensionKey;
  /** +0,25 = mutiger, −0,25 = vorsichtiger */
  delta: number;
  text: string;
  status: 'open' | 'applied' | 'dismissed';
}

export interface DebriefEntry {
  id: string;
  createdAt: string;
  spotId: string;
  /** Flugtag JJJJ-MM-TT und Startstunde */
  date: string;
  hour: number;
  answers: DebriefAnswers;
  note?: string;
  forecast?: ForecastSnapshot;
  suggestions: Suggestion[];
}

export const FEELINGS = ['😣', '😟', '😐', '🙂', '😄'];

const DIM_WORD: Record<DimensionKey, string> = {
  wind_comfort: 'Wind',
  thermic_character: 'Thermik',
  shear_turbulence: 'Turbulenz',
  structure_cap: 'Überhöhung',
};

const ZONE_WORD: Record<PersonalZone, string> = {
  green: 'Komfort',
  yellow: 'Progress',
  orange: 'Challenge',
  red: 'Überforderung',
  'no-go': 'No-Go',
};

export function snapshotOf(h: HourEvaluation, envelope: Record<DimensionKey, EnvelopeLimits>): ForecastSnapshot {
  const keys = Object.keys(h.dimensions) as DimensionKey[];
  const dims = {} as Record<DimensionKey, number>;
  const dimZones = {} as Record<DimensionKey, PersonalZone>;
  for (const k of keys) {
    dims[k] = h.dimensions[k].score;
    dimZones[k] = envelope[k] ? dimensionZone(h.dimensions[k].score, envelope[k]) : 'green';
  }
  return {
    zoneLabel: h.zoneLabel,
    personalZone: h.fit.personalZone,
    fit: h.fit.score,
    dims,
    dimZones,
    windKmh: Math.round(h.metrics.takeoffWindKmh),
    gustKmh: Math.round(h.metrics.gustKmh),
    climb: h.metrics.climbEstimate,
  };
}

/**
 * Vorschläge aus einem Eintrag. Regeln (Startwerte, bewusst vorsichtig):
 * - unwohl (Gefühl 0–1) und es war ruppiger, windiger oder thermisch stärker als vorhergesagt: diese Dimension eine
 *   Viertelstufe vorsichtiger, wenn die Vorhersage sie für dich höchstens als Progress sah (sonst lag es nicht an den Grenzen)
 * - wohl (Gefühl 3–4), es war wie vorhergesagt oder ruhiger, und die Vorhersage lag für dich in Progress oder Challenge:
 *   eine Viertelstufe mutiger, die Stunde war offenbar Komfort
 * - schwieriger Start bei mehr Wind als vorhergesagt: Wind vorsichtiger
 * Ohne gespeicherte Vorhersage gibt es keine Vorschläge, nur den Eintrag.
 */
export function suggestFromEntry(e: Pick<DebriefEntry, 'answers' | 'forecast'>): Suggestion[] {
  const f = e.forecast;
  const a = e.answers;
  if (!f || a.feeling === undefined) return [];
  const out: Suggestion[] = [];
  const bad = a.feeling <= 1 || a.again === 'no';
  const good = a.feeling >= 3 && a.again !== 'no';
  const rules: [DimensionKey, Compare | undefined][] = [
    ['shear_turbulence', a.turbulence],
    ['wind_comfort', a.wind],
    ['thermic_character', a.thermal],
  ];
  for (const [dim, cmp] of rules) {
    const z = f.dimZones[dim];
    const word = DIM_WORD[dim];
    if (bad && cmp === 'more' && (z === 'green' || z === 'yellow')) {
      out.push({ dim, delta: -0.25, status: 'open', text: `${word} war stärker als vorhergesagt und du hast dich nicht wohl gefühlt. Die Vorhersage sah sie bei dir als ${ZONE_WORD[z]}. Vorschlag: ${word}-Grenzen eine Viertelstufe vorsichtiger.` });
    } else if (good && cmp !== undefined && cmp !== 'more' && (z === 'yellow' || z === 'orange')) {
      out.push({ dim, delta: 0.25, status: 'open', text: `${word} lag laut Vorhersage für dich in ${ZONE_WORD[z]}, du hast dich wohl gefühlt und es war wie erwartet oder ruhiger. Vorschlag: ${word}-Grenzen eine Viertelstufe mutiger.` });
    }
  }
  if (a.launch === 'hard' && a.wind === 'more' && !out.some((s) => s.dim === 'wind_comfort')) {
    out.push({ dim: 'wind_comfort', delta: -0.25, status: 'open', text: 'Der Start war schwierig und der Wind stärker als vorhergesagt. Vorschlag: Wind-Grenzen eine Viertelstufe vorsichtiger.' });
  }
  return out;
}

/** Vorschlag auf die Zonen anwenden: alle drei Grenzen der Dimension verschieben, Reihenfolge bleibt, Skala 0 bis 5 */
export function applySuggestion(envelope: Record<DimensionKey, EnvelopeLimits>, s: Pick<Suggestion, 'dim' | 'delta'>): void {
  const l = envelope[s.dim];
  const clamp = (v: number) => Math.min(5, Math.max(0, Math.round(v * 4) / 4));
  l.comfort = clamp(l.comfort + s.delta);
  l.progress = Math.max(l.comfort, clamp(l.progress + s.delta));
  l.challenge = Math.max(l.progress, clamp(l.challenge + s.delta));
}

/**
 * Was deine Debriefings an einem Startplatz zeigen, z. B. „Wind 2× stärker als vorhergesagt“. Nur Auffälligkeiten, die
 * mindestens zweimal vorkamen und häufiger sind als das Gegenteil.
 */
export function spotPattern(entries: DebriefEntry[], spotId: string): string[] {
  const here = entries.filter((e) => e.spotId === spotId);
  if (here.length === 0) return [];
  const out: string[] = [];
  const keys: ['wind' | 'turbulence' | 'thermal', string][] = [
    ['wind', 'Wind'],
    ['turbulence', 'Turbulenz'],
    ['thermal', 'Thermik'],
  ];
  for (const [k, word] of keys) {
    const more = here.filter((e) => e.answers[k] === 'more').length;
    const less = here.filter((e) => e.answers[k] === 'less').length;
    if (more >= 2 && more > less) out.push(`${word} ${more}× stärker als vorhergesagt`);
    else if (less >= 2 && less > more) out.push(`${word} ${less}× schwächer als vorhergesagt`);
  }
  const hardStarts = here.filter((e) => e.answers.launch === 'hard').length;
  if (hardStarts >= 2) out.push(`${hardStarts}× schwieriger Start`);
  return out;
}
