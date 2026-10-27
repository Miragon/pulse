# Usage

## Engines and processes

The **Engines** view lists the profiles of `.pulse-cli.json` with their deployed processes,
running counts and incident markers. A click on an engine opens its overview: every process
with its latest version, running and with-incident counts, the ones in trouble first.

![The Engines view with processes, counts and incident markers](../assets/vscode/01-engines-at-a-glance.png)

![The engine overview, processes in trouble first](../assets/vscode/02-engine-overview.png)

## A process definition

The **Definition** panel draws the deployed diagram of one version with badges per element, a
version picker with counts per version, and the instances (running, with incident, ended),
filtered by element or business key.

The funnel button in the filter bar finds instances by their process variables: a name (the
dialog suggests the names the newest instances of the version hold, any other name works
too), an operator
(is, is not, matches, greater or less than) and a value, `*` as the wildcard of _matches_.
_Compare as_ picks the type: text, number, true or false, date and time (is after, is
before) or null. JSON and object variables can't be searched.
Each condition becomes a chip, and an instance matches when all of them hold; counts and
selections follow. The search reads the engine's history, so CIB seven, Operaton and Camunda 7
need history level `audit` or higher.

![A definition with badges on the diagram and its instances](../assets/vscode/03-definition-overview.png)

## An instance and its incident

The **Instance** panel shows where the instance waits, its incidents with the root cause from
the full stack trace, incidents inside called instances, its variables, and a Markdown handover
to copy. Stack traces open as read-only documents with links from your frames to your sources.

![An instance with an incident and its root cause](../assets/vscode/04-instance-incident-root-cause.png)

![A stack trace with links to the sources](../assets/vscode/05-stacktrace-with-source-links.png)

## Model and code

From an incident or any element, open the local `.bpmn` at the element and the worker or
delegate that implements it. _Show Runtime Data for This Model_ on a `.bpmn` file tells you
whether the file matches a deployed version. _Go to Process Instance…_ finds one by id or
business key.

![The local model and the code that implements an element](../assets/vscode/06-local-sources-model-and-code.png)

![A local model that differs from the deployed version](../assets/vscode/07-model-drift.png)

## Writes

Retry incidents, change variables and move tokens: on local engines by default, elsewhere only
when `pulse.writes` allows it ([Configuration](./configuration.md#settings)). Every write asks
first, names its exact target and leaves an audit line in the output channel "Pulse".

![Changing a variable](../assets/vscode/08-edit-variable.png)

![The confirmation names the engine and the target](../assets/vscode/09-write-confirmation-test-engine.png)

## Batches

Tick instances in the definition panel to cancel or migrate them as one batch, follow its
progress and stop it. A migration shows both versions with the mapping the engine proposes and
flags elements where instances would get stuck, before anything runs.

![A migration plan between two versions](../assets/vscode/10-migration-plan.png)

All 39 screenshots, one per use case, are in `apps/vscode/docs/screenshots/`.
