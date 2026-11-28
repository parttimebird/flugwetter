// Character: das Pilotenprofil aus dem Onboarding (Flugstil, Schirm, Erfahrung, Technik, Sicherheitsgefühl)
// und daraus die persönlichen Zonen-Grenzen pro Dimension (buildEnvelope).
//
// Fragen und Bänder folgen Marvins Flow-Entwurf (paragliding_weather_pilot_check_v2). Die Starttabelle und die Zu- und
// Abschläge sind Startwerte zum Nachjustieren; das Flugtagebuch (Schritt 5) soll sie später pro Pilot anpassen.

import type { CrosswindTolerance, DimensionKey, EnvelopeLimits, Goal, LaunchPrefs, TailwindTolerance } from './types.ts';

/**
 * Flugstil: was du am Fliegen suchst, als Vogel (Marvins Wahl vom 28.11.2026). Er bestimmt den Tagesmodus zum Start,
 * ob die Strecken-Option an ist und welche Luft dir gefällt, aber nie deine Grenzen. Die kommen nur aus Technik,
 * Sicherheitsgefühl, Schirm und Flugpraxis („Wollen verschiebt kein Können“).
 */
export type FlightStyle = 'gull' | 'sparrow' | 'swallow' | 'raven' | 'stork' | 'chough';
/** Mit dem eigenen Schirm vertraut und sicher? */
export type Familiarity = 'yes' | 'partly' | 'no';
export type WingClass = 'A' | 'B' | 'C' | 'D';
/** Flüge pro Jahr: unter 20, 20 bis 50, über 50 */
export type Currency = 'low' | 'mid' | 'high';
export type SkillLevel = 'foundation' | 'basic' | 'solid' | 'high';
export type SafetyLevel = 'high_stress' | 'mixed' | 'stable';
export type Envelope = Record<DimensionKey, EnvelopeLimits>;

/** Schlüssel der optionalen Vorlieben (0 = trifft gar nicht zu, 5 = trifft voll zu; fehlt = neutral) */
export type PrefKey = 'long_thermals' | 'cloud_reading' | 'blue_ok' | 'avoid_shading' | 'house_hill' | 'glides' | 'go_xc';

export interface CharacterAnswers {
  style: FlightStyle;
  wing: WingClass;
  /** mit dem System (Schirm und Gurtzeug) vertraut und sicher; fehlt bei Profilen aus Schritt 3, zählt dann als „ja“ */
  familiar?: Familiarity;
  currency: Currency;
  /** Rückwärtsaufziehen sicher; fehlt bei Profilen aus Schritt 3 */
  reverseLaunch?: boolean;
  /** nur gefragt, wenn der Character erfahren genug ist (crosswindUnlocked) */
  crosswind?: CrosswindTolerance;
  /** nur gefragt, wenn der Character sehr erfahren ist (tailwindUnlocked) */
  tailwind?: TailwindTolerance;
  /** Selbsteinschätzung 0 bis 5 je Fähigkeit (Schlüssel aus SKILL_QUESTIONS) */
  skills: Record<string, number>;
  /** Zustimmung 0 bis 5 je Aussage (Schlüssel aus SAFETY_QUESTIONS) */
  safety: Record<string, number>;
  /** optionale Vorlieben; sie verschieben nie Grenzen, nur wie gut dir eine Stunde gefällt */
  prefs?: Partial<Record<PrefKey, number>>;
  /** Zeitpunkt des Einlesens (ISO) */
  createdAt?: string;
}

export const STYLE_OPTIONS: { id: FlightStyle; title: string; subtitle: string; text: string; mode: Goal; xc?: boolean }[] = [
  {
    id: 'gull',
    title: 'Möwe',
    subtitle: 'Genussflieger:in',
    text: 'Du lässt dich tragen: ruhige, gut einschätzbare Luft, Fliegen aus Spaß und Genuss. Die Luft darf gern so zart sein wie zimmerwarme Butter.',
    mode: 'chill',
  },
  {
    id: 'sparrow',
    title: 'Spatz',
    subtitle: 'Community-Flieger:in',
    text: 'Nie allein: Die Zeit mit anderen Piloten, Austausch und gemeinsame Flugtage gehören für dich fest dazu. Die Luft darf ruhig bis moderat sein.',
    mode: 'flow',
  },
  {
    id: 'swallow',
    title: 'Schwalbe',
    subtitle: 'Landschafts-Entdecker:in',
    text: 'Immer woanders: Du suchst neue Aussichten und Gebiete und fliegst gern in bewegter Luft.',
    mode: 'flow',
  },
  {
    id: 'raven',
    title: 'Rabe',
    subtitle: 'entwicklungsorientiert',
    text: 'Neugierig und clever: Du beschäftigst dich bewusst mit Technik, Thermik und Entscheidungen und nutzt Herausforderungen, um zu lernen.',
    mode: 'push',
  },
  {
    id: 'stork',
    title: 'Storch',
    subtitle: 'Streckenflieger:in',
    text: 'Zieht weit: Fliegen ist Routine für dich, dir geht es um Strecke. Die Strecken-Option ist bei dir von Anfang an an.',
    mode: 'flow',
    xc: true,
  },
  {
    id: 'chough',
    title: 'Alpendohle',
    subtitle: 'Hike & Fly',
    text: 'Zu Fuß am Gipfel zu Hause: Zustieg, Bewegung, Natur und Fliegen als Gesamtpaket. Ein ruhiges bis moderates Flugfenster ist dir wichtig.',
    mode: 'flow',
  },
];

/** Flugstile aus Schritt 3 und aus der ersten Fassung des Änderungskonzepts auf die Vögel abbilden (gespeicherte Profile) */
const LEGACY_STYLE: Record<string, FlightStyle> = {
  relaxed: 'gull',
  scenery: 'swallow',
  progress: 'raven',
  butter: 'gull',
  community: 'sparrow',
  explorer: 'swallow',
  learner: 'raven',
  xc: 'stork',
  hikefly: 'chough',
};

export function normalizeStyle(style: string): FlightStyle {
  if (STYLE_OPTIONS.some((o) => o.id === style)) return style as FlightStyle;
  return LEGACY_STYLE[style] ?? 'gull';
}

/** Tagesmodi vor dem 28.11.2026 (chill/progress/xc) auf Chill/Flow/Push abbilden; xc schaltet die Strecken-Option an */
export function normalizeMode(mode: string): { mode: Goal; xc: boolean } {
  if (mode === 'chill' || mode === 'flow' || mode === 'push') return { mode, xc: false };
  if (mode === 'progress') return { mode: 'flow', xc: false };
  if (mode === 'xc') return { mode: 'push', xc: true };
  return { mode: 'flow', xc: false };
}

export const PREF_QUESTIONS: { id: PrefKey; label: string; effect: string }[] = [
  { id: 'long_thermals', label: 'Ich will lange oben bleiben und Thermik nutzen.', effect: 'Stunden ohne nutzbare Thermik gefallen dir weniger.' },
  { id: 'glides', label: 'Ein ruhiger Abgleiter ist für mich ein schöner Flug.', effect: 'Chill und Flow brauchen bei dir keine Thermik.' },
  { id: 'cloud_reading', label: 'Ich lese Quellwolken gut und sehe, wenn sie überentwickeln.', effect: 'Wenig: Tage mit wachsenden Quellwolken gefallen dir weniger.' },
  { id: 'blue_ok', label: 'Blauthermik ohne Wolken als Wegweiser mag ich.', effect: 'Wertet Blauthermik bei Push und Strecke für dich auf oder ab.' },
  { id: 'avoid_shading', label: 'Abschattung durch hohe Wolken stört mich sehr.', effect: 'Bei Strecke zählen abgeschattete Stunden weniger.' },
  { id: 'go_xc', label: 'Ich will Strecke fliegen, sobald es geht.', effect: 'Die Strecken-Option ist bei dir von Anfang an an.' },
  { id: 'house_hill', label: 'Ich fliege meist an meinem Hausberg.', effect: 'Die App schlägt dir vor, Startplätze als Favoriten zu markieren.' },
];

export const FAMILIAR_OPTIONS: { id: Familiarity; title: string; text: string }[] = [
  { id: 'yes', title: 'Ja', text: 'Ich kenne meinen Schirm und mein Gurtzeug gut und fühle mich darauf sicher.' },
  { id: 'partly', title: 'Teilweise', text: 'Ich bin noch dabei, mein System kennenzulernen.' },
  { id: 'no', title: 'Noch nicht', text: 'Neues oder ungewohntes System, oder ich fühle mich darauf noch nicht sicher.' },
];

export const REVERSE_OPTIONS: { id: 'yes' | 'no'; title: string; text: string }[] = [
  { id: 'yes', title: 'Ja, sicher', text: 'Ich ziehe auch bei kräftigem Wind kontrolliert rückwärts auf.' },
  { id: 'no', title: 'Nein oder unsicher', text: 'Ich starte meist vorwärts.' },
];

export const CROSSWIND_OPTIONS: { id: CrosswindTolerance; title: string; text: string }[] = [
  { id: 'no', title: 'Nein', text: 'Wind höchstens 30° schräg von vorn und Böen bis 15 km/h.' },
  { id: 'light', title: 'Leicht', text: 'Bis 30° schräg bei Böen bis 20 km/h, bis 60° bei Böen bis 10 km/h.' },
  { id: 'yes', title: 'Ja', text: 'Bis 30° bei Böen bis 20 km/h, bis 60° bei Böen bis 15 km/h. Stärker seitlich zeigt die App als „kritisch prüfen“.' },
];

export const TAILWIND_OPTIONS: { id: TailwindTolerance; title: string; text: string }[] = [
  { id: 'no', title: 'Nein', text: 'Rückenwind-Starts kommen für mich nicht in Frage.' },
  { id: 'light', title: 'Leicht', text: 'Leichten Rückenwind (unter 5 km/h, Böen unter 10 km/h) beherrsche ich. Die App zeigt solche Stunden nur im Modus Push.' },
];

export const WING_OPTIONS: { id: WingClass; title: string; text: string }[] = [
  { id: 'A', title: 'EN-A', text: 'Schulungs- und Genussschirm' },
  { id: 'B', title: 'EN-B', text: 'Low-B bis High-B' },
  { id: 'C', title: 'EN-C', text: 'Sport- und Streckenschirm' },
  { id: 'D', title: 'EN-D oder CCC', text: 'Hochleister' },
];

export const CURRENCY_OPTIONS: { id: Currency; title: string }[] = [
  { id: 'low', title: 'unter 20 Flüge oder Stunden im Jahr' },
  { id: 'mid', title: '20 bis 50 Flüge oder Stunden im Jahr' },
  { id: 'high', title: 'über 50 Flüge oder Stunden im Jahr' },
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
  /** Strecken-Option zum Start an (Storch oder Vorliebe „Strecke, sobald es geht“) */
  defaultXc: boolean;
  /** Push darf bis in die Challenge-Zone reichen (Technik ab „solide“ und kein erhöhtes Stressniveau), sonst bis Progress */
  pushAdvised: boolean;
  /** warum Push nur bis Progress reicht (leer, wenn pushAdvised) */
  pushReason: string;
  /** Startbedingungen, mit denen die Engine rechnet (gesperrte Fragen zählen als „nein“) */
  launch: LaunchPrefs;
  crosswindUnlocked: boolean;
  tailwindUnlocked: boolean;
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
  familiar: Familiarity = 'yes',
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
  } else if ((wing === 'C' || wing === 'D') && familiar !== 'yes') {
    adjustments.push('Höhere Schirmklasse, mit der du noch nicht ganz vertraut bist: kein Zuschlag beim Wind, das Potenzial ist noch nicht sicher nutzbar.');
  } else if ((wing === 'C' || wing === 'D') && (skillLevel === 'solid' || skillLevel === 'high')) {
    const bonus = wing === 'C' ? 0.25 : 0.5;
    shift.wind_comfort += bonus;
    adjustments.push(`${wing === 'C' ? 'EN-C' : 'EN-D'}-Schirm mit solider Technik: Wind ${wing === 'C' ? 'eine Viertelstufe' : 'eine halbe Stufe'} mehr. Turbulenz bleibt, weil höhere Klassen weniger verzeihen.`);
  } else if (wing === 'C' || wing === 'D') {
    adjustments.push('Höhere Schirmklasse bei noch wenig Routine: kein Zuschlag beim Wind.');
  }

  if (familiar === 'no') {
    shift.wind_comfort -= 0.25;
    shift.shear_turbulence -= 0.25;
    adjustments.push('Mit dem System noch nicht vertraut: Wind und Turbulenz eine Viertelstufe vorsichtiger.');
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

/** Tagesmodus zum Start nach Flugstil. Die Grenzen bleiben davon unberührt. */
export function defaultModeFor(style: FlightStyle | string): Goal {
  return STYLE_OPTIONS.find((o) => o.id === normalizeStyle(style))?.mode ?? 'flow';
}

/** Strecken-Option zum Start: Storch, oder die Vorliebe „Strecke, sobald es geht“ ab 4 von 5 */
export function defaultXcFor(style: FlightStyle | string, prefs?: CharacterAnswers['prefs']): boolean {
  return STYLE_OPTIONS.find((o) => o.id === normalizeStyle(style))?.xc === true || (prefs?.go_xc ?? 0) >= 4;
}

/**
 * Frage nach Seitenwind erst für erfahrene Piloten: Technik ab „solide“, mindestens 20 Flüge im Jahr, mit dem System
 * vertraut und kein erhöhtes Stressniveau.
 */
export function crosswindUnlocked(skill: SkillLevel, safety: SafetyLevel, currency: Currency, familiar: Familiarity): boolean {
  return (skill === 'solid' || skill === 'high') && currency !== 'low' && familiar === 'yes' && safety !== 'high_stress';
}

/** Frage nach Rückenwind nur für sehr erfahrene Piloten: Technik „hoch“, über 50 Flüge, vertraut und stabil. */
export function tailwindUnlocked(skill: SkillLevel, safety: SafetyLevel, currency: Currency, familiar: Familiarity): boolean {
  return skill === 'high' && currency === 'high' && familiar === 'yes' && safety === 'stable';
}

const scoreCache = new WeakMap<CharacterAnswers, CharacterResult>();

/** wie scoreCharacter, aber pro Antwort-Objekt nur einmal gerechnet (die Engine fragt es für jede Stunde) */
export function characterOf(a: CharacterAnswers): CharacterResult {
  let r = scoreCache.get(a);
  if (!r) {
    r = scoreCharacter(a);
    scoreCache.set(a, r);
  }
  return r;
}

export function scoreCharacter(a: CharacterAnswers): CharacterResult {
  const skillTotal = sum(a.skills, SKILL_QUESTIONS);
  const safetyTotal = sum(a.safety, SAFETY_QUESTIONS);
  const skill = skillBand(skillTotal);
  const safety = safetyBand(safetyTotal);
  const familiar = a.familiar ?? 'yes';
  const { envelope, adjustments } = buildEnvelope(skill.level, safety.level, a.wing, a.currency, familiar);
  const lowSkill = skill.level === 'foundation' || skill.level === 'basic';
  const stressed = safety.level === 'high_stress';
  const pushAdvised = !lowSkill && !stressed;
  const pushReason = pushAdvised
    ? ''
    : lowSkill
      ? `Dein Technik-Score liegt bei ${skillTotal} von 50, bis in die Challenge-Zone empfiehlt der Coach Push ab 31.`
      : `Dein Sicherheits-Score liegt bei ${safetyTotal} von 40, bis in die Challenge-Zone empfiehlt der Coach Push ab 21.`;
  const cwOpen = crosswindUnlocked(skill.level, safety.level, a.currency, familiar);
  const twOpen = tailwindUnlocked(skill.level, safety.level, a.currency, familiar);
  const launch: LaunchPrefs = {
    crosswind: cwOpen ? (a.crosswind ?? 'no') : 'no',
    tailwind: twOpen ? (a.tailwind ?? 'no') : 'no',
    reverseLaunch: a.reverseLaunch,
  };
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
    defaultXc: defaultXcFor(a.style, a.prefs),
    pushAdvised,
    pushReason,
    launch,
    crosswindUnlocked: cwOpen,
    tailwindUnlocked: twOpen,
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

export const STYLE_NAMES: Record<FlightStyle, string> = Object.fromEntries(STYLE_OPTIONS.map((o) => [o.id, `${o.title} (${o.subtitle})`])) as Record<FlightStyle, string>;
