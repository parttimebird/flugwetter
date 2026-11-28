# Änderungskonzept: Umsetzung, Annahmen, Backlog

Stand 28.11.2026 (dritte Runde eingearbeitet, siehe Abschnitt 2a). Grundlage ist Marvins Datei `aenderungen_final.txt` (Feedback zum Prototyp nach Schritt 3). Hier steht, wie das Konzept geordnet wurde, was davon umgesetzt ist, mit welcher Logik, welche Annahmen gelten und was bewusst zurückgestellt ist.

## 1. Struktur des Konzepts

Das Konzept enthält drei Arten von Punkten:

| Art | Beispiele | Umgang |
|---|---|---|
| Texte und Begriffe | Intro-Text, Flugstil-Typen, Chill/Flow/Push, „Mögliche Überhöhung / Deckel“, Begründungen ohne Zahlen | sofort umgesetzt |
| Bewertungslogik | Startbedingungen, Grundwind/Böen, Soaring, Inversion, Blauthermik, Höhen runden | umgesetzt, soweit die vorhandenen Modelldaten reichen |
| Neue Datenquellen und Funktionen | Wetterstationen, Vorhersagequalität, Luftraum, 100-m-Auflösung, Temperaturdiagramm, Debriefing, Tickets, Standort-Sortierung | Backlog (Abschnitt 4) |

## 2. Umgesetzt

### Character-Onboarding

- Schritt 1: neuer Intro-Text („Hier geht’s um dich als Pilot:in …“), sechs Flugstil-Typen, seit der dritten Runde als Vögel (Abschnitt 2a).
- Schritt 2 heißt jetzt „Schirm, Flugpraxis und Start“: neue Frage „Ich bin mit meinem System vertraut und sicher“ (ja / teilweise / noch nicht), Flugpraxis als „Flüge oder Stunden im Jahr“, neue Frage „Ziehst du sicher rückwärts auf?“.
- Ergebnis: Startbedingungen-Fragen nur für erfahrene Piloten, Zonen erst nach dem Hinweis „Diese Zonen wurden aus deinem Flugcharakter … entwickelt. Sie sind eine Orientierung, keine Festlegung.“ und eingeklappt.
- Gespeicherte Profile laufen weiter: alte Flugstile werden umgeschrieben (Schritt 3 und Essens-Typen → Vögel, `src/character.ts`), alte Modi ebenso (`src/migrate.ts`).

### Modi Chill / Flow / Push

Seit der dritten Runde (Abschnitt 2a): Chill = ruhige Luft in der Komfort-Zone, Flow = ganze Komfort-Zone, Push = bis Progress bzw. mit passendem Character bis Challenge. Strecke (XC) ist eine eigene Option. Intern heißen die Modi jetzt auch `chill`, `flow`, `push`.

### Startbedingungen im Character

Die festen Regeln des Startplatzes bleiben unverändert (Windfenster ab 8 km/h, im Wald ab 5; Rückenwind ab 5 km/h; Maximalwind des Geländes). Dazu kommt eine persönliche Prüfung pro Stunde (`launchCheck` in `src/profile.ts`). Passt der Start nicht, wird die Stunde rot („Start passt nicht zu dir“) und zählt nie als Flugfenster.

Seit Marvins Antwort vom 28.11. nach Winkel zur Startrichtung und Böen:

| Winkel zur Startrichtung | nein (Standard) | leicht | ja |
|---|---|---|---|
| bis 15° | Gegenwind, keine eigene Grenze | ebenso | ebenso |
| 15–30° | Böen bis 15 km/h | Böen bis 20 km/h | Böen bis 20 km/h |
| 30–60° | kein Fenster | Böen bis 10 km/h | Böen bis 15 km/h |
| über 60° | kein Fenster | kein Fenster | Hinweis „kritisch prüfen, kann Lee oder Rückenwind sein“ |
| Rückenwind-Anteil ab 2 km/h | kein Fenster | (nicht wählbar) | nur wer „Rückenwind leicht“ hat: nur im Modus Push, bis 5 km/h und Böen unter 10 km/h |

Unter 3 km/h Grundwind spielt die Richtung keine Rolle. Marvin nannte für bis 30° eine Spanne 0–20 km/h und für 30–60° 0–15 km/h „abhängig von Skills und Startplatz“; die Werte je Toleranz sind daraus abgeleitet. Startplatzabhängige Grenzen gibt es seit der dritten Runde (Abschnitt 2a). Rückwärtsaufziehen: ab 10 km/h Gegenwind ein Hinweis, ohne Rückwärtsaufziehen ab 25 km/h kein Fenster.

Wer welche Frage sieht:

- Seitenwind: Technik ab „solide“ (31 von 50), mindestens 20 Flüge im Jahr, mit dem System vertraut, kein erhöhtes Stressniveau.
- Rückenwind: Technik „hoch“ (41 von 50), über 50 Flüge im Jahr, mit dem System vertraut, stabiles Sicherheitsgefühl.
- Gesperrte Fragen zählen als „nein“. Im Profil gibt es dieselben Fragen mit denselben Sperren.

### Anzeige und Bewertung

- Grundwind und Böen getrennt, mit Marvins Stufen: Grundwind unter 10 schwach, 10–15 mäßig, 15–20 frisch, 20–25 stark, 25–30 sehr stark, ab 30 kritisch. Böen unter 10 sehr schwach, 10–15 schwach, 15–25 mäßig, 25–35 stark, über 35 sehr stark/kritisch.
- „Böigkeit“ nach Marvins Grundwind/Böen-Matrix (Abschnitt 3.2), fließt in Turbulenz und No-Go ein.
- Deutliche Böen (10 km/h und mehr über dem Grundwind) bekommen einen Hinweis mit möglicher Ursache: Windscherung, thermische Turbulenz, Lee, Schauerböen, sonst Düsen/Gelände oder Modell. Bei Grundwind unter 10 km/h zusätzlich „wechselnde Windrichtung am Start“.
- Absolute Werte statt „3−“: Wind „12/21“ (Grundwind/Böen km/h), Thermik als Steigen in m/s, Turbulenz als Wort, Überhöhung „+800 m“. Die farbigen Balken mit Strich an der Modus-Grenze bleiben.
- Begründungen ohne Zahlenstufen: „Frischer Wind: …“, „Thermik schwach und flach: …“, „Turbulenz / Scherung sehr ruppig: …“, „Überhöhung / Deckel: kein Raum über dem Start. …“.
- Modellhöhen auf 100 m gerundet („rund 1.300 m“). Feste Höhen (Startplatz, Landeplatz, Luftraum) bleiben genau.
- „Struktur / Deckel“ heißt „Mögliche Überhöhung / Deckel“: Überhöhung über dem Start, Einschätzung realistisch / begrenzt / unwahrscheinlich, Basis bzw. Blauthermik, Inversion als Deckel, Hinweis auf Abschattung durch mittlere und hohe Wolken.
- „Scherung/Turbulenz“ heißt „Turbulenz / Scherung“. Piloten bewerten Scherung nicht selbst; das Info-Icon erklärt Windscherung mit Marvins Kurztext und nennt „Luftkomfort“ als verständlicheren Namen.
- Info-Icons (ⓘ) für Wind, Thermik, Basis, Turbulenz, Scherung, Überhöhung und Inversion: über der Stundenansicht, bei den Zonen-Reglern und im Info-Reiter.
- Kräftige Inversion (ab 2 K auf 200 m): Hinweis „beim Durchstoßen kann es ruppig werden“.
- Soaring (Marvins Antwort 5): Grundwind ab 15 km/h aus höchstens 30° neben der Startrichtung, Böigkeit höchstens „gut“, Turbulenz höchstens „bewegt“. Zuordnung: Chill bei 15–20 km/h, sehr geringer Böigkeit und wenig Thermik; Flow bei stärkerem Wind (bis etwa 20/30) oder etwas böiger; Push ab etwa 23 km/h, Böen über 30 oder mit Thermik. Eine Soaring-Stunde erfüllt ihren Modus und alle anspruchsvolleren auch ohne Thermik; ob sie für den Piloten passt, entscheiden seine Windgrenzen (so hängt es vom Character ab).
- Blauthermik im Modus Push und mit Strecken-Option: Hinweis „keine Quellwolken als Wegweiser“; seit der dritten Runde je nach Vorliebe auf- oder abgewertet.
- Wolken: Stunden mit möglichen Quellwolken sind im Tagesbalken und an der Zonen-Pille weiß schraffiert (auf grün also weiß-grün), in anderer Richtung als die Schraffur für Überforderung.
- Feineinstellungen: Skala der Gewichtung „egal (0) bis hoch (×2)“ beschriftet.

## 2a. Dritte Runde (28.11.2026, nächste Version)

### Modi und Strecke

| Modus | Bedeutung | zählt als Flugfenster |
|---|---|---|
| Chill | ruhig, einfach, entspannt | Lufttyp „ruhig“ (leichte Thermik) oder ruhiges Soaring, und alles in der Komfort-Zone |
| Flow | „bei den Bedingungen bin ich im Flow, ich kenne sie und sie überfordern mich nicht“ | die ganze Komfort-Zone |
| Push | bewusst fordernd | bis Progress; mit Technik ab 31/50 und Sicherheitsgefühl ab 21/40 bis Challenge |

- **Strecke (XC)** ist ein eigener Schalter unter den Modi, kombinierbar mit jedem Modus, und keine höhere Pilotenstufe mehr. Mit Strecke zählen nur Stunden, die die XC-Anforderungen erfüllen (Thermik ab 2,5, Überhöhung ab 2,5, im Profil einstellbar), Soaring zählt nicht, und ein Fenster braucht mindestens 3 Stunden.
- Intern heißt alles `chill`/`flow`/`push` (Typen, Konfiguration, Tests). Der Lufttyp heißt intern `calm`/`lively`/`xc` (ruhig, lebhaft, Streckenwetter). Zonennamen bleiben Komfort, Progress, Challenge, Überforderung.
- Migration gespeicherter Profile (`src/migrate.ts`): `progress` → Flow, `xc` → Push mit Strecke an. Unveränderte alte Mindestanforderungen werden durch die neuen ersetzt, selbst eingestellte übernommen.
- Mindestanforderungen (Standard): Chill Thermik ab 1 und Wind höchstens 3, Flow Thermik ab 1,5, Push Thermik ab 2, Strecke wie oben.

### Flugstil-Typen als Vögel

Möwe (Genuss, startet in Chill), Spatz (Community, Flow), Schwalbe (Entdecker, Flow), Rabe (Lernen, Push), Storch (Strecke, Flow mit Strecke an), Alpendohle (Hike & Fly, Flow). Der Typ setzt nur Startmodus und Strecken-Schalter, nie Grenzen.

### Startplatzliste

Drei Ansichten: **Meine Umgebung** (GPS-Standort oder ein Startplatz als Ausgangspunkt, Umkreis 25–150 km, nach Entfernung sortiert), **Favoriten** (☆ auf Karte und Startplatzseite) und **Alle** (mit Regionen, Favoriten zuerst). Standort und Favoriten bleiben auf dem Gerät.

### Startbedingungen pro Startplatz

In der Startplatz-Ansicht unter „Deine Startbedingungen hier“: eigene Böen-Grenze (10–35 km/h) und eigener Seitenwind. Mehr Seitenwind als „nein“ nur mit Character, der dafür erfahren genug ist. Im Profil steht eine Liste der Startplätze mit eigenen Werten.

### Optionale Vorlieben

Im Profil und optional am Ende des Character-Onboardings, jeweils 0–5, nicht beantwortet = neutral. Sie verschieben nie Grenzen, nur die Passung:

| Vorliebe | Wirkung |
|---|---|
| Blauthermik mag ich | ab 4: Hinweis „das magst du“; bis 2 und Strecke an: −25 |
| Abgleiter finde ich schön | ab 4: Chill und Flow brauchen keine Thermik |
| lange Thermik nutzen | ab 4: Stunden ohne Thermik −10 |
| Quellwolken lesen | bis 2: Stunden mit Quellwolken und CAPE ab 300 −15 |
| Abschattung stört | ab 4 und Strecke an: hohe Wolken ab 70 % −10 |
| Strecke, sobald es geht | ab 4: Strecken-Schalter beim Übernehmen des Characters an |
| meist am Hausberg | ab 4: Hinweis, ihn als Favorit zu markieren |

### Soaring und Sonne auf dem Hang

Die App rechnet den Sonnenstand (`sunPosition` in `src/physics.ts`). Steht die Sonne mindestens 15° hoch, höchstens 60° neben der Ausrichtung des Startplatzes, und strahlt sie mit mindestens 300 W/m², gilt der Hang als lokal thermisch: Soaring wird eine Stufe lebhafter (Chill → Flow → Push) und es gibt den Hinweis „Sonne auf dem Hang“. Sonst bei Soaring an einem sonnigen Tag „Hang im Schatten, eher laminar“.

### Turbulenz-Emoji

Nach deiner persönlichen Zone für Turbulenz: Komfort 😌 (ruhig), 🙂 (leicht bewegt), 😄 (lebhaft, aber Komfort); Progress 😐; Challenge 🤔; Überforderung ❌.

### Debriefing (erste Fassung)

Im Profil unten: Startplatz, Tag, Startstunde, dann kurze Antworten (Start, Wind/Turbulenz/Thermik gegenüber der Vorhersage, Basis erreicht, Abschattung, wieder so?, Gefühl als Emoji, Notiz). Die App speichert die Vorhersage dieser Stunde mit. Vorschläge (`src/debrief.ts`):

- unwohl (Gefühl 0–1 oder „nicht wieder“) und eine Dimension stärker als vorhergesagt, die für dich höchstens Progress war: diese Dimension eine Viertelstufe vorsichtiger;
- wohl (3–4), wie vorhergesagt oder ruhiger, und die Dimension lag für dich in Progress oder Challenge: eine Viertelstufe mutiger;
- schwieriger Start bei mehr Wind als vorhergesagt: Wind vorsichtiger.

Übernommen wird nur nach Bestätigung. Ab zwei gleichen Antworten an einem Startplatz zeigt die Startplatz-Ansicht das Muster („Wind 2× stärker als vorhergesagt“).

## 3. Annahmen und abgeleitete Logik

1. **Flugstil und Flugfenster.** Marvins Rückfrage: Wie hängen die Typen mit der Empfehlung zusammen? Vorschlag, so umgesetzt: Der Flugstil beschreibt, was du willst, Technik und Sicherheitsgefühl beschreiben, was du kannst. Wollen verschiebt nie Grenzen. Der Stil setzt nur den Tagesmodus zum Start und den Strecken-Schalter (Abschnitt 2a). Später kann er die Sortierung beeinflussen (z. B. Pralinen: neue Gelände zuerst, Kaffee: Gelände mit Community-Aktivität), das braucht Community-Daten.
2. **Grundwind/Böen-Matrix** (Marvins vollständige Tabelle vom 28.11., `src/wind.ts`). Abgeleitete Regel: Böen bis etwa 5 km/h über dem Grundwind sind laminar, bei jedem Grundwind. Jede weiteren 5 km/h Abstand eine Stufe unruhiger (perfekt, sehr gut, gut, Böen beachten, turbulent, deutlich turbulent, No-Go). Bei schwachem Grundwind ist derselbe Abstand weniger kritisch, ab etwa 15 km/h Grundwind kippt es schneller. Ab 25 km/h nur noch Soaring. Umgesetzt als Tabelle (Zeilen Grundwind 5 bis 40, Spalten Böenabstand 0 bis 30, Stufe 0 bis 6), zwischen den Punkten interpoliert. Die Stufe ersetzt in der Turbulenz-Bewertung Böenabstand und Böenfaktor (Stufe 6 = Turbulenz 5); ab Stufe 5,75 ist die Stunde No-Go („viel zu böig“, z. B. 5/35, 10/40, 15/40). Beim Wind zählen Böen jetzt als absoluter Wert, eine Stufe unter dem gleichen Grundwind. „Perfekt“ heißt also: für jeden laminar; ob die Windstärke zu dir passt, entscheiden deine Zonen.
3. **Böen 30–35 km/h** fehlten in der ersten Tabelle, sie zählen zu „stark“.
4. **Rückwärtsaufziehen ab 25 km/h** ist als feste persönliche Grenze umgesetzt (kein Fenster), ab 10 km/h als Hinweis. Die meisten Gelände haben ohnehin eine niedrigere Windgrenze.
5. **Ohne Character** rechnet die App vorsichtig: kein Seiten- und kein Rückenwind. Dadurch hat das Standardprofil am Beispieltag 29 statt vorher 30 Fenster.
6. **Thermik-Mindestwerte** (Chill 1, Flow 1,5, Push 2, Strecke 2,5) sind Startwerte, im Profil abschaltbar. Soaring-Stunden brauchen für die Modi keine Thermik, für Strecke zählen sie nicht.
8. **Chill braucht ruhige Luft**: Eine Stunde in deiner Komfort-Zone, aber mit lebhafter Luft (kräftigere Thermik, unruhig), passt zu Flow, nicht zu Chill.
9. **Sonne auf dem Hang** ist eine Näherung über Ausrichtung des Startplatzes und Sonnenstand; Hangneigung und Abschattung durch Nachbarberge sind nicht drin.
7. **Erfahrungsschwellen** für die Startfragen sind Startwerte und sollten mit echten Flügen geprüft werden.

## 4. Backlog (zurückgestellt)

Mittelfristig:

- Wetterstationen an Startplätzen einbinden und verlinken; Vorhersagequalität als Ampel (Station gegen Modell). Braucht pro Startplatz eine verlässliche Station mit offener Schnittstelle.
- Vertikale Auflösung um 100 m: Open-Meteo liefert Druckflächen (etwa 500–1000 m Abstand in der Flugschicht) plus 80/120/180 m über Grund. Für 100 m braucht es eine andere Quelle oder Modell-Rohdaten (z. B. ICON-D2 Modellflächen beim DWD).
- Temperaturdiagramm pro Startplatz (Temperatur, Taupunkt, Basis, Inversion, Wind über Höhe), gleiches für den Landeplatz. Mit den vorhandenen Druckflächen schon grob machbar, sinnvoller mit feinerer Auflösung.
- Nebel und Sicht als eigener Faktor, getrennt für Start und Landeplatz, mit „Startfenster erst nach Auflösung prüfen“. Heute ist Nebel ein No-Go am Startplatz-Gitterpunkt.
- Flugtagebuch ausbauen: Auswertung über viele Flüge, Debriefing-Erinnerung nach dem Flug, Anpassung von Startbedingungen und Vorlieben (die erste Fassung justiert nur die Zonen).
- Feedback- und Ticket-Formular mit Spam-Schutz (braucht einen kleinen Server oder Dienst).
- **Push-Benachrichtigungen** bei Wunschbedingungen über mindestens 3 Stunden: zurückgestellt und gemerkt (Ansage vom 28.11.). Braucht einen Server, der regelmäßig rechnet, und Web-Push-Anmeldung.
- Soaring pro Startplatz: Welche Hänge Soaring hergeben, weiß die Engine noch nicht; dafür bräuchte jeder Startplatz eine Angabe.
- Sonne auf dem Hang auch für die Thermik (nicht nur Soaring), mit Hangneigung und Horizont.

Später oder optional:

- Luftraum als Hintergrundprüfung mit Alarm bei Sperrungen (NOTAM/DAeC-Daten, rechtlich saubere Quelle nötig).
- Animation für Scherung und Turbulenz.
- Erweiterte XC-Analyse, automatische Anpassung des Characters aus mehreren Flügen.

## 5. Namen für die Flugstil-Typen (entschieden: Vögel)

Marvin möchte einprägsame, etwas spaßige Analogien im Flug-Kontext. Vorschläge, jeweils in der Reihenfolge Genuss / Community / Entdecker / Lernen / Strecke / Hike & Fly:

| Idee | Genuss | Community | Entdecker | Lernen | Strecke | Hike & Fly |
|---|---|---|---|---|---|---|
| Vögel | Möwe (lässt sich tragen) | Spatz (nie allein) | Schwalbe (immer woanders) | Rabe (neugierig und clever) | Storch (zieht weit) | Alpendohle (zu Fuß am Gipfel zu Hause) |
| Wolken und Luft | Schäfchenwolke | Wolkenstraße | Wanderwolke | Thermikblase (will höher) | Cumulus-Jäger | Gipfelnebel? |
| Reise | Sonntagsausflügler | Stammtisch | Weltenbummler | Azubi der Lüfte | Langstreckenpilot | Bergfex |
| Picknick (wie jetzt) | Butterbrot | Kaffeekränzchen | Pralinenschachtel | Erdnussbutter | Dreiecksbrötchen | Wanderproviant |

Mein Favorit sind die Vögel: Sie sind fliegerisch, man merkt sie sich, und jedes Tier steht schon für das Verhalten.

## 6. Offene Fragen an Marvin

Beantwortet am 28.11.: Verknüpfung Typ → Modus passt; Typ-Namen vorläufig, Alternativen in Abschnitt 5; Matrix, Rückenwind (Böen 10), Seitenwind nach Winkel und Soaring-Zuordnung sind eingearbeitet.

Beantwortet in der dritten Runde: Vögel als Namen, Flow = Komfort-Zone, Strecke als eigene Option.

Noch offen:

1. Seitenwind-Grenzen je Toleranz (Tabelle in Abschnitt 2): passen die Werte innerhalb deiner Spannen?
2. Chill nur bei ruhiger Luft (Abschnitt 2a): passt das, oder soll Chill auch lebhafte Stunden in der Komfort-Zone zeigen?
3. Push ohne Character bis Progress, mit passendem Character bis Challenge: passt die Schwelle (Technik 31, Sicherheit 21)?
4. Debriefing: reichen Viertelstufen pro Eintrag, oder sollen Vorschläge erst nach mehreren gleichen Flügen kommen?
5. Version ohne Login mit optionalem Konto (für Geräte-Wechsel und spätere Push-Benachrichtigungen)?
