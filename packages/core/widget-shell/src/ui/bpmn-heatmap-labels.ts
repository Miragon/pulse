/** The shell carries no module i18n, so callers inject `t()`-resolved values; the English defaults keep the component usable alone. */
export interface BpmnHeatmapLabels {
  title?: string
  window?: string
  frequency?: string
  duration?: string
  frequencyLegend?: string
  durationLegend?: string
  noData?: string
  noHeat?: string
  /** The kit does not know why there is no diagram, so its default names no cause. */
  bpmnUnavailable?: string
  less?: string
  more?: string
  diagramAriaLabel?: string
  errorTitle?: string
  /** No default, so a caller without a localized hint shows no English sentence. */
  errorHint?: string
  /** Default: the kit's en/de words (`kitLabels`). */
  valuesTable?: string
  elementColumn?: string
  valueColumn?: string
  modeAriaLabel?: string
}

/** The labels with an English default here; the rest default to the kit's en/de words. */
type DefaultedLabels = Omit<
  BpmnHeatmapLabels,
  "errorHint" | "valuesTable" | "elementColumn" | "valueColumn" | "modeAriaLabel"
>

export const DEFAULT_HEATMAP_LABELS: Required<DefaultedLabels> = {
  title: "BPMN heatmap",
  window: "window:",
  frequency: "Frequency",
  duration: "Duration",
  frequencyLegend: "Executions per element",
  durationLegend: "Avg duration per element",
  noData: "No heatmap data.",
  noHeat: "No metric data in this window.",
  bpmnUnavailable:
    "The BPMN diagram is not available. Ask in the chat for the figures per element instead.",
  less: "Less",
  more: "More",
  diagramAriaLabel: "BPMN process diagram with an execution heat overlay",
  errorTitle: "Diagram could not be rendered",
}
