# Glossar der Texte des Engine-Moduls

Ein Begriff pro Sache, in jeder Ansicht gleich. Gilt für die Kataloge in diesem Ordner
(`en*.ts`, `de*.ts`): Widget-Texte und Ask-AI-Übergaben.
`glossary.test.ts` prüft die verbotenen Synonyme (in jeder Flexion, jede Regel mit einer Probe,
die sie fangen muss), `catalog-text.test.ts` die Regeln aus
brand-tone (du, AI, „CIB seven“, kein Gedankenstrich als Verbinder, Plural nach
der Zahl). Neue Begriffe kommen erst hier hinein, dann in den Test, dann in den Katalog.

## Gemeinsame Begriffe aller Module

Diese Begriffe stehen in den Ansichten mehrerer Module. Sie gelten deshalb in jedem Modul gleich.
Die Regeln stehen einmal in widget-shell (`PRODUCT_GLOSSARY` in
`@miragon/pulse-widget-shell/testing`), und `glossary.test.ts` jedes Moduls prüft damit seine
Kataloge. Das Glossar von analytics führt dieselbe Tabelle.

| Sache                                                                       | Deutsch                                                            | Nicht                                | Englisch                  | Nicht                  |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------ | ------------------------- | ---------------------- |
| Fehler, den die Engine meldet                                               | Incident, Incidents                                                | Vorfall, Vorfälle, Störung           | incident                  | occurrence             |
| Jobs, deren Versuche aufgebraucht sind (`failedJobs`, `engine_jobs_failed`) | Jobs ohne Versuche („3 ohne Versuche“)                             | Fehlgeschlagene Jobs, tote Jobs      | jobs without retries      | failed jobs, dead jobs |
| BPMN-Modell auf die Engine bringen                                          | bereitstellen, bereitgestellt (das Ergebnis heißt Deployment)      | deployen, deployst, deployt          | deploy, deployed          | –                      |
| Business Key                                                                | Geschäftsschlüssel                                                 | GK, Business Key                     | business key              | BK                     |
| Instanz anhalten                                                            | aussetzen, ausgesetzt                                              | anhalten, angehalten, pausieren      | suspend, suspended        | pause, halt            |
| Retries eines Jobs                                                          | Versuche („Noch 2 Versuche“, „Keine Versuche mehr“), neu versuchen | Wiederholungen, wiederholen, Retries | retries, retry            | –                      |
| Alle Engines zusammen                                                       | alle Engines, Engine-übergreifend                                  | Flotte                               | all engines, cross-engine | fleet                  |

## Begriffe des Engine-Moduls

| Sache                                           | Deutsch                                                              | Nicht                     | Englisch                                      | Nicht                 |
| ----------------------------------------------- | -------------------------------------------------------------------- | ------------------------- | --------------------------------------------- | --------------------- |
| Ausgesetzte Instanz fortsetzen                  | aktivieren                                                           | fortsetzen                | activate                                      | resume                |
| Zustand einer Instanz                           | läuft (Zustand), laufend (bei Zahlen)                                | aktiv                     | running                                       | active                |
| Zustand einer Definition                        | aktiv, ausgesetzt                                                    | –                         | active, suspended                             | –                     |
| Modus des Prozessablaufs: was jetzt läuft       | Laufend („jetzt laufend“)                                            | aktiv                     | Running („running now“)                       | active                |
| Job neu ausführen lassen                        | neu versuchen, Ergebnis „Neu eingeplant“                             | wiederholen, „Wiederholt“ | retry, result „Retry scheduled“               | –                     |
| Incident schließen, ohne die Ursache zu beheben | als gelöst markieren, Ergebnis „Als gelöst markiert“                 | auflösen, „Behoben“       | mark as resolved, result „Marked as resolved“ | resolve (as a label)  |
| Bearbeiter einer Aufgabe                        | zugewiesen an                                                        | Bearbeiter                | assigned to                                   | assignee (as a label) |
| Ladezustand                                     | Wird geladen…                                                        | Laden…                    | Loading…                                      | –                     |
| Herstellerprodukt                               | CIB seven, Camunda 7, Operaton (aus `provider.branding.displayName`) | CIB Seven                 | CIB seven                                     | CIB Seven             |
| Künstliche Intelligenz                          | AI                                                                   | KI                        | AI                                            | –                     |

## Übergaben an den Chat

Eine Übergabe zeigt das Lucide-Icon der konkreten Funktion und ein Verb, das sagt, dass die
Arbeit im Chat passiert. Beides steht einmal in widget-shell: `HandOffButton` mit seiner Tabelle
`HAND_OFF_ACTIONS` (Icon) und `kitLabels().handOff` (Label, de und en) in
`@miragon/pulse-widget-shell/widgets`. Jede Funktion hat in jedem Modul dasselbe Icon und dasselbe
Label, kein Icon steht für zwei Funktionen. Ein Widget eines Connectors rendert Übergaben nur
über `HandOffButton` (ein ESLint-Gate verbietet `AskAiButton` dort); eine neue Funktion kommt
mit ihrem Icon und beiden Labels ins Kit. Das Glossar von analytics führt dieselbe Tabelle.

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

## Texte

- Fehlermeldungen sagen, was passiert ist, und was du tun kannst: „Der Job konnte nicht neu
  eingeplant werden (…). Prüf die Fehlermeldung und versuch es noch mal.“ Steht der erste Teil
  als Titel über einer Meldung (`ErrorState`), kommt der zweite als `description` darunter
  (`QueryFallback` nimmt beide aus `describeError`); der Titel hat nur eine Zeile.
- Booleans heißen „Ja“ und „Nein“ („Yes“ und „No“), nie `true`/`false`.
- Zahlen kommen formatiert in den Katalog (`formatNumber` im Widget); der Plural hängt an der
  Zahl (`countOf` in `plural.ts`), nie an zwei Schlüsseln `…One`/`…Other`.
- Englisch in Sentence case: „Open incidents“, nicht „Open Incidents“.
- Der Server setzt keinen Titel über eine Ansicht: die Überschrift des Widgets nennt sie in
  der Sprache des Hosts. Das gilt für jedes Tool, das eine Ansicht zeigt.
