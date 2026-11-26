/**
 * A board over one engine of the family and that engine's answers to the board's reads, recorded
 * once from the conformance world (`seedC7World`) on Operaton 2.1.5, with the board both of
 * Pulse's C7 wires build from them: the MCP server's engine connector over the generated SDK and
 * the editors' C7 adapter over its own wire each serve the answers on the transport's recorded
 * engine (`startRecordedEngine` of @miragon/pulse-http/testing/loopback) and must build exactly
 * the expected board, so a board shows the same numbers on every surface without an engine. A
 * request the runtime changes misses its answer and is named. No script records the answers; the
 * package's README says how to record them again by hand.
 */

import recording from "./board-engine.json" with { type: "json" }

/**
 * The request of a recorded answer: its method, its path below the origin, decoded, its query and
 * its JSON body.
 */
interface C7RecordedRequest {
  readonly method: string
  readonly path: string
  readonly query?: Readonly<Record<string, string>>
  readonly body?: unknown
}

/**
 * One answer of the engine as recorded: the request and the JSON the engine answered with, or for
 * an answer that is no JSON (a job's stack trace) the text with its content type, status 200. It is
 * a structural copy of `RecordedAnswer` of @miragon/pulse-http/testing/loopback.
 */
export type C7RecordedAnswer = C7RecordedRequest &
  ({ readonly answer: unknown } | { readonly text: string; readonly contentType: string })

/** The recorded board engine: the board's file, its engine's answers and the board they give. */
export interface C7BoardEngine {
  /** Where the answers come from and what the board holds. */
  readonly about: string
  /** The name the board gives its one engine, which a surface configures over the answers. */
  readonly engine: string
  /** The text of the board's file (`.board.json`): every widget over it and a refused one. */
  readonly text: string
  /** The engine's answers under its REST root, `/engine-rest`. */
  readonly answers: readonly C7RecordedAnswer[]
  /** The board both wires build from the answers, as `BoardData` of @miragon/pulse-board. */
  readonly expected: unknown
}

export const C7_BOARD_ENGINE: C7BoardEngine = {
  about: recording.about,
  engine: recording.engine,
  text: `${JSON.stringify(recording.file, undefined, 2)}\n`,
  answers: recording.answers,
  expected: recording.expected,
}
