import { describe, expect, it } from "vitest"
import {
  classifyError,
  describeError,
  isPermanentError,
  isSessionEnded,
  leadsToStartPage,
} from "./describe-error.js"
import { PAGE_HINTS } from "./page-hints.js"
import { WebApiError } from "./web-caller.js"

/**
 * The words on a page that posts to no chat (`followUp` other than `chat`, its host's `pageHints`),
 * and the refusals no retry changes that a page meets at its start or when its session ends: a
 * board the server does not show, a board file that gives none, arguments the tool does not take,
 * a session gone.
 */

/** A page's options, as its host gives them (`useErrorWords`). */
const PAGE = { followUp: "none", pageHints: PAGE_HINTS } as const

const UNKNOWN_BOARD = '[UNKNOWN_BOARD] Unknown board id "shipping". Boards: invoices.'
const BOARD_REFUSED =
  '[BOARD_REFUSED] Board "broken" cannot be shown. Its file broken.board.json gives no board: title is missing. Ask whoever runs this server to fix it.'
const INVALID_VIEW =
  'Input validation error: Invalid arguments for tool engine_open_cockpit: view: Invalid option: expected one of "overview"|"jobs"'
const signedOut = () => new WebApiError(401, { code: "signed_out", message: "No session." })
/** What the engine module answers for a call that does not read its engine's dialect. */
const NOT_SERVED =
  '[ENGINE_DIALECT_NOT_SERVED] Engine "orders-c8" is a Camunda 8 engine, and this tool or view reads the Camunda 7 REST API (Camunda 7, CIB seven, Operaton), so nothing was sent. On this server engine_get_screen and engine_get_board read a Camunda 8 engine, engine_open_cockpit shows it (view board or landing); no board names "orders-c8" yet, the server\'s operator adds one.'

const CHAT = { en: /\bchat\b/i, de: /\bChat\b/ } as const

describe("describeError on a page", () => {
  it.each([
    ["[500 ProcessEngineException] Cannot resolve incident (engine prod)", "failed"],
    ["Something odd happened", "unknown"],
    ["Tool engine_jobs_data not found", "notOnServer"],
    [INVALID_VIEW, "invalidArguments"],
    [UNKNOWN_BOARD, "unknownBoard"],
    [NOT_SERVED, "notServed"],
  ] as const)("%s: a chat's words ask in the chat, a page's never do", (raw, kind) => {
    for (const locale of ["en", "de"] as const) {
      const chat = describeError(new Error(raw), locale)
      expect(chat.kind).toBe(kind)
      expect(chat.hint).toMatch(CHAT[locale])
      for (const followUp of ["none", "copy"] as const) {
        const page = describeError(new Error(raw), locale, { followUp, pageHints: PAGE_HINTS })
        expect(page.title).toBe(chat.title)
        expect(page.hint).not.toMatch(CHAT[locale])
      }
    }
  })

  it("says what to do on the page instead, en and de", () => {
    const page = PAGE
    expect(describeError("Something odd happened", "en", page).hint).toBe(
      "Try again. If it fails again, reload the page.",
    )
    expect(describeError("Something odd happened", "de", page).hint).toBe(
      "Versuch es noch mal. Klappt es wieder nicht, lade die Seite neu.",
    )
    expect(describeError(UNKNOWN_BOARD, "en", page).hint).toBe(
      "Go to Pulse's start page, which shows this server's boards and engines.",
    )
  })

  it("keeps the chat's words without a followUp, as before a host told", () => {
    expect(describeError("Something odd happened", "en").hint).toBe(
      "Try again. If it fails again, ask in the chat.",
    )
  })

  it("takes a page's words from its host alone, so a chat's bundle carries none", () => {
    // A chat's host brings no page hints: even with a page's followUp the kit has only a chat's.
    expect(describeError("Something odd happened", "en", { followUp: "none" }).hint).toBe(
      "Try again. If it fails again, ask in the chat.",
    )
    // A page's host words only the kinds whose chat words send the reader to the chat.
    expect(Object.keys(PAGE_HINTS.en).sort()).toEqual(Object.keys(PAGE_HINTS.de).sort())
    expect(describeError(BOARD_REFUSED, "en", PAGE).hint).toBe(
      describeError(BOARD_REFUSED, "en").hint,
    )
  })
})

describe("the refusals no retry changes", () => {
  it("a board the server does not show: what happened in the box, the boards under Details", () => {
    expect(describeError(new Error(UNKNOWN_BOARD), "en", PAGE)).toEqual({
      kind: "unknownBoard",
      title: "This board isn't on this server",
      hint: "Go to Pulse's start page, which shows this server's boards and engines.",
      details: UNKNOWN_BOARD,
    })
    expect(describeError(UNKNOWN_BOARD, "de").title).toBe(
      "Dieses Board gibt es auf diesem Server nicht",
    )
  })

  it("a board file that gives no board: its problems in the server's log, on every host", () => {
    for (const followUp of ["chat", "none"] as const) {
      expect(describeError(BOARD_REFUSED, "en", { followUp, pageHints: PAGE_HINTS })).toMatchObject(
        {
          kind: "boardRefused",
          title: "This board can't be shown: its file gives no board",
          hint: "Its problems are under Details and in the server's log at startup. Ask whoever runs this server to fix the file.",
        },
      )
    }
  })

  it("arguments the tool does not take, as the SDK words them, with or without its code", () => {
    expect(classifyError(INVALID_VIEW).kind).toBe("invalidArguments")
    expect(classifyError(`MCP error -32602: ${INVALID_VIEW}`).kind).toBe("invalidArguments")
    // As claude.ai's artifact runtime hands it on, without the SDK's lead (the probe of 2026-11-25).
    const bare = 'Invalid arguments for tool engine_activity_counts: Unknown key "n".'
    expect(classifyError(bare).kind).toBe("invalidArguments")
    expect(isPermanentError(bare)).toBe(true)
    expect(describeError(INVALID_VIEW, "en", PAGE)).toMatchObject({
      title: "The server refused this request",
      hint: "You'll find the reason under Details. Open the view from Pulse's start page instead.",
    })
  })

  it("an engine the call's dialect does not read: neutral words, the server's text under Details", () => {
    expect(describeError(new Error(NOT_SERVED), "en", PAGE)).toEqual({
      kind: "notServed",
      title: "This view doesn't read this engine",
      hint: "Pulse shows its processes and instances on pages of their own. Open the engine from Pulse's start page.",
      details: NOT_SERVED,
    })
    // A chat shows such an engine on boards only; a page shows its processes and instances on
    // screens of its own, which its start page leads to (the state's link).
    expect(leadsToStartPage("notServed")).toBe(true)
    expect(describeError(NOT_SERVED, "en")).toMatchObject({
      hint: "Pulse shows it here on boards. Ask in the chat about it or its boards.",
    })
    expect(describeError(NOT_SERVED, "de")).toMatchObject({
      title: "Diese Ansicht liest diese Engine nicht",
      hint: "Pulse zeigt sie hier auf Boards. Frag im Chat nach ihr oder ihren Boards.",
    })
    expect(describeError(NOT_SERVED, "de", PAGE)).toMatchObject({
      hint: "Pulse zeigt ihre Prozesse und Instanzen auf eigenen Seiten. Öffne die Engine über die Startseite von Pulse.",
    })
    expect(classifyError(NOT_SERVED).source).toEqual({ type: "engine", id: "orders-c8" })
    // The words name no dialect: the server's text does, under Details.
    for (const locale of ["en", "de"] as const) {
      for (const followUp of ["chat", "none"] as const) {
        const { title, hint } = describeError(NOT_SERVED, locale, {
          followUp,
          pageHints: PAGE_HINTS,
        })
        expect(`${title} ${hint}`).not.toMatch(/Camunda|CIB|Operaton|c8\b|dialect|Dialekt/i)
      }
    }
  })

  it("a page's call that found its session gone, by the web app's code, never its status", () => {
    expect(classifyError(signedOut())).toMatchObject({ kind: "signedOut", status: 401 })
    expect(describeError(signedOut(), "en", PAGE)).toMatchObject({
      title: "You're signed out",
      hint: "Sign in again to see the current state.",
    })
    expect(describeError(signedOut(), "de").title).toBe("Du bist abgemeldet")
    // Another 401 of the API, or an engine's, is no ended session.
    expect(classifyError(new WebApiError(401, { message: "No." })).kind).toBe("unauthorized")
    expect(classifyError({ code: "WEB_READ_ONLY", status: 403, message: "x" }).kind).toBe(
      "forbidden",
    )
  })

  it("is each permanent, a code an engine's message quotes none of them", () => {
    for (const error of [UNKNOWN_BOARD, BOARD_REFUSED, INVALID_VIEW, NOT_SERVED, signedOut()]) {
      expect(isPermanentError(error)).toBe(true)
    }
    for (const code of [
      "[UNKNOWN_BOARD]",
      "[BOARD_REFUSED]",
      "[ENGINE_DIALECT_NOT_SERVED]",
      "Input validation error: ",
      "Invalid arguments for tool x: ",
    ]) {
      const quoted = `[500 ProcessEngineException] Script failed on "${code}x" (engine prod)`
      expect(classifyError(quoted).kind).toBe("failed")
      expect(isPermanentError(quoted)).toBe(false)
    }
  })
})

describe("what a page does with a refusal", () => {
  it("says its session ended in its frame alone: only that refusal is the frame's", () => {
    expect(isSessionEnded(signedOut())).toBe(true)
    for (const error of [
      UNKNOWN_BOARD,
      INVALID_VIEW,
      new WebApiError(401, { message: "No." }),
      "[401] The engine rejected the configured credentials (engine prod)",
    ]) {
      expect(isSessionEnded(error)).toBe(false)
    }
  })

  it("links to its start page where the words lead there, and nowhere else", () => {
    const kinds = (errors: unknown[]) => errors.map((error) => classifyError(error).kind)
    for (const kind of kinds([
      UNKNOWN_BOARD,
      INVALID_VIEW,
      NOT_SERVED,
      "Tool engine_jobs_data not found",
    ])) {
      expect(leadsToStartPage(kind)).toBe(true)
    }
    for (const kind of kinds([BOARD_REFUSED, signedOut(), "Something odd happened"])) {
      expect(leadsToStartPage(kind)).toBe(false)
    }
  })
})
