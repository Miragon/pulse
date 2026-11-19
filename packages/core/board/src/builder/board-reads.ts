import type { ProcessRuntime } from "@miragon/pulse-engine-core"

export type BoardReads = Pick<
  ProcessRuntime,
  | "describeEngine"
  | "listDefinitions"
  | "countInstances"
  | "searchInstances"
  | "getDiagramXml"
  | "getElementStatistics"
  | "searchIncidents"
>

export interface EngineSource {
  readonly name: string
  readonly reads?: BoardReads
}
