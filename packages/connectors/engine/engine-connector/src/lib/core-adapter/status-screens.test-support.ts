/**
 * The status world's screens as the server's feeds give them, read through the module's own feeds
 * as a page calls them: the process screen of pulse-status-approval (`engine_screen_process_data`),
 * the instance screen of APR-139-2, whose multi-instance body holds the root incident
 * (`engine_screen_instance_data`), and a board with a diagram of that process (`engine_board_data`,
 * its file in ENGINE_BOARDS_DIR). Each in the JSON form the editors' C7 adapter builds too: the
 * screens without the feeds' own parts (the engine's web app, the instance's causes), the board
 * without the time it was read. The recording script writes what they give into c7-core's
 * `C7_STATUS_SCREENS` (status-world.record.test.ts), the numbers test holds the feeds to it over its
 * answers (status-screens.numbers.test.ts) and the engine suite holds a world seeded on CIB seven
 * or Operaton to its figures (status-world.engine.test.ts).
 */

import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import type { z } from "zod"
import { C7_STATUS_WORLD, type C7ExpectedStatusScreens } from "@miragon/pulse-c7-core/testing"
import { recordingModuleServer } from "@miragon/pulse-widget-shell/testing"
import { engineModule } from "../../module.js"
import {
  ENGINE_BOARD_DATA,
  ENGINE_SCREEN_INSTANCE_DATA,
  ENGINE_SCREEN_PROCESS_DATA,
} from "../../tool-names.js"
import { feedPayload } from "../../tools/test-support/feed-payload.js"

/** The board's name: its file is `approvals.board.json`. */
const BOARD = "approvals"

/** The status world's board over its engine `engine`: a diagram of the approval process. */
export function statusBoardFile(engine: string) {
  const process = C7_STATUS_WORLD.processes.approval
  return {
    schemaVersion: 1,
    title: "Approvals",
    engines: [engine],
    rows: [{ row: [{ widget: "processDiagram", props: { process } }] }],
  }
}

/** The engine the screens are read of: its name, its REST root and its vendor (`flavor`). */
interface ScreensProfile {
  readonly engine: string
  readonly url: string
  readonly flavor: string
}

/** A payload without the parts named. */
function without(payload: Record<string, unknown>, ...parts: readonly string[]) {
  return Object.fromEntries(Object.entries(payload).filter(([key]) => !parts.includes(key)))
}

/**
 * The screens and the board the server's feeds give of `profile`'s engine, the board's file
 * `boardText`, the instance screen of `instanceId` (APR-139-2 there): a server of its own, so no
 * answer kept on another's floor stands in.
 */
export async function readStatusScreens(
  profile: ScreensProfile,
  boardText: string,
  instanceId: string,
): Promise<C7ExpectedStatusScreens> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-status-screens-"))
  try {
    fs.writeFileSync(path.join(dir, `${BOARD}.board.json`), boardText)
    const config = engineModule.configFromEnv({
      ENGINES_JSON: JSON.stringify({
        profiles: { [profile.engine]: { url: profile.url, flavor: profile.flavor } },
      }),
      ENGINE_BOARDS_DIR: dir,
    })
    const recording = recordingModuleServer()
    engineModule.createPlugin(config).register(recording.server)
    const call = async (name: string, args: Record<string, unknown>) => {
      const tool = recording.tool(name)
      const result = await tool.call((tool.config.inputSchema as z.ZodObject).parse(args))
      if ((result as { isError?: boolean }).isError === true) {
        throw new Error(`${name} on ${profile.engine}: ${JSON.stringify(result)}`)
      }
      return feedPayload<Record<string, unknown>>(result)
    }
    const { engine } = profile
    const process = await call(ENGINE_SCREEN_PROCESS_DATA, {
      engine,
      process: C7_STATUS_WORLD.processes.approval,
    })
    const instance = await call(ENGINE_SCREEN_INSTANCE_DATA, { engine, instance: instanceId })
    const board = await call(ENGINE_BOARD_DATA, { board: BOARD })
    return {
      process: without(process, "webApp"),
      instance: without(instance, "webApp", "causes"),
      board: without(board, "asOf"),
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}
