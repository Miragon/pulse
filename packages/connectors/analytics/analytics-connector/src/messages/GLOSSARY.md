# Glossar der Analytics-Texte

Ein Begriff, ein Wort: Die Kataloge in diesem Ordner (`*.sweep.ts` für die Widgets,
`*.ask-ai.ts` für die Übergaben an den Chat, `*.server.ts` für die Zusammenfassungen an
das Modell) benutzen genau die Wörter dieser Tabellen. Die Schreibregeln (du, AI, „CIB
seven“, kein Gedankenstrich als Verbinder) prüft `brand-gates.test.ts`, die Begriffe
`glossary.test.ts` über `glossary.ts` und die gemeinsamen Regeln des Kits. Wer hier einen
Begriff ändert, ändert ihn auch dort.

## Gemeinsame Begriffe aller Module

Diese Begriffe stehen in den Ansichten mehrerer Module nebeneinander: Die Engine-übergreifende
Übersicht von camunda7 bettet die Prozesslandschaft von analytics ein. Sie gelten deshalb in
jedem Modul gleich. Die Regeln stehen einmal im Kit (`PRODUCT_GLOSSARY` in
`@miragon/pulse-widget-shell/testing`), und `glossary.test.ts` jedes Moduls prüft damit seine
Kataloge. Das Glossar von camunda7 führt dieselbe Tabelle.

| Sache                                                                        | Deutsch                                                            | Nicht                                | Englisch                  | Nicht                  |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------ | ------------------------- | ---------------------- |
| Fehler, den die Engine meldet                                                | Incident, Incidents                                                | Vorfall, Vorfälle, Störung           | incident                  | occurrence             |
| Jobs, deren Versuche aufgebraucht sind (`failedJobs`, `camunda_jobs_failed`) | Jobs ohne Versuche („3 ohne Versuche“)                             | Fehlgeschlagene Jobs, tote Jobs      | jobs without retries      | failed jobs, dead jobs |
| BPMN-Modell auf die Engine bringen                                           | bereitstellen, bereitgestellt (das Ergebnis heißt Deployment)      | deployen, deployst, deployt          | deploy, deployed          | –                      |
| Business Key                                                                 | Geschäftsschlüssel                                                 | GK, Business Key                     | business key              | BK                     |
| Instanz anhalten                                                             | aussetzen, ausgesetzt                                              | anhalten, angehalten, pausieren      | suspend, suspended        | pause, halt            |
| Retries eines Jobs                                                           | Versuche („Noch 2 Versuche“, „Keine Versuche mehr“), neu versuchen | Wiederholungen, wiederholen, Retries | retries, retry            | –                      |
| Alle Engines zusammen                                                        | alle Engines, Engine-übergreifend                                  | Flotte                               | all engines, cross-engine | fleet                  |

## Begriffe von analytics

| Deutsch                 | Englisch                 | Nicht                                                                    | Hinweis                                                                                                                            |
| ----------------------- | ------------------------ | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| Incidents je 100 Starts | incidents per 100 starts | Vorfallsrate, „/ 100 gestartet“                                          | Eine Rate kann über 100 liegen, deshalb ohne %. Live: „Incidents je 100 laufende Instanzen“ (incidents per 100 running instances). |
| AI                      | AI                       | KI                                                                       | Auch in Zusammensetzungen.                                                                                                         |
| CIB seven               | CIB seven                | CIB Seven                                                                | Der Herstellername kommt aus `provider.branding.displayName`.                                                                      |
| läuft, laufend          | running                  | aktiv, active                                                            | „Laufen gerade“, „Laufende Instanzen“.                                                                                             |
| nicht belastbar         | not reliable             | unzureichendes Signal, Unzureichende Datengrundlage, insufficient signal | Ein Vergleich unter der Mindestgröße zeigt Zahlen, aber kein Urteil. „Zu wenig Daten“ im Hinweis.                                  |
| Zeitraum                | period                   | Fenster, Zeitfenster, window, Bucket                                     | Nur in Widget-Texten und Übergaben; die Zusammenfassungen an das Modell dürfen „window“ sagen.                                     |
| Kennzahl                | metric                   | KPI                                                                      | „Kennzahlen vergleichen“, „Für eine Seite fehlen die Kennzahlen“.                                                                  |
| gerade, Stand           | right now, as of         | Snapshot                                                                 | „Gerade ist kein Incident offen.“, „Stand 14:32“.                                                                                  |

## Übergaben an den Chat

Eine Übergabe zeigt das Lucide-Icon der konkreten Funktion und ein Verb, das sagt, dass die
Arbeit im Chat passiert, nie ein Sparkle. Beides steht einmal im Kit: `HandOffButton` mit seiner
Tabelle `HAND_OFF_ACTIONS` (Icon) und `kitLabels().handOff` (Label, de und en) in
`@miragon/pulse-widget-shell/widgets`. Jede Funktion hat in jedem Modul dasselbe Icon und dasselbe
Label, kein Icon steht für zwei Funktionen. Ein Widget eines Connectors rendert Übergaben nur
über `HandOffButton` (ein ESLint-Gate verbietet `AskAiButton` dort); eine neue Funktion kommt
mit ihrem Icon und beiden Labels ins Kit. Ein Icon-Button in einer Tabellenzeile nennt seinen
Gegenstand im `title`, beim Vergleich zwischen Engines den Prozess (`aLandscape.compareLabel`).
Das Glossar von camunda7 führt dieselbe Tabelle.

| Funktion                         | Icon           | Deutsch                         | Englisch                    |
| -------------------------------- | -------------- | ------------------------------- | --------------------------- |
| Lage einordnen                   | ListChecks     | Im Chat bewerten                | Assess in chat              |
| Ursache finden                   | ScanSearch     | Ursache im Chat klären          | Find cause in chat          |
| Fehler erklären                  | FileSearch     | Fehler im Chat erklären         | Explain error in chat       |
| Behebung planen                  | Wrench         | Behebung im Chat planen         | Plan a fix in chat          |
| Ticket entwerfen                 | ClipboardList  | Ticket im Chat entwerfen        | Draft ticket in chat        |
| Verlauf erklären                 | Route          | Verlauf im Chat erklären        | Explain timeline in chat    |
| Dauer erklären                   | Timer          | Dauer im Chat erklären          | Explain duration in chat    |
| Variablen prüfen                 | Braces         | Variablen im Chat prüfen        | Check variables in chat     |
| Diagramm erklären                | Workflow       | Zustand im Chat erklären        | Explain state in chat       |
| Zustand prüfen                   | Stethoscope    | Zustand im Chat prüfen          | Check health in chat        |
| Fehler über Engines              | Bug            | Fehler im Chat analysieren      | Analyze failures in chat    |
| Performance über Engines         | Gauge          | Performance im Chat analysieren | Analyze performance in chat |
| Engpass erklären                 | Hourglass      | Engpass im Chat erklären        | Explain bottleneck in chat  |
| Nach Dringlichkeit ordnen        | ListOrdered    | Im Chat priorisieren            | Prioritize in chat          |
| Prozess über Engines vergleichen | ArrowLeftRight | Engines im Chat vergleichen     | Compare engines in chat     |

## Zahlen und Urteile

- Zahlen formatiert das Kit (`formatNumber`, `formatPercent`, `formatDuration`,
  `formatLookback`) in der Sprache der Ansicht: „1.234“, „+12,5 %“, „3 Min. 7 s“,
  „Letzte 7 Tage“. Eine Änderung von Incidents je 100 Starts hat dieselbe Einheit wie
  die Werte („+0,2“).
- Eine Zahl ist nie farbig: Ein Zustand steht als Punkt, Icon oder Rand neben neutraler
  Schrift, auch in der Aufschlüsselung nach Prozessdefinition.
- Volumen (Starts) bekommt nie ein Urteil: Weniger Last auf einer Testumgebung ist kein
  Fehler. Nur Qualitätskennzahlen (Dauern, Incidents je 100 Starts) heißen „besser“ oder
  „schlechter“, und erst ab ihrer Schwelle (Dauern ab 5 %, Incidents ab 1 je 100 Starts).
- Ein Vergleich unter der Mindestgröße zeigt seine Änderungen neutral mit „nicht
  belastbar“.
- Unter jedem Titel steht der Bezugsrahmen: Zeitraum, Engines (und wie viele davon ohne
  Metriken), Stand.
- Der Server setzt keinen Titel über eine Ansicht: die Überschrift des Widgets nennt sie in
  der Sprache des Hosts. Das gilt für die Show-Tools jedes Moduls.
