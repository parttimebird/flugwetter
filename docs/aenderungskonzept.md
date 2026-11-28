# Änderungskonzept: Umsetzung, Annahmen, Backlog

Stand 28.11.2026. Grundlage ist Marvins Datei `aenderungen_final.txt` (Feedback zum Prototyp nach Schritt 3). Hier steht, wie das Konzept geordnet wurde, was davon umgesetzt ist, mit welcher Logik, welche Annahmen gelten und was bewusst zurückgestellt ist.

## 1. Struktur des Konzepts

Das Konzept enthält drei Arten von Punkten:

| Art | Beispiele | Umgang |
|---|---|---|
| Texte und Begriffe | Intro-Text, Flugstil-Typen, Chill/Flow/Push, „Mögliche Überhöhung / Deckel“, Begründungen ohne Zahlen | sofort umgesetzt |
| Bewertungslogik | Startbedingungen, Grundwind/Böen, Soaring, Inversion, Blauthermik, Höhen runden | umgesetzt, soweit die vorhandenen Modelldaten reichen |
| Neue Datenquellen und Funktionen | Wetterstationen, Vorhersagequalität, Luftraum, 100-m-Auflösung, Temperaturdiagramm, Debriefing, Tickets, Standort-Sortierung | Backlog (Abschnitt 4) |

## 2. Umgesetzt

### Character-Onboarding

- Schritt 1: neuer Intro-Text („Hier geht’s um dich als Pilot:in …“), sechs Flugstil-Typen mit Marvins Namen und Texten.
- Schritt 2 heißt jetzt „Schirm, Flugpraxis und Start“: neue Frage „Ich bin mit meinem System vertraut und sicher“ (ja / teilweise / noch nicht), Flugpraxis als „Flüge oder Stunden im Jahr“, neue Frage „Ziehst du sicher rückwärts auf?“.
- Ergebnis: Startbedingungen-Fragen nur für erfahrene Piloten, Zonen erst nach dem Hinweis „Diese Zonen wurden aus deinem Flugcharakter … entwickelt. Sie sind eine Orientierung, keine Festlegung.“ und eingeklappt.
- Gespeicherte Profile aus Schritt 3 laufen weiter: alte Flugstile werden umgeschrieben (Genussflieger → Butter, Landschaft → Pralinenschachtel, entwicklungsorientiert → Erdnussbutter).

### Modi Chill / Flow / Push

| Modus | Bedeutung | zählt bis Zone |
|---|---|---|
| Chill | Ruhige, einfache und gut kontrollierbare Bedingungen | Komfort (grün) |
| Flow | Gute, aktive Bedingungen mit ausreichend Spielraum | Progress (gelb) |
| Push | Anspruchsvolle, grenzwertige oder fordernde Bedingungen | Challenge (orange) |

Intern heißen die Modi weiter `chill`, `progress`, `xc`, damit gespeicherte Profile gelten. Die Zonennamen (Komfort, Progress, Challenge, Überforderung) bleiben wie in Marvins Intro-Text.

### Startbedingungen im Character

Die festen Regeln des Startplatzes bleiben unverändert (Windfenster ab 8 km/h, im Wald ab 5; Rückenwind ab 5 km/h; Maximalwind des Geländes). Dazu kommt eine persönliche Prüfung pro Stunde (`launchCheck` in `src/profile.ts`). Passt der Start nicht, wird die Stunde rot („Start passt nicht zu dir“) und zählt nie als Flugfenster.

| Bedingung | nein (Standard) | leicht | ja |
|---|---|---|---|
| Wind von außerhalb des Windfensters (3 bis 8 km/h) | kein Fenster | ok bis 5 km/h | ok bis zur Geländegrenze |
| Seitenwind-Anteil innerhalb des Windfensters | kein Fenster ab 8 km/h | ab 12 km/h | keine eigene Grenze |
| Rückenwind-Anteil ab 2 km/h | kein Fenster | nur im Modus Push, bis 5 km/h | (nicht wählbar) |

Unter 3 km/h spielt die Richtung keine Rolle. Rückwärtsaufziehen: ab 10 km/h Gegenwind ein Hinweis, ohne Rückwärtsaufziehen ab 25 km/h kein Fenster.

Wer welche Frage sieht:

- Seitenwind: Technik ab „solide“ (31 von 50), mindestens 20 Flüge im Jahr, mit dem System vertraut, kein erhöhtes Stressniveau.
- Rückenwind: Technik „hoch“ (41 von 50), über 50 Flüge im Jahr, mit dem System vertraut, stabiles Sicherheitsgefühl.
- Gesperrte Fragen zählen als „nein“. Im Profil gibt es dieselben Fragen mit denselben Sperren.

### Anzeige und Bewertung

- Grundwind und Böen getrennt, mit Marvins Stufen: Grundwind unter 10 schwach, 10–15 mäßig, 15–20 frisch, 20–25 stark, 25–30 sehr stark, ab 30 kritisch. Böen unter 10 sehr schwach, 10–15 schwach, 15–25 mäßig, 25–35 stark, über 35 sehr stark/kritisch.
- „Böigkeit“ aus Grundwind und Böen als Vorschlag für die offene Matrix (Abschnitt 3).
- Absolute Werte statt „3−“: Wind „12/21“ (Grundwind/Böen km/h), Thermik als Steigen in m/s, Turbulenz als Wort, Überhöhung „+800 m“. Die farbigen Balken mit Strich an der Modus-Grenze bleiben.
- Begründungen ohne Zahlenstufen: „Frischer Wind: …“, „Thermik schwach und flach: …“, „Turbulenz / Scherung sehr ruppig: …“, „Überhöhung / Deckel: kein Raum über dem Start. …“.
- Modellhöhen auf 100 m gerundet („rund 1.300 m“). Feste Höhen (Startplatz, Landeplatz, Luftraum) bleiben genau.
- „Struktur / Deckel“ heißt „Mögliche Überhöhung / Deckel“: Überhöhung über dem Start, Einschätzung realistisch / begrenzt / unwahrscheinlich, Basis bzw. Blauthermik, Inversion als Deckel, Hinweis auf Abschattung durch mittlere und hohe Wolken.
- „Scherung/Turbulenz“ heißt „Turbulenz / Scherung“. Piloten bewerten Scherung nicht selbst; das Info-Icon erklärt Windscherung mit Marvins Kurztext und nennt „Luftkomfort“ als verständlicheren Namen.
- Info-Icons (ⓘ) für Wind, Thermik, Basis, Turbulenz, Scherung, Überhöhung und Inversion: über der Stundenansicht, bei den Zonen-Reglern und im Info-Reiter.
- Kräftige Inversion (ab 2 K auf 200 m): Hinweis „beim Durchstoßen kann es ruppig werden“.
- Soaring-Hinweis: Gegenwind aus dem Windfenster ab 15 km/h, Böen höchstens 35 km/h, Turbulenz höchstens „bewegt“. Mit wenig Thermik „Soaringbedingungen möglich“, mit kräftiger Thermik „Thermisches Soaring: … stark winddurchsetzt und eher ruppig“.
- Blauthermik im Modus Push: Hinweis „keine Quellwolken als Wegweiser“, keine automatische Aufwertung.
- Wolken: Stunden mit möglichen Quellwolken sind im Tagesbalken und an der Zonen-Pille weiß schraffiert (auf grün also weiß-grün), in anderer Richtung als die Schraffur für Überforderung.
- Feineinstellungen: Skala der Gewichtung „egal (0) bis hoch (×2)“ beschriftet.

## 3. Annahmen und abgeleitete Logik

1. **Flugstil und Flugfenster.** Marvins Rückfrage: Wie hängen die Typen mit der Empfehlung zusammen? Vorschlag, so umgesetzt: Der Flugstil beschreibt, was du willst, Technik und Sicherheitsgefühl beschreiben, was du kannst. Wollen verschiebt nie Grenzen. Der Stil setzt nur den Tagesmodus zum Start (Butter, Kaffee oder Tee, Snack → Chill; Pralinenschachtel, Erdnussbutter → Flow; Dreiecksbrötchen → Push, sonst Flow). Später kann er die Sortierung beeinflussen (z. B. Pralinen: neue Gelände zuerst, Kaffee: Gelände mit Community-Aktivität), das braucht Community-Daten.
2. **Grundwind/Böen-Matrix.** Marvin hat 5/8 perfekt, 5/10 sehr gut, 5/15 gut vorgegeben. Fortgeschrieben über den Abstand Böe minus Grundwind: bis 3 km/h perfekt, bis 5 sehr gut, bis 10 gut, bis 15 unruhig, bis 20 ruppig, darüber grenzwertig; Böen über 35 immer kritisch. Unter 5 km/h Grundwind und Böen unter 10 gibt es keine Einstufung. Das ist vorerst nur Anzeige und fließt nicht in die Passung.
3. **Böen 30–35 km/h** fehlten in der Tabelle, sie zählen zu „stark“.
4. **Rückwärtsaufziehen ab 25 km/h** ist als feste persönliche Grenze umgesetzt (kein Fenster), ab 10 km/h als Hinweis. Die meisten Gelände haben ohnehin eine niedrigere Windgrenze.
5. **Ohne Character** rechnet die App vorsichtig: kein Seiten- und kein Rückenwind. Dadurch hat das Standardprofil am Beispieltag 29 statt vorher 30 Fenster.
6. **Push braucht weiter Thermik ab 3** (Mindestanforderung im Profil, abschaltbar). Push ist damit vor allem Thermik- und Streckenwetter.
7. **Erfahrungsschwellen** für die Startfragen sind Startwerte und sollten mit echten Flügen geprüft werden.

## 4. Backlog (zurückgestellt)

Mittelfristig:

- Wetterstationen an Startplätzen einbinden und verlinken; Vorhersagequalität als Ampel (Station gegen Modell). Braucht pro Startplatz eine verlässliche Station mit offener Schnittstelle.
- Vertikale Auflösung um 100 m: Open-Meteo liefert Druckflächen (etwa 500–1000 m Abstand in der Flugschicht) plus 80/120/180 m über Grund. Für 100 m braucht es eine andere Quelle oder Modell-Rohdaten (z. B. ICON-D2 Modellflächen beim DWD).
- Temperaturdiagramm pro Startplatz (Temperatur, Taupunkt, Basis, Inversion, Wind über Höhe), gleiches für den Landeplatz. Mit den vorhandenen Druckflächen schon grob machbar, sinnvoller mit feinerer Auflösung.
- Nebel und Sicht als eigener Faktor, getrennt für Start und Landeplatz, mit „Startfenster erst nach Auflösung prüfen“. Heute ist Nebel ein No-Go am Startplatz-Gitterpunkt.
- Flug-Debriefing und Flugtagebuch mit erklärter Charakter-Anpassung (geplanter Schritt 5).
- Feedback- und Ticket-Formular mit Spam-Schutz (braucht einen kleinen Server oder Dienst).
- Startplatzliste nach Standort sortieren, Favoriten, Ansichten „Meine Umgebung“, „Favoriten“, „Alle“.
- Startbedingungen pro Startplatz einstellen und Benachrichtigung bei Wunschbedingungen über mindestens 3 Stunden (braucht Push-Benachrichtigungen, also einen Server).
- Push-Vorlieben aus dem Konzept als optionale Fragen („Ich fliege gern lange Thermik“, „Wolkenentwicklung kann ich einschätzen“, „Blauthermik ist für mich kein Problem“, „Abschattung vermeide ich auf Strecke“, „Ich fliege gern am Hausberg“, „Abgleiter finde ich toll“, „Wenn es geht, gehe ich auf Strecke“). Damit könnte Blauthermik je nach Pilot aufgewertet oder abgewertet werden.
- Soaring pro Startplatz: Welche Hänge Soaring hergeben, weiß die Engine noch nicht; dafür bräuchte jeder Startplatz eine Angabe.
- Emoji-Skala für Turbulenz als zusätzliche schnelle Orientierung (die Wort-Labels sind schon da).

Später oder optional:

- Luftraum als Hintergrundprüfung mit Alarm bei Sperrungen (NOTAM/DAeC-Daten, rechtlich saubere Quelle nötig).
- Animation für Scherung und Turbulenz.
- Erweiterte XC-Analyse, automatische Anpassung des Characters aus mehreren Flügen.

## 5. Offene Fragen an Marvin

1. Passt die Verknüpfung Flugstil → Startmodus (Abschnitt 3.1)? Soll der Stil später auch die Reihenfolge der Startplätze beeinflussen?
2. Name für den „Erdnussbutter-Typ“: so lassen oder ein anderer?
3. Grundwind/Böen-Matrix: passt die Fortschreibung über den Böenabstand (3.2)? Soll sie in die Bewertung einfließen oder nur angezeigt werden?
4. Erfahrungsschwellen für die Seiten- und Rückenwindfragen (2, Startbedingungen) und die Grenzen 8/12 km/h Seitenwind-Anteil: passen die aus deiner Praxis?
5. Soll Push auch starke Soaring-Tage ohne Thermik umfassen, oder bleibt Push Thermik- und Streckenwetter?
6. Aus deiner Liste am Ende: Debriefing direkt nach dem Flug oder abends? Charakter-Anpassung automatisch oder nur nach Bestätigung? Version ohne Login mit optionalem Konto?
