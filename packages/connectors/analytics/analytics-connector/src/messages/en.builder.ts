import type { MessageCatalog } from "@miragon/mcp-toolkit-core"

/** People's names in the view builder; the definitions' `description`s stay the model's text. */
export const enBuilder: MessageCatalog = {
  "builder.app.title": "Analytics",

  "builder.widget.execution-summary-kpi.title": "Execution metrics",
  "builder.widget.execution-summary-kpi.summary":
    "Instances started and completed and incidents created in the period, plus what is running right now.",
  "builder.widget.execution-performance-kpi.title": "Execution performance",
  "builder.widget.execution-performance-kpi.summary":
    "Average, median and p95 duration of the instances that ended in the period, and incidents per 100 starts.",
  "builder.widget.process-definition-breakdown.title": "By process definition",
  "builder.widget.process-definition-breakdown.summary":
    "Starts, completions, incidents, running instances and average duration per process definition.",
  "builder.widget.activity-bottleneck-table.title": "Activities by total time",
  "builder.widget.activity-bottleneck-table.summary":
    "The activities that take the most time in the period, across all processes.",
  "builder.widget.failure-summary-kpi.title": "Failure analysis",
  "builder.widget.failure-summary-kpi.summary":
    "Open incidents right now, their groups by type and process, and the process hit hardest.",
  "builder.widget.error-patterns-table.title": "Open incidents by type",
  "builder.widget.error-patterns-table.summary":
    "The incidents open right now, grouped by type and process definition.",
  "builder.widget.failure-rate-table.title": "Open incidents by process",
  "builder.widget.failure-rate-table.summary":
    "Per process: running instances, jobs without retries, open incidents and incidents per 100 running instances.",
  "builder.widget.cluster-compare.title": "Before and after the deployment",
  "builder.widget.cluster-compare.summary":
    "Instance metrics before and after a deployment, side by side.",
  "builder.widget.version-compare.title": "Version comparison",
  "builder.widget.version-compare.summary":
    "The metrics of two versions of one process side by side.",
  "builder.widget.engine-compare.title": "Engine comparison",
  "builder.widget.engine-compare.summary":
    "The metrics of one process on two engines side by side.",
  "builder.widget.engine-landscape.title": "Cross-engine landscape",
  "builder.widget.engine-landscape.summary":
    "What runs where, the load per engine and the job backlog, as counts across all engines.",
  "builder.widget.bpmn-heatmap.title": "BPMN heatmap",
  "builder.widget.bpmn-heatmap.summary":
    "The diagram with how often each element ran or how long it took.",
  "builder.widget.settings.title": "Analytics settings",
  "builder.widget.settings.summary": "Your default period and the minimum size of a comparison.",

  "builder.step.load-dashboard.title": "Process analytics",
  "builder.step.load-dashboard.summary":
    "Reads the execution metrics of the period and the state right now from Prometheus.",
  "builder.step.load-failure-dashboard.title": "Failure analysis",
  "builder.step.load-failure-dashboard.summary":
    "Reads the open incidents and the jobs without retries right now from Prometheus.",

  "builder.field.dashboard.processDefinitionKey.title": "Process definition key",
  "builder.field.dashboard.processDefinitionKey.summary":
    "Narrows the metrics to one process definition. Without it, all processes.",
  "builder.field.dashboard.period.title": "Period",
  "builder.field.dashboard.period.summary":
    "The period the widget loads when no data source provides one.",
  "builder.field.dashboard.engine.title": "Engines",
  "builder.field.dashboard.engine.summary":
    "The engines to read from. Without them, all configured engines.",
  "builder.field.failure.engine.title": "Engines",
  "builder.field.failure.engine.summary":
    "The engines to read from. Without them, all configured engines.",
  "builder.field.engineLandscape.engine.title": "Engines",
  "builder.field.engineLandscape.engine.summary":
    "The engines in the landscape. Without them, all configured engines.",
}
