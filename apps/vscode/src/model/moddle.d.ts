declare module "bpmn-moddle" {
  export interface ModdleElement {
    readonly $type: string
    readonly id?: string
    get(name: string): unknown
  }

  export interface ParseResult {
    readonly rootElement: ModdleElement
    readonly elementsById: Readonly<Record<string, ModdleElement | undefined>>
  }

  export interface Moddle {
    fromXML(xml: string): Promise<ParseResult>
  }

  export function BpmnModdle(packages?: Readonly<Record<string, unknown>>): Moddle
}
