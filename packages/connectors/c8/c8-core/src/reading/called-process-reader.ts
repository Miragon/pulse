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
import { TaggedVersions } from "./tagged-versions.js"

const FEEL = "="
const LATEST = "latest"
const VERSION_TAG = "versionTag"

interface ProcessCall extends CallActivityText {
  readonly processId: string
}

interface CallTargets {
  readonly latest: readonly DefinitionView[]
  readonly tagged: TaggedVersions
  readonly tenantId: TenantId | null
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
    const targets: CallTargets = {
      latest: latest.filter((definition) => Tenants.same(definition.tenantId, tenantId)),
      tagged: new TaggedVersions(this.client),
      tenantId,
    }
    return Promise.all(calls.map((call) => this.calledBy(call, targets)))
  }

  private static boundToTheLatest(calls: readonly ProcessCall[]): readonly string[] {
    const latest = calls.filter((call) => call.binding === LATEST)
    return [...new Set(latest.map((call) => call.processId))]
  }

  private async calledBy(call: ProcessCall, targets: CallTargets): Promise<CalledProcess> {
    const definition = await CalledProcessReader.definitionStartedBy(call, targets)
    return {
      elementId: ElementId(call.elementId),
      bpmnProcessId: BpmnProcessId(call.processId),
      tenantId: targets.tenantId,
      ...(definition === undefined ? {} : { definition: DefinitionRefs.of(definition) }),
    }
  }

  private static async definitionStartedBy(
    call: ProcessCall,
    { latest, tagged, tenantId }: CallTargets,
  ): Promise<DefinitionView | undefined> {
    if (call.binding === LATEST) {
      return latest
        .filter((definition) => definition.bpmnProcessId === call.processId)
        .toSorted((left, right) => right.version - left.version)[0]
    }
    const { versionTag } = call
    if (call.binding !== VERSION_TAG || versionTag === undefined) {
      return undefined
    }
    const versions = await tagged.of(call.processId, versionTag)
    return versions.find(
      (definition) =>
        definition.versionTag === versionTag && Tenants.same(definition.tenantId, tenantId),
    )
  }
}
