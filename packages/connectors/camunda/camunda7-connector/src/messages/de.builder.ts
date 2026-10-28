import type { MessageCatalog } from "@miragon/mcp-toolkit-core"

/** Namen für den Ansichts-Editor; die `description` der Definitionen bleibt der Text für das Modell. */
export const deBuilder: MessageCatalog = {
  "builder.app.title": "Betrieb",

  "builder.widget.process-list.title": "Prozessdefinitionen",
  "builder.widget.process-list.summary":
    "Die bereitgestellten Prozessdefinitionen mit Suche und genauer Gesamtzahl.",
  "builder.widget.instance-detail.title": "Prozessinstanz",
  "builder.widget.instance-detail.summary":
    "Eine laufende Instanz mit Zustand, offenen Aufgaben, Incidents, Variablen und Verlauf.",
  "builder.widget.incident-overview-kpi.title": "Incident-Kennzahlen",
  "builder.widget.incident-overview-kpi.summary":
    "Offene Incidents über alle Prozessdefinitionen, die betroffenen Prozesse und die letzten 24 Stunden.",
  "builder.widget.incident-process-list.title": "Incidents je Prozess",
  "builder.widget.incident-process-list.summary":
    "Die offenen Incidents jeder Prozessdefinition mit den Aktivitäten, an denen sie auftreten.",
  "builder.widget.process-detail-header.title": "Kopf der Prozessdefinition",
  "builder.widget.process-detail-header.summary":
    "Name, laufende Instanzen und der letzte Incident einer Prozessdefinition.",
  "builder.widget.process-definition-kpi.title": "Kennzahlen der Prozessdefinition",
  "builder.widget.process-definition-kpi.summary":
    "Laufende Instanzen, offene Incidents, die letzten 24 Stunden und Jobs ohne Versuche über alle Versionen.",
  "builder.widget.process-definition-flow.title": "Prozessablauf",
  "builder.widget.process-definition-flow.summary":
    "Das neueste Diagramm einer Prozessdefinition mit ihren Incidents an den Elementen.",
  "builder.widget.activity-incident-list.title": "Incidents je Aktivität",
  "builder.widget.activity-incident-list.summary":
    "Die offenen Incidents einer Prozessdefinition, gruppiert nach Aktivität.",
  "builder.widget.incident-detail.title": "Incident",
  "builder.widget.incident-detail.summary":
    "Ein Incident mit seinem Fehler, seiner Instanz, dem Diagramm und dem, was du als Nächstes tun kannst.",
  "builder.widget.history-timeline.title": "Verlauf der Instanz",
  "builder.widget.history-timeline.summary": "Die Aktivitäten einer Prozessinstanz als Zeitleiste.",
  "builder.widget.engine-health.title": "Engine-Übersicht",
  "builder.widget.engine-health.summary":
    "Der Zustand der Engine aus ihren offenen Incidents, mit den größten Fehlerclustern.",
  "builder.widget.cluster-detail.title": "Fehlercluster",
  "builder.widget.cluster-detail.summary":
    "Ein Fehlercluster mit seinen Kennzahlen und den betroffenen Instanzen.",
  "builder.widget.process-health-kpi.title": "Kennzahlen der Prozesslandschaft",
  "builder.widget.process-health-kpi.summary":
    "Wie viele Prozessdefinitionen gesund oder betroffen sind, dazu die offenen Incidents der Engine.",
  "builder.widget.process-definitions-table.title": "Prozessdefinitionen mit Incidents",
  "builder.widget.process-definitions-table.summary":
    "Eine Zeile je Prozessdefinition mit laufenden Instanzen, Jobs ohne Versuche und Incidents.",
  "builder.widget.process-instances.title": "Laufende Instanzen",
  "builder.widget.process-instances.summary":
    "Die laufenden Instanzen einer Prozessdefinition, filterbar, mit markierten Incidents.",
  "builder.widget.bpmn-viewer.title": "BPMN-Diagramm",
  "builder.widget.bpmn-viewer.summary":
    "Eine Prozessinstanz oder eine Definitionsversion als Diagramm mit Token und Incidents.",
  "builder.widget.bpmn-viewer-header.title": "Kopf des BPMN-Diagramms",
  "builder.widget.bpmn-viewer-header.summary":
    "Die gezeigte Instanz mit der Zahl ihrer laufenden Aktivitäten und Incidents.",
  "builder.widget.bpmn-viewer-legend.title": "Legende des Diagramms",
  "builder.widget.bpmn-viewer-legend.summary":
    "Was die Markierungen und Zahlen im Diagramm bedeuten.",
  "builder.widget.bpmn-flow-viewer.title": "Diagrammfläche",
  "builder.widget.bpmn-flow-viewer.summary":
    "Das Diagramm mit Token, Incidents und Jobs ohne Versuche.",
  "builder.widget.job-panel.title": "Jobs",
  "builder.widget.job-panel.summary":
    "Die Jobs der Engine mit den genauen Gesamtzahlen aller Jobs und der Jobs ohne Versuche.",
  "builder.widget.settings.title": "Engine- und Dashboard-Einstellungen",
  "builder.widget.settings.summary":
    "Aus welchen Engines du wählst, deine Standard-Engine und deine Dashboards.",
  "builder.widget.cockpit-app.title": "Operations Cockpit",
  "builder.widget.cockpit-app.summary":
    "Das ganze Cockpit mit seiner Navigation. Es öffnet sich als eigene Ansicht.",

  "builder.step.load-process-definitions.title": "Prozessdefinitionen",
  "builder.step.load-process-definitions.summary":
    "Liest die bereitgestellten Prozessdefinitionen der Engine.",
  "builder.step.load-process-instance.title": "Prozessinstanz",
  "builder.step.load-process-instance.summary":
    "Liest eine Prozessinstanz mit Aufgaben, Incidents und Variablen.",
  "builder.step.load-incidents-dashboard.title": "Offene Incidents",
  "builder.step.load-incidents-dashboard.summary":
    "Liest die offenen Incidents der Engine je Prozessdefinition.",
  "builder.step.load-process-incidents.title": "Prozessdefinition mit Incidents",
  "builder.step.load-process-incidents.summary":
    "Liest eine Prozessdefinition über alle Versionen mit ihren offenen Incidents.",
  "builder.step.load-history-timeline.title": "Verlauf der Instanz",
  "builder.step.load-history-timeline.summary": "Liest den Aktivitätsverlauf einer Prozessinstanz.",
  "builder.step.load-cockpit-dashboard.title": "Prozesslandschaft",
  "builder.step.load-cockpit-dashboard.summary":
    "Liest jede Prozessdefinition mit laufenden Instanzen, Jobs ohne Versuche und Incidents.",
  "builder.step.load-bpmn-viewer.title": "BPMN-Diagramm",
  "builder.step.load-bpmn-viewer.summary":
    "Liest ein Diagramm mit den Markierungen einer Instanz oder einer Definitionsversion.",
  "builder.step.load-jobs.title": "Jobs",
  "builder.step.load-jobs.summary":
    "Liest die Jobs der Engine mit den Gesamtzahlen aller Jobs und der Jobs ohne Versuche.",

  "builder.field.processList.engine.title": "Engine",
  "builder.field.processList.engine.summary":
    "Die Engine, aus der gelesen wird. Ohne Angabe deine Standard-Engine.",
  "builder.field.processList.processDefinitionKey.title": "Schlüssel der Prozessdefinition",
  "builder.field.processList.processDefinitionKey.summary":
    "Zeigt nur die Definition mit genau diesem Schlüssel.",
  "builder.field.processList.nameLike.title": "Name enthält",
  "builder.field.processList.nameLike.summary":
    "Zeigt nur Definitionen, deren Name diesen Text enthält.",
  "builder.field.processList.latestVersion.title": "Nur neueste Version",
  "builder.field.processList.latestVersion.summary":
    "Zeigt jede Definition in ihrer neuesten Version. An, solange du es nicht ausschaltest.",
  "builder.field.bpmnViewer.processInstanceId.title": "ID der Prozessinstanz",
  "builder.field.bpmnViewer.processInstanceId.summary":
    "Zeigt das Diagramm dieser Instanz mit Token und Incidents.",
  "builder.field.bpmnViewer.processDefinitionKey.title": "Schlüssel der Prozessdefinition",
  "builder.field.bpmnViewer.processDefinitionKey.summary":
    "Zeigt das Diagramm dieser Definition mit ihren laufenden Instanzen.",
  "builder.field.bpmnViewer.version.title": "Version",
  "builder.field.bpmnViewer.version.summary":
    "Eine bestimmte Version der Definition. Ohne Angabe die neueste.",
  "builder.field.bpmnViewer.engine.title": "Engine",
  "builder.field.bpmnViewer.engine.summary":
    "Die Engine, aus der gelesen wird. Ohne Angabe deine Standard-Engine.",
  "builder.field.activityIncidentList.emptyVariant.title": "Ohne Incidents",
  "builder.field.activityIncidentList.emptyVariant.summary":
    "Was die Liste ohne offenen Incident zeigt: einen kurzen Hinweis oder andere Prozesse mit Incidents.",
  "builder.field.processInstances.engine.title": "Engine",
  "builder.field.processInstances.engine.summary":
    "Die Engine, aus der gelesen wird. Ohne Angabe deine Standard-Engine.",
  "builder.field.processInstances.processDefinitionKey.title": "Schlüssel der Prozessdefinition",
  "builder.field.processInstances.processDefinitionKey.summary":
    "Listet die Instanzen dieser Definition.",
  "builder.field.processInstances.active.title": "Läuft",
  "builder.field.processInstances.active.summary":
    "An zeigt nur laufende Instanzen, aus nur ausgesetzte.",
  "builder.field.processInstances.suspended.title": "Ausgesetzt",
  "builder.field.processInstances.suspended.summary":
    "An zeigt nur ausgesetzte Instanzen, aus nur laufende.",
  "builder.field.processInstances.withIncidents.title": "Mit Incidents",
  "builder.field.processInstances.withIncidents.summary":
    "Zeigt nur Instanzen mit einem offenen Incident.",
  "builder.field.processInstances.businessKeyLike.title": "Geschäftsschlüssel enthält",
  "builder.field.processInstances.businessKeyLike.summary":
    "Zeigt nur Instanzen, deren Geschäftsschlüssel diesen Text enthält.",
  "builder.field.incidentDetail.engine.title": "Engine",
  "builder.field.incidentDetail.engine.summary":
    "Die Engine, aus der gelesen wird. Ohne Angabe deine Standard-Engine.",
  "builder.field.incidentDetail.incidentId.title": "ID des Incidents",
  "builder.field.incidentDetail.incidentId.summary": "Der Incident, den das Widget zeigt.",
  "builder.field.engineHealth.engine.title": "Engine",
  "builder.field.engineHealth.engine.summary":
    "Die Engine, die bewertet wird. Ohne Angabe deine Standard-Engine.",
  "builder.field.clusterDetail.activityId.title": "ID der Aktivität",
  "builder.field.clusterDetail.activityId.summary":
    "Die Aktivität, an der die Incidents auftreten.",
  "builder.field.clusterDetail.incidentType.title": "Incident-Typ",
  "builder.field.clusterDetail.incidentType.summary":
    "Der Typ der Incidents, zum Beispiel failedJob.",
  "builder.field.clusterDetail.messageSignature.title": "Fehlermeldung",
  "builder.field.clusterDetail.messageSignature.summary":
    "Grenzt das Cluster auf eine Fehlermeldung ein.",
  "builder.field.clusterDetail.engine.title": "Engine",
  "builder.field.clusterDetail.engine.summary":
    "Die Engine, aus der gelesen wird. Ohne Angabe deine Standard-Engine.",
}
