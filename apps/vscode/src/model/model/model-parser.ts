import type { BpmnDialect } from "../../contract/index.js"
import { BpmnModdle, type Moddle, type ModdleElement, type ParseResult } from "bpmn-moddle"

interface DialectModdle {
  readonly dialect: BpmnDialect
  readonly moddle: Moddle
}

export class ModelParser {
  private readonly moddles: readonly DialectModdle[]
  private readonly plain: Moddle = BpmnModdle()
  private last: { readonly xml: string; readonly parsed: Promise<ParseResult> } | undefined

  constructor(dialects: readonly BpmnDialect[]) {
    this.moddles = dialects.map((dialect) => ({
      dialect,
      moddle: BpmnModdle({ extension: dialect.descriptor }),
    }))
  }

  parse(xml: string): Promise<ParseResult> {
    if (this.last?.xml !== xml) {
      this.last = { xml, parsed: this.moddleOf(xml).fromXML(xml) }
    }
    return this.last.parsed
  }

  async processIds(xml: string): Promise<string[]> {
    const { rootElement } = await this.parse(xml)
    return ModelParser.elements(rootElement, "rootElements")
      .filter((element) => element.$type === "bpmn:Process")
      .flatMap((element) => (element.id === undefined ? [] : [element.id]))
  }

  static elements(element: ModdleElement | undefined, property: string): ModdleElement[] {
    const value = element?.get(property)
    return Array.isArray(value) ? (value as ModdleElement[]) : []
  }

  static extensions(element: ModdleElement): ModdleElement[] {
    return ModelParser.elements(
      element.get("extensionElements") as ModdleElement | undefined,
      "values",
    )
  }

  static text(element: ModdleElement | undefined, property: string): string | undefined {
    const value = element?.get(property)
    return typeof value === "string" && value.trim() !== "" ? value : undefined
  }

  private moddleOf(xml: string): Moddle {
    const marked = this.moddles.find(
      ({ dialect }) => !dialect.fallback && xml.includes(dialect.descriptor.uri),
    )
    return (marked ?? this.moddles.find(({ dialect }) => dialect.fallback))?.moddle ?? this.plain
  }
}
