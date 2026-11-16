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
