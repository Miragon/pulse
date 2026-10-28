import { Alert, AlertDescription, useToolQuery } from "@miragon/mcp-toolkit-ui"
import type { BpmnViewerData } from "../../view-models.js"
import { WidgetShell } from "@miragon/pulse-widget-shell/widgets"
import { CAMUNDA7_BPMN_VIEWER_DATA } from "../../tool-names.js"
import { useT } from "../../messages/use-t.js"
import { BpmnViewerHeader } from "./header.js"
import { BpmnViewerLegend } from "./legend.js"
import { BpmnFlowViewer } from "./flow.js"

export interface BpmnViewerProps {
  processInstanceId?: string
  processDefinitionKey?: string
  version?: number
  /** Omitted: the caller's saved default or the single engine. */
  engine?: string
}

function feedArgs({
  processInstanceId,
  processDefinitionKey,
  version,
  engine,
}: BpmnViewerProps): Record<string, unknown> {
  const queryArgs: Record<string, unknown> = {}
  if (processInstanceId) queryArgs.processInstanceId = processInstanceId
  if (processDefinitionKey) queryArgs.processDefinitionKey = processDefinitionKey
  if (version !== undefined) queryArgs.version = version
  if (engine) queryArgs.engine = engine
  return queryArgs
}

function feedKey({ processInstanceId, processDefinitionKey, version, engine }: BpmnViewerProps) {
  return [
    "camunda7:bpmn-viewer",
    engine ?? null,
    processInstanceId ?? null,
    processDefinitionKey ?? null,
    version ?? null,
  ]
}

function BpmnViewerLoading() {
  const t = useT()
  return (
    <WidgetShell>
      <Alert>
        <AlertDescription>{t("bpmnWidget.loading")}</AlertDescription>
      </Alert>
    </WidgetShell>
  )
}

function BpmnViewerLoadError({ error }: { error: Error | null }) {
  const t = useT()
  return (
    <WidgetShell>
      <Alert variant="destructive">
        <AlertDescription>
          {t("bpmnWidget.loadError", {
            message: error?.message ?? t("viewState.unknownError"),
          })}
        </AlertDescription>
      </Alert>
    </WidgetShell>
  )
}

export function BpmnViewerWidget({
  data: initialData,
  processInstanceId,
  processDefinitionKey,
  version,
  engine,
}: { data: BpmnViewerData | null } & BpmnViewerProps) {
  const scope: BpmnViewerProps = { processInstanceId, processDefinitionKey, version, engine }

  const canSelfFetch = Boolean(processInstanceId || processDefinitionKey)

  // The app-only feed: calling show_* from the iframe may render a second widget per refresh.
  const query = useToolQuery<BpmnViewerData>(
    feedKey(scope),
    CAMUNDA7_BPMN_VIEWER_DATA,
    feedArgs(scope),
    {
      enabled: !initialData && canSelfFetch,
    },
  )

  const data = initialData ?? query.data ?? null

  if (!data && query.isPending && canSelfFetch) {
    return <BpmnViewerLoading />
  }

  if (!data && query.isError) {
    return <BpmnViewerLoadError error={query.error} />
  }

  return (
    <WidgetShell>
      <BpmnViewerHeader data={data} />
      <BpmnViewerLegend data={data} />
      <BpmnFlowViewer data={data} />
    </WidgetShell>
  )
}
