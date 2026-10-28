import type { MessageCatalog } from "@miragon/mcp-toolkit-core"

/**
 * The model may quote these, so they use the glossary terms ("Incident") and no dash as a
 * connector.
 */
export const deServer: MessageCatalog = {
  "aSum.bpmnHeatmap":
    'BPMN-Heatmap für "{key}" über {period}{engines}: Heat-Werte für {elementCount} Element(e){fallbackNote}.',
  "aSum.bpmnHeatmapNoXml":
    "; kein BPMN-XML verfügbar, die Ansicht hat die Heat-Werte, aber kein Diagramm",
  "aSum.clusterCompare":
    "Vor/Nach-Deployment-Vergleich{scope}{engines} um {deploymentTimestamp} (gemessen -{before} d / +{after} d{partial}): {delta}{suppressed}.",
  "aSum.clusterComparePartial":
    ", unvollständig: ein Zeitraum wurde bei jetzt oder an der Aufbewahrungsgrenze gekürzt; Starts werden pro Tag verglichen",
  "aSum.dashboard":
    "Analyse-Dashboard{scope} über {period}{engines}: im Zeitraum {totalCount} Instanz(en) gestartet, {completedCount} abgeschlossen, {incidentsCreated} Incident(s) erzeugt ({incidentRatePct} pro 100 gestartete); aktuell {runningNow} laufend, {openIncidentsNow} Incident(s) offen.",
  "aSum.engineCompare":
    'Engine-Vergleich des Prozesses "{key}" auf "{engineA}" vs. "{engineB}" über {windowDays} d: {delta}{suppressed}.',
  "aSum.engineLandscape":
    "Engine-übergreifende Übersicht: {engineCount} Engine(s) ({reportingEngineCount} mit Metriken), {processKeyCount} Prozessdefinition(en), {runningInstances} laufende Instanz(en), {openIncidents} offene(s) Incident(s).{shared}",
  "aSum.engineScopeFleet": " über alle {count} konfigurierten Engines ({ids}), aggregiert",
  "aSum.engineScopeOne": ' auf Engine "{id}"',
  "aSum.engineScopeSubset": " über die Engines {ids}, aggregiert",
  "aSum.failureDashboard":
    "Fehler-Dashboard{engines}: aktuell {totalIncidents} offene(s) Incident(s) in {uniqueErrorPatterns} Gruppe(n) nach Incident-Typ und Prozess{mostAffected}.",
  "aSum.mostAffectedProcess": '; am stärksten betroffener Prozess: "{key}"',
  "aSum.scopeForProcess": ' für "{key}"',
  "aSum.sharedKeys":
    " Auf mehreren Engines bereitgestellt (die einzigen belastbaren Engine-Vergleiche): {keys}.",
  "aSum.settings":
    "Analyse-Einstellungen: Standard-Zeitraum {period}, Mindestgröße für Vergleiche (minBucketSize) {minBucketSize}.{changeHint}",
  "aSum.settingsChangeHint": " Änderbar über analytics_save_settings.",
  "aSum.settingsSaved":
    "Analyse-Einstellungen gespeichert: Standard-Zeitraum {period}, Mindestgröße für Vergleiche (minBucketSize) {minBucketSize}.",
  "aSum.versionCompare":
    'Versionsvergleich für "{key}" v{versionA} vs. v{versionB} über {windowDays} d{engines}: {delta}{suppressed}.',
}
