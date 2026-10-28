import { Present } from "../present.js"
import type { JsonObject } from "../views/json-object.js"

export interface ActivityNode {
  readonly id: string
  readonly activityId: string
  readonly activityName?: string
  readonly activityType?: string
  readonly processInstanceId: string
  readonly depth: number
  readonly root: boolean
  readonly leaf: boolean
  readonly transition: boolean
  readonly executionIds: readonly string[]
}

interface Position {
  readonly processInstanceId: string
  readonly depth: number
}

export class ActivityIndex {
  readonly nodes: ActivityNode[] = []

  constructor(trees: readonly JsonObject[]) {
    for (const tree of trees) {
      const processInstanceId =
        tree.optionalString("processInstanceId") ?? tree.requiredString("id")
      this.walk(tree, { processInstanceId, depth: 0 })
    }
  }

  byId(id: string | undefined): ActivityNode | undefined {
    return this.nodes.find((node) => id !== undefined && node.id === id)
  }

  forExecution(executionId: string | undefined, activityId?: string): ActivityNode | undefined {
    return this.best(this.containing(executionId, false), activityId)
  }

  transition(executionId: string | undefined, activityId?: string): ActivityNode | undefined {
    return this.best(this.containing(executionId, true), activityId)
  }

  static compare(left: string, right: string): number {
    if (left === right) {
      return 0
    }
    return left < right ? -1 : 1
  }

  private walk(instance: JsonObject, position: Position): void {
    const children = instance.optionalList("childActivityInstances")
    const transitions = instance.optionalList("childTransitionInstances")
    this.nodes.push({
      ...this.nodeOf(instance, position),
      root: position.depth === 0,
      leaf: children.length === 0 && transitions.length === 0,
      transition: false,
      executionIds: instance.optionalStrings("executionIds") ?? [],
    })
    const below = { ...position, depth: position.depth + 1 }
    for (const child of children) {
      this.walk(child, below)
    }
    for (const transition of transitions) {
      const executionId = transition.optionalString("executionId")
      this.nodes.push({
        ...this.nodeOf(transition, below),
        root: false,
        leaf: false,
        transition: true,
        executionIds: executionId === undefined ? [] : [executionId],
      })
    }
  }

  private nodeOf(instance: JsonObject, position: Position) {
    return {
      id: instance.requiredString("id"),
      activityId: instance.requiredString("activityId"),
      ...Present.fields({
        activityName: instance.optionalString("activityName") ?? instance.optionalString("name"),
        activityType: instance.optionalString("activityType"),
      }),
      ...position,
    }
  }

  private containing(executionId: string | undefined, transition: boolean): ActivityNode[] {
    return this.nodes.filter(
      (node) =>
        executionId !== undefined &&
        node.transition === transition &&
        node.executionIds.includes(executionId),
    )
  }

  private best(candidates: ActivityNode[], activityId: string | undefined) {
    const matching = candidates.filter((candidate) => candidate.activityId === activityId)
    return (matching.length > 0 ? matching : candidates).sort(
      (left, right) => right.depth - left.depth || ActivityIndex.compare(left.id, right.id),
    )[0]
  }
}
