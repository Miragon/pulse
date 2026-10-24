/**
 * `--until activity:<id>` and `task:<key>` checked against the BPMN once, before waiting (and
 * before the write of advance and retry): an id that occurs in no element of the processes of the
 * instance tree or the processes they call is a typo, which would otherwise wait the whole budget.
 * Whatever operate cannot know for sure (dynamic or version-bound call activities, tenants, a cut
 * tree, an XML it cannot read) skips the check.
 */

import type { EnginePort } from "../engine-port/engine-port.js"
import { OperateError, usageError } from "../errors.js"
import { closeNames } from "../util.js"
import type { Condition } from "./conditions.js"

import { definitionKeyOf, records, str } from "./records.js"
import { activeTree } from "./tree.js"

/** BPMN processes read at most. */
const MAX_PROCESSES = 10
const ID_ATTRIBUTE = /\sid\s*=\s*(["'])(.*?)\1/g
const CALL_ACTIVITY = /<(?:[\w.-]+:)?callActivity\b([^>]*)>/g
const CALLED_ELEMENT = /\scalledElement\s*=\s*(["'])(.*?)\1/
const BINDING = /\s(?:[\w.-]+:)?calledElementBinding\s*=\s*(["'])(.*?)\1/
/** Activity instances of a multi-instance body carry this suffix after the activity id. */
const BODY_SUFFIX = /#multiInstanceBody$/

interface Bpmn {
  readonly ids: readonly string[]
  /** The process keys of the call activities. */
  readonly calls: readonly string[]
}

/**
 * The element ids of a BPMN XML and the keys its call activities call; undefined when a call is
 * not static (an expression, a CMMN case, a binding other than `latest`).
 */
export function parseBpmn(xml: string): Bpmn | undefined {
  const ids = [...xml.matchAll(ID_ATTRIBUTE)].map((match) => match[2] ?? "")
  const calls: string[] = []
  for (const [, attributes = ""] of xml.matchAll(CALL_ACTIVITY)) {
    const called = CALLED_ELEMENT.exec(attributes)?.[2]
    const binding = BINDING.exec(attributes)?.[2] ?? "latest"
    if (called === undefined || /[$#]\{/.test(called) || binding !== "latest") return undefined
    calls.push(called)
  }
  return { ids, calls }
}

type Source = readonly [operationId: string, argument: string]

async function bpmnOf(port: EnginePort, [operationId, argument]: Source) {
  const dto = records([await port.find(operationId, { pathArgs: [argument], query: {} })])[0]
  const xml = str(dto, "bpmn20Xml")
  return xml === undefined ? undefined : parseBpmn(xml)
}

/**
 * The element ids of the given process definitions (exact versions) and of the latest version of
 * every process they call, breadth first; undefined when unsure.
 */
async function elementIds(port: EnginePort, definitionIds: readonly string[]) {
  const ids = new Set<string>()
  const keys = new Set(definitionIds.map((id) => definitionKeyOf(id) ?? id))
  const queue: Source[] = definitionIds.map((id) => ["getProcessDefinitionBpmn20Xml", id])
  for (let index = 0; index < queue.length; index++) {
    const source = queue[index]
    const bpmn =
      source === undefined || index >= MAX_PROCESSES ? undefined : await bpmnOf(port, source)
    if (bpmn === undefined) return undefined
    for (const id of bpmn.ids) ids.add(id)
    const called = bpmn.calls.filter((key) => !keys.has(key))
    for (const key of called) keys.add(key)
    queue.push(...called.map((key): Source => ["getProcessDefinitionBpmn20XmlByKey", key]))
  }
  return { ids, keys: [...keys] }
}

/** The ids known for the running instance `id`; undefined when it is not running or unsure. */
async function knownIds(port: EnginePort, id: string) {
  try {
    const runtime = records([
      await port.find("getProcessInstance", { pathArgs: [id], query: {} }),
    ])[0]
    if (runtime === undefined || str(runtime, "tenantId") !== undefined) return undefined
    const tree = await activeTree(port, runtime)
    if (tree.truncated) return undefined
    return await elementIds(port, [...new Set(tree.nodes.map((node) => node.definitionId))])
  } catch (error) {
    // the polls report errors of the engine; the check only helps when it can
    if (error instanceof OperateError) return undefined
    throw error
  }
}

interface Wanted {
  readonly label: string
  readonly id: string
}

function wantedOf(conditions: readonly Condition[]): Wanted[] {
  return conditions.flatMap((condition): Wanted[] => {
    if (condition.kind === "activity") {
      return [{ label: `activity:${condition.id}`, id: condition.id.replace(BODY_SUFFIX, "") }]
    }
    if (condition.kind === "task" && condition.key !== undefined) {
      return [{ label: `task:${condition.key}`, id: condition.key }]
    }
    return []
  })
}

/** USAGE for `--until` ids that occur in none of the processes; nothing when unsure. */
export async function checkUntil(
  port: EnginePort,
  id: string,
  conditions: readonly Condition[],
): Promise<void> {
  const wanted = wantedOf(conditions)
  if (wanted.length === 0) return
  const known = await knownIds(port, id)
  if (known === undefined) return
  const [first, ...more] = wanted.filter((entry) => !known.ids.has(entry.id))
  if (first === undefined) return
  const labels = [first, ...more].map((entry) => entry.label).join(", ")
  const close = closeNames(first.id, [...known.ids])
  const prefix = first.label.slice(0, first.label.indexOf(":") + 1)
  const suggestion =
    close.length > 0 ? `Did you mean ${close.map((name) => prefix + name).join(", ")}? ` : ""
  throw usageError(
    `--until ${labels}: no such element in the BPMN of ${known.keys.join(", ")}`,
    `${suggestion}Activity ids and task definition keys are the ids of the BPMN elements; \`operate process-definition xml ${known.keys[0] ?? "<key>"}\` shows them.`,
  )
}
