const ID_ATTRIBUTE = /\bid="([^"]+)"/;
const PROCESS_TAG = /<(?:[\w-]+:)?process\s[^>]*>/g;

export class BpmnProcessIds {
  static of(xml: string): string[] {
    return [...xml.matchAll(PROCESS_TAG)].flatMap(([tag]) => {
      const id = ID_ATTRIBUTE.exec(tag)?.[1];
      return id === undefined ? [] : [id];
    });
  }
}
