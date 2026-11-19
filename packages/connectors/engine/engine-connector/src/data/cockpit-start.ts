import type { ResolvedEngine } from "../lib/engine/resolve-engine.js"
import type { AppSection, CockpitStart, CockpitView } from "../view-models.js"
import { DEFAULT_VERDICT_THRESHOLDS, type VerdictThresholds } from "@miragon/pulse-c7-core"
import type { NamedReadContext, ReadContext } from "./feeds.js"
import { type CallFacts, COCKPIT_ROUTES, type EngineSection, type Facts } from "./routes.js"

/** A start view of one engine's routes. */
export type EngineView = Extract<CockpitView, { section: EngineSection }>

/** A start view of an app route: a board, which names its engines itself, or the landing. */
export type AppView = Extract<CockpitView, { section: AppSection }>

/** Whether `view` is an app route's (`CockpitRoute.scope`): its start resolves no engine. */
export function isAppView(view: CockpitView): view is AppView {
  return COCKPIT_ROUTES[view.section].scope === "app"
}

type EngineStart = (
  view: CockpitView,
  engine: ResolvedEngine,
  ctx: ReadContext,
) => Promise<CockpitStart["data"]>

type AppStart = (view: CockpitView, ctx: NamedReadContext) => Promise<CockpitStart["data"]>

/**
 * The start view with its data: a failed primary read fails the call, never a view of zeros. An
 * engine route reads the engine the call resolved, an app route the engines it names (`named`).
 */
export function buildCockpitStart(
  view: EngineView,
  engine: ResolvedEngine,
  healthThresholds: VerdictThresholds,
): Promise<CockpitStart>
export function buildCockpitStart(view: AppView, named: NamedReadContext): Promise<CockpitStart>
export async function buildCockpitStart(
  view: CockpitView,
  source: ResolvedEngine | NamedReadContext,
  healthThresholds: VerdictThresholds = DEFAULT_VERDICT_THRESHOLDS,
): Promise<CockpitStart> {
  // The record is total over the sections, so the view's own route takes the view.
  const route = COCKPIT_ROUTES[view.section]
  const data =
    route.scope === "app"
      ? await (route.start as AppStart)(view, source as NamedReadContext)
      : await (route.start as EngineStart)(view, source as ResolvedEngine, { healthThresholds })
  return { view, data } as CockpitStart
}

/** The start view's facts for the model (`CockpitRoute.facts`), with what the call names. */
export function cockpitFacts({ view, data }: CockpitStart, call: CallFacts): Facts {
  const facts = COCKPIT_ROUTES[view.section].facts as (
    view: CockpitView,
    data: CockpitStart["data"],
    call: CallFacts,
  ) => Facts
  return facts(view, data, call)
}
