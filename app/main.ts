// Flugwetter für mich: die Handy-App (Schritt 2).
// Holt die Vorhersage direkt bei Open-Meteo (oder nimmt einen gespeicherten bzw. mitgelieferten Stand),
// bewertet sie mit der Engine aus Schritt 1 und zeigt die Flugfenster, die zu deinem Pilotenprofil passen.

import { SITE_LIST, SPOTS } from '../src/spots.ts';
import { buildUrl, fetchRaw, parseResponse, type OpenMeteoResponse } from '../src/openmeteo.ts';
import { evaluateForecast, rescoreForPilot } from '../src/engine.ts';
import { clockTime, compass, sunTimes } from '../src/physics.ts';
import { DIM_NAMES, GOAL_NAMES } from '../src/profile.ts';
import { ZONE_NAMES } from '../src/windows.ts';
import { DEFAULT_CONFIG } from '../src/config.ts';
import type { DaySummary, DimensionKey, Goal, HourEvaluation, PilotProfile, Spot, SpotEvaluation } from '../src/types.ts';

declare const __DEFAULT_PILOT__: PilotProfile;

interface Snapshot {
  fetched_at: string;
  spots: Record<string, OpenMeteoResponse>;
}
type DataMode = 'live' | 'cache' | 'snapshot';
type View = 'fenster' | 'profil' | 'info' | 'detail';

const PROFILE_KEY = 'flugwetter.profil.v1';
const CACHE_KEY = 'flugwetter.vorhersage.v1';
const REGION_KEY = 'flugwetter.region.v1';
const CACHE_FRESH_MIN = 60;
const DIM_KEYS: DimensionKey[] = ['wind_comfort', 'thermic_character', 'shear_turbulence', 'structure_cap'];
const DIM_SHORT: Record<DimensionKey, string> = {
  wind_comfort: 'Wind',
  thermic_character: 'Thermik',
  shear_turbulence: 'Scherung',
  structure_cap: 'Deckel',
};
const REGIONS = [
  { id: 'alle', label: 'Alle', region: '' },
  { id: 'nord', label: 'Nord', region: 'Nordschwarzwald' },
  { id: 'mitte', label: 'Mitte', region: 'Mittlerer Schwarzwald' },
  { id: 'sued', label: 'Süd', region: 'Südschwarzwald' },
];
const GOAL_HINT: Record<Goal, string> = {
  chill: 'ruhig gleiten, wenig Thermik',
  progress: 'nutzbare Thermik zum Üben',
  xc: 'kräftige Thermik für Strecke',
};
const DIM_HINT: Record<DimensionKey, string> = {
  wind_comfort: '0 windstill, 2 mäßig (um 10 km/h), 4 kräftig (über 20 km/h)',
  thermic_character: '1 schwach und flach, 3 gut nutzbar, 4 kräftig und sportlich',
  shear_turbulence: '1 ruhig, 3 bewegt, 4 ruppig',
  structure_cap: '1 flach gedeckelt, 3 gute Arbeitshöhe, 4 hochreichend',
};

// ---------------------------------------------------------------------------
// Zustand
// ---------------------------------------------------------------------------

const state = {
  view: 'fenster' as View,
  spotId: '',
  day: '',
  region: readStore(REGION_KEY) ?? 'alle',
  pilot: loadProfile(),
  mode: null as DataMode | null,
  fetchedAt: '',
  liveProblem: '',
  base: [] as SpotEvaluation[],
  evals: [] as SpotEvaluation[],
  loading: 'Lade Vorhersage …',
  error: '',
};

// In der Claude-Vorschau sperrt der Browser Abrufe an fremde Server (Content Security Policy). Dann gibt es dort nur den
// mitgelieferten Datenstand, und „Aktualisieren“ wird ausgeblendet.
let liveBlocked = false;
document.addEventListener('securitypolicyviolation', (e) => {
  if (!e.blockedURI.includes('open-meteo')) return;
  liveBlocked = true;
  const button = document.getElementById('refresh');
  if (button) button.hidden = true;
  if (state.view === 'info') render();
  else renderStatus();
});

// Läuft die App schon als Icon vom Startbildschirm, braucht sie den Hinweis dazu nicht.
const standalone =
  window.matchMedia?.('(display-mode: standalone)').matches === true ||
  (navigator as Navigator & { standalone?: boolean }).standalone === true;

const link = (href: string, text: string) => h('a', { href, target: '_blank', rel: 'noopener' }, text);

function describeLiveProblem(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (e instanceof TypeError && /fetch|load failed|network/i.test(msg)) return 'keine Verbindung zu Open-Meteo';
  if (/limit/i.test(msg)) return 'Abruflimit von Open-Meteo erreicht';
  if (msg === 'Zeitüberschreitung') return 'Open-Meteo antwortet zu langsam';
  return msg;
}

// ---------------------------------------------------------------------------
// Speicher (nur dieses Gerät; darf fehlen)
// ---------------------------------------------------------------------------

function readStore(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStore(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // privater Modus oder voller Speicher: dann eben ohne
  }
}

function clonePilot(p: PilotProfile): PilotProfile {
  return JSON.parse(JSON.stringify(p)) as PilotProfile;
}

function loadProfile(): PilotProfile {
  const raw = readStore(PROFILE_KEY);
  if (raw) {
    try {
      const p = JSON.parse(raw) as PilotProfile;
      if (p?.comfort_profile?.tolerance && p.comfort_profile.min_required_scores_for_goal) return p;
    } catch {
      // kaputter Eintrag: Standard nehmen
    }
  }
  return clonePilot(__DEFAULT_PILOT__);
}

function saveProfile(): void {
  writeStore(PROFILE_KEY, JSON.stringify(state.pilot));
}

function readCache(): Snapshot | null {
  const raw = readStore(CACHE_KEY);
  if (!raw) return null;
  try {
    const s = JSON.parse(raw) as Snapshot;
    return s.fetched_at && s.spots ? s : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Zeit
// ---------------------------------------------------------------------------

const berlinFmt = new Intl.DateTimeFormat('de-DE', {
  timeZone: 'Europe/Berlin',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

function berlin(d: Date): { date: string; hour: number; text: string } {
  const p = Object.fromEntries(berlinFmt.formatToParts(d).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour), text: `${p.day}.${p.month}., ${p.hour}:${p.minute} Uhr` };
}

const WEEKDAYS = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
const WEEKDAYS_LONG = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];

function addDays(date: string, n: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function dayName(date: string, long = false): string {
  const today = berlin(new Date()).date;
  if (date === today) return 'Heute';
  if (date === addDays(today, 1)) return 'Morgen';
  const wd = new Date(`${date}T12:00:00Z`).getUTCDay();
  return long ? WEEKDAYS_LONG[wd] : WEEKDAYS[wd];
}

function dateShort(date: string): string {
  return `${date.slice(8, 10)}.${date.slice(5, 7)}.`;
}

function isPast(time: string): boolean {
  const now = berlin(new Date());
  const date = time.slice(0, 10);
  return date < now.date || (date === now.date && Number(time.slice(11, 13)) < now.hour);
}

function minutesSince(iso: string): number {
  return (Date.now() - new Date(iso).getTime()) / 60000;
}

// ---------------------------------------------------------------------------
// Daten holen
// ---------------------------------------------------------------------------

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('Zeitüberschreitung')), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

async function fetchLive(progress: (done: number) => void): Promise<Snapshot> {
  // Kurzer Test, ob Open-Meteo erreichbar ist. In der Claude-Vorschau sperrt der Browser fremde Server.
  const probe = await withTimeout(fetch(buildUrl(SITE_LIST[0], { forecastDays: 1 }, ['temperature_2m'])), 6000);
  if (!probe.ok) {
    const text = await probe.text().catch(() => '');
    throw new Error(/limit/i.test(text) ? 'Abruflimit erreicht' : `Antwort ${probe.status}`);
  }
  const spots: Record<string, OpenMeteoResponse> = {};
  const queue = [...SITE_LIST];
  let done = 0;
  const worker = async () => {
    for (let site = queue.shift(); site; site = queue.shift()) {
      spots[site.id] = await withTimeout(fetchRaw(site), 60000);
      progress(++done);
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  return { fetched_at: new Date().toISOString(), spots };
}

const pause = () => new Promise((r) => setTimeout(r, 30));

async function loadData(force: boolean): Promise<void> {
  state.error = '';
  if (!force) {
    const cached = readCache();
    if (cached && minutesSince(cached.fetched_at) < CACHE_FRESH_MIN) {
      await useSnapshot(cached, 'cache');
      return;
    }
  }
  setLoading('Hole Vorhersage bei Open-Meteo …');
  try {
    const snap = await fetchLive((done) => setLoading(`Hole Vorhersage bei Open-Meteo … ${done} von ${SITE_LIST.length} Geländen`));
    writeStore(CACHE_KEY, JSON.stringify(snap));
    state.liveProblem = '';
    await useSnapshot(snap, 'live');
    return;
  } catch (e) {
    state.liveProblem = describeLiveProblem(e);
  }
  const cached = readCache();
  if (cached) {
    await useSnapshot(cached, 'cache');
    return;
  }
  try {
    setLoading('Lade mitgelieferten Datenstand …');
    const res = await fetch('data/forecast.json');
    if (!res.ok) throw new Error(`Antwort ${res.status}`);
    await useSnapshot((await res.json()) as Snapshot, 'snapshot');
  } catch {
    state.loading = '';
    state.error =
      'Keine Vorhersage verfügbar: Open-Meteo ist gerade nicht erreichbar und es gibt keinen gespeicherten Stand. Prüfe die Internetverbindung und tippe dann auf „Aktualisieren“.';
    render();
  }
}

async function useSnapshot(snap: Snapshot, mode: DataMode): Promise<void> {
  setLoading('Bewerte die Startplätze …');
  await pause();
  const base: SpotEvaluation[] = [];
  for (const spot of SPOTS) {
    const raw = snap.spots[spot.site.id];
    if (!raw) continue;
    base.push(evaluateForecast(spot, parseResponse(raw, { fetchedAt: snap.fetched_at }), state.pilot));
  }
  state.base = base;
  state.evals = base;
  state.mode = mode;
  state.fetchedAt = snap.fetched_at;
  state.loading = '';
  const days = visibleDays();
  if (!days.includes(state.day)) state.day = defaultDay(days);
  render();
}

function setLoading(text: string): void {
  state.loading = text;
  renderStatus();
}

function rescore(): void {
  state.evals = state.base.map((ev) => rescoreForPilot(ev, state.pilot));
}

// ---------------------------------------------------------------------------
// Auswahl
// ---------------------------------------------------------------------------

function visibleDays(): string[] {
  const now = berlin(new Date());
  const dates = [...new Set(state.evals.flatMap((e) => e.days.map((d) => d.date)))].sort();
  const ahead = dates.filter((date) =>
    state.evals.some((e) => e.hours.some((h) => h.isDay && h.time.startsWith(date) && !isPast(h.time))),
  );
  // Ist der Datenstand so alt, dass kein Tag mehr vor uns liegt, zeigen wir trotzdem alles (mit Warnung oben).
  return ahead.length > 0 ? ahead : dates.filter((d) => d <= addDays(now.date, 10));
}

function defaultDay(days: string[]): string {
  return days.find((d) => state.evals.some((e) => e.days.find((x) => x.date === d)?.windows.length)) ?? days[0] ?? '';
}

function regionEvals(): SpotEvaluation[] {
  const r = REGIONS.find((x) => x.id === state.region);
  return !r || !r.region ? state.evals : state.evals.filter((e) => e.spot.site.region === r.region);
}

function dayOf(ev: SpotEvaluation, date: string): DaySummary | undefined {
  return ev.days.find((d) => d.date === date);
}

function bestFit(day: DaySummary): number {
  if (day.windows.length > 0) return Math.max(...day.windows.map((w) => w.fitMax));
  return day.bestHour?.fit.score ?? 0;
}

function windowHours(day: DaySummary): number {
  return day.windows.reduce((a, w) => a + w.hours, 0);
}

// ---------------------------------------------------------------------------
// DOM-Helfer (Texte immer über textContent)
// ---------------------------------------------------------------------------

type Child = Node | string | number | null | undefined | false;

function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Record<string, unknown> = {},
  ...children: (Child | Child[])[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = String(v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v as EventListener);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : String(c));
  }
  return el;
}

const num1 = (x: number) => x.toLocaleString('de-DE', { maximumFractionDigits: 1 });
const kmh = (x: number) => `${Math.round(x)} km/h`;

function zonePill(zone: HourEvaluation['zone'], text: string): HTMLElement {
  return h('span', { class: `pill z-${zone}` }, text);
}

function windowText(w: DaySummary['windows'][number]): string {
  return `${w.start.slice(0, 2)}–${w.end.slice(0, 2)} Uhr · ${ZONE_NAMES[w.zone]}`;
}

function hourStrip(ev: SpotEvaluation, date: string): HTMLElement {
  const hours = ev.hours.filter((x) => x.isDay && x.time.startsWith(date));
  if (hours.length === 0) return h('div');
  const min = DEFAULT_CONFIG.windowMinFit;
  const bars = hours.map((x) => {
    const weak = x.zone !== 'no-go' && x.fit.score < min;
    const cls = [`z-${x.zone}`, weak ? 'weak' : '', isPast(x.time) ? 'past' : ''].filter(Boolean).join(' ');
    const title = `${x.time.slice(11, 16)} ${x.zoneLabel}${x.zone === 'no-go' ? '' : `, Passung ${x.fit.score}`}`;
    return h('span', { class: cls, title });
  });
  return h(
    'div',
    { class: 'strip', 'aria-hidden': 'true' },
    h('div', { class: 'bars' }, bars),
    h('div', { class: 'ticks' }, h('span', {}, hours[0].time.slice(11, 13)), h('span', {}, String(Number(hours[hours.length - 1].time.slice(11, 13)) + 1))),
  );
}

// ---------------------------------------------------------------------------
// Kopfzeile
// ---------------------------------------------------------------------------

function renderStatus(): void {
  const status = document.getElementById('status');
  if (!status) return;
  status.className = 'status';
  status.replaceChildren();
  if (state.loading) {
    status.append(state.loading);
    return;
  }
  if (state.error || !state.mode) {
    status.append(h('strong', {}, 'Keine Daten'));
    status.classList.add('warn');
    return;
  }
  const when = berlin(new Date(state.fetchedAt)).text;
  const age = minutesSince(state.fetchedAt);
  if (state.mode === 'live') {
    status.append(h('strong', {}, 'Live'), ` · Vorhersage von ${when}, ICON (DWD) über Open-Meteo`);
  } else if (state.mode === 'cache') {
    status.append(h('strong', {}, 'Gespeichert'), ` · Vorhersage von ${when}`);
    if (state.liveProblem && !liveBlocked) status.append(`. Aktualisieren gerade nicht möglich: ${state.liveProblem}.`);
    if (age > 180) status.classList.add('warn');
  } else {
    status.classList.add('warn');
    const why =
      liveBlocked || !state.liveProblem
        ? 'Hier gibt es keinen Live-Abruf, die Daten sind fest mitgeliefert.'
        : `Live-Abruf gerade nicht möglich (${state.liveProblem}), deshalb dieser mitgelieferte Stand.`;
    status.append(h('strong', {}, 'Beispielstand'), ` vom ${when}. ${why}`);
  }
}

function renderTabs(): void {
  for (const id of ['fenster', 'profil', 'info']) {
    const a = document.getElementById(`tab-${id}`);
    if (!a) continue;
    const active = state.view === id || (id === 'fenster' && state.view === 'detail');
    if (active) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
}

// ---------------------------------------------------------------------------
// Ansicht: Flugfenster
// ---------------------------------------------------------------------------

/** Tageswahl. Ohne Startplatz: wie viele Startplätze ein Fenster haben. Mit Startplatz: dessen Fenster. */
function dayChips(onPick: (d: string) => void, single?: SpotEvaluation): HTMLElement {
  const days = visibleDays();
  return h(
    'div',
    { class: 'days', role: 'group', 'aria-label': 'Tag wählen' },
    days.map((date) => {
      const evs = single ? [single] : regionEvals();
      const withWin = evs.filter((e) => (dayOf(e, date)?.windows.length ?? 0) > 0);
      const wins = withWin.flatMap((e) => dayOf(e, date)!.windows);
      const best = [...wins].sort((a, b) => b.fitMax - a.fitMax)[0];
      let text: string;
      if (single) {
        const day = dayOf(single, date);
        text = wins.length > 0 ? wins.map((w) => `${w.start.slice(0, 2)}–${w.end.slice(0, 2)}`).join(', ') : day?.bestHour ? 'nur knapp' : 'nicht fliegbar';
      } else {
        text = withWin.length > 0 ? `${withWin.length} mit Fenster` : 'kein Fenster';
      }
      return h(
        'button',
        { class: 'day', type: 'button', 'aria-pressed': String(date === state.day), onclick: () => onPick(date) },
        h('span', { class: 'd1' }, `${dayName(date)} ${dateShort(date)}`),
        h('span', { class: 'd2' }, text),
        h('span', { class: 'dots' }, best ? h('i', { class: `z-${best.zone}` }) : h('i')),
      );
    }),
  );
}

function regionChips(): HTMLElement {
  return h(
    'div',
    { class: 'filters', role: 'group', 'aria-label': 'Region' },
    REGIONS.map((r) =>
      h(
        'button',
        {
          class: 'chip',
          type: 'button',
          'aria-pressed': String(state.region === r.id),
          onclick: () => {
            state.region = r.id;
            writeStore(REGION_KEY, r.id);
            render();
          },
        },
        r.label,
      ),
    ),
  );
}

function spotCard(ev: SpotEvaluation, day: DaySummary): HTMLElement {
  const s = ev.spot;
  const fit = bestFit(day);
  const wins = day.windows.length > 0
    ? day.windows.map((w) => zonePill(w.zone, windowText(w)))
    : day.bestHour
      ? [h('span', { class: 'small' }, `Beste Stunde ${day.bestHour.time.slice(11, 13)} Uhr: ${day.bestHour.zoneLabel}, ${day.bestHour.fit.label}`)]
      : [];
  return h(
    'button',
    { class: 'card', type: 'button', onclick: () => openSpot(s.id) },
    h(
      'span',
      { class: 'row1' },
      h('span', { class: 'name' }, s.name),
      h('span', { class: 'fit', title: 'beste persönliche Passung (0 bis 100)' }, String(fit), h('small', {}, '/100')),
    ),
    h('span', { class: 'meta' }, `${s.site.name} · ${s.elevation} m · Start nach ${compass(s.facing)}`),
    h('span', { class: 'wins' }, wins),
    hourStrip(ev, day.date),
  );
}

function renderWindows(view: HTMLElement): void {
  const date = state.day;
  const rows = regionEvals()
    .map((ev) => ({ ev, day: dayOf(ev, date) }))
    .filter((r): r is { ev: SpotEvaluation; day: DaySummary } => !!r.day);
  const good = rows.filter((r) => r.day.windows.length > 0).sort((a, b) => bestFit(b.day) - bestFit(a.day) || windowHours(b.day) - windowHours(a.day));
  const meh = rows.filter((r) => r.day.windows.length === 0 && r.day.bestHour).sort((a, b) => bestFit(b.day) - bestFit(a.day));
  const bad = rows.filter((r) => r.day.windows.length === 0 && !r.day.bestHour);

  const spot0 = rows[0]?.ev.spot ?? SPOTS[0];
  const sun = date ? sunTimes(spot0.lat, spot0.lon, date) : null;
  view.append(
    dayChips((d) => {
      state.day = d;
      render();
    }),
    regionChips(),
    h(
      'div',
      { class: 'dayhead' },
      h('h2', {}, date ? `${dayName(date, true)}, ${dateShort(date)}` : 'Kein Tag'),
      h(
        'p',
        {},
        `${good.length} von ${rows.length} Startplätzen mit Flugfenster für dein Profil (${GOAL_NAMES[state.pilot.comfort_profile.pilot_profile]})` +
          (sun ? ` · Sonne ${clockTime(sun.sunrise)} bis ${clockTime(sun.sunset)} Uhr` : ''),
      ),
    ),
  );

  if (good.length > 0) {
    view.append(h('section', { class: 'group' }, h('h3', {}, 'Passt zu dir'), good.map((r) => spotCard(r.ev, r.day))));
  } else {
    view.append(h('p', { class: 'empty' }, 'An diesem Tag passt kein Startplatz zu deinem Profil. Weiter unten steht, was fliegbar wäre und was dagegen spricht.'));
  }
  if (meh.length > 0) {
    view.append(h('section', { class: 'group' }, h('h3', {}, 'Fliegbar, aber nicht dein Ziel'), meh.map((r) => spotCard(r.ev, r.day))));
  }
  if (bad.length > 0) {
    view.append(
      h(
        'section',
        { class: 'group' },
        h('h3', {}, 'Nicht fliegbar'),
        h(
          'div',
          { class: 'nogo-list' },
          bad.map((r) =>
            h(
              'button',
              { type: 'button', onclick: () => openSpot(r.ev.spot.id) },
              h('span', { class: 'n' }, r.ev.spot.name),
              h('span', { class: 'r' }, r.day.noGoReasons.slice(0, 2).map((x) => x.reason).join(', ') || 'nicht fliegbar'),
            ),
          ),
        ),
      ),
    );
  }
}

function openSpot(id: string): void {
  location.hash = id;
}

// ---------------------------------------------------------------------------
// Ansicht: Startplatz im Detail
// ---------------------------------------------------------------------------

function dimCell(k: DimensionKey, x: HourEvaluation): HTMLElement {
  const d = x.dimensions[k];
  const tol = state.pilot.comfort_profile.tolerance[k]?.max_score_acceptable;
  const over = tol !== undefined && d.score > tol;
  return h(
    'div',
    { class: 'dim', title: `${DIM_NAMES[k]}: ${d.label}` },
    h('span', { class: 'dl' }, h('span', {}, DIM_SHORT[k]), h('b', {}, d.display)),
    h(
      'span',
      { class: 'bar' },
      h('span', { class: over ? 'over' : '', style: `width:${(d.score / 5) * 100}%` }),
      tol !== undefined ? h('i', { style: `left:calc(${(tol / 5) * 100}% - 1px)`, title: `deine Grenze ${num1(tol)}` }) : null,
    ),
  );
}

function keyData(x: HourEvaluation): string {
  const m = x.metrics;
  const parts = [`Start ${kmh(m.takeoffWindKmh)} aus ${compass(m.takeoffWindDir)}`, `darüber ${kmh(m.windAboveKmh)} aus ${compass(m.windAboveDir)}`];
  if (m.wStar > 0.3) parts.push(m.climbEstimate >= 0.2 ? `Steigen ca. ${num1(m.climbEstimate)} m/s` : 'kaum nutzbares Steigen');
  if (m.workingHeight > 0) parts.push(m.cloudBaseMsl !== null ? `Basis ${m.cloudBaseMsl} m` : `Thermik bis ${m.thermalTopMsl} m`);
  if (m.inversion) parts.push(`Inversion ${m.inversion.baseMsl} m`);
  parts.push(`Böen ${kmh(m.gustKmh)}`);
  return parts.join(' · ');
}

function hourRow(x: HourEvaluation): HTMLElement {
  const notes: HTMLElement[] = [];
  for (const r of x.noGo) notes.push(h('li', { class: 'nogo' }, r.text));
  if (x.zone === 'no-go' && x.noGo.length === 0) {
    for (const d of Object.values(x.dimensions).filter((d) => d.score >= 4.5)) {
      notes.push(h('li', { class: 'nogo' }, `${DIM_NAMES[d.key]}: ${d.reasons.join(', ')}`));
    }
  }
  if (x.zone !== 'no-go') for (const n of x.fit.notes) notes.push(h('li', { class: 'info' }, n));
  for (const w of x.warnings) notes.push(h('li', { class: 'warn' }, w));

  return h(
    'article',
    { class: `hour${isPast(x.time) ? ' past' : ''}` },
    h(
      'div',
      { class: 'h1' },
      h('time', { datetime: x.time }, x.time.slice(11, 16)),
      zonePill(x.zone, x.zoneLabel),
      h('span', { class: 'fitline' }, x.zone === 'no-go' ? '' : h('span', {}, h('b', {}, String(x.fit.score)), ` ${x.fit.label}`)),
    ),
    h('div', { class: 'dims' }, DIM_KEYS.map((k) => dimCell(k, x))),
    h('p', { class: 'keydata' }, keyData(x)),
    notes.length > 0 ? h('ul', { class: 'notes' }, notes) : null,
    h(
      'details',
      { class: 'why' },
      h('summary', {}, 'Begründung der Stufen'),
      h(
        'ul',
        {},
        DIM_KEYS.map((k) => {
          const d = x.dimensions[k];
          return h('li', {}, `${DIM_NAMES[k]} ${d.display} (${d.label}): ${d.reasons.join(', ') || 'keine Besonderheit'}`);
        }),
      ),
    ),
  );
}

function fact(label: string, value: string): HTMLElement {
  return h('div', {}, h('dt', {}, label), h('dd', {}, value));
}

function renderDetail(view: HTMLElement): void {
  const ev = state.evals.find((e) => e.spot.id === state.spotId);
  if (!ev) {
    view.append(h('p', { class: 'empty' }, 'Diesen Startplatz gibt es nicht.'));
    return;
  }
  const s: Spot = ev.spot;
  const date = state.day;
  const day = dayOf(ev, date);
  const sun = date ? sunTimes(s.lat, s.lon, date) : null;
  const facts = [
    fact('Start', `${s.elevation} m, nach ${compass(s.facing)}`),
    fact('Windfenster', `${compass(s.windSector.from)}–${compass(s.windSector.to)} (${s.windSector.from}–${s.windSector.to}°)`),
    fact('Wind höchstens', `${s.maxWindKmh} km/h`),
  ];
  if (s.landing) facts.push(fact('Landeplatz', `${s.landing.name}, ${s.landing.elevation} m`));
  if (s.needsHeadwind) facts.push(fact('Start im Wald', 'braucht klaren Gegenwind'));
  if (s.operatingHours && sun) {
    const from = s.operatingHours.afterSunriseH !== undefined ? clockTime(sun.sunrise + s.operatingHours.afterSunriseH) : clockTime(sun.sunrise);
    const to = s.operatingHours.beforeSunsetH !== undefined ? clockTime(sun.sunset - s.operatingHours.beforeSunsetH) : clockTime(sun.sunset);
    facts.push(fact('Flugzeit laut Auflage', `${from} bis ${to} Uhr`));
  }
  if (s.airspace) facts.push(fact('Luftraum', `D Basel ab ${s.airspace.floorMsl} m`));

  view.append(
    h('button', { class: 'back', type: 'button', onclick: () => (location.hash = 'fenster') }, '‹ Alle Startplätze'),
    h(
      'div',
      { class: 'spothead' },
      h('h2', {}, s.name),
      h('p', {}, `${s.site.name} · ${s.site.region} · ${s.site.club}`),
    ),
    h('dl', { class: 'facts' }, facts),
    dayChips((d) => {
      state.day = d;
      render();
    }, ev),
  );
  if (!day) {
    view.append(h('p', { class: 'empty' }, 'Für diesen Tag gibt es keine Vorhersage.'));
    return;
  }
  view.append(
    h(
      'div',
      { class: 'dayhead' },
      h('h2', {}, `${dayName(date, true)}, ${dateShort(date)}`),
      h('p', { class: 'verdict' }, day.verdict),
      sun ? h('p', { class: 'sun' }, `Sonnenaufgang ${clockTime(sun.sunrise)} · Sonnenuntergang ${clockTime(sun.sunset)} Uhr`) : null,
    ),
    h('div', { class: 'hours' }, ev.hours.filter((x) => x.isDay && x.time.startsWith(date)).map(hourRow)),
  );

  const notes = [...s.notes];
  if (s.airspace) notes.push(`${s.airspace.note}.`);
  view.append(
    h(
      'section',
      { class: 'box' },
      h('h3', {}, 'Gut zu wissen'),
      h('ul', {}, notes.map((n) => h('li', {}, n))),
      h(
        'p',
        { class: 'small' },
        'Quellen: ',
        h('a', { href: `https://service.dhv.de/db2/details.php?qi=glp_details&item=${s.site.dhvItem}`, target: '_blank', rel: 'noopener' }, 'DHV-Geländedatenbank'),
        s.site.url ? ' · ' : '',
        s.site.url ? h('a', { href: s.site.url, target: '_blank', rel: 'noopener' }, 'Vereinsseite') : '',
        ` · Das Wettermodell rechnet hier mit ${ev.modelElevation} m Geländehöhe.`,
      ),
    ),
  );
}

// ---------------------------------------------------------------------------
// Ansicht: Profil
// ---------------------------------------------------------------------------

let rescoreTimer: ReturnType<typeof setTimeout> | undefined;

function profileSummaryText(): string {
  const days = visibleDays();
  let windows = 0;
  const spots = new Set<string>();
  for (const ev of state.evals) {
    for (const d of ev.days) {
      if (!days.includes(d.date)) continue;
      windows += d.windows.length;
      if (d.windows.length > 0) spots.add(ev.spot.id);
    }
  }
  if (days.length === 0) return 'Noch keine Vorhersage geladen.';
  return `Mit diesem Profil: ${windows} Flugfenster an ${spots.size} von ${state.evals.length} Startplätzen in den nächsten ${days.length} Tagen.`;
}

function profileChanged(summary: HTMLElement): void {
  saveProfile();
  clearTimeout(rescoreTimer);
  rescoreTimer = setTimeout(() => {
    rescore();
    summary.textContent = profileSummaryText();
  }, 120);
}

function slider(opts: {
  id: string;
  label: string;
  hint?: string;
  min: number;
  max: number;
  step: number;
  value: number;
  format: (v: number) => string;
  onChange: (v: number) => void;
  disabled?: boolean;
}): HTMLElement {
  const out = h('output', { for: opts.id }, opts.format(opts.value));
  const input = h('input', {
    type: 'range',
    id: opts.id,
    min: opts.min,
    max: opts.max,
    step: opts.step,
    value: opts.value,
    disabled: opts.disabled,
    oninput: (e: Event) => {
      const v = Number((e.target as HTMLInputElement).value);
      out.textContent = opts.format(v);
      opts.onChange(v);
    },
  });
  return h('div', { class: 'slider' }, h('label', { for: opts.id }, h('span', {}, opts.label), out), input, opts.hint ? h('span', { class: 'hint' }, opts.hint) : null);
}

const weightText = (v: number) => (v === 0 ? 'egal' : v < 0.8 ? `niedrig (${num1(v)})` : v <= 1.2 ? `normal (${num1(v)})` : `hoch (${num1(v)})`);

type ReqKey = 'thermic_character_min' | 'wind_comfort_max' | 'shear_turbulence_max' | 'structure_cap_min';
const REQ_LABELS: Record<ReqKey, string> = {
  thermic_character_min: 'Thermik mindestens',
  structure_cap_min: 'Deckel mindestens',
  wind_comfort_max: 'Wind höchstens',
  shear_turbulence_max: 'Scherung höchstens',
};
const REQ_DEFAULT: Record<ReqKey, number> = { thermic_character_min: 2, structure_cap_min: 2, wind_comfort_max: 3, shear_turbulence_max: 3 };

function renderProfile(view: HTMLElement): void {
  const cp = state.pilot.comfort_profile;
  const summary = h('p', { class: 'summary', role: 'status' }, profileSummaryText());

  const goalButtons = h(
    'div',
    { class: 'seg', role: 'group', 'aria-label': 'Ziel' },
    (['chill', 'progress', 'xc'] as Goal[]).map((g) =>
      h(
        'button',
        {
          type: 'button',
          'aria-pressed': String(cp.pilot_profile === g),
          onclick: () => {
            cp.pilot_profile = g;
            saveProfile();
            rescore();
            render();
          },
        },
        h('b', {}, GOAL_NAMES[g]),
        h('span', {}, GOAL_HINT[g]),
      ),
    ),
  );

  const tolerance = DIM_KEYS.map((k) => {
    const t = cp.tolerance[k];
    return h(
      'div',
      { class: 'dimset' },
      h('h4', {}, DIM_NAMES[k]),
      slider({
        id: `tol-${k}`,
        label: 'Höchstens bis Stufe',
        hint: DIM_HINT[k],
        min: 0,
        max: 5,
        step: 0.5,
        value: t.max_score_acceptable,
        format: num1,
        onChange: (v) => {
          t.max_score_acceptable = v;
          profileChanged(summary);
        },
      }),
      slider({
        id: `w-${k}`,
        label: 'Wie wichtig dir das ist',
        min: 0,
        max: 2,
        step: 0.1,
        value: t.importance_weight,
        format: weightText,
        onChange: (v) => {
          t.importance_weight = v;
          profileChanged(summary);
        },
      }),
    );
  });

  const goal = cp.pilot_profile;
  const req = (cp.min_required_scores_for_goal[goal] ??= {});
  const reqRows = (Object.keys(REQ_LABELS) as ReqKey[]).map((key) => {
    const active = req[key] !== undefined;
    const value = req[key] ?? REQ_DEFAULT[key];
    let sliderEl: HTMLElement;
    const check = h('input', {
      type: 'checkbox',
      id: `req-on-${key}`,
      checked: active,
      'aria-label': `${REQ_LABELS[key]} prüfen`,
      onchange: (e: Event) => {
        const on = (e.target as HTMLInputElement).checked;
        if (on) req[key] = Number((sliderEl.querySelector('input') as HTMLInputElement).value);
        else delete req[key];
        (sliderEl.querySelector('input') as HTMLInputElement).disabled = !on;
        profileChanged(summary);
      },
    });
    sliderEl = slider({
      id: `req-${key}`,
      label: REQ_LABELS[key],
      min: 0,
      max: 5,
      step: 0.5,
      value,
      format: num1,
      disabled: !active,
      onChange: (v) => {
        if (req[key] !== undefined) {
          req[key] = v;
          profileChanged(summary);
        }
      },
    });
    return [check, sliderEl];
  });

  view.append(
    h(
      'section',
      { class: 'box' },
      h('h3', {}, 'Dein Ziel'),
      goalButtons,
      summary,
    ),
    h(
      'section',
      { class: 'box' },
      h('h3', {}, 'Was du dir zumutest'),
      h('p', { class: 'small' }, 'Liegt eine Stufe über deiner Grenze, sinkt die Passung, je wichtiger dir die Dimension ist, desto stärker. Die Grenze siehst du in der Stundenansicht als Strich auf dem Balken.'),
      tolerance,
    ),
    h(
      'section',
      { class: 'box' },
      h('h3', {}, `Was ${GOAL_NAMES[goal]} mindestens braucht`),
      h('p', { class: 'small' }, 'Reicht eine Stunde dafür nicht, kostet das 25 Punkte Passung. Haken weg heißt: wird nicht geprüft.'),
      h('div', { class: 'req' }, reqRows.flat()),
    ),
    h(
      'section',
      { class: 'box' },
      h('p', { class: 'small' }, 'Dein Profil wird nur auf diesem Gerät gespeichert. Der Standard entspricht deiner user_konfig.'),
      h(
        'button',
        {
          class: 'btn',
          type: 'button',
          onclick: () => {
            state.pilot = clonePilot(__DEFAULT_PILOT__);
            saveProfile();
            rescore();
            render();
          },
        },
        'Auf Standard zurücksetzen',
      ),
    ),
  );
}

// ---------------------------------------------------------------------------
// Ansicht: Info
// ---------------------------------------------------------------------------

function renderInfo(view: HTMLElement): void {
  const legend = h(
    'div',
    { class: 'legend' },
    zonePill('chill', 'Chill'),
    zonePill('progress', 'Progress'),
    zonePill('xc', 'XC'),
    zonePill('no-go', 'No-Go'),
  );
  const source =
    state.mode !== 'snapshot'
      ? 'Dein Handy holt die Vorhersage selbst bei Open-Meteo, je Gelände in drei Teilen. Ein Abruf bleibt eine Stunde lang auf dem Gerät gespeichert.'
      : liveBlocked
        ? 'In dieser Vorschau sind die Daten ein fester Stand aus Open-Meteo. Läuft die App auf einem normalen Webserver, holt dein Handy die Vorhersage selbst.'
        : 'Gerade siehst du den mitgelieferten Datenstand, weil der Live-Abruf nicht geklappt hat. Tippe später auf „Aktualisieren“.';
  const homeScreen =
    liveBlocked || standalone
      ? null
      : h(
          'section',
          { class: 'box' },
          h('h3', {}, 'Als App auf dem Handy'),
          h(
            'ul',
            {},
            h('li', {}, 'iPhone (Safari): Teilen-Symbol antippen, dann „Zum Home-Bildschirm“.'),
            h('li', {}, 'Android (Chrome): Menü ⋮ antippen, dann „Zum Startbildschirm hinzufügen“ oder „App installieren“.'),
          ),
          h('p', { class: 'small' }, 'Dann startet Flugwetter wie eine normale App. Dein Profil und die letzte Vorhersage bleiben auf dem Handy gespeichert.'),
        );
  if (homeScreen) view.append(homeScreen);
  view.append(
    h(
      'section',
      { class: 'box' },
      h('h3', {}, 'Woher die Daten kommen'),
      h('p', {}, `Wettermodell ICON des Deutschen Wetterdienstes (ICON-D2 mit etwa 2 km für die ersten zwei Tage, danach ICON-EU), abgerufen über Open-Meteo. ${source}`),
      state.fetchedAt ? h('p', { class: 'small' }, `Stand der Vorhersage: ${berlin(new Date(state.fetchedAt)).text}.`) : null,
      state.liveProblem && state.mode !== 'live'
        ? h('p', { class: 'small' }, liveBlocked ? 'In der Claude-Vorschau sind Abrufe an fremde Server gesperrt.' : `Letzter Live-Versuch: ${state.liveProblem}.`)
        : null,
      h(
        'p',
        { class: 'small' },
        'Wetterdaten: ',
        link('https://open-meteo.com/', 'Open-Meteo.com'),
        ' (',
        link('https://creativecommons.org/licenses/by/4.0/', 'CC BY 4.0'),
        '), Modell ICON des ',
        link('https://www.dwd.de/', 'Deutschen Wetterdienstes'),
        '. Geländedaten: DHV-Geländedatenbank und die Websites der Vereine.',
      ),
    ),
    h(
      'section',
      { class: 'box' },
      h('h3', {}, 'Zonen'),
      legend,
      h(
        'ul',
        {},
        h('li', {}, 'Chill: ruhige Luft, schwache oder keine Thermik, gut für Gleitflüge.'),
        h('li', {}, 'Progress: nutzbare Thermik oder Soaring-Wind, auch etwas bewegtere Luft.'),
        h('li', {}, 'XC: kräftige Thermik und genug Arbeitshöhe für Strecke.'),
        h('li', {}, 'No-Go: Nacht, Niederschlag, Nebel, Start in der Wolke, zu viel Wind oder Böen, falsche Windrichtung, Lee, Auflagen des Geländes oder zu heftige Bedingungen.'),
      ),
    ),
    h(
      'section',
      { class: 'box' },
      h('h3', {}, 'Die vier Dimensionen (0 bis 5)'),
      h(
        'ul',
        {},
        h('li', {}, 'Wind: Wind in Starthöhe. 1 = 5 km/h, 2 = 10, 3 = 15, 4 = 22, 5 = ab 30 km/h. Mehr Wind oben oder kräftige Böen heben die Stufe.'),
        h('li', {}, 'Thermik: aus Einstrahlung und Höhe der Thermikschicht. 1 schwach und flach, 3 gut nutzbar, 4 kräftig, 5 Überentwicklung.'),
        h('li', {}, 'Scherung: Windscherung, Böen, Wind im Verhältnis zur Thermik, Lee. 1 ruhig, 3 bewegt, 4 ruppig.'),
        h('li', {}, 'Deckel: nutzbare Höhe über dem Start bis Thermikobergrenze oder Basis. 1 etwa 350 m, 2 700 m, 3 1200 m, 4 über 2000 m.'),
      ),
      h('p', { class: 'small' }, 'Unterstufen: „2−“ ist knapp unter 2, „2+“ knapp darüber. Passung: 100 minus Abzüge, wenn eine Dimension über deiner Grenze liegt, und minus 25, wenn es für dein Ziel nicht reicht. Ab 60 zählt eine Stunde zum Flugfenster.'),
    ),
    h(
      'section',
      { class: 'box' },
      h('h3', {}, 'Grenzen des Prototyps'),
      h(
        'ul',
        {},
        h('li', {}, 'Die Schwellen sind Startwerte und noch nicht an echten Flügen geeicht. Das kommt mit dem Flug-Feedback in Schritt 3.'),
        h('li', {}, 'Das Modellgelände ist geglättet. Düsen, Talwind und lokale Effekte fehlen, am Merkur ist der Wind oft stärker als vorhergesagt.'),
        h('li', {}, 'Bei Windstille gelten alle Startrichtungen eines Bergs als möglich. Welcher Hang Sonne hat, ist noch nicht eingerechnet.'),
        h('li', {}, 'Die App ersetzt nicht den Blick auf Stationen, Webcams und die Lage vor Ort.'),
      ),
    ),
  );
}

// ---------------------------------------------------------------------------
// Rahmen
// ---------------------------------------------------------------------------

function readHash(): void {
  const id = decodeURIComponent(location.hash.slice(1));
  if (id === 'profil' || id === 'info') {
    state.view = id;
  } else if (SPOTS.some((s) => s.id === id)) {
    state.view = 'detail';
    state.spotId = id;
  } else {
    state.view = 'fenster';
  }
}

function render(): void {
  renderStatus();
  renderTabs();
  const view = document.getElementById('view');
  if (!view) return;
  view.replaceChildren();
  if (state.error) {
    view.append(h('p', { class: 'empty' }, state.error));
    return;
  }
  if (state.view === 'profil') {
    renderProfile(view);
    return;
  }
  if (state.view === 'info') {
    renderInfo(view);
    return;
  }
  if (state.evals.length === 0) {
    view.append(h('p', { class: 'empty' }, state.loading || 'Lade Vorhersage …'));
    return;
  }
  if (state.view === 'detail') renderDetail(view);
  else renderWindows(view);
}

function start(): void {
  readHash();
  render();
  window.addEventListener('hashchange', () => {
    readHash();
    render();
    window.scrollTo(0, 0);
  });
  document.getElementById('refresh')?.addEventListener('click', () => {
    void loadData(true);
  });
  void loadData(false);
}

start();
