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

const NO_MARKUP = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>/g
const CALL_ACTIVITY =
  /<(?:[\w.-]+:)?callActivity(?=[\s/>])((?:[^>"']|"[^"]*"|'[^']*')*?)(?:\/>|>([\s\S]*?)<\/(?:[\w.-]+:)?callActivity\s*>)/g
const CALLED_ELEMENT = /<(?:[\w.-]+:)?calledElement(?=[\s/>])((?:[^>"']|"[^"]*"|'[^']*')*)>/
const CATCHING =
  /<(?:[\w.-]+:)?(intermediateCatchEvent|boundaryEvent|receiveTask)(?=[\s/>])((?:[^>"']|"[^"]*"|'[^']*')*?)(?:\/>|>([\s\S]*?)<\/(?:[\w.-]+:)?\1\s*>)/g
const CONTAINER =
  /<(?:[\w.-]+:)?(callActivity|subProcess|adHocSubProcess|transaction)(?=[\s/>])((?:[^>"']|"[^"]*"|'[^']*')*)>/g
const TIMER = /<(?:[\w.-]+:)?timerEventDefinition(?=[\s/>])/
const SIGNAL = /<(?:[\w.-]+:)?signalEventDefinition(?=[\s/>])/
const ATTRIBUTE = /([\w.:-]+)\s*=\s*("[^"]*"|'[^']*')/g
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
const CALLING_CONTAINER = "callActivity"

export class BpmnText {
  static callActivities(xml: string): readonly CallActivityText[] {
    return [...BpmnText.markupOf(xml).matchAll(CALL_ACTIVITY)].flatMap((match) => {
      const elementId = BpmnText.attribute(BpmnText.textOf(match[1]), "id")
      return elementId === undefined ? [] : [BpmnText.callOf(elementId, BpmnText.textOf(match[2]))]
    })
  }

  static containers(xml: string): readonly ContainerText[] {
    return [...BpmnText.markupOf(xml).matchAll(CONTAINER)].flatMap((match) => {
      const elementId = BpmnText.attribute(BpmnText.textOf(match[2]), "id")
      return elementId === undefined
        ? []
        : [{ elementId, callsProcess: match[1] === CALLING_CONTAINER }]
    })
  }

  static catchKind(xml: string, elementId: string): CatchKind | undefined {
    for (const match of BpmnText.markupOf(xml).matchAll(CATCHING)) {
      if (BpmnText.attribute(BpmnText.textOf(match[2]), "id") === elementId) {
        return BpmnText.kindOf(BpmnText.textOf(match[3]))
      }
    }
    return undefined
  }

  private static markupOf(xml: string): string {
    let markup = xml
    let before: string
    do {
      before = markup
      markup = markup.replaceAll(NO_MARKUP, "")
    } while (markup !== before)
    return markup
  }

  private static textOf(group: string | undefined): string {
    return group ?? ""
  }

  private static kindOf(body: string): CatchKind | undefined {
    if (TIMER.test(body)) {
      return "timer"
    }
    return SIGNAL.test(body) ? "signal" : undefined
  }

  private static callOf(elementId: string, body: string): CallActivityText {
    const tag = CALLED_ELEMENT.exec(body)?.[1] ?? ""
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
