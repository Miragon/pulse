import type { Dispatch } from "react"
import { StatusStrip, useLocale, WidgetHeader } from "@miragon/pulse-ui"
import { useHostLocation } from "@miragon/pulse-widget-shell/widgets"
import { environmentIn } from "../lib/engine-context.js"
import { type BoardView, crumbLabel } from "../nav-core.js"
import { translator } from "../../messages/use-t.js"
import { NavBreadcrumb } from "./breadcrumb.js"
import {
  activeSectionOf,
  type CockpitAction,
  type CockpitState,
  type ProcessGone,
} from "./cockpit-state.js"
import { CockpitHead, CockpitTrailBar, EngineSwitch } from "./head.js"
import { boardsOnlyOf, type CockpitEngine } from "./boards-only.js"
import { engineViewArgs } from "./place.js"
import { CockpitRefreshButton } from "./refresh-button.js"

/** Docked under the head: the engine the view showed went away, and the view fell back. */
export function EngineGoneNotice({ engineId }: { engineId: string | null }) {
  const locale = useLocale()
  if (!engineId) return null
  return (
    <StatusStrip tone="warning" title={translator(locale, "cockpit.engineGone", { engineId })} />
  )
}

/** Docked under the head: the engine switched to does not deploy the process, its section shows. */
function ProcessGoneNotice({ gone }: { gone: ProcessGone | null }) {
  const locale = useLocale()
  if (!gone) return null
  return <StatusStrip tone="info" title={translator(locale, "cockpit.processGone", { ...gone })} />
}

/**
 * The trail's first crumb: the board an engine's view was opened from leads back to it; else
 * "All engines" leads back to the chooser (#322 U15) where it shows: with more than one engine,
 * or with one when the server has boards.
 */
function rootCrumb(
  fromBoard: BoardView | null,
  chooser: boolean,
  locale: string,
): string | undefined {
  if (fromBoard) return crumbLabel(fromBoard, locale)
  return chooser ? translator(locale, "cockpit.crumb.allEngines") : undefined
}

/**
 * Where the trail shows: in the head in place of the sections (inline after a drill, as #396
 * wants a card, and an engine without sections always), on a row of its own under the head, or
 * nowhere. On a page the bar's product leads home, so the chooser's crumb does not count: a head
 * section, whose tab names it, shows no trail, a drill shows it on its row, and under 40rem of the
 * cockpit the row gives way to the head (N4, A6). A chat's fullscreen keeps its trail, the one way
 * back to the chooser there.
 */
function trailPlaces({
  views,
  rootLabel,
  fromBoard,
  sectionless,
  inline,
  page,
}: {
  views: number
  rootLabel: string | undefined
  fromBoard: boolean
  sectionless: boolean
  inline: boolean
  page: boolean
}): { inHead: boolean; onRow: boolean } {
  const crumbs = (sectionless ? 1 : views) + (rootLabel === undefined ? 0 : 1)
  if (sectionless) return { inHead: crumbs > 1, onRow: false }
  // A board's target sits under its board alone: the board's crumb is the way back.
  const drilled = views + (fromBoard ? 1 : 0) > 1
  if (inline) return { inHead: drilled, onRow: false }
  return { inHead: false, onRow: page ? drilled : crumbs > 1 }
}

/**
 * The bar of an engine without sections on a page with chrome of its own: the engine's name as the
 * view's title (h1, its one state's title the heading under it), the page's menu first
 * (`ViewBarSlots`) and the cockpit's Refresh, which the head offered it, as its one action: it
 * reads the engine list again, which gives a profile the server no longer refuses its view back.
 */
function SectionlessBar({ engineId }: { engineId: string }) {
  return <WidgetHeader title={engineId} actions={<CockpitRefreshButton bar />} />
}

/**
 * An engine's bars, from edge to edge above its route: the head (the sections its dialect is
 * served by, inline a drilled view's trail in their place), the trail where `trailPlaces` puts
 * it, and the notices of an engine that went away or a process the engine switched to lacks. An
 * engine shown on boards only, or whose profile the server refused, has no section: its trail,
 * the way back and its name, takes their place in the head, never a crumb of a route it has not.
 * It is the trail row's container, which a page's narrow cockpit hides the row by. On a page with
 * chrome of its own (`chrome`) the page's navigation holds the head's sections, its engine switch
 * and the way across engines, and the route's bar its Refresh: no head shows, a drill's trail
 * keeps its row at every width, and an engine without sections shows a bar of its own over its
 * one state, its name the title, the menu first and the Refresh its action (`SectionlessBar`).
 */
export function EngineBars({
  engineId,
  engines,
  engineGroups,
  chooser,
  refused,
  state,
  inline,
  page,
  chrome,
  onOpenFleet,
  dispatch,
}: {
  engineId: string
  engines: readonly CockpitEngine[]
  engineGroups: Array<{ id: string; engines: Array<{ id: string }> }>
  /** The chooser shows: the trail's first crumb leads back to it. */
  chooser: boolean
  /** Its profile refused (`useProfileRefusal`). */
  refused: boolean
  state: CockpitState
  inline: boolean
  /** A page whose bar leads to its start page (`useStartPage`). */
  page: boolean
  /** A page with chrome of its own (`useHostChrome`), which takes the head's parts. */
  chrome: boolean
  onOpenFleet?: () => void
  dispatch: Dispatch<CockpitAction>
}) {
  const locale = useLocale()
  // A view the page shows itself (an engine's processes) goes by the page's word in the trail.
  const pageName = useHostLocation()?.nameOf
  const { stack, goneEngineId, processGone, fromBoard } = state
  const engine = engines.find(({ id }) => id === engineId)
  const sectionless = refused || boardsOnlyOf(engine) !== null
  const rootLabel = rootCrumb(fromBoard, chooser, locale)
  const leave = fromBoard ? ({ type: "to-board" } as const) : ({ type: "to-landing" } as const)
  const trail = (
    <NavBreadcrumb
      stack={stack}
      locale={locale}
      rootLabel={rootLabel}
      current={sectionless ? engineId : undefined}
      nameOf={pageName && ((view) => pageName(engineViewArgs(engineId, view)))}
      onPop={(to) => dispatch(to < 0 ? leave : { type: "pop", to })}
    />
  )
  const { inHead, onRow } = trailPlaces({
    views: stack.length,
    rootLabel,
    fromBoard: fromBoard !== null,
    sectionless,
    inline,
    page,
  })
  const notices = (
    <>
      <EngineGoneNotice engineId={goneEngineId} />
      <ProcessGoneNotice gone={processGone} />
    </>
  )
  if (chrome) {
    return (
      <div>
        {sectionless && <SectionlessBar engineId={engineId} />}
        {onRow && <CockpitTrailBar>{trail}</CockpitTrailBar>}
        {notices}
      </div>
    )
  }
  const narrow = page && onRow
  return (
    <div className="@container">
      <CockpitHead
        activeSection={activeSectionOf(stack)}
        dialect={engine?.dialect}
        refused={refused}
        onSection={(intent) => dispatch(intent)}
        onOpenFleet={onOpenFleet}
        trail={inHead ? trail : undefined}
        narrowTrail={narrow ? trail : undefined}
        engineSwitch={
          <EngineSwitch
            engineId={engineId}
            environment={environmentIn(engines, engineId)}
            engineGroups={engineGroups}
            onSwitch={(id) => dispatch({ type: "switch-engine", id })}
          />
        }
      />
      {onRow && <CockpitTrailBar narrow={narrow}>{trail}</CockpitTrailBar>}
      {notices}
    </div>
  )
}
