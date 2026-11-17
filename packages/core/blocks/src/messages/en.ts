/** A text with `{name}` placeholders, or a function of the values (plurals, conditions). */
export type Message = string | ((params: Readonly<Record<string, unknown>>) => string)

/** A count reaches an entry formatted ("1,234"), so one is decided on its text: exactly "1". */
export function isOne(count: unknown): boolean {
  return String(count) === "1"
}

/** The count and its noun in the right number: "1 engine", "2 engines". */
export function countOf(count: unknown, one: string, other: string): string {
  return `${String(count)} ${isOne(count) ? one : other}`
}

/**
 * The English words of the board's tiles. A problem's words equal `BoardProblems.describe` of
 * `@miragon/pulse-board`, the sentence after its JSON path, or after its tile (`note.tile`) for the
 * note on a diagram too long to roll up. Every key has its German entry in `de.ts`.
 */
export const en = {
  "title.widget": "Widget",
  "title.widgetNamed": 'Widget "{widget}"',
  "title.instanceSummary": "Instances with incident",
  "title.openIncidents": "Open incidents",
  "title.openIncidentsOf": "Open incidents of {process}",
  "filter.running": "Running instances",
  "filter.ended": "Ended instances",
  "filter.withIncident": "with incident",
  "filter.withoutIncident": "without incident",
  "filter.process": "of {process}",
  "filter.element": "at {element}",
  "filter.businessKey": "with key {key}",
  perEngine: "Per engine",
  perProcess: "Per process",
  notRead: "not read",
  noEngineRead: "No engine was read.",
  withIncident: "with incident",
  "group.notRead": "{engine}: not read",
  "counter.partial": ({ known, engines }) =>
    `from ${String(known)} of ${countOf(engines, "engine", "engines")}`,
  "counter.warnsAbove": "warns above {limit}",
  "counter.engineAbove": "{engine} above {limit}",
  "counter.enginesAbove": ({ count, limit }) =>
    `${countOf(count, "engine", "engines")} above ${String(limit)}`,
  "counter.engineStopped": "{engine} stopped counting at {count}",
  "counter.enginesStopped": ({ count }) =>
    `${countOf(count, "engine", "engines")} stopped counting`,
  "open.engine": "Open the processes of {engine}",
  "open.process": "Open the process on {engine}, latest version first",
  "open.toSide": "{title} (Ctrl/Cmd+click: to the side)",
  "open.instance": "Open instance {id}",
  "summary.noIncident": "No instance has an open incident.",
  "instances.label": "Instances",
  "instances.empty": "No instance matches on the engines that answered.",
  "instances.showing": "{engine}: showing {shown} of {total}",
  "instances.copy": "Instance ID",
  "instances.version": "v{version}",
  "incidents.label": "Incidents",
  "incidents.empty": "No open incident on the engines that answered.",
  "incidents.firstMore": "{engine}: first {shown}, more open",
  "incidents.open": "{engine}: {shown} open",
  "incidents.copy": "Incident message",
  "incident.flag": "Incident",
  "incident.flagTitle": "Has an open incident",
  "column.engine": "Engine",
  "column.process": "Process",
  "column.version": "Version",
  "column.businessKey": "Business key",
  "column.state": "State",
  "column.startedAt": "Started",
  "column.endedAt": "Ended",
  "column.incident": "Incident",
  "column.element": "Element",
  "column.message": "Message",
  "column.since": "Since",
  "diagram.facts": "{engine} · v{version}, the latest version",
  "diagram.notDeployed":
    "{process} is not deployed on {engine}, or you may not have permission to see it.",
  "diagram.notRead": "The diagram was not read from {engine}.",
  "diagram.open": "Open process",
  "diagram.openTitle": "Open {process} on {engine}",
  "diagram.label": "Diagram of {process} on {engine}",
  "refused.reason": "Pulse reads nothing for this widget until you fix it.",
  "refused.problems": "Problems of this widget",
  "refused.openFile": "Open file",
  "refused.openFileTitle": "Open the board file",
  "problem.notJson": "is not valid JSON",
  "problem.notAnObject": "must be an object",
  "problem.notAList": "must be a list",
  "problem.missing": "is missing",
  "problem.ignoredKey":
    "is not a key this version of Pulse knows; Pulse shows the board without it",
  "problem.schemaNotText":
    "must be a text, the path or URL of the board schema; Pulse shows the board without it",
  "problem.blankText": "must be a text that is not empty",
  "problem.engineNames": "must be a list of different engine names that is not empty",
  "problem.tenantIds": "must be a list of different tenant ids that is not empty",
  "problem.diagramOnOneEngine":
    "must name one engine, because a diagram shows the deployment of one engine",
  "problem.notWholeNumber": "must be a whole number of 0 or more",
  "problem.noColumns": "must name at least one column",
  "problem.notBoolean": "must be true or false",
  "problem.elementWithoutProcess":
    "needs a process: element ids are only unique within one process",
  "problem.elementOnEnded": 'only matches running instances; remove it or use state "running"',
  "problem.endedWithIncident":
    'only matches running instances, since an ended instance has no open incident; remove it or use state "running"',
  "problem.tenantsNotRead":
    "is set, but Pulse has no tenant filter and would read every tenant here; remove tenants to show this widget",
  "problem.diagramTooLong":
    "may show no count on a collapsed subprocess for what runs inside it, because the diagram is longer than Pulse reads",
  "note.tile": '"{title}" on {engine}',
  "problem.unknownKey": "is not a known key; use {choices}",
  "problem.notOneOf": "must be one of {choices}",
  "problem.variableColumn": "cannot show a variable; must be one of {choices}",
  "problem.unknownVersion": "is {found}; this version of Pulse reads version {reads}",
  "problem.engineOutsideBoard": ({ engines, count }) =>
    `may only name engines of the board; ${String(engines)} ${isOne(count) ? "is" : "are"} not in its engines`,
  "problem.tooManyWidgets":
    "is widget {position}; a board shows at most {max}, so it stays cheap for the engines",
} satisfies Readonly<Record<string, Message>>

/** The key of a word of the blocks. */
export type WordKey = keyof typeof en
