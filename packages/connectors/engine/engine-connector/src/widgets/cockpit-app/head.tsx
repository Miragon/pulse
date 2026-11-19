import type { ReactNode } from "react"
import {
  Button,
  cn,
  Icon,
  type LucideIcon,
  NativeSelect,
  NavTab,
  NavTabs,
  useLocale,
} from "@miragon/pulse-ui"
import { Cog, Layers, LayoutDashboard, TriangleAlert } from "lucide-react"
import { EnvironmentChip } from "../lib/engine-context.js"
import type { NavIntent } from "../navigation.js"
import { translator } from "../../messages/use-t.js"
import type { EngineDialect } from "../../view-models.js"
import { routeServes } from "../../view-models.dialects.js"
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
          className="max-w-56 font-semibold"
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
 * #322 U20: one compact head row instead of a sidebar that cost ~200 px inline: a 40 px bar from
 * edge to edge (the webview's bar), its rule below, the sections as pulse-ui's `NavTabs` (line
 * tabs whose open one's bar lands on that rule) and the engine's context at its end. Where the
 * two do not fit on one line (a phone-width chat) the sections stay on the head's last line, the
 * context above them, so the open section's bar still lands on the rule (`flex-wrap-reverse`;
 * the reading order stays the sections, then the context). A `trail` takes the sections' place:
 * its first crumb leads back to them; a `narrowTrail` takes it only where the head, as wide as the
 * cockpit, is narrower than 40rem, as the trail's own row then gives way (a page on a phone, A6).
 * Its container is `bar`, so the cross-engine button keeps only its icon in a bar under 36rem.
 * Only the sections whose route the engine's `dialect` is served by show (`ROUTE_DIALECTS`): a
 * Camunda 8 engine has none, nor has a refused profile. No section is current under a board's
 * target (`activeSection` null), which sits under the board alone.
 */
export function CockpitHead({
  activeSection,
  dialect,
  refused = false,
  onSection,
  engineSwitch,
  onOpenFleet,
  trail,
  narrowTrail,
}: {
  activeSection: TopSection | null
  /** The open engine's dialect; a refused profile's is unread. */
  dialect: EngineDialect | undefined
  /** Its profile refused: no section reads it, so none shows. */
  refused?: boolean
  onSection: (intent: NavIntent) => void
  engineSwitch: ReactNode
  onOpenFleet?: () => void
  trail?: ReactNode
  narrowTrail?: ReactNode
}) {
  const locale = useLocale()
  const crossEngine = translator(locale, "cockpit.nav.crossEngine")
  const sections = refused ? [] : SECTIONS.filter((section) => routeServes(section.id, dialect))
  // In a narrow cockpit the trail stands where the tabs stood, on the head's last line.
  const narrow = narrowTrail !== undefined
  return (
    <div
      data-slot="cockpit-head"
      className={cn(
        "bg-card border-border min-h-bar pr-gutter @container/bar flex min-w-0 items-stretch gap-x-3 border-b pl-2",
        trail ? "flex-wrap" : "flex-wrap-reverse",
      )}
    >
      {/* The tabs start 8 px in, as a view's tab bar does; the trail's words line up with the
          view's title below, in the gutter. */}
      {trail ? (
        <TrailInHead>{trail}</TrailInHead>
      ) : (
        <>
          {narrow && <TrailInHead className="hidden @max-[40rem]:flex">{narrowTrail}</TrailInHead>}
          {sections.length > 0 && (
            <NavTabs
              ariaLabel={translator(locale, "cockpit.aria.sections")}
              className={cn(narrow && "@max-[40rem]:hidden")}
            >
              {sections.map((s) => (
                <NavTab
                  key={s.id}
                  current={activeSection === s.id}
                  icon={<Icon icon={s.icon} />}
                  onClick={() => onSection(s.intent)}
                >
                  {translator(locale, `cockpit.section.${s.id}`)}
                </NavTab>
              ))}
            </NavTabs>
          )}
        </>
      )}
      <div className="ms-auto flex min-w-0 flex-wrap items-center gap-2 py-1">
        {onOpenFleet && (
          <Button
            type="button"
            variant="toolbar"
            size="sm"
            onClick={onOpenFleet}
            title={crossEngine}
          >
            <Icon icon={Layers} />
            {crossEngine}
          </Button>
        )}
        {engineSwitch}
        <CockpitRefreshButton />
      </div>
    </div>
  )
}

/** The trail in the head, its words in the gutter like the view's title below. */
function TrailInHead({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cn("flex min-w-0 items-center ps-[calc(var(--gutter)-0.5rem)]", className)}>
      {children}
    </div>
  )
}

/**
 * The trail under the head where there is room for both (fullscreen): a 36 px row on its rule.
 * `narrow`: it gives way to the head in a cockpit narrower than 40rem (a page's), measured on the
 * nearest container, `EngineBars`, as wide as the cockpit.
 */
export function CockpitTrailBar({
  narrow = false,
  children,
}: {
  narrow?: boolean
  children: ReactNode
}) {
  return (
    <div
      data-slot="cockpit-trail"
      className={cn(
        "border-border bg-card min-h-toolbar px-gutter flex min-w-0 items-center border-b py-1",
        narrow && "@max-[40rem]:hidden",
      )}
    >
      {children}
    </div>
  )
}
