import type { C8RecordedAnswer } from "./board-engine.js"
import recording from "./screen-engine.json" with { type: "json" }

export interface C8ExpectedScreens {
  readonly engine: unknown
  readonly instance: unknown
  readonly calledInstance: unknown
  readonly process: unknown
  readonly olderVersion: unknown
  readonly callingProcess: unknown
  readonly instanceList: unknown
  readonly find: unknown
  readonly findById: unknown
}

export interface C8ScreenEngine {
  readonly about: string
  readonly engine: string
  readonly asOf: string
  readonly answers: readonly C8RecordedAnswer[]
  readonly expected: C8ExpectedScreens
}

export const C8_SCREEN_ENGINE: C8ScreenEngine = {
  about: recording.about,
  engine: recording.engine,
  asOf: recording.asOf,
  answers: recording.answers,
  expected: recording.expected,
}
