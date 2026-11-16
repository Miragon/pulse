# Glossar der Texte der Bausteine

Ein Begriff pro Sache, auf jeder Oberfläche gleich. Gilt für die Kataloge in diesem Ordner
(`en.ts`, `de.ts`): die Texte der Kacheln eines Boards, ihre Titel, Zählungen, Spalten, Hinweise
und die Probleme einer Board-Datei. `glossary.test.ts` prüft die verbotenen Synonyme (jede Regel
mit einer Probe, die sie fangen muss), die Regeln aus brand-tone (du, AI, „CIB seven“, kein
Gedankenstrich als Verbinder, Plural nach der Zahl), dass jeder englische Schlüssel seinen
deutschen hat und dass die Bausteine den Zählbegriff „Mit Incident“ aller Oberflächen nutzen.
Die englischen Texte der Probleme sind die des Board-Formats (`BoardProblems.describe` in
`@miragon/pulse-board`), was `src/board/problem-words.test.ts` über die gemeinsamen Fixtures prüft.
Neue Begriffe kommen erst hier hinein, dann in den Test, dann in den Katalog.

## Gemeinsame Begriffe aller Oberflächen

Die Regeln stehen einmal in pulse-ui (`PRODUCT_GLOSSARY` in `@miragon/pulse-ui/testing`): die
MCP-Widgets, Pulse for VS Code, Pulse for Orca und diese Bausteine sagen dasselbe.

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
