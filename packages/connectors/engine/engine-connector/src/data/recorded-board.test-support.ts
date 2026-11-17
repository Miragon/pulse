/**
 * The board feed over a dialect's recorded board engine (c7-core's `C7_BOARD_ENGINE`, c8-core's
 * `C8_BOARD_ENGINE`): the transport's recorded engine on loopback, the module's configuration and
 * plugin with that engine as its one profile under the name the board gives it, and the board's
 * file as `orders.board.json` in ENGINE_BOARDS_DIR. The numbers test reads it whole, the degrade
 * table with one recorded answer left out at a time.
 */

import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import type { z } from "zod"
import { recordingModuleServer } from "@miragon/pulse-widget-shell/testing"
import { C7_BOARD_ENGINE } from "@miragon/pulse-c7-core/testing"
import { C8_BOARD_ENGINE } from "@miragon/pulse-c8-core/testing"
import {
  type RecordedAnswer,
  type RecordedEngine,
  startRecordedEngine,
} from "@miragon/pulse-http/testing/loopback"
import { engineModule } from "../module.js"
import { ENGINE_BOARD_DATA } from "../tool-names.js"
import { feedPayload } from "../tools/test-support/feed-payload.js"
import type { BoardStartData } from "../view-models.board.js"

/** A recorded board engine of a dialect, and the profile the server reads it through. */
export interface Recorded {
  readonly board: typeof C7_BOARD_ENGINE | typeof C8_BOARD_ENGINE
  readonly profile: (origin: string) => Record<string, unknown>
}

/** Operaton, as recorded, at its REST root. */
export const RECORDED_C7: Recorded = {
  board: C7_BOARD_ENGINE,
  profile: (origin) => ({ url: `${origin}/engine-rest`, flavor: "operaton" }),
}

/** A Camunda 8 cluster without security, as recorded, at its REST root. */
export const RECORDED_C8: Recorded = {
  board: C8_BOARD_ENGINE,
  profile: (origin) => ({ url: `${origin}/v2`, flavor: "camunda8" }),
}

const engines: RecordedEngine[] = []
const dirs: string[] = []

/** Closes the engines and removes the board directories of the boots so far: `afterEach`. */
export async function closeRecordedBoards(): Promise<void> {
  await Promise.all(engines.splice(0).map((engine) => engine.close()))
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
}

/** The server over `recorded`, its engine answering `answers` (by default every recorded one). */
export async function bootRecordedBoard(
  { board, profile }: Recorded,
  answers: readonly RecordedAnswer[] = board.answers,
) {
  const engine = await startRecordedEngine(answers)
  engines.push(engine)
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-board-numbers-"))
  dirs.push(dir)
  fs.writeFileSync(path.join(dir, "orders.board.json"), board.text)
  const config = engineModule.configFromEnv({
    ENGINES_JSON: JSON.stringify({ profiles: { [board.engine]: profile(engine.origin) } }),
    ENGINE_BOARDS_DIR: dir,
  })
  const recording = recordingModuleServer()
  engineModule.createPlugin(config).register(recording.server)
  const feed = recording.tool(ENGINE_BOARD_DATA)
  const read = async () =>
    feedPayload<BoardStartData>(
      await feed.call((feed.config.inputSchema as z.ZodObject).parse({ board: "orders" })),
    )
  return { engine, read }
}
