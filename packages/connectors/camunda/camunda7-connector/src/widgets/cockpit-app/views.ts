import type { LayoutConfig } from "@miragon/mcp-toolkit-core"
import { SHELL_SETTINGS_PAGE_WIDGET } from "@miragon/pulse-widget-shell/widgets"

/** One flat bag, so a new view never threads a new prop type through the router. */
export interface ViewParams {
  engine: string
  processDefinitionKey?: string
  processInstanceId?: string
  incidentId?: string
  activityId?: string
  incidentType?: string
  messageSignature?: string
  /** "incidents" keeps the explorative no-incidents empty state. */
  focus?: "incidents"
}

type CockpitViewBuilder = (params: ViewParams) => LayoutConfig

/**
 * Self-fetching widgets under shared query keys (one call per data type). A new surface
 * registers its widget in `registry.ts` and adds a row here; the shell never changes.
 */
const views = {
  // The definitions table carries per-definition health; a second KPI grid would duplicate it.
  overview: ({ engine }: ViewParams): LayoutConfig => [
    { row: [{ widget: "camunda7:engine-health", props: { engine } }] },
    { row: [{ widget: "camunda7:process-definitions-table", props: { engine } }] },
  ],
  "process-list": ({ engine }: ViewParams): LayoutConfig => [
    { row: [{ widget: "camunda7:process-list", props: { engine } }] },
  ],
  incidents: ({ engine }: ViewParams): LayoutConfig => [
    { row: [{ widget: "camunda7:incident-overview-kpi", props: { engine } }] },
    { row: [{ widget: "camunda7:incident-process-list", props: { engine } }] },
  ],
  "cluster-detail": ({ engine, activityId, incidentType, messageSignature }: ViewParams) => [
    {
      row: [
        {
          widget: "camunda7:cluster-detail",
          props: { engine, activityId, incidentType, messageSignature },
        },
      ],
    },
  ],
  // The one definition view; `focus` only steers the list's no-incidents rendering.
  "process-detail": ({ engine, processDefinitionKey, focus }: ViewParams): LayoutConfig => [
    {
      row: [{ widget: "camunda7:process-detail-header", props: { processDefinitionKey, engine } }],
    },
    {
      row: [{ widget: "camunda7:process-definition-kpi", props: { processDefinitionKey, engine } }],
    },
    {
      row: [
        { widget: "camunda7:process-definition-flow", props: { processDefinitionKey, engine } },
      ],
    },
    {
      row: [
        {
          widget: "camunda7:activity-incident-list",
          props: {
            processDefinitionKey,
            engine,
            emptyVariant: focus === "incidents" ? "siblings" : "note",
          },
        },
      ],
    },
  ],
  "process-instances": ({ engine, processDefinitionKey }: ViewParams): LayoutConfig => [
    { row: [{ widget: "camunda7:process-instances", props: { processDefinitionKey, engine } }] },
  ],
  "instance-detail": ({ engine, processInstanceId }: ViewParams): LayoutConfig => [
    { row: [{ widget: "camunda7:instance-detail", props: { processInstanceId, engine } }] },
  ],
  "incident-detail": ({ engine, incidentId }: ViewParams): LayoutConfig => [
    { row: [{ widget: "camunda7:incident-detail", props: { incidentId, engine } }] },
  ],
  settings: (): LayoutConfig => [{ row: [{ widget: SHELL_SETTINGS_PAGE_WIDGET, props: {} }] }],
} satisfies Record<string, CockpitViewBuilder>

export type CockpitViewId = keyof typeof views

export const cockpitViews: Record<CockpitViewId, CockpitViewBuilder> = views
