import recording from "./board-engine.json" with { type: "json" }

interface C8RecordedRequest {
  readonly method: string
  readonly path: string
  readonly query?: Readonly<Record<string, string>>
  readonly body?: unknown
}

export type C8RecordedAnswer = C8RecordedRequest &
  ({ readonly answer: unknown } | { readonly text: string; readonly contentType: string })

export interface C8BoardEngine {
  readonly about: string
  readonly engine: string
  readonly text: string
  readonly answers: readonly C8RecordedAnswer[]
  readonly expected: unknown
}

export const C8_BOARD_ENGINE: C8BoardEngine = {
  about: recording.about,
  engine: recording.engine,
  text: `${JSON.stringify(recording.file, undefined, 2)}\n`,
  answers: recording.answers,
  expected: recording.expected,
}
