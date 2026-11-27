import {
  BpmnProcessId,
  ElementId,
  type CalledProcess,
  type CallingVersion,
  type TenantId,
} from "@miragon/pulse-engine-core"
import { BpmnText, type CallActivityText } from "../mapping/bpmn-text.js"
import { DefinitionRefs } from "../mapping/definition-refs.js"
import { Tenants } from "../mapping/tenants.js"
import type { CamundaClient, DefinitionView } from "../rest/index.js"
import type { Diagrams } from "./diagrams.js"

const FEEL = "="
const LATEST = "latest"

interface ProcessCall extends CallActivityText {
  readonly processId: string
}

export class CalledProcessReader {
  constructor(
    private readonly client: CamundaClient,
    private readonly diagrams: Diagrams,
  ) {}

  async read({ id: definitionId, tenantId }: CallingVersion): Promise<CalledProcess[]> {
    const xml = await this.diagrams.xml(definitionId)
    if (xml === undefined) {
      return []
    }
    const calls = BpmnText.callActivities(xml).filter(
      (call): call is ProcessCall =>
        call.processId !== undefined && !call.processId.startsWith(FEEL),
    )
    const latest = await this.client.latestOf(CalledProcessReader.boundToTheLatest(calls))
    const inTenant = latest.filter((definition) => Tenants.same(definition.tenantId, tenantId))
    return Promise.all(calls.map((call) => this.calledBy(call, inTenant, tenantId)))
  }

  private static boundToTheLatest(calls: readonly ProcessCall[]): readonly string[] {
    const latest = calls.filter((call) => call.binding === LATEST)
    return [...new Set(latest.map((call) => call.processId))]
  }

  private async calledBy(
    call: ProcessCall,
    latest: readonly DefinitionView[],
    tenantId: TenantId | null,
  ): Promise<CalledProcess> {
    const definition = await this.definitionStartedBy(call, latest, tenantId)
    return {
      elementId: ElementId(call.elementId),
      bpmnProcessId: BpmnProcessId(call.processId),
      tenantId,
      ...(definition === undefined ? {} : { definition: DefinitionRefs.of(definition) }),
    }
  }

  private async definitionStartedBy(
    call: ProcessCall,
    latest: readonly DefinitionView[],
    tenantId: TenantId | null,
  ): Promise<DefinitionView | undefined> {
    if (call.binding === LATEST) {
      return latest
        .filter((definition) => definition.bpmnProcessId === call.processId)
        .toSorted((left, right) => right.version - left.version)[0]
    }
    if (call.binding !== "versionTag" || call.versionTag === undefined) {
      return undefined
    }
    const versions = await this.client.versionsOf(call.processId)
    return versions.find(
      (definition) =>
        definition.versionTag === call.versionTag && Tenants.same(definition.tenantId, tenantId),
    )
  }
}
