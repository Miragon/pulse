/**
 * The board files of the MCP server as its parts hand them on, without the file system: a board's
 * id rule, a board that a file gives and a file that gives none, and the words of a problem.
 * `engine-boards.ts` reads them from ENGINE_BOARDS_DIR at configuration; the board feed
 * (`data/board-data.ts`) builds them.
 */

import { type BoardDefinition, type BoardProblem, BoardProblems } from "@miragon/pulse-board"

/** The end of a board file's name, as Pulse for VS Code and Pulse for Orca name theirs. */
export const BOARD_FILE_SUFFIX = ".board.json"

/**
 * A board's id: its file name without `.board.json`, a letter or digit first, then letters,
 * digits, `.`, `_` and `-`, 64 at most. The editors' new boards are named so.
 */
export const BOARD_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/

/** A board file that gives a board: its id, its file's name, the board and the file's notes. */
export interface EngineBoard {
  readonly id: string
  readonly file: string
  readonly board: BoardDefinition
  readonly notes: readonly BoardProblem[]
}

/** A board file that gives no board: its id, its file's name and every problem of the file. */
export interface RefusedBoard {
  readonly id: string
  readonly file: string
  readonly problems: readonly BoardProblem[]
}

/** The boards of one directory, each in the order of its file's name. */
export interface BoardFiles {
  readonly boards: readonly EngineBoard[]
  readonly refused: readonly RefusedBoard[]
}

/** A problem as the format words it, after its JSON path. */
export function boardProblemSentence(problem: BoardProblem): string {
  return `${problem.path} ${BoardProblems.describe(problem)}`
}
