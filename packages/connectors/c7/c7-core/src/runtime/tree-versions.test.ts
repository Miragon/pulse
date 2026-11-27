import { describe, expect, it } from "vitest"
import type { TreeNode } from "../types.js"
import { treeVersionsOf } from "./tree-versions.js"

const ORDER = "order:1:d1"
const LABEL = "label:2:d2"

function node(id: string, definitionId: string, depth: number): TreeNode {
  return { id, definitionId, suspended: false, depth }
}

describe("treeVersionsOf", () => {
  it("names the version each running instance of the tree runs, as the runtime lists it", () => {
    const versions = treeVersionsOf({
      tree: [node("p1", ORDER, 0), node("c1", LABEL, 1), node("c2", LABEL, 1)],
      definitions: [
        { id: ORDER, key: "order", version: 1, name: "Order" },
        { id: LABEL, key: "label", version: 2, name: null },
      ],
    })

    const label = { id: LABEL, bpmnProcessId: "label", tenantId: null, version: 2 }
    expect(versions).toStrictEqual(
      new Map<string, unknown>([
        ["p1", { id: ORDER, bpmnProcessId: "order", tenantId: null, version: 1, name: "Order" }],
        ["c1", label],
        ["c2", label],
      ]),
    )
  })

  it("names none for an instance whose definition the runtime lists without a key or version, or not at all", () => {
    const versions = treeVersionsOf({
      tree: [node("p1", ORDER, 0), node("c1", LABEL, 1), node("c2", "gone:1:d3", 1)],
      definitions: [
        { id: ORDER, key: "order" },
        { id: LABEL, version: 2 },
      ],
    })

    expect(versions).toStrictEqual(new Map())
  })
})
