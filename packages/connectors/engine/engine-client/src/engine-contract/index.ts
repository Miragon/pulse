/**
 * The engine contract's SDK-bound half: the reads whose REST contract differs from the client
 * defaults (text-only endpoints, raw variable reads, the batch fallback) and the batch status.
 * The pure rules (dates, filters, sorting, variable writes, incident recovery) live in
 * `@miragon/pulse-engine-core`; this package stays a leaf and does not import it. The engine
 * module's tools (`tools/`) and widget feeds (`data/`) take both from there (CLAUDE.md
 * invariant 7).
 */
export {
  endedBatchReport,
  queuedBatch,
  runningBatchReport,
  type BatchReport,
  type BatchStatus,
  type QueuedBatch,
} from "./batches.js"
export {
  fetchExternalTaskErrorDetails,
  fetchJobStacktrace,
  readBatch,
  readProcessInstanceVariables,
  readTaskVariables,
  type VariableMap,
} from "./reads.js"
