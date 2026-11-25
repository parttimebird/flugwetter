// Erzeugt eine lesbare Auswertung für alle Startplätze.
//
//   node scripts/report.ts                 nimmt die neueste Datei in fixtures/
//   node scripts/report.ts --live          holt die Vorhersage frisch bei Open-Meteo und speichert sie in fixtures/
//   node scripts/report.ts --fixture <datei>
//
// Ergebnis: out/auswertung.md (zum Lesen) und out/auswertung.json (für die App in Schritt 2)

import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { SITE_LIST, SPOTS } from '../src/spots.ts';
import { fetchRaw, parseResponse, type OpenMeteoResponse } from '../src/openmeteo.ts';
import { evaluateForecast } from '../src/engine.ts';
import { compass } from '../src/physics.ts';
import { ZONE_NAMES } from '../src/windows.ts';
import { GOAL_NAMES, PZONE_NAMES } from '../src/profile.ts';
import type { DaySummary, HourEvaluation, PilotProfile, Site, Spot, SpotEvaluation } from '../src/types.ts';

const root = new URL('..', import.meta.url).pathname;
const args = process.argv.slice(2);
const pilot = JSON.parse(readFileSync(join(root, 'config/pilot-standard.json'), 'utf8')) as PilotProfile;

interface Fixture {
  fetched_at: string;
  /** Open-Meteo-Antwort pro Gelände (Site-ID) */
  spots: Record<string, OpenMeteoResponse>;
}

/** Vorhersage pro Gelände: frisch abrufen oder aus einer gespeicherten Datei lesen */
async function loadFixture(): Promise<Fixture> {
  if (args.includes('--live')) {
    const fx: Fixture = { fetched_at: new Date().toISOString(), spots: {} };
    for (const site of SITE_LIST) {
      process.stdout.write(`Hole Vorhersage für ${site.name} … `);
      fx.spots[site.id] = await fetchRaw(site);
      console.log('ok');
    }
    const stamp = localStamp(fx.fetched_at);
    const name = `openmeteo_${stamp.date}T${stamp.text.slice(12, 14)}${stamp.text.slice(15, 17)}.json`;
    writeFileSync(join(root, 'fixtures', name), JSON.stringify(fx));
    console.log(`Gespeichert: fixtures/${name}`);
    return fx;
  }
  let file = args[args.indexOf('--fixture') + 1];
  if (!args.includes('--fixture')) {
    const files = readdirSync(join(root, 'fixtures')).filter((f) => f.startsWith('openmeteo_')).sort();
    file = join(root, 'fixtures', files[files.length - 1]);
  }
  return JSON.parse(readFileSync(file, 'utf8')) as Fixture;
}

const WEEKDAYS = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];

function dayLabel(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  return `${WEEKDAYS[d.getUTCDay()]} ${date.slice(8, 10)}.${date.slice(5, 7)}.`;
}

function localStamp(iso: string): { date: string; text: string } {
  const f = new Intl.DateTimeFormat('de-DE', {
    timeZone: 'Europe/Berlin',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
  const parts = Object.fromEntries(f.formatToParts(new Date(iso)).map((p) => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, text: `${parts.day}.${parts.month}.${parts.year}, ${parts.hour}:${parts.minute} Uhr` };
}

/** Tage ab dem Abruf; der Abruftag nur, wenn danach noch Tagstunden kommen */
function relevantDays(ev: SpotEvaluation): DaySummary[] {
  const fetched = localStamp(ev.fetchedAt);
  const nowHour = Number(fetched.text.slice(12, 14));
  return ev.days.filter((d) => {
    if (d.date > fetched.date) return true;
    if (d.date < fetched.date) return false;
    return ev.hours.some((h) => h.isDay && h.time.startsWith(d.date) && Number(h.time.slice(11, 13)) > nowHour);
  });
}

/** Kurzform für die Überblickstabelle */
function shortVerdict(day: DaySummary): string {
  if (day.windows.length > 0) {
    return day.windows.map((w) => `**${w.start.slice(0, 2)}–${w.end.slice(0, 2)} ${PZONE_NAMES[w.personalZone]}** (${w.fitMax})`).join(', ');
  }
  if (day.bestHour) return `knapp: ${day.bestHour.time.slice(11, 13)} Uhr ${ZONE_NAMES[day.bestHour.zone]}, ${PZONE_NAMES[day.bestHour.fit.personalZone]} (${day.bestHour.fit.score})`;
  return `– ${day.noGoReasons[0]?.reason ?? 'nicht fliegbar'}`;
}

function sectorText(spot: Spot): string {
  return `${compass(spot.windSector.from)}–${compass(spot.windSector.to)} (${spot.windSector.from}–${spot.windSector.to}°)`;
}

function hourRow(h: HourEvaluation): string {
  const d = h.dimensions;
  const m = h.metrics;
  const keyData: string[] = [`Start ${Math.round(m.takeoffWindKmh)} km/h ${compass(m.takeoffWindDir)}`];
  keyData.push(`darüber ${Math.round(m.windAboveKmh)} km/h ${compass(m.windAboveDir)}`);
  if (m.wStar > 0.3) keyData.push(`w* ${m.wStar}, Steigen ~${m.climbEstimate} m/s`);
  if (m.workingHeight > 0) keyData.push(m.cloudBaseMsl !== null ? `Basis ${m.cloudBaseMsl} m` : `Thermik bis ${m.thermalTopMsl} m`);
  if (m.inversion) keyData.push(`Inversion ${m.inversion.baseMsl} m (+${m.inversion.strengthK} K)`);
  keyData.push(`Böen ${Math.round(m.gustKmh)} km/h`);
  let why = h.noGo.length > 0 ? h.noGo.map((r) => r.text).join('; ') : [...h.fit.notes, ...h.warnings].join('; ');
  if (h.zone === 'no-go' && h.noGo.length === 0) {
    // Zone ist No-Go, weil eine Dimension zu hoch liegt: deren Gründe nennen
    const culprits = Object.values(d).filter((x) => x.score >= 4.5);
    why = culprits.map((x) => `${x.label}: ${x.reasons.join(', ')}`).join('; ') || why;
  }
  const fit = h.zone === 'no-go' ? '–' : `${h.fit.score} ${PZONE_NAMES[h.fit.personalZone]}`;
  return `| ${h.time.slice(11, 16)} | ${h.zoneLabel} | ${fit} | ${d.wind_comfort.display} | ${d.thermic_character.display} | ${d.shear_turbulence.display} | ${d.structure_cap.display} | ${keyData.join(' · ')} | ${why || '–'} |`;
}

function bySite(evals: SpotEvaluation[]): { site: Site; evals: SpotEvaluation[] }[] {
  return SITE_LIST.map((site) => ({ site, evals: evals.filter((e) => e.spot.site.id === site.id) })).filter((g) => g.evals.length > 0);
}

function renderMarkdown(evals: SpotEvaluation[]): string {
  const stamp = localStamp(evals[0].fetchedAt).text;
  const goal = GOAL_NAMES[pilot.comfort_profile.pilot_profile];
  const groups = bySite(evals);
  const lines: string[] = [];
  lines.push('# Flugwetter-Auswertung Schwarzwald (Prototyp)');
  lines.push('');
  lines.push(`Vorhersage vom ${stamp} · Modell ICON des DWD (D2 und EU kombiniert) über Open-Meteo · Tagesmodus: ${goal} · ${groups.length} Gelände, ${evals.length} Startplätze`);
  lines.push('');
  lines.push('Pro Stunde bewertet die Engine vier Dimensionen auf einer Skala von 0 bis 5 mit Unterstufen (zum Beispiel „2+“) und den Lufttyp (ruhig, lebhaft, Streckenwetter oder No-Go). Aus deinen Grenzen ergibt sich die persönliche Zone (Komfort, Progress, Challenge, Überforderung) und die Passung zum Tagesmodus (0 bis 100). Zusammenhängende Stunden ab einer Passung von 60 ergeben ein Flugfenster; der Modus Chill lässt nur Komfort zu, Progress bis Progress, XC bis Challenge.');
  lines.push('');

  // Überblick: Startplätze als Zeilen, Tage als Spalten
  const allDates = [...new Set(evals.flatMap((e) => relevantDays(e).map((d) => d.date)))].sort();
  lines.push('## Überblick: Flugfenster pro Tag');
  lines.push('');
  lines.push(`| Startplatz | ${allDates.map(dayLabel).join(' | ')} |`);
  lines.push(`|---|${allDates.map(() => '---').join('|')}|`);
  for (const ev of evals) {
    const cells = allDates.map((date) => {
      const day = ev.days.find((d) => d.date === date);
      return day ? shortVerdict(day) : '';
    });
    lines.push(`| ${ev.spot.name} | ${cells.join(' | ')} |`);
  }
  lines.push('');
  lines.push('Fett: Flugfenster mit der besten persönlichen Passung in Klammern (0 bis 100). „knapp“: fliegbar, aber unter 60 Passung. Strich: kein fliegbarer Moment, mit dem häufigsten Grund.');
  lines.push('');

  // Gelände und Vereine
  lines.push('## Gelände und Vereine');
  lines.push('');
  lines.push('| Gelände | Region | Geländehalter | Startplätze | DHV-Nr. |');
  lines.push('|---|---|---|---|---|');
  for (const g of groups) {
    const club = g.site.url ? `[${g.site.club}](${g.site.url})` : g.site.club;
    const starts = g.evals.map((e) => `${e.spot.name} (${e.spot.elevation} m, ${compass(e.spot.facing)})`).join(', ');
    lines.push(`| ${g.site.name} | ${g.site.region} | ${club} | ${starts} | ${g.site.dhvItem} |`);
  }
  lines.push('');

  for (const g of groups) {
    lines.push(`## ${g.site.name}`);
    lines.push('');
    lines.push(`${g.site.region} · Geländehalter: ${g.site.club} · Modellgelände an dieser Stelle ${g.evals[0].modelElevation} m`);
    lines.push('');
    for (const ev of g.evals) {
      const s = ev.spot;
      lines.push(`### ${s.name}`);
      lines.push('');
      lines.push(
        `Start ${s.elevation} m, Windfenster ${sectorText(s)}, höchstens ${s.maxWindKmh} km/h` +
          (s.landing ? ` · Landeplatz ${s.landing.name}, ${s.landing.elevation} m` : '') +
          (s.needsHeadwind ? ' · Start im Wald: braucht klaren Gegenwind' : ''),
      );
      lines.push('');
      if (s.notes.length > 0) {
        lines.push('Hinweise zum Gelände:');
        for (const n of s.notes) lines.push(`- ${n}`);
        if (s.airspace) lines.push(`- ${s.airspace.note}.`);
        lines.push('');
      }
      if (s.needsReview.length > 0) {
        lines.push('Bitte prüfen (meine Annahmen):');
        for (const n of s.needsReview) lines.push(`- ${n}`);
        lines.push('');
      }
      for (const day of relevantDays(ev)) {
        const dayHours = ev.hours.filter((x) => x.isDay && x.time.startsWith(day.date));
        const anyFlyable = dayHours.some((h) => h.zone !== 'no-go');
        if (!anyFlyable) {
          // Ganzer Tag No-Go: eine Zeile reicht
          const reasons = day.noGoReasons.map((r) => `${r.reason} (${r.hours} h)`).join(', ');
          lines.push(`**${dayLabel(day.date)}:** nicht fliegbar. ${reasons}`);
          lines.push('');
          continue;
        }
        lines.push(`#### ${dayLabel(day.date)}: ${day.verdict}`);
        lines.push('');
        if (day.noGoReasons.length > 0) {
          lines.push(`Gründe gegen das Fliegen: ${day.noGoReasons.map((r) => `${r.reason} (${r.hours} h)`).join(', ')}`);
          lines.push('');
        }
        lines.push('| Uhr | Lufttyp | Passung, Zone | Wind | Thermik | Scherung | Deckel | Kennwerte | Begründung |');
        lines.push('|---|---|---|---|---|---|---|---|---|');
        for (const h of dayHours) lines.push(hourRow(h));
        lines.push('');
      }
    }
  }

  lines.push('## So sind die Skalen eingestellt');
  lines.push('');
  lines.push('- **Wind (Windkomfort):** Wind in Starthöhe, 0 = unter 1 km/h, 1 = 5, 2 = 10, 3 = 15, 4 = 22, 5 = ab 30 km/h. Deutlich stärkerer Wind in der Flugschicht oder kräftige Böen heben die Stufe an.');
  lines.push('- **Thermik:** aus der konvektiven Geschwindigkeit w* (Einstrahlung und Höhe der Thermikschicht). 1 = w* 1 m/s, 2 = 1,5, 3 = 2,0, 4 = 2,6, 5 = ab 3,3 m/s oder Überentwicklungspotenzial. Reicht die Thermik kaum über den Start, wird gedeckelt.');
  lines.push('- **Scherung/Turbulenz:** der stärkste von mehreren Treibern: Windscherung in der Flugschicht (m/s pro km), Böen über dem Grundwind, Böenfaktor, Wind im Verhältnis zur Thermikstärke (zerrissene Bärte) und kräftige Thermik selbst. Kommen mehrere zusammen, gibt es einen Aufschlag. Höhenwind aus anderer Richtung als am Start erhöht den Wert (Lee).');
  lines.push('- **Struktur/Deckel:** nutzbare Höhe über dem Start bis Thermikobergrenze oder Basis: 1 = ca. 350 m, 2 = 700 m, 3 = 1200 m, 4 = über 2000 m oder hochreichende Konvektion.');
  lines.push('- **No-Go** gilt bei Nacht, Niederschlag, Gewitter, Nebel, Start in der Wolke, Basis knapp über dem Start, zu viel Wind oder Böen, Wind aus falscher Richtung ab 8 km/h (bei Starts im Wald schon ab 5 km/h), Höhenwind von hinten ab 12 km/h (Lee) und den Gefahrenregeln der Gelände.');
  lines.push('- **Passung:** 100 minus Abzüge, wenn eine Dimension über deiner Toleranz aus der user_konfig liegt (gewichtet), und minus 25, wenn es für dein Ziel nicht reicht.');
  lines.push('');
  lines.push('Alle Schwellen stehen in `src/config.ts` und sind Startwerte. Genau die sollen später durch dein Profil und die Flugbewertungen der Community nachjustiert werden.');
  lines.push('');
  return lines.join('\n');
}

const fx = await loadFixture();
const evals: SpotEvaluation[] = [];
for (const spot of SPOTS) {
  const raw = fx.spots[spot.site.id];
  if (!raw) {
    console.warn(`Keine Vorhersage für ${spot.site.name} in der Datei, ${spot.name} fehlt.`);
    continue;
  }
  evals.push(evaluateForecast(spot, parseResponse(raw, { fetchedAt: fx.fetched_at }), pilot));
}
mkdirSync(join(root, 'out'), { recursive: true });
writeFileSync(join(root, 'out/auswertung.json'), JSON.stringify(evals, null, 1));
writeFileSync(join(root, 'out/auswertung.md'), renderMarkdown(evals));

for (const ev of evals) {
  console.log(`\n${ev.spot.name}`);
  for (const d of relevantDays(ev)) console.log(`  ${dayLabel(d.date)}  ${d.verdict}`);
}
console.log('\nGeschrieben: out/auswertung.md, out/auswertung.json');
