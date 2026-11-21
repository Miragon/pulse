import { Fragment } from "react"
import { formatNumber, SectionHeading, WidgetHeader } from "@miragon/pulse-ui"
import {
  HandOffButton,
  useHostChrome,
  useHostFollowUp,
  useHostLocation,
  WidgetShell,
} from "@miragon/pulse-widget-shell/widgets"
import {
  enginesByEnvironment,
  formatEnginesByEnvironment,
  groupEnginesByEnvironment,
} from "../../lib/shared/environments.js"
import { useT } from "../../messages/use-t.js"
import { useHandOff, type HandOff } from "../lib/hand-off.js"
import { boardsOnlyOf, type CockpitEngine, readsWhole } from "./boards-only.js"
import { FleetLandscape } from "./fleet-landscape.js"

interface Fleet {
  engineIds: string[]
  environments: string[] | undefined
}

/** Never a ranking: the model hears it from `fleetContext`, the landscape counts only. */
function fleetOverviewHandOff({ engineIds, environments }: Fleet): HandOff {
  return {
    intent: "askAi.fleet.overview",
    ids: { engine: engineIds },
    facts: { environments },
  }
}

function fleetFailuresHandOff({ engineIds, environments }: Fleet): HandOff {
  return {
    intent: "askAi.fleet.failures",
    ids: { engine: engineIds },
    facts: { environments },
  }
}

/**
 * The engines the server shows on boards only, one line per product, which the view leaves out
 * of its reads and sums: none of its reads would be served. On a page whose screens show such an
 * engine (the web app's) the line says only that the view leaves it out.
 */
function BoardsOnlyLine({ engines }: { engines: readonly CockpitEngine[] }) {
  const t = useT()
  const claims = useHostLocation()?.claims
  const byProduct = new Map<string, string[]>()
  for (const engine of engines) {
    const product = boardsOnlyOf(engine)?.product
    if (product === undefined) continue
    byProduct.set(product, [...(byProduct.get(product) ?? []), engine.id])
  }
  return [...byProduct].map(([product, ids]) => (
    <p key={product} data-slot="fleet-boards-only" className="text-muted-foreground text-small">
      {t(claims?.({ view: "overview", engine: ids[0] }) ? "fleet.notRead" : "fleet.boardsOnly", {
        product,
      })}
      {ids.map((id, index) => (
        <Fragment key={id}>
          {" "}
          <EngineIdInLine id={id} last={index === ids.length - 1} />
        </Fragment>
      ))}
    </p>
  ))
}

/**
 * An id in a line of ids, with its comma: the line wraps between ids, never at an id's own
 * hyphen ("prod-eu"), and only an id wider than the whole line wraps inside itself.
 */
function EngineIdInLine({ id, last }: { id: string; last: boolean }) {
  return (
    <span data-part="engine-id" className="inline-block max-w-full [overflow-wrap:anywhere]">
      {last ? id : `${id},`}
    </span>
  )
}

/**
 * An overview, not a scoreboard: engines host different processes, so ranking them by
 * rate or duration would rank their process mixes. It reads and sums only the engines every route
 * reads; one the server shows on boards only it names in a line. Each engine is a row of its
 * table, which opens it: no card repeats its numbers (N8).
 */
export function FleetView({
  engines: all,
  onEnterEngine,
}: {
  engines: readonly CockpitEngine[]
  onEnterEngine: (id: string) => void
}) {
  const t = useT()
  const { ask } = useHandOff()
  const followUp = useHostFollowUp()
  const engines = all.filter(readsWhole)
  const ids = engines.map((e) => e.id)
  const refused = new Set(engines.filter((e) => e.refused !== undefined).map((e) => e.id))
  // The fleet itself stays all engines, across environments.
  const engineGroups = groupEnginesByEnvironment(engines)
  const idList = formatEnginesByEnvironment(engineGroups)
  const fleet: Fleet = { engineIds: ids, environments: enginesByEnvironment(engineGroups) }
  // On a page with chrome of its own the title is the view bar's, the page's menu first: a view
  // of its own in the cockpit's flush shell, its bar from edge to edge.
  const chrome = useHostChrome() !== undefined
  const header = (
    <WidgetHeader
      size={chrome ? "default" : "app"}
      title={t("fleet.heading")}
      sub={t("fleet.engineCount", { count: formatNumber(engines.length), list: idList })}
      actions={
        followUp !== "none" && (
          <HandOffButton action="assess" prompt={ask(fleetOverviewHandOff(fleet))} />
        )
      }
    />
  )
  const content = (
    <>
      <BoardsOnlyLine engines={all} />

      <FleetLandscape engineIds={ids} refused={refused} onEnterEngine={onEnterEngine} />

      {/* Its analyses are hand-offs only: a host that shows none gets no section, and a page
          that copies them says so. */}
      {followUp !== "none" && (
        <section>
          <SectionHeading
            as="h2"
            title={t("fleet.fleetAnalyses.title")}
            hint={t(
              followUp === "copy" ? "fleet.fleetAnalyses.copyHint" : "fleet.fleetAnalyses.hint",
            )}
          />
          <div className="flex flex-wrap items-center gap-2">
            <HandOffButton action="analyzeFailures" prompt={ask(fleetFailuresHandOff(fleet))} />
          </div>
        </section>
      )}
    </>
  )
  if (chrome) return <WidgetShell header={header}>{content}</WidgetShell>
  return (
    <div className="gap-section flex flex-col">
      {header}
      {content}
    </div>
  )
}
