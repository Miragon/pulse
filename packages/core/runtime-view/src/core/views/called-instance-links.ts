import type { InstanceDetail, InstanceId } from "../../contract/index.js"
import type { CalledInstanceLink } from "../protocol/index.js"
import { Labels } from "./labels.js"

export class CalledInstanceLinks {
  constructor(private readonly detail: InstanceDetail) {}

  linkTo(instanceId: InstanceId): CalledInstanceLink | undefined {
    if (instanceId === this.detail.instance.id) {
      return undefined
    }
    const called = this.detail.calledInstances.find((candidate) => candidate.id === instanceId)
    return {
      instanceId,
      shortId: Labels.shortId(instanceId),
      bpmnProcessId: called?.bpmnProcessId ?? "",
    }
  }
}
