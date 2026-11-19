import { useMemo, useState } from "react"
import {
  Alert,
  AlertDescription,
  SectionHeading,
  SegmentedControl,
  type SegmentedControlOption,
} from "@miragon/pulse-ui"
import { ViewDataState, WidgetShell } from "@miragon/pulse-widget-shell/widgets"
import { BpmnDiagram, type BpmnHighlight } from "../bpmn-diagram.js"
import { useT } from "../../messages/use-t.js"
import { useDefinitionData, type DefinitionScope } from "./feed.js"
import { RunningFlow } from "./running-flow.js"
import { ThroughputFlow } from "./throughput-flow.js"

type FlowMode = "incidents" | "running" | "throughput"

function FlowModeToolbar({
  mode,
  onChange,
  caption,
}: {
  mode: FlowMode
  onChange: (mode: FlowMode) => void
  caption: string
}) {
  const t = useT()
  const options: SegmentedControlOption<FlowMode>[] = [
    { value: "incidents", label: t("procIncFlow.modeIncidents") },
    { value: "running", label: t("procIncFlow.modeRunning") },
    {
      value: "throughput",
      // Its window stays in its name; a card under 21rem shows the word alone, on one line.
      label: (
        <span>
          {t("procIncFlow.modeThroughput")}
          <span className="@max-[21rem]/flow:sr-only">
            {" · "}
            {t("procIncFlow.modeThroughputWindow")}
          </span>
        </span>
      ),
    },
  ]
  return (
    <div className="@container/flow mb-2 flex flex-wrap items-center justify-between gap-3">
      <SegmentedControl<FlowMode>
        options={options}
        value={mode}
        onChange={onChange}
        ariaLabel={t("procIncFlow.modeAria")}
      />
      <span className="text-muted-foreground text-small">{caption}</span>
    </div>
  )
}

/**
 * Leads with the open incidents; "Running" (what runs at each element now) and "Throughput" (what
 * the last 30 days' instances passed, from the history) read only once picked.
 */
export function ProcessDefinitionFlow(scope: DefinitionScope) {
  const t = useT()
  const { engine } = scope
  const { data, loading, error, refetch } = useDefinitionData(scope)
  const [mode, setMode] = useState<FlowMode>("incidents")

  const highlights = useMemo<BpmnHighlight[]>(() => {
    const activities = data?.activities ?? []
    return [
      {
        kind: "incident",
        activityIds: activities.map((a) => a.activityId),
        counts: activities.map((a) => ({ activityId: a.activityId, count: a.incidentCount })),
      },
    ]
  }, [data?.activities])

  if (!data) {
    return (
      <WidgetShell>
        <ViewDataState
          loading={loading}
          error={error}
          onRetry={refetch}
          loadingText={t("procIncFlow.loading")}
          emptyText={t("procIncFlow.noDataAvailable")}
        />
      </WidgetShell>
    )
  }

  const toolbar = (caption: string) => (
    <FlowModeToolbar mode={mode} onChange={setMode} caption={caption} />
  )

  return (
    <WidgetShell>
      <section>
        {/* The affected activities are the KPI tile's count, said once (D6). */}
        <SectionHeading as="h2" title={t("procIncFlow.title")} />
        {!data.diagramDefinitionId ? (
          <Alert>
            <AlertDescription>{t("procIncFlow.noBpmnDiagram")}</AlertDescription>
          </Alert>
        ) : mode === "incidents" ? (
          <>
            {toolbar(t("procIncFlow.diagramVersion", { version: data.diagramVersion }))}
            <BpmnDiagram
              definitionId={data.diagramDefinitionId}
              engineId={engine}
              highlights={highlights}
            />
          </>
        ) : mode === "running" ? (
          <RunningFlow
            processDefinitionKey={data.processDefinitionKey}
            engine={engine}
            toolbar={toolbar}
          />
        ) : (
          <ThroughputFlow
            processDefinitionKey={data.processDefinitionKey}
            engine={engine}
            toolbar={toolbar}
          />
        )}
      </section>
    </WidgetShell>
  )
}
