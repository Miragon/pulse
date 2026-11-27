import type { ToolCaller, ToolCallOptions } from "@miragon/pulse-widget-shell/widgets"
import { ENGINE_SCREEN_FEED } from "./screens/engine/engine-feed.js"
import { FIND_FEED } from "./screens/search/search-reads.js"

/**
 * The reads the page makes of every engine at once: the start page's (each engine's engine screen)
 * and the search's (what each engine finds). A Camunda 7 engine's verdict is none of them: the
 * start page starts its read only once its engine's screen answered, never beside the screen's
 * read, and an engine's own screen reads it beside its figures.
 */
export const ACROSS_ENGINES: ReadonlySet<string> = new Set([ENGINE_SCREEN_FEED, FIND_FEED])

type Answer = ReturnType<ToolCaller>

/** One engine's lane: its call sent last, settled or not, and its calls queued behind it. */
interface Lane {
  last: Promise<unknown>
  /** The calls not sent yet, by what they ask. */
  readonly queued: Map<string, Answer>
}

/** What a call asks: a call queued behind another that asks the same joins it. */
const askOf = (name: string, args: object, options: ToolCallOptions | undefined): string =>
  JSON.stringify([name, args, options ?? {}])

/**
 * The page's caller with a lane per engine for the reads across engines (`laned`, by the `engine`
 * its arguments name): at most one such call of an engine is under way, the next sent once it
 * settled, answered or failed. An engine that hangs then holds one of the browser's connections
 * (six per origin over HTTP/1.1), never one per read, so the reads of the other engines get through
 * beside it. A call that asks what a queued one asks (a Try again pressed while the engine still
 * hangs, say) joins it rather than queueing again; one that asks what a sent one asks waits for it
 * and reads anew. Any other call goes out at once.
 */
export function engineLanes(
  callTool: ToolCaller,
  laned: ReadonlySet<string> = ACROSS_ENGINES,
): ToolCaller {
  const lanes = new Map<string, Lane>()
  const laneOf = (engine: string): Lane => {
    const lane = lanes.get(engine) ?? { last: Promise.resolve(), queued: new Map<string, Answer>() }
    lanes.set(engine, lane)
    return lane
  }
  return (name, args, options) => {
    const { engine } = args
    if (!laned.has(name) || typeof engine !== "string") return callTool(name, args, options)
    const lane = laneOf(engine)
    const ask = askOf(name, args, options)
    const joined = lane.queued.get(ask)
    if (joined !== undefined) return joined
    const answer = lane.last.then(() => {
      lane.queued.delete(ask)
      return callTool(name, args, options)
    })
    lane.queued.set(ask, answer)
    lane.last = answer.catch(() => undefined)
    return answer
  }
}
