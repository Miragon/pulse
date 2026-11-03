import { useMemo, useState, type ReactNode } from "react"
import {
  Badge,
  Card,
  CardContent,
  cn,
  FOCUS_RING,
  WidgetHeader,
  formatDuration,
  formatNumber,
  Icon,
  SegmentedControl,
  TableEmptyState,
  Td,
} from "@miragon/pulse-ui"
import { ListTable } from "@miragon/pulse-widget-shell/widgets"
import { ChevronRight } from "lucide-react"
import { useT } from "../../messages/use-t.js"
import { BpmnHeatmap, HeatmapLegend } from "./heat-diagram.js"
import { bpmnElementNames, bpmnProcessName, heatRange } from "./heat-utils.js"

export interface BpmnHeatmapData {
  processDefinitionKey: string
  bpmnXml: string | null
  period: string
  frequency: Record<string, number>
  /** Average duration per element in whole milliseconds. */
  durationMs: Record<string, number>
}

/** The heat a diagram shows: executions per element, or their average duration. */
export type HeatMode = "frequency" | "duration"

/** A heat value in the mode's unit: a count, or a duration ("3m 7s" / "3 Min. 7 s"). */
function formatHeat(mode: HeatMode, value: number): string {
  return mode === "frequency" ? formatNumber(value) : formatDuration(value)
}

/** The values behind the colours (U16): the number a colour cannot say, and the heatmap's text alternative. */
export function HeatValuesTable({
  bpmnXml,
  values,
  format,
}: {
  bpmnXml: string
  values: Record<string, number>
  format: (value: number) => string
}) {
  const t = useT()
  const names = useMemo(() => bpmnElementNames(bpmnXml), [bpmnXml])
  const rows = Object.entries(values)
    .filter(([, v]) => Number.isFinite(v) && v > 0)
    .sort(([, a], [, b]) => b - a)
  if (rows.length === 0) return null
  const title = t("aHeatmap.valuesTable")
  return (
    <details className="group">
      <summary
        className={cn(
          "text-dense flex w-fit cursor-pointer list-none items-center gap-1.5 rounded-sm font-medium [&::-webkit-details-marker]:hidden",
          FOCUS_RING,
        )}
      >
        <Icon
          icon={ChevronRight}
          className="text-muted-foreground transition-transform group-open:rotate-90 motion-reduce:transition-none"
        />
        {title}
      </summary>
      <div className="mt-2">
        <ListTable
          ariaLabel={title}
          columns={[
            { label: t("aHeatmap.elementColumn") },
            { label: t("aHeatmap.valueColumn"), align: "right" },
          ]}
        >
          {rows.map(([id, value]) => (
            <tr key={id}>
              <Td>
                {names[id] ?? <span className="font-mono">{id}</span>}
                {names[id] && (
                  <span className="text-muted-foreground text-small ml-2 font-mono">{id}</span>
                )}
              </Td>
              <Td align="right" className="tabular-nums">
                {format(value)}
              </Td>
            </tr>
          ))}
        </ListTable>
      </div>
    </details>
  )
}

/** Node-only: metrics carry no per-instance path data, so sequence flows are not heated. */
export function BpmnHeatmapWidget({
  data,
  bpmnUnavailable,
  meta,
}: {
  data: BpmnHeatmapData
  /** The empty state without a diagram: the caller knows why there is none. */
  bpmnUnavailable: string
  /** Replaces the period line, whose period it carries. */
  meta?: ReactNode
}) {
  const [mode, setMode] = useState<HeatMode>("frequency")
  const t = useT()
  const xml = data.bpmnXml
  // The process's name by the rule the other analytics views use (its own, else its pool's).
  const key = data.processDefinitionKey
  const processName = useMemo(() => (xml ? bpmnProcessName(xml, key) : null), [xml, key])

  if (!data.bpmnXml) return <TableEmptyState>{bpmnUnavailable}</TableEmptyState>

  const values = mode === "frequency" ? data.frequency : data.durationMs
  const legendLabel = t(
    mode === "frequency" ? "aHeatmap.frequencyLegend" : "aHeatmap.durationLegend",
  )
  const range = heatRange(values)
  const format = (value: number) => formatHeat(mode, value)

  return (
    <Card>
      <CardContent className="flex flex-col gap-4">
        <WidgetHeader
          as="h2"
          title={t("aHeatmap.title")}
          titleSuffix={
            processName ? (
              <>
                <Badge variant="outline" className="ml-2 align-middle">
                  {processName}
                </Badge>
                <span className="text-muted-foreground text-small ml-2 align-middle font-mono font-normal">
                  {data.processDefinitionKey}
                </span>
              </>
            ) : (
              <Badge variant="outline" className="ml-2 align-middle font-mono">
                {data.processDefinitionKey}
              </Badge>
            )
          }
          sub={
            meta ?? (
              <span>
                {t("aHeatmap.window")} {data.period}
              </span>
            )
          }
          actions={
            <SegmentedControl<HeatMode>
              ariaLabel={t("aHeatmap.metric")}
              value={mode}
              onChange={setMode}
              options={[
                { value: "frequency", label: t("aHeatmap.frequency") },
                { value: "duration", label: t("aHeatmap.duration") },
              ]}
            />
          }
        />

        <BpmnHeatmap
          bpmnXml={data.bpmnXml}
          nodeFrequencies={values}
          diagramAriaLabel={t("aHeatmap.diagramAria")}
          errorTitle={t("aHeatmap.errorTitle")}
          errorHint={t("aHeatmap.errorHint")}
          noHeatLabel={t("aHeatmap.noHeat")}
        />

        <div className="flex flex-wrap items-center gap-3">
          <span className="text-muted-foreground text-small">{legendLabel}</span>
          <HeatmapLegend
            min={range ? format(range.min) : undefined}
            max={range ? format(range.max) : undefined}
          />
        </div>
        <HeatValuesTable bpmnXml={data.bpmnXml} values={values} format={format} />
      </CardContent>
    </Card>
  )
}
