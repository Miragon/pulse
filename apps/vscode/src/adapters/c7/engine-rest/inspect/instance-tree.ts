import type { EngineHttp } from "../http/engine-http.js"
import { JsonObject } from "../views/json-object.js"
import { ParallelReads } from "./parallel-reads.js"

export interface TreeNode {
  readonly id: string
  readonly parentId: string | undefined
  readonly definitionId: string
  readonly key: string
  readonly suspended: boolean
  readonly depth: number
}

export interface LoadedTree {
  readonly nodes: readonly TreeNode[]
  readonly truncated: boolean
}

const MAX_DEPTH = 10
const MAX_INSTANCES = 100

export class InstanceTree {
  constructor(private readonly http: EngineHttp) {}

  async below(root: JsonObject): Promise<LoadedTree> {
    const nodes = [InstanceTree.nodeOf(root, undefined, 0)]
    let level = nodes
    for (let depth = 1; level.length > 0; depth++) {
      const children = (
        await ParallelReads.map(level, (parent) => this.childrenOf(parent, depth))
      ).flat()
      const room = depth > MAX_DEPTH ? 0 : MAX_INSTANCES - nodes.length
      if (children.length > room) {
        return { nodes: [...nodes, ...children.slice(0, room)], truncated: true }
      }
      nodes.push(...children)
      level = children
    }
    return { nodes, truncated: false }
  }

  private async childrenOf(parent: TreeNode, depth: number): Promise<TreeNode[]> {
    const answer = await this.http.read("/process-instance", {
      superProcessInstance: parent.id,
      maxResults: String(MAX_INSTANCES + 1),
    })
    return JsonObject.listOf(answer, "called instances").map((child) =>
      InstanceTree.nodeOf(child, parent.id, depth),
    )
  }

  private static nodeOf(record: JsonObject, parentId: string | undefined, depth: number) {
    const definitionId = record.requiredString("definitionId")
    return {
      id: record.requiredString("id"),
      parentId,
      definitionId,
      key: record.optionalString("definitionKey") ?? definitionId.split(":")[0] ?? definitionId,
      suspended: record.value("suspended") === true,
      depth,
    }
  }
}
