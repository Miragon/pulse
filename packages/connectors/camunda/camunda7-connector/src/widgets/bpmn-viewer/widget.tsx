import type { BpmnViewerData } from "../../view-models.js"
import { WidgetShell } from "@miragon/pulse-widget-shell/widgets"
import { BpmnViewerHeader } from "./header.js"
import { BpmnViewerLegend } from "./legend.js"
import { BpmnFlowViewer } from "./flow.js"

/** `camunda7_show_bpmn_viewer`: the show tool's data is the view (the diagram's XML comes from its own feed). */
export function BpmnViewerWidget({ data }: { data: BpmnViewerData }) {
  return (
    <WidgetShell>
      <BpmnViewerHeader data={data} />
      <BpmnViewerLegend data={data} />
      <BpmnFlowViewer data={data} />
    </WidgetShell>
  )
}
