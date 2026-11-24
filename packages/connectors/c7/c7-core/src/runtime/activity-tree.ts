/**
 * The activity instance tree of a running instance (`GET /process-instance/{id}/activity-instances`),
 * read through `JsonView`: each scope with the activity it runs, the scopes below it and its
 * transition instances, the tokens that wait for an asynchronous continuation. A move reads the
 * one token it cancels from it. None for an instance the engine does not know or that ended
 * meanwhile, or for an id no engine assigns, without a request.
 */

import type { EnginePort } from "../port.js"
import { isEngineId } from "./engine-ids.js"
import { findUnlessGone } from "./find-unless-gone.js"
import { JsonView } from "../json-view.js"

/** A token that waits before or after an activity of a scope, an asynchronous continuation. */
export interface TransitionInstanceRow {
  readonly id: string
  readonly activityId: string
}

/** A scope of the tree: the activity it runs, the scopes below it and its transition instances. */
export interface ActivityInstanceRow {
  readonly id: string
  readonly activityId: string
  readonly childActivityInstances: readonly ActivityInstanceRow[]
  readonly childTransitionInstances: readonly TransitionInstanceRow[]
}

function transitionOf(record: JsonView): TransitionInstanceRow {
  return { id: record.requiredString("id"), activityId: record.requiredString("activityId") }
}

function scopeOf(record: JsonView): ActivityInstanceRow {
  return {
    id: record.requiredString("id"),
    activityId: record.requiredString("activityId"),
    childActivityInstances: record
      .optionalList("childActivityInstances")
      .map((child) => scopeOf(child)),
    childTransitionInstances: record
      .optionalList("childTransitionInstances")
      .map((child) => transitionOf(child)),
  }
}

function treeOf(answer: unknown): ActivityInstanceRow {
  return scopeOf(JsonView.of(answer, "activity instance"))
}

/** The activity instance tree of `instanceId`; undefined when the instance does not run. */
export async function findActivityTree(
  port: EnginePort,
  instanceId: string,
): Promise<ActivityInstanceRow | undefined> {
  if (!isEngineId(instanceId)) {
    return undefined
  }
  const input = { pathArgs: [instanceId], query: {} }
  return await findUnlessGone(port, "getActivityInstanceTree", input, treeOf)
}
