import { WidgetRenderer, type WidgetComponent } from "@miragon/mcp-toolkit-ui/app"
import {
  countTone,
  filterLayoutToWidgets,
  formatNumber,
  HandOffButton,
  Icon,
} from "@miragon/pulse-widget-shell/widgets"
import { ArrowRight } from "lucide-react"
import { CountPill, FOCUS_RING, SectionHeading, TONE_DOT, cn } from "@miragon/mcp-toolkit-ui"
import type { CockpitDashboardData } from "../../view-models.js"
import {
  enginesByEnvironment,
  formatEnginesByEnvironment,
  groupEnginesByEnvironment,
} from "../../lib/environments.js"
import { useT } from "../../messages/use-t.js"
import { useHandOff, type HandOff } from "../lib/hand-off.js"
import { useEngineHealth } from "./engine-health.js"
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
      {/* One severity ladder (#322 U14): open incidents and jobs without
          retries are danger when there are any; a zero is a count, neutral. */}
      <div>
        <div className="text-muted-foreground text-small">{t("fleet.incidents")}</div>
        <div>
          <CountPill tone={countTone(incidents)}>{formatNumber(incidents)}</CountPill>
        </div>
      </div>
      <div>
        <div className="text-muted-foreground text-small">{t("fleet.failedJobs")}</div>
        <div>
          <CountPill tone={countTone(failed)}>{formatNumber(failed)}</CountPill>
        </div>
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
  const { query: q, summary: s, incidents, failed, tone } = useEngineHealth(engineId)
  const t = useT()
  const kind = engineStatusKind({ isError: q.isError, summary: s })

  return (
    <button
      type="button"
      onClick={onEnter}
      // No aria-label: it would replace the accessible name and hide the KPIs from screen readers.
      className={cn(
        "border-border bg-card hover:bg-muted flex flex-col gap-3 rounded-xl border p-4 text-left transition-colors",
        FOCUS_RING,
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-foreground inline-flex min-w-0 items-center gap-2 font-semibold">
          <span className={cn("size-2 shrink-0 rounded-full", TONE_DOT[tone])} aria-hidden />
          {environment && <EnvironmentChip environment={environment} />}
          <span className="truncate">{engineId}</span>
        </span>
        <span className="text-muted-foreground text-small inline-flex items-center gap-1">
          {t("fleet.operate")}
          <Icon icon={ArrowRight} dense />
        </span>
      </div>

      {/* The same words as the chooser: "nicht erreichbar", "lädt …" (#322 U15). */}
      {kind === "unreachable" || kind === "loading" || !s ? (
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

const LANDSCAPE_WIDGET = "analytics:engine-landscape"

/** Tier-2: `filterLayoutToWidgets` drops the cell when analytics is not bundled. */
function LandscapeSection({
  engineIds,
  widgets,
}: {
  engineIds: string[]
  widgets: Record<string, WidgetComponent>
}) {
  const t = useT()
  const layout = filterLayoutToWidgets(
    // The full list, so an engine without metrics still shows instead of dropping out.
    [{ row: [{ widget: LANDSCAPE_WIDGET, props: { engine: engineIds } }] }],
    widgets,
  )
  if (!(LANDSCAPE_WIDGET in widgets)) return null
  // The landscape heads itself; a second heading said it twice (#322 U27).
  return (
    <section aria-label={t("fleet.landscape.title")}>
      <WidgetRenderer layout={layout} keys={{}} errors={[]} widgets={widgets} />
    </section>
  )
}

interface Fleet {
  engineIds: string[]
  environments: string[] | undefined
}

/** The "never rank engines by a rate" rule lives in the analytics instructions. */
export function fleetOverviewHandOff({ engineIds, environments }: Fleet): HandOff {
  return {
    intent: "askAi.fleet.overview",
    ids: { engine: engineIds },
    facts: { environments },
    tools: ["analytics_engine_landscape", "analytics_engine_health", "analytics_engine_compare"],
  }
}

export function fleetFailuresHandOff({ engineIds, environments }: Fleet): HandOff {
  return {
    intent: "askAi.fleet.failures",
    ids: { engine: engineIds },
    facts: { environments },
    tools: ["analytics_show_failure_dashboard"],
  }
}

export function fleetPerformanceHandOff({ engineIds, environments }: Fleet): HandOff {
  return {
    intent: "askAi.fleet.performance",
    ids: { engine: engineIds, period: "7d" },
    facts: { environments },
    tools: ["analytics_show_dashboard"],
  }
}

/**
 * An overview, not a scoreboard: engines host different processes, so ranking them by
 * rate or duration would rank their process mixes.
 */
export function FleetView({
  engines,
  onEnterEngine,
  widgets,
}: {
  engines: Array<{ id: string; environment?: string }>
  onEnterEngine: (id: string) => void
  widgets: Record<string, WidgetComponent>
}) {
  const t = useT()
  const { ask } = useHandOff()
  const ids = engines.map((e) => e.id)
  // The fleet itself stays all engines, across environments.
  const engineGroups = groupEnginesByEnvironment(engines)
  const idList = formatEnginesByEnvironment(engineGroups)
  const fleet: Fleet = { engineIds: ids, environments: enginesByEnvironment(engineGroups) }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-title text-foreground mb-1.5 tracking-tight">{t("fleet.heading")}</h1>
          <div className="text-muted-foreground text-small">
            {t("fleet.engineCount", { count: formatNumber(engines.length), list: idList })}
          </div>
        </div>
        <HandOffButton action="assess" prompt={ask(fleetOverviewHandOff(fleet))} />
      </header>

      <section className="flex flex-col gap-4">
        <SectionHeading title={t("fleet.engineHealth.title")} hint={t("fleet.engineHealth.hint")} />
        {engineGroups.map((g) => (
          <div key={g.id}>
            {engineGroups.length > 1 && (
              <h3 className="text-muted-foreground text-small mb-2 font-semibold tracking-wide uppercase">
                {g.id}
              </h3>
            )}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
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

      <LandscapeSection engineIds={ids} widgets={widgets} />

      <section>
        <SectionHeading
          title={t("fleet.fleetAnalyses.title")}
          hint={t("fleet.fleetAnalyses.hint")}
        />
        <div className="flex flex-wrap items-center gap-2">
          <HandOffButton action="analyzeFailures" prompt={ask(fleetFailuresHandOff(fleet))} />
          <HandOffButton action="analyzePerformance" prompt={ask(fleetPerformanceHandOff(fleet))} />
        </div>
      </section>
    </div>
  )
}
