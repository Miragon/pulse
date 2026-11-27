/**
 * The multi-instance body: the one rule of the Camunda 7 REST family for the scope a
 * multi-instance activity runs its items in. Camunda 7 names that scope by the activity's id with
 * the suffix `#multiInstanceBody` wherever it reports one (a row of the activity statistics, an
 * incident, a job, an activity instance, the scope of a variable, a migration instruction), while
 * the diagram names the activity alone, as Camunda 8 reports it. The statistics count the body
 * only while its own token waits there (its asynchronous continuation, a failed job of its own),
 * never beside the items it runs, so the body's counts and its items' add up on the element. Every
 * surface that reads such an id onto a diagram (the contract's counts, the engine module's views,
 * a variable's scope, the CLI's `--until` check) reads it with `elementOfActivity`, and a write
 * that tells a body from its items (the C7 adapter's move) with `multiInstanceBodyOf`. Pure.
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
