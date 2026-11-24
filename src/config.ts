// Alle Schwellenwerte der Bewertung an einer Stelle.
// Das sind Startwerte. Später sollen sie über Pilotenprofile und Community-Feedback angepasst werden.
// Stützpunkte [Eingangswert, Score] werden linear interpoliert.

export type Curve = [number, number][];

export interface EngineConfig {
  wind: {
    /** Wind in Starthöhe (km/h) → Windkomfort-Score */
    takeoff: Curve;
    /** stärkster Wind in der Flugschicht (km/h) → Score, mit Abzug `layerOffset` */
    layerOffset: number;
    /** Böen-Spanne Böe minus Mittelwind (km/h) → Score, mit Abzug `gustOffset` */
    gustSpread: Curve;
    gustOffset: number;
  };
  thermal: {
    /** Anteil der Globalstrahlung, der als fühlbare Wärme in die Luft geht (Bowen-Näherung) */
    sensibleHeatFraction: number;
    /** w* (m/s) → Thermik-Score */
    wStar: Curve;
    /** Faktor Bartkern zu w* und Eigensinken des Schirms für die Steigwert-Schätzung */
    coreFactor: number;
    gliderSink: number;
    /** CAPE (J/kg) → Mindest-Score wegen Überentwicklungspotenzial */
    cape: Curve;
  };
  shear: {
    /** Scherung (m/s pro 1000 m) → Score */
    shear: Curve;
    /** Böen-Spanne (km/h) → Score */
    gustSpread: Curve;
    /** Böenfaktor (nur ab 10 km/h Mittelwind) → Score */
    gustFactor: Curve;
    /** Verhältnis Wind in der Flugschicht zu w* → Score (zerrissene Thermik) */
    windToThermal: Curve;
    /** w* (m/s) → Score (Thermik selbst wird ruppig) */
    thermalTurbulence: Curve;
    /** Aufschlag, wenn mehrere Turbulenzquellen zusammenkommen */
    comboBonus: number;
  };
  structure: {
    /** Arbeitshöhe über Start (m) → Score */
    workingHeight: Curve;
    /** Wolkendicke Cumulus (m) → Mindest-Score */
    cloudDepth: Curve;
  };
  rules: {
    /** ab diesem Wind (km/h) muss die Richtung zum Startplatz passen */
    minWindForDirectionKmh: number;
    /** dasselbe für Starts im Wald oder in Schneisen (Seiten- und Rückenwind sind dort tabu) */
    minWindForDirectionLaneKmh: number;
    /** Starts im Wald: unter diesem Gegenwind (km/h) gibt es einen Hinweis */
    laneMinHeadwindKmh: number;
    /** Rückenwind-Anteil (km/h), ab dem auch schwacher Wind No-Go ist */
    maxTailwindKmh: number;
    /** Niederschlag ab dem es No-Go ist (mm/h) */
    maxPrecip: number;
    /** relative Feuchte in Starthöhe, ab der Wolke/Nebel am Start wahrscheinlich ist (%) */
    fogRh: number;
    /** Mindestsicht (m) */
    minVisibility: number;
    /** Mindestabstand Basis über Start (m) */
    minBaseAboveTakeoff: number;
    /** Böen über Startplatz-Maximum plus diesem Wert (km/h) sind No-Go */
    gustMarginKmh: number;
    /** Höhenwind von hinten ab dieser Stärke (km/h) gilt als Lee */
    leeMinKmh: number;
  };
  zones: {
    noGoWind: number;
    noGoShear: number;
    noGoStructure: number;
    xcThermal: number;
    xcStructure: number;
    xcMaxWind: number;
    xcMaxShear: number;
    progressThermal: number;
    progressWind: number;
    progressShear: number;
  };
  /** Stunden mit persönlicher Passung ab diesem Wert bilden ein Flugfenster */
  windowMinFit: number;
}

export const DEFAULT_CONFIG: EngineConfig = {
  wind: {
    takeoff: [
      [0, 0],
      [5, 1],
      [10, 2],
      [15, 3],
      [22, 4],
      [30, 5],
    ],
    layerOffset: 0.5,
    gustSpread: [
      [0, 0],
      [10, 1],
      [15, 2],
      [20, 3],
      [28, 4],
      [36, 5],
    ],
    gustOffset: 0.5,
  },
  thermal: {
    sensibleHeatFraction: 0.3,
    wStar: [
      [0, 0],
      [0.6, 0.5],
      [1.0, 1],
      [1.5, 2],
      [2.0, 3],
      [2.6, 4],
      [3.3, 5],
    ],
    coreFactor: 1.3,
    gliderSink: 1.1,
    cape: [
      [0, 0],
      [300, 0],
      [600, 3.5],
      [1000, 4.5],
      [1500, 5],
    ],
  },
  shear: {
    shear: [
      [0, 0],
      [2, 0.5],
      [4, 1.5],
      [6, 2.5],
      [8, 3.5],
      [11, 4.5],
      [14, 5],
    ],
    gustSpread: [
      [0, 0],
      [8, 1],
      [12, 2],
      [16, 3],
      [22, 4],
      [30, 5],
    ],
    gustFactor: [
      [1.0, 0],
      [1.3, 1],
      [1.5, 2],
      [1.6, 3],
      [1.8, 4],
      [2.1, 5],
    ],
    windToThermal: [
      [0, 0],
      [2, 0.5],
      [3, 1.5],
      [4, 2.5],
      [5, 3.5],
      [7, 4.5],
    ],
    thermalTurbulence: [
      [1.5, 0],
      [2.2, 1.5],
      [2.8, 2.5],
      [3.3, 3.5],
    ],
    comboBonus: 0.3,
  },
  structure: {
    workingHeight: [
      [0, 0],
      [200, 0.5],
      [500, 1.5],
      [900, 2.5],
      [1400, 3.2],
      [2000, 3.8],
    ],
    cloudDepth: [
      [0, 0],
      [1000, 0],
      [1500, 3.5],
      [2500, 4.2],
      [3500, 5],
    ],
  },
  rules: {
    minWindForDirectionKmh: 8,
    minWindForDirectionLaneKmh: 5,
    laneMinHeadwindKmh: 5,
    maxTailwindKmh: 5,
    maxPrecip: 0.2,
    fogRh: 97,
    minVisibility: 3000,
    minBaseAboveTakeoff: 150,
    gustMarginKmh: 12,
    leeMinKmh: 12,
  },
  zones: {
    noGoWind: 4.5,
    noGoShear: 4.5,
    noGoStructure: 4.8,
    xcThermal: 2.8,
    xcStructure: 2.5,
    xcMaxWind: 3.5,
    xcMaxShear: 3.5,
    progressThermal: 1.8,
    progressWind: 2.5,
    progressShear: 2.8,
  },
  windowMinFit: 60,
};

/** Lineare Interpolation entlang einer Kurve, außerhalb wird der Randwert gehalten. */
export function curve(c: Curve, x: number): number {
  if (!Number.isFinite(x)) return c[0][1];
  if (x <= c[0][0]) return c[0][1];
  for (let i = 1; i < c.length; i++) {
    const [x1, y1] = c[i];
    if (x <= x1) {
      const [x0, y0] = c[i - 1];
      return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
    }
  }
  return c[c.length - 1][1];
}
