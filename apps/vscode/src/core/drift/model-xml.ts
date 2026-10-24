export class ModelXml {
  static same(left: string, right: string): boolean {
    return ModelXml.normalized(left) === ModelXml.normalized(right)
  }

  private static normalized(xml: string): string {
    return xml.replace(/\r\n?/g, "\n").replace(/>\s+</g, "><").trim()
  }
}
