import type { ReactNode } from "react"
import {
  Button,
  cn,
  FOCUS_RING_INSET,
  TONE_DOT,
  TONE_ICON,
  useLocale,
} from "@miragon/mcp-toolkit-ui"
import { Icon, KometMark, WidgetShell, formatNumber } from "@miragon/pulse-widget-shell/widgets"
import { ArrowRight, CircleDashed, Layers, LoaderCircle, Unplug } from "lucide-react"
import { DEFAULT_ENVIRONMENT_ID, groupEnginesByEnvironment } from "../../lib/environments.js"
import { translator } from "../../messages/index.js"
import { useEngineHealth } from "./engine-health.js"

/** In words, so colour is never the only signal. */
export type EngineStatusKind =
  "loading" | "unreachable" | "empty" | "incidents" | "failedJobs" | "idle" | "healthy"

/** #322 U15, from the same live health as the engine's overview. */
export function engineStatusKind(health: {
  isError: boolean
  summary:
    | {
        totalDefinitions: number
        totalRunningInstances: number
        totalFailedJobs: number
        totalIncidents: number
      }
    | undefined
}): EngineStatusKind {
  if (health.isError) return "unreachable"
  const s = health.summary
  if (!s) return "loading"
  if (s.totalDefinitions === 0) return "empty"
  if (s.totalIncidents > 0) return "incidents"
  if (s.totalFailedJobs > 0) return "failedJobs"
  if (s.totalRunningInstances === 0) return "idle"
  return "healthy"
}

/** CI §3.7 */
function StatusMark({ kind }: { kind: EngineStatusKind }) {
  if (kind === "loading") {
    return <Icon icon={LoaderCircle} className="text-muted-foreground motion-safe:animate-spin" />
  }
  if (kind === "unreachable") return <Icon icon={Unplug} className={TONE_ICON.danger} />
  if (kind === "empty") return <Icon icon={CircleDashed} className="text-muted-foreground" />
  const tone =
    kind === "incidents" || kind === "failedJobs"
      ? "danger"
      : kind === "healthy"
        ? "success"
        : "neutral"
  return (
    <span className="inline-flex size-4 items-center justify-center" aria-hidden="true">
      <span className={cn("size-2 rounded-full", TONE_DOT[tone])} />
    </span>
  )
}

/** The state sits inside the button, so it is part of its accessible name. */
function EngineRow({
  engineId,
  isDefault,
  onEnter,
}: {
  engineId: string
  isDefault: boolean
  onEnter: () => void
}) {
  const locale = useLocale()
  const tr = (key: string, params?: Record<string, unknown>) => translator(locale, key, params)
  const { query, summary } = useEngineHealth(engineId)
  const kind = engineStatusKind({ isError: query.isError, summary })
  const status =
    kind === "incidents"
      ? tr("cockpit.landing.status.incidents", {
          count: formatNumber(summary?.totalIncidents ?? 0),
        })
      : kind === "failedJobs"
        ? tr("cockpit.landing.status.failedJobs", {
            count: formatNumber(summary?.totalFailedJobs ?? 0),
          })
        : tr(`cockpit.landing.status.${kind}`)
  return (
    <button
      type="button"
      onClick={onEnter}
      data-status={kind}
      className={cn(
        "hover:bg-muted text-dense flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors",
        FOCUS_RING_INSET,
      )}
    >
      <StatusMark kind={kind} />
      <span className="text-foreground min-w-0 truncate font-semibold">{engineId}</span>
      {isDefault && (
        <span className="border-input text-muted-foreground text-small shrink-0 rounded-sm border px-1.5">
          {tr("cockpit.landing.default")}
        </span>
      )}
      {/* A comma for the accessible name ("prod-a, 18 Incidents"); the eye reads the gap. */}
      <span className="sr-only">, </span>
      <span className="text-muted-foreground ms-auto shrink-0 text-right">{status}</span>
      <Icon icon={ArrowRight} dense className="text-muted-foreground" />
    </button>
  )
}

/** #322 U15: hangs on the theme slot a customer brand empties (`--brand-mark-display: none`). */
export function LandingHeader({ subtitle, action }: { subtitle?: string; action?: ReactNode }) {
  const locale = useLocale()
  return (
    <header className="flex flex-wrap items-center justify-between gap-4">
      <div className="flex min-w-0 items-center gap-4">
        <KometMark />
        <div className="min-w-0">
          <p
            data-brand-signature=""
            className="text-muted-foreground text-small font-semibold"
            style={{ display: "var(--brand-mark-display, block)" }}
          >
            {translator(locale, "cockpit.signature")}
          </p>
          <h1 className="text-title text-foreground font-bold tracking-tight">
            {translator(locale, "cockpit.landing.title")}
          </h1>
          {subtitle && <p className="text-muted-foreground text-dense mt-1">{subtitle}</p>}
        </div>
      </div>
      {action}
    </header>
  )
}

/** The same live health and severity ladder as the engine's own overview (#322 U15). */
export function LandingChooser({
  engines,
  defaultEngineId,
  onEnterEngine,
  onOpenFleet,
  notice,
}: {
  engines: Array<{ id: string; environment?: string }>
  defaultEngineId?: string | null
  onEnterEngine: (id: string) => void
  /** Omitted when analytics is inactive. */
  onOpenFleet?: () => void
  notice?: ReactNode
}) {
  const locale = useLocale()
  const tr = (key: string, params?: Record<string, unknown>) => translator(locale, key, params)
  const groups = groupEnginesByEnvironment(engines)
  const named = groups.length > 1 || groups[0]?.id !== DEFAULT_ENVIRONMENT_ID
  const subtitle = tr(named ? "cockpit.landing.subtitle.env" : "cockpit.landing.subtitle", {
    count: formatNumber(engines.length),
    envCount: formatNumber(groups.length),
  })
  return (
    <WidgetShell>
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
        {notice}
        <LandingHeader
          subtitle={subtitle}
          action={
            onOpenFleet && (
              <Button type="button" variant="outline" onClick={onOpenFleet}>
                <Icon icon={Layers} />
                {tr("cockpit.landing.fleet.open")}
              </Button>
            )
          }
        />
        {groups.map((g) => (
          <section
            key={g.id}
            aria-label={named ? tr("cockpit.landing.envLabel", { env: g.id }) : undefined}
            className="flex flex-col gap-2"
          >
            {named && (
              <h2 className="text-muted-foreground text-small font-semibold tracking-wide uppercase">
                {g.id}
              </h2>
            )}
            <ul className="border-border bg-card divide-border divide-y overflow-hidden rounded-md border">
              {g.engines.map((e) => (
                <li key={e.id}>
                  <EngineRow
                    engineId={e.id}
                    isDefault={e.id === defaultEngineId}
                    onEnter={() => onEnterEngine(e.id)}
                  />
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </WidgetShell>
  )
}
