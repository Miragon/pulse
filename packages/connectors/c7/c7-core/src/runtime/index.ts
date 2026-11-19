/**
 * @miragon/pulse-c7-core/runtime: the reads of the engine contract (`ProcessRuntime` of
 * @miragon/pulse-engine-core) for a surface of the Camunda 7 REST family, over its `EnginePort`:
 * `C7Runtime` answers every one of them, a surface's wire failures in the surface's words, with
 * one reader per question (the engine, its processes, the counts on a diagram, the processes a
 * version calls, its instances and their count, a version's variable names, an instance's detail,
 * the open incidents and an incident's details, a bulk operation and its failures, a migration's
 * plan and its check). Beside it the reads a surface's commands check before they write (the
 * activity instance tree a move cancels a token of, the history's instances a migration still
 * finds running, a batch's statistics and history for a Stop), `JsonView`, the checked reads of an
 * engine answer, which fail an unusable one as `RuntimeError("unexpectedResponse")`, and the one
 * engine id rule (`isEngineId`). An entry of its own, so a bundle that answers no contract (the
 * CLI's) never carries it.
 */

export {
  type ActivityInstanceRow,
  findActivityTree,
  type TransitionInstanceRow,
} from "./activity-tree.js"
export {
  type BatchStatisticsRow,
  findHistoricBatch,
  type HistoricBatchRow,
  readBatchStatistics,
} from "./batches.js"
export { C7Runtime, type C7RuntimeOptions } from "./c7-runtime.js"
export { isEngineId } from "./engine-ids.js"
export {
  type HistoricInstanceQuery,
  type HistoricInstanceRow,
  readHistoricInstances,
} from "./historic-instances.js"
export { JsonView } from "./json-view.js"
export type { OffsetWindow } from "./offset-paging.js"
