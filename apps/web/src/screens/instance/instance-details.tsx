import {
  HistoryTable,
  MarkerLegend,
  VariablesTable,
  WaitingTable,
  type InstanceSlots,
  type MarkerSwatchProps,
} from "@miragon/pulse-blocks"
import {
  cn,
  TabCount,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  type Count,
} from "@miragon/pulse-ui"
import type { InstanceScreenData } from "@miragon/pulse-screens"
import { useT } from "../../messages/index.js"
import type { Navigate } from "../../router/page-link.js"
import { INSTANCE_TABS, type InstanceTab } from "../../router/routes.js"
import { IncidentCards } from "./incident-cards.js"
import type { InstanceScreenFeed } from "./instance-feed.js"

/**
 * The tab the screen opens on where the reader picked none: the incidents where it has some, else
 * where it waits while it runs, else its history.
 */
export function preselectedTab(
  screen: Pick<InstanceScreenData, "incidents" | "instance">,
): InstanceTab {
  if (screen.incidents.length > 0) return "incidents"
  const { state } = screen.instance
  return state === "running" || state === "suspended" ? "waiting" : "history"
}

/** The sample of a marker, as the page's diagram draws it (`src/styles.css`). */
function Swatch({ kind }: MarkerSwatchProps) {
  return <span aria-hidden="true" className={cn("pulse-swatch", `pulse-swatch--${kind}`)} />
}

function rowsOf(screen: InstanceScreenFeed, tab: InstanceTab): number {
  switch (tab) {
    case "history":
      return screen.path.length
    case "incidents":
      return screen.incidents.length
    case "waiting":
      return screen.waits.length
    case "variables":
      return screen.variables.length
  }
}

/**
 * How many rows each tab holds, which its count says: a lower bound (`≥ n`) on every tab where the
 * engine cut some of the instance's lists (`truncated`, the strip's "Some lists are cut off"), since
 * its read names none of them, never the length of a cut list as its total.
 */
function countOf(screen: InstanceScreenFeed, tab: InstanceTab): Count {
  const rows = rowsOf(screen, tab)
  return screen.truncated ? { atLeast: rows } : rows
}

export interface InstanceDetailsProps {
  readonly screen: InstanceScreenFeed
  readonly tab: InstanceTab
  /** A pick of a tab: the page names its entry anew with it. */
  readonly onTab: (tab: InstanceTab) => void
  /** The root incident in focus, by its id. */
  readonly focus?: string
  readonly nameOf: (elementId: string) => string
  readonly navigate: Navigate
  readonly slots: InstanceSlots
}

/**
 * An instance's details below its diagram, in the editors' tabs and order: its history, its root
 * incidents, where it waits, its variables, each with its count, the legend of the diagram's
 * markers at the bar's end. A tab's content fills the room under the bar and scrolls in itself;
 * a table's rows open nothing, and nothing writes (no retry, no editor, no move).
 */
export function InstanceDetails(props: InstanceDetailsProps) {
  const { screen, tab, onTab, focus, nameOf, navigate, slots } = props
  const t = useT()
  const { engine } = screen
  return (
    <section
      aria-label={t("screen.instance.details")}
      className="bg-card flex h-full min-h-0 flex-col"
      data-slot="instance-details"
    >
      <Tabs
        value={tab}
        // Its triggers are the tabs of INSTANCE_TABS alone: a value is one of them.
        onValueChange={(value) => {
          onTab(value as InstanceTab)
        }}
        className="min-h-0 flex-1 gap-0"
      >
        <TabsList variant="line" aside={<MarkerLegend Swatch={Swatch} />}>
          {INSTANCE_TABS.map((id) => (
            <TabsTrigger key={id} value={id}>
              {t(`tab.${id}`)}
              <TabCount count={countOf(screen, id)} />
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent
          value="history"
          className="flex min-h-0 flex-col overflow-auto p-3"
          data-slot="instance-tab"
        >
          <HistoryTable path={screen.path} nameOf={nameOf} slots={slots} />
        </TabsContent>
        <TabsContent
          value="incidents"
          className="min-h-0 overflow-auto p-3"
          data-slot="instance-tab"
        >
          <IncidentCards
            engine={engine}
            incidents={screen.incidents}
            causes={screen.causes}
            {...(focus === undefined ? {} : { focus })}
            nameOf={nameOf}
            navigate={navigate}
            slots={slots}
          />
          {screen.incidents.length === 0 && (
            <p className="text-muted-foreground">{t("screen.instance.noIncidents")}</p>
          )}
        </TabsContent>
        <TabsContent
          value="waiting"
          className="flex min-h-0 flex-col overflow-auto p-3"
          data-slot="instance-tab"
        >
          <WaitingTable engine={engine} waits={screen.waits} nameOf={nameOf} slots={slots} />
        </TabsContent>
        <TabsContent
          value="variables"
          className="flex min-h-0 flex-col overflow-auto p-3"
          data-slot="instance-tab"
        >
          <VariablesTable variables={screen.variables} nameOf={nameOf} slots={slots} />
        </TabsContent>
      </Tabs>
    </section>
  )
}
