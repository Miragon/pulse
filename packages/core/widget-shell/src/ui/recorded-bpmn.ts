/**
 * A BPMN diagram as a recording keeps it (`RecordedRead`'s `bpmn`): what a page draws, its
 * elements with their ids, names and references and the diagram's shapes, without what the engine
 * runs or evaluates, never drawn: the extension elements and attributes (an engine's listeners,
 * input and output mappings, form fields, assignees, class names, expressions), the bodies of the
 * elements standard BPMN gives code or an expression (`EVALUATED`), and the comments. Its free
 * text, the documentation and an annotation's text, goes through `text`, or stays as it came where
 * `text` is null. It reads the markup in one pass, as an XML parser does: a comment, a CDATA
 * section and a processing instruction each to its own end, a quoted `>` part of its tag, so a `<`
 * in a script's CDATA ends nothing. Nothing is kept after markup that never ends, nor of the body
 * of an element cut that never closes: an engine's XML is well-formed, and each cut leaves it so.
 */

/**
 * The elements whose body the engine runs or evaluates: a script; a condition (a sequence flow's,
 * a conditional event's, a loop's, a complex gateway's); a loop's count; a formal expression
 * (whom a task's `potentialOwner` or `humanPerformer` assigns, a resource's parameters) and any
 * other expression; a timer's date, duration and cycle; an assignment's `from` and `to`; a data
 * association's transformation and a correlation's paths.
 */
const EVALUATED = new Set([
  "script",
  "conditionExpression",
  "completionCondition",
  "loopCardinality",
  "loopCondition",
  "condition",
  "activationCondition",
  "formalExpression",
  "expression",
  "timeDate",
  "timeDuration",
  "timeCycle",
  "from",
  "to",
  "transformation",
  "messagePath",
  "dataPath",
])

/** Markup read to its own end, never as a tag: what opens it and what ends it. */
const SECTIONS: readonly (readonly [string, string])[] = [
  ["<!--", "-->"],
  ["<![CDATA[", "]]>"],
  ["<?", "?>"],
]

/** Where the tag whose `<` is before `from` ends, past its `>`, a quoted `>` part of it; else -1. */
function tagEnd(xml: string, from: number): number {
  const stops = /["'>]/g
  stops.lastIndex = from
  for (let stop = stops.exec(xml); stop !== null; stop = stops.exec(xml)) {
    if (stop[0] === ">") return stop.index + 1
    const closing = xml.indexOf(stop[0], stop.index + 1)
    if (closing === -1) return -1
    stops.lastIndex = closing + 1
  }
  return -1
}

/** Where the markup at `start` ends, past its last character; -1 where it never does. */
function markupEnd(xml: string, start: number): number {
  const section = SECTIONS.find(([opening]) => xml.startsWith(opening, start))
  if (section === undefined) return tagEnd(xml, start + 1)
  const [opening, closing] = section
  const end = xml.indexOf(closing, start + opening.length)
  return end === -1 ? -1 : end + closing.length
}

/** One attribute with the space before it, its prefix apart where it has one; read in turn. */
const ATTRIBUTE = /(\s+)([\w.-]+)(:[\w.-]+)?\s*=\s*(?:"[^"]*"|'[^']*')/y

/** The prefixes of XML's own attributes, which every diagram keeps (`xmlns:`, `xsi:type`). */
const XML_PREFIXES = new Set(["xmlns", "xsi", "xml"])

/**
 * A start tag's attributes without those of an extension's namespace, read one after the other
 * from its name on; from one that is no attribute on, nothing is kept but the blanks before `/>`.
 */
function ownAttributes(attributes: string): string {
  let own = ""
  let at = 0
  for (;;) {
    ATTRIBUTE.lastIndex = at
    const attribute = ATTRIBUTE.exec(attributes)
    if (attribute === null) break
    const [text, , prefix = "", local] = attribute
    if (local === undefined || XML_PREFIXES.has(prefix)) own += text
    at = ATTRIBUTE.lastIndex
  }
  const rest = attributes.slice(at)
  return own + (rest.trim() === "" ? rest : "")
}

/** A start tag as kept: its name and its own attributes, closing itself where it did. */
function keptStartTag(tag: string, name: string, empty: boolean): string {
  const close = empty ? "/>" : ">"
  return `<${name}${ownAttributes(tag.slice(1 + name.length, tag.length - close.length))}${close}`
}

/** What a cut element ends as, from its body and its end tag: "" where it goes whole. */
type Ending = (body: string, endTag: string) => string

/** How a recording keeps an element and its body: whether its start tag stays, how it ends. */
interface Cut {
  readonly keepsStart: boolean
  readonly ends: Ending
}

const DROPPED: Cut = { keepsStart: false, ends: () => "" }
const EMPTIED: Cut = { keepsStart: true, ends: (_body, endTag) => endTag }

/** A start tag's name: up to a blank, a `/` or its `>`. */
const TAG_NAME = /^[^\s/>]+/

/** The kept markup of one diagram, read token by token (`recordedBpmn`). */
class DiagramScrub {
  private readonly kept: string[] = []
  private depth = 0
  private cut: { readonly depth: number; readonly ends: Ending; readonly body: string[] } | null =
    null

  private readonly text: ((text: string) => string) | null

  constructor(text: ((text: string) => string) | null) {
    this.text = text
  }

  /** Character data, a CDATA section, a processing instruction: kept unless in a cut. */
  content(raw: string): void {
    if (this.cut === null) this.kept.push(raw)
    else this.cut.body.push(raw)
  }

  /** One piece of markup, from its `<` to its end. */
  markup(raw: string): void {
    if (raw.startsWith("<!--")) return
    if (raw.startsWith("<![CDATA[") || raw.startsWith("<?") || raw.startsWith("<!")) {
      this.content(raw)
    } else if (raw.startsWith("</")) {
      this.endTag(raw)
    } else {
      this.startTag(raw)
    }
  }

  /** What has been kept, an element cut that never closed left out. */
  result(): string {
    return this.kept.join("")
  }

  private startTag(raw: string): void {
    const empty = raw.endsWith("/>")
    if (this.cut === null) {
      const name = TAG_NAME.exec(raw.slice(1))?.[0] ?? ""
      const cut = this.cutOf(name.slice(name.indexOf(":") + 1))
      if (cut?.keepsStart !== false) this.kept.push(keptStartTag(raw, name, empty))
      if (cut !== undefined && !empty) this.cut = { depth: this.depth, ends: cut.ends, body: [] }
    } else {
      this.cut.body.push(raw)
    }
    if (!empty) this.depth += 1
  }

  private endTag(raw: string): void {
    this.depth -= 1
    const cut = this.cut
    if (cut === null) {
      this.kept.push(raw)
    } else if (this.depth > cut.depth) {
      cut.body.push(raw)
    } else {
      this.cut = null
      this.kept.push(cut.ends(cut.body.join(""), raw))
    }
  }

  /** How the element of `local` name is cut: dropped, emptied, its text replaced, or not. */
  private cutOf(local: string): Cut | undefined {
    const text = this.text
    if (local === "extensionElements") return DROPPED
    if (EVALUATED.has(local)) return EMPTIED
    if (text === null) return undefined
    if (local === "documentation") return DROPPED
    if (local === "text") return { keepsStart: true, ends: (body, endTag) => text(body) + endTag }
    return undefined
  }
}

/**
 * `xml` without what the engine runs, its free text through `text` (the documentation dropped, an
 * annotation's text replaced), or as it came where `text` is null.
 */
export function recordedBpmn(xml: string, text: ((text: string) => string) | null): string {
  const scrub = new DiagramScrub(text)
  for (let at = 0; at < xml.length;) {
    const start = xml.indexOf("<", at)
    scrub.content(xml.slice(at, start === -1 ? xml.length : start))
    const end = start === -1 ? -1 : markupEnd(xml, start)
    if (end === -1) break
    scrub.markup(xml.slice(start, end))
    at = end
  }
  return scrub.result()
}
