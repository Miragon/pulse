/**
 * A called instance of an instance's detail as the engine contract's `CalledInstance`: a child of
 * the inspected tree with its process and state, and the call activity of the parent's path that
 * started it, when the path names one. Pure.
 */

import {
  BpmnProcessId,
  type CalledInstance,
  ElementId,
  InstanceId,
} from "@miragon/pulse-engine-core"
import type { ChildView, TimelineEntry } from "../types.js"
import { compact } from "../util.js"
import { tenantIdOf } from "./definition-refs.js"
import { instanceStateOf } from "./instance-states.js"

/** `child` as the contract's called instance, from the step of `path` that called it. */
export function calledInstanceOf(child: ChildView, path: readonly TimelineEntry[]): CalledInstance {
  const call = path.find((step) => step.calledProcessInstanceId === child.id)
  return {
    id: InstanceId(child.id),
    parentInstanceId: InstanceId(child.parentId),
    bpmnProcessId: BpmnProcessId(child.key),
    tenantId: tenantIdOf(child.tenantId),
    state: instanceStateOf(child.state),
    ...compact({
      calledFromElementId: call === undefined ? undefined : ElementId(call.activityId),
    }),
  }
}
