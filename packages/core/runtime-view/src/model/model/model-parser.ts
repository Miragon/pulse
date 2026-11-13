import { BpmnModdle, type Moddle, type ModdleElement, type ParseResult } from "bpmn-moddle"
import camunda from "camunda-bpmn-moddle/resources/camunda.json" with { type: "json" }
import zeebe from "zeebe-bpmn-moddle/resources/zeebe.json" with { type: "json" }

const ZEEBE_NAMESPACE = "http://camunda.org/schema/zeebe/1.0"

export class ModelParser {
  private readonly camundaModdle: Moddle = BpmnModdle({ camunda })
  private readonly zeebeModdle: Moddle = BpmnModdle({ zeebe })
  private last: { readonly xml: string; readonly parsed: Promise<ParseResult> } | undefined

  parse(xml: string): Promise<ParseResult> {
    if (this.last?.xml !== xml) {
      const moddle = xml.includes(ZEEBE_NAMESPACE) ? this.zeebeModdle : this.camundaModdle
      this.last = { xml, parsed: moddle.fromXML(xml) }
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
}
