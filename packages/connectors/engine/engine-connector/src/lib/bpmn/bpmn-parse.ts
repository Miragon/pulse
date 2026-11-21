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
  const re = /<(?:[a-zA-Z]+:)?callActivity\b[^>]*>/g
  const ids: string[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(bpmnXml)) !== null) {
    const id = /\bid="([^"]+)"/.exec(m[0])
    if (id) ids.push(id[1])
  }
  return ids
}
