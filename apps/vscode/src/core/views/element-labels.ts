import { ElementNames } from '../bpmn/element-names.js';

export class ElementLabels {
  private readonly names: ReadonlyMap<string, string>;
  private readonly repeated: ReadonlySet<string>;

  constructor(diagramXml: string) {
    this.names = ElementNames.of(diagramXml);
    const seen = new Set<string>();
    const repeated = new Set<string>();
    for (const name of this.names.values()) {
      (seen.has(name) ? repeated : seen).add(name);
    }
    this.repeated = repeated;
  }

  of(elementId: string): string {
    const name = this.names.get(elementId);
    if (name === undefined) {
      return elementId;
    }
    return this.repeated.has(name) ? `${name} (${elementId})` : name;
  }
}
