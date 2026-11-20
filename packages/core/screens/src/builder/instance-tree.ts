import type {
  CalledInstance,
  ElementId,
  InstanceDetail,
  InstanceId,
} from "@miragon/pulse-engine-core"
import type { CalledInstanceRef } from "./instance-screen-model.js"

export class InstanceTree {
  constructor(private readonly detail: InstanceDetail) {}

  isRoot(instanceId: InstanceId): boolean {
    return instanceId === this.detail.instance.id
  }

  liesIn(instanceId: InstanceId): CalledInstanceRef | undefined {
    if (this.isRoot(instanceId)) {
      return undefined
    }
    const called = this.calledInstance(instanceId)
    return called === undefined
      ? { instanceId }
      : { instanceId, bpmnProcessId: called.bpmnProcessId }
  }

  locate(instanceId: InstanceId, elementId: ElementId): ElementId | undefined {
    return this.isRoot(instanceId) ? elementId : this.directChildOf(instanceId)?.calledFromElementId
  }

  directChildren(): CalledInstance[] {
    return this.detail.calledInstances.filter(
      (called) => called.parentInstanceId === this.detail.instance.id,
    )
  }

  withIncident(): ReadonlySet<InstanceId> {
    const parents = new Map(
      this.detail.calledInstances.map((called) => [called.id, called.parentInstanceId]),
    )
    const failing = new Set<InstanceId>()
    for (const incident of this.detail.incidents) {
      for (
        let id: InstanceId | undefined = incident.instanceId;
        id !== undefined && !failing.has(id);
      ) {
        failing.add(id)
        id = parents.get(id)
      }
    }
    return failing
  }

  private directChildOf(instanceId: InstanceId): CalledInstance | undefined {
    const seen = new Set<InstanceId>()
    let current = this.calledInstance(instanceId)
    while (current !== undefined && !this.isRoot(current.parentInstanceId)) {
      if (seen.has(current.id)) {
        return undefined
      }
      seen.add(current.id)
      current = this.calledInstance(current.parentInstanceId)
    }
    return current
  }

  private calledInstance(instanceId: InstanceId): CalledInstance | undefined {
    return this.detail.calledInstances.find((called) => called.id === instanceId)
  }
}
