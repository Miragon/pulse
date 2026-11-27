/**
 * The multi-instance body: the one rule of the Camunda 7 REST family for the scope a
 * multi-instance activity runs its items in. Camunda 7 names that scope by the activity's id with
 * the suffix `#multiInstanceBody` wherever it reports one (a row of the activity statistics, an
 * incident, a job, an activity instance, the scope of a variable, a migration instruction), while
 * the diagram names the activity alone, as Camunda 8 reports it. The statistics count the body
 * only while its own token waits there (its asynchronous continuation, a failed job of its own),
 * never beside the items it runs, so the body's counts and its items' add up on the element.
 *
 * The rule: a count, a group or a badge of an element, and the contract's `elementId` (the element
 * counts, the incident search, a variable's scope), put the body on its element with
 * `elementOfActivity`, as the CLI's `--until` check does (the throughput counts the items' passes
 * alone); a row or a cause the engine module keys on the engine's id, of one failure (an incident,
 * a job, a copy's root) or of a cluster read and fixed by that id (the incidents dashboard rows,
 * the health causes, the cluster detail), keeps the body's own id and is named by its element. A
 * read or a write that needs the body's own id (an element's page of incidents, the C7 adapter's
 * move) names it with `multiInstanceBodyOf`. An instance's detail puts its wait states and root
 * incidents on the element too (the contract's `elementId` there), so its screens mark and name
 * them there, while each root incident's cause keeps the body's own id. Outside the rule, an
 * instance's path keeps the body's run under its own id beside its items' runs, which name the
 * element, since the editors' move rules count an element's unfinished runs as its tokens, and an
 * incident's own element in its detail names and marks the body by its own id, which the diagram
 * does not draw. Pure.
 */

/** What follows the activity's id in the id of its multi-instance body. */
const BODY_SUFFIX = "#multiInstanceBody"

/** Whether `activityId` names the multi-instance body of an activity, not the activity itself. */
export function isMultiInstanceBody(activityId: string): boolean {
  return activityId.endsWith(BODY_SUFFIX)
}

/**
 * The diagram's element `activityId` stands for: the activity a multi-instance body repeats, else
 * the id as it is.
 */
export function elementOfActivity(activityId: string): string {
  return isMultiInstanceBody(activityId) ? activityId.slice(0, -BODY_SUFFIX.length) : activityId
}

/** The id Camunda 7 gives the multi-instance body of the element `elementId`. */
export function multiInstanceBodyOf(elementId: string): string {
  return `${elementId}${BODY_SUFFIX}`
}
