import type { InstanceDetail } from "@miragon/pulse-engine-core"
import type { WaitRowModel } from "./instance-screen-model.js"
import type { InstanceTree } from "./instance-tree.js"

export class WaitRows {
  static of(detail: InstanceDetail, tree: InstanceTree): WaitRowModel[] {
    return detail.waitStates.map((wait) => ({ wait, liesIn: tree.liesIn(wait.instanceId) }))
  }
}
