/**
 * One BPMN name reader for server and browser, so no two modules name a process differently.
 * The Camunda Modeler names the POOL, not the process, and writes `&`, line breaks etc. as numeric
 * character references; a reader that missed either would show the key or the raw reference.
 */

export interface BpmnNames {
  /** Else the name of the pool that holds it. */
  name: string | null
  elements: Record<string, string>
}

export interface BpmnModelNames {
  processes: Record<string, string>
  elements: Record<string, string>
}

/** A quoted value may hold `>`. */
const START_TAG =
  /<(?:[A-Za-z_][\w.-]*:)?([A-Za-z_][\w.-]*)((?:\s+[A-Za-z_][\w:.-]*\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*\/?>/g

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" }

/** One past Unicode stays as written. */
const character = (code: number, written: string) =>
  code <= 0x10ffff ? String.fromCodePoint(code) : written

function attributeText(raw: string): string {
  return raw
    .replace(
      /&(?:#x([0-9a-f]+)|#(\d+)|(amp|lt|gt|quot|apos));/gi,
      (match: string, hex?: string, dec?: string, named?: string) => {
        if (hex) return character(Number.parseInt(hex, 16), match)
        if (dec) return character(Number.parseInt(dec, 10), match)
        return ENTITIES[(named ?? "").toLowerCase()] ?? match
      },
    )
    .replace(/\s+/g, " ")
    .trim()
}

const isSpace = (c: string | undefined) => c === " " || c === "\t" || c === "\n" || c === "\r"
const NAME_CHAR = /[\w:.-]/
const NAME_START = /^[A-Za-z_]/

/** A linear tokenizer: a global attribute regex is polynomial ReDoS on engine-supplied XML. */
function attributesOf(raw: string): Record<string, string> {
  const out: Record<string, string> = {}
  let at = 0
  while (at < raw.length) {
    while (isSpace(raw[at])) at++
    const start = at
    while (at < raw.length && NAME_CHAR.test(raw[at])) at++
    const name = raw.slice(start, at)
    while (isSpace(raw[at])) at++
    if (raw[at] !== "=") {
      at = Math.max(at, start + 1)
      continue
    }
    at++
    while (isSpace(raw[at])) at++
    const quote = raw[at]
    if (quote !== '"' && quote !== "'") continue
    const end = raw.indexOf(quote, at + 1)
    if (end === -1) break
    if (NAME_START.test(name)) out[name] = raw.slice(at + 1, end)
    at = end + 1
  }
  return out
}

const SKIPPED_SECTIONS = [
  { open: "<!--", close: "-->" },
  { open: "<![CDATA[", close: "]]>" },
] as const

/**
 * A linear scan instead of a lazy regex (CodeQL ReDoS, incomplete sanitization). An unterminated
 * section swallows the rest, so no opener survives.
 */
function withoutCommentsAndCdata(xml: string): string {
  const nextOpen = SKIPPED_SECTIONS.map((section) => xml.indexOf(section.open))
  let out = ""
  let at = 0
  for (;;) {
    let pick = -1
    SKIPPED_SECTIONS.forEach((section, i) => {
      if (nextOpen[i] !== -1 && nextOpen[i] < at) nextOpen[i] = xml.indexOf(section.open, at)
      if (nextOpen[i] !== -1 && (pick === -1 || nextOpen[i] < nextOpen[pick])) pick = i
    })
    if (pick === -1) return out + xml.slice(at)
    const { open, close } = SKIPPED_SECTIONS[pick]
    out += xml.slice(at, nextOpen[pick])
    const end = xml.indexOf(close, nextOpen[pick] + open.length)
    if (end === -1) return out
    at = end + close.length
  }
}

/** A document that is not BPMN yields no names, never an error. */
export function readBpmnNames(xml: string): BpmnModelNames {
  const text = withoutCommentsAndCdata(xml)
  const own: Record<string, string> = {}
  const pools: Record<string, string> = {}
  const elements: Record<string, string> = {}
  for (const m of text.matchAll(START_TAG)) {
    const local = m[1]
    const attrs = attributesOf(m[2] ?? "")
    const name = attrs.name === undefined ? "" : attributeText(attrs.name)
    if (local === "participant") {
      if (attrs.processRef && name) pools[attrs.processRef] = name
      continue
    }
    if (!attrs.id || !name) continue
    if (local === "process") {
      own[attrs.id] = name
      continue
    }
    elements[attrs.id] = name
  }
  return { processes: { ...pools, ...own }, elements }
}

export function bpmnProcessNameOf(
  names: BpmnModelNames,
  processDefinitionKey: string,
): string | null {
  return Object.hasOwn(names.processes, processDefinitionKey)
    ? names.processes[processDefinitionKey]
    : null
}

export function parseBpmnNames(xml: string, processDefinitionKey: string): BpmnNames {
  const names = readBpmnNames(xml)
  return { name: bpmnProcessNameOf(names, processDefinitionKey), elements: names.elements }
}
