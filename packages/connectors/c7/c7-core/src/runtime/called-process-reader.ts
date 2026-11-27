/**
 * The processes a version calls (`getCalledProcesses` of the engine contract): each call activity
 * of its deployed BPMN XML with the process it names and, when the engine holds it, the version
 * its binding starts (`latest`, `deployment`, `version`, `versionTag`). A call activity whose
 * process or version tag only an expression decides is left out, and so is one without an id or
 * with a version that is no whole number.
 */

import {
  BpmnProcessId,
  ElementId,
  type CalledProcess,
  type DefinitionId,
} from "@miragon/pulse-engine-core"
import { type DefinitionRow, readDefinitionStatistics } from "../definition-statistics.js"
import type { EnginePort } from "../port.js"
import { CALL_ACTIVITY_TAG } from "./call-activity-tags.js"
import { definitionRefOf } from "./definition-refs.js"
import { type DiagramRead, diagramReadOf } from "./definition-rows.js"

type CalledElementBinding =
  | { readonly kind: "latest" | "deployment" }
  | { readonly kind: "version"; readonly version: number }
  | { readonly kind: "versionTag"; readonly versionTag: string }

interface CalledElement {
  readonly elementId: string
  readonly processKey: string
  readonly binding: CalledElementBinding
}

const EXPRESSION = /[$#]\{/
const WHOLE_NUMBER = /^\d+$/

function attribute(tag: string, name: string): string | undefined {
  return new RegExp(`\\s(?:[\\w-]+:)?${name}="([^"]*)"`).exec(tag)?.[1]
}

function bindingOf(tag: string): CalledElementBinding | undefined {
  const kind = attribute(tag, "calledElementBinding") ?? "latest"
  if (kind === "latest" || kind === "deployment") return { kind }
  if (kind === "version") {
    const version = attribute(tag, "calledElementVersion") ?? ""
    return WHOLE_NUMBER.test(version) ? { kind, version: Number(version) } : undefined
  }
  const versionTag = attribute(tag, "calledElementVersionTag")
  return kind === "versionTag" && versionTag !== undefined && !EXPRESSION.test(versionTag)
    ? { kind, versionTag }
    : undefined
}

function calledElementsOf(tag: string): CalledElement[] {
  const elementId = attribute(tag, "id")
  const processKey = attribute(tag, "calledElement")
  const binding = bindingOf(tag)
  if (elementId === undefined || processKey === undefined || binding === undefined) return []
  return EXPRESSION.test(processKey) ? [] : [{ elementId, processKey, binding }]
}

function definitionStartedBy(
  called: CalledElement,
  definitions: readonly DefinitionRow[],
  caller: DefinitionRow | undefined,
): DefinitionRow | undefined {
  const versions = definitions
    .filter((definition) => definition.key === called.processKey)
    .sort((left, right) => right.version - left.version)
  const binding = called.binding
  switch (binding.kind) {
    case "latest":
      return versions[0]
    case "deployment":
      return versions.find(
        (version) =>
          version.deploymentId !== undefined && version.deploymentId === caller?.deploymentId,
      )
    case "version":
      return versions.find((version) => version.version === binding.version)
    case "versionTag":
      return versions.find((version) => version.versionTag === binding.versionTag)
  }
}

/** Reads the processes a version calls over the engine's port. */
export class CalledProcessReader {
  constructor(
    private readonly port: EnginePort,
    private readonly diagram: DiagramRead = diagramReadOf(port),
  ) {}

  /** The calls of the version `definitionId`; none for a version the engine does not know. */
  async read(definitionId: DefinitionId): Promise<CalledProcess[]> {
    const [xml, statistics] = await Promise.all([
      this.diagram(definitionId),
      readDefinitionStatistics(this.port),
    ])
    if (xml === undefined) return []
    const definitions = statistics.map((row) => row.definition)
    const caller = definitions.find((definition) => definition.id === definitionId)
    return [...xml.matchAll(CALL_ACTIVITY_TAG)].flatMap(([tag]) =>
      calledElementsOf(tag).map((called) => {
        const definition = definitionStartedBy(called, definitions, caller)
        return {
          elementId: ElementId(called.elementId),
          bpmnProcessId: BpmnProcessId(called.processKey),
          ...(definition === undefined ? {} : { definition: definitionRefOf(definition) }),
        }
      }),
    )
  }
}
