import type { MessageCatalog } from "@miragon/mcp-toolkit-core"

/** Model-facing, but the model may quote them, so the voice rules apply too. */
export const enServer: MessageCatalog = {
  "aSum.bpmnHeatmap":
    'BPMN heatmap for "{key}" over {period}{engines}: heat values for {elementCount} element(s){fallbackNote}.',
  "aSum.bpmnHeatmapNoXml":
    "; no BPMN XML available, so the view has the heat values but no diagram",
  "aSum.clusterCompare":
    "Pre/post deployment comparison{scope}{engines} around {deploymentTimestamp} (measured -{before}d / +{after}d{partial}): {delta}{suppressed}.",
  "aSum.clusterComparePartial":
    ", partial: a window was cut short at now or at the retention; starts compare per day",
  "aSum.dashboard":
    "Analytics dashboard{scope} over {period}{engines}: within the period {totalCount} instance(s) started, {completedCount} completed, {incidentsCreated} incident(s) created ({incidentRatePct} per 100 started); right now {runningNow} running, {openIncidentsNow} incident(s) open.",
  "aSum.engineCompare":
    'Engine comparison of process "{key}" on "{engineA}" vs "{engineB}" over {windowDays}d: {delta}{suppressed}.',
  "aSum.engineLandscape":
    "Cross-engine landscape: {engineCount} engine(s) ({reportingEngineCount} reporting metrics), {processKeyCount} process definition(s), {runningInstances} running instance(s), {openIncidents} open incident(s).{shared}",
  "aSum.engineScopeFleet": " across all {count} configured engines ({ids}), aggregated",
  "aSum.engineScopeOne": ' on engine "{id}"',
  "aSum.engineScopeSubset": " across engines {ids}, aggregated",
  "aSum.failureDashboard":
    "Failure dashboard{engines}: {totalIncidents} incident(s) open right now in {uniqueErrorPatterns} group(s) by incident type and process{mostAffected}.",
  "aSum.mostAffectedProcess": '; most affected process: "{key}"',
  "aSum.scopeForProcess": ' for "{key}"',
  "aSum.sharedKeys":
    " Deployed on several engines (the only sound engine-vs-engine comparisons): {keys}.",
  "aSum.settings":
    "Analytics settings: default period {period}, min bucket size {minBucketSize}.{changeHint}",
  "aSum.settingsChangeHint": " Change via analytics_save_settings.",
  "aSum.settingsSaved":
    "Analytics settings saved: default period {period}, min bucket size {minBucketSize}.",
  "aSum.versionCompare":
    'Version comparison for "{key}" v{versionA} vs v{versionB} over {windowDays}d{engines}: {delta}{suppressed}.',
}
