import { Fragment } from "react"
import {
  formatNumber,
  Icon,
  FOCUS_RING,
  SectionHeading,
  TONE_DOT,
  cn,
  WidgetHeader,
} from "@miragon/pulse-ui"
import { HandOffButton, useHostFollowUp } from "@miragon/pulse-widget-shell/widgets"
import { ArrowRight } from "lucide-react"
import type { CockpitDashboardData } from "../../view-models.js"
import {
  enginesByEnvironment,
  formatEnginesByEnvironment,
  groupEnginesByEnvironment,
} from "../../lib/shared/environments.js"
import { useT } from "../../messages/use-t.js"
import { AlarmCount } from "../lib/alarm-count.js"
import { useHandOff, type HandOff } from "../lib/hand-off.js"
import { isHealthFailure } from "../lib/health-verdict.js"
import { boardsOnlyOf, type CockpitEngine, readsWhole } from "./boards-only.js"
import { useEngineHealth } from "./engine-health.js"
import { FleetLandscape } from "./fleet-landscape.js"
import { engineStatusKind } from "./landing.js"
import { EnvironmentChip } from "../lib/engine-context.js"

function FleetEngineKpis({
  summary,
  incidents,
  failed,
}: {
  summary: NonNullable<CockpitDashboardData["summary"]>
  incidents: number
  failed: number
}) {
  const t = useT()
  return (
    <div className="text-dense grid grid-cols-3 gap-2">
      <div>
        <div className="text-muted-foreground text-small">{t("fleet.running")}</div>
        <div className="text-foreground font-mono font-semibold tabular-nums">
          {formatNumber(summary.totalRunningInstances)}
        </div>
      </div>
      {/* One severity ladder (#322 U14): open incidents and jobs without retries alarm when
          there are any, by the tone's icon and words; the number stays neutral (invariant 6). */}
      <div>
        <div className="text-muted-foreground text-small">{t("fleet.incidents")}</div>
        <AlarmCount
          alarm={incidents > 0 && "openIncidents"}
          className="text-foreground font-mono font-semibold"
        >
          {formatNumber(incidents)}
        </AlarmCount>
      </div>
      <div>
        <div className="text-muted-foreground text-small">{t("fleet.failedJobs")}</div>
        <AlarmCount
          alarm={failed > 0 && "jobsWithoutRetries"}
          className="text-foreground font-mono font-semibold"
        >
          {formatNumber(failed)}
        </AlarmCount>
      </div>
    </div>
  )
}

function FleetEngineCard({
  engineId,
  environment,
  onEnter,
}: {
  engineId: string
  environment: string | null
  onEnter: () => void
}) {
  const { failure, summary: s, incidents, failed, tone } = useEngineHealth(engineId)
  const t = useT()
  const kind = engineStatusKind({ failure, summary: s })

  return (
    <button
      type="button"
      onClick={onEnter}
      // No aria-label: it would replace the accessible name and hide the KPIs from screen readers.
      className={cn(
        "border-border bg-card hover:bg-accent p-gutter flex flex-col gap-2.5 rounded-md border text-left transition-colors",
        FOCUS_RING,
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-foreground inline-flex min-w-0 items-center gap-2 font-semibold">
          <span
            data-part="verdict"
            className={cn("size-2 shrink-0 rounded-full", TONE_DOT[tone])}
            aria-hidden
          />
          {environment && <EnvironmentChip environment={environment} />}
          <span className="truncate">{engineId}</span>
        </span>
        <span className="text-muted-foreground text-small inline-flex items-center gap-1">
          {t("fleet.operate")}
          <Icon icon={ArrowRight} dense />
        </span>
      </div>

      {/* The same words as the chooser: "nicht erreichbar", "lädt …" (#322 U15). A failed
          refresh keeps the last summary in the cache: the words win over it. */}
      {kind === "loading" || isHealthFailure(kind) || !s ? (
        <span className="text-muted-foreground text-small">
          {t(`cockpit.landing.status.${kind}`)}
        </span>
      ) : (
        <FleetEngineKpis summary={s} incidents={incidents} failed={failed} />
      )}
      {s && (
        <div className="text-muted-foreground text-small">
          {t("fleet.processDefinitions", { count: formatNumber(s.totalDefinitions) })}
        </div>
      )}
    </button>
  )
}

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
 * of its reads and sums: none of its reads would be served.
 */
function BoardsOnlyLine({ engines }: { engines: readonly CockpitEngine[] }) {
  const t = useT()
  const byProduct = new Map<string, string[]>()
  for (const engine of engines) {
    const product = boardsOnlyOf(engine)?.product
    if (product === undefined) continue
    byProduct.set(product, [...(byProduct.get(product) ?? []), engine.id])
  }
  return [...byProduct].map(([product, ids]) => (
    <p key={product} data-slot="fleet-boards-only" className="text-muted-foreground text-small">
      {t("fleet.boardsOnly", { product })}
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
 * reads; one the server shows on boards only it names in a line.
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
  // The fleet itself stays all engines, across environments.
  const engineGroups = groupEnginesByEnvironment(engines)
  const idList = formatEnginesByEnvironment(engineGroups)
  const fleet: Fleet = { engineIds: ids, environments: enginesByEnvironment(engineGroups) }

  return (
    <div className="gap-section flex flex-col">
      <WidgetHeader
        size="app"
        title={t("fleet.heading")}
        sub={t("fleet.engineCount", { count: formatNumber(engines.length), list: idList })}
        actions={
          followUp !== "none" && (
            <HandOffButton action="assess" prompt={ask(fleetOverviewHandOff(fleet))} />
          )
        }
      />
      <BoardsOnlyLine engines={all} />

      <section className="gap-section flex flex-col">
        <SectionHeading title={t("fleet.engineHealth.title")} hint={t("fleet.engineHealth.hint")} />
        {engineGroups.map((g) => (
          <div key={g.id}>
            {engineGroups.length > 1 && <SectionHeading as="h3" title={g.id} className="mb-2" />}
            <div className="gap-section grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
              {g.engines.map((e) => (
                <FleetEngineCard
                  key={e.id}
                  engineId={e.id}
                  environment={engineGroups.length > 1 ? g.id : null}
                  onEnter={() => onEnterEngine(e.id)}
                />
              ))}
            </div>
          </div>
        ))}
      </section>

      <FleetLandscape engineIds={ids} />

      {/* Its analyses are hand-offs only: a host that shows none gets no section, and a page
          that copies them says so. */}
      {followUp !== "none" && (
        <section>
          <SectionHeading
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
    </div>
  )
}
