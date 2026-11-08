import type { Client } from "@miragon/pulse-engine-client"
import { readBpmnNames } from "@miragon/pulse-widget-shell/server"
import { bpmnActivityIds } from "../lib/bpmn/bpmn-parse.js"
import type { DefinitionInfo } from "./definition-info.js"
import { fetchDefinitionXml } from "./definition-info.js"
import { optional } from "./engine-reads.js"

/** A multi-instance activity's body is reported under an id of its own. */
export const MULTI_INSTANCE_BODY = /#multiInstanceBody$/

export interface DiagramPlacement {
  /** Its name in the drawn diagram; null when the diagram does not name it or is unreadable. */
  activityName: string | null
  /** False when the drawn diagram lacks it (only older versions have it); null when unreadable. */
  inDiagram: boolean | null
}

/** The drawn version's XML: enrichment, so an unreadable diagram names nothing, never fails the view. */
export function readDiagramXml(client: Client, diagram: DefinitionInfo): Promise<string | null> {
  return diagram.id ? optional(fetchDefinitionXml(client, diagram.id)) : Promise.resolve(null)
}

/** Where the latest diagram puts each element the counts name: its name, and whether it is drawn. */
export function placeOnDiagram(bpmnXml: string | null): (activityId: string) => DiagramPlacement {
  const drawn = bpmnXml ? new Set(bpmnActivityIds(bpmnXml)) : null
  const names = readBpmnNames(bpmnXml ?? "").elements
  return (activityId) => ({
    activityName: Object.hasOwn(names, activityId) ? names[activityId] : null,
    inDiagram: drawn ? drawn.has(activityId) : null,
  })
}
