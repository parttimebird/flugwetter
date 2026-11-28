// Flugwetter für mich: die Handy-App (Schritt 2, erweitert in Schritt 3 um Character und persönliche Zonen).
// Holt die Vorhersage direkt bei Open-Meteo (oder nimmt einen gespeicherten bzw. mitgelieferten Stand),
// bewertet sie mit der Engine aus Schritt 1 und zeigt die Flugfenster, die zu deinem Character und Tagesmodus passen.

import { SITE_LIST, SPOTS } from '../src/spots.ts';
import { buildUrl, fetchRaw, parseResponse, type OpenMeteoResponse } from '../src/openmeteo.ts';
import { evaluateForecast, rescoreForPilot } from '../src/engine.ts';
import { clockTime, compass, sunTimes } from '../src/physics.ts';
import {
  DIM_NAMES,
  GOALS,
  GOAL_NAMES,
  LAUNCH_LIMITS,
  PZONE_NAMES,
  TURBULENCE_EMOJI_TEXT,
  crosswindAllowed,
  dimensionZone,
  envelopeOf,
  launchPrefsOf,
  modeLimit,
  modeZone,
  pushReachesChallenge,
  turbulenceEmoji,
  xcOn,
} from '../src/profile.ts';
import { XC_MIN_WINDOW_H } from '../src/windows.ts';
import { migrateStoredProfile } from '../src/migrate.ts';
import { FEELINGS, applySuggestion, snapshotOf, spotPattern, suggestFromEntry, type Compare, type DebriefAnswers, type DebriefEntry } from '../src/debrief.ts';
import { DEFAULT_CONFIG } from '../src/config.ts';
import { climbOutlook } from '../src/evaluate.ts';
import { alt100, baseWindClass, capitalize, gustClass, plus100 } from '../src/format.ts';
import { gustLabel } from '../src/wind.ts';
import {
  CROSSWIND_OPTIONS,
  CURRENCY_OPTIONS,
  FAMILIAR_OPTIONS,
  PREF_QUESTIONS,
  REVERSE_OPTIONS,
  SAFETY_QUESTIONS,
  SKILL_QUESTIONS,
  STYLE_NAMES,
  STYLE_OPTIONS,
  TAILWIND_OPTIONS,
  WING_OPTIONS,
  normalizeMode,
  normalizeStyle,
  scoreCharacter,
  type CharacterAnswers,
  type CharacterResult,
  type Currency,
  type Familiarity,
  type FlightStyle,
  type PrefKey,
  type WingClass,
} from '../src/character.ts';
import type {
  CrosswindTolerance,
  DaySummary,
  DimensionKey,
  EnvelopeLimits,
  Goal,
  GoalRequirements,
  HourEvaluation,
  PersonalZone,
  PilotProfile,
  Spot,
  SpotEvaluation,
  SpotLaunchPrefs,
  TailwindTolerance,
} from '../src/types.ts';

declare const __DEFAULT_PILOT__: PilotProfile;

interface Snapshot {
  fetched_at: string;
  spots: Record<string, OpenMeteoResponse>;
}
type DataMode = 'live' | 'cache' | 'snapshot';
type View = 'fenster' | 'profil' | 'info' | 'detail' | 'character';
type ListView = 'umgebung' | 'favoriten' | 'alle';
/** Standort für „Meine Umgebung“: vom Gerät (GPS) oder ein gewählter Startplatz als Ausgangspunkt */
interface Position {
  lat: number;
  lon: number;
  source: 'gps' | 'spot';
  label: string;
}

// v2: Profil mit Character und Zonen-Grenzen. v1 (Schritt 2) wird beim ersten Start übernommen und bleibt unverändert,
// damit die alte Fassung der App auf demselben Gerät weiterläuft.
const PROFILE_KEY = 'flugwetter.profil.v2';
const LEGACY_PROFILE_KEY = 'flugwetter.profil.v1';
const CACHE_KEY = 'flugwetter.vorhersage.v1';
const REGION_KEY = 'flugwetter.region.v1';
const LIST_KEY = 'flugwetter.liste.v1';
const FAV_KEY = 'flugwetter.favoriten.v1';
const POS_KEY = 'flugwetter.standort.v1';
const RADIUS_KEY = 'flugwetter.umkreis.v1';
const DEBRIEF_KEY = 'flugwetter.debrief.v1';
const CACHE_FRESH_MIN = 60;
const DIM_KEYS: DimensionKey[] = ['wind_comfort', 'thermic_character', 'shear_turbulence', 'structure_cap'];
const DIM_SHORT: Record<DimensionKey, string> = {
  wind_comfort: 'Wind',
  thermic_character: 'Thermik',
  shear_turbulence: 'Turbulenz',
  structure_cap: 'Überhöhung',
};
const REGIONS = [
  { id: 'alle', label: 'Alle', region: '' },
  { id: 'nord', label: 'Nord', region: 'Nordschwarzwald' },
  { id: 'mitte', label: 'Mitte', region: 'Mittlerer Schwarzwald' },
  { id: 'sued', label: 'Süd', region: 'Südschwarzwald' },
];
const GOAL_HINT: Record<Goal, string> = {
  chill: 'ruhig, einfach, entspannt',
  flow: 'kenne ich, überfordert mich nicht',
  push: 'bewusst fordernd',
};
const GOAL_LONG: Record<Goal, string> = {
  chill: 'Ruhige, einfache und gut kontrollierbare Luft: leichte Thermik oder ruhiges Soaring.',
  flow: 'Bedingungen, die du kennst und die dich nicht überfordern. Du bist in deiner Komfort-Zone und im Flow.',
  push: 'Bewusst fordernde Bedingungen, in denen du wächst, mit klarer Sicherheitsstrategie.',
};

/** Welche Stunden im Modus als Flugfenster zählen */
function modeZoneText(mode: Goal, pilot: PilotProfile = state.pilot): string {
  if (mode === 'chill') return 'Stunden mit ruhiger Luft in deiner Komfort-Zone';
  if (mode === 'flow') return 'alle Stunden in deiner Komfort-Zone';
  return modeZone(pilot, 'push') === 'orange' ? 'Stunden bis in deine Challenge-Zone' : 'Stunden bis in deine Progress-Zone';
}
const ZONES_HINT = 'Diese Zonen wurden aus deinem Flugcharakter und deinen bisherigen Rückmeldungen entwickelt. Sie sind eine Orientierung, keine Festlegung.';
const LEVEL_NAMES: Record<keyof EnvelopeLimits, string> = { comfort: 'Komfort', progress: 'Progress', challenge: 'Challenge' };
const DIM_HINT: Record<DimensionKey, string> = {
  wind_comfort: '0 windstill, 1 um 5 km/h, 2 um 10, 3 um 15, 4 um 22 km/h am Start; Böen und Wind oben heben die Stufe',
  thermic_character: '1 schwach und flach, 3 gut nutzbar, 4 kräftig und sportlich',
  shear_turbulence: '1 ruhig, 3 bewegt, 4 ruppig',
  structure_cap: '1 flach gedeckelt (rund 300 m über Start), 3 gute Arbeitshöhe (rund 1.200 m), 4 hochreichend',
};

// ---------------------------------------------------------------------------
// Zustand
// ---------------------------------------------------------------------------

const state = {
  view: 'fenster' as View,
  spotId: '',
  day: '',
  region: readStore(REGION_KEY) ?? 'alle',
  list: (readStore(LIST_KEY) as ListView | null) ?? 'alle',
  favorites: new Set<string>(readJson<string[]>(FAV_KEY) ?? []),
  position: readJson<Position>(POS_KEY),
  radiusKm: Number(readStore(RADIUS_KEY)) || 50,
  geoProblem: '',
  debriefs: readJson<DebriefEntry[]>(DEBRIEF_KEY) ?? [],
  pilot: loadProfile(),
  mode: null as DataMode | null,
  fetchedAt: '',
  liveProblem: '',
  base: [] as SpotEvaluation[],
  evals: [] as SpotEvaluation[],
  loading: 'Lade Vorhersage …',
  error: '',
  /** kurze Bestätigung oben auf der Flugfenster-Seite, verschwindet beim Wechsel der Ansicht */
  flash: '',
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

function readJson<T>(key: string): T | null {
  const raw = readStore(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function clone<T>(x: T): T {
  return JSON.parse(JSON.stringify(x)) as T;
}

function clonePilot(p: PilotProfile): PilotProfile {
  return clone(p);
}

function loadProfile(): PilotProfile {
  for (const key of [PROFILE_KEY, LEGACY_PROFILE_KEY]) {
    const raw = readStore(key);
    if (!raw) continue;
    try {
      const p = JSON.parse(raw) as PilotProfile;
      if (p?.comfort_profile?.tolerance && p.comfort_profile.min_required_scores_for_goal) {
        migrateProfile(p);
        writeStore(PROFILE_KEY, JSON.stringify(p));
        return p;
      }
    } catch {
      // kaputter Eintrag: nächsten versuchen bzw. Standard nehmen
    }
  }
  return clonePilot(__DEFAULT_PILOT__);
}

function migrateProfile(p: PilotProfile): void {
  migrateStoredProfile(p, __DEFAULT_PILOT__);
}

function saveProfile(): void {
  writeStore(PROFILE_KEY, JSON.stringify(state.pilot));
}

// ---------------------------------------------------------------------------
// Character und Tagesmodus
// ---------------------------------------------------------------------------

function characterResult(): CharacterResult | null {
  return state.pilot.character ? scoreCharacter(state.pilot.character) : null;
}

function chosenMode(): Goal {
  return state.pilot.comfort_profile.pilot_profile;
}

/** Der Modus wird nicht mehr herabgestuft: Push reicht je nach Character bis Progress oder bis Challenge. */
function effectiveMode(): Goal {
  return chosenMode();
}

function scoringPilot(): PilotProfile {
  return state.pilot;
}

function setXc(on: boolean): void {
  state.pilot.comfort_profile.xc = on;
  state.flash = '';
  saveProfile();
  rescore();
  render();
}

function setMode(mode: Goal): void {
  state.pilot.comfort_profile.pilot_profile = mode;
  state.flash = '';
  saveProfile();
  rescore();
  render();
}

/** Zonen-Grenzen zum Bearbeiten: legt sie aus der alten Einzelgrenze an, falls es noch keine gibt. */
function editableEnvelope(): Record<DimensionKey, EnvelopeLimits> {
  const cp = state.pilot.comfort_profile;
  cp.envelope ??= clone(envelopeOf(state.pilot));
  return cp.envelope;
}

/** Setzt die Zonen auf das, was der Character ergibt (die alte Einzelgrenze folgt der Progress-Grenze). */
function resetZonesFromCharacter(): void {
  const r = characterResult();
  if (!r) return;
  const cp = state.pilot.comfort_profile;
  cp.envelope = clone(r.envelope);
  for (const k of DIM_KEYS) {
    if (cp.tolerance[k]) cp.tolerance[k].max_score_acceptable = r.envelope[k].progress;
  }
  saveProfile();
  rescore();
}

/** Übernimmt einen Character: Grenzen aus der Starttabelle, Tagesmodus nach Flugstil. */
function applyCharacter(answers: CharacterAnswers): void {
  state.pilot.character = { ...answers, createdAt: new Date().toISOString() };
  const r = scoreCharacter(answers);
  state.pilot.comfort_profile.pilot_profile = r.defaultMode;
  state.pilot.comfort_profile.xc = r.defaultXc;
  state.pilot.launch = clone(r.launch);
  resetZonesFromCharacter();
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
    base.push(evaluateForecast(spot, parseResponse(raw, { fetchedAt: snap.fetched_at }), scoringPilot()));
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
  const pilot = scoringPilot();
  state.evals = state.base.map((ev) => rescoreForPilot(ev, pilot));
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

/** Entfernung in km (Haversine) */
function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLon = (lon2 - lon1) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(a));
}

function spotDistance(spot: Spot): number | null {
  const p = state.position;
  return p ? distanceKm(p.lat, p.lon, spot.lat, spot.lon) : null;
}

function isFavorite(id: string): boolean {
  return state.favorites.has(id);
}

function toggleFavorite(id: string): void {
  if (state.favorites.has(id)) state.favorites.delete(id);
  else state.favorites.add(id);
  writeStore(FAV_KEY, JSON.stringify([...state.favorites]));
  render();
}

/** Startplätze der gewählten Liste: Meine Umgebung (im Umkreis), Favoriten oder Alle (mit Region) */
function listEvals(): SpotEvaluation[] {
  if (state.list === 'favoriten') return state.evals.filter((e) => isFavorite(e.spot.id));
  if (state.list === 'umgebung') {
    if (!state.position) return [];
    return state.evals.filter((e) => (spotDistance(e.spot) ?? Infinity) <= state.radiusKm);
  }
  const r = REGIONS.find((x) => x.id === state.region);
  return !r || !r.region ? state.evals : state.evals.filter((e) => e.spot.site.region === r.region);
}

/** Reihenfolge in einer Gruppe: in Meine Umgebung nach Entfernung, sonst Favoriten zuerst, dann nach Passung */
function listOrder(a: { ev: SpotEvaluation; day: DaySummary }, b: { ev: SpotEvaluation; day: DaySummary }): number {
  if (state.list === 'umgebung') return (spotDistance(a.ev.spot) ?? 0) - (spotDistance(b.ev.spot) ?? 0);
  const fav = Number(isFavorite(b.ev.spot.id)) - Number(isFavorite(a.ev.spot.id));
  if (state.list === 'alle' && fav !== 0) return fav;
  return bestFit(b.day) - bestFit(a.day) || windowHours(b.day) - windowHours(a.day);
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
/** Zonen-Grenzen gehen in Viertelstufen */
const num2 = (x: number) => x.toLocaleString('de-DE', { maximumFractionDigits: 2 });
const kmh = (x: number) => `${Math.round(x)} km/h`;

// ---------------------------------------------------------------------------
// Info-Icons: kurze Erklärungen, woher ein Wert kommt
// ---------------------------------------------------------------------------

type InfoKey = 'wind' | 'thermik' | 'basis' | 'turbulenz' | 'scherung' | 'ueberhoehung' | 'inversion';

const INFO: Record<InfoKey, { title: string; text: string[] }> = {
  wind: {
    title: 'Grundwind und Böen',
    text: [
      'Grundwind: der mittlere Wind in Starthöhe, aus dem Modellwind knapp über dem geglätteten Modellgelände.',
      'Böen: die stärksten Stöße in Bodennähe laut Modell. Je weiter Böen und Grundwind auseinanderliegen, desto unruhiger.',
      'Grundwind: unter 10 km/h schwach, 10–15 mäßig, 15–20 frisch, 20–25 stark, 25–30 sehr stark. Böen: unter 10 sehr schwach, 10–15 schwach, 15–25 mäßig, 25–35 stark, darüber kritisch.',
      'Böigkeit: wie Grundwind und Böen zusammenpassen. Liegen die Böen höchstens etwa 5 km/h über dem Grundwind, ist es laminar. Jede weiteren 5 km/h machen es eine Stufe unruhiger (sehr gut, gut, Böen beachten, turbulent, deutlich turbulent). Bei schwachem Grundwind ist derselbe Abstand weniger kritisch, heißt aber wechselnde Windrichtung am Start; ab etwa 15 km/h Grundwind wird es schneller ruppig. Ob es für dich passt, entscheiden deine Zonen.',
      'Deutlich mehr Böen als Grundwind immer hinterfragen. Mögliche Ursachen: Windscherung, thermische Turbulenz, Lee, Düsen und Geländeeffekte, Schauer- oder Gewitterböen.',
      'Wind aus der passenden Richtung kann den Start leichter machen als Windstille. Ab etwa 10 km/h ist Rückwärtsaufziehen die sicherere Startmethode.',
      'Soaring: am schönsten bei geringer Böigkeit und wenig oder keiner Thermik. 15–20 km/h laminar passt auch für Chill, stärker eher Flow, sehr kräftig oder thermisch eher Push. Ob der Hang Soaring hergibt, prüfst du vor Ort.',
      'Sonne auf dem Hang: Scheint die Sonne an einem Strahlungstag kräftig auf den Hang (morgens Osthänge, mittags Südhänge, nachmittags Westhänge), wird es lokal thermisch und das Soaring eine Stufe lebhafter. Liegt der Hang im Schatten, bleibt es eher laminar.',
    ],
  },
  thermik: {
    title: 'Woher der Thermik-Wert kommt',
    text: [
      'Thermikstärke: geschätzter mittlerer Aufwind in der nutzbaren Schicht. Die App rechnet aus Sonneneinstrahlung und Bodentemperatur, wie viel Wärme in die Luft geht, und hebt ein Luftpaket durch das vorhergesagte Temperatur- und Taupunktprofil.',
      'Daraus kommen die konvektive Geschwindigkeit w* und ein geschätztes Steigen abzüglich des Eigensinkens eines Schirms (etwa 1,1 m/s).',
      'Der Wert gilt für den Gitterpunkt des Modells am Startplatz und für die jeweilige Stunde, nicht für einen einzelnen Hang. Ob die Sonne auf den Hang des Startplatzes scheint, rechnet die App bisher nur beim Soaring ein.',
      'Der Wert basiert auf Modellprognosen (ICON, Deutscher Wetterdienst) und kann durch lokale Effekte abweichen. Für die ersten zwei Tage ist das Modell feiner und meist zuverlässiger.',
    ],
  },
  basis: {
    title: 'Basis',
    text: [
      'Basis: geschätzte Höhe, in der sich Quellwolken bilden (Kondensationsniveau des aufsteigenden Luftpakets). Ohne Wolken heißt die Obergrenze Blauthermik.',
      'Alle Höhen aus dem Modell sind auf 100 m gerundet. Genauer kann ein Modell mit etwa 2 km Maschenweite das nicht.',
    ],
  },
  ueberhoehung: {
    title: 'Mögliche Überhöhung / Deckel',
    text: [
      'Mögliche Überhöhung: wie weit du über den Start steigen kannst, bis zur Basis oder bis zur Obergrenze der Thermik.',
      'Deckel: was die Thermik nach oben begrenzt, meist eine Inversion (eine Schicht, in der es nach oben wärmer wird) oder die Wolkenbasis.',
      'Einschätzung: realistisch ab etwa 700 m Arbeitshöhe und brauchbarem Steigen, begrenzt darunter, unwahrscheinlich unter 300 m oder ohne Steigen. Mittlere und hohe Wolken dämpfen die Einstrahlung und damit die Thermik.',
    ],
  },
  turbulenz: {
    title: 'Turbulenz / Scherung',
    text: [
      'Das bewertet die App für dich, du musst Scherung nicht selbst einschätzen. Man könnte es auch Luftkomfort nennen: wie ruhig oder ruppig sich die Luft anfühlt.',
      'Es zählt der stärkste von mehreren Treibern: Windscherung, Böen über dem Grundwind, Wind, der die Thermik zerreißt, kräftige Thermik selbst und Lee, wenn der Höhenwind nicht aus Startrichtung kommt. Kommen mehrere zusammen, gibt es einen Aufschlag.',
      TURBULENCE_EMOJI_TEXT,
    ],
  },
  scherung: {
    title: 'Was ist Windscherung?',
    text: [
      'Windscherung bedeutet, dass Windrichtung oder Windgeschwindigkeit sich mit der Höhe ändern. Starke Änderungen können Turbulenz verstärken, besonders beim Durchbruch durch eine Inversion oder in Lee-Lagen.',
      'Typisch ist sie an Inversionen (oben weht ein anderer Wind als in der Thermikschicht), wenn der Höhenwind zunimmt, und wenn Thermik in kräftigen Wind hineinsteigt.',
    ],
  },
  inversion: {
    title: 'Inversion',
    text: [
      'Eine Inversion ist eine Schicht, in der die Temperatur nach oben zunimmt. Sie bremst die Thermik und bildet oft den Deckel.',
      'Kräftige Inversionen (ab etwa 2 °C auf 200 m) trennen oft Luftschichten mit verschiedenem Wind. Beim Durchstoßen kann es dann ruppig werden.',
    ],
  },
};

let infoSeq = 0;

/** Kleines ⓘ hinter einer Überschrift. Tippen klappt die Erklärung darunter auf. */
function infoTip(key: InfoKey): { button: HTMLElement; panel: HTMLElement } {
  const id = `info-${key}-${++infoSeq}`;
  const info = INFO[key];
  const panel = h('div', { class: 'infopanel', id, hidden: true }, h('b', {}, info.title), info.text.map((t) => h('p', {}, t)));
  const button = h(
    'button',
    {
      type: 'button',
      class: 'info-i',
      'aria-expanded': 'false',
      'aria-controls': id,
      'aria-label': `Info: ${info.title}`,
      onclick: (e: Event) => {
        e.stopPropagation();
        const open = panel.hidden;
        panel.hidden = !open;
        button.setAttribute('aria-expanded', String(open));
      },
    },
    'i',
  );
  return { button, panel };
}

/** Überschrift mit Info-Icon und aufklappbarer Erklärung */
function titledInfo(tag: 'h3' | 'h4', title: string, key: InfoKey): HTMLElement[] {
  const tip = infoTip(key);
  return [h(tag, { class: 'with-info' }, title, tip.button), tip.panel];
}

function zonePill(zone: PersonalZone, text: string, cu = false): HTMLElement {
  return h('span', { class: `pill p-${zone}${cu ? ' cu' : ''}` }, text);
}

function windowText(w: DaySummary['windows'][number]): string {
  return `${w.start.slice(0, 2)}–${w.end.slice(0, 2)} Uhr · ${PZONE_NAMES[w.personalZone]}`;
}

function hourStrip(ev: SpotEvaluation, date: string): HTMLElement {
  const hours = ev.hours.filter((x) => x.isDay && x.time.startsWith(date));
  if (hours.length === 0) return h('div');
  const min = DEFAULT_CONFIG.windowMinFit;
  const bars = hours.map((x) => {
    const pz = x.fit.personalZone;
    const weak = pz !== 'no-go' && x.fit.score < min;
    // Quellwolken möglich: weiß schraffiert (auf grün also weiß-grün), keine reine Blauthermik
    const cu = pz !== 'no-go' && x.metrics.cloudBaseMsl !== null;
    const cls = [`p-${pz}`, weak ? 'weak' : '', cu ? 'cu' : '', isPast(x.time) ? 'past' : ''].filter(Boolean).join(' ');
    const title = `${x.time.slice(11, 16)} ${PZONE_NAMES[pz]}${pz === 'no-go' ? '' : `, ${x.zoneLabel}, Passung ${x.fit.score}${cu ? ', Quellwolken möglich' : ''}`}`;
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
    const active = state.view === id || (id === 'fenster' && state.view === 'detail') || (id === 'profil' && state.view === 'character');
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
      const evs = single ? [single] : listEvals();
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
        h('span', { class: 'dots' }, best ? h('i', { class: `p-${best.personalZone}` }) : h('i')),
      );
    }),
  );
}

const LISTS: { id: ListView; label: string }[] = [
  { id: 'umgebung', label: 'Meine Umgebung' },
  { id: 'favoriten', label: 'Favoriten' },
  { id: 'alle', label: 'Alle' },
];

function listTabs(): HTMLElement {
  return h(
    'div',
    { class: 'seg seg-list', role: 'group', 'aria-label': 'Startplätze' },
    LISTS.map((l) =>
      h(
        'button',
        {
          type: 'button',
          'aria-pressed': String(state.list === l.id),
          onclick: () => {
            state.list = l.id;
            writeStore(LIST_KEY, l.id);
            render();
          },
        },
        h('b', {}, l.label),
        l.id === 'favoriten' ? h('span', {}, state.favorites.size === 0 ? 'noch keine' : `${state.favorites.size} markiert`) : null,
      ),
    ),
  );
}

function savePosition(p: Position | null): void {
  state.position = p;
  if (p) writeStore(POS_KEY, JSON.stringify(p));
  else writeStore(POS_KEY, '');
}

function locate(): void {
  if (!('geolocation' in navigator)) {
    state.geoProblem = 'Dieses Gerät gibt keinen Standort heraus.';
    render();
    return;
  }
  state.geoProblem = 'Suche deinen Standort …';
  render();
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      state.geoProblem = '';
      savePosition({ lat: pos.coords.latitude, lon: pos.coords.longitude, source: 'gps', label: 'deinem Standort' });
      render();
    },
    (err) => {
      state.geoProblem =
        err.code === err.PERMISSION_DENIED
          ? 'Standort nicht freigegeben. Du kannst ihn in den Browser-Einstellungen erlauben oder unten einen Startplatz als Ausgangspunkt wählen.'
          : 'Standort gerade nicht verfügbar. Wähle unten einen Startplatz als Ausgangspunkt.';
      render();
    },
    { enableHighAccuracy: false, timeout: 10000, maximumAge: 30 * 60 * 1000 },
  );
}

/** Standort und Umkreis für „Meine Umgebung“ */
function nearbyControls(): HTMLElement {
  const p = state.position;
  const select = h(
    'select',
    {
      'aria-label': 'Ausgangspunkt',
      onchange: (e: Event) => {
        const id = (e.target as HTMLSelectElement).value;
        const spot = SPOTS.find((x) => x.id === id);
        if (spot) {
          state.geoProblem = '';
          savePosition({ lat: spot.lat, lon: spot.lon, source: 'spot', label: spot.name });
          render();
        }
      },
    },
    h('option', { value: '', selected: !p || p.source === 'gps' }, p?.source === 'gps' ? 'GPS-Standort' : 'Startplatz als Ausgangspunkt …'),
    SPOTS.map((sp) => h('option', { value: sp.id, selected: p?.source === 'spot' && p.label === sp.name }, `${sp.name} (${sp.site.name})`)),
  );
  const radius = h(
    'select',
    {
      'aria-label': 'Umkreis',
      onchange: (e: Event) => {
        state.radiusKm = Number((e.target as HTMLSelectElement).value);
        writeStore(RADIUS_KEY, String(state.radiusKm));
        render();
      },
    },
    [25, 50, 75, 100, 150].map((km) => h('option', { value: km, selected: km === state.radiusKm }, `${km} km`)),
  );
  return h(
    'div',
    { class: 'nearby' },
    h(
      'div',
      { class: 'nearby-row' },
      h('button', { type: 'button', class: 'btn', onclick: locate }, p?.source === 'gps' ? 'Standort neu bestimmen' : 'Meinen Standort verwenden'),
      h('label', { class: 'small' }, 'Umkreis ', radius),
    ),
    select,
    state.geoProblem ? h('p', { class: 'small', role: 'status' }, state.geoProblem) : null,
    p ? h('p', { class: 'small' }, `Sortiert nach Entfernung von ${p.label}. Der Standort bleibt nur auf diesem Gerät.`) : null,
  );
}

function favoriteButton(spot: Spot, big = false): HTMLElement {
  const on = isFavorite(spot.id);
  return h(
    'button',
    {
      type: 'button',
      class: `fav${big ? ' big' : ''}`,
      'aria-pressed': String(on),
      'aria-label': on ? `${spot.name} aus den Favoriten nehmen` : `${spot.name} als Favorit markieren`,
      title: on ? 'Favorit' : 'als Favorit markieren',
      onclick: (e: Event) => {
        e.stopPropagation();
        toggleFavorite(spot.id);
      },
    },
    on ? '★' : '☆',
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

function modeButtons(): HTMLElement {
  const mode = chosenMode();
  const xc = xcOn(state.pilot);
  return h(
    'div',
    { class: 'modes' },
    h(
      'div',
      { class: 'seg', role: 'group', 'aria-label': 'Tagesmodus' },
      GOALS.map((g) =>
        h(
          'button',
          { type: 'button', 'aria-pressed': String(mode === g), onclick: () => setMode(g) },
          h('b', {}, GOAL_NAMES[g]),
          h('span', {}, GOAL_HINT[g]),
        ),
      ),
    ),
    h(
      'button',
      { type: 'button', class: 'xc-toggle', 'aria-pressed': String(xc), onclick: () => setXc(!xc) },
      h('b', {}, xc ? '✓ Strecke (XC)' : '+ Strecke (XC)'),
      h('span', {}, xc ? `an: nur Stunden mit Thermik und Arbeitshöhe, Fenster ab ${XC_MIN_WINDOW_H} Stunden` : 'aus: tippen, wenn du heute Strecke fliegen willst'),
    ),
  );
}

function coachLine(): HTMLElement | null {
  if (chosenMode() !== 'push' || pushReachesChallenge(state.pilot)) return null;
  const r = characterResult();
  const why = r ? `${r.pushReason} ` : 'Ohne Character bleibt Push vorsichtig. ';
  return h('p', { class: 'coach' }, `Push reicht bei dir vorerst bis in die Progress-Zone. ${why}Das ist keine Wertung, sondern deine Sicherheitsreserve.`);
}

function modeLine(): HTMLElement {
  return coachLine() ?? h('p', { class: 'small' }, `Als Flugfenster zählen ${modeZoneText(effectiveMode())}${xcOn(state.pilot) ? ', die für Strecke reichen' : ''}.`);
}

function modeBar(): HTMLElement {
  return h('section', { class: 'modebar', 'aria-label': 'Tagesmodus' }, h('h3', {}, 'Dein Modus heute'), modeButtons(), modeLine());
}

function modeTitle(): string {
  return `${GOAL_NAMES[effectiveMode()]}${xcOn(state.pilot) ? ' mit Strecke' : ''}`;
}

function characterPrompt(): HTMLElement | null {
  if (state.flash) return h('p', { class: 'coach ok', role: 'status' }, state.flash);
  if (state.pilot.character) return null;
  return h(
    'div',
    { class: 'coach' },
    h('p', {}, 'Deine Zonen beruhen noch auf einem Standardprofil. Leg deinen Character an, dann passen grün, gelb und orange zu dir. Das dauert etwa zwei Minuten.'),
    h('a', { class: 'btn primary', href: '#character' }, 'Character anlegen'),
  );
}

function spotCard(ev: SpotEvaluation, day: DaySummary): HTMLElement {
  const s = ev.spot;
  const fit = bestFit(day);
  const wins = day.windows.length > 0
    ? day.windows.map((w) => zonePill(w.personalZone, windowText(w)))
    : day.bestHour
      ? [h('span', { class: 'small' }, `Beste Stunde ${day.bestHour.time.slice(11, 13)} Uhr: ${PZONE_NAMES[day.bestHour.fit.personalZone]}, ${day.bestHour.fit.label}`)]
      : [];
  const dist = spotDistance(s);
  return h(
    'div',
    { class: 'cardwrap' },
    h(
      'button',
      { class: 'card', type: 'button', onclick: () => openSpot(s.id) },
      h(
        'span',
        { class: 'row1' },
        h('span', { class: 'name' }, s.name),
        h('span', { class: 'fit', title: 'beste persönliche Passung (0 bis 100)' }, String(fit), h('small', {}, '/100')),
      ),
      h('span', { class: 'meta' }, `${s.site.name} · ${s.elevation} m · Start nach ${compass(s.facing)}${dist !== null ? ` · ${Math.round(dist)} km` : ''}`),
      h('span', { class: 'wins' }, wins),
      hourStrip(ev, day.date),
    ),
    favoriteButton(s),
  );
}

function renderWindows(view: HTMLElement): void {
  const date = state.day;
  const rows = listEvals()
    .map((ev) => ({ ev, day: dayOf(ev, date) }))
    .filter((r): r is { ev: SpotEvaluation; day: DaySummary } => !!r.day);
  const good = rows.filter((r) => r.day.windows.length > 0).sort(listOrder);
  const meh = rows.filter((r) => r.day.windows.length === 0 && r.day.bestHour).sort(listOrder);
  const bad = rows.filter((r) => r.day.windows.length === 0 && !r.day.bestHour).sort(listOrder);

  const spot0 = rows[0]?.ev.spot ?? SPOTS[0];
  const sun = date ? sunTimes(spot0.lat, spot0.lon, date) : null;
  const prompt = characterPrompt();
  view.append(modeBar());
  if (prompt) view.append(prompt);
  view.append(
    dayChips((d) => {
      state.day = d;
      render();
    }),
    listTabs(),
    ...[state.list === 'alle' ? regionChips() : null, state.list === 'umgebung' ? nearbyControls() : null].filter((x): x is HTMLElement => x !== null),
    h(
      'div',
      { class: 'dayhead' },
      h('h2', {}, date ? `${dayName(date, true)}, ${dateShort(date)}` : 'Kein Tag'),
      h(
        'p',
        {},
        `${good.length} von ${rows.length} Startplätzen mit Flugfenster im Modus ${modeTitle()}` +
          (sun ? ` · Sonne ${clockTime(sun.sunrise)} bis ${clockTime(sun.sunset)} Uhr` : ''),
      ),
    ),
  );

  const listHint = emptyListHint(rows.length);
  if (listHint) {
    view.append(listHint);
    return;
  }
  if (state.list !== 'favoriten' && state.favorites.size === 0 && (state.pilot.character?.prefs?.house_hill ?? 0) >= 4) {
    view.append(h('p', { class: 'coach' }, 'Du fliegst meist an deinem Hausberg: Markiere ihn mit ☆, dann findest du ihn unter Favoriten sofort.'));
  }
  if (good.length > 0) {
    view.append(h('section', { class: 'group' }, h('h3', {}, 'Passt zu dir'), good.map((r) => spotCard(r.ev, r.day))));
  } else {
    view.append(h('p', { class: 'empty' }, `An diesem Tag passt kein Startplatz zu deinem Modus ${modeTitle()}. Weiter unten steht, was fliegbar wäre und was dagegen spricht.`));
  }
  if (meh.length > 0) {
    view.append(h('section', { class: 'group' }, h('h3', {}, 'Fliegbar, aber nicht in deinem Modus'), meh.map((r) => spotCard(r.ev, r.day))));
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
              h('span', { class: 'n' }, `${isFavorite(r.ev.spot.id) ? '★ ' : ''}${r.ev.spot.name}`, state.list === 'umgebung' && spotDistance(r.ev.spot) !== null ? h('small', {}, ` · ${Math.round(spotDistance(r.ev.spot)!)} km`) : null),
              h('span', { class: 'r' }, r.day.noGoReasons.slice(0, 2).map((x) => x.reason).join(', ') || 'nicht fliegbar'),
            ),
          ),
        ),
      ),
    );
  }
}

/** Leere Liste erklären: kein Standort, keine Favoriten, nichts im Umkreis */
function emptyListHint(count: number): HTMLElement | null {
  if (count > 0) return null;
  if (state.list === 'favoriten') {
    return h('p', { class: 'empty' }, 'Noch keine Favoriten. Tippe bei einem Startplatz auf ☆, dann erscheint er hier. Unter „Alle“ stehen deine Favoriten außerdem oben.');
  }
  if (state.list === 'umgebung') {
    return h(
      'p',
      { class: 'empty' },
      state.position
        ? `Im Umkreis von ${state.radiusKm} km um ${state.position.label} liegt kein Startplatz. Vergrößere den Umkreis oder wähle einen anderen Ausgangspunkt.`
        : 'Verwende deinen Standort oder wähle einen Startplatz als Ausgangspunkt, dann zeigt die App die Startplätze in deiner Nähe, die nächsten zuerst.',
    );
  }
  return h('p', { class: 'empty' }, 'Keine Startplätze in dieser Auswahl.');
}

function openSpot(id: string): void {
  location.hash = id;
}

// ---------------------------------------------------------------------------
// Ansicht: Startplatz im Detail
// ---------------------------------------------------------------------------

/** Balken einer Dimension in der Farbe deiner Zone, mit Strich an der Grenze deines Tagesmodus */
function dimCell(k: DimensionKey, x: HourEvaluation): HTMLElement {
  const d = x.dimensions[k];
  const pilot = scoringPilot();
  const z = dimensionZone(d.score, envelopeOf(pilot)[k]);
  const mode = effectiveMode();
  const limit = modeLimit(pilot, k, mode);
  return h(
    'div',
    { class: 'dim', title: `${DIM_NAMES[k]}: ${d.label}, bei dir ${PZONE_NAMES[z]}` },
    h('span', { class: 'dl' }, h('span', {}, DIM_SHORT[k]), h('b', {}, dimValue(k, x))),
    h(
      'span',
      { class: 'bar' },
      h('span', { class: `p-${z}`, style: `width:${Math.min(100, (d.score / 5) * 100)}%` }),
      h('i', { style: `left:calc(${(limit / 5) * 100}% - 1px)`, title: `deine Grenze für ${GOAL_NAMES[mode]}: ${num2(limit)}` }),
    ),
  );
}

/** Absoluter Wert statt Stufe: Wind in km/h, Thermik als Steigen, Turbulenz als Wort, Überhöhung in Metern */
function dimValue(k: DimensionKey, x: HourEvaluation): string {
  const m = x.metrics;
  if (k === 'wind_comfort') return `${Math.round(m.takeoffWindKmh)}/${Math.round(m.gustKmh)}`;
  if (k === 'thermic_character') return m.wStar > 0.3 && m.climbEstimate >= 0.2 ? `${num1(m.climbEstimate)} m/s` : x.dimensions[k].label === 'keine Thermik' ? 'keine' : 'schwach';
  if (k === 'shear_turbulence') return `${turbulenceEmoji(x.dimensions[k].score, envelopeOf(scoringPilot()).shear_turbulence)} ${x.dimensions[k].label}`;
  return m.workingHeight > 0 ? plus100(m.workingHeight) : '–';
}

/** Kennwerte einer Stunde: Grundwind und Böen getrennt, Höhen auf 100 m gerundet */
function keyData(x: HourEvaluation): HTMLElement {
  const m = x.metrics;
  const quality = m.gustLevel !== undefined && (m.takeoffWindKmh >= 3 || m.gustKmh >= 10) ? gustLabel(m.gustLevel) : null;
  const wind = h(
    'span',
    { class: 'kd' },
    `Grundwind ${kmh(m.takeoffWindKmh)} aus ${compass(m.takeoffWindDir)} (${baseWindClass(m.takeoffWindKmh)}) · Böen ${kmh(m.gustKmh)} (${gustClass(m.gustKmh)})`,
    quality ? ` · Böigkeit ${quality}` : '',
  );
  const parts = [`darüber ${kmh(m.windAboveKmh)} aus ${compass(m.windAboveDir)}`];
  if (m.wStar > 0.3) parts.push(m.climbEstimate >= 0.2 ? `Steigen ca. ${num1(m.climbEstimate)} m/s` : 'kaum nutzbares Steigen');
  if (m.workingHeight > 0) {
    parts.push(m.cloudBaseMsl !== null ? `Basis ${alt100(m.cloudBaseMsl)}` : `Blauthermik bis ${alt100(m.thermalTopMsl)}`);
    parts.push(`Überhöhung ${plus100(m.workingHeight)} (${climbOutlook(m)})`);
  }
  if (m.inversion) parts.push(`Inversion ${alt100(m.inversion.baseMsl)}`);
  return h('p', { class: 'keydata' }, wind, h('br'), parts.join(' · '));
}

/** Begründung ohne Zahlenstufen: „Frischer Wind: …“, „Thermik schwach und flach: …“ */
function reasonText(k: DimensionKey, x: HourEvaluation): string {
  const d = x.dimensions[k];
  const why = d.reasons.join(', ') || 'keine Besonderheit';
  if (k === 'wind_comfort') return `${capitalize(d.label)}: ${why}`;
  if (k === 'structure_cap') return `Überhöhung / Deckel: ${d.label}. ${capitalize(why)}`;
  if (k === 'shear_turbulence') return `Turbulenz / Scherung ${d.label}: ${why}`;
  return `Thermik ${d.label}: ${why}`;
}

function hourRow(x: HourEvaluation): HTMLElement {
  const notes: HTMLElement[] = [];
  for (const r of x.noGo) notes.push(h('li', { class: 'nogo' }, r.text));
  if (x.zone === 'no-go' && x.noGo.length === 0) {
    for (const d of Object.values(x.dimensions).filter((d) => d.score >= 4.5)) {
      notes.push(h('li', { class: 'nogo' }, `${DIM_NAMES[d.key]}: ${d.reasons.join(', ')}`));
    }
  }
  if (x.zone !== 'no-go') {
    for (const n of x.fit.notes) notes.push(h('li', { class: x.fit.launchIssues.includes(n) ? 'nogo' : 'info' }, n));
  }
  for (const w of x.warnings) notes.push(h('li', { class: 'warn' }, w));
  for (const t of x.hints ?? []) notes.push(h('li', { class: 'hint' }, t));

  const pz = x.fit.personalZone;
  return h(
    'article',
    { class: `hour${isPast(x.time) ? ' past' : ''}` },
    h(
      'div',
      { class: 'h1' },
      h('time', { datetime: x.time }, x.time.slice(11, 16)),
      zonePill(pz, pz === 'no-go' ? x.zoneLabel : PZONE_NAMES[pz], pz !== 'no-go' && x.metrics.cloudBaseMsl !== null),
      pz === 'no-go' ? null : h('span', { class: 'air', title: 'Lufttyp' }, x.zoneLabel),
      h('span', { class: 'fitline' }, pz === 'no-go' ? '' : h('span', {}, h('b', {}, String(x.fit.score)), ` ${x.fit.label}`)),
    ),
    h('div', { class: 'dims' }, DIM_KEYS.map((k) => dimCell(k, x))),
    keyData(x),
    notes.length > 0 ? h('ul', { class: 'notes' }, notes) : null,
    h(
      'details',
      { class: 'why' },
      h('summary', {}, 'Begründung'),
      h(
        'ul',
        {},
        DIM_KEYS.map((k) => h('li', {}, reasonText(k, x))),
      ),
    ),
  );
}

/** Leiste mit Info-Icons über der Stundenansicht: Wind, Thermik, Basis, Turbulenz, Scherung, Überhöhung */
function infoBar(): HTMLElement {
  const items: [InfoKey, string][] = [
    ['wind', 'Wind'],
    ['thermik', 'Thermik'],
    ['basis', 'Basis'],
    ['turbulenz', 'Turbulenz'],
    ['scherung', 'Scherung'],
    ['ueberhoehung', 'Überhöhung'],
  ];
  const tips = items.map(([key, label]) => ({ label, ...infoTip(key) }));
  // nur eine Erklärung zugleich offen
  for (const t of tips) {
    t.button.addEventListener('click', () => {
      for (const o of tips) {
        if (o === t) continue;
        o.panel.hidden = true;
        o.button.setAttribute('aria-expanded', 'false');
      }
    });
  }
  return h(
    'section',
    { class: 'infobar', 'aria-label': 'Was die Werte bedeuten' },
    h(
      'div',
      { class: 'infobar-row' },
      h('span', { class: 'small' }, 'Was die Werte bedeuten:'),
      tips.map((t) => h('span', { class: 'infochip' }, t.label, t.button)),
    ),
    tips.map((t) => t.panel),
    h('p', { class: 'small' }, 'Wind steht als Grundwind/Böen in km/h. Schraffiert heißt: Quellwolken möglich, also keine reine Blauthermik, aber auch nicht zwingend geschlossene Bewölkung.'),
  );
}

function fact(label: string, value: string): HTMLElement {
  return h('div', {}, h('dt', {}, label), h('dd', {}, value));
}

/** Was deine Debriefings an diesem Startplatz zeigen */
function spotPatternNote(s: Spot): HTMLElement | null {
  const found = spotPattern(state.debriefs, s.id);
  if (found.length === 0) return null;
  return h('p', { class: 'coach' }, `Aus deinen Debriefings hier: ${found.join(', ')}. Behalte das beim Lesen der Vorhersage im Hinterkopf.`);
}

function setSpotLaunch(spotId: string, change: (own: SpotLaunchPrefs) => void): void {
  const all = (state.pilot.spot_launch ??= {});
  const own = all[spotId] ?? {};
  change(own);
  if (own.crosswind === undefined && own.maxGustKmh === undefined) delete all[spotId];
  else all[spotId] = own;
  if (Object.keys(all).length === 0) delete state.pilot.spot_launch;
  saveProfile();
  rescore();
  render();
}

const GUST_CHOICES = [10, 15, 20, 25, 30, 35];

/** Eigene Startbedingungen für diesen Startplatz: Seitenwind (nur mit passendem Character) und Böen-Grenze */
function spotLaunchBox(s: Spot): HTMLElement {
  const own = state.pilot.spot_launch?.[s.id] ?? {};
  const allowed = crosswindAllowed(state.pilot);
  const effective = launchPrefsOf(state.pilot, s.id);
  const cwOptions: { id: CrosswindTolerance | 'default'; title: string; text?: string }[] = [
    { id: 'default', title: 'Wie allgemein', text: 'Deine Einstellung aus dem Profil.' },
    ...CROSSWIND_OPTIONS,
  ];
  const gust = h(
    'select',
    {
      id: `gust-${s.id}`,
      onchange: (e: Event) => {
        const v = (e.target as HTMLSelectElement).value;
        setSpotLaunch(s.id, (o) => {
          if (v === '') delete o.maxGustKmh;
          else o.maxGustKmh = Number(v);
        });
      },
    },
    h('option', { value: '', selected: own.maxGustKmh === undefined }, 'keine eigene Grenze'),
    GUST_CHOICES.map((km) => h('option', { value: km, selected: own.maxGustKmh === km }, `Böen höchstens ${km} km/h`)),
  );
  const set = own.crosswind !== undefined || own.maxGustKmh !== undefined;
  return h(
    'details',
    { class: 'box more', open: set ? true : undefined },
    h('summary', {}, set ? 'Deine Startbedingungen hier (eigene)' : 'Deine Startbedingungen hier'),
    h(
      'div',
      { class: 'more-body' },
      h('p', { class: 'small' }, 'Manche Startplätze kennst du besser als andere. Hier kannst du für diesen Startplatz eigene Grenzen setzen. Stunden darüber zählen hier nie als Flugfenster.'),
      allowed
        ? h('div', { class: 'q' }, h('h4', {}, 'Seitenwind an diesem Startplatz'), choiceList('Seitenwind hier', cwOptions, own.crosswind ?? 'default', (id) => setSpotLaunch(s.id, (o) => (id === 'default' ? delete o.crosswind : (o.crosswind = id)))))
        : h('p', { class: 'small' }, 'Seitenwind kannst du hier einstellen, sobald dein Character als erfahren gilt (Technik ab „solide“, mindestens 20 Flüge im Jahr, mit dem System vertraut).'),
      h('div', { class: 'q' }, h('h4', {}, h('label', { for: `gust-${s.id}` }, 'Böen-Grenze an diesem Startplatz')), gust),
      h('p', { class: 'small' }, `Hier gilt: ${launchText(effective)}${effective.maxGustKmh !== undefined ? ` Böen höchstens ${effective.maxGustKmh} km/h.` : ''}`),
    ),
  );
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
      h('div', { class: 'spottitle' }, h('h2', {}, s.name), favoriteButton(s, true)),
      h('p', {}, `${s.site.name} · ${s.site.region} · ${s.site.club}`),
    ),
    h('dl', { class: 'facts' }, facts),
    ...[spotPatternNote(s)].filter((x): x is HTMLElement => x !== null),
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
    infoBar(),
    h('div', { class: 'hours' }, ev.hours.filter((x) => x.isDay && x.time.startsWith(date)).map(hourRow)),
  );

  const notes = [...s.notes];
  if (s.airspace) notes.push(`${s.airspace.note}.`);
  view.append(spotLaunchBox(s));
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
// Bausteine für Zonen
// ---------------------------------------------------------------------------

const LEVELS: (keyof EnvelopeLimits)[] = ['comfort', 'progress', 'challenge'];

/** Skala 0 bis 5, eingefärbt nach deinen vier Zonen */
function zoneScale(limits: EnvelopeLimits): HTMLElement {
  const pct = (v: number) => `${(v / 5) * 100}%`;
  const parts: [PersonalZone, number, number][] = [
    ['green', 0, limits.comfort],
    ['yellow', limits.comfort, limits.progress],
    ['orange', limits.progress, limits.challenge],
    ['red', limits.challenge, 5],
  ];
  return h(
    'div',
    { class: 'zscale', 'aria-hidden': 'true' },
    parts.filter(([, from, to]) => to > from).map(([z, from, to]) => h('span', { class: `p-${z}`, style: `left:${pct(from)};width:${pct(to - from)}` })),
  );
}

function zoneTicks(): HTMLElement {
  return h('div', { class: 'zticks', 'aria-hidden': 'true' }, [0, 1, 2, 3, 4, 5].map((n) => h('span', {}, String(n))));
}

function limitsText(l: EnvelopeLimits): string {
  return `Komfort bis ${num2(l.comfort)}, Progress bis ${num2(l.progress)}, Challenge bis ${num2(l.challenge)}`;
}

function zoneLegend(withNoGo = false): HTMLElement {
  const zones: PersonalZone[] = withNoGo ? ['green', 'yellow', 'orange', 'red', 'no-go'] : ['green', 'yellow', 'orange', 'red'];
  return h('div', { class: 'legend' }, zones.map((z) => zonePill(z, PZONE_NAMES[z])));
}

function characterSummary(c: CharacterAnswers, r: CharacterResult): string {
  return `Flugstil ${STYLE_NAMES[c.style]}, Technik-Score ${r.skillTotal} (${r.skillLabel}), Sicherheits-Score ${r.safetyTotal} (${r.safetyLabel})`;
}

function gearText(c: CharacterAnswers): string {
  const wing = WING_OPTIONS.find((o) => o.id === c.wing)?.title ?? c.wing;
  const flights = CURRENCY_OPTIONS.find((o) => o.id === c.currency)?.title ?? '';
  return `Schirm ${wing}, ${flights}`;
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
  return `Im Modus ${GOAL_NAMES[effectiveMode()]}: ${windows} Flugfenster an ${spots.size} von ${state.evals.length} Startplätzen in den nächsten ${days.length} Tagen.`;
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
  structure_cap_min: 'Überhöhung mindestens',
  wind_comfort_max: 'Wind höchstens',
  shear_turbulence_max: 'Turbulenz höchstens',
};
const REQ_DEFAULT: Record<ReqKey, number> = { thermic_character_min: 2, structure_cap_min: 2, wind_comfort_max: 3, shear_turbulence_max: 3 };

/** Drei Regler pro Dimension. Die Reihenfolge Komfort ≤ Progress ≤ Challenge bleibt immer erhalten: die Nachbarn rutschen mit. */
function zoneEditor(k: DimensionKey, summary: HTMLElement): HTMLElement {
  const limits = editableEnvelope()[k];
  const tol = state.pilot.comfort_profile.tolerance[k];
  let scale = zoneScale(limits);
  const controls = new Map<keyof EnvelopeLimits, { input: HTMLInputElement; out: HTMLElement }>();
  const rows = LEVELS.map((level, i) => {
    const id = `env-${k}-${level}`;
    const out = h('output', { for: id }, num2(limits[level]));
    const input = h('input', {
      type: 'range',
      id,
      min: 0,
      max: 5,
      step: 0.25,
      value: limits[level],
      oninput: (e: Event) => {
        const v = Number((e.target as HTMLInputElement).value);
        limits[level] = v;
        LEVELS.forEach((other, j) => {
          if (j < i && limits[other] > v) limits[other] = v;
          if (j > i && limits[other] < v) limits[other] = v;
        });
        if (tol) tol.max_score_acceptable = limits.progress;
        for (const [l, c] of controls) {
          c.input.value = String(limits[l]);
          c.out.textContent = num2(limits[l]);
        }
        const next = zoneScale(limits);
        scale.replaceWith(next);
        scale = next;
        profileChanged(summary);
      },
    });
    controls.set(level, { input, out });
    return h('div', { class: `slider lvl-${level}` }, h('label', { for: id }, h('span', {}, `${LEVEL_NAMES[level]} bis`), out), input);
  });
  const infoKey: Record<DimensionKey, InfoKey> = { wind_comfort: 'wind', thermic_character: 'thermik', shear_turbulence: 'turbulenz', structure_cap: 'ueberhoehung' };
  return h('div', { class: 'dimset' }, titledInfo('h4', DIM_NAMES[k], infoKey[k]), h('span', { class: 'hint' }, DIM_HINT[k]), h('div', { class: 'zwrap' }, scale, zoneTicks()), rows);
}

/** Regler für Mindestanforderungen (eines Modus oder der Strecken-Option) */
function reqEditor(prefix: string, req: GoalRequirements, summary: HTMLElement): HTMLElement[] {
  return (Object.keys(REQ_LABELS) as ReqKey[]).flatMap((key) => {
    const active = req[key] !== undefined;
    const value = req[key] ?? REQ_DEFAULT[key];
    let sliderEl: HTMLElement;
    const check = h('input', {
      type: 'checkbox',
      id: `req-on-${prefix}-${key}`,
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
      id: `req-${prefix}-${key}`,
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
}

function characterBox(): HTMLElement {
  const c = state.pilot.character;
  const r = characterResult();
  if (!c || !r) {
    return h(
      'section',
      { class: 'box' },
      h('h3', {}, 'Dein Character'),
      h('p', {}, 'Noch nicht angelegt. Bis dahin rechnet die App mit einem Standardprofil, und deine Zonen unten sind daraus abgeleitet.'),
      h('a', { class: 'btn primary', href: '#character' }, 'Character anlegen'),
    );
  }
  const created = c.createdAt ? berlin(new Date(c.createdAt)).text.slice(0, 6) : '';
  return h(
    'section',
    { class: 'box' },
    h('h3', {}, 'Dein Character'),
    h('p', {}, `${characterSummary(c, r)}. ${gearText(c)}.`),
    h('p', { class: 'small' }, `${created ? `Angelegt am ${created} ` : ''}Wenn sich deine Technik oder dein Gefühl in der Luft verändert, lies dich einfach neu ein.`),
    h('a', { class: 'btn', href: '#character' }, 'Character neu einlesen'),
  );
}

/** Startbedingungen im Profil: dieselben Sperren wie im Character, damit niemand sich Rückenwind freischaltet, der dafür noch nicht erfahren genug ist */
function launchBox(summary: HTMLElement): HTMLElement {
  const r = characterResult();
  const prefs = (state.pilot.launch ??= clone(launchPrefsOf(state.pilot)));
  const changed = () => {
    profileChanged(summary);
    current.textContent = launchText(prefs);
  };
  const current = h('p', { class: 'small' }, launchText(prefs));
  const rows: HTMLElement[] = [];
  if (r?.crosswindUnlocked) {
    rows.push(h('div', { class: 'q' }, h('h4', {}, 'Seitenwind tolerieren?'), choiceList('Seitenwind', CROSSWIND_OPTIONS, prefs.crosswind, (id) => ((prefs.crosswind = id), changed()))));
  }
  if (r?.tailwindUnlocked) {
    rows.push(h('div', { class: 'q' }, h('h4', {}, 'Rückenwind tolerieren?'), choiceList('Rückenwind', TAILWIND_OPTIONS, prefs.tailwind, (id) => ((prefs.tailwind = id), changed()))));
  }
  rows.push(
    h(
      'div',
      { class: 'q' },
      h('h4', {}, 'Rückwärtsaufziehen sicher?'),
      choiceList('Rückwärtsaufziehen', REVERSE_OPTIONS, prefs.reverseLaunch === undefined ? undefined : prefs.reverseLaunch ? 'yes' : 'no', (id) => ((prefs.reverseLaunch = id === 'yes'), changed())),
    ),
  );
  return h(
    'section',
    { class: 'box' },
    titledInfo('h3', 'Deine Startbedingungen', 'wind'),
    h(
      'p',
      { class: 'small' },
      r?.crosswindUnlocked
        ? 'Stunden mit Seiten- oder Rückenwind, der nicht zu dir passt, zählen nie als Flugfenster. Rückenwind zeigt die App ohnehin nur im Modus Push.'
        : 'Solange dein Character noch nicht als erfahren gilt (Technik ab „solide“, mindestens 20 Flüge im Jahr, mit dem System vertraut), zeigt die App keine Startfenster bei Seiten- oder Rückenwind.',
    ),
    rows,
    current,
    spotLaunchList(),
  );
}

/** Startplätze mit eigenen Startbedingungen, mit Link dorthin */
function spotLaunchList(): HTMLElement | null {
  const own = Object.entries(state.pilot.spot_launch ?? {});
  if (own.length === 0) return h('p', { class: 'small' }, 'Für einzelne Startplätze kannst du eigene Grenzen setzen: in der Startplatz-Ansicht unter „Deine Startbedingungen hier“.');
  return h(
    'div',
    {},
    h('h4', {}, 'Eigene Startbedingungen an einzelnen Startplätzen'),
    h(
      'ul',
      { class: 'plain' },
      own.map(([id, o]) => {
        const spot = SPOTS.find((x) => x.id === id);
        const parts = [o.crosswind ? `Seitenwind ${CROSSWIND_OPTIONS.find((c) => c.id === o.crosswind)?.title.toLowerCase()}` : '', o.maxGustKmh !== undefined ? `Böen höchstens ${o.maxGustKmh} km/h` : ''].filter(Boolean);
        return h('li', {}, h('a', { href: `#${id}` }, spot?.name ?? id), `: ${parts.join(', ')}`);
      }),
    ),
  );
}

/** Optionale Vorlieben: verschieben nie Grenzen, nur wie gut dir eine Stunde gefällt */
function prefsBox(summary: HTMLElement): HTMLElement {
  const c = state.pilot.character;
  if (!c) {
    return h('section', { class: 'box' }, h('h3', {}, 'Deine Vorlieben (optional)'), h('p', { class: 'small' }, 'Sobald dein Character angelegt ist, kannst du hier sagen, was dir am Fliegen gefällt, zum Beispiel ob du Blauthermik magst.'));
  }
  const prefs = (c.prefs ??= {});
  return h(
    'details',
    { class: 'box more', open: Object.keys(prefs).length > 0 ? true : undefined },
    h('summary', {}, 'Deine Vorlieben (optional)'),
    h('div', { class: 'more-body' }, prefsQuestions(prefs, () => profileChanged(summary))),
  );
}

function prefsQuestions(prefs: Partial<Record<PrefKey, number>>, onChange: () => void): HTMLElement[] {
  return [
    h('p', { class: 'small' }, 'Alles freiwillig. Vorlieben verschieben nie deine Grenzen, sie verändern nur, wie gut dir eine Stunde gefällt. Nicht beantwortet heißt: neutral.'),
    ...PREF_QUESTIONS.map((q) =>
      h('div', { class: 'pref' }, ratingRow(q, prefs as Record<string, number>, ['trifft gar nicht zu', 'trifft voll zu'], onChange), h('span', { class: 'hint' }, q.effect)),
    ),
    h(
      'button',
      {
        type: 'button',
        class: 'btn',
        onclick: () => {
          for (const k of Object.keys(prefs)) delete prefs[k as PrefKey];
          onChange();
          render();
        },
      },
      'Vorlieben zurücksetzen',
    ),
  ];
}

function renderProfile(view: HTMLElement): void {
  const cp = state.pilot.comfort_profile;
  const summary = h('p', { class: 'summary', role: 'status' }, profileSummaryText());
  const mode = effectiveMode();

  const weights = DIM_KEYS.map((k) => {
    const t = cp.tolerance[k];
    return slider({
      id: `w-${k}`,
      label: DIM_NAMES[k],
      min: 0,
      max: 2,
      step: 0.1,
      value: t.importance_weight,
      format: weightText,
      onChange: (v) => {
        t.importance_weight = v;
        profileChanged(summary);
      },
    });
  });

  // Zurücksetzen löscht auch den Character, deshalb zweimal tippen statt eines Dialogs.
  const reset = h(
    'button',
    {
      class: 'btn',
      type: 'button',
      onclick: () => {
        if (reset.dataset.armed !== '1') {
          reset.dataset.armed = '1';
          reset.classList.add('danger');
          reset.textContent = 'Nochmal tippen: Character und Zonen werden gelöscht';
          return;
        }
        state.pilot = clonePilot(__DEFAULT_PILOT__);
        wizard.draft = null;
        wizard.step = 0;
        saveProfile();
        rescore();
        render();
      },
    },
    'Alles auf Standard zurücksetzen',
  );

  view.append(
    characterBox(),
    h('section', { class: 'box' }, h('h3', {}, 'Dein Modus heute'), modeButtons(), modeLine(), summary),
    launchBox(summary),
    prefsBox(summary),
    h(
      'section',
      { class: 'box' },
      h('h3', {}, 'Deine Flug-Zonen'),
      h('p', { class: 'coach' }, ZONES_HINT),
      h(
        'details',
        { class: 'zones-more' },
        h('summary', {}, 'Zonen ansehen und anpassen'),
        h(
          'p',
          { class: 'small' },
          'Für jede Dimension drei Grenzen: bis wohin du entspannt und im Flow fliegst (Komfort), wo du bewusst wächst (Progress) und was du dir an Push-Tagen höchstens zumutest (Challenge). Darüber beginnt die Überforderung, die nie als Flugfenster zählt. In der Stundenansicht markiert ein Strich auf dem Balken die Grenze deines Modus.',
        ),
        zoneLegend(),
        DIM_KEYS.map((k) => zoneEditor(k, summary)),
      ),
      state.pilot.character
        ? h(
            'button',
            {
              class: 'btn',
              type: 'button',
              onclick: () => {
                resetZonesFromCharacter();
                render();
              },
            },
            'Zonen aus dem Character neu berechnen',
          )
        : null,
    ),
    // <details> selbst bleibt ein Block (als Grid-Container ist es in älteren Browsern unzuverlässig)
    h(
      'details',
      { class: 'box more' },
      h('summary', {}, 'Feineinstellungen'),
      h(
        'div',
        { class: 'more-body' },
        h('h4', {}, 'Wie stark eine Überschreitung zählt'),
        h(
          'p',
          { class: 'small' },
          'Liegt eine Dimension über der Grenze deines Modus, zählt die Stunde nicht als Flugfenster. Die Gewichtung bestimmt, wie weit die Passung dann sinkt, und damit die Reihenfolge der Startplätze ohne Fenster. Skala: egal (0) bis hoch (×2).',
        ),
        weights,
        h('h4', {}, `Was ${GOAL_NAMES[mode]} mindestens braucht`),
        h('p', { class: 'small' }, 'Reicht eine Stunde dafür nicht, kostet das 25 Punkte Passung. Haken weg heißt: wird nicht geprüft. Skala 0 bis 5 wie bei den Zonen. Soaring-Stunden brauchen keine Thermik.'),
        h('div', { class: 'req' }, reqEditor('mode', (cp.min_required_scores_for_goal[mode] ??= {}), summary)),
        h('h4', {}, 'Was Strecke (XC) mindestens braucht'),
        h('p', { class: 'small' }, `Mit Strecken-Option zählt eine Stunde nur, wenn sie das erfüllt, und ein Flugfenster erst ab ${XC_MIN_WINDOW_H} Stunden. Soaring zählt hier nicht.`),
        h('div', { class: 'req' }, reqEditor('xc', (cp.min_required_scores_for_goal.xc ??= { thermic_character_min: 2.5, structure_cap_min: 2.5 }), summary)),
      ),
    ),
    debriefBox(),
    h('section', { class: 'box' }, h('p', { class: 'small' }, 'Character, Startbedingungen, Zonen, Modus, Favoriten und Debriefings werden nur auf diesem Gerät gespeichert.'), reset),
  );
}

// ---------------------------------------------------------------------------
// Debriefing nach dem Flug (erste Fassung des Flugtagebuchs)
// ---------------------------------------------------------------------------

const COMPARE_OPTIONS: { id: Compare; title: string }[] = [
  { id: 'less', title: 'schwächer' },
  { id: 'as', title: 'wie vorhergesagt' },
  { id: 'more', title: 'stärker' },
];

interface DebriefDraft {
  spotId: string;
  date: string;
  hour: number;
  answers: DebriefAnswers;
  note: string;
}

let debriefDraft: DebriefDraft | null = null;
let debriefFlash = '';

function newDebriefDraft(): DebriefDraft {
  const now = berlin(new Date());
  const fav = SPOTS.find((x) => isFavorite(x.id));
  return { spotId: state.spotId || fav?.id || SPOTS[0].id, date: now.date, hour: Math.max(8, Math.min(19, now.hour - 2)), answers: {}, note: '' };
}

function saveDebriefs(): void {
  writeStore(DEBRIEF_KEY, JSON.stringify(state.debriefs));
}

/** Kleine Auswahl als Chips; aktualisiert sich selbst, ohne die Seite neu aufzubauen */
function chipGroup<T extends string | number>(label: string, options: { id: T; title: string }[], value: T | undefined, onPick: (id: T) => void): HTMLElement {
  const buttons: HTMLElement[] = options.map((o) =>
    h(
      'button',
      {
        type: 'button',
        class: 'chip',
        'aria-pressed': String(o.id === value),
        onclick: (e: Event) => {
          for (const b of buttons) b.setAttribute('aria-pressed', String(b === e.currentTarget));
          onPick(o.id);
        },
      },
      o.title,
    ),
  );
  return h('div', { class: 'dq' }, h('span', { class: 'dq-l' }, label), h('div', { class: 'filters', role: 'group', 'aria-label': label }, buttons));
}

function forecastHour(spotId: string, date: string, hour: number): HourEvaluation | undefined {
  const time = `${date}T${String(hour).padStart(2, '0')}:00`;
  return state.evals.find((e) => e.spot.id === spotId)?.hours.find((x) => x.time === time);
}

function debriefForm(): HTMLElement {
  const d = (debriefDraft ??= newDebriefDraft());
  const a = d.answers;
  const match = h('p', { class: 'small', role: 'status' });
  const showMatch = () => {
    const fh = forecastHour(d.spotId, d.date, d.hour);
    match.textContent = fh
      ? `Vorhersage für diese Stunde: ${PZONE_NAMES[fh.fit.personalZone]}, ${fh.zoneLabel}, Grundwind ${kmh(fh.metrics.takeoffWindKmh)}, Böen ${kmh(fh.metrics.gustKmh)}. Die App legt sie neben deine Antworten.`
      : 'Für diese Stunde ist keine Vorhersage mehr gespeichert. Der Eintrag wird ohne Abgleich gespeichert.';
  };
  const favFirst = [...SPOTS].sort((x, y) => Number(isFavorite(y.id)) - Number(isFavorite(x.id)));
  const spotSel = h(
    'select',
    { id: 'db-spot', onchange: (e: Event) => ((d.spotId = (e.target as HTMLSelectElement).value), showMatch()) },
    favFirst.map((sp) => h('option', { value: sp.id, selected: sp.id === d.spotId }, `${isFavorite(sp.id) ? '★ ' : ''}${sp.name}`)),
  );
  const dateIn = h('input', { id: 'db-date', type: 'date', value: d.date, onchange: (e: Event) => ((d.date = (e.target as HTMLInputElement).value), showMatch()) });
  const hourSel = h(
    'select',
    { id: 'db-hour', onchange: (e: Event) => ((d.hour = Number((e.target as HTMLSelectElement).value)), showMatch()) },
    Array.from({ length: 15 }, (_, i) => i + 6).map((hh) => h('option', { value: hh, selected: hh === d.hour }, `${String(hh).padStart(2, '0')} Uhr`)),
  );
  showMatch();
  const save = h(
    'button',
    {
      type: 'button',
      class: 'btn primary',
      onclick: () => {
        if (a.feeling === undefined) {
          debriefFlash = 'Bitte wähle noch, wie du dich im Flug gefühlt hast.';
          render();
          return;
        }
        const fh = forecastHour(d.spotId, d.date, d.hour);
        const forecast = fh ? snapshotOf(fh, envelopeOf(state.pilot)) : undefined;
        const entry: DebriefEntry = {
          id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
          createdAt: new Date().toISOString(),
          spotId: d.spotId,
          date: d.date,
          hour: d.hour,
          answers: { ...a },
          note: d.note.trim() || undefined,
          forecast,
          suggestions: [],
        };
        entry.suggestions = suggestFromEntry(entry);
        state.debriefs.unshift(entry);
        saveDebriefs();
        debriefDraft = null;
        debriefFlash = entry.suggestions.length > 0 ? 'Gespeichert. Die App hat einen Vorschlag für deine Zonen, siehe unten.' : forecast ? 'Gespeichert. Deine Antworten passen zur Vorhersage, kein Vorschlag nötig.' : 'Gespeichert (ohne Abgleich mit der Vorhersage).';
        render();
      },
    },
    'Debriefing speichern',
  );
  return h(
    'div',
    { class: 'debrief-form' },
    h('div', { class: 'dgrid' }, h('label', { for: 'db-spot' }, 'Startplatz', spotSel), h('label', { for: 'db-date' }, 'Tag', dateIn), h('label', { for: 'db-hour' }, 'Start um', hourSel)),
    match,
    chipGroup('Start', [{ id: 'easy', title: 'leicht' }, { id: 'ok', title: 'okay' }, { id: 'hard', title: 'schwierig' }], a.launch, (id) => (a.launch = id)),
    chipGroup('Wind', COMPARE_OPTIONS, a.wind, (id) => (a.wind = id)),
    chipGroup('Turbulenz', COMPARE_OPTIONS, a.turbulence, (id) => (a.turbulence = id)),
    chipGroup('Thermik', COMPARE_OPTIONS, a.thermal, (id) => (a.thermal = id)),
    chipGroup('Basis oder Arbeitshöhe erreicht', [{ id: 'yes', title: 'ja' }, { id: 'no', title: 'nein' }], a.base, (id) => (a.base = id)),
    chipGroup('Abschattung', [{ id: 'none', title: 'keine' }, { id: 'some', title: 'etwas' }, { id: 'much', title: 'stark' }], a.shading, (id) => (a.shading = id)),
    chipGroup('Wieder so fliegen?', [{ id: 'yes', title: 'ja' }, { id: 'maybe', title: 'vielleicht' }, { id: 'no', title: 'nein' }], a.again, (id) => (a.again = id)),
    h('div', { class: 'dq' }, h('span', { class: 'dq-l' }, 'Wie hast du dich gefühlt?'), feelingRow(a)),
    h('label', { class: 'dnote' }, 'Notiz (optional)', h('textarea', { rows: 2, oninput: (e: Event) => (d.note = (e.target as HTMLTextAreaElement).value) }, d.note)),
    save,
  );
}

function feelingRow(a: DebriefAnswers): HTMLElement {
  const words = ['gar nicht wohl', 'eher unwohl', 'neutral', 'wohl', 'rundum wohl'];
  const buttons: HTMLElement[] = FEELINGS.map((emoji, i) =>
    h(
      'button',
      {
        type: 'button',
        'aria-pressed': String(a.feeling === i),
        'aria-label': words[i],
        title: words[i],
        onclick: (e: Event) => {
          a.feeling = i;
          for (const b of buttons) b.setAttribute('aria-pressed', String(b === e.currentTarget));
        },
      },
      emoji,
    ),
  );
  return h('div', { class: 'feel', role: 'group', 'aria-label': 'Gefühl im Flug' }, buttons);
}

function applyDebriefSuggestion(entry: DebriefEntry, index: number, take: boolean): void {
  const sug = entry.suggestions[index];
  if (!sug || sug.status !== 'open') return;
  if (take) {
    const env = editableEnvelope();
    applySuggestion(env, sug);
    const tol = state.pilot.comfort_profile.tolerance[sug.dim];
    if (tol) tol.max_score_acceptable = env[sug.dim].progress;
    saveProfile();
    rescore();
  }
  sug.status = take ? 'applied' : 'dismissed';
  saveDebriefs();
  render();
}

function debriefEntryView(e: DebriefEntry): HTMLElement {
  const spot = SPOTS.find((x) => x.id === e.spotId);
  const f = e.forecast;
  const a = e.answers;
  const cmp = (x?: Compare) => (x ? COMPARE_OPTIONS.find((o) => o.id === x)?.title : undefined);
  const said = [
    a.launch ? `Start ${{ easy: 'leicht', ok: 'okay', hard: 'schwierig' }[a.launch]}` : '',
    cmp(a.wind) ? `Wind ${cmp(a.wind)}` : '',
    cmp(a.turbulence) ? `Turbulenz ${cmp(a.turbulence)}` : '',
    cmp(a.thermal) ? `Thermik ${cmp(a.thermal)}` : '',
    a.base ? (a.base === 'yes' ? 'Basis erreicht' : 'Basis nicht erreicht') : '',
    a.shading && a.shading !== 'none' ? `Abschattung ${a.shading === 'some' ? 'etwas' : 'stark'}` : '',
    a.again ? `wieder so: ${{ yes: 'ja', maybe: 'vielleicht', no: 'nein' }[a.again]}` : '',
  ].filter(Boolean);
  return h(
    'li',
    { class: 'dentry' },
    h('div', { class: 'dhead' }, h('b', {}, `${spot?.name ?? e.spotId}, ${dateShort(e.date)} ${String(e.hour).padStart(2, '0')} Uhr`), h('span', { class: 'emo' }, a.feeling !== undefined ? FEELINGS[a.feeling] : '')),
    said.length > 0 ? h('p', { class: 'small' }, said.join(' · ')) : null,
    f ? h('p', { class: 'small' }, `Vorhersage: ${PZONE_NAMES[f.personalZone]}, ${f.zoneLabel}, ${f.windKmh}/${f.gustKmh} km/h, Passung ${f.fit}`) : h('p', { class: 'small' }, 'ohne Abgleich mit der Vorhersage'),
    e.note ? h('p', { class: 'small' }, `„${e.note}“`) : null,
    e.suggestions.map((sug, i) =>
      h(
        'div',
        { class: `dsug ${sug.status}` },
        h('p', {}, sug.text),
        sug.status === 'open'
          ? h(
              'div',
              { class: 'dsug-btns' },
              h('button', { type: 'button', class: 'btn primary', onclick: () => applyDebriefSuggestion(e, i, true) }, sug.delta > 0 ? 'Mutiger stellen' : 'Vorsichtiger stellen'),
              h('button', { type: 'button', class: 'btn', onclick: () => applyDebriefSuggestion(e, i, false) }, 'Nein, so lassen'),
            )
          : h('p', { class: 'small' }, sug.status === 'applied' ? 'übernommen' : 'verworfen'),
      ),
    ),
    h(
      'button',
      {
        type: 'button',
        class: 'linkbtn',
        onclick: () => {
          state.debriefs = state.debriefs.filter((x) => x.id !== e.id);
          saveDebriefs();
          render();
        },
      },
      'Eintrag löschen',
    ),
  );
}

function debriefBox(): HTMLElement {
  const flash = debriefFlash;
  debriefFlash = '';
  const open = state.debriefs.length > 0 || debriefDraft !== null || flash !== '';
  return h(
    'details',
    { class: 'box more', id: 'debriefing', open: open ? true : undefined },
    h('summary', {}, `Debriefing nach dem Flug${state.debriefs.length > 0 ? ` (${state.debriefs.length})` : ''}`),
    h(
      'div',
      { class: 'more-body' },
      h(
        'p',
        { class: 'small' },
        'Wie war es wirklich? Die App legt die Vorhersage für Startplatz und Stunde neben deine Antworten. Passt beides nicht zusammen, schlägt sie vor, deine Zonen eine Viertelstufe vorsichtiger oder mutiger zu stellen. Übernommen wird nur, was du bestätigst.',
      ),
      flash ? h('p', { class: 'coach ok', role: 'status' }, flash) : null,
      debriefForm(),
      state.debriefs.length > 0 ? h('h4', {}, 'Deine Einträge') : null,
      state.debriefs.length > 0 ? h('ul', { class: 'dlist' }, state.debriefs.slice(0, 20).map(debriefEntryView)) : null,
    ),
  );
}

// ---------------------------------------------------------------------------
// Ansicht: Character anlegen (fünf Schritte, Fragen aus dem Flow-Entwurf)
// ---------------------------------------------------------------------------

interface Draft {
  style?: FlightStyle;
  wing?: WingClass;
  familiar?: Familiarity;
  currency?: Currency;
  reverseLaunch?: boolean;
  crosswind?: CrosswindTolerance;
  tailwind?: TailwindTolerance;
  skills: Record<string, number>;
  safety: Record<string, number>;
  prefs: Partial<Record<PrefKey, number>>;
}

const WIZARD_STEPS = ['Flugstil', 'Schirm, Flugpraxis und Start', 'Technik', 'Sicherheitsgefühl', 'Ergebnis'];

function draftAnswers(d: Draft): CharacterAnswers {
  return {
    style: d.style!,
    wing: d.wing!,
    familiar: d.familiar,
    currency: d.currency!,
    reverseLaunch: d.reverseLaunch,
    crosswind: d.crosswind,
    tailwind: d.tailwind,
    skills: d.skills,
    safety: d.safety,
    ...(Object.keys(d.prefs).length > 0 ? { prefs: { ...d.prefs } } : {}),
  };
}
const wizard = { step: 0, draft: null as Draft | null };

function wizardDraft(): Draft {
  if (!wizard.draft) {
    const c = state.pilot.character;
    wizard.draft = c
      ? {
          style: normalizeStyle(c.style),
          wing: c.wing,
          familiar: c.familiar,
          currency: c.currency,
          reverseLaunch: c.reverseLaunch,
          crosswind: c.crosswind,
          tailwind: c.tailwind,
          skills: { ...c.skills },
          safety: { ...c.safety },
          prefs: { ...(c.prefs ?? {}) },
        }
      : { skills: {}, safety: {}, prefs: {} };
  }
  return wizard.draft;
}

function openQuestions(step: number, d: Draft): number {
  if (step === 0) return d.style ? 0 : 1;
  if (step === 1) return [d.wing, d.familiar, d.currency, d.reverseLaunch].filter((x) => x === undefined).length;
  if (step === 2) return SKILL_QUESTIONS.filter((q) => d.skills[q.id] === undefined).length;
  if (step === 3) return SAFETY_QUESTIONS.filter((q) => d.safety[q.id] === undefined).length;
  return 0;
}

function goStep(step: number): void {
  wizard.step = Math.max(0, Math.min(WIZARD_STEPS.length - 1, step));
  render();
  window.scrollTo(0, 0);
}

function leaveWizard(target: string): void {
  wizard.step = 0;
  wizard.draft = null;
  location.hash = target;
}

function choiceList<T extends string>(
  label: string,
  options: { id: T; title: string; subtitle?: string; text?: string }[],
  value: T | undefined,
  onPick: (id: T) => void,
): HTMLElement {
  const buttons: HTMLElement[] = options.map((o) =>
    h(
      'button',
      {
        type: 'button',
        class: 'choice',
        'aria-pressed': String(o.id === value),
        onclick: (e: Event) => {
          for (const b of buttons) b.setAttribute('aria-pressed', String(b === e.currentTarget));
          onPick(o.id);
        },
      },
      h('b', {}, o.title, o.subtitle ? h('em', {}, `: ${o.subtitle}`) : null),
      o.text ? h('span', {}, o.text) : null,
    ),
  );
  return h('div', { class: 'choices', role: 'group', 'aria-label': label }, buttons);
}

/** Eine Frage mit Antwort 0 bis 5 als sechs Tasten (auf dem Handy treffsicherer als ein Regler, und nichts ist vorbelegt) */
function ratingRow(q: { id: string; label: string }, values: Record<string, number>, ends: [string, string], onChange: () => void): HTMLElement {
  const labelId = `q-${q.id}`;
  const buttons: HTMLElement[] = [0, 1, 2, 3, 4, 5].map((n) =>
    h(
      'button',
      {
        type: 'button',
        'aria-pressed': String(values[q.id] === n),
        onclick: (e: Event) => {
          values[q.id] = n;
          for (const b of buttons) b.setAttribute('aria-pressed', String(b === e.currentTarget));
          onChange();
        },
      },
      String(n),
    ),
  );
  return h(
    'div',
    { class: 'q rate', role: 'group', 'aria-labelledby': labelId },
    h('p', { id: labelId }, q.label),
    h('div', { class: 'rate-btns' }, buttons),
    h('div', { class: 'rate-ends', 'aria-hidden': 'true' }, h('span', {}, ends[0]), h('span', {}, ends[1])),
  );
}

function scoreMeter(label: string, value: number, max: number, bands: number[], text: string): HTMLElement {
  return h(
    'div',
    { class: 'meter' },
    h('div', { class: 'meter-head' }, h('span', {}, label), h('b', {}, `${value} von ${max}`)),
    h(
      'span',
      { class: 'bar', role: 'img', 'aria-label': `${label}: ${value} von ${max}` },
      h('span', { style: `width:${(value / max) * 100}%` }),
      bands.map((b) => h('i', { style: `left:calc(${(b / max) * 100}% - 1px)` })),
    ),
    h('span', { class: 'small' }, text),
  );
}

function launchText(l: { crosswind: CrosswindTolerance; tailwind: TailwindTolerance; reverseLaunch?: boolean }): string {
  const cw = {
    no: 'Seitenwind bis 30° bei Böen bis 15 km/h',
    light: 'Seitenwind bis 30° bei Böen bis 20 km/h, bis 60° bei Böen bis 10 km/h',
    yes: 'Seitenwind bis 30° bei Böen bis 20 km/h, bis 60° bei Böen bis 15 km/h, darüber kritisch prüfen',
  }[l.crosswind];
  const tw = l.tailwind === 'light' ? 'leichter Rückenwind nur im Modus Push und bei Böen unter 10 km/h' : 'kein Rückenwind';
  const rev =
    l.reverseLaunch === true
      ? 'Rückwärtsaufziehen sicher'
      : l.reverseLaunch === false
        ? `ohne Rückwärtsaufziehen kein Vorwärtsstart über ${LAUNCH_LIMITS.reverseRequiredKmh} km/h`
        : 'Rückwärtsaufziehen nicht angegeben';
  return `${capitalize(cw)}, ${tw}, ${rev}.`;
}

/** Die ausgeklappten Zonen: erst der Hinweis, dann Legende und Skalen */
function zonesDetails(envelope: Record<DimensionKey, EnvelopeLimits>): HTMLElement {
  return h(
    'details',
    { class: 'zones-more' },
    h('summary', {}, 'Deine Flug-Zonen ansehen'),
    zoneLegend(),
    h(
      'div',
      { class: 'zlist' },
      DIM_KEYS.map((k) =>
        h('div', { class: 'zrow' }, h('div', { class: 'zrow-head' }, h('b', {}, DIM_NAMES[k]), h('span', {}, limitsText(envelope[k]))), zoneScale(envelope[k]), zoneTicks()),
      ),
    ),
  );
}

function characterResultView(d: Draft, update: () => void): HTMLElement[] {
  const answers = draftAnswers(d);
  const r = scoreCharacter(answers);
  const launchQs: HTMLElement[] = [];
  if (r.crosswindUnlocked) {
    launchQs.push(
      h('h3', {}, 'Deine Startbedingungen'),
      h('p', { class: 'small' }, 'Du bist erfahren genug für diese Fragen. Ohne Antwort rechnet die App vorsichtig mit „nein“.'),
      h('div', { class: 'q' }, h('h4', {}, 'Seitenwind tolerieren?'), choiceList('Seitenwind', CROSSWIND_OPTIONS, d.crosswind, (id) => ((d.crosswind = id), update()))),
    );
    if (r.tailwindUnlocked) {
      launchQs.push(h('div', { class: 'q' }, h('h4', {}, 'Rückenwind tolerieren?'), choiceList('Rückenwind', TAILWIND_OPTIONS, d.tailwind, (id) => ((d.tailwind = id), update()))));
    }
  }
  return [
    h('p', { class: 'lead' }, `Dein aktuelles Profil: ${characterSummary(answers, r)}. Dieses Profil bildet die Basis für deine persönlichen Flug-Zonen.`),
    h('div', { class: 'meters' }, scoreMeter('Technik', r.skillTotal, 50, [15, 30, 40], r.skillLabel), scoreMeter('Sicherheitsgefühl', r.safetyTotal, 40, [20, 30], r.safetyLabel)),
    ...launchQs,
    h('p', { class: 'small', id: 'launch-summary' }, `Startbedingungen: ${launchText(r.launch)}`),
    h(
      'p',
      { class: 'coach' },
      r.pushAdvised
        ? 'An Push-Tagen zählen bei dir Stunden bis in deine Challenge-Zone.'
        : `An Push-Tagen zählen bei dir vorerst Stunden bis in deine Progress-Zone. ${r.pushReason} Das ist keine Wertung, sondern deine Sicherheitsreserve.`,
    ),
    h(
      'p',
      {},
      `Tagesmodus zum Start: ${GOAL_NAMES[r.defaultMode]}${r.defaultXc ? ' mit Strecke (XC)' : ''}, passend zu deinem Flugstil. Du kannst ihn jeden Tag neu wählen. Der Flugstil verschiebt nie deine Grenzen, die kommen nur aus Technik, Sicherheitsgefühl, Schirm und Flugpraxis.`,
    ),
    h(
      'details',
      { class: 'zones-more' },
      h('summary', {}, 'Optional: deine Vorlieben'),
      h('div', { class: 'wizard' }, prefsQuestions(d.prefs, update)),
    ),
    h('h3', {}, 'Deine Flug-Zonen'),
    h('p', { class: 'coach' }, ZONES_HINT),
    zonesDetails(r.envelope),
    h(
      'details',
      { class: 'zones-more' },
      h('summary', {}, 'Wie die Grenzen zustande kommen'),
      h('ul', { class: 'plain' }, h('li', {}, `Grundlage ist die Starttabelle für deine Technik-Stufe „${r.skillLabel}“.`), r.adjustments.map((a) => h('li', {}, a))),
    ),
    state.pilot.comfort_profile.envelope ? h('p', { class: 'small' }, 'Übernehmen ersetzt deine bisherigen Zonen und Startbedingungen.') : null,
  ].filter((x): x is HTMLElement => x !== null);
}

function renderCharacter(view: HTMLElement): void {
  const d = wizardDraft();
  if (wizard.step === WIZARD_STEPS.length - 1) {
    const open = [0, 1, 2, 3].find((s) => openQuestions(s, d) > 0);
    if (open !== undefined) wizard.step = open;
  }
  const step = wizard.step;
  const items: { el: HTMLElement; done: () => boolean }[] = [];
  const openHint = h('span', { class: 'open' });
  const update = () => {
    const open = openQuestions(step, d);
    openHint.textContent = open === 0 ? '' : open === 1 ? 'noch 1 Frage offen' : `noch ${open} Fragen offen`;
    for (const it of items) if (it.done()) it.el.classList.remove('missing');
  };
  const question = (title: string, control: HTMLElement, done: () => boolean): HTMLElement => {
    const el = h('div', { class: 'q' }, h('h3', {}, title), control);
    items.push({ el, done });
    return el;
  };

  let body: HTMLElement[];
  if (step === 0) {
    body = [
      h(
        'p',
        { class: 'lead' },
        'Fünf kurze Schritte, etwa zwei Minuten. Aus deinen Antworten berechnet die App deine persönlichen Zonen: grün Komfort, gelb Progress, orange Challenge und rot Überforderung.',
      ),
      h(
        'p',
        { class: 'lead' },
        'Hier geht’s um dich als Pilot:in: wer du bist und wie du dich fühlst. Ehrliche Antworten bringen dich länger weiter :) Alles bleibt auf diesem Gerät und kann immer verändert werden.',
      ),
      question('Welcher Flugstil beschreibt dich aktuell am besten?', choiceList('Flugstil', STYLE_OPTIONS, d.style, (id) => ((d.style = id), update())), () => !!d.style),
    ];
  } else if (step === 1) {
    body = [
      question('Welche Schirmklasse fliegst du gerade?', choiceList('Schirmklasse', WING_OPTIONS, d.wing, (id) => ((d.wing = id), update())), () => !!d.wing),
      question(
        'Ich bin mit meinem System vertraut und sicher.',
        choiceList('Mit dem System vertraut', FAMILIAR_OPTIONS, d.familiar, (id) => ((d.familiar = id), update())),
        () => !!d.familiar,
      ),
      question('Wie oft fliegst du?', choiceList('Flüge pro Jahr', CURRENCY_OPTIONS, d.currency, (id) => ((d.currency = id), update())), () => !!d.currency),
      question(
        'Ziehst du sicher rückwärts auf?',
        choiceList('Rückwärtsaufziehen', REVERSE_OPTIONS, d.reverseLaunch === undefined ? undefined : d.reverseLaunch ? 'yes' : 'no', (id) => ((d.reverseLaunch = id === 'yes'), update())),
        () => d.reverseLaunch !== undefined,
      ),
      h(
        'p',
        { class: 'small' },
        `Schirmklasse, Vertrautheit und Flugpraxis verschieben deine Grenzen ein wenig, vor allem beim Wind. Ab etwa ${LAUNCH_LIMITS.reverseHintKmh} km/h ist Rückwärtsaufziehen die sicherere Startmethode; ohne empfiehlt die App über ${LAUNCH_LIMITS.reverseRequiredKmh} km/h keinen Vorwärtsstart.`,
      ),
    ];
  } else if (step === 2) {
    body = [
      h('p', { class: 'lead' }, 'Wie sicher beherrschst du das heute? 0 heißt: kann ich noch nicht. 5 heißt: sicher und routiniert.'),
      ...SKILL_QUESTIONS.map((q) => {
        const el = ratingRow(q, d.skills, ['kann ich noch nicht', 'sicher und routiniert'], update);
        items.push({ el, done: () => d.skills[q.id] !== undefined });
        return el;
      }),
    ];
  } else if (step === 3) {
    body = [
      h('p', { class: 'lead' }, 'Hier geht es um dein Gefühl in der Luft, nicht um Können. Wie sehr trifft das auf dich zu? 0 heißt: gar nicht, 5: voll und ganz.'),
      ...SAFETY_QUESTIONS.map((q) => {
        const el = ratingRow(q, d.safety, ['trifft gar nicht zu', 'trifft voll zu'], update);
        items.push({ el, done: () => d.safety[q.id] !== undefined });
        return el;
      }),
    ];
  } else {
    // Antworten zu Seiten- und Rückenwind aktualisieren die Zusammenfassung sofort
    body = characterResultView(d, () => {
      const el = document.getElementById('launch-summary');
      if (el) el.textContent = `Startbedingungen: ${launchText(scoreCharacter(draftAnswers(d)).launch)}`;
    });
  }

  const last = step === WIZARD_STEPS.length - 1;
  const back =
    step === 0
      ? h('button', { type: 'button', class: 'btn', onclick: () => leaveWizard(state.pilot.character ? 'profil' : 'fenster') }, 'Abbrechen')
      : h('button', { type: 'button', class: 'btn', onclick: () => goStep(step - 1) }, 'Zurück');
  const next = h(
    'button',
    {
      type: 'button',
      class: 'btn primary',
      onclick: () => {
        if (last) {
          applyCharacter(draftAnswers(d));
          state.flash = `Character übernommen. Die Flugfenster zeigen jetzt deine persönlichen Zonen im Modus ${GOAL_NAMES[effectiveMode()]}.`;
          leaveWizard('fenster');
          return;
        }
        const missing = items.filter((it) => !it.done());
        if (missing.length > 0) {
          for (const it of missing) it.el.classList.add('missing');
          missing[0].el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          return;
        }
        goStep(step + 1);
      },
    },
    last ? 'Übernehmen' : step === WIZARD_STEPS.length - 2 ? 'Zum Ergebnis' : 'Weiter',
  );
  update();

  view.append(
    h(
      'div',
      { class: 'wizard-head' },
      h('h2', {}, state.pilot.character ? 'Character neu einlesen' : 'Dein Character'),
      h('p', { class: 'small' }, `Schritt ${step + 1} von ${WIZARD_STEPS.length}: ${WIZARD_STEPS[step]}`),
      h('div', { class: 'stepbar', 'aria-hidden': 'true' }, WIZARD_STEPS.map((_, i) => h('i', { class: i <= step ? 'on' : '' }))),
    ),
    h('section', { class: last ? 'wizard box' : 'wizard' }, body),
    h('div', { class: 'wnav' }, back, openHint, next),
  );
}

// ---------------------------------------------------------------------------
// Ansicht: Info
// ---------------------------------------------------------------------------

function renderInfo(view: HTMLElement): void {
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
      h('h3', {}, 'Deine Zonen'),
      zoneLegend(true),
      h(
        'ul',
        {},
        h('li', {}, 'Komfort: Bedingungen, in denen du entspannt und sicher fliegst.'),
        h('li', {}, 'Progress: etwas über deiner Komfortzone, gut zum bewussten Lernen.'),
        h('li', {}, 'Challenge: anspruchsvoll, für Push-Tage mit klarer Sicherheitsstrategie.'),
        h('li', {}, 'Überforderung: über deinen Grenzen. Zählt nie als Flugfenster.'),
        h('li', {}, 'No-Go: feste Regeln, unabhängig von dir: Nacht, Niederschlag, Nebel, Start in der Wolke, zu viel Wind oder Böen, falsche Windrichtung, Lee, Auflagen des Geländes oder zu heftige Bedingungen.'),
      ),
      h('p', { class: 'small' }, 'Die Grenzen kommen aus deinem Character und lassen sich im Profil verstellen. Für jede Stunde entscheidet die anspruchsvollste der vier Dimensionen.'),
    ),
    h(
      'section',
      { class: 'box' },
      h('h3', {}, 'Tagesmodus'),
      h(
        'ul',
        {},
        h('li', {}, `Chill: ${GOAL_LONG.chill} Es zählen Stunden mit ruhiger Luft in deiner Komfort-Zone.`),
        h('li', {}, `Flow: ${GOAL_LONG.flow} Es zählen alle Stunden in deiner Komfort-Zone.`),
        h('li', {}, `Push: ${GOAL_LONG.push} Es zählen Stunden bis in deine Challenge-Zone, solange dein Technik-Score unter 31 von 50 oder dein Sicherheits-Score unter 21 von 40 liegt (oder noch kein Character angelegt ist) bis in deine Progress-Zone.`),
        h('li', {}, `Strecke (XC): eine eigene Option zu jedem Modus. Dann zählen nur Stunden mit genug Thermik und Arbeitshöhe, und ein Flugfenster erst ab ${XC_MIN_WINDOW_H} Stunden. Soaring zählt dafür nicht, Blauthermik bewertet die App nach deinen Vorlieben.`),
      ),
      h('p', { class: 'small' }, 'Die Modi beschreiben die Flug- und Entscheidungslage, nicht dein Können. Streckenfliegen ist keine höhere Stufe, sondern eine eigene Art zu fliegen.'),
    ),
    h(
      'section',
      { class: 'box' },
      h('h3', {}, 'Lufttyp'),
      h(
        'p',
        {},
        'Neben deiner Zone beschreibt die App die Luft selbst, unabhängig von dir: ruhig (kaum oder leichte Thermik), lebhaft (nutzbare Thermik, Soaring-Wind oder unruhige Luft) und Streckenwetter (kräftige Thermik und genug Arbeitshöhe).',
      ),
    ),
    h(
      'section',
      { class: 'box' },
      h('h3', {}, 'Die vier Dimensionen'),
      h(
        'p',
        { class: 'small' },
        'Angezeigt werden echte Werte: Wind als Grundwind/Böen in km/h, Thermik als geschätztes Steigen, Turbulenz als Wort, Überhöhung in Metern über dem Start. Intern rechnet die App jede Dimension auf einer Skala von 0 bis 5; die brauchst du nur für die Zonen-Grenzen.',
      ),
      ...titledInfo('h4', 'Wind', 'wind'),
      ...titledInfo('h4', 'Thermik', 'thermik'),
      ...titledInfo('h4', 'Basis', 'basis'),
      ...titledInfo('h4', 'Turbulenz / Scherung', 'turbulenz'),
      ...titledInfo('h4', 'Windscherung', 'scherung'),
      ...titledInfo('h4', 'Mögliche Überhöhung / Deckel', 'ueberhoehung'),
      ...titledInfo('h4', 'Inversion', 'inversion'),
      h(
        'p',
        { class: 'small' },
        'Passung: 100, wenn alle vier Dimensionen in der Zone deines Modus liegen, 75, wenn es für den Modus nicht ganz reicht (zum Beispiel zu wenig Thermik). Deine Vorlieben verschieben sie ein wenig. Liegt eine Dimension darüber, ist die Luft für Chill zu lebhaft oder passt der Start nicht zu deinen Startbedingungen, bleibt die Passung unter 50, bei Überforderung unter 20. Mit Strecken-Option bleibt sie unter 60, wenn es für Strecke nicht reicht. Ab 60 zählt eine Stunde zum Flugfenster.',
      ),
    ),
    h(
      'section',
      { class: 'box' },
      h('h3', {}, 'Grenzen des Prototyps'),
      h(
        'ul',
        {},
        h('li', {}, 'Die Starttabelle für deine Zonen und die Schwellen der Dimensionen sind Startwerte und noch nicht an echten Flügen geeicht. Mit dem Debriefing im Profil kannst du sie nach jedem Flug nachjustieren.'),
        h('li', {}, 'Das Modellgelände ist geglättet. Düsen, Talwind und lokale Effekte fehlen, am Merkur ist der Wind oft stärker als vorhergesagt.'),
        h('li', {}, 'Bei Windstille gelten alle Startrichtungen eines Bergs als möglich. Ob die Sonne auf den Hang scheint, rechnet die App bisher nur beim Soaring ein.'),
        h('li', {}, 'Die App ersetzt nicht den Blick auf Stationen, Webcams und die Lage vor Ort. Bewusst nicht zu starten ist eine starke Entscheidung.'),
      ),
    ),
  );
}

// ---------------------------------------------------------------------------
// Rahmen
// ---------------------------------------------------------------------------

function readHash(): void {
  const id = decodeURIComponent(location.hash.slice(1));
  if (id === 'profil' || id === 'info' || id === 'character') {
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
  if (state.view === 'character') {
    renderCharacter(view);
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
    if (state.view !== 'fenster') state.flash = '';
    render();
    window.scrollTo(0, 0);
  });
  document.getElementById('refresh')?.addEventListener('click', () => {
    void loadData(true);
  });
  void loadData(false);
}

start();
