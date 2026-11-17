export interface XmlTag {
  readonly name: string
  readonly closing: boolean
  readonly empty: boolean
  readonly text: string
}

const SKIPPED_MARKUP: readonly (readonly [string, string])[] = [
  ["<!--", "-->"],
  ["<![CDATA[", "]]>"],
  ["<?", "?>"],
]
const NAME_END = /[^\w.:-]|$/
const LONGEST_TEXT = 4 * 1024 * 1024

export class XmlTags {
  static of(xml: string): readonly XmlTag[] {
    const tags: XmlTag[] = []
    if (xml.length > LONGEST_TEXT) {
      return tags
    }
    for (let start = xml.indexOf("<"); start !== -1;) {
      const skipped = XmlTags.skippedTo(xml, start)
      const end = skipped ?? XmlTags.tagEnd(xml, start + 1)
      if (end === -1) {
        return tags
      }
      if (skipped === undefined) {
        tags.push(XmlTags.tagOf(xml.slice(start + 1, end - 1)))
      }
      start = xml.indexOf("<", end)
    }
    return tags
  }

  private static skippedTo(xml: string, start: number): number | undefined {
    const markup = SKIPPED_MARKUP.find(([opening]) => xml.startsWith(opening, start))
    if (markup === undefined) {
      return undefined
    }
    const [opening, closing] = markup
    return xml.indexOf(closing, start + opening.length)
  }

  private static tagEnd(xml: string, from: number): number {
    const stops = /["'>]/g
    stops.lastIndex = from
    for (let stop = stops.exec(xml); stop !== null; stop = stops.exec(xml)) {
      const [char] = stop
      if (char === ">") {
        return stop.index + 1
      }
      const closing = xml.indexOf(char, stop.index + 1)
      if (closing === -1) {
        return closing
      }
      stops.lastIndex = closing + 1
    }
    return -1
  }

  private static tagOf(text: string): XmlTag {
    const closing = text.startsWith("/")
    const named = closing ? text.slice(1) : text
    const name = named.slice(0, named.search(NAME_END))
    return {
      name: name.slice(name.indexOf(":") + 1),
      closing,
      empty: named.endsWith("/"),
      text: named,
    }
  }
}
