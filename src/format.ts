// Gemeinsame Formatierung für Texte aus Engine und App.
//
// Höhen aus dem Wettermodell werden auf 100 m gerundet: Meter-genaue Werte wirken bei einem Modell mit 2 km Maschenweite
// unehrlich präzise. Feste Höhen (Startplatz, Landeplatz, Luftraum) bleiben, wie sie sind.

const de0 = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 });

/** auf 100 m gerundet, z. B. 1284 → 1300 */
export function round100(m: number): number {
  return Math.round(m / 100) * 100;
}

/** „rund 1.300 m“ */
export function alt100(m: number): string {
  return `rund ${de0.format(round100(m))} m`;
}

/** Höhe über dem Start, gerundet: „rund 800 m über dem Start“ bzw. „kaum über dem Start“ */
export function aboveStart(m: number): string {
  if (m < 50) return 'kaum über dem Start';
  return `rund ${de0.format(round100(Math.max(100, m)))} m über dem Start`;
}

/** „+800 m“ für knappe Anzeigen, gerundet */
export function plus100(m: number): string {
  if (m < 50) return '±0 m';
  return `+${de0.format(round100(Math.max(100, m)))} m`;
}

/** Grundwind (Mittelwind am Start, km/h): Stufen nach Marvins Änderungskonzept */
export function baseWindClass(kmh: number): string {
  if (kmh < 10) return 'schwach';
  if (kmh < 15) return 'mäßig';
  if (kmh < 20) return 'frisch';
  if (kmh < 25) return 'stark';
  if (kmh < 30) return 'sehr stark';
  return 'kritisch';
}

/** Böen (km/h). Das Konzept lässt 30–35 offen, hier zählt es noch zu „stark“. */
export function gustClass(kmh: number): string {
  if (kmh < 10) return 'sehr schwach';
  if (kmh < 15) return 'schwach';
  if (kmh < 25) return 'mäßig';
  if (kmh <= 35) return 'stark';
  return 'sehr stark, kritisch';
}

export function capitalize(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

/** eine Nachkommastelle mit deutschem Komma */
export function de1(x: number): string {
  return x.toLocaleString("de-DE", { maximumFractionDigits: 1 });
}
