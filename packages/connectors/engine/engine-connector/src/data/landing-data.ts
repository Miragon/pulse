/**
 * The landing's data and facts (`engine_open_cockpit` view `landing`, an app route): the server's
 * boards as `engine_list_engines` lists them, built once here for both, with no engine read (so no
 * `build*` name: the honest-numbers tables hold the builders of engine reads). The landing has no
 * feed of its own: its widgets read the engine list, which this seeds.
 */

import type { BoardFiles } from "../board-files.js"
import type { LandingStartData } from "../view-models.board.js"

/**
 * The boards of ENGINE_BOARDS_DIR as the engine list names them: each board's id (what
 * engine_open_cockpit's `board` takes), its title and the engines it names; a file that gives no
 * board with how many problems it has, never their text. Nothing without the directory.
 */
export function landingDataOf(files: BoardFiles | undefined): LandingStartData {
  if (files === undefined) return {}
  const { boards, refused } = files
  return {
    boards: boards.map(({ id, board }) => ({ id, title: board.title, engines: board.engines })),
    ...(refused.length > 0
      ? { refusedBoards: refused.map(({ id, problems }) => ({ id, problems: problems.length })) }
      : {}),
  }
}

const ids = (entries: readonly { id: string }[] | undefined) => entries?.map(({ id }) => id)

/**
 * The model's view of the landing: the engine ids the server lists and the board ids, as the list
 * names them (a board file's title is the operator's text and stays out).
 */
export function landingFacts(data: LandingStartData, engines: readonly string[]) {
  return { engines, boards: ids(data.boards), refusedBoards: ids(data.refusedBoards) }
}
