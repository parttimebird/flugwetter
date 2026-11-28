// Gemeinsame Typen der Wetter-Engine.
// Einheiten intern: Höhe in m über NN, Temperatur in °C, Wind in m/s, Richtung in Grad (woher der Wind kommt).

export type DimensionKey = 'wind_comfort' | 'thermic_character' | 'shear_turbulence' | 'structure_cap';
/** Lufttyp aus dem Wetter allein (ruhig, lebhaft, Streckenwetter, No-Go), unabhängig vom Piloten. */
export type Zone = 'calm' | 'lively' | 'xc' | 'no-go';
/**
 * Tagesmodus des Piloten (seit 28.11.2026; vorher chill/progress/xc, gespeicherte Profile werden umgeschrieben):
 * - chill: ruhige, einfache Luft in deiner Komfort-Zone
 * - flow: deine ganze Komfort-Zone; Bedingungen, die du kennst und die dich nicht überfordern
 * - push: bewusst fordernd, bis in deine Progress-Zone, mit passendem Character bis in die Challenge-Zone
 * Strecke (XC) ist kein Modus, sondern eine eigene Option zu jedem Modus (`comfort_profile.xc`).
 */
export type Goal = 'chill' | 'flow' | 'push';

/** Mindestanforderungen eines Modus oder der Strecken-Option (Skala 0 bis 5) */
export interface GoalRequirements {
  thermic_character_min?: number;
  wind_comfort_max?: number;
  shear_turbulence_max?: number;
  structure_cap_min?: number;
}

/** Persönliche Startbedingungen für einen bestimmten Startplatz */
export interface SpotLaunchPrefs {
  crosswind?: CrosswindTolerance;
  /** Böen höchstens (km/h) an diesem Startplatz */
  maxGustKmh?: number;
}

/** Seitenwind am Start: nein = nur Gegenwind, leicht = schwacher Seitenwind, ja = was der Startplatz hergibt */
export type CrosswindTolerance = 'no' | 'light' | 'yes';
/** Rückenwind am Start: nein, oder leicht (nur für sehr erfahrene Piloten und nur im Modus Push) */
export type TailwindTolerance = 'no' | 'light';

/** Persönliche Startbedingungen aus dem Character, im Profil verstellbar */
export interface LaunchPrefs {
  crosswind: CrosswindTolerance;
  tailwind: TailwindTolerance;
  /** Rückwärtsaufziehen sicher? undefined = nicht gefragt (Standardprofil) */
  reverseLaunch?: boolean;
  /** Böen höchstens (km/h), nur pro Startplatz gesetzt */
  maxGustKmh?: number;
}
/**
 * Persönliche Zone einer Stunde: grün = Komfort, gelb = Progress, orange = Challenge, rot = Überforderung.
 * 'no-go' heißt: nach den festen Regeln nicht fliegbar (Nacht, Regen, falsche Windrichtung …), für jeden Piloten.
 */
export type PersonalZone = 'green' | 'yellow' | 'orange' | 'red' | 'no-go';

/** Grenzen einer Dimension (Skala 0 bis 5): bis `comfort` grün, bis `progress` gelb, bis `challenge` orange, darüber rot. */
export interface EnvelopeLimits {
  comfort: number;
  progress: number;
  challenge: number;
}

/** Windrichtungs-Sektor (woher), im Uhrzeigersinn von `from` bis `to`, z. B. 330 → 120 über Nord. */
export interface Sector {
  from: number;
  to: number;
}

export interface DangerRule {
  sector: Sector;
  /** ab dieser Windstärke (km/h) greift die Regel */
  minKmh: number;
  reason: string;
  /** 'takeoff' = Wind in Starthöhe, 'above' = Wind 200–800 m über dem Start */
  level: 'takeoff' | 'above';
}

export interface Landing {
  name: string;
  lat?: number;
  lon?: number;
  elevation: number;
}

/** Fluggelände: mehrere Startplätze eines Bergs teilen sich Vorhersage und Verein */
export interface Site {
  id: string;
  name: string;
  region: string;
  /** Geländehalter laut DHV-Geländedatenbank */
  club: string;
  /** Webseite des Vereins */
  url?: string;
  /** Nummer in der DHV-Geländedatenbank (service.dhv.de/db2, details.php?item=…) */
  dhvItem: number;
  /** Punkt, für den die Vorhersage geholt wird (Hauptstartplatz) */
  lat: number;
  lon: number;
}

export interface Airspace {
  /** Untergrenze des Luftraums in m über NN */
  floorMsl: number;
  note: string;
}

export interface Spot {
  id: string;
  site: Site;
  name: string;
  lat: number;
  lon: number;
  /** Starthöhe in m über NN */
  elevation: number;
  /** Ausrichtung des Startplatzes = ideale Windrichtung (woher), Grad */
  facing: number;
  /** Windrichtungen, bei denen gestartet werden kann */
  windSector: Sector;
  /** maximale Windstärke am Start in km/h (Geländeauflage oder Erfahrungswert) */
  maxWindKmh: number;
  landing?: Landing;
  dangerRules: DangerRule[];
  /** Start im Wald oder in einer Schneise: nur bei klarem Gegenwind, Seiten- und Rückenwind sind tabu */
  needsHeadwind?: boolean;
  /** kontrollierter Luftraum über oder neben dem Gelände */
  airspace?: Airspace;
  /** Flugzeiten laut Geländeauflage, relativ zu Sonnenauf- und -untergang */
  operatingHours?: { afterSunriseH?: number; beforeSunsetH?: number };
  notes: string[];
  sources: string[];
  /** Annahmen, die der Pilot noch bestätigen sollte */
  needsReview: string[];
}

/** Ein Punkt im Vertikalprofil */
export interface ThermoLevel {
  z: number;
  t: number;
  td: number;
  p: number;
}

export interface WindLevel {
  z: number;
  /** West-Ost-Komponente (m/s), positiv nach Osten */
  u: number;
  /** Süd-Nord-Komponente (m/s), positiv nach Norden */
  v: number;
}

export interface SurfaceData {
  /** Höhe des Modell-Geländes (m über NN) */
  z: number;
  t2m: number;
  td2m: number;
  pSurf: number;
  ws10: number;
  wd10: number;
  gust10: number;
  precip: number;
  precipProb: number | null;
  weatherCode: number;
  cloudCover: number;
  cloudLow: number;
  cloudMid: number;
  cloudHigh: number;
  visibility: number;
  cape: number;
  swRad: number;
  freezingLevel: number | null;
}

/** Normalisierte Eingangsdaten für eine Stunde, unabhängig von der Datenquelle */
export interface HourInput {
  /** lokale Zeit, ISO ohne Offset, z. B. 2026-11-28T13:00 */
  time: string;
  isDay: boolean;
  surface: SurfaceData;
  /** aufsteigend nach Höhe, nur oberhalb des Modell-Geländes */
  thermo: ThermoLevel[];
  wind: WindLevel[];
}

export interface ForecastData {
  source: string;
  model: string;
  fetchedAt: string;
  modelElevation: number;
  hours: HourInput[];
}

export interface DimensionScore {
  key: DimensionKey;
  /** 0–5, eine Nachkommastelle */
  score: number;
  /** Hauptstufe 0–5 */
  level: number;
  /** Unterstufe: '−', '' oder '+' */
  sub: '−' | '' | '+';
  /** z. B. "3−" */
  display: string;
  label: string;
  reasons: string[];
}

export interface HourMetrics {
  takeoffWindKmh: number;
  takeoffWindDir: number;
  /** Windrichtung am Start liegt im Windfenster des Startplatzes */
  takeoffInSector: boolean;
  headwindKmh: number;
  crosswindKmh: number;
  /** Wind 200–800 m über dem Start */
  windAboveKmh: number;
  windAboveDir: number;
  layerMaxWindKmh: number;
  layerMeanWindKmh: number;
  gustKmh: number;
  gustSpreadKmh: number;
  gustFactor: number | null;
  /** Böenstufe nach Marvins Grundwind/Böen-Matrix: 0 laminar bis 6 No-Go (src/wind.ts) */
  gustLevel: number;
  /** Soaring-Stunde und für welchen Modus sie mindestens taugt (null = kein Soaring); setzt evaluateHour */
  soaringMode?: Goal | null;
  /** Windscherung in der Flugschicht, m/s pro 1000 m */
  shearPerKm: number;
  thermalTopMsl: number;
  cloudBaseMsl: number | null;
  cloudTopMsl: number | null;
  /** nutzbare Höhe über dem Start (bis Thermikobergrenze bzw. Basis) */
  workingHeight: number;
  /** Konvektive Geschwindigkeit w* (m/s) */
  wStar: number;
  /** geschätztes mittleres Steigen netto (m/s) */
  climbEstimate: number;
  /** stärkster Thermik-Index in der Flugschicht (K, negativ = Auftrieb) */
  tiMin: number | null;
  ti850: number | null;
  /** Inversion über der Thermikobergrenze */
  inversion: { baseMsl: number; strengthK: number } | null;
  cape: number;
  rhTakeoff: number;
  precip: number;
  weatherCode: number;
  cloudCover: number;
  cloudHigh: number;
  swRad: number;
  /** Sonnenstand: Azimut (Grad ab Nord) und Höhe (Grad) */
  sunAzimuth: number;
  sunElevation: number;
  /** Sonne scheint kräftig auf den Hang des Startplatzes (lokal thermisch) */
  sunOnSlope: boolean;
}

export interface FitResult {
  /** 0–100 */
  score: number;
  label: string;
  /** persönliche Zone dieser Stunde */
  personalZone: PersonalZone;
  /** Tagesmodus, für den die Passung berechnet wurde */
  mode: Goal;
  /** Strecken-Option war an */
  xc: boolean;
  /** Überschreitung der persönlichen Toleranz pro Dimension */
  exceed: Partial<Record<DimensionKey, number>>;
  goalsMet: Goal[];
  notes: string[];
  /** Startbedingungen, die nicht zu deinem Character passen (dann zählt die Stunde nie als Flugfenster) */
  launchIssues: string[];
}

export interface NoGoReason {
  /** kurzer Schlüssel zum Zählen über den Tag, z. B. 'direction' */
  code: string;
  text: string;
}

export interface HourEvaluation {
  time: string;
  isDay: boolean;
  metrics: HourMetrics;
  dimensions: Record<DimensionKey, DimensionScore>;
  noGo: NoGoReason[];
  warnings: string[];
  /** neutrale Hinweise, z. B. Soaring möglich */
  hints: string[];
  zone: Zone;
  zoneLabel: string;
  fit: FitResult;
  summary: string;
}

export interface FlightWindow {
  start: string;
  end: string;
  hours: number;
  zone: Zone;
  /** die anspruchsvollste persönliche Zone im Fenster */
  personalZone: PersonalZone;
  fitMax: number;
  fitMean: number;
  dims: Record<DimensionKey, number>;
}

export interface DaySummary {
  date: string;
  windows: FlightWindow[];
  bestHour: HourEvaluation | null;
  /** Gründe für No-Go in den Tagstunden, mit Anzahl Stunden */
  noGoReasons: { reason: string; hours: number }[];
  verdict: string;
}

export interface SpotEvaluation {
  spot: Spot;
  source: string;
  model: string;
  fetchedAt: string;
  modelElevation: number;
  hours: HourEvaluation[];
  days: DaySummary[];
}

/** Pilotenprofil, entspricht user_konfig.txt, erweitert um Character und persönliche Zonen */
export interface PilotProfile {
  pilot_id: string;
  /** Antworten aus dem Character-Onboarding, falls schon eingelesen */
  character?: import('./character.ts').CharacterAnswers;
  /** persönliche Startbedingungen; fehlen sie, gilt das vorsichtige Standard: kein Seiten- und kein Rückenwind */
  launch?: LaunchPrefs;
  /** eigene Startbedingungen pro Startplatz (Schlüssel: Startplatz-id) */
  spot_launch?: Record<string, SpotLaunchPrefs>;
  comfort_profile: {
    base_model: string;
    /** gewählter Tagesmodus */
    pilot_profile: Goal;
    /** Strecken-Option (XC): verlangt Thermik und Arbeitshöhe über mindestens drei Stunden */
    xc?: boolean;
    /**
     * Gewicht pro Dimension. `max_score_acceptable` ist die alte Einzelgrenze; gibt es `envelope`, zählt das,
     * sonst wird daraus die Progress-Grenze (Komfort 0,5 darunter, Challenge 0,5 darüber).
     */
    tolerance: Record<DimensionKey, { max_score_acceptable: number; importance_weight: number }>;
    /** persönliche Zonen-Grenzen pro Dimension */
    envelope?: Record<DimensionKey, EnvelopeLimits>;
    /** Mindestanforderungen je Modus und für die Strecken-Option */
    min_required_scores_for_goal: Record<Goal | 'xc', GoalRequirements>;
  };
}
