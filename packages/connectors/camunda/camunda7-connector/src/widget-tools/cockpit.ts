import { z } from "zod"
import { buildComposedView, buildSingleWidgetView } from "@miragon/pulse-widget-shell/server"
import type { CockpitAppData, CockpitEngineInfo } from "../view-models.js"
import { MAX_PAGE_SIZE } from "@miragon/pulse-camunda7-client/schemas"
import { buildProcessInstancesData, buildProcessListData } from "../data/cockpit-data.js"
import { buildHistoryTimelineData } from "../data/history-timeline-data.js"
import { buildProcessIncidentsData } from "../data/process-incidents-data.js"
import {
  CAMUNDA7_OPEN_COCKPIT,
  CAMUNDA7_SHOW_HISTORY_TIMELINE,
  CAMUNDA7_SHOW_PROCESS_DETAIL,
  CAMUNDA7_SHOW_PROCESS_INSTANCES,
  CAMUNDA7_SHOW_PROCESS_LIST,
} from "../tool-names.js"
import { resolveEngine } from "../lib/resolve-engine.js"
import { cockpitEngineScope } from "../lib/engine-preferences.js"
import { environmentOf } from "../lib/environments.js"
import {
  pagingShape,
  processInstancesFilterShape,
  processListFilterShape,
} from "../feed-contracts.js"
import { localizeFor, localizeViewFor } from "../lib/server-locale.js"
import { type WidgetToolsContext, definitionViewLayout, registerShowTool } from "./shared.js"

export function registerCockpitWidgetTools(ctx: WidgetToolsContext) {
  const { registry, profileStore } = ctx

  registerShowTool(ctx, {
    name: CAMUNDA7_OPEN_COCKPIT,
    title: "Open Cockpit",
    description:
      "Open the consolidated CIB Seven operations cockpit — a single app that navigates client-side (no extra tool calls) across the process landscape: overview, per-definition running instances, instance detail, plus quick access to human tasks, jobs and deployments. Use to browse and act; for a health verdict use camunda7_show_engine_health.",
    shape: {},
    render: async (args, ctx) => {
      const { t, title } = await localizeViewFor(profileStore, ctx)
      // A bad `engine` is a tool error, never a silent picker. The app passes the chosen engineId
      // to every nested call, so navigation never depends on the saved default.
      const { engines, engineId } = await cockpitEngineScope(
        profileStore,
        registry,
        args.engine,
        ctx,
      )
      const data: CockpitAppData = {
        engineId,
        // No REST baseUrl (internal topology). The explicit return type turns an extra field into
        // an excess-property error, which a contextually typed callback would accept silently.
        engines: engines.map((e): CockpitEngineInfo => ({
          id: e.id,
          environment: environmentOf(e),
        })),
      }
      return buildSingleWidgetView({
        widget: "camunda7:cockpit-app",
        app: "camunda7",
        dataType: "camunda7:cockpitApp",
        data,
        title: title("viewTitle.cockpit"),
        summary: engineId
          ? t("c7sum.cockpitOpened", { engineId, engineCount: data.engines.length })
          : t("c7sum.cockpitOpenedPicker", { engineCount: data.engines.length }),
      })
    },
  })

  registerShowTool(ctx, {
    name: CAMUNDA7_SHOW_PROCESS_LIST,
    title: "Process Definitions",
    description: "Show deployed process definitions as a card grid view.",
    shape: {
      ...processListFilterShape,
      latestVersion: processListFilterShape.latestVersion.default(true),
      ...pagingShape,
    },
    render: async ({ engine, ...filters }, ctx) => {
      const { t, title } = await localizeViewFor(profileStore, ctx)
      const { client, engineId } = await resolveEngine(engine, registry, ctx)
      const data = await buildProcessListData(client, engineId, filters)
      const matching = [
        filters.processDefinitionKey && `key "${filters.processDefinitionKey}"`,
        filters.nameLike && `name like "${filters.nameLike}"`,
      ]
        .filter(Boolean)
        .join(" and ")
      return buildSingleWidgetView({
        widget: "camunda7:process-list",
        app: "camunda7",
        dataType: "camunda7:processDefinitionList",
        data,
        title: title("viewTitle.processList"),
        summary: t("c7sum.processList", {
          totalCount: data.totalCount,
          filters: matching ? ` matching ${matching}` : "",
          engineId,
        }),
      })
    },
  })

  registerShowTool(ctx, {
    name: CAMUNDA7_SHOW_PROCESS_INSTANCES,
    title: "Process Instances",
    description:
      "List running process instances as a filterable table (business key, version, suspended/incident state). Scope to one definition via processDefinitionKey, or omit it for ALL running instances engine-wide. Drill-in target from the cockpit definitions table and process-detail; each row opens camunda7_show_instance_detail.",
    shape: {
      ...processInstancesFilterShape,
      firstResult: pagingShape.firstResult,
      maxResults: pagingShape.maxResults.default(50),
    },
    render: async ({ engine, ...filters }, ctx) => {
      const { t, title } = await localizeViewFor(profileStore, ctx)
      const { client, engineId } = await resolveEngine(engine, registry, ctx)
      const data = await buildProcessInstancesData(client, engineId, filters)
      return buildSingleWidgetView({
        widget: "camunda7:process-instances",
        app: "camunda7",
        dataType: "camunda7:processInstances",
        data,
        title: title("viewTitle.processInstances"),
        summary: t("c7sum.processInstances", {
          totalCount: data.totalCount,
          processDefinitionKey: data.processDefinitionKey ?? "(all definitions)",
          withIncidentCount: data.withIncidentCount,
          suspendedCount: data.suspendedCount,
          returnedCount: data.returnedCount,
        }),
      })
    },
  })

  registerShowTool(ctx, {
    name: CAMUNDA7_SHOW_PROCESS_DETAIL,
    title: "Process Definition Detail",
    description:
      "Open the unified process-definition view: header with actions, KPI strip (running instances, incidents, failed jobs), BPMN flow (incident overlays or execution heatmap) and the activity-grouped incident list. Drill-in target from cockpit-dashboard rows; camunda7_show_process_incidents opens the same view with incident focus.",
    shape: { processDefinitionKey: z.string().describe("Process definition key to display") },
    render: async ({ engine, ...target }, ctx) => {
      const t = await localizeFor(profileStore, ctx)
      const { client, engineId, ...urls } = await resolveEngine(engine, registry, ctx)
      const data = await buildProcessIncidentsData(client, { ...urls, ...target })
      return buildComposedView({
        app: "camunda7",
        layout: definitionViewLayout(),
        entries: [{ dataType: "camunda7:processIncidents", data: { ...data, engineId } }],
        summary: t("c7sum.processDetail", {
          processDefinitionKey: data.processDefinitionKey,
          diagramVersion: data.diagramVersion,
          runningInstances: data.runningInstances,
          openIncidents: data.incidentCount,
          failedJobs: data.failedJobs,
        }),
      })
    },
  })

  registerShowTool(ctx, {
    name: CAMUNDA7_SHOW_HISTORY_TIMELINE,
    title: "History Timeline",
    description: "Show activity timeline for a process instance.",
    shape: {
      processInstanceId: z.string().describe("The process instance ID"),
      firstResult: pagingShape.firstResult,
      maxResults: pagingShape.maxResults.default(MAX_PAGE_SIZE),
    },
    render: async ({ engine, ...target }, ctx) => {
      const { t, title } = await localizeViewFor(profileStore, ctx)
      const { client, engineId } = await resolveEngine(engine, registry, ctx)
      const data = await buildHistoryTimelineData(client, engineId, target)
      return buildSingleWidgetView({
        widget: "camunda7:history-timeline",
        app: "camunda7",
        dataType: "camunda7:historyTimeline",
        data,
        title: title("viewTitle.historyTimeline"),
        summary: t("c7sum.historyTimeline", {
          processInstanceId: target.processInstanceId,
          totalActivities: data.totalActivities,
          notFound: data.processInstance ? "" : t("c7sum.historyTimeline.notFound"),
        }),
      })
    },
  })
}
