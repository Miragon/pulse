/**
 * One engine of the family's answers to the reads of the screens Pulse's surfaces share
 * (`@miragon/pulse-screens`), and the screens both of Pulse's C7 wires build from them: the
 * editors' C7 adapter over its own wire, and the MCP server's engine connector over the generated
 * SDK once its screen feeds read them. Each serves the answers on the transport's recorded engine
 * (`startRecordedEngine` of @miragon/pulse-http/testing/loopback), builds the screens at `asOf`
 * and must give exactly the expected ones, so a screen shows the same numbers on every surface
 * without an engine. The answers are those of the board engine's recording (`C7_BOARD_ENGINE`),
 * from the same seeded world, since the engine screen reads a part of what a board reads; a screen
 * that reads more brings its answers in a recording of its own. A request the runtime changes
 * misses its answer and is named.
 */

import type { C7RecordedAnswer } from "./board-engine.js"
import recording from "./screen-engine.json" with { type: "json" }

/** The screens, each in the JSON form of @miragon/pulse-screens. */
export interface C7ExpectedScreens {
  /** The engine screen, `EngineScreenData`. */
  readonly engine: unknown
}

/** The recorded screen engine: its engine's answers and the screens they give. */
export interface C7ScreenEngine {
  /** Where the answers come from. */
  readonly about: string
  /** The name a surface gives the engine it configures over the answers. */
  readonly engine: string
  /** The time a surface builds the screens at, as ISO text. */
  readonly asOf: string
  /** The engine's answers under its REST root, `/engine-rest`. */
  readonly answers: readonly C7RecordedAnswer[]
  /** The screens every wire builds from the answers. */
  readonly expected: C7ExpectedScreens
}

export const C7_SCREEN_ENGINE: C7ScreenEngine = {
  about: recording.about,
  engine: recording.engine,
  asOf: recording.asOf,
  answers: recording.answers,
  expected: recording.expected,
}
