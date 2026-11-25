# Flugwetter-Prototyp: Wetter-Engine, Handy-App und Character (Schritte 1 bis 3)

Die Engine bewertet für jeden Startplatz Stunde für Stunde, wie die Luft sein wird und ob das zu dir passt. Die Handy-App (Schritt 2) zeigt diese Bewertung als Flugfenster an. Schritt 3 ergänzt den Character: ein kurzer Fragebogen, aus dem persönliche Zonen (Komfort, Progress, Challenge, Überforderung) entstehen, und den Tagesmodus Chill, Progress oder XC. Als Nächstes sind Tagescheck (Mental- und Reality-Check), Flugtagebuch mit Lernschleife und Community geplant.

Enthalten sind 13 Startplätze an 8 frequentierten Geländen im Schwarzwald, jede Startrichtung einzeln: Oppenau Rossbühl (West) und Schäfersfeld (Ost), Merkur (West, Nordost), Teufelsmühle (West, Nordwest), Gschasi, Kandel (West mit Rampe, Süd), Schauinsland und Hochblauen (Südwest, Ost, Nord). Die Startplätze eines Geländes teilen sich eine Vorhersage.

## Was sie macht

1. **Vorhersage holen:** Open-Meteo, Modell ICON des DWD (ICON-D2 mit ca. 2 km für die ersten zwei Tage, danach ICON-EU). Bodenwerte plus zehn Druckflächen von 1000 bis 500 hPa und Wind/Temperatur in 80, 120 und 180 m über Grund.
2. **Kennwerte berechnen** (`src/evaluate.ts`, `src/physics.ts`):
   - Wind in Starthöhe, Gegen- und Seitenwind zur Startrichtung, Wind 200–800 m über dem Start, stärkster Wind in der Flugschicht
   - Thermikobergrenze bzw. Basis (Luftpaket vom Modellboden, trocken- und feuchtadiabatisch), Wolkenobergrenze bei Cumulus
   - Thermikstärke w* aus Einstrahlung und Höhe der Thermikschicht, daraus ein geschätztes Steigen
   - Thermik-Index in der Flugschicht und auf 850 hPa, Inversionen über der Thermik
   - Windscherung (m/s pro km), Böen gegen den Grundwind, Böenfaktor, CAPE
3. **Vier Dimensionen von 0 bis 5 mit Unterstufen** (z. B. „2+“): Windkomfort, Thermik-Charakter, Scherung/Turbulenz, Struktur/Deckel. Jede Bewertung kommt mit Begründung.
4. **No-Go-Regeln:** Nacht, Niederschlag, Gewitter, Nebel, Start in der Wolke, Basis knapp über dem Start, zu viel Wind oder Böen, Wind aus falscher Richtung (ab 8 km/h, bei Starts im Wald ab 5 km/h, direkter Rückenwind schon ab 5 km/h), Höhenwind von hinten (Lee), Flugzeiten aus Geländeauflagen (z. B. Oppenau: frühestens 2 h nach Sonnenaufgang) und Gefahrenregeln pro Gelände. Hinweise gibt es außerdem bei Waldstarts ohne klaren Gegenwind und wenn die Thermik in kontrollierten Luftraum reicht (Hochblauen: Luftraum D Basel ab 1676 m).
5. **Lufttyp:** ruhig, lebhaft, Streckenwetter oder No-Go, mit Zusatz wie „Soaring im Wind“ oder „sportlich“. Er beschreibt die Luft unabhängig vom Piloten (im Code `zone`: `chill`, `progress`, `xc`, `no-go`).
6. **Persönliche Zone** (`src/profile.ts`): Jede Dimension liegt gemessen an deinen drei Grenzen in grün (Komfort), gelb (Progress), orange (Challenge) oder rot (Überforderung). Die anspruchsvollste Dimension bestimmt die Zone der Stunde, die No-Go-Regeln gelten unabhängig davon.
7. **Passung (0 bis 100) im Tagesmodus:** Chill zählt bis grün, Progress bis gelb, XC bis orange, rot zählt nie. 100, wenn alles in der Zone des Modus liegt, minus 25, wenn die Mindestanforderungen des Modus nicht erfüllt sind (z. B. zu wenig Thermik für XC). Liegt die Stunde über dem Modus, bleibt die Passung unter 50, bei rot unter 20.
8. **Flugfenster pro Tag:** zusammenhängende Stunden ab Passung 60, mit der anspruchsvollsten Zone darin, plus die häufigsten Gründe gegen das Fliegen.

## Character und persönliche Zonen (Schritt 3)

Der Fragebogen folgt dem Flow-Entwurf `paragliding_weather_pilot_check_v2` (`src/character.ts`):

1. Flugstil (Genussflieger, Community, Landschaft, entwicklungsorientiert, Hike & Fly). Entwicklungsorientiert startet im Modus Progress, alle anderen in Chill.
2. Schirmklasse (EN-A bis D) und Flüge pro Jahr (unter 20, 20 bis 50, über 50)
3. Technik: 10 Fähigkeiten, je 0 bis 5. Summe 0 bis 50, Stufen bis 15 Grundlagenaufbau, bis 30 sichere Basis, bis 40 solide, darüber hohe Souveränität
4. Sicherheitsgefühl: 8 Aussagen, je 0 bis 5. Summe 0 bis 40, Stufen bis 20 erhöhtes Stressniveau, bis 30 wechselnd, darüber stabil
5. Ergebnis mit Zonen und Begründung

Die Technik-Stufe wählt eine Zeile der Starttabelle (Komfort / Progress / Challenge auf der Skala der Dimensionen):

| Technik | Wind | Thermik | Scherung | Deckel |
|---|---|---|---|---|
| Grundlagenaufbau | 1,5 / 2 / 2,5 | 1,5 / 2 / 2,5 | 1 / 1,5 / 2 | 3,5 / 4 / 4,5 |
| sichere Basis | 2 / 2,5 / 3 | 2 / 3 / 3,5 | 1,5 / 2 / 2,5 | 4 / 4,5 / 4,5 |
| solide | 2,5 / 3 / 3,5 | 2,5 / 3,5 / 4 | 2 / 2,5 / 3 | 4 / 4,5 / 5 |
| hohe Souveränität | 3 / 3,5 / 4 | 3 / 4 / 4,5 | 2 / 3 / 3,5 | 4,5 / 5 / 5 |

Zu- und Abschläge: erhöhtes Stressniveau −0,5 auf Wind, Thermik und Scherung; wechselndes Sicherheitsgefühl −0,25 auf Wind und Scherung; EN-A −0,5 Wind; EN-C +0,25 und EN-D +0,5 Wind, aber nur ab solider Technik und nie bei der Scherung; unter 20 Flüge im Jahr −0,25 auf Wind, Thermik und Scherung. Zusammen gehen die Grenzen nie unter die Zeile „Grundlagenaufbau“. XC empfiehlt der Coach erst ab solider Technik (31 von 50) und ohne erhöhtes Stressniveau (21 von 40), sonst rechnet er XC als Progress.

Die Tabelle ist ein Startvorschlag und noch nicht an echten Flügen geeicht. Im Profil lassen sich alle Grenzen von Hand verstellen. Character, Zonen und Modus bleiben auf dem Gerät (`localStorage`, Schlüssel `flugwetter.profil.v2`; ein Profil aus Schritt 2 unter `…v1` wird übernommen und nicht verändert).

## Die Handy-App (Schritt 2)

Eine einzelne Webseite ohne Server-Teil: die Engine läuft im Browser des Handys. Drei Reiter:

- **Flugfenster:** Tagesmodus wählen (Chill, Progress, XC), Tag wählen (die Tageskarten zeigen, an wie vielen Startplätzen ein Fenster liegt) und nach Region filtern (Nord: Oppenau, Merkur, Teufelsmühle; Mitte: Gschasi, Kandel; Süd: Schauinsland, Hochblauen). Die Startplätze stehen in drei Gruppen: „Passt zu dir“, „Fliegbar, aber nicht in deinem Modus“ und „Nicht fliegbar“ mit dem Hauptgrund. Jede Karte zeigt die Fenster und eine Stundenleiste in den Farben deiner Zonen.
- **Startplatz:** Eckdaten (Starthöhe, Windfenster, Windgrenze, Landeplatz), die Fenster je Tag und jede Stunde mit persönlicher Zone, Lufttyp, Passung, den vier Dimensionen (Balken in Zonenfarbe, Strich an der Grenze deines Modus), Kennwerten und Begründung. Dazu Links zur DHV-Geländedatenbank und zum Verein.
- **Profil:** Character (anlegen oder neu einlesen), Tagesmodus, drei Grenzen pro Dimension als Regler, in den Feineinstellungen Gewichte und Mindestanforderungen je Modus. Jede Änderung bewertet alle Startplätze sofort neu und zeigt, wie viele Fenster herauskommen. Ohne Character ist der Startwert `config/pilot-standard.json`.

Woher die App die Vorhersage nimmt, in dieser Reihenfolge:

1. Zwischenspeicher auf dem Gerät, wenn er jünger als 60 Minuten ist
2. live von Open-Meteo, direkt vom Handy (25 Abrufe: ein kurzer Test, dann 8 Gelände in je drei Teilen)
3. älterer Zwischenspeicher
4. mitgelieferter Datenstand `data/forecast.json` (die neueste Datei aus `fixtures/`)

Die Statuszeile oben sagt, welcher Stand gerade gezeigt wird und warum der Live-Abruf nicht geklappt hat (Abruflimit, keine Verbindung oder gesperrt).

`npm run build` erzeugt zwei Fassungen:

- `dist/index.html` mit `dist/data/forecast.json`, Manifest und Icons: für einen normalen Webhost (z. B. GitHub Pages). Dort holt die App live, und man kann sie als Icon auf den Startbildschirm legen.
- `dist/artifact.html`: dieselbe App als Claude-Artifact. Claude-Artifacts dürfen keine fremden Server abrufen, deshalb zeigt diese Fassung nur den mitgelieferten Datenstand.

## Ordner

| Pfad | Inhalt |
|---|---|
| `src/spots.ts` | 8 Gelände mit Verein und DHV-Nummer, 13 Startplätze mit Quellen, Auflagen und offenen Annahmen |
| `src/config.ts` | alle Schwellenwerte an einer Stelle (Startwerte zum Nachjustieren) |
| `src/openmeteo.ts` | Datenquelle Open-Meteo, austauschbar gegen weitere Quellen |
| `src/physics.ts` | Feuchte, Luftpaket, Profil-Interpolation, Windvektoren |
| `src/evaluate.ts` | Kennwerte, Dimensionen, No-Go-Regeln, Zonen |
| `src/character.ts` | Character: Fragen, Stufen, Starttabelle, Zu- und Abschläge (`buildEnvelope`, `scoreCharacter`) |
| `src/profile.ts` | persönliche Zone und Passung im Tagesmodus |
| `src/windows.ts` | Tageszusammenfassung und Flugfenster |
| `src/engine.ts` | Einstiegspunkt `evaluateForecast(spot, forecast, pilot)` |
| `src/engine.ts` | auch `rescoreForPilot`: bewertet die Passung nach einer Profiländerung neu, ohne die Wetterauswertung zu wiederholen |
| `app/main.ts`, `app/style.css` | Handy-App: Ansichten, Profil-Einstellungen, Laden der Vorhersage |
| `app/icons/` | App-Icon (SVG als Vorlage, PNGs für Startbildschirm und Manifest) |
| `scripts/build-app.ts` | baut die App mit esbuild nach `dist/` |
| `scripts/deploy-pages.sh` | baut die App und legt die Web-Fassung auf den Branch `gh-pages` (GitHub Pages), mit `vorschau` nur in den Unterordner `vorschau/` |
| `dist/` | fertige App (`index.html` für einen Webhost, `artifact.html` für Claude, `data/forecast.json`) |
| `scripts/report.ts` | schreibt `out/auswertung.md` und `out/auswertung.json` |
| `test/` | 42 Tests: Physik, Sonnenzeiten, nachgebaute Wetterlagen, Geländeregeln, Neubewertung nach Profiländerung, Character und Zonen, echte Vorhersage vom 24.11.2026 |
| `fixtures/` | gespeicherte Open-Meteo-Antworten, eine pro Gelände (`--live` legt eine neue Datei an) |

## Benutzen

Voraussetzung: Node.js ab 22.18 (führt TypeScript direkt aus).

```bash
npm install          # für Typprüfung und App-Build
npm test             # alle Tests
npm run typecheck    # Typprüfung für Engine, App und Skripte
npm run report       # Auswertung aus der neuesten gespeicherten Vorhersage
node scripts/report.ts --live   # frische Vorhersage holen, in fixtures/ speichern und auswerten
npm run build        # Handy-App nach dist/ bauen
bash scripts/deploy-pages.sh            # Web-Fassung auf GitHub Pages veröffentlichen (Live-Fassung)
bash scripts/deploy-pages.sh vorschau   # nur nach …/vorschau/, eigener App-Name, die Live-Fassung bleibt
```

Zum Ausprobieren auf dem Rechner `dist/` über einen kleinen Webserver ausliefern, z. B. `npx serve dist` oder `python3 -m http.server -d dist`, und `http://localhost:…/index.html` öffnen. Direkt als Datei geöffnet lädt der Browser den mitgelieferten Datenstand nicht.

## Wichtig zur Datenquelle

- Open-Meteo ist **kostenlos nur für nicht-kommerzielle Nutzung** (Grenze ca. 10.000 Abrufe pro Tag und IP-Adresse). Für eine kommerzielle App braucht es einen bezahlten Zugang.
- Die App sollte die Vorhersage deshalb **direkt auf dem Handy des Nutzers** abrufen. Dann zählt jeder Nutzer gegen sein eigenes Limit. Ein gemeinsamer Server würde das Limit schnell erreichen (genau das ist in meiner Cloud-Umgebung passiert, deshalb habe ich die Daten über deinen Rechner geholt).
- Open-Meteo antwortet bei großen Abfragen manchmal mit einer Zeitüberschreitung statt mit Daten. `fetchForecast` holt die Vorhersage deshalb in drei Teilen (Boden, untere und obere Druckflächen) und versucht jeden Teil bis zu dreimal.

## Grenzen dieses Stands

- Windfenster und Windgrenzen der Startplätze stehen nicht in der DHV-Datenbank. Ich habe sie aus der Startrichtung abgeleitet; am 24.11.2026 wurden sie vorerst so bestätigt. Pro Startplatz stehen sie weiter unter „Bitte prüfen“, bis jemand vom Verein draufgeschaut hat.
- Bei Windstille gelten alle Startrichtungen eines Bergs als möglich. Welcher Hang Sonne bekommt (Osthang vormittags, Westhang nachmittags, Nordhang im Winter gar nicht), rechnet die Engine noch nicht ein.

- Die Schwellenwerte und die Starttabelle der Zonen sind fachlich begründete Startwerte, aber noch nicht an echten Flügen geeicht. Dafür ist das Flugtagebuch mit Lernschleife gedacht.
- Innerhalb der Zone des Modus kennt die Passung nur 100 oder 75. Feinere Abstufungen sollen aus dem Flugtagebuch kommen.
- Das Modellgelände ist geglättet (z. B. Merkur: Modell 380 m, Start 650 m). Wind in Starthöhe kommt deshalb aus der freien Atmosphäre, lokale Effekte wie Düsen oder Talwind fehlen. Stationsdaten (Holfuy, Schwarzwaldgeier, Breezedude) sind der nächste sinnvolle Abgleich.
- Die Thermikstärke ist eine Schätzung aus der Einstrahlung. Feuchter Boden im Frühjahr oder trockener Boden im Hochsommer verschieben sie.
- Der Thermik-Index wird aus dem Profil derselben Stunde berechnet und ist deshalb kleiner als der klassische TI aus Morgen-Sounding und Höchsttemperatur (z. B. bei Meteoblue).
