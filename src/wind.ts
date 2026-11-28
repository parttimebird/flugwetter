// Grundwind und Böen: Marvins Matrix (28.11.2026) als Logik.
//
// Abgeleitete Regel aus der Matrix:
// - Liegen die Böen höchstens etwa 5 km/h über dem Grundwind, ist es laminar („perfekt“), bei jedem Grundwind.
// - Jede weiteren 5 km/h Böenabstand machen es eine Stufe unruhiger: sehr gut, gut, Böen beachten, turbulent …
// - Bei schwachem Grundwind sind große Abstände weniger kritisch (25 km/h Böen bei 5 km/h Wind: „turbulent“),
//   ab etwa 15 km/h Grundwind kippt es schneller (15/35 und 20/40: „deutlich turbulent“).
// - Ab 25 km/h Grundwind ist es nur noch Soaring; 30/40 ist sehr kritisch, 35/40 nur für wenige.
// - Böen bis 40 km/h mit großem Abstand (5/35, 10/40, 15/40) sind No-Go.
//
// Die Stufe q geht von 0 (perfekt, laminar) bis 6 (No-Go). Zwischen den Stützpunkten wird linear interpoliert.

/** Spalten: Böenabstand (Böe minus Grundwind) in km/h */
export const GUST_SPREAD_STEPS = [0, 5, 10, 15, 20, 25, 30];
/** Zeilen: Grundwind in km/h, Werte: Stufe q */
export const GUST_MATRIX: { base: number; q: number[] }[] = [
  { base: 5, q: [0, 1, 2, 3, 4, 5, 6] }, // 5/8 perfekt, 5/10 sehr gut, 5/15 gut, 5/20 beachten, 5/25 turbulent, 5/30 deutlich, 5/35 No-Go
  { base: 10, q: [0, 0, 1, 2, 3.5, 5, 6] }, // 10/15 perfekt, 10/20 sehr gut, 10/25 gut, 10/30 beachten/turbulent, 10/35 deutlich, 10/40 No-Go
  { base: 15, q: [0, 0, 1, 2, 5, 6, 6] }, // 15/20 perfekt, 15/25 sehr gut, 15/30 gut, 15/35 deutlich, 15/40 No-Go
  { base: 20, q: [0, 0, 1, 2, 5, 6, 6] }, // 20/25 perfekt, 20/30 sehr gut, 20/35 gut (stark), 20/40 deutlich
  { base: 25, q: [0, 0, 2, 4.5, 6, 6, 6] }, // 25/30 perfekt, 25/35 gut (stark), 25/40 turbulent
  { base: 30, q: [0.5, 1, 5, 6, 6, 6, 6] }, // 30/35 sehr gut, 30/40 sehr kritisch
  { base: 35, q: [2.5, 3, 6, 6, 6, 6, 6] }, // 35/40 kann Spaß machen, sehr kritisch
  { base: 40, q: [6, 6, 6, 6, 6, 6, 6] },
];

function interp(xs: number[], ys: number[], x: number): number {
  if (x <= xs[0]) return ys[0];
  for (let i = 1; i < xs.length; i++) {
    if (x <= xs[i]) return ys[i - 1] + ((ys[i] - ys[i - 1]) * (x - xs[i - 1])) / (xs[i] - xs[i - 1]);
  }
  return ys[ys.length - 1];
}

/** Stufe 0 (laminar) bis 6 (No-Go) aus Grundwind und Böen */
export function gustLevel(baseKmh: number, gustKmh: number): number {
  const spread = Math.max(0, gustKmh - baseKmh);
  const base = Math.max(GUST_MATRIX[0].base, baseKmh);
  const rows = GUST_MATRIX.map((r) => interp(GUST_SPREAD_STEPS, r.q, spread));
  return Math.round(interp(GUST_MATRIX.map((r) => r.base), rows, base) * 10) / 10;
}

export const GUST_LABELS = ['perfekt, laminar', 'sehr gut', 'gut', 'Böen beachten', 'turbulent', 'deutlich turbulent, kritisch prüfen', 'No-Go, macht keinen Spaß'];

export function gustLabel(q: number): string {
  if (q < 0.75) return GUST_LABELS[0];
  if (q < 1.5) return GUST_LABELS[1];
  if (q < 2.5) return GUST_LABELS[2];
  if (q < 3.5) return GUST_LABELS[3];
  if (q < 4.5) return GUST_LABELS[4];
  if (q < 5.75) return GUST_LABELS[5];
  return GUST_LABELS[6];
}

/** Stufe q auf die Turbulenz-Skala 0 bis 5 (q 6 = 5) */
export function gustTurbulenceScore(q: number): number {
  return (q * 5) / 6;
}
