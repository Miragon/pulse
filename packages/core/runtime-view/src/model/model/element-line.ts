export class ElementLine {
  static of(xml: string, elementId: string): number {
    const offset = xml.indexOf(`id="${elementId}"`)
    return offset < 0 ? 1 : xml.slice(0, offset).split("\n").length
  }
}
