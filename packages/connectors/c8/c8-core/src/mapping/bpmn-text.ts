import { type XmlTag, XmlTags } from "./xml-tags.js"

export interface CallActivityText {
  readonly elementId: string
  readonly processId?: string
  readonly binding: string
  readonly versionTag?: string
}

export interface ContainerText {
  readonly elementId: string
  readonly callsProcess: boolean
}

export type CatchKind = "timer" | "signal"

const CONTAINERS: ReadonlySet<string> = new Set([
  "callActivity",
  "subProcess",
  "adHocSubProcess",
  "transaction",
])
const CATCHING: ReadonlySet<string> = new Set(["intermediateCatchEvent", "boundaryEvent"])
const CALLING_CONTAINER = "callActivity"
const CALLING: ReadonlySet<string> = new Set([CALLING_CONTAINER])
const ATTRIBUTE = /(?<![\w.:-])([\w.:-]+)\s*=\s*("[^"]*"|'[^']*')/g
const REFERENCE = /&(#x[\da-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g
const LITERAL_WHITE_SPACE = /\r\n|[\t\n\r]/g
const PREDEFINED: ReadonlyMap<string, string> = new Map([
  ["amp", "&"],
  ["lt", "<"],
  ["gt", ">"],
  ["quot", '"'],
  ["apos", "'"],
])
const LAST_CODE_POINT = 0x10ffff

export class BpmnText {
  static callActivities(xml: string): readonly CallActivityText[] {
    return XmlTags.elements(xml, CALLING).flatMap(({ tag, body }) => {
      const elementId = BpmnText.attribute(tag.text, "id")
      return elementId === undefined ? [] : [BpmnText.callOf(elementId, body)]
    })
  }

  static containers(xml: string): readonly ContainerText[] {
    return XmlTags.of(xml).flatMap((tag) => {
      const elementId = BpmnText.containerId(tag)
      return elementId === undefined
        ? []
        : [{ elementId, callsProcess: tag.name === CALLING_CONTAINER }]
    })
  }

  static catchKind(xml: string, elementId: string): CatchKind | undefined {
    const caught = XmlTags.elements(xml, CATCHING).find(
      ({ tag }) => BpmnText.attribute(tag.text, "id") === elementId,
    )
    return caught === undefined ? undefined : BpmnText.kindOf(caught.body)
  }

  private static containerId(tag: XmlTag): string | undefined {
    return CONTAINERS.has(tag.name) ? BpmnText.attribute(tag.text, "id") : undefined
  }

  private static kindOf(body: readonly XmlTag[]): CatchKind | undefined {
    if (BpmnText.holds(body, "timerEventDefinition")) {
      return "timer"
    }
    return BpmnText.holds(body, "signalEventDefinition") ? "signal" : undefined
  }

  private static holds(body: readonly XmlTag[], name: string): boolean {
    return body.some((tag) => tag.name === name)
  }

  private static callOf(elementId: string, body: readonly XmlTag[]): CallActivityText {
    const tag = body.find((inner) => inner.name === "calledElement")?.text ?? ""
    const processId = BpmnText.attribute(tag, "processId")
    const versionTag = BpmnText.attribute(tag, "versionTag")
    return {
      elementId,
      binding: BpmnText.attribute(tag, "bindingType") ?? "latest",
      ...(processId === undefined ? {} : { processId }),
      ...(versionTag === undefined ? {} : { versionTag }),
    }
  }

  private static attribute(tag: string, name: string): string | undefined {
    for (const [, key, quoted] of tag.matchAll(ATTRIBUTE)) {
      if (key === name) {
        return BpmnText.decoded(BpmnText.textOf(quoted).slice(1, -1))
      }
    }
    return undefined
  }

  private static textOf(group: string | undefined): string {
    return group ?? ""
  }

  private static decoded(value: string): string {
    return value
      .replaceAll(LITERAL_WHITE_SPACE, " ")
      .replaceAll(REFERENCE, (reference: string, name: string) =>
        BpmnText.characterOf(reference, name),
      )
  }

  private static characterOf(reference: string, name: string): string {
    const predefined = PREDEFINED.get(name)
    if (predefined !== undefined) {
      return predefined
    }
    const codePoint = name.startsWith("#x")
      ? Number.parseInt(name.slice(2), 16)
      : Number(name.slice(1))
    return codePoint <= LAST_CODE_POINT ? String.fromCodePoint(codePoint) : reference
  }
}
