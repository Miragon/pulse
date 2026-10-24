const ELEMENT_TAG = /<[\w:-]+\s[^>]*>/g;
const ID_ATTRIBUTE = /\bid="([^"]+)"/;
const NAME_ATTRIBUTE = /\bname="([^"]*)"/;
const ENTITIES: Readonly<Record<string, string>> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&apos;': "'",
  '&#10;': ' ',
};

export class ElementNames {
  static of(xml: string): ReadonlyMap<string, string> {
    const names = new Map<string, string>();
    for (const [tag] of xml.matchAll(ELEMENT_TAG)) {
      const id = ID_ATTRIBUTE.exec(tag)?.[1];
      const name = NAME_ATTRIBUTE.exec(tag)?.[1];
      if (id !== undefined && name !== undefined && name.trim() !== '' && !names.has(id)) {
        names.set(id, ElementNames.decode(name).replace(/\s+/g, ' ').trim());
      }
    }
    return names;
  }

  private static decode(value: string): string {
    return value.replace(/&(?:amp|lt|gt|quot|apos|#10);/g, (entity) => ENTITIES[entity] ?? entity);
  }
}
