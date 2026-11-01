import type { MessageCatalog } from "@miragon/pulse-widget-shell/widgets"

/** Model-facing, but the model may quote them, so the voice rules apply too. */
export const enServer: MessageCatalog = {
  "aSum.bpmnHeatmap":
    'BPMN heatmap for "{key}" over {period}{engines}: heat values for {elementCount} element(s){fallbackNote}.',
  "aSum.bpmnHeatmapNoXml":
    "; no BPMN XML available, so the view has the heat values but no diagram",
  "aSum.engineScopeFleet": " across all {count} configured engines ({ids}), aggregated",
  "aSum.engineScopeOne": ' on engine "{id}"',
  "aSum.engineScopeSubset": " across engines {ids}, aggregated",
}
