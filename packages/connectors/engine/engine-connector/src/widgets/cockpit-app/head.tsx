import type { ReactNode } from "react"
import {
  Button,
  cn,
  FOCUS_RING_INSET,
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
 * A section of the head: a line tab of the webview's tab bar (CI §8), the whole height of the bar,
 * the open one on the hover fill with a 2 px bar in `--interaction` on the bar's rule and its
 * label at 600; a Windows contrast theme draws that bar in Highlight and leaves the others unpainted.
 */
const SECTION_LINK = cn(
  "text-dense text-muted-foreground hover:bg-accent hover:text-foreground -mb-px inline-flex items-center gap-1.5 border-b-2 border-transparent px-2 whitespace-nowrap transition-colors",
  "aria-[current=page]:bg-accent aria-[current=page]:border-b-interaction aria-[current=page]:text-foreground aria-[current=page]:font-semibold",
  "forced-colors:border-b-[color:Canvas] forced-colors:aria-[current=page]:border-b-[color:Highlight]",
  FOCUS_RING_INSET,
)

/**
 * #322 U20: one compact head row instead of a sidebar that cost ~200 px inline: a 40 px bar from
 * edge to edge (the webview's bar), its rule below, the sections as line tabs and the engine's
 * context at its end. A `trail` takes the sections' place: its first crumb leads back to them. Its
 * container is `bar`, so the cross-engine button keeps only its icon in a bar under 36rem.
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
    <div
      data-slot="cockpit-head"
      className="bg-card border-border min-h-bar pr-gutter @container/bar flex min-w-0 flex-wrap items-stretch gap-x-3 border-b pl-2"
    >
      {/* The tabs start 8 px in, as a view's tab bar does; the trail's words line up with the
          view's title below, in the gutter. */}
      {trail ? (
        <div className="flex min-w-0 items-center ps-[calc(var(--gutter)-0.5rem)]">{trail}</div>
      ) : (
        <nav
          aria-label={translator(locale, "cockpit.aria.sections")}
          className="flex flex-wrap items-stretch"
        >
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              type="button"
              aria-current={activeSection === s.id ? "page" : undefined}
              onClick={() => onSection(s.intent)}
              className={SECTION_LINK}
            >
              <Icon icon={s.icon} />
              {translator(locale, `cockpit.section.${s.id}`)}
            </button>
          ))}
        </nav>
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

/** The trail under the head where there is room for both (fullscreen): a 36 px row on its rule. */
export function CockpitTrailBar({ children }: { children: ReactNode }) {
  return (
    <div
      data-slot="cockpit-trail"
      className="border-border bg-card min-h-toolbar px-gutter flex min-w-0 items-center border-b py-1"
    >
      {children}
    </div>
  )
}
