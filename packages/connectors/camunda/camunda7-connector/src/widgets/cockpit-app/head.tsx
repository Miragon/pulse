import type { ReactNode } from "react"
import {
  Button,
  cn,
  FOCUS_RING,
  Icon,
  type LucideIcon,
  NativeSelect,
  useLocale,
} from "@miragon/pulse-ui"
import { Cog, Layers, LayoutDashboard, TriangleAlert } from "lucide-react"
import { EnvironmentChip } from "../lib/engine-context.js"
import type { NavIntent } from "../navigation.js"
import { translator } from "../../messages/use-t.js"
import { CockpitRefreshButton } from "./refresh-button.js"

export type TopSection = "overview" | "incidents" | "jobs"

const SECTIONS: Array<{ id: TopSection; intent: NavIntent; icon: LucideIcon }> = [
  { id: "overview", intent: { type: "overview" }, icon: LayoutDashboard },
  { id: "incidents", intent: { type: "incidents" }, icon: TriangleAlert },
  { id: "jobs", intent: { type: "jobs" }, icon: Cog },
]

/** #322 U4: environment chip plus engine select, optgroups by environment. */
export function EngineSwitch({
  engineId,
  environment,
  engineGroups,
  onSwitch,
}: {
  engineId: string
  environment: string | null
  engineGroups: Array<{ id: string; engines: Array<{ id: string }> }>
  onSwitch: (id: string) => void
}) {
  const locale = useLocale()
  const engines = engineGroups.flatMap((g) => g.engines)
  return (
    <div data-slot="engine-context" className="flex min-w-0 items-center gap-2">
      {environment && <EnvironmentChip environment={environment} />}
      {engines.length > 1 ? (
        <NativeSelect
          aria-label={translator(locale, "cockpit.aria.activeEngine")}
          value={engineId}
          onChange={(e) => onSwitch(e.target.value)}
          className="h-8 max-w-56 font-semibold"
        >
          {engineGroups.length > 1
            ? engineGroups.map((g) => (
                <optgroup key={g.id} label={g.id.toUpperCase()}>
                  {g.engines.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.id}
                    </option>
                  ))}
                </optgroup>
              ))
            : engines.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.id}
                </option>
              ))}
        </NativeSelect>
      ) : (
        <span className="text-dense text-foreground truncate font-semibold">{engineId}</span>
      )}
    </div>
  )
}

/**
 * #322 U20: one compact head row instead of a sidebar that cost ~200 px inline. A `trail` takes
 * the sections' place: its first crumb leads back to them.
 */
export function CockpitHead({
  activeSection,
  onSection,
  engineSwitch,
  onOpenFleet,
  trail,
}: {
  activeSection: TopSection
  onSection: (intent: NavIntent) => void
  engineSwitch: ReactNode
  onOpenFleet?: () => void
  trail?: ReactNode
}) {
  const locale = useLocale()
  const crossEngine = translator(locale, "cockpit.nav.crossEngine")
  return (
    <div className="border-border @container mb-4 border-b pb-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {trail ?? (
          <nav
            aria-label={translator(locale, "cockpit.aria.sections")}
            className="flex flex-wrap items-center gap-1"
          >
            {SECTIONS.map((s) => {
              const isActive = activeSection === s.id
              return (
                <button
                  key={s.id}
                  type="button"
                  aria-current={isActive ? "page" : undefined}
                  onClick={() => onSection(s.intent)}
                  className={cn(
                    "text-dense inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 font-medium transition-colors",
                    FOCUS_RING,
                    isActive
                      ? "bg-accent text-accent-foreground font-semibold"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  <Icon icon={s.icon} />
                  {translator(locale, `cockpit.section.${s.id}`)}
                </button>
              )
            })}
          </nav>
        )}
        <div className="ms-auto flex min-w-0 flex-wrap items-center gap-2">
          {onOpenFleet && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onOpenFleet}
              aria-label={crossEngine}
              title={crossEngine}
            >
              <Icon icon={Layers} />
              <span className="hidden @4xl:inline">{crossEngine}</span>
            </Button>
          )}
          {engineSwitch}
          <CockpitRefreshButton />
        </div>
      </div>
    </div>
  )
}
