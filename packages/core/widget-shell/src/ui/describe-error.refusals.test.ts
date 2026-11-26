import { describe, expect, it } from "vitest"
import { classifyError, describeError, isPermanentError } from "./describe-error.js"
import { PAGE_HINTS } from "./page-hints.js"

/**
 * The engine module's refusals of the engine and the process a call names: no engine of several
 * without a default (ENGINE_NOT_SELECTED), an engine the server does not have (UNKNOWN_ENGINE)
 * and a process key no version of which is deployed (a model tool's text, no code). Each is a
 * named kind no retry changes, worded in English and German; a Claude artifact's words are its
 * own (`ARTIFACT_PAGE_HINTS`, held by kit-words.test.ts).
 */

/** The engine module's refusals of a call's engine and process, as its tools give them. */
const NOT_SELECTED =
  "[ENGINE_NOT_SELECTED] No engine specified and no default engine configured. Pass `engine`, one of: prod-a, prod-b."
const UNKNOWN_ENGINE = '[UNKNOWN_ENGINE] Unknown engine id "prod-c". Available: prod-a, prod-b.'
const UNKNOWN_PROCESS = 'No process definition with key "orders" is deployed on this engine.'

describe("describeError: the engine and the process a call names", () => {
  it("no engine selected, an engine the server lacks and a process not deployed: named, worded, en and de", () => {
    expect(describeError(NOT_SELECTED, "en")).toEqual({
      kind: "engineNotSelected",
      title: "No engine is selected",
      hint: "This server has several engines and no default one. Pick one of them.",
      details: NOT_SELECTED,
    })
    expect(describeError(UNKNOWN_ENGINE, "de")).toMatchObject({
      kind: "unknownEngine",
      title: "Diese Engine gibt es auf diesem Server nicht",
      hint: "Die Engines, die er hat, stehen unter Details. Wähl eine davon.",
    })
    expect(describeError(new Error(UNKNOWN_PROCESS), "en")).toMatchObject({
      kind: "unknownProcess",
      title: "This process isn't deployed on the engine",
      hint: "Check the process, or pick another engine.",
      details: UNKNOWN_PROCESS,
    })
    expect(describeError(UNKNOWN_PROCESS, "de").title).toBe(
      "Dieser Prozess ist auf der Engine nicht bereitgestellt",
    )
  })

  it("no retry changes them: the view neither retries them nor offers Try again", () => {
    for (const text of [NOT_SELECTED, UNKNOWN_ENGINE, UNKNOWN_PROCESS]) {
      expect(isPermanentError(new Error(text)), text).toBe(true)
    }
    // Anchored: an engine's message that quotes one is the engine's failure, retried as such.
    for (const quoted of [
      `[500 ProcessEngineException] Script failed on "${UNKNOWN_PROCESS}" (engine prod)`,
      "Engine said: [UNKNOWN_ENGINE] x",
      `(${NOT_SELECTED})`,
    ]) {
      expect(isPermanentError(quoted), quoted).toBe(false)
    }
  })

  it("read the engine as their source, and a web page says what a chat says", () => {
    expect(classifyError(NOT_SELECTED)).toMatchObject({ kind: "engineNotSelected" })
    expect(classifyError(UNKNOWN_PROCESS).source).toEqual({ type: "engine" })
    // None of their words sends the reader to a chat, so a page of the web app needs none of its
    // own.
    for (const text of [NOT_SELECTED, UNKNOWN_ENGINE, UNKNOWN_PROCESS]) {
      expect(describeError(text, "en", { followUp: "none", pageHints: PAGE_HINTS }).hint).toBe(
        describeError(text, "en").hint,
      )
    }
  })
})
