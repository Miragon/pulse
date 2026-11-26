/**
 * A page renders the process screen's blocks from the tool's result alone (#666): the result of
 * `engine_get_screen` over c7-core's recorded screen engine, its form checked by its version and
 * handed as it is to the blocks of @miragon/pulse-blocks that read the process screen's JSON form
 * (the version picker, the notice that older versions still run) and to the screens' rule for its
 * diagram's badges (`DiagramDecorations`), with nothing read or mapped beside it. Rendered to
 * markup, as a page's first paint, in English.
 */

import { createElement, Fragment } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, describe, expect, it } from "vitest"
import type { z } from "zod"
import { OlderVersionsNotice, VersionPicker } from "@miragon/pulse-blocks"
import { C7_SCREEN_ENGINE } from "@miragon/pulse-c7-core/testing"
import { type RecordedEngine, startRecordedEngine } from "@miragon/pulse-http/testing/loopback"
import { DiagramDecorations, type ProcessScreenData, ScreenFormat } from "@miragon/pulse-screens"
import { recordingModuleServer } from "@miragon/pulse-widget-shell/testing"
import { engineModule } from "../module.js"
import type { ScreenFormData } from "../data/json-forms.js"
import { feedPayload } from "./test-support/feed-payload.js"

const engines: RecordedEngine[] = []

afterEach(async () => {
  await Promise.all(engines.splice(0).map((engine) => engine.close()))
})

/** The tool's result for the process screen of pulse-order, as a page's call gets it. */
async function processScreenResult(): Promise<unknown> {
  const engine = await startRecordedEngine(C7_SCREEN_ENGINE.answers)
  engines.push(engine)
  const profiles = {
    [C7_SCREEN_ENGINE.engine]: { url: `${engine.origin}/engine-rest`, flavor: "operaton" },
  }
  const recording = recordingModuleServer()
  engineModule
    .createPlugin(engineModule.configFromEnv({ ENGINES_JSON: JSON.stringify({ profiles }) }))
    .register(recording.server)
  const tool = recording.tool("engine_get_screen")
  const args = { screen: "process", processDefinitionKey: "pulse-order" }
  return tool.call((tool.config.inputSchema as z.ZodObject).parse(args))
}

/** What a page does with the result: refuse a form it does not know, else take the process screen. */
function processScreenOf(result: ScreenFormData): ProcessScreenData {
  if (result.formatVersion !== ScreenFormat.JSON_VERSION || result.screen !== "process") {
    throw new Error(`A form this page does not know: ${result.screen} ${result.formatVersion}`)
  }
  return result.data
}

describe("a page over engine_get_screen's result alone", () => {
  it("renders the process screen's blocks and badges from it, nothing read beside it", async () => {
    const screen = processScreenOf(feedPayload<ScreenFormData>(await processScreenResult()))
    const [notice] = screen.notices
    const markup = renderToStaticMarkup(
      createElement(
        Fragment,
        null,
        createElement(VersionPicker, {
          versions: screen.versions,
          selected: screen.selected?.id,
          onPick: () => undefined,
        }),
        notice === undefined
          ? null
          : createElement(OlderVersionsNotice, { notice, onShow: () => undefined }),
      ),
    )
    // The kit world's pulse-order: version 2 the latest, version 1 still running with an incident.
    const options = [...markup.matchAll(/<option value="([^"]+)"[^>]*>([^<]+)<\/option>/g)]
    expect(options.map(([, id, words]) => [id, words])).toEqual([
      [screen.versions[0]?.definition.id, "v2 · 1 running"],
      [screen.versions[1]?.definition.id, "v1 · 2 running · 1 with incident"],
    ])
    expect(markup).toContain("2 instances still run on older versions, 1 of them with incident.")
    expect(markup).toContain("Show v1")
    const decorations = DiagramDecorations.of(screen)
    expect(decorations.map(({ elementId }) => elementId).sort()).toEqual(
      screen.badges
        .filter((badge) => badge.running + badge.incidents + badge.incidentsInCalledInstances > 0)
        .map(({ elementId }) => elementId)
        .sort(),
    )
  })

  it("refuses a form of a version it does not know", () => {
    const later = { screen: "process", formatVersion: ScreenFormat.JSON_VERSION + 1, data: {} }
    expect(() => processScreenOf(later as ScreenFormData)).toThrow("A form this page does not know")
  })
})
