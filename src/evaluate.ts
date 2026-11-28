// Bewertung einer Stunde: Kennwerte berechnen, vier Dimensionen bewerten, No-Go-Regeln prüfen, Zone bestimmen.

import type {
  DimensionKey,
  DimensionScore,
  HourInput,
  HourMetrics,
  NoGoReason,
  Spot,
  Zone,
} from './types.ts';
import { curve, type EngineConfig } from './config.ts';
import {
  angleDiff,
  clockTime,
  compass,
  convectiveVelocity,
  envDewPoint,
  envTemperature,
  fromUV,
  inSector,
  liftParcel,
  rhFromDewPoint,
  sunTimes,
  windAt,
} from './physics.ts';
import { aboveStart, alt100, de1 } from './format.ts';

const KMH = 3.6;
const r0 = (x: number) => Math.round(x);
const r1 = (x: number) => Math.round(x * 10) / 10;

// ---------------------------------------------------------------------------
// Kennwerte
// ---------------------------------------------------------------------------

export function computeMetrics(spot: Spot, hour: HourInput, cfg: EngineConfig): HourMetrics {
  const s = hour.surface;
  const zT = spot.elevation;

  // Wind in Starthöhe. Die untersten 80 m über dem (geglätteten) Modellgelände sind durch Reibung gebremst,
  // ein exponierter Startplatz spürt eher den Wind darüber.
  const zWind = Math.max(zT, s.z + 80);
  const wTake = windAt(hour.wind, zWind);
  const rel = (((wTake.dir - spot.facing) % 360) + 540) % 360 - 180;
  const headwind = wTake.speed * Math.cos((rel * Math.PI) / 180);
  const crosswind = Math.abs(wTake.speed * Math.sin((rel * Math.PI) / 180));

  // Wind 200–800 m über dem Start (für Lee- und Rotorregeln)
  let su = 0;
  let sv = 0;
  let n = 0;
  for (let z = zT + 200; z <= zT + 800; z += 100) {
    const w = windAt(hour.wind, z);
    su += w.u;
    sv += w.v;
    n++;
  }
  const wAbove = fromUV(su / n, sv / n);

  // Thermik: Luftpaket vom Modellboden heben
  const parcel = liftParcel(hour.thermo, { z: s.z + 2, t: s.t2m, td: s.td2m });
  const sunny = hour.isDay && s.swRad >= 30;
  const hasCu = parcel.cloudTop !== null;
  let thermalTop = hasCu ? parcel.lcl : parcel.dryTop;
  if (!sunny) thermalTop = s.z;
  const blDepth = Math.max(0, thermalTop - s.z);
  const heatFlux = sunny ? cfg.thermal.sensibleHeatFraction * s.swRad : 0;
  const wStar = convectiveVelocity(heatFlux, blDepth, s.t2m, s.pSurf);
  const climb = Math.max(0, cfg.thermal.coreFactor * wStar - cfg.thermal.gliderSink);

  // Thermik-Index: stärkster Wert zwischen Start (bzw. 100 m über Modellboden) und Obergrenze
  let tiMin: number | null = null;
  if (sunny) {
    const lo = Math.max(zT, s.z + 100);
    for (const p of parcel.ti) {
      if (p.z >= lo && p.z <= thermalTop) tiMin = tiMin === null ? p.ti : Math.min(tiMin, p.ti);
    }
  }
  let ti850: number | null = null;
  const l850 = hour.thermo.find((l) => l.p === 850);
  if (sunny && l850) {
    const near = parcel.ti.reduce<{ z: number; ti: number } | null>(
      (best, p) => (best === null || Math.abs(p.z - l850.z) < Math.abs(best.z - l850.z) ? p : best),
      null,
    );
    if (near && Math.abs(near.z - l850.z) <= 25) ti850 = near.ti;
  }

  // Flugschicht: vom Start bis zur Thermikobergrenze, mindestens 300 m, höchstens 1500 m
  const layerTop = Math.max(zWind + 300, Math.min(thermalTop, zT + 1500));
  // Scherung erst ab 150 m über Modellgelände, darunter ist es die normale Bodenreibung des Modells
  const zShear0 = Math.max(zT, s.z + 150);
  let maxWind = 0;
  let sumWind = 0;
  let cnt = 0;
  let maxShear = 0;
  for (let z = zWind; z <= layerTop; z += 50) {
    const w = windAt(hour.wind, z);
    maxWind = Math.max(maxWind, w.speed);
    sumWind += w.speed;
    cnt++;
    if (z >= zShear0 && z + 300 <= layerTop + 1) {
      const w2 = windAt(hour.wind, z + 300);
      const dv = Math.hypot(w2.u - w.u, w2.v - w.v);
      maxShear = Math.max(maxShear, dv / 0.3);
    }
  }

  // Inversion knapp über der Thermikobergrenze
  let inversion: HourMetrics['inversion'] = null;
  const invStart = Math.max(s.z + 2, thermalTop - 100);
  for (let z = invStart; z <= thermalTop + 600; z += 50) {
    const rise = envTemperature(hour.thermo, z + 200) - envTemperature(hour.thermo, z);
    if (rise > 0.3 && (!inversion || rise > inversion.strengthK)) {
      inversion = { baseMsl: r0(z), strengthK: r1(rise) };
    }
  }

  const baseWind = Math.max(s.ws10, wTake.speed);
  const tTake = envTemperature(hour.thermo, Math.max(zT, s.z + 2));
  const tdTake = envDewPoint(hour.thermo, Math.max(zT, s.z + 2));

  return {
    takeoffWindKmh: r1(wTake.speed * KMH),
    takeoffWindDir: r0(wTake.dir),
    takeoffInSector: inSector(wTake.dir, spot.windSector),
    headwindKmh: r1(headwind * KMH),
    crosswindKmh: r1(crosswind * KMH),
    windAboveKmh: r1(wAbove.speed * KMH),
    windAboveDir: r0(wAbove.dir),
    layerMaxWindKmh: r1(maxWind * KMH),
    layerMeanWindKmh: r1((sumWind / Math.max(cnt, 1)) * KMH),
    gustKmh: r1(s.gust10 * KMH),
    // Böen gegen den Grundwind: im Wald ist der 10-m-Wind stark gebremst, deshalb zählt der stärkere von 10-m- und Startwind
    gustSpreadKmh: r1(Math.max(0, s.gust10 - baseWind) * KMH),
    gustFactor: baseWind * KMH >= 10 ? r1(s.gust10 / baseWind) : null,
    shearPerKm: r1(maxShear),
    thermalTopMsl: r0(thermalTop),
    cloudBaseMsl: sunny && hasCu ? r0(parcel.lcl) : null,
    cloudTopMsl: sunny && hasCu && parcel.cloudTop !== null ? r0(parcel.cloudTop) : null,
    workingHeight: r0(thermalTop - zT),
    wStar: r1(wStar),
    climbEstimate: r1(climb),
    tiMin: tiMin === null ? null : r1(tiMin),
    ti850: ti850 === null ? null : r1(ti850),
    inversion,
    cape: r0(s.cape),
    rhTakeoff: r0(rhFromDewPoint(tTake, tdTake)),
    precip: s.precip,
    weatherCode: s.weatherCode,
    cloudCover: s.cloudCover,
    cloudHigh: Math.max(s.cloudHigh, s.cloudMid),
    swRad: r0(s.swRad),
  };
}

// ---------------------------------------------------------------------------
// Dimensionen
// ---------------------------------------------------------------------------

const LABELS: Record<DimensionKey, string[]> = {
  wind_comfort: ['windstill', 'schwacher Wind', 'mäßiger Wind', 'frischer Wind', 'kräftiger Wind', 'zu viel Wind'],
  thermic_character: ['keine Thermik', 'schwach und flach', 'moderat', 'gut nutzbar', 'kräftig, sportlich', 'extrem, Überentwicklung'],
  shear_turbulence: ['glatt', 'ruhig', 'leicht bewegt', 'bewegt', 'ruppig', 'sehr ruppig'],
  structure_cap: ['kein Raum über dem Start', 'flach gedeckelt', 'Hausbart-Höhen', 'gute Arbeitshöhe', 'hochreichend', 'Überentwicklung'],
};

export function makeScore(key: DimensionKey, raw: number, reasons: string[]): DimensionScore {
  const score = r1(Math.min(5, Math.max(0, raw)));
  const level = Math.min(5, Math.max(0, Math.round(score)));
  const diff = score - level;
  const sub: DimensionScore['sub'] = diff <= -0.2 ? '−' : diff >= 0.2 ? '+' : '';
  return { key, score, level, sub, display: `${level}${sub}`, label: LABELS[key][level], reasons };
}

export function scoreDimensions(
  spot: Spot,
  hour: HourInput,
  m: HourMetrics,
  cfg: EngineConfig,
): Record<DimensionKey, DimensionScore> {
  // A: Windkomfort
  const wReasons: string[] = [`Grundwind am Start ${r0(m.takeoffWindKmh)} km/h aus ${compass(m.takeoffWindDir)}`, `Böen bis ${r0(m.gustKmh)} km/h`];
  const sTake = curve(cfg.wind.takeoff, m.takeoffWindKmh);
  const sLayer = curve(cfg.wind.takeoff, m.layerMaxWindKmh) - cfg.wind.layerOffset;
  const sGust = curve(cfg.wind.gustSpread, m.gustSpreadKmh) - cfg.wind.gustOffset;
  if (sLayer > sTake) wReasons.push(`in der Flugschicht bis ${r0(m.layerMaxWindKmh)} km/h`);
  const wind = makeScore('wind_comfort', Math.max(sTake, sLayer, sGust, 0), wReasons);

  // B: Thermik-Charakter
  const tReasons: string[] = [];
  let thermal = curve(cfg.thermal.wStar, m.wStar);
  if (!hour.isDay || m.swRad < 30) {
    thermal = 0;
    tReasons.push('keine Sonneneinstrahlung');
  } else {
    tReasons.push(`w* ${de1(m.wStar)} m/s, Steigen ca. ${de1(m.climbEstimate)} m/s`);
    if (m.tiMin !== null) tReasons.push(`TI bis ${de1(m.tiMin)} K`);
    if (m.workingHeight < 150) {
      thermal = Math.min(thermal, 0.5);
      tReasons.push('Thermik reicht kaum über den Start');
    } else if (m.workingHeight < 400) {
      thermal = Math.min(thermal, 1.5);
      tReasons.push(`Thermik nur ${aboveStart(m.workingHeight)}`);
    }
  }
  const capeScore = curve(cfg.thermal.cape, m.cape);
  const depth = m.cloudTopMsl !== null && m.cloudBaseMsl !== null ? m.cloudTopMsl - m.cloudBaseMsl : 0;
  const depthScore = curve(cfg.structure.cloudDepth, depth);
  const overdev = Math.max(capeScore, depthScore);
  if (hour.isDay && overdev > thermal) {
    thermal = overdev;
    tReasons.push(`Überentwicklungspotenzial (CAPE ${m.cape} J/kg, Wolkendicke ${depth} m)`);
  }
  const thermic = makeScore('thermic_character', thermal, tReasons);

  // C: Scherung und Turbulenz
  const cReasons: string[] = [];
  const parts: { s: number; why: string }[] = [
    { s: curve(cfg.shear.shear, m.shearPerKm), why: `Windscherung ${de1(m.shearPerKm)} m/s pro km` },
    { s: curve(cfg.shear.gustSpread, m.gustSpreadKmh), why: `Böen ${r0(m.gustSpreadKmh)} km/h über Mittelwind` },
  ];
  if (m.gustFactor !== null) {
    parts.push({ s: curve(cfg.shear.gustFactor, m.gustFactor), why: `Böenfaktor ${de1(m.gustFactor)}` });
  }
  if (m.wStar >= 0.8) {
    const ratio = m.layerMeanWindKmh / KMH / m.wStar;
    parts.push({ s: curve(cfg.shear.windToThermal, ratio), why: `Wind zerreißt die Bärte (Wind/w* = ${de1(r1(ratio))})` });
    parts.push({ s: curve(cfg.shear.thermalTurbulence, m.wStar), why: 'kräftige Thermik selbst' });
  }
  parts.sort((a, b) => b.s - a.s);
  let turb = parts[0].s + cfg.shear.comboBonus * parts.slice(1).filter((p) => p.s >= 2).length;
  for (const p of parts) if (p.s >= 1) cReasons.push(p.why);
  // Wind darüber aus deutlich anderer Richtung als am Start: Scherung und Leegefahr
  if (m.windAboveKmh >= 10 && angleDiff(m.windAboveDir, m.takeoffWindDir) >= 60) {
    turb += 0.7;
    cReasons.push(`Wind darüber aus ${compass(m.windAboveDir)}, am Start aus ${compass(m.takeoffWindDir)}`);
  }
  if (m.windAboveKmh >= 10 && !inSector(m.windAboveDir, spot.windSector)) {
    turb += 0.5;
    cReasons.push('Höhenwind kommt nicht aus Startrichtung (Lee möglich)');
  }
  if (cReasons.length === 0) cReasons.push('kaum Scherung, kaum Böen');
  const shear = makeScore('shear_turbulence', turb, cReasons);

  // D: Struktur und Deckel
  const dReasons: string[] = [];
  let struct = curve(cfg.structure.workingHeight, m.workingHeight);
  if (!hour.isDay || m.swRad < 30) {
    struct = 0;
    dReasons.push('ohne Einstrahlung keine Thermik');
  } else {
    dReasons.push(`mögliche Überhöhung ${aboveStart(m.workingHeight)}, Einschätzung: ${climbOutlook(m)}`);
    if (m.cloudBaseMsl !== null) dReasons.push(`Basis ${alt100(m.cloudBaseMsl)}`);
    else dReasons.push(`Blauthermik bis ${alt100(m.thermalTopMsl)}`);
    if (m.inversion) dReasons.push(`Deckel: Inversion ab ${alt100(m.inversion.baseMsl)} (+${de1(m.inversion.strengthK)} K)`);
    if (overdev > struct) {
      struct = overdev;
      dReasons.push('hochreichende Konvektion möglich');
    }
    if (m.cloudHigh >= 70) dReasons.push('mittlere/hohe Wolken dämpfen die Einstrahlung');
  }
  const structure = makeScore('structure_cap', struct, dReasons);

  return { wind_comfort: wind, thermic_character: thermic, shear_turbulence: shear, structure_cap: structure };
}

// ---------------------------------------------------------------------------
// No-Go-Regeln
// ---------------------------------------------------------------------------

export function checkRules(spot: Spot, hour: HourInput, m: HourMetrics, cfg: EngineConfig): { noGo: NoGoReason[]; warnings: string[] } {
  const noGo: NoGoReason[] = [];
  const warnings: string[] = [];
  const s = hour.surface;
  const rules = cfg.rules;

  if (!hour.isDay) noGo.push({ code: 'night', text: 'Nacht' });
  if (s.weatherCode >= 95) noGo.push({ code: 'storm', text: 'Gewitter vorhergesagt' });
  if (s.precip >= rules.maxPrecip || (s.weatherCode >= 51 && s.weatherCode < 95)) {
    noGo.push({ code: 'precip', text: s.precip >= 0.1 ? `Niederschlag (${r1(s.precip)} mm/h)` : 'leichter Niederschlag' });
  }
  if (s.weatherCode === 45 || s.weatherCode === 48) {
    noGo.push({ code: 'fog', text: 'Nebel in der Vorhersage' });
  } else if (s.visibility < rules.minVisibility) {
    noGo.push({ code: 'fog', text: `Sicht nur ${r1(s.visibility / 1000)} km` });
  }
  if (m.rhTakeoff >= rules.fogRh) {
    noGo.push({ code: 'cloud', text: `Start vermutlich in Wolke/Nebel (rel. Feuchte ${m.rhTakeoff} %)` });
  }
  if (m.cloudBaseMsl !== null && m.cloudBaseMsl < spot.elevation + rules.minBaseAboveTakeoff) {
    noGo.push({
      code: 'lowbase',
      text:
        m.cloudBaseMsl <= spot.elevation
          ? `Basis ${alt100(m.cloudBaseMsl)}, also unter dem Start: Start zeitweise in der Wolke`
          : `Basis ${alt100(m.cloudBaseMsl)}, zu knapp über dem Start`,
    });
  }
  if (m.takeoffWindKmh > spot.maxWindKmh) {
    noGo.push({ code: 'wind', text: `Wind am Start ${r0(m.takeoffWindKmh)} km/h (Grenze ${spot.maxWindKmh} km/h)` });
  }
  if (m.gustKmh > spot.maxWindKmh + rules.gustMarginKmh) {
    noGo.push({ code: 'gust', text: `Böen bis ${r0(m.gustKmh)} km/h` });
  }
  // Starts im Wald oder in Schneisen vertragen weniger Seiten- und Rückenwind
  const directionLimit = spot.needsHeadwind ? rules.minWindForDirectionLaneKmh : rules.minWindForDirectionKmh;
  if (m.takeoffWindKmh >= directionLimit && !inSector(m.takeoffWindDir, spot.windSector)) {
    const tail = m.headwindKmh < 0;
    noGo.push({
      code: 'direction',
      text: `${tail ? 'Rückenwind' : 'Seitenwind'} am Start: ${r0(m.takeoffWindKmh)} km/h aus ${compass(m.takeoffWindDir)}`,
    });
  } else if (-m.headwindKmh >= rules.maxTailwindKmh) {
    // auch schwacher Wind ist zu viel, wenn er von hinten kommt
    noGo.push({ code: 'direction', text: `Rückenwind am Start: ${r0(-m.headwindKmh)} km/h aus ${compass(m.takeoffWindDir)}` });
  } else if (m.takeoffWindKmh >= 3 && !inSector(m.takeoffWindDir, spot.windSector)) {
    warnings.push(`schwacher Wind aus ${compass(m.takeoffWindDir)}, Start nur in Thermikablösungen`);
  }
  if (spot.needsHeadwind && hour.isDay && m.headwindKmh < rules.laneMinHeadwindKmh && inSector(m.takeoffWindDir, spot.windSector)) {
    warnings.push(`Start im Wald braucht klaren Gegenwind, vorhergesagt nur ${r0(Math.max(0, m.headwindKmh))} km/h`);
  } else if (spot.needsHeadwind && hour.isDay && m.takeoffWindKmh < 3) {
    warnings.push('Start im Wald braucht klaren Gegenwind, vorhergesagt ist fast Windstille');
  }
  // Höhenwind von hinten: Lee und Rotor am Start, auch wenn es am Start selbst ruhig ist
  const fromBehind = angleDiff(m.windAboveDir, spot.facing);
  if (m.windAboveKmh >= rules.leeMinKmh && fromBehind > 100) {
    noGo.push({
      code: 'lee',
      text: `Lee: Wind darüber ${r0(m.windAboveKmh)} km/h aus ${compass(m.windAboveDir)}, also von hinten`,
    });
  } else if (m.windAboveKmh >= rules.leeMinKmh && fromBehind > 60) {
    warnings.push(`Wind darüber kommt schräg von der Seite (${compass(m.windAboveDir)}, ${r0(m.windAboveKmh)} km/h)`);
  }
  if (spot.operatingHours && hour.isDay) {
    const { sunrise, sunset } = sunTimes(spot.lat, spot.lon, hour.time.slice(0, 10));
    const t = Number(hour.time.slice(11, 13)) + Number(hour.time.slice(14, 16)) / 60;
    const { afterSunriseH, beforeSunsetH } = spot.operatingHours;
    if (afterSunriseH !== undefined && t < sunrise + afterSunriseH) {
      noGo.push({ code: 'hours', text: `Flugbetrieb erst ab ${clockTime(sunrise + afterSunriseH)} Uhr (Auflage: ${afterSunriseH} h nach Sonnenaufgang)` });
    }
    if (beforeSunsetH !== undefined && t > sunset - beforeSunsetH) {
      noGo.push({ code: 'hours', text: `letzter Start ${clockTime(sunset - beforeSunsetH)} Uhr (Auflage: ${beforeSunsetH} h vor Sonnenuntergang)` });
    }
  }
  for (const rule of spot.dangerRules) {
    const speed = rule.level === 'takeoff' ? m.takeoffWindKmh : m.windAboveKmh;
    const dir = rule.level === 'takeoff' ? m.takeoffWindDir : m.windAboveDir;
    if (speed >= rule.minKmh && inSector(dir, rule.sector)) {
      noGo.push({ code: 'danger', text: rule.reason });
    }
  }

  if (hour.isDay) {
    if (m.layerMaxWindKmh >= m.takeoffWindKmh + 12) warnings.push(`oben deutlich windiger (bis ${r0(m.layerMaxWindKmh)} km/h)`);
    if (m.cape >= 300) warnings.push(`Labile Luft (CAPE ${m.cape} J/kg), Überentwicklung beobachten`);
    if (m.inversion && m.inversion.strengthK >= rules.strongInversionK && m.inversion.baseMsl >= spot.elevation - 50) {
      warnings.push(
        `Kräftige Inversion ab ${alt100(m.inversion.baseMsl)} (+${de1(m.inversion.strengthK)} K)${m.inversion.baseMsl < spot.elevation + 300 ? ', knapp über dem Start' : ''}: beim Durchstoßen kann es ruppig werden`,
      );
    } else if (m.inversion && m.inversion.baseMsl >= spot.elevation - 50 && m.inversion.baseMsl < spot.elevation + 300) {
      warnings.push('Inversion knapp über dem Start');
    } else if (m.inversion && m.inversion.baseMsl < spot.elevation - 50) {
      warnings.push('Bodeninversion unter dem Start: kalte, stabile Luft im Tal');
    }
    if (s.precipProb !== null && s.precipProb >= 40) warnings.push(`Schauerrisiko ${s.precipProb} %`);
    if (spot.airspace && m.workingHeight > 0) {
      const top = m.cloudBaseMsl ?? m.thermalTopMsl;
      if (top > spot.airspace.floorMsl) {
        warnings.push(`Thermik reicht bis ${alt100(top)}: ${spot.airspace.note}`);
      }
    }
  }
  return { noGo, warnings };
}

/** Ob Überhöhen realistisch ist: aus Arbeitshöhe und geschätztem Steigen */
export function climbOutlook(m: HourMetrics): 'realistisch' | 'begrenzt' | 'unwahrscheinlich' {
  if (m.workingHeight < 300 || m.climbEstimate < 0.2) return 'unwahrscheinlich';
  if (m.workingHeight < 700 || m.climbEstimate < 0.6) return 'begrenzt';
  return 'realistisch';
}

/**
 * Hinweis auf Soaring: klarer Gegenwind aus dem Windfenster, Böen höchstens 35 km/h, wenig Turbulenz.
 * Mit wenig Thermik ist das gutes Soaring; mit kräftiger Thermik ist die Thermik stark winddurchsetzt und eher ruppig.
 * Ob der Hang am Startplatz Soaring hergibt, weiß die Engine noch nicht, deshalb nur als Hinweis.
 */
export function soaringHint(m: HourMetrics, dims: Record<DimensionKey, DimensionScore>, cfg: EngineConfig): string | null {
  const r = cfg.rules;
  if (!m.takeoffInSector || m.headwindKmh < r.soaringMinHeadwindKmh || m.gustKmh > r.soaringMaxGustKmh) return null;
  if (dims.shear_turbulence.score > 3) return null;
  const wind = `${r0(m.headwindKmh)} km/h Gegenwind, Böen bis ${r0(m.gustKmh)} km/h`;
  if (dims.thermic_character.score <= 1.5) return `Soaringbedingungen möglich: ${wind}, wenig Thermik. Prüfe vor Ort, ob der Hang Soaring hergibt.`;
  if (dims.thermic_character.score >= 2.5) return `Thermisches Soaring: ${wind}, die Thermik ist stark winddurchsetzt und eher ruppig.`;
  return `Soaring mit etwas Thermik: ${wind}.`;
}

// ---------------------------------------------------------------------------
// Zone
// ---------------------------------------------------------------------------

export function classifyZone(
  dims: Record<DimensionKey, DimensionScore>,
  noGo: NoGoReason[],
  cfg: EngineConfig,
): { zone: Zone; label: string } {
  const W = dims.wind_comfort.score;
  const T = dims.thermic_character.score;
  const S = dims.shear_turbulence.score;
  const D = dims.structure_cap.score;
  const z = cfg.zones;
  if (noGo.length > 0) return { zone: 'no-go', label: 'No-Go' };
  if (W >= z.noGoWind) return { zone: 'no-go', label: 'No-Go (zu viel Wind)' };
  if (S >= z.noGoShear) return { zone: 'no-go', label: 'No-Go (zu ruppig)' };
  if (D >= z.noGoStructure || T >= 4.8) return { zone: 'no-go', label: 'No-Go (Überentwicklung)' };
  const sporty = Math.max(W, S, T) >= 3.5;
  if (T >= z.xcThermal && D >= z.xcStructure && W <= z.xcMaxWind && S <= z.xcMaxShear) {
    return { zone: 'xc', label: sporty ? 'Streckenwetter, sportlich' : 'Streckenwetter' };
  }
  if (T >= z.progressThermal || W >= z.progressWind || S >= z.progressShear) {
    if (sporty) return { zone: 'progress', label: 'lebhaft, sportlich' };
    if (T < 1.5 && W >= z.progressWind) return { zone: 'progress', label: 'Soaring im Wind' };
    if (T < 1.5 && S >= z.progressShear) return { zone: 'progress', label: 'unruhige Luft' };
    return { zone: 'progress', label: 'lebhaft, thermisch' };
  }
  if (T < 0.8) return { zone: 'chill', label: 'ruhig, kaum Thermik' };
  return { zone: 'chill', label: 'ruhig, leichte Thermik' };
}
