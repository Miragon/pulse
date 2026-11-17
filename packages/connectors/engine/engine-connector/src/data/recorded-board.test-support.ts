/**
 * The board feed over a dialect's recorded board engine (c7-core's `C7_BOARD_ENGINE`, c8-core's
 * `C8_BOARD_ENGINE`): the transport's recorded engine on loopback, the module's configuration and
 * plugin with that engine as its one profile under the name the board gives it, and the board's
 * file as `orders.board.json` in ENGINE_BOARDS_DIR. The numbers test reads it whole, the degrade
 * table with one recorded answer left out at a time, and over a Camunda 8 cluster that says its
 * version as recorded and refuses every search for lack of secondary storage.
 */

import fs from "node:fs"
import http from "node:http"
import type { AddressInfo } from "node:net"
import os from "node:os"
import path from "node:path"
import type { z } from "zod"
import { recordingModuleServer } from "@miragon/pulse-widget-shell/testing"
import { C7_BOARD_ENGINE } from "@miragon/pulse-c7-core/testing"
import { C8_BOARD_ENGINE } from "@miragon/pulse-c8-core/testing"
import { type RecordedAnswer, startRecordedEngine } from "@miragon/pulse-http/testing/loopback"
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

const engines: BoardEngine[] = []
const dirs: string[] = []

/** Closes the engines and removes the board directories of the boots so far: `afterEach`. */
export async function closeRecordedBoards(): Promise<void> {
  await Promise.all(engines.splice(0).map((engine) => engine.close()))
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
}

/** An engine on loopback the board's server reads: its origin, the requests it did not answer. */
interface BoardEngine {
  readonly origin: string
  readonly unanswered: readonly unknown[]
  close(): Promise<void>
}

/** The server over `recorded`, its engine answering `answers` (by default every recorded one). */
export async function bootRecordedBoard(
  recorded: Recorded,
  answers: readonly RecordedAnswer[] = recorded.board.answers,
) {
  return bootBoardOver(recorded, await startRecordedEngine(answers))
}

/**
 * A Camunda 8 cluster that says its version as recorded and answers every other request with the
 * 403 of a cluster without secondary storage (its search API refused), each such request unanswered.
 */
export async function startWithoutSecondaryStorage(): Promise<BoardEngine> {
  const [topology] = C8_BOARD_ENGINE.answers
  const unanswered: string[] = []
  const server = http.createServer((request, response) => {
    const route = `${request.method ?? ""} ${request.url ?? ""}`
    const known = route === `${topology.method} ${topology.path}` && "answer" in topology
    if (!known) unanswered.push(route)
    response.writeHead(known ? 200 : 403, { "Content-Type": "application/json" })
    response.end(JSON.stringify(known ? topology.answer : NO_SECONDARY_STORAGE))
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const { port } = server.address() as AddressInfo
  return {
    origin: `http://127.0.0.1:${String(port)}`,
    unanswered,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  }
}

/** The problem a Camunda 8 cluster without secondary storage states for its search API. */
const NO_SECONDARY_STORAGE = {
  type: "about:blank",
  title: "FORBIDDEN",
  status: 403,
  detail:
    "This endpoint requires a secondary storage, but none is set. Secondary storage can be " +
    "configured using the 'camunda.data.secondary-storage.type' property.",
}

/** The server over `recorded`'s board and profile, reading `engine`. */
export async function bootBoardOver({ board, profile }: Recorded, engine: BoardEngine) {
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
