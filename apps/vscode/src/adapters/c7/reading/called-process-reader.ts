import {
  BpmnProcessId,
  ElementId,
  type CalledProcess,
  type DefinitionId,
} from "../../../contract/index.js"
import type { DefinitionView, EngineClient } from "../engine-rest/index.js"
import { ErrorTranslation } from "../errors/error-translation.js"
import { DefinitionRefs } from "../mapping/definition-refs.js"

type CalledElementBinding =
  | { readonly kind: "latest" | "deployment" }
  | { readonly kind: "version"; readonly version: number }
  | { readonly kind: "versionTag"; readonly versionTag: string }

interface CalledElement {
  readonly elementId: string
  readonly processKey: string
  readonly binding: CalledElementBinding
}

const CALL_ACTIVITY_TAG = /<(?:[\w-]+:)?callActivity\b(?:[^>"]|"[^"]*")*>/g
const EXPRESSION = /[$#]\{/
const WHOLE_NUMBER = /^\d+$/

export class CalledProcessReader {
  constructor(private readonly client: EngineClient) {}

  async read(definitionId: DefinitionId): Promise<CalledProcess[]> {
    const [xml, statistics] = await Promise.all([
      ErrorTranslation.unlessMissing(() => this.client.diagramXml(definitionId)),
      this.client.definitionStatistics(),
    ])
    if (xml === undefined) {
      return []
    }
    const definitions = statistics.map((row) => row.definition)
    const caller = definitions.find((definition) => definition.id === definitionId)
    return [...xml.matchAll(CALL_ACTIVITY_TAG)].flatMap(([tag]) =>
      this.calledElementOf(tag).map((called) => {
        const definition = this.definitionStartedBy(called, definitions, caller)
        return {
          elementId: ElementId(called.elementId),
          bpmnProcessId: BpmnProcessId(called.processKey),
          ...(definition === undefined ? {} : { definition: DefinitionRefs.of(definition) }),
        }
      }),
    )
  }

  private calledElementOf(tag: string): CalledElement[] {
    const elementId = this.attribute(tag, "id")
    const processKey = this.attribute(tag, "calledElement")
    const binding = this.bindingOf(tag)
    if (elementId === undefined || processKey === undefined || binding === undefined) {
      return []
    }
    return EXPRESSION.test(processKey) ? [] : [{ elementId, processKey, binding }]
  }

  private bindingOf(tag: string): CalledElementBinding | undefined {
    const kind = this.attribute(tag, "calledElementBinding") ?? "latest"
    if (kind === "latest" || kind === "deployment") {
      return { kind }
    }
    if (kind === "version") {
      const version = this.attribute(tag, "calledElementVersion") ?? ""
      return WHOLE_NUMBER.test(version) ? { kind, version: Number(version) } : undefined
    }
    const versionTag = this.attribute(tag, "calledElementVersionTag")
    return kind === "versionTag" && versionTag !== undefined && !EXPRESSION.test(versionTag)
      ? { kind, versionTag }
      : undefined
  }

  private attribute(tag: string, name: string): string | undefined {
    return new RegExp(`\\s(?:[\\w-]+:)?${name}="([^"]*)"`).exec(tag)?.[1]
  }

  private definitionStartedBy(
    called: CalledElement,
    definitions: readonly DefinitionView[],
    caller: DefinitionView | undefined,
  ): DefinitionView | undefined {
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
}
