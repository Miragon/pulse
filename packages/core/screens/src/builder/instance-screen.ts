import type {
  IncidentDetails,
  IncidentId,
  InstanceId,
  InstanceSummary,
} from "@miragon/pulse-engine-core"
import type { InstanceReadCode } from "../format/instance-screen-data.js"
import { CallLinks } from "./call-links.js"
import { Headline } from "./headline.js"
import { IncidentCards } from "./incident-cards.js"
import { InstanceMarkers } from "./instance-markers.js"
import type {
  CallerModel,
  InstanceFacts,
  InstanceScreenModel,
  InstanceScreenReads,
} from "./instance-screen-model.js"
import { InstanceTree } from "./instance-tree.js"
import { PathRows } from "./path-rows.js"
import { WaitRows } from "./wait-rows.js"

const NO_DETAILS: ReadonlyMap<IncidentId, IncidentDetails> = new Map()

export class InstanceScreen {
  static async read(
    engine: string,
    instanceId: InstanceId,
    reads: InstanceScreenReads,
    now: () => Date,
  ): Promise<InstanceScreenModel | undefined> {
    const asOf = now()
    const detail = await reads.getInstanceDetail(instanceId)
    if (detail === undefined) {
      return undefined
    }
    const { definition, parentInstanceId } = detail.instance
    const [diagramXml, calledProcesses, caller] = await Promise.all([
      reads.getDiagramXml(definition.id).catch(() => undefined),
      reads.getCalledProcesses(definition.id).catch(() => undefined),
      InstanceScreen.callerOf(reads, parentInstanceId),
    ])
    return InstanceScreen.of({ engine, asOf, detail, diagramXml, calledProcesses, caller })
  }

  static of(facts: InstanceFacts): InstanceScreenModel {
    const { detail } = facts
    const tree = new InstanceTree(detail)
    const incidents = new IncidentCards(detail, tree, facts.fullDetails ?? NO_DETAILS).cards()
    const caller = InstanceScreen.callerModel(detail.instance, facts.caller)
    return {
      engine: facts.engine,
      asOf: facts.asOf,
      instance: detail.instance,
      caller,
      headline: Headline.of(detail.instance, incidents, tree),
      markers: InstanceMarkers.of(detail, tree, facts.diagramXml),
      calls: CallLinks.of(facts.calledProcesses ?? [], detail).links(),
      incidents,
      waits: WaitRows.of(detail, tree),
      path: PathRows.of(detail),
      variables: detail.variables,
      truncated: detail.truncated,
      unread: InstanceScreen.unread(facts, caller),
    }
  }

  private static async callerOf(
    reads: InstanceScreenReads,
    parentId: InstanceId | undefined,
  ): Promise<InstanceSummary | null | undefined> {
    if (parentId === undefined) {
      return undefined
    }
    const page = await reads
      .searchInstances({ instanceIds: [parentId] }, { limit: 1 })
      .catch(() => undefined)
    return page?.items[0] ?? null
  }

  private static callerModel(
    instance: InstanceSummary,
    caller: InstanceSummary | null | undefined,
  ): CallerModel | undefined {
    const instanceId = instance.parentInstanceId
    if (instanceId === undefined) {
      return undefined
    }
    const read = caller !== undefined
    return { instanceId, read, found: caller?.id === instanceId ? caller : undefined }
  }

  private static unread(facts: InstanceFacts, caller: CallerModel | undefined): InstanceReadCode[] {
    const callerUnread = caller?.read === true && caller.found === undefined
    return [
      ...(facts.diagramXml === undefined ? (["diagram"] as const) : []),
      ...(facts.calledProcesses === undefined ? (["calledProcesses"] as const) : []),
      ...(callerUnread ? (["caller"] as const) : []),
    ]
  }
}
