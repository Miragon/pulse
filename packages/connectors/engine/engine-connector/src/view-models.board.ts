import type { BoardData } from "@miragon/pulse-board"

/**
 * A board as the board feed (`engine_board_data`) gives it: the one JSON form of a built board
 * (`BoardData`, which `BoardJson.of` of @miragon/pulse-board makes, the form Pulse for VS Code and
 * Pulse for Orca hand their webview), and when it was read. A failed engine carries its failure
 * as `{ code, message }`: `ENGINE_PROFILE_REFUSED` for a profile the server refused (its message
 * the one a tool call to that engine gives), else the engine contract's failure kind of the read
 * that failed, with the message the model reads for it. A number that was not read is left out,
 * never 0.
 */
export interface BoardStartData extends BoardData {
  /**
   * When the reads of this build started (ISO 8601): the feed keeps a build per caller and board
   * for 30 seconds, so a refresh within them shows the same time.
   */
  readonly asOf: string
}

/** A board of ENGINE_BOARDS_DIR as the engine list names it: its id, its title, its engines. */
export interface ListedBoard {
  readonly id: string
  readonly title: string
  readonly engines: readonly string[]
}

/**
 * A board file that gives no board, as the engine list names it: its id and how many problems it
 * has, never their text (the server's log has them at startup).
 */
export interface ListedRefusedBoard {
  readonly id: string
  readonly problems: number
}

/**
 * The landing's start data (`engine_open_cockpit` view `landing`): the server's boards as
 * `engine_list_engines` lists them, from one builder (`data/landing-data.ts`) and without an
 * engine read. `boards` only with ENGINE_BOARDS_DIR, `refusedBoards` only where a file gives no
 * board. The landing has no feed of its own: its widgets read the engine list, which these seed
 * until it answers.
 */
export interface LandingStartData {
  readonly boards?: readonly ListedBoard[]
  readonly refusedBoards?: readonly ListedRefusedBoard[]
}
