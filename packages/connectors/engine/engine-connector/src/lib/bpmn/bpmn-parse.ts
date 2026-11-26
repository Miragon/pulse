// Regex over machine-generated XML to avoid `bpmn-moddle` server-side. Display names come
// from the kit's `readBpmnNames` so every module names elements alike.

/** The "X / Y activities affected" hint counts both sides over THIS set, so an older version's activity never inflates X. */
export function bpmnActivityIds(bpmnXml: string): string[] {
  const re = /<(?:[a-zA-Z]+:)?(?:\w+Task|\w+Gateway|\w+Event|subProcess|callActivity)\b[^>]*>/g
  const ids: string[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(bpmnXml)) !== null) {
    const id = /\bid="([^"]+)"/.exec(m[0])
    if (id) ids.push(id[1])
  }
  return ids
}

/**
 * The diagram's call activities: the one kind of element where Camunda 7 holds a copy of a called
 * instance's incident, so where a count of root incidents has to tell the copies apart.
 */
export function bpmnCallActivityIds(bpmnXml: string): string[] {
  return idsOfTags(bpmnXml, /<(?:[a-zA-Z]+:)?callActivity\b[^>]*>/g)
}

/** The diagram's user tasks: the one kind of element whose tokens wait as open tasks. */
export function bpmnUserTaskIds(bpmnXml: string): string[] {
  return idsOfTags(bpmnXml, /<(?:[a-zA-Z]+:)?userTask\b[^>]*>/g)
}

function idsOfTags(bpmnXml: string, re: RegExp): string[] {
  const ids: string[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(bpmnXml)) !== null) {
    const id = /\bid="([^"]+)"/.exec(m[0])
    if (id) ids.push(id[1])
  }
  return ids
}

/** A start, end or empty tag of any prefix; a `>` inside a quoted value belongs to the tag. */
const TAG = /<(\/?)(?:[A-Za-z_][\w.-]*:)?([A-Za-z_][\w.-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g

/** An `id` attribute's value, quoted either way. */
const ID_ATTRIBUTE = /(?:^|\s)id\s*=\s*(?:"([^"]*)"|'([^']*)')/

/** The XML without its comments and CDATA sections, in one pass; an unterminated one ends it. */
function withoutComments(xml: string): string {
  let out = ""
  let at = 0
  for (;;) {
    const comment = xml.indexOf("<!--", at)
    const cdata = xml.indexOf("<![CDATA[", at)
    const open = comment === -1 ? cdata : cdata === -1 ? comment : Math.min(comment, cdata)
    if (open === -1) return out + xml.slice(at)
    out += xml.slice(at, open)
    const close = open === comment ? "-->" : "]]>"
    const end = xml.indexOf(close, open + 4)
    if (end === -1) return out
    at = end + close.length
  }
}

/**
 * The end events directly in the process `processId` (its definition's key), never one inside a
 * subprocess, a transaction or an event subprocess: the ends an instance of the process finishes
 * at, in the diagram's order.
 */
export function bpmnProcessEndEventIds(bpmnXml: string, processId: string): string[] {
  const ids: string[] = []
  const open: string[] = []
  let processDepth = -1
  for (const [, closing, name, attributes] of withoutComments(bpmnXml).matchAll(TAG)) {
    if (closing === "/") {
      open.pop()
      if (open.length === processDepth) processDepth = -1
      continue
    }
    const empty = attributes.trimEnd().endsWith("/")
    const id = ID_ATTRIBUTE.exec(attributes)
    const elementId = id?.[1] ?? id?.[2]
    if (name === "process" && elementId === processId && !empty) {
      processDepth = open.length
    } else if (name === "endEvent" && processDepth >= 0 && open.length === processDepth + 1) {
      if (elementId) ids.push(elementId)
    }
    if (!empty) open.push(name)
  }
  return ids
}
