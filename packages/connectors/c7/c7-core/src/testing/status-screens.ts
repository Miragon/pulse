/**
 * The status world's screens (`seedC7StatusWorld`), Camunda 7's alone: the answers of the engine at
 * history level FULL to the reads of the process screen of `pulse-status-approval`, the instance
 * screen of APR-139-2, whose multi-instance body holds the root incident, and a board with a
 * diagram of that process, at one instant (`asOf`), and the screens and the board they give. The
 * editors' C7 adapter over its own wire and the MCP server's feeds over the generated SDK each serve
 * the answers on the transport's recorded engine (`startRecordedEngine` of
 * @miragon/pulse-http/testing/loopback) at `asOf` and must give exactly them, so the body's root
 * incident stands on the element it repeats on every C7 surface without an engine. It is no
 * conformance recording (`C7_SCREEN_ENGINE` and `C7_BOARD_ENGINE` are, held equal to Camunda 8's):
 * Camunda 8 has no such body. The recording script writes it beside `C7_STATUS_ENGINE`
 * (`pnpm record:status-world`, the package's README says how).
 */

import type { C7RecordedAnswer } from "./board-engine.js"
import recording from "./status-screens.json" with { type: "json" }

/** The screens and the board, each in the JSON form of @miragon/pulse-screens or pulse-board. */
export interface C7ExpectedStatusScreens {
  /**
   * The process screen of pulse-status-approval at its one version, `ProcessScreenData`: the
   * body's root incident and the items waiting on the element they repeat.
   */
  readonly process: unknown
  /**
   * The instance screen of APR-139-2, `InstanceScreenData`: its body's root incident on the
   * element the body repeats.
   */
  readonly instance: unknown
  /** The board the file gives, `BoardData` of @miragon/pulse-board, without the time it was read. */
  readonly board: unknown
}

/** The recorded status screens: their engine's answers, its board file and what they give. */
export interface C7StatusScreens {
  /** Where the answers come from. */
  readonly about: string
  /** The name the board gives its one engine, which a surface configures over the answers. */
  readonly engine: string
  /** The instant a surface builds the screens and the board at, as ISO text. */
  readonly asOf: string
  /** The text of the board's file (`.board.json`). */
  readonly text: string
  /** The engine's answers under its REST root, `/engine-rest`. */
  readonly answers: readonly C7RecordedAnswer[]
  /** The screens and the board every C7 wire builds from the answers. */
  readonly expected: C7ExpectedStatusScreens
}

export const C7_STATUS_SCREENS: C7StatusScreens = {
  about: recording.about,
  engine: recording.engine,
  asOf: recording.asOf,
  text: `${JSON.stringify(recording.file, undefined, 2)}\n`,
  answers: recording.answers,
  expected: recording.expected,
}
