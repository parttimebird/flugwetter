// Character: das Pilotenprofil aus dem Onboarding (Flugstil, Schirm, Erfahrung, Technik, Sicherheitsgefühl)
// und daraus die persönlichen Zonen-Grenzen pro Dimension (buildEnvelope).
//
// Fragen und Bänder folgen Marvins Flow-Entwurf (paragliding_weather_pilot_check_v2). Die Starttabelle und die Zu- und
// Abschläge sind Startwerte zum Nachjustieren; das Flugtagebuch (Schritt 5) soll sie später pro Pilot anpassen.

import type { DimensionKey, EnvelopeLimits, Goal } from './types.ts';

export type FlightStyle = 'relaxed' | 'community' | 'scenery' | 'progress' | 'hikefly';
export type WingClass = 'A' | 'B' | 'C' | 'D';
/** Flüge pro Jahr: unter 20, 20 bis 50, über 50 */
export type Currency = 'low' | 'mid' | 'high';
export type SkillLevel = 'foundation' | 'basic' | 'solid' | 'high';
export type SafetyLevel = 'high_stress' | 'mixed' | 'stable';
export type Envelope = Record<DimensionKey, EnvelopeLimits>;

export interface CharacterAnswers {
  style: FlightStyle;
  wing: WingClass;
  currency: Currency;
  /** Selbsteinschätzung 0 bis 5 je Fähigkeit (Schlüssel aus SKILL_QUESTIONS) */
  skills: Record<string, number>;
  /** Zustimmung 0 bis 5 je Aussage (Schlüssel aus SAFETY_QUESTIONS) */
  safety: Record<string, number>;
  /** Zeitpunkt des Einlesens (ISO) */
  createdAt?: string;
}

export const STYLE_OPTIONS: { id: FlightStyle; title: string; text: string }[] = [
  { id: 'relaxed', title: 'Entspannter Genussflieger', text: 'Du magst ruhige, gut einschätzbare Bedingungen und konzentrierst dich gern auf sauberes Fliegen und Aussicht.' },
  { id: 'community', title: 'Community-Flieger', text: 'Die Zeit mit anderen Piloten, Austausch und gemeinsame Flugtage gehören für dich fest dazu.' },
  { id: 'scenery', title: 'Landschafts-Entdecker', text: 'Du suchst neue Gebiete und schöne Lichtstimmungen und fliegst gern in ruhiger bis moderater Luft.' },
  { id: 'progress', title: 'Entwicklungsorientiert', text: 'Du beschäftigst dich bewusst mit Technik, Thermik und Entscheidungen und nutzt Herausforderungen zum Lernen.' },
  { id: 'hikefly', title: 'Hike & Fly', text: 'Der Zustieg gehört dazu: Bewegung, Natur und Fliegen als Gesamtpaket.' },
];

export const WING_OPTIONS: { id: WingClass; title: string; text: string }[] = [
  { id: 'A', title: 'EN-A', text: 'Schulungs- und Genussschirm' },
  { id: 'B', title: 'EN-B', text: 'Low-B bis High-B' },
  { id: 'C', title: 'EN-C', text: 'Sport- und Streckenschirm' },
  { id: 'D', title: 'EN-D oder CCC', text: 'Hochleister' },
];

export const CURRENCY_OPTIONS: { id: Currency; title: string }[] = [
  { id: 'low', title: 'unter 20 Flüge im Jahr' },
  { id: 'mid', title: '20 bis 50 Flüge im Jahr' },
  { id: 'high', title: 'über 50 Flüge im Jahr' },
];

export const SKILL_QUESTIONS: { id: string; label: string }[] = [
  { id: 'weather', label: 'Wetter einschätzen und entscheiden, ob du fliegst' },
  { id: 'start_decision', label: 'Eine klare Startentscheidung treffen (Start oder nicht)' },
  { id: 'launch', label: 'Kontrolliert und sauber starten' },
  { id: 'glide', label: 'Ruhige Abgleiter sicher fliegen' },
  { id: 'landing', label: 'Landeeinteilung planen und sicher landen' },
  { id: 'speedbar', label: 'Aktiv beschleunigt fliegen' },
  { id: 'ears', label: 'Ohren anlegen und kontrolliert sinken' },
  { id: 'spiral', label: 'Steilspirale sicher einleiten, halten und beenden' },
  { id: 'thermal', label: 'Thermik erkennen und aktiv zentrieren' },
  { id: 'small_xc', label: 'Eigenständig erste Thermik- oder kleine Streckenentscheidungen treffen' },
];

export const SAFETY_QUESTIONS: { id: string; label: string }[] = [
  { id: 'start_calm', label: 'Ich fühle mich beim Start meistens ruhig und klar.' },
  { id: 'moving_air_calm', label: 'Auch in bewegter Luft bleibe ich innerlich weitgehend ruhig.' },
  { id: 'decision_confidence', label: 'Ich treffe Entscheidungen im Flug eher ruhig als hektisch.' },
  { id: 'weather_trust', label: 'Ich vertraue meiner Einschätzung von Wetter und Bedingungen.' },
  { id: 'turbulence_handling', label: 'Wenn es turbulenter wird, bleibe ich handlungsfähig.' },
  { id: 'self_soothing', label: 'Ich kann mich im Flug gut wieder beruhigen, wenn ich kurz unsicher werde.' },
  { id: 'general_feeling', label: 'Ich habe im Flug grundsätzlich ein Gefühl von Sicherheit.' },
  { id: 'stress_recovery', label: 'Ich kann Stress im Flug relativ schnell wieder reduzieren.' },
];

export const SKILL_BANDS: { level: SkillLevel; max: number; label: string }[] = [
  { level: 'foundation', max: 15, label: 'Grundlagenaufbau notwendig' },
  { level: 'basic', max: 30, label: 'Sichere Basis, wenig Routine' },
  { level: 'solid', max: 40, label: 'Solide Flugkompetenz' },
  { level: 'high', max: 50, label: 'Hohe technische Souveränität' },
];

export const SAFETY_BANDS: { level: SafetyLevel; max: number; label: string }[] = [
  { level: 'high_stress', max: 20, label: 'Erhöhtes Stress- und Unsicherheitsniveau im Flug' },
  { level: 'mixed', max: 30, label: 'Wechselnde Sicherheit, abhängig von der Situation' },
  { level: 'stable', max: 40, label: 'Gute innere Stabilität mit einzelnen Stressmomenten' },
];

/**
 * Starttabelle: Grenzen pro Technik-Stufe (Komfort, Progress, Challenge) auf der Engine-Skala 0 bis 5.
 * Wind: 1 = 5 km/h, 2 = 10, 3 = 15, 4 = 22 am Start (Höhenwind und Böen heben die Stufe).
 * Thermik: 1 schwach, 3 gut nutzbar, 4 kräftig. Scherung: 1 ruhig, 3 bewegt, 4 ruppig. Deckel: 3 gute Arbeitshöhe, 4 hochreichend.
 */
export const BASE_ENVELOPE: Record<SkillLevel, Record<DimensionKey, [number, number, number]>> = {
  foundation: {
    wind_comfort: [1.5, 2, 2.5],
    thermic_character: [1.5, 2, 2.5],
    shear_turbulence: [1, 1.5, 2],
    structure_cap: [3.5, 4, 4.5],
  },
  basic: {
    wind_comfort: [2, 2.5, 3],
    thermic_character: [2, 3, 3.5],
    shear_turbulence: [1.5, 2, 2.5],
    structure_cap: [4, 4.5, 4.5],
  },
  solid: {
    wind_comfort: [2.5, 3, 3.5],
    thermic_character: [2.5, 3.5, 4],
    shear_turbulence: [2, 2.5, 3],
    structure_cap: [4, 4.5, 5],
  },
  high: {
    wind_comfort: [3, 3.5, 4],
    thermic_character: [3, 4, 4.5],
    shear_turbulence: [2, 3, 3.5],
    structure_cap: [4.5, 5, 5],
  },
};

export interface CharacterResult {
  skillTotal: number;
  skillLevel: SkillLevel;
  skillLabel: string;
  safetyTotal: number;
  safetyLevel: SafetyLevel;
  safetyLabel: string;
  envelope: Envelope;
  /** wie die Grenzen zustande kommen, in Sätzen */
  adjustments: string[];
  defaultMode: Goal;
  /** XC passt laut Character (Technik ab „solide“ und kein erhöhtes Stressniveau) */
  xcAdvised: boolean;
  xcReason: string;
}

const DIMS: DimensionKey[] = ['wind_comfort', 'thermic_character', 'shear_turbulence', 'structure_cap'];

function clampScore(v: number): number {
  return Math.min(5, Math.max(0, Math.round(v * 4) / 4));
}

function sum(values: Record<string, number>, keys: { id: string }[]): number {
  return keys.reduce((a, k) => a + Math.min(5, Math.max(0, Math.round(values[k.id] ?? 0))), 0);
}

export function skillBand(total: number): { level: SkillLevel; label: string } {
  const band = SKILL_BANDS.find((b) => total <= b.max) ?? SKILL_BANDS[SKILL_BANDS.length - 1];
  return { level: band.level, label: band.label };
}

export function safetyBand(total: number): { level: SafetyLevel; label: string } {
  const band = SAFETY_BANDS.find((b) => total <= b.max) ?? SAFETY_BANDS[SAFETY_BANDS.length - 1];
  return { level: band.level, label: band.label };
}

/** Aus Technik-Stufe, Sicherheitsgefühl, Schirm und Flugpraxis die Grenzen pro Dimension. */
export function buildEnvelope(
  skillLevel: SkillLevel,
  safetyLevel: SafetyLevel,
  wing: WingClass,
  currency: Currency,
): { envelope: Envelope; adjustments: string[] } {
  const shift: Record<DimensionKey, number> = { wind_comfort: 0, thermic_character: 0, shear_turbulence: 0, structure_cap: 0 };
  const adjustments: string[] = [];

  if (safetyLevel === 'high_stress') {
    shift.wind_comfort -= 0.5;
    shift.thermic_character -= 0.5;
    shift.shear_turbulence -= 0.5;
    adjustments.push('Sicherheitsgefühl noch wackelig: Wind, Thermik und Turbulenz eine halbe Stufe vorsichtiger.');
  } else if (safetyLevel === 'mixed') {
    shift.wind_comfort -= 0.25;
    shift.shear_turbulence -= 0.25;
    adjustments.push('Sicherheitsgefühl wechselnd: Wind und Turbulenz eine Viertelstufe vorsichtiger.');
  }

  if (wing === 'A') {
    shift.wind_comfort -= 0.5;
    adjustments.push('EN-A-Schirm: weniger Geschwindigkeitsreserve, Wind eine halbe Stufe vorsichtiger.');
  } else if ((wing === 'C' || wing === 'D') && (skillLevel === 'solid' || skillLevel === 'high')) {
    const bonus = wing === 'C' ? 0.25 : 0.5;
    shift.wind_comfort += bonus;
    adjustments.push(`${wing === 'C' ? 'EN-C' : 'EN-D'}-Schirm mit solider Technik: Wind ${wing === 'C' ? 'eine Viertelstufe' : 'eine halbe Stufe'} mehr. Turbulenz bleibt, weil höhere Klassen weniger verzeihen.`);
  } else if (wing === 'C' || wing === 'D') {
    adjustments.push('Höhere Schirmklasse bei noch wenig Routine: kein Zuschlag beim Wind.');
  }

  if (currency === 'low') {
    for (const k of ['wind_comfort', 'thermic_character', 'shear_turbulence'] as DimensionKey[]) shift[k] -= 0.25;
    adjustments.push('Unter 20 Flüge im Jahr: Wind, Thermik und Turbulenz eine Viertelstufe vorsichtiger.');
  }

  // Abschläge können sich addieren. Damit die Grenzen nicht absurd eng werden (bei fast keinem Wind ist der Start eher
  // schwerer als leichter), gehen sie nie unter die vorsichtigste Zeile der Starttabelle.
  const envelope = {} as Envelope;
  let floored = false;
  for (const k of DIMS) {
    const [c, p, x] = BASE_ENVELOPE[skillLevel][k];
    const [fc, fp, fx] = BASE_ENVELOPE.foundation[k];
    const raw = [c, p, x].map((v) => clampScore(v + shift[k]));
    if (raw[0] < fc || raw[1] < fp || raw[2] < fx) floored = true;
    const comfort = Math.max(fc, raw[0]);
    const progress = Math.max(comfort, fp, raw[1]);
    const challenge = Math.max(progress, fx, raw[2]);
    envelope[k] = { comfort, progress, challenge };
  }
  if (floored) adjustments.push('Zusammen gehen die Abschläge nicht unter die vorsichtigste Zeile der Starttabelle („Grundlagenaufbau notwendig“).');
  if (adjustments.length === 0) adjustments.push('Keine Zu- oder Abschläge.');
  return { envelope, adjustments };
}

export function defaultModeFor(style: FlightStyle): Goal {
  return style === 'progress' ? 'progress' : 'chill';
}

export function scoreCharacter(a: CharacterAnswers): CharacterResult {
  const skillTotal = sum(a.skills, SKILL_QUESTIONS);
  const safetyTotal = sum(a.safety, SAFETY_QUESTIONS);
  const skill = skillBand(skillTotal);
  const safety = safetyBand(safetyTotal);
  const { envelope, adjustments } = buildEnvelope(skill.level, safety.level, a.wing, a.currency);
  const lowSkill = skill.level === 'foundation' || skill.level === 'basic';
  const stressed = safety.level === 'high_stress';
  const xcAdvised = !lowSkill && !stressed;
  const xcReason = xcAdvised
    ? ''
    : lowSkill
      ? `Dein Technik-Score liegt bei ${skillTotal} von 50, XC empfiehlt der Coach ab 31.`
      : `Dein Sicherheits-Score liegt bei ${safetyTotal} von 40, XC empfiehlt der Coach ab 21.`;
  return {
    skillTotal,
    skillLevel: skill.level,
    skillLabel: skill.label,
    safetyTotal,
    safetyLevel: safety.level,
    safetyLabel: safety.label,
    envelope,
    adjustments,
    defaultMode: defaultModeFor(a.style),
    xcAdvised,
    xcReason,
  };
}

/** Grenzen aus der alten Einzelgrenze: sie wird zur Progress-Grenze, Komfort 0,5 darunter, Challenge 0,5 darüber. */
export function envelopeFromTolerance(tolerance: Record<DimensionKey, { max_score_acceptable: number }>): Envelope {
  const envelope = {} as Envelope;
  for (const k of DIMS) {
    const p = clampScore(tolerance[k]?.max_score_acceptable ?? 3);
    envelope[k] = { comfort: Math.max(0, clampScore(p - 0.5)), progress: p, challenge: clampScore(p + 0.5) };
  }
  return envelope;
}

export const STYLE_NAMES: Record<FlightStyle, string> = Object.fromEntries(STYLE_OPTIONS.map((o) => [o.id, o.title])) as Record<FlightStyle, string>;
