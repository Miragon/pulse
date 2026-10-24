import type {
  BpmnProcessId,
  CalledInstance,
  CalledProcess,
  DefinitionRef,
  InstanceDetail,
  InstanceId,
} from "../../contract/index.js"

export interface CalledInstanceChoice {
  readonly instance: CalledInstance
  readonly withIncident: boolean
}

export type CallTarget =
  | { readonly kind: "instances"; readonly choices: readonly CalledInstanceChoice[] }
  | { readonly kind: "definition"; readonly definition: DefinitionRef }
  | { readonly kind: "missing"; readonly bpmnProcessId: BpmnProcessId }

export interface ElementCallTarget {
  readonly elementId: string
  readonly target: CallTarget
}

export class CallTargets {
  constructor(
    private readonly calledProcesses: readonly CalledProcess[],
    private readonly detail?: InstanceDetail,
  ) {}

  of(elementId: string): CallTarget | undefined {
    const choices = this.choicesAt(elementId)
    if (choices.length > 0) {
      return { kind: "instances", choices }
    }
    const called = this.calledProcesses.find((candidate) => candidate.elementId === elementId)
    if (called === undefined) {
      return undefined
    }
    return called.definition === undefined
      ? { kind: "missing", bpmnProcessId: called.bpmnProcessId }
      : { kind: "definition", definition: called.definition }
  }

  all(): ElementCallTarget[] {
    return this.elementIds().flatMap((elementId) => {
      const target = this.of(elementId)
      return target === undefined ? [] : [{ elementId, target }]
    })
  }

  private elementIds(): string[] {
    const calledFrom = this.directChildren().flatMap((child) =>
      child.calledFromElementId === undefined ? [] : [child.calledFromElementId],
    )
    return [...new Set([...this.calledProcesses.map((called) => called.elementId), ...calledFrom])]
  }

  private choicesAt(elementId: string): CalledInstanceChoice[] {
    const failing = this.instancesWithIncident()
    return this.directChildren()
      .filter((child) => child.calledFromElementId === elementId)
      .map((instance) => ({ instance, withIncident: failing.has(instance.id) }))
      .sort((left, right) => Number(right.withIncident) - Number(left.withIncident))
  }

  private directChildren(): readonly CalledInstance[] {
    const rootId = this.detail?.instance.id
    return (this.detail?.calledInstances ?? []).filter(
      (called) => called.parentInstanceId === rootId,
    )
  }

  private instancesWithIncident(): ReadonlySet<InstanceId> {
    const parents = new Map(
      (this.detail?.calledInstances ?? []).map((called) => [called.id, called.parentInstanceId]),
    )
    const failing = new Set<InstanceId>()
    for (const incident of this.detail?.incidents ?? []) {
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
}
