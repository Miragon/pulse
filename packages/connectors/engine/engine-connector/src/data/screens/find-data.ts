/**
 * What the web app's search finds on the engine a call resolved, in any dialect: the instance with
 * the text as its id and up to 20 with it as their exact business key, running and ended, by the
 * screens' builder (`Finder` of @miragon/pulse-screens/builder) over the engine contract's runtime
 * of the engine (`runtimeOf`), serialized by `ScreenJson`: the same JSON the editors' adapters
 * build from the same answers (D2). The hits are primary, so a failed search fails the read; where
 * the engine's history misses running instances (Camunda 7 at history level NONE, a history cleaned
 * up while instances ran), the screen names the gap, which a failed read of it leaves out, never a
 * guess. The page asks every engine apart, so an engine's refusal or failure is its own. The
 * searches load the engine's database, so a caller's searches of a text stand on the floor of 30 s
 * per caller and text (`screen-floor.ts`), which a Refresh repeats; the history's gap reads the
 * whole engine whatever was searched (its processes, then its history's count), so it stands on a
 * floor of its own per caller and engine, which every text shares and a failed read never holds.
 */

import type { FindScreenData, HistoryGapData } from "@miragon/pulse-screens"
import { Finder, type FindSearch, ScreenJson } from "@miragon/pulse-screens/builder"
import { runtimeOf } from "../../lib/engine/engine-runtime.js"
import type { RuntimeEngine } from "../../lib/engine/resolve-engine.js"
import { screenFloor } from "./screen-floor.js"

const searchFloor = screenFloor<FindSearch>()

const gapFloor = screenFloor<HistoryGapData | null>()

/** What `text` finds on `engine` at `now`: the searches and the history's gap, each on its floor. */
export async function buildFindData(
  engine: RuntimeEngine,
  text: string,
  now: () => Date = () => new Date(),
): Promise<FindScreenData> {
  const runtime = runtimeOf(engine)
  const searched = searchFloor(engine, { text }, () => Finder.search(text, runtime, now))
  const historyGap = gapFloor(engine, {}, () => Finder.historyGap(runtime)).then(
    (gap) => gap ?? undefined,
    () => undefined,
  )
  const facts = { engine: engine.engineId, ...(await searched), historyGap: await historyGap }
  return ScreenJson.find(Finder.of(facts))
}
