/**
 * The same numbers on both surfaces, the MCP server's half: c7-core's recorded board engine
 * (`C7_BOARD_ENGINE`, a board over one engine and that engine's answers, recorded from the
 * conformance world on Operaton) served on loopback by the transport's recorded engine, read
 * through the board feed over the server's own wire (the module's configuration and plugin,
 * `engine_board_data`, the generated SDK on the engine connection). The feed gives exactly the
 * board the recording expects, the one the editors' C7 adapter builds from the same answers over
 * its wire (the C7 adapter's test/c7-board-numbers.test.ts); the cockpit renders it in
 * widgets/board/board-view.numbers.test.tsx.
 */

import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import type { z } from "zod"
import { recordingModuleServer } from "@miragon/pulse-widget-shell/testing"
import { C7_BOARD_ENGINE } from "@miragon/pulse-c7-core/testing"
import { type RecordedEngine, startRecordedEngine } from "@miragon/pulse-http/testing/loopback"
import { engineModule } from "../module.js"
import { ENGINE_BOARD_DATA } from "../tool-names.js"
import { feedPayload } from "../tools/test-support/feed-payload.js"
import type { BoardStartData } from "../view-models.board.js"

const engines: RecordedEngine[] = []
const dirs: string[] = []
afterEach(async () => {
  await Promise.all(engines.splice(0).map((engine) => engine.close()))
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

/**
 * The server with the recorded engine as its one profile, under the name the board gives it (an
 * Operaton, as recorded), and the board's file as `orders.board.json` in ENGINE_BOARDS_DIR.
 */
async function boot() {
  const engine = await startRecordedEngine(C7_BOARD_ENGINE.answers)
  engines.push(engine)
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-board-numbers-"))
  dirs.push(dir)
  fs.writeFileSync(path.join(dir, "orders.board.json"), C7_BOARD_ENGINE.text)
  const config = engineModule.configFromEnv({
    ENGINES_JSON: JSON.stringify({
      profiles: {
        [C7_BOARD_ENGINE.engine]: { url: `${engine.origin}/engine-rest`, flavor: "operaton" },
      },
    }),
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

describe("the board feed over c7-core's recorded board engine", () => {
  it("asks the engine only what it answered and gives the board the recording expects", async () => {
    const { engine, read } = await boot()
    const { asOf, ...board } = await read()
    expect(engine.unanswered).toEqual([])
    expect(Date.parse(asOf)).not.toBeNaN()
    expect(board).toEqual(C7_BOARD_ENGINE.expected)
  })
})
