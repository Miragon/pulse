<!-- Generated from @miragon/pulse-ui/glossary by packages/core/ui/src/glossary/glossary-page.test-support.ts. Do not edit: run pnpm --fail-if-no-match --filter @miragon/pulse-ui golden:update. -->

# Glossary

Every Pulse UI says one thing with one word: the MCP cockpit, the web app, Pulse for VS Code, Pulse
for Orca and a page you build on `@miragon/pulse-ui`. The words are data in
`@miragon/pulse-ui/glossary`, which needs no peer and runs in a browser as it is, and this page is
generated from it. Each term says what to write, the words it replaces and where the rule stops; a
term's forms are separated by commas.

```ts
import { COUNT_TERMS, glossaryFindings, PRODUCT_GLOSSARY } from "@miragon/pulse-ui/glossary"

// Each text of your catalog that uses a replaced word, with the term to write instead
const findings = glossaryFindings(messages.de, PRODUCT_GLOSSARY.de)
```

The rules and their patterns live in `packages/core/ui/src/glossary/rules.ts`; every Pulse UI runs
them over its catalogs in its tests.

## English

| Write                     | Instead of                               | Note                                                                                                                                       |
| ------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| jobs without retries      | failed jobs, dead jobs                   | The jobs whose retries ran out, as a quantity: a single job that failed keeps its words.                                                   |
| incident                  | occurrence                               |                                                                                                                                            |
| business key              | BK                                       |                                                                                                                                            |
| suspend, suspended        | paused instances, halt a job             | Next to what the engine suspends (an instance, a process, a definition, a version, a job): live updates and bulk runs keep pause and halt. |
| all engines, cross-engine | fleet                                    |                                                                                                                                            |
| With incident             | With incidents, instances with incidents | The count of instances that have an open incident; other things with incidents keep the plural.                                            |
| refused                   | rejected profile, invalid profile        | An engine profile a surface does not use; the engine rejecting credentials keeps its own words.                                            |
| cancelled                 | Terminated, Canceled                     | The engine's values in code (terminated, canceled) stay free.                                                                              |
| running                   | Active                                   | A state label alone: a filter that is active stays free.                                                                                   |

A UI that pauses nothing of its own, such as a page on the kit, runs `BARE_PAUSE_RULE_EN` beside the
English rules:

| Write              | Instead of          | Note                                                                                                                   |
| ------------------ | ------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| suspend, suspended | pause, paused, halt | For a UI that pauses nothing of its own, beside the product rules: any pause or halt there is the engine's suspension. |

## German

| Write                             | Instead of                                | Note                                                                                            |
| --------------------------------- | ----------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Incident                          | Vorfall, Vorfälle, Störung                |                                                                                                 |
| Jobs ohne Versuche                | fehlgeschlagene Jobs, tote Jobs           | The jobs whose retries ran out, as a quantity: a single job that failed keeps its words.        |
| bereitstellen, bereitgestellt     | deployen, deployt                         | The verb only: the result stays a Deployment, the engine's noun.                                |
| Geschäftsschlüssel                | GK, Business Key                          |                                                                                                 |
| aussetzen, ausgesetzt             | anhalten, angehalten, pausieren, pausiert |                                                                                                 |
| Versuche, neu versuchen           | wiederholen, Wiederholungen               |                                                                                                 |
| Versuche                          | Retry, Retries                            |                                                                                                 |
| alle Engines, Engine-übergreifend | Flotte                                    |                                                                                                 |
| Mit Incident                      | Mit Incidents, Instanzen mit Incidents    | The count of instances that have an open incident; other things with incidents keep the plural. |
| abgelehnt                         | Profil verworfen, ungültiges Profil       | An engine profile a surface does not use; the engine rejecting credentials keeps its own words. |
| abgebrochen                       | terminiert                                | The engine's values in code (terminated, canceled) stay free.                                   |
| läuft                             | Aktiv                                     | A state label alone: a filter that is active stays free.                                        |

## Count words

One word per count, and a word never names two counts. A count's header names its version scope:
"all versions" for every version of a process, the version itself (v3) for one. The long form stands
on a label away from the thing it counts, such as a key figure.

| Count               | English             | German                  | Long form                        | What it counts                                                                                                                                                               |
| ------------------- | ------------------- | ----------------------- | -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `incidents`         | Incidents           | Incidents               | Open incidents, Offene Incidents | the open root incidents of the thing shown                                                                                                                                   |
| `withIncident`      | With incident       | Mit Incident            |                                  | the instances that have an open incident                                                                                                                                     |
| `allVersions`       | all versions        | alle Versionen          |                                  | the version scope of a count over every version of a process                                                                                                                 |
| `inProcesses`       | in processes        | in Prozessen            |                                  | the scope of an engine's open root incidents its processes hold, beside those outside any process                                                                            |
| `outsideAnyProcess` | outside any process | außerhalb von Prozessen |                                  | an engine's open root incidents no process holds (a batch's or the history cleanup's failed job), apart from those in processes, a lower bound where the incidents read stop |
