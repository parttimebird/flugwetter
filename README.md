# Flugwetter-Prototyp: Wetter-Engine und Handy-App (Schritt 1 und 2)

Die Engine bewertet für jeden Startplatz Stunde für Stunde, wie die Luft sein wird und ob das zu dir passt. Die Handy-App (Schritt 2) zeigt diese Bewertung als Flugfenster an und lässt dich dein Pilotenprofil einstellen. Beides ist die Grundlage für das Community-Feedback (Schritt 3).

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
5. **Zone:** Chill, Progress, XC oder No-Go, mit Zusatz wie „Soaring im Wind“ oder „sportlich“.
6. **Persönliche Passung (0 bis 100)** aus dem Pilotenprofil (`config/pilot-standard.json`, entspricht deiner user_konfig): Toleranzen und Gewichte pro Dimension, Mindestanforderungen pro Flugziel.
7. **Flugfenster pro Tag:** zusammenhängende Stunden ab Passung 60, plus die häufigsten Gründe gegen das Fliegen.

## Die Handy-App (Schritt 2)

Eine einzelne Webseite ohne Server-Teil: die Engine läuft im Browser des Handys. Drei Reiter:

- **Flugfenster:** Tag wählen (die Tageskarten zeigen, an wie vielen Startplätzen ein Fenster liegt) und nach Region filtern (Nord: Oppenau, Merkur, Teufelsmühle; Mitte: Gschasi, Kandel; Süd: Schauinsland, Hochblauen). Die Startplätze stehen in drei Gruppen: „Passt zu dir“, „Fliegbar, aber nicht dein Ziel“ und „Nicht fliegbar“ mit dem Hauptgrund. Jede Karte zeigt die Fenster und eine Stundenleiste in Zonenfarben.
- **Startplatz:** Eckdaten (Starthöhe, Windfenster, Windgrenze, Landeplatz), die Fenster je Tag und jede Stunde mit Zone, Passung, den vier Dimensionen samt deiner Toleranz, Kennwerten und Begründung. Dazu Links zur DHV-Geländedatenbank und zum Verein.
- **Profil:** Flugziel (Chill, Progress, XC), Toleranz und Gewicht pro Dimension, Mindestanforderungen je Ziel. Jede Änderung bewertet alle Startplätze sofort neu und zeigt, wie viele Fenster herauskommen. Das Profil bleibt nur auf dem Gerät gespeichert; Startwert ist `config/pilot-standard.json`.

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
| `src/profile.ts` | persönliche Passung |
| `src/windows.ts` | Tageszusammenfassung und Flugfenster |
| `src/engine.ts` | Einstiegspunkt `evaluateForecast(spot, forecast, pilot)` |
| `src/engine.ts` | auch `rescoreForPilot`: bewertet die Passung nach einer Profiländerung neu, ohne die Wetterauswertung zu wiederholen |
| `app/main.ts`, `app/style.css` | Handy-App: Ansichten, Profil-Einstellungen, Laden der Vorhersage |
| `app/icons/` | App-Icon (SVG als Vorlage, PNGs für Startbildschirm und Manifest) |
| `scripts/build-app.ts` | baut die App mit esbuild nach `dist/` |
| `scripts/deploy-pages.sh` | baut die App und legt die Web-Fassung auf den Branch `gh-pages` (GitHub Pages) |
| `dist/` | fertige App (`index.html` für einen Webhost, `artifact.html` für Claude, `data/forecast.json`) |
| `scripts/report.ts` | schreibt `out/auswertung.md` und `out/auswertung.json` |
| `test/` | 31 Tests: Physik, Sonnenzeiten, nachgebaute Wetterlagen, Geländeregeln, Neubewertung nach Profiländerung, echte Vorhersage vom 24.11.2026 |
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
bash scripts/deploy-pages.sh    # Web-Fassung auf GitHub Pages veröffentlichen
```

Zum Ausprobieren auf dem Rechner `dist/` über einen kleinen Webserver ausliefern, z. B. `npx serve dist` oder `python3 -m http.server -d dist`, und `http://localhost:…/index.html` öffnen. Direkt als Datei geöffnet lädt der Browser den mitgelieferten Datenstand nicht.

## Wichtig zur Datenquelle

- Open-Meteo ist **kostenlos nur für nicht-kommerzielle Nutzung** (Grenze ca. 10.000 Abrufe pro Tag und IP-Adresse). Für eine kommerzielle App braucht es einen bezahlten Zugang.
- Die App sollte die Vorhersage deshalb **direkt auf dem Handy des Nutzers** abrufen. Dann zählt jeder Nutzer gegen sein eigenes Limit. Ein gemeinsamer Server würde das Limit schnell erreichen (genau das ist in meiner Cloud-Umgebung passiert, deshalb habe ich die Daten über deinen Rechner geholt).
- Open-Meteo antwortet bei großen Abfragen manchmal mit einer Zeitüberschreitung statt mit Daten. `fetchForecast` holt die Vorhersage deshalb in drei Teilen (Boden, untere und obere Druckflächen) und versucht jeden Teil bis zu dreimal.

## Grenzen dieses Stands

- Windfenster und Windgrenzen der Startplätze stehen nicht in der DHV-Datenbank. Ich habe sie aus der Startrichtung abgeleitet; am 24.11.2026 wurden sie vorerst so bestätigt. Pro Startplatz stehen sie weiter unter „Bitte prüfen“, bis jemand vom Verein draufgeschaut hat.
- Bei Windstille gelten alle Startrichtungen eines Bergs als möglich. Welcher Hang Sonne bekommt (Osthang vormittags, Westhang nachmittags, Nordhang im Winter gar nicht), rechnet die Engine noch nicht ein.

- Die Schwellenwerte sind fachlich begründete Startwerte, aber noch nicht an echten Flügen geeicht. Genau dafür ist Schritt 3 (Flugfeedback und Community-Cluster) da.
- Das Modellgelände ist geglättet (z. B. Merkur: Modell 380 m, Start 650 m). Wind in Starthöhe kommt deshalb aus der freien Atmosphäre, lokale Effekte wie Düsen oder Talwind fehlen. Stationsdaten (Holfuy, Schwarzwaldgeier, Breezedude) sind der nächste sinnvolle Abgleich.
- Die Thermikstärke ist eine Schätzung aus der Einstrahlung. Feuchter Boden im Frühjahr oder trockener Boden im Hochsommer verschieben sie.
- Der Thermik-Index wird aus dem Profil derselben Stunde berechnet und ist deshalb kleiner als der klassische TI aus Morgen-Sounding und Höchsttemperatur (z. B. bei Meteoblue).
