import type { ResolvedEngine } from "../lib/engine/resolve-engine.js"
import type { CockpitStart, CockpitView } from "../view-models.js"
import type { VerdictThresholds } from "@miragon/pulse-engine-core"
import type { ReadContext } from "./feeds.js"
import { COCKPIT_ROUTES, type Facts } from "./routes.js"

/** The start view with its data: a failed primary read fails the call, never a view of zeros. */
export async function buildCockpitStart(
  view: CockpitView,
  engine: ResolvedEngine,
  healthThresholds: VerdictThresholds,
): Promise<CockpitStart> {
  // The record is total over the sections, so the view's own route takes the view.
  const start = COCKPIT_ROUTES[view.section].start as (
    view: CockpitView,
    engine: ResolvedEngine,
    ctx: ReadContext,
  ) => Promise<CockpitStart["data"]>
  return { view, data: await start(view, engine, { healthThresholds }) } as CockpitStart
}

/** The start view's facts for the model (`CockpitRoute.facts`). */
export function cockpitFacts({ view, data }: CockpitStart): Facts {
  const facts = COCKPIT_ROUTES[view.section].facts as (
    view: CockpitView,
    data: CockpitStart["data"],
  ) => Facts
  return facts(view, data)
}
