import type {
  CalledProcess,
  IncidentDetails,
  IncidentId,
  InstanceDetail,
} from "@miragon/pulse-engine-core"
import type { EngineCli } from "../../ports/index.js"
import type { ElementLinks } from "../panels/model-links.js"
import type { EngineBadge } from "../protocol/index.js"

export interface InstanceSnapshot {
  readonly engine: EngineBadge
  readonly asOf: Date
  readonly detail: InstanceDetail
  readonly diagramXml: string
  readonly calledProcesses: readonly CalledProcess[]
  readonly fullDetails: ReadonlyMap<IncidentId, IncidentDetails>
  readonly writable: boolean
  readonly modelLinks?: ElementLinks
  readonly cli?: EngineCli
}
