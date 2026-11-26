import type { CalledProcess, InstanceDetail } from "@miragon/pulse-engine-core"
import type { CalledInstanceChoice, CallLinkModel, CallTarget } from "./instance-screen-model.js"
import { InstanceTree } from "./instance-tree.js"

export class CallLinks {
  private constructor(
    private readonly calledProcesses: readonly CalledProcess[],
    private readonly tree: InstanceTree | undefined,
  ) {}

  static of(calledProcesses: readonly CalledProcess[], detail?: InstanceDetail): CallLinks {
    return new CallLinks(
      calledProcesses,
      detail === undefined ? undefined : new InstanceTree(detail),
    )
  }

  target(elementId: string): CallTarget | undefined {
    return this.targets().get(elementId)
  }

  links(): CallLinkModel[] {
    return [...this.targets()].map(([elementId, target]) => ({ elementId, target }))
  }

  private targets(): Map<string, CallTarget> {
    const targets = new Map<string, CallTarget>()
    for (const called of this.calledProcesses) {
      targets.set(called.elementId, CallLinks.processTarget(called))
    }
    for (const [elementId, choices] of this.choices()) {
      targets.set(elementId, { kind: "instances", choices })
    }
    return targets
  }

  private static processTarget(called: CalledProcess): CallTarget {
    return called.definition === undefined
      ? { kind: "missing", bpmnProcessId: called.bpmnProcessId }
      : { kind: "definition", definition: called.definition }
  }

  private choices(): Map<string, CalledInstanceChoice[]> {
    const choices = new Map<string, CalledInstanceChoice[]>()
    if (this.tree === undefined) {
      return choices
    }
    const failing = this.tree.withIncident()
    for (const instance of this.tree.directChildren()) {
      const elementId = instance.calledFromElementId
      if (elementId !== undefined) {
        const choice = { instance, withIncident: failing.has(instance.id) }
        choices.set(elementId, [...(choices.get(elementId) ?? []), choice])
      }
    }
    for (const group of choices.values()) {
      group.sort((left, right) => Number(right.withIncident) - Number(left.withIncident))
    }
    return choices
  }
}
