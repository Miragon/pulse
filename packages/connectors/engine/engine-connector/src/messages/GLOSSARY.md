# Glossar der Texte des Engine-Moduls

Ein Begriff pro Sache, in jeder Ansicht gleich. Gilt für die Kataloge in diesem Ordner
(`en*.ts`, `de*.ts`): Widget-Texte und Ask-AI-Übergaben.
`glossary.test.ts` prüft die verbotenen Synonyme (in jeder Flexion, jede Regel mit einer Probe,
die sie fangen muss), `catalog-text.test.ts` die Regeln aus
brand-tone (du, AI, „CIB seven“, kein Gedankenstrich als Verbinder, Plural nach
der Zahl). Neue Begriffe kommen erst hier hinein, dann in den Test, dann in den Katalog.

## Gemeinsame Begriffe aller Module

Diese Begriffe gelten in jedem Modul gleich, auch in einem, das eine Komposition dazunimmt, und
in der VS-Code-Erweiterung. Die Regeln stehen einmal in pulse-ui (`PRODUCT_GLOSSARY` in
`@miragon/pulse-ui/testing`), und `glossary.test.ts` jedes Moduls prüft damit seine Kataloge;
die Erweiterung prüft ihre Texte im Code (`apps/vscode/test/architecture/product-words.test.ts`).

| Sache                                                 | Deutsch                                                            | Nicht                                | Englisch                           | Nicht                  |
| ----------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------ | ---------------------------------- | ---------------------- |
| Fehler, den die Engine meldet                         | Incident, Incidents                                                | Vorfall, Vorfälle, Störung           | incident                           | occurrence             |
| Jobs, deren Versuche aufgebraucht sind (`failedJobs`) | Jobs ohne Versuche („3 ohne Versuche“)                             | Fehlgeschlagene Jobs, tote Jobs      | jobs without retries               | failed jobs, dead jobs |
| BPMN-Modell auf die Engine bringen                    | bereitstellen, bereitgestellt (das Ergebnis heißt Deployment)      | deployen, deployst, deployt          | deploy, deployed                   | –                      |
| Business Key                                          | Geschäftsschlüssel                                                 | GK, Business Key                     | business key                       | BK                     |
| Instanz anhalten                                      | aussetzen, ausgesetzt                                              | anhalten, angehalten, pausieren      | suspend, suspended                 | pause, halt (¹)        |
| Retries eines Jobs                                    | Versuche („Noch 2 Versuche“, „Keine Versuche mehr“), neu versuchen | Wiederholungen, wiederholen, Retries | retries, retry                     | –                      |
| Alle Engines zusammen                                 | alle Engines, Engine-übergreifend                                  | Flotte                               | all engines, cross-engine          | fleet                  |
| Engine-Profil, das eine Oberfläche nicht nutzt (²)    | abgelehnt („ihr Profil ist abgelehnt“)                             | verworfen, zurückgewiesen, ungültig  | refused („its profile is refused“) | rejected, invalid      |

(¹) Englisch prüft die gemeinsame Regel „pause“ und „halt“ nur in drei Wörtern Abstand zu dem,
was die Engine aussetzt (Instanz, Prozess, Definition, Version, Job): VS Code pausiert seine
Live-Updates und hält einen Bulk-Lauf an, und das bleibt so. Das Cockpit pausiert nichts Eigenes,
darum verbietet `glossary.test.ts` hier jedes „pause“ und „halt“, mit der strengen Regel
`BARE_PAUSE_RULE_EN` aus `@miragon/pulse-ui/testing`, die auch die Wörter der Kits von widget-shell
und pulse-ui prüft.

(²) Der Server lehnt ein Profil ab, das er nicht nutzen kann (Code `ENGINE_PROFILE_REFUSED`), Pulse
for VS Code eines, das es nicht bedienen kann. Die Wörter stehen in `describeError` von widget-shell
(die Art `profileRefused`), auf der Landing des Cockpits („Profil abgelehnt“) und in der
Engine-übergreifenden Übersicht, die solche Engines zählt („1 mit abgelehntem Profil“, nie nur „1
abgelehnt“: neben „1 mit abgelehnten Zugangsdaten“ läse sich das wie die Anmeldung).

## Zählbegriffe

Owner-Entscheidung E2 (2026-11-08): Die MCP-Widgets und VS Code dürfen verschieden zählen (alle
Incidents oder die Wurzeln, eine Version oder alle), darum sind die Wörter gleich, nicht die
Zahlen. Ein Wort pro Zählung, kein Wort für zwei Zählungen; welche Zahl dahinter steht, bleibt
die Regel jedes Werkzeugs. Die Tabelle steht einmal in pulse-ui (`COUNT_TERMS` in
`@miragon/pulse-ui/testing`).

| Zählung                                                    | Deutsch                                              | Nicht         | Englisch                                         | Nicht          |
| ---------------------------------------------------------- | ---------------------------------------------------- | ------------- | ------------------------------------------------ | -------------- |
| Offene Incidents der gezeigten Sache                       | Incidents, als Kachel allein „Offene Incidents“      | –             | Incidents, as a tile on its own "Open incidents" | –              |
| Instanzen mit offenem Incident                             | Mit Incident                                         | Mit Incidents | With incident                                    | With incidents |
| Versionsbereich einer Zählung, immer im Kopf über der Zahl | alle Versionen, bei einer Version die Version („v3“) | –             | all versions, for one version the version ("v3") | –              |

## Begriffe des Engine-Moduls

| Sache                                           | Deutsch                                                              | Nicht                     | Englisch                                      | Nicht                 |
| ----------------------------------------------- | -------------------------------------------------------------------- | ------------------------- | --------------------------------------------- | --------------------- |
| Ausgesetzte Instanz fortsetzen                  | aktivieren                                                           | fortsetzen                | activate                                      | resume                |
| Zustand einer Instanz                           | läuft (Zustand), laufend (bei Zahlen)                                | aktiv                     | running                                       | active                |
| Zustand einer Definition                        | aktiv, ausgesetzt                                                    | –                         | active, suspended                             | –                     |
| Modus des Prozessablaufs: was jetzt läuft       | Laufend („jetzt laufend“)                                            | aktiv                     | Running („running now“)                       | active                |
| Modus: was Instanzen der 30 Tage durchliefen    | Durchlauf („Durchlauf · 30 Tage“), je Element Durchläufe             | Häufigkeit, Ausführungen  | Throughput, per element passes                | frequency, executions |
| Job neu ausführen lassen                        | neu versuchen, Ergebnis „Neu eingeplant“                             | wiederholen, „Wiederholt“ | retry, result „Retry scheduled“               | –                     |
| Incident schließen, ohne die Ursache zu beheben | als gelöst markieren, Ergebnis „Als gelöst markiert“                 | auflösen, „Behoben“       | mark as resolved, result „Marked as resolved“ | resolve (as a label)  |
| Bearbeiter einer Aufgabe                        | zugewiesen an                                                        | Bearbeiter                | assigned to                                   | assignee (as a label) |
| Ladezustand                                     | Wird geladen…                                                        | Laden…                    | Loading…                                      | –                     |
| Herstellerprodukt                               | CIB seven, Camunda 7, Operaton (aus `provider.branding.displayName`) | CIB Seven                 | CIB seven                                     | CIB Seven             |
| Künstliche Intelligenz                          | AI                                                                   | KI                        | AI                                            | –                     |
| Engine lehnt die Anmeldung des Servers ab (³)   | Zugangsdaten abgelehnt (HTTP 401), Zugriff verweigert (HTTP 403)     | nicht erreichbar          | credentials rejected, access denied           | unreachable           |

(³) Die Kurzform der Titel, die `describeError` für 401 und 403 zeigt, auf der Landing und in der
Engine-übergreifenden Übersicht, dort auch gezählt („1 mit abgelehnten Zugangsdaten“). Die Engine hat
geantwortet, also ist sie erreichbar; der Ton ist der eines abgelehnten Profils (warning), nicht der
eines Ausfalls. Die Übersicht sagt deshalb zu einer Engine, die sie nicht lesen konnte, nie „hat nicht
geantwortet“, sondern verweist auf ihre Zeile, und „Ursache finden“ auf der Übersicht der Engine fragt
nach der abgelehnten Anmeldung. `glossary.test.ts` hält die Wörter fest; eine Regel gegen „nicht
erreichbar“ gibt es nicht, weil das Wort für eine Engine ohne Antwort richtig ist.

## Übergaben an den Chat

Eine Übergabe zeigt das Lucide-Icon der konkreten Funktion und ein Verb, das sagt, dass die
Arbeit im Chat passiert. Beides steht einmal in widget-shell: `HandOffButton` mit seiner Tabelle
`HAND_OFF_ACTIONS` (Icon) und `kitLabels().handOff` (Label, de und en) in
`@miragon/pulse-widget-shell/widgets`. Jede Funktion hat in jedem Modul dasselbe Icon und dasselbe
Label, kein Icon steht für zwei Funktionen. Ein Widget eines Connectors rendert Übergaben nur
über `HandOffButton` (ein ESLint-Gate verbietet `AskAiButton` dort); eine neue Funktion kommt
mit ihrem Icon und beiden Labels ins Kit.

| Funktion                  | Icon          | Deutsch                    | Englisch                 |
| ------------------------- | ------------- | -------------------------- | ------------------------ |
| Lage einordnen            | ListChecks    | Im Chat bewerten           | Assess in chat           |
| Ursache finden            | ScanSearch    | Ursache im Chat klären     | Find cause in chat       |
| Fehler erklären           | FileSearch    | Fehler im Chat erklären    | Explain error in chat    |
| Behebung planen           | Wrench        | Behebung im Chat planen    | Plan a fix in chat       |
| Ticket entwerfen          | ClipboardList | Ticket im Chat entwerfen   | Draft ticket in chat     |
| Verlauf erklären          | Route         | Verlauf im Chat erklären   | Explain timeline in chat |
| Dauer erklären            | Timer         | Dauer im Chat erklären     | Explain duration in chat |
| Variablen prüfen          | Braces        | Variablen im Chat prüfen   | Check variables in chat  |
| Diagramm erklären         | Workflow      | Zustand im Chat erklären   | Explain state in chat    |
| Zustand prüfen            | Stethoscope   | Zustand im Chat prüfen     | Check health in chat     |
| Fehler über Engines       | Bug           | Fehler im Chat analysieren | Analyze failures in chat |
| Nach Dringlichkeit ordnen | ListOrdered   | Im Chat priorisieren       | Prioritize in chat       |

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
