import {
  appOnly,
  buildDataFeedResult,
  withToolErrors,
  strictToolInput,
} from "@miragon/pulse-widget-shell/server"
import {
  type ContractFeed,
  DATA_FEEDS,
  type DataFeed,
  namedReads,
  type NamingFeed,
} from "../data/feeds.js"
import { SCREEN_FEEDS } from "../data/screen-feeds.js"
import { resolveEngine, resolveRuntimeEngine } from "../lib/engine/resolve-engine.js"
import { contractToolError } from "../lib/engine/runtime-errors.js"
import { engineServing, offeredEngineIds, servedEngineIds } from "../lib/engine/served-engines.js"
import { engineParamShapeFor } from "../lib/engine/with-engine.js"
import type { WidgetToolsContext } from "./shared.js"

const FEED_ANNOTATIONS = { readOnlyHint: true, idempotentHint: true, openWorldHint: true }

/**
 * Registers every `*_data` feed `data/feeds.ts` describes and the web app's screen feeds
 * (`data/screen-feeds.ts`), app-only and read-only, where a
 * configured engine speaks a dialect of its mark (`dialects`): a feed of one engine with the
 * `engine` parameter, its enum the engines it serves (a Camunda 7 engine's through
 * `resolveEngine`; a contract feed's of any dialect through `resolveRuntimeEngine`, a failed read
 * with the contract's failure and hint, `contractToolError`), a feed that names its own engines
 * without it, each of them resolved by its name under the call. Its mark refuses any other engine
 * before the read (`engineServing`).
 */
export function registerWidgetDataFeeds(ctx: WidgetToolsContext) {
  const { server, registry, healthThresholds } = ctx

  function registerDataFeed(feed: DataFeed | ContractFeed) {
    const mark = { dialects: feed.dialects }
    server.registerTool(
      feed.name,
      {
        title: feed.title,
        description: feed.description,
        annotations: FEED_ANNOTATIONS,
        inputSchema: strictToolInput({
          ...feed.shape,
          ...engineParamShapeFor(offeredEngineIds(registry, mark)),
        }),
        ...appOnly,
      },
      withToolErrors(async (args, call) => {
        const { engine, ...input } = args
        const engineId = engineServing(engine, registry, mark)
        const data =
          "engines" in feed
            ? await feed
                .read(input, resolveRuntimeEngine(engineId, registry, call))
                .catch((error: unknown) => {
                  throw contractToolError(error)
                })
            : await feed.read(input, resolveEngine(engineId, registry, call), { healthThresholds })
        return buildDataFeedResult({ ...data })
      }),
    )
  }

  function registerNamingFeed(feed: NamingFeed) {
    const mark = { dialects: feed.dialects }
    server.registerTool(
      feed.name,
      {
        title: feed.title,
        description: feed.description,
        annotations: FEED_ANNOTATIONS,
        inputSchema: strictToolInput(feed.shape),
        ...appOnly,
      },
      withToolErrors(async (args, call) => {
        const data = await feed.read(args, namedReads(ctx, mark, call))
        return buildDataFeedResult({ ...data })
      }),
    )
  }

  for (const feed of [...DATA_FEEDS, ...SCREEN_FEEDS]) {
    if (servedEngineIds(registry, { dialects: feed.dialects }).length === 0) continue
    if ("engines" in feed && feed.engines === "named") registerNamingFeed(feed)
    else registerDataFeed(feed)
  }
}
