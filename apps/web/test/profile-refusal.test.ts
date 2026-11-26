import { engineModule } from "@miragon/pulse-engine-connector"
import { recordingModuleServer } from "@miragon/pulse-widget-shell/testing"
import { describe, expect, it } from "vitest"
import { refusalOf } from "../src/engine-list.js"
import { ENGINE_SCREEN_FEED } from "../src/screens/engine/engine-feed.js"
import { FIND_FEED } from "../src/screens/search/search-reads.js"

/**
 * The page reads nothing of a refused profile and says the server's refusal from the reason the
 * engine list names (`refusalOf`, the start page's and the search's strip): a copy of the engine
 * module's `ENGINE_PROFILE_REFUSED` text, held here to what the server answers a call to that
 * profile, through the feeds the page would have called, as the engine module registers them.
 */

const REFUSED = { id: "legacy", reason: "auth.tokenEnv names a variable that is not set." }

/** The text the server answers a call of `tool` to the refused profile. */
async function answerOf(tool: string, args: Record<string, unknown>): Promise<string> {
  const recording = recordingModuleServer()
  engineModule
    .createPlugin({
      engines: [{ id: "prod", baseUrl: "http://prod.example/engine-rest" }],
      refused: [REFUSED],
    })
    .register(recording.server)
  const result = await recording.tool(tool).call({ ...args, engine: REFUSED.id })
  expect(result.isError).toBe(true)
  return result.content.map((part) => ("text" in part ? part.text : "")).join("")
}

describe("a refused profile in the server's words", () => {
  it("says what the server answers the start page's read of it, word for word", async () => {
    expect(refusalOf(REFUSED.id, REFUSED.reason).message).toBe(
      await answerOf(ENGINE_SCREEN_FEED, {}),
    )
  })

  it("says what the server answers the search's read of it, word for word", async () => {
    expect(refusalOf(REFUSED.id, REFUSED.reason).message).toBe(
      await answerOf(FIND_FEED, { text: "order-1" }),
    )
  })
})
