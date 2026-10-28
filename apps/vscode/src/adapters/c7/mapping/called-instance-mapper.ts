import {
  BpmnProcessId,
  ElementId,
  InstanceId,
  type CalledInstance,
} from "../../../contract/index.js"
import { Present, type CallView, type ChildInstanceView } from "../engine-rest/index.js"
import { InstanceStates } from "./instance-states.js"
import type { Mapper } from "./mapper.js"

export interface CalledFacts {
  readonly child: ChildInstanceView
  readonly calls: readonly CallView[]
}

export class CalledInstanceMapper implements Mapper<CalledFacts, CalledInstance> {
  map({ child, calls }: CalledFacts): CalledInstance {
    const call = calls.find((candidate) => candidate.calledProcessInstanceId === child.id)
    return {
      id: InstanceId(child.id),
      parentInstanceId: InstanceId(child.parentId),
      bpmnProcessId: BpmnProcessId(child.key),
      state: InstanceStates.of(child.state),
      ...Present.fields({
        calledFromElementId: call === undefined ? undefined : ElementId(call.activityId),
      }),
    }
  }
}
