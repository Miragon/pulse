import { countOf, isOne, type Message } from "./message.js"

/** "1 instance still runs", "3 instances still run": the verb follows the count. */
function stillRun(running: unknown): string {
  return isOne(running)
    ? `${String(running)} instance still runs on older versions`
    : `${String(running)} instances still run on older versions`
}

/**
 * The English words of a process's blocks: its version picker, the notice that older versions
 * still run, the filter bar of its instance list with the variable condition dialog, the instance
 * table, the badges and call buttons on its diagram and their legend. They are the words of the
 * definition view of Pulse for VS Code and Pulse for Orca, letter for letter. Every key has its
 * German entry in `process-de.ts`.
 */
export const processEn = {
  "version.label": "Version",
  "version.option": "v{version} · {running} running",
  "version.optionWithIncident": "v{version} · {running} running · {withIncident} with incident",
  "older.title": ({ running }) => `${stillRun(running)}.`,
  "older.titleWithIncident": ({ running, withIncident }) =>
    `${stillRun(running)}, ${String(withIncident)} of them with incident.`,
  "older.show": "Show v{version}",
  "scopes.label": "Show instances",
  "scope.running": "Running",
  "scope.withIncident": "With incident",
  "scope.ended": "Ended",
  "scope.all": "All",
  "element.prefix": "At",
  "element.clear": "Clear element filter",
  "businessKey.search": "Search by business key",
  "businessKey.placeholder": "Business key",
  "variables.filter": "Filter by variables",
  "variables.filterCount": ({ count }) =>
    `Filter by variables, ${countOf(count, "condition", "conditions")}`,
  "condition.edit": "Edit condition {label}",
  "condition.remove": "Remove condition {label}",
  "dialog.add": "Filter by variable",
  "dialog.edit": "Edit variable condition",
  "dialog.description": "An instance matches when all conditions hold.",
  "dialog.name": "Name",
  "dialog.nameHint": "Names are case sensitive.",
  "dialog.compareAs": "Compare as",
  "dialog.compareAsHint": "JSON and object variables can't be searched.",
  "dialog.operator": "Operator",
  "dialog.value": "Value",
  "dialog.autoHint":
    "Automatic compares 42 as a number, true as true or false and anything else as text.",
  "dialog.likeHint": "Use * as a wildcard, for example ORD-*",
  "dialog.cancel": "Cancel",
  "dialog.apply": "Apply",
  "compareAs.auto": "Automatic",
  "compareAs.text": "Text",
  "compareAs.number": "Number",
  "compareAs.boolean": "True or false",
  "compareAs.date": "Date and time",
  "compareAs.null": "Null",
  "operator.equals": "is",
  "operator.notEquals": "is not",
  "operator.like": "matches",
  "operator.greaterThan": "is greater than",
  "operator.lessThan": "is less than",
  "operator.date.greaterThan": "is after",
  "operator.date.lessThan": "is before",
  "operator.null.equals": "is null",
  "operator.null.notEquals": "is not null",
  "error.name": "Enter a variable name.",
  "error.number": "Enter a number, for example 42 or 9.5.",
  "error.date": "Pick a date and time.",
  "error.count": ({ max }) => `Use ${countOf(max, "condition", "conditions")} or fewer.`,
  "refused.date": "This engine can't compare dates.",
  "refused.ordering": "This engine can't search for greater or less than.",
  "instances.label": "Instances",
  "column.id": "ID",
  "column.businessKey": "Business key",
  "column.state": "State",
  "column.started": "Started",
  "instance.row": "Instance {name}",
  "instance.id": "instance ID",
  "incident.flag": "Incident",
  "incident.flagTitle": "Has an open incident",
  "instances.noMatch": "No instances match this filter.",
  "instances.noVariableMatch.running":
    "No running instances match these variable conditions. An engine that keeps no variable history finds none.",
  "instances.noVariableMatch.withIncident":
    "No instances with an incident match these variable conditions. An engine that keeps no variable history finds none.",
  "instances.noVariableMatch.ended":
    "No ended instances match these variable conditions. An engine that keeps no variable history finds none.",
  "instances.noVariableMatch.all":
    "No instances match these variable conditions. An engine that keeps no variable history finds none.",
  "instances.clearVariables": "Clear variable conditions",
  "more.load": "Load more",
  "more.wait": "Wait until the refresh is done",
  "badge.running": ({ element, count }) =>
    `${String(element)}: ${countOf(count, "instance", "instances")} running. Show the running instances here.`,
  "badge.incidents": ({ element, count }) =>
    `${String(element)}: ${countOf(count, "incident", "incidents")}. Show the instances with an incident here.`,
  "badge.incidentsInCalledInstances": ({ element, count }) =>
    `${String(element)}: ${countOf(count, "incident", "incidents")} in called instances. Show the instances with an incident here.`,
  "badge.named": "{shown}, {description}",
  "legend.label": "Legend",
  "legend.scope": "Badges count running instances of v{version}.",
  "legend.running": "waiting here",
  "legend.incidents": "incident here",
  "legend.incidentsInCalledInstances": "incident in a called instance",
  "call.definition": "Open called process {name}",
  "call.instance": "Open called instance {process} {id}",
  "call.instances": "Choose one of {count} called instances",
  "call.missing": "{process} isn't deployed on {engine}, or you may not have permission to see it",
} satisfies Readonly<Record<string, Message>>

/** The key of a word of a process's blocks. */
export type ProcessWordKey = keyof typeof processEn
