import type {
  IncidentDetails,
  IncidentId,
  InstanceDetail,
  InstanceId,
} from "../../contract/index.js"
import { InstanceViewBuilder } from "../views/instance-view-builder.js"
import { Labels } from "../views/labels.js"
import { ModelFactsView } from "../views/model-facts-view.js"
import type { CallJumps } from "./call-jumps.js"
import type { LoadedInstance } from "./instance-writes.js"
import type { ModelLinks } from "./model-links.js"
import type { PanelContext } from "./panel-context.js"
import { Problems } from "./problems.js"
import type { Unavailable } from "./view-session.js"

export interface InstanceParts {
  readonly jumps: CallJumps
  readonly links: ModelLinks
}

type LocalParts = Pick<LoadedInstance, "calledProcesses" | "modelLinks" | "model">

interface Reading extends LocalParts {
  readonly asOf: Date
  readonly detail: InstanceDetail
  readonly diagramXml: string
  readonly fullDetails: ReadonlyMap<IncidentId, IncidentDetails>
}

const NO_DETAILS: ReadonlyMap<IncidentId, IncidentDetails> = new Map()

const SETTLED_STATES: ReadonlySet<string> = new Set(["completed", "terminated"])

export class InstanceReads {
  constructor(
    private readonly context: PanelContext,
    private readonly instanceId: InstanceId,
    private readonly parts: InstanceParts,
  ) {}

  static hasEnded(loaded: LoadedInstance | undefined): boolean {
    return loaded !== undefined && SETTLED_STATES.has(loaded.detail.instance.state)
  }

  async load(): Promise<LoadedInstance | Unavailable> {
    const asOf = this.context.now()
    const detail = await this.context.runtime.getInstanceDetail(this.instanceId)
    if (detail === undefined) {
      return this.notFound()
    }
    const definition = detail.instance.definition
    const [diagramXml, fullDetails, calledProcesses, modelLinks, model] = await Promise.all([
      this.context.diagrams.get(definition.id),
      this.completeDetailsOfFirstIncident(detail),
      this.parts.jumps.calledProcessesOf(definition.id),
      this.parts.links.ofIncidents(detail.incidents),
      this.parts.links.modelOf(definition.bpmnProcessId),
    ])
    return this.assemble({
      asOf,
      detail,
      diagramXml,
      fullDetails,
      calledProcesses,
      modelLinks,
      model,
    })
  }

  async refresh(loaded: LoadedInstance): Promise<LoadedInstance | Unavailable> {
    const asOf = this.context.now()
    const detail = await this.context.runtime.getInstanceDetail(this.instanceId)
    if (detail === undefined) {
      return this.notFound()
    }
    const same = this.sameIncidents(loaded.detail, detail)
    const [diagramXml, fullDetails, modelLinks] = await Promise.all([
      this.context.diagrams.get(detail.instance.definition.id),
      same ? loaded.fullDetails : this.completeDetailsOfFirstIncident(detail),
      same ? loaded.modelLinks : this.parts.links.ofIncidents(detail.incidents),
    ])
    return this.assemble({ ...loaded, asOf, detail, diagramXml, fullDetails, modelLinks })
  }

  private assemble(reading: Reading): LoadedInstance {
    const view = new InstanceViewBuilder({
      engine: this.context.engine,
      asOf: reading.asOf,
      detail: reading.detail,
      diagramXml: reading.diagramXml,
      calledProcesses: reading.calledProcesses,
      fullDetails: reading.fullDetails,
      writable: this.context.commands !== undefined,
      modelLinks: reading.modelLinks,
    }).build()
    const model = reading.model
    return {
      detail: reading.detail,
      calledProcesses: reading.calledProcesses,
      modelLinks: reading.modelLinks,
      model,
      fullDetails: reading.fullDetails,
      view:
        model === undefined
          ? view
          : { ...view, model: ModelFactsView.fileOf(model, reading.diagramXml, undefined) },
    }
  }

  private sameIncidents(before: InstanceDetail, after: InstanceDetail): boolean {
    const ids = (detail: InstanceDetail) => detail.incidents.map((incident) => incident.id).join()
    return ids(before) === ids(after)
  }

  private async completeDetailsOfFirstIncident(
    detail: InstanceDetail,
  ): Promise<ReadonlyMap<IncidentId, IncidentDetails>> {
    const first = detail.incidents[0]
    if (first?.details?.truncated !== true) {
      return NO_DETAILS
    }
    const details = await this.context.runtime.getIncidentDetails(first.id)
    return details === undefined ? NO_DETAILS : new Map([[first.id, details]])
  }

  private notFound(): Unavailable {
    return { problem: Problems.notFound(`The instance ${Labels.shortId(this.instanceId)}`) }
  }
}
