import {
  appOnly,
  buildDataFeedResult,
  withToolErrors,
  strictToolInput,
} from "@miragon/pulse-widget-shell/server"
import { type ContractFeed, DATA_FEEDS, type DataFeed, type NamingFeed } from "../data/feeds.js"
import { resolveEngine, resolveRuntimeEngine } from "../lib/engine/resolve-engine.js"
import { namedReads, type WidgetToolsContext } from "./shared.js"

const FEED_ANNOTATIONS = { readOnlyHint: true, idempotentHint: true, openWorldHint: true }

/**
 * Registers every `*_data` feed `data/feeds.ts` describes, app-only and read-only: a feed of one
 * engine with the `engine` parameter (a Camunda 7 engine's through `resolveEngine`, which refuses
 * another dialect's; a contract feed's of any dialect through `resolveRuntimeEngine`), a feed that
 * names its own engines without it, each of them resolved by its name under the call.
 */
export function registerWidgetDataFeeds(ctx: WidgetToolsContext) {
  const { server, registry, healthThresholds, engineParam } = ctx

  function registerDataFeed(feed: DataFeed | ContractFeed) {
    server.registerTool(
      feed.name,
      {
        title: feed.title,
        description: feed.description,
        annotations: FEED_ANNOTATIONS,
        inputSchema: strictToolInput({ ...feed.shape, ...engineParam }),
        ...appOnly,
      },
      withToolErrors(async (args, call) => {
        const { engine, ...input } = args
        const data =
          "engines" in feed
            ? await feed.read(input, resolveRuntimeEngine(engine, registry, call))
            : await feed.read(input, resolveEngine(engine, registry, call), { healthThresholds })
        return buildDataFeedResult({ ...data })
      }),
    )
  }

  function registerNamingFeed(feed: NamingFeed) {
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
        const data = await feed.read(args, namedReads(ctx, call))
        return buildDataFeedResult({ ...data })
      }),
    )
  }

  for (const feed of DATA_FEEDS) {
    if ("engines" in feed && feed.engines === "named") registerNamingFeed(feed)
    else registerDataFeed(feed)
  }
}
