import type { BoardParse } from "../format/board-parser.js"
import fixtures from "./board-fixtures.json" with { type: "json" }

export interface BoardFixture {
  readonly name: string
  readonly about: string
  readonly text: string
  readonly schema: boolean
  readonly verdict: BoardParse
}

interface FixtureEntry {
  readonly name: string
  readonly about: string
  readonly text?: string
  readonly file?: unknown
  readonly schema: boolean
  readonly verdict: BoardParse
}

class FixtureTexts {
  static of({ text, file, ...fixture }: FixtureEntry): BoardFixture {
    return { ...fixture, text: text ?? `${JSON.stringify(file, undefined, 2)}\n` }
  }
}

export const BOARD_FIXTURES: readonly BoardFixture[] = (fixtures as readonly FixtureEntry[]).map(
  (entry) => FixtureTexts.of(entry),
)
