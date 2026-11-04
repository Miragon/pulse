/**
 * The usage errors of `pulse advance` that name places and options: the flag and text of each
 * option, the ready commands of an ambiguous choice and the hint when nothing can move. Pure.
 */

import {
  type AdvanceOption,
  byActivity,
  type WaitKind,
  type WaitState,
  type WorkflowErrorReason,
  waitId,
} from "@miragon/pulse-engine-core"
import { PulseCliError, usageError } from "../errors.js"
import { itemCommand } from "./next-text.js"
import { shellWord } from "./shell.js"

const READY_COMMANDS = 3

/** The flag of each option. */
const FLAGS: Readonly<Record<AdvanceOption, string>> = {
  variables: "--var",
  localVariables: "--local-var",
  bpmnError: "--bpmn-error",
  errorMessage: "--error-message",
  fail: "--fail",
  retries: "--retries",
  workerId: "--worker-id",
}

/** How the usage error names the wait kinds an option applies to (`other`: receive tasks). */
const KIND_NOUNS: Readonly<Record<WaitKind, string>> = {
  userTask: "user tasks",
  externalTask: "external tasks",
  timer: "timers",
  asyncContinuation: "asynchronous continuations",
  message: "messages",
  signal: "signals",
  conditional: "conditional events",
  other: "receive tasks",
}

/** `a`, `a and b`, `a, b and c`. */
function listText(words: readonly string[]): string {
  const last = words.at(-1) ?? ""
  return words.length < 2 ? last : `${words.slice(0, -1).join(", ")} and ${last}`
}

type Reason<K extends WorkflowErrorReason["kind"]> = Extract<WorkflowErrorReason, { kind: K }>

/** The generated command that moves one wait state, for multi-instance hints. */
function itemHint(wait: WaitState): string {
  if (wait.kind === "userTask") return `${itemCommand(wait) ?? ""} --var ...`
  return (
    itemCommand(wait) ??
    `pulse external-task complete ${waitId(wait)} --worker-id <worker> (after locking it)`
  )
}

function candidate(id: string, wait: WaitState) {
  return {
    activityId: wait.activityId,
    kind: wait.kind,
    id: waitId(wait),
    processInstanceId: wait.processInstanceId ?? id,
  }
}

/**
 * A ready command per place: `pulse advance <id> --activity-id <a>` with the other options of
 * the command line, or the generated command of the first item of a multi-instance activity
 * (`advance --activity-id` refuses to pick one of its items).
 */
function placeCommand(id: string, waits: readonly WaitState[], options: string): string {
  const [first, ...more] = waits
  if (first === undefined) return ""
  if (more.length > 0) return itemHint(first)
  return `pulse advance ${id} --activity-id ${shellWord(first.activityId)}${options}`
}

/** Several wait states could move; `options` are the other words of the command line. */
export function several(
  reason: Reason<"advance-ambiguous">,
  options: readonly string[],
): PulseCliError {
  const { id, waits } = reason
  const places = [...byActivity(waits).values()]
  const data = { candidates: waits.map((wait) => candidate(id, wait)) }
  if (places.length === 1) {
    const items = waits.slice(0, READY_COMMANDS).map(itemHint)
    return new PulseCliError(
      "USAGE",
      `Process instance ${id} waits ${waits.length} times at ${waits[0]?.activityId ?? ""}`,
      { hint: `Move one item with its generated command: ${items.join(", ")}.`, data },
    )
  }
  const others = options.map((word) => ` ${word}`).join("")
  const ready = places.slice(0, READY_COMMANDS).map((place) => placeCommand(id, place, others))
  return new PulseCliError(
    "USAGE",
    `Process instance ${id} waits at ${places.length} places; choose one with --activity-id`,
    { hint: `Choose one: ${ready.join(", ")}.`, data },
  )
}

/** Nothing to move (at the activity). */
export function nothing(reason: Reason<"advance-nothing">): PulseCliError {
  const { id, activityId } = reason
  const waiting = reason.waiting.map((wait) => `${wait.activityId} (${wait.kind})`)
  if (activityId !== undefined && waiting.length > 0) {
    return usageError(
      `Process instance ${id} does not wait at ${activityId}`,
      `It waits at: ${waiting.join(", ")}.`,
    )
  }
  let hint = `\`pulse inspect ${id}\` shows where it waits.`
  if (reason.conditional) {
    hint = `Conditional events react to variables: \`pulse process-instance set-variable ${id} <name> --value <value>\`.`
  } else if (reason.firstChildId !== undefined) {
    hint = `The instance tree was cut; inspect the called instances, e.g. \`pulse inspect ${reason.firstChildId}\`.`
  }
  return usageError(`Process instance ${id} waits at nothing pulse can advance`, hint)
}

/** An option that does not apply to the chosen wait state. */
export function optionKind(reason: Reason<"advance-option-kind">): PulseCliError {
  const kinds = listText(reason.appliesTo.map((kind) => KIND_NOUNS[kind]))
  return usageError(
    `${FLAGS[reason.option]} applies to ${kinds} only; ${reason.activityId} is a ${reason.waitKind}`,
    "Run `pulse advance --help` for the options per kind.",
  )
}

const INPUT_RULES = {
  "bpmn-error-excludes-fail": [
    "--bpmn-error excludes --fail",
    "Throw a BPMN error or report a failure, not both.",
  ],
  "error-message-needs-bpmn-error": [
    "--error-message needs --bpmn-error",
    "--fail <message> carries the message of a failure.",
  ],
  "retries-need-fail": ["--retries needs --fail", 'Example: --fail "Card declined" --retries 2'],
} as const

/** An option combination advance refuses. */
export function inputRule(reason: Reason<"advance-input">): PulseCliError {
  const [message, hint] = INPUT_RULES[reason.rule]
  return usageError(message, hint)
}
