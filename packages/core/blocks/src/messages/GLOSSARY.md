# Glossar der Texte der Bausteine

Ein Begriff pro Sache, auf jeder Oberfläche gleich. Gilt für die Kataloge in diesem Ordner: die
Texte der Kacheln eines Boards (`en.ts`, `de.ts`), ihre Titel, Zählungen, Spalten, Hinweise und die
Probleme einer Board-Datei, die Texte der Bausteine der Screens (`screen-en.ts`,
`screen-de.ts`): die Prozessliste einer Engine mit ihrer Filterleiste, und die Texte der Bausteine
einer Instanz (`instance-en.ts`, `instance-de.ts`): Fakten, Kopfstreifen, Incident-Karten und ihr
Text, die Tabellen Wartet an, Verlauf und Variablen, das Menü der aufgerufenen Instanzen und die
Legende der Marker, und die Texte der Bausteine eines Prozesses (`process-en.ts`,
`process-de.ts`): Versionsauswahl, Hinweis auf ältere Versionen, die Filterleiste seiner
Instanzliste mit dem Dialog der Variablenbedingungen, die Instanztabelle, die Zähler und
Aufrufknöpfe am Diagramm und ihre Legende, und die Texte der Tabellen über alle Engines
(`engines-en.ts`, `engines-de.ts`): eine Zeile je Engine und was wo läuft. Jeder Katalog steht für
sich, damit eine Oberfläche nur die Wörter der Bausteine bündelt, die sie zeigt. `glossary.test.ts`
prüft die verbotenen Synonyme (jede Regel mit einer Probe, die sie fangen muss), die Regeln aus
brand-tone (du, AI, „CIB seven“, kein Gedankenstrich als Verbinder, Plural nach der Zahl), dass
jeder englische Schlüssel seinen deutschen hat und dass die Bausteine die Zählbegriffe „Mit
Incident“ und „alle Versionen“ aller Oberflächen nutzen. Die englischen Texte der Screens sind die
des Engine-Tabs, der Instanzansicht und der Definitionsansicht von Pulse for VS Code und Pulse for
Orca, Buchstabe für Buchstabe.
Die englischen Texte der Probleme sind die des Board-Formats (`BoardProblems.describe` in
`@miragon/pulse-board`), was `src/board/problem-words.test.ts` über die gemeinsamen Fixtures prüft.
Neue Begriffe kommen erst hier hinein, dann in den Test, dann in den Katalog.

## Gemeinsame Begriffe aller Oberflächen

Die Regeln stehen einmal in pulse-ui (`PRODUCT_GLOSSARY` in `@miragon/pulse-ui/glossary`, die
Tabelle daraus: `docs/glossary.md`): die MCP-Widgets, Pulse for VS Code, Pulse for Orca und diese
Bausteine sagen dasselbe.

| Sache                                                 | Deutsch                                                       | Nicht                                | Englisch                  | Nicht                  |
| ----------------------------------------------------- | ------------------------------------------------------------- | ------------------------------------ | ------------------------- | ---------------------- |
| Fehler, den die Engine meldet                         | Incident, Incidents                                           | Vorfall, Vorfälle, Störung           | incident                  | occurrence             |
| Instanzen mit offenem Incident (die Zählung)          | Mit Incident                                                  | Mit Incidents                        | With incident             | With incidents         |
| Jobs, deren Versuche aufgebraucht sind (`failedJobs`) | Jobs ohne Versuche                                            | Fehlgeschlagene Jobs, tote Jobs      | jobs without retries      | failed jobs, dead jobs |
| BPMN-Modell auf die Engine bringen                    | bereitstellen, bereitgestellt (das Ergebnis heißt Deployment) | deployen, deployt                    | deploy, deployed          | –                      |
| Business Key                                          | Geschäftsschlüssel                                            | GK, Business Key                     | business key              | BK                     |
| Instanz anhalten                                      | aussetzen, ausgesetzt                                         | anhalten, angehalten, pausieren      | suspend, suspended        | pause, halt            |
| Retries eines Jobs                                    | Versuche, neu versuchen                                       | Wiederholungen, wiederholen, Retries | retries, retry            | –                      |
| Alle Engines zusammen                                 | alle Engines, Engine-übergreifend                             | Flotte                               | all engines, cross-engine | fleet                  |
| Engine-Profil, das eine Oberfläche nicht nutzt        | abgelehnt                                                     | verworfen, zurückgewiesen, ungültig  | refused                   | rejected, invalid      |
| Instanz oder Schritt, der läuft                       | läuft                                                         | Aktiv                                | running                   | Active                 |
| Instanz oder Schritt, beendet ohne Abschluss          | abgebrochen                                                   | terminiert                           | cancelled                 | Terminated, Canceled   |

## Begriffe der Kacheln

| Sache                                   | Deutsch                               | Englisch                           |
| --------------------------------------- | ------------------------------------- | ---------------------------------- |
| Eine Kachel, die die Datei bricht       | Widget                                | widget                             |
| Die Zählung einer Engine, nicht gelesen | nicht gelesen                         | not read                           |
| Die Schwelle eines Zählers              | warnt über 5                          | warns above 5                      |
| Eine Engine, die aufhörte zu zählen     | hat bei 10.000 aufgehört zu zählen    | stopped counting at 10,000         |
| Der Anteil einer Engine in einer Liste  | 2 von 10 angezeigt                    | showing 2 of 10                    |
| Der Status einer Instanz                | Status (die Wörter des Kits: Läuft …) | State (the kit's words: Running …) |
| Die neueste Version eines Prozesses     | die neueste Version                   | the latest version                 |
| Eine Seite neben der Ansicht            | daneben (Strg/Cmd+Klick)              | to the side (Ctrl/Cmd+click)       |

Der Zustand einer Instanz kommt aus pulse-uis `StateLabel` in der Sprache seines `LocaleProvider`,
ein Wort pro Zustand auf jeder Oberfläche.

## Begriffe der Screens

| Sache                                        | Deutsch                                      | Englisch            |
| -------------------------------------------- | -------------------------------------------- | ------------------- |
| Die ID eines Prozesses im Modell             | BPMN-Prozess-ID (im Suchfeld kurz „BPMN-ID“) | BPMN process ID     |
| Die neueste Version eines Prozesses          | Neueste Version                              | Latest version      |
| Die laufenden Instanzen eines Prozesses      | Laufend, laufend                             | Running, running    |
| Der Umfang einer Zählung über jede Version   | alle Versionen                               | all versions        |
| Die Auswahl, welche Prozesse die Liste zeigt | Prozesse zeigen: Alle, Mit Incident          | Show processes      |
| Eine Zählung mit Incident über 0             | Hat offene Incidents (für den Screenreader)  | Has open incidents  |
| Die offenen Wurzel-Incidents eines Prozesses | Incidents (die Spalte, über alle Versionen)  | Incidents           |
| Die Legende der Zählungen der Prozessliste   | Was die Zahlen sagen                         | What the counts say |

## Begriffe einer Instanz

| Sache                                                     | Deutsch                                     | Englisch                     |
| --------------------------------------------------------- | ------------------------------------------- | ---------------------------- |
| Die Zeile, die `RootCauses` als Grundursache nennt        | Grundursache                                | Root cause                   |
| Die Ursache aus der Fehlermeldung eines Workers           | Fehler des Workers                          | Worker error                 |
| Die Ursache aus der Meldung der Engine                    | Ursache                                     | Cause                        |
| Die aufgerufene Instanz, in der ein Wurzel-Incident liegt | Liegt in                                    | Located in                   |
| Die Versuche, die ein Job noch hat                        | Verbleibende Versuche, n Versuche übrig     | Retries left, n retries left |
| Ein Job, dessen Versuche aufgebraucht sind (der Alarm)    | Keine Versuche mehr                         | No retries left              |
| Wo eine Instanz wartet, die Art des Wartens               | Wartet an; Benutzeraufgabe, Asynchroner Job | Waiting at; User task …      |
| Die Elemente, die eine Instanz durchlief                  | Verlauf                                     | History                      |
| Wo eine Variable gilt                                     | Gültigkeitsbereich, Prozess                 | Scope, Process               |
| Ein Wert, den die Engine abschnitt                        | gekürzt                                     | cut off                      |
| Der Text eines Incidents                                  | Stacktrace, Fehlermeldung                   | Stacktrace, Error message    |
| Die Instanz, die diese aufrief                            | von …, aufrufende Instanz                   | from …, calling instance     |
| Die Instanzen, die eine Aufrufaktivität startete          | aufgerufene Instanzen                       | called instances             |
| Die Kanten, die eine Instanz im Diagramm nahm             | Sequenzflüsse                               | flows                        |

Eine asynchrone Fortsetzung heißt im Deutschen „Asynchroner Job“: das Wort „Fortsetzung“ meint im
Produkt das Aktivieren einer ausgesetzten Instanz (die Glossarregel oben).

## Begriffe eines Prozesses

| Sache                                                | Deutsch                                               | Englisch                                           |
| ---------------------------------------------------- | ----------------------------------------------------- | -------------------------------------------------- |
| Die Bereiche einer Instanzliste                      | Laufend, Mit Incident, Beendet, Alle                  | Running, With incident, Ended, All                 |
| Der Filter auf ein Element                           | An (Element), Elementfilter entfernen                 | At (element), Clear element filter                 |
| Eine Bedingung über eine Variable                    | Variablenbedingung, Bedingung                         | variable condition, condition                      |
| Wie eine Bedingung vergleicht                        | Vergleichen als: Automatisch, Text, Zahl …            | Compare as: Automatic, Text, Number …              |
| Eine Bedingung, die die Engine nicht kann (gesperrt) | Diese Engine vergleicht keine Datumswerte.            | This engine can't compare dates.                   |
| Die nächste Seite einer Liste                        | Mehr laden                                            | Load more                                          |
| Instanzen auf älteren Versionen                      | laufen noch auf älteren Versionen, davon mit Incident | still run on older versions, of them with incident |
| Die Zähler an einem Element des Diagramms            | Badges: wartet hier, Incident hier                    | badges: waiting here, incident here                |

Die Zahl gesetzter Bedingungen heißt „2 Bedingungen“, nie „aktiv“: „aktiv“ meint im Produkt eine
laufende Instanz (die Glossarregel oben).

## Begriffe der Suche

| Sache                                        | Deutsch                                          | Englisch                                  |
| -------------------------------------------- | ------------------------------------------------ | ----------------------------------------- |
| Was die Suche findet                         | Gefundene Instanzen                              | Found instances                           |
| Wonach sie sucht                             | die ganze ID oder der genaue Geschäftsschlüssel  | the whole ID or the exact business key    |
| Eine Engine mit mehr Treffern, als sie zeigt | hat mehr Instanzen mit diesem Geschäftsschlüssel | has more instances with this business key |
| Eine Historie, der laufende Instanzen fehlen | Laufende Instanzen fehlen in der Historie von …  | Running instances are missing from …      |

## Begriffe der Tabellen über alle Engines

| Sache                                           | Deutsch                                            | Englisch                                       |
| ----------------------------------------------- | -------------------------------------------------- | ---------------------------------------------- |
| Was eine Engine ist, wie ihr Engine-Screen sagt | Produkt (eine Engine ohne Angabe: Gedankenstrich)  | Product                                        |
| Eine Engine ohne Zahlen, ihr Zustand            | lädt…, nicht gelesen, Profil abgelehnt             | loading…, not read, profile refused            |
| Die Prozesse je Engine                          | Was wo läuft, Prozesse je Engine                   | What runs where, Processes by engine           |
| Ein Prozess, den eine Engine nicht hat          | auf … nicht bereitgestellt (für den Screenreader)  | not deployed on … (for the screen reader)      |
| Warum die Ansicht keine Raten zeigt             | Engines führen verschiedene Prozesse, … nie Raten. | Engines run different processes, … never rates |
