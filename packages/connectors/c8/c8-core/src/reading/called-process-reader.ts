import {
  BpmnProcessId,
  ElementId,
  type CalledProcess,
  type DefinitionId,
} from "@miragon/pulse-engine-core"
import { BpmnText, type CallActivityText } from "../mapping/bpmn-text.js"
import { DefinitionRefs } from "../mapping/definition-refs.js"
import type { CamundaClient, DefinitionView } from "../rest/index.js"
import type { Diagrams } from "./diagrams.js"

const FEEL = "="

interface ProcessCall extends CallActivityText {
  readonly processId: string
}

export class CalledProcessReader {
  constructor(
    private readonly client: CamundaClient,
    private readonly diagrams: Diagrams,
  ) {}

  async read(definitionId: DefinitionId): Promise<CalledProcess[]> {
    const xml = await this.diagrams.xml(definitionId)
    if (xml === undefined) {
      return []
    }
    const calls = BpmnText.callActivities(xml).filter(
      (call): call is ProcessCall =>
        call.processId !== undefined && !call.processId.startsWith(FEEL),
    )
    if (calls.length === 0) {
      return []
    }
    const latest = await this.client.latestDefinitions()
    return Promise.all(calls.map((call) => this.calledBy(call, latest)))
  }

  private async calledBy(
    call: ProcessCall,
    latest: readonly DefinitionView[],
  ): Promise<CalledProcess> {
    const definition = await this.definitionStartedBy(call, latest)
    return {
      elementId: ElementId(call.elementId),
      bpmnProcessId: BpmnProcessId(call.processId),
      ...(definition === undefined ? {} : { definition: DefinitionRefs.of(definition) }),
    }
  }

  private async definitionStartedBy(
    call: ProcessCall,
    latest: readonly DefinitionView[],
  ): Promise<DefinitionView | undefined> {
    if (call.binding === "latest") {
      return latest
        .filter((definition) => definition.bpmnProcessId === call.processId)
        .toSorted((left, right) => right.version - left.version)[0]
    }
    if (call.binding !== "versionTag" || call.versionTag === undefined) {
      return undefined
    }
    const versions = await this.client.versionsOf(call.processId)
    return versions.find((definition) => definition.versionTag === call.versionTag)
  }
}
