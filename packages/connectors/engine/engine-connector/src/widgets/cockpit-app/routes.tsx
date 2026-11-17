import { useLocale } from "@miragon/pulse-ui"
import { ViewStack } from "@miragon/pulse-widget-shell/widgets"
import type {
  AppSection,
  CockpitSection,
  CockpitStart,
  CockpitStartData,
  CockpitView,
} from "../../view-models.js"
import { BoardView } from "../board/board-view.js"
import { ClusterDetailWidget } from "../cluster-detail.js"
import { ProcessDefinitionsTable } from "../cockpit-dashboard/definitions-table.js"
import { EngineHealthVerdict } from "../engine-health.js"
import { HistoryTimelineWidget } from "../history-timeline.js"
import { IncidentDetailWidget } from "../incident-detail.js"
import { IncidentsDashboard } from "../incidents-dashboard/view.js"
import { InstanceDetailWidget } from "../instance-detail.js"
import { JobPanelWidget } from "../job-panel.js"
import { crumbLabel } from "../nav-core.js"
import { ProcessDefinitionView } from "../process-incidents/view.js"
import { ProcessInstancesWidget } from "../process-instances/list.js"

/** The start data of `section`, or null: a seed of another route never reaches this one. */
function seedOf<S extends CockpitSection>(
  seed: CockpitStart | null,
  section: S,
): CockpitStartData[S] | null {
  return seed?.view.section === section ? (seed.data as CockpitStartData[S]) : null
}

/** A view of one engine's routes: every section but the app's. */
type EngineView = Exclude<CockpitView, { section: AppSection }>

/**
 * One cockpit view: an app route (a board, which reads the engines it names; the landing) or a
 * route of `engine`, seeded with the start view's data (`engine_open_cockpit`) while it is the view
 * on screen. A new route adds its section to `CockpitView` and a case here or in `EngineRoute`; the
 * exhaustive switches fail to compile until it does. A route whose title its data names keeps the
 * one its crumb shows while it loads or fails (`title`), so the page keeps its heading.
 */
export function CockpitRoute({
  view,
  engine,
  seed = null,
}: {
  view: CockpitView
  /** The engine an engine route reads; none on an app route. */
  engine: string | null
  seed?: CockpitStart | null
}) {
  const title = crumbLabel(view, useLocale())
  switch (view.section) {
    case "board":
      return <BoardView board={view.board} data={seedOf(seed, "board")} title={title} />
    // The landing is the cockpit's chooser over the engine list (`LandingChooser`), which the
    // cockpit shows on its landing scope, its start data seeding the boards: no widget here.
    case "landing":
      return null
    default:
      // The cockpit opens an engine's routes only with its engine.
      return engine === null ? null : (
        <EngineRoute view={view} engine={engine} seed={seed} title={title} />
      )
  }
}

/** One engine's view: self-fetching widgets scoped to `engine`. */
function EngineRoute({
  view,
  engine,
  seed,
  title,
}: {
  view: EngineView
  engine: string
  seed: CockpitStart | null
  title: string
}) {
  switch (view.section) {
    // The definitions table carries per-definition health; a second KPI grid would duplicate it.
    case "overview": {
      const overview = seedOf(seed, "overview")
      return (
        <ViewStack>
          <EngineHealthVerdict data={overview?.health ?? null} engine={engine} />
          <ProcessDefinitionsTable data={overview?.definitions ?? null} engine={engine} />
        </ViewStack>
      )
    }
    case "incidents":
      return <IncidentsDashboard data={seedOf(seed, "incidents")} engine={engine} />
    case "cluster-detail":
      return (
        <ClusterDetailWidget
          data={seedOf(seed, "cluster-detail")}
          engine={engine}
          activityId={view.activityId}
          incidentType={view.incidentType}
          messageSignature={view.messageSignature}
          title={title}
        />
      )
    case "process-detail":
      return (
        <ProcessDefinitionView
          data={seedOf(seed, "process-detail")}
          processDefinitionKey={view.processDefinitionKey}
          engine={engine}
          focus={view.focus}
          title={title}
        />
      )
    case "process-instances":
      return (
        <ProcessInstancesWidget
          data={seedOf(seed, "process-instances")}
          processDefinitionKey={view.processDefinitionKey}
          engine={engine}
        />
      )
    case "instance-detail":
      return (
        <InstanceDetailWidget
          data={seedOf(seed, "instance-detail")}
          processInstanceId={view.processInstanceId}
          engine={engine}
          title={title}
        />
      )
    case "incident-detail":
      return (
        <IncidentDetailWidget
          data={seedOf(seed, "incident-detail")}
          incidentId={view.incidentId}
          engine={engine}
          title={title}
        />
      )
    case "jobs":
      return (
        <JobPanelWidget
          data={seedOf(seed, "jobs")}
          engine={engine}
          processDefinitionKey={view.processDefinitionKey}
          failedOnly={view.failedOnly}
        />
      )
    case "history":
      return (
        <HistoryTimelineWidget
          data={seedOf(seed, "history")}
          processInstanceId={view.processInstanceId}
          engine={engine}
          title={title}
        />
      )
  }
  return view satisfies never
}
