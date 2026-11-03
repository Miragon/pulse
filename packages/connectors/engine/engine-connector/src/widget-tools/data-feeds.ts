import {
  appOnly,
  buildDataFeedResult,
  withToolErrors,
  strictToolInput,
} from "@miragon/pulse-widget-shell/server"
import { DATA_FEEDS, type DataFeed } from "../data/feeds.js"
import { resolveEngine } from "../lib/engine/resolve-engine.js"
import type { WidgetToolsContext } from "./shared.js"

/** Registers every `*_data` feed `data/feeds.ts` describes, app-only and read-only. */
export function registerWidgetDataFeeds(ctx: WidgetToolsContext) {
  const { server, registry, healthThresholds, engineParam } = ctx

  function registerDataFeed(feed: DataFeed) {
    server.tool(
      {
        name: feed.name,
        title: feed.title,
        description: feed.description,
        annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
        inputSchema: strictToolInput({ ...feed.shape, ...engineParam }),
        ...appOnly,
      },
      withToolErrors(async (args, ctx) => {
        const { engine, ...input } = args
        const resolved = resolveEngine(engine, registry, ctx)
        const data = await feed.read(input, resolved, { healthThresholds })
        return buildDataFeedResult({ ...data })
      }),
    )
  }

  for (const feed of DATA_FEEDS) registerDataFeed(feed)
}
