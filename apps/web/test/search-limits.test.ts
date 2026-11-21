import { engineModule } from "@miragon/pulse-engine-connector"
import { Finder } from "@miragon/pulse-screens/builder"
import { recordingModuleServer } from "@miragon/pulse-widget-shell/testing"
import { describe, expect, it } from "vitest"
import { SEARCH_TEXT_MOST } from "../src/router/search-address.js"
import { FIND_FEED, MOST_BY_BUSINESS_KEY } from "../src/screens/search/search-reads.js"

/**
 * The page's limits of its search are the server's: the longest text the search's feed takes
 * (`engine_screen_find_data`'s `text`, as the engine module registers it, in the JSON Schema the
 * page's server reads), which the field and the search's address hold before anything is asked,
 * and how many instances with a business key an engine lists at most (the screens' `Finder`),
 * which the page names under the rows of an engine that holds more.
 */

/** The search feed's `text` in its input's JSON Schema. */
function textOfFeed(): { readonly maxLength?: unknown; readonly minLength?: unknown } {
  const recording = recordingModuleServer()
  engineModule
    .createPlugin({ engines: [{ id: "prod", baseUrl: "http://prod.example/engine-rest" }] })
    .register(recording.server)
  const schema = recording.tool(FIND_FEED).config.inputSchema as {
    toJSONSchema(): { properties: Record<string, { maxLength?: unknown; minLength?: unknown }> }
  }
  return schema.toJSONSchema().properties.text ?? {}
}

describe("the search's limits", () => {
  it("takes a text as long as the search's feed takes, and no longer", () => {
    expect(textOfFeed()).toMatchObject({ minLength: 1, maxLength: SEARCH_TEXT_MOST })
  })

  it("names as many instances with a business key as an engine lists", () => {
    expect(MOST_BY_BUSINESS_KEY).toBe(Finder.MOST)
  })
})
