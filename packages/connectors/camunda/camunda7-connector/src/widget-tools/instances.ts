import { z } from "zod"
import {
  buildComposedView,
  buildSingleWidgetView,
  showToolBinding,
  withToolErrors,
  strictToolInput,
} from "@miragon/pulse-widget-shell/server"
import { buildJobPanelData } from "../data/cockpit-data.js"
import { buildInstanceDetailData } from "../data/instance-detail-data.js"
import { buildBpmnViewerData } from "../data/bpmn-viewer-data.js"
import {
  CAMUNDA7_SHOW_BPMN_VIEWER,
  CAMUNDA7_SHOW_INSTANCE_DETAIL,
  CAMUNDA7_SHOW_JOB_PANEL,
} from "../tool-names.js"
import { resolveEngine } from "../lib/resolve-engine.js"
import { jobsFilterShape, pagingShape } from "../feed-contracts.js"
import { localizeViewFor } from "../lib/server-locale.js"
import { type WidgetToolsContext, registerShowTool } from "./shared.js"

export function registerInstanceWidgetTools(ctx: WidgetToolsContext) {
  const { server, registry, profileStore, engineParam } = ctx

  registerShowTool(ctx, {
    name: CAMUNDA7_SHOW_INSTANCE_DETAIL,
    title: "Process Instance Detail",
    description:
      "Show detailed view of a single process instance with activity tree, variables, and incidents.",
    shape: { processInstanceId: z.string().describe("The process instance ID to inspect") },
    render: async ({ engine, ...target }, ctx) => {
      const { t, title } = await localizeViewFor(profileStore, ctx)
      const { client, engineId, ...urls } = await resolveEngine(engine, registry, ctx)
      const data = await buildInstanceDetailData(client, engineId, target, urls)
      const state = data.instance.ended
        ? t("c7sum.state.ended")
        : data.instance.suspended
          ? t("c7sum.state.suspended")
          : t("c7sum.state.active")
      return buildSingleWidgetView({
        widget: "camunda7:instance-detail",
        app: "camunda7",
        dataType: "camunda7:processInstance",
        data,
        title: title("viewTitle.instanceDetail"),
        summary: t("c7sum.instanceDetail", {
          instanceId: data.instance.id,
          businessKey: data.instance.businessKey
            ? ` (business key "${data.instance.businessKey}")`
            : "",
          state,
          activeActivities: data.activeActivityIds.length,
          openIncidents: data.incidentCount,
          openTasks: data.openTaskCount,
        }),
      })
    },
  })

  server.tool(
    {
      name: CAMUNDA7_SHOW_BPMN_VIEWER,
      title: "BPMN Diagram Viewer",
      description:
        "Show an interactive BPMN diagram: `processInstanceId` overlays one running instance's active activities, incidents and failed jobs; `processDefinitionKey` (optional `version`) shows a definition version, its badges counting every running instance of that version.",
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
      inputSchema: strictToolInput({
        processInstanceId: z
          .string()
          .optional()
          .describe("Process instance ID. Renders diagram with live overlays."),
        processDefinitionKey: z
          .string()
          .optional()
          .describe("Process definition key. Badges count every running instance of the version."),
        version: z
          .number()
          .int()
          .positive()
          .optional()
          .describe(
            "Specific definition version. Requires `processDefinitionKey`. Defaults to the latest version when omitted.",
          ),
        ...engineParam,
      })
        .refine((v) => v.processInstanceId || v.processDefinitionKey, {
          message: "Provide either `processInstanceId` or `processDefinitionKey`.",
        })
        .refine((v) => !v.version || v.processDefinitionKey, {
          message: "`version` requires `processDefinitionKey`.",
          path: ["version"],
        }),
      ...showToolBinding(CAMUNDA7_SHOW_BPMN_VIEWER, "BPMN Diagram Viewer"),
    },
    withToolErrors(async ({ engine, ...diagram }, ctx) => {
      const { t, title } = await localizeViewFor(profileStore, ctx)
      const { client, engineId } = await resolveEngine(engine, registry, ctx)
      const data = await buildBpmnViewerData(client, engineId, diagram)

      const view = (summary: string) =>
        buildComposedView({
          app: "camunda7",
          title: title("viewTitle.bpmnViewer"),
          layout: [{ row: [{ widget: "camunda7:bpmn-viewer" }] }],
          entries: [{ dataType: "camunda7:bpmnViewer", data }],
          summary,
        })

      if (!data.processDefinitionId) {
        return view(t("c7sum.bpmnViewer.empty"))
      }

      // The bpmnXml (often tens of KB) never reaches the text channel. An instance target reports
      // only its own failed jobs, never the definition's.
      const totalFailedJobs = data.activityStats.reduce((sum, s) => sum + s.failedJobs, 0)
      const target = data.processInstanceId
        ? t("c7sum.bpmnViewer.targetInstance", { processInstanceId: data.processInstanceId })
        : t("c7sum.bpmnViewer.targetDefinition", { definitionId: data.processDefinitionId })
      const overlayInfo = data.processInstanceId
        ? t("c7sum.bpmnViewer.overlays", {
            activeActivities: data.activeActivityIds.length,
            incidentActivities: data.incidentActivityIds.length,
            failedJobs: totalFailedJobs,
          })
        : t("c7sum.bpmnViewer.noOverlays")
      return view(
        t("c7sum.bpmnViewer", {
          target,
          overlayInfo,
          xmlUnavailable: data.diagramDefinitionId ? "" : t("c7sum.bpmnViewer.xmlUnavailable"),
        }),
      )
    }),
  )

  registerShowTool(ctx, {
    name: CAMUNDA7_SHOW_JOB_PANEL,
    title: "Job Management Panel",
    description:
      "Show jobs with a focus on failed jobs (no retries left). Displays error messages and retry status.",
    shape: {
      ...jobsFilterShape,
      failedOnly: jobsFilterShape.failedOnly.default(false),
      ...pagingShape,
    },
    render: async ({ engine, ...filters }, ctx) => {
      const { t, title } = await localizeViewFor(profileStore, ctx)
      const { client, engineId } = await resolveEngine(engine, registry, ctx)
      const data = await buildJobPanelData(client, engineId, filters)
      return buildSingleWidgetView({
        widget: "camunda7:job-panel",
        app: "camunda7",
        dataType: "camunda7:jobPanel",
        title: title("viewTitle.jobPanel"),
        data,
        summary: t("c7sum.jobPanel", {
          totalCount: data.totalCount,
          failedCount: data.failedCount,
          forProcess: filters.processDefinitionKey
            ? t("c7sum.jobPanel.forProcess", { processDefinitionKey: filters.processDefinitionKey })
            : "",
          failedOnly: filters.failedOnly ? t("c7sum.jobPanel.failedOnly") : "",
        }),
      })
    },
  })
}
