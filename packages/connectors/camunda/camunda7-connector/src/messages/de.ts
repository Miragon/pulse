import type { MessageCatalog } from "@miragon/mcp-toolkit-core"
import { countOf } from "./plural.js"

export const de: MessageCatalog = {
  "cockpit.crumb.processList": "Alle Prozesse",
  "cockpit.section.overview": "Übersicht",
  "cockpit.section.incidents": "Incidents",
  "cockpit.section.settings": "Einstellungen",
  "cockpit.crumb.overview": "Übersicht",
  "cockpit.crumb.incidents": "Incidents",
  "cockpit.crumb.instances": "Instanzen",
  "cockpit.crumb.origin": "Start",
  // Die {id} kommt bereits gekürzt an (Kit-`truncate` ergänzt die Ellipse).
  "cockpit.crumb.instance": ({ id }) => `Instanz ${String(id)}`,
  "cockpit.crumb.incident": ({ id }) => `Incident ${String(id)}`,
  "cockpit.crumb.cluster": ({ activity }) => `Cluster: ${String(activity)}`,
  "cockpit.crumb.incidentAt": ({ activity }) => `Incident bei ${String(activity)}`,
  "cockpit.loading.engines": "Engines werden geladen…",
  "cockpit.empty.enginesTitle": "Keine Engines konfiguriert",
  "cockpit.empty.engines":
    "Bitte deine Administration, eine Engine in der Server-Konfiguration einzutragen. Dann erscheint sie hier.",
  "cockpit.signature": "Pulse",
  "cockpit.nav.crossEngine": "Engine-übergreifende Übersicht",
  "cockpit.aria.breadcrumb": "Navigationspfad",
  "cockpit.aria.sections": "Cockpit-Bereiche",
  "cockpit.aria.activeEngine": "Gewählte Engine",
  "cockpit.refresh": "Aktualisieren",
  "cockpit.refreshing": "Wird aktualisiert…",
  "cockpit.landing.title": "Operations Cockpit",
  "cockpit.landing.subtitle": ({ count }) =>
    `${countOf(count, "Engine", "Engines")} konfiguriert. Wähl eine, um mit ihr zu arbeiten.`,
  "cockpit.landing.subtitle.env": ({ count, envCount }) =>
    `${countOf(count, "Engine", "Engines")} in ${countOf(envCount, "Umgebung", "Umgebungen")}. Wähl eine, um mit ihr zu arbeiten.`,
  "cockpit.landing.envLabel": ({ env }) => `Umgebung ${String(env).toUpperCase()}`,
  "cockpit.landing.default": "Standard",
  "cockpit.landing.status.loading": "lädt …",
  "cockpit.landing.status.unreachable": "nicht erreichbar",
  "cockpit.landing.status.empty": "leer",
  "cockpit.landing.status.incidents": ({ count }) => countOf(count, "Incident", "Incidents"),
  "cockpit.landing.status.failedJobs": ({ count }) =>
    countOf(count, "Job ohne Versuche", "Jobs ohne Versuche"),
  "cockpit.landing.status.idle": "keine laufenden Instanzen",
  "cockpit.landing.status.healthy": "keine Incidents",
  "cockpit.landing.fleet.open": "Engine-übergreifende Übersicht",
  "cockpit.crumb.allEngines": "Alle Engines",
  "cockpit.crumb.fleet": "Engine-übergreifende Übersicht",
  "cockpit.engineGone": ({ engineId }) =>
    `Engine ${String(engineId)} ist nicht mehr in deiner Engine-Liste.`,

  "profile.heading": "Engines und Dashboards",
  "profile.subtitle":
    "Aus welchen Engines du wählst und welche Dashboards zuerst kommen, in jedem Chat.",
  "profile.save": "Speichern",
  "profile.saving": "Wird gespeichert…",
  "profile.discard": "Änderungen verwerfen",
  "profile.saveBar.label": "Einstellungen speichern",
  "profile.saveBar.unsaved":
    "Deine Änderungen an Engines oder Dashboards sind noch nicht gespeichert.",
  "profile.saveBar.clean": "Engines und Dashboards sind gespeichert.",
  "profile.saveError":
    "Die Einstellungen konnten nicht gespeichert werden. Deine Eingaben sind noch da, versuch es noch mal.",
  "profile.readOnly.title": "Die Einstellungen sind hier nur lesbar",
  "profile.readOnly.toolset":
    "Diese Verbindung läuft mit dem Toolset read-only. Mit dem Toolset operations kannst du sie ändern: Bitte deine Administration, die Verbindung umzustellen.",
  "profile.readOnly.noSignIn":
    "Diese Verbindung hat keine Anmeldung und weiß deshalb nicht, für wen sie speichern soll. Speichern geht nur über eine Verbindung mit Anmeldung: Bitte deine Administration, sie einzurichten.",
  "profile.loading": "Wird geladen…",
  "profile.none": "Keine Einstellungen verfügbar",

  "profile.section.engines": "Engines",
  "profile.section.dashboards": "Dashboards",

  "profile.field.allEngines": "Alle Engines erlauben",
  "profile.field.allEngines.help":
    "Jede konfigurierte Engine steht in deinen Auswahllisten, auch später hinzugefügte. Deine Rechte ändert das nicht.",
  "profile.field.allowedEngines": "Deine Engines",
  "profile.field.allowedEngines.help": "Nur diese Engines stehen in deinen Auswahllisten.",
  "profile.engines.noneChosen": "Wähl mindestens eine Engine aus, oder erlaube alle Engines.",
  "profile.engines.none": "Keine Engines konfiguriert.",
  "profile.field.defaultEngine": "Standard-Engine",
  "profile.field.defaultEngine.help":
    "Diese Engine nutzen die Tools und das Cockpit, wenn du keine andere wählst.",
  "profile.engine.auto": "(automatisch)",

  "profile.dashboards.unavailable":
    "Gespeicherte Dashboards sind nicht verfügbar. Dafür braucht der Server eine Anmeldung und muss Änderungen erlauben. Bitte deine Administration, das einzurichten.",
  "profile.dashboards.empty":
    "Noch keine Dashboards gespeichert. Lass dir im Chat eins bauen und speichere es.",
  "profile.field.defaultDashboard": "Standard-Dashboard",
  "profile.field.defaultDashboard.help":
    "Dieses Dashboard schlägt die AI als Erstes vor (load-dashboard).",
  "profile.dashboard.none": "(keins)",
  "profile.field.pinnedDashboards": "Angepinnte Dashboards",
  "profile.field.pinnedDashboards.help": "Stehen in Dashboard-Auswahlen oben.",

  "profile.summary": ({ engines, defaultDashboard }) =>
    `camunda7-Einstellungen: ${String(engines)}${String(defaultDashboard)}.`,
  "profile.summary.allEngines": "alle Engines",
  "profile.summary.someEngines": ({ count }) =>
    countOf(count, "erlaubte Engine", "erlaubte Engines"),
  "profile.summary.defaultDashboard": ({ id }) =>
    `, Standard-Dashboard „${String(id)}" (öffnen mit load-dashboard)`,

  "viewTitle.cockpit": "Cockpit",
  "viewTitle.processList": "Prozessdefinitionen",
  "viewTitle.processInstances": "Laufende Instanzen",
  "viewTitle.historyTimeline": "Verlauf",
  "viewTitle.instanceDetail": "Prozessinstanz",
  "viewTitle.bpmnViewer": "BPMN-Diagramm",
  "viewTitle.jobPanel": "Jobs",
  "viewTitle.engineHealth": "Engine-Übersicht",
  "viewTitle.settings": "Engines und Dashboards",
  "viewTitle.clusterDetail": ({ activity }) => `Cluster: ${String(activity)}`,

  "c7sum.cockpitOpened":
    'Operations Cockpit für Engine "{engineId}" ({engineCount} Engine(s) in der Engine-Liste des Benutzers). Wo der Host die Ansicht zeigt, navigiert der Benutzer darin durch die Prozesslandschaft.',
  "c7sum.cockpitOpenedPicker":
    "Operations Cockpit auf seiner Engine-Auswahl: {engineCount} Engine(s) in der Engine-Liste des Benutzers, keine vorausgewählt (kein `engine` übergeben, kein gespeicherter Standard). Wo der Host die Ansicht zeigt, wählt der Benutzer dort eine; mit `engine` öffnet es direkt auf einer bestimmten Engine.",
  "c7sum.processList":
    'Prozessliste: {totalCount} bereitgestellte Definition(en){filters} auf Engine "{engineId}".',
  "c7sum.state.active": "läuft",
  "c7sum.state.suspended": "ausgesetzt",
  "c7sum.state.ended": "beendet",
  "c7sum.instanceDetail":
    "Prozessinstanz {instanceId}{businessKey}: {state}; laufende Aktivitäten: {activeActivities}, offene Incidents: {openIncidents}, offene Benutzeraufgaben: {openTasks}.",
  "c7sum.processInstances":
    '{totalCount} laufende Instanz(en) von "{processDefinitionKey}", davon {withIncidentCount} mit Incidents und {suspendedCount} ausgesetzt; diese Seite enthält {returnedCount}.',
  "c7sum.incidentsDashboard":
    "Incident-Übersicht: {totalCount} offene Incident(s) in {processCount} Prozessdefinition(en), {last24hCount} in den letzten 24 Stunden.",
  "c7sum.processIncidents":
    'Incidents des Prozesses "{processDefinitionKey}" (alle Versionen; Diagramm v{diagramVersion}): {incidentCount} offene Incident(s), betroffene Aktivitäten: {activities}, {last24hCount} in den letzten 24 Stunden.',
  "c7sum.incidentDetail":
    'Incident {incidentId} ({incidentType}) bei Aktivität "{activity}" in "{processDefinitionKey}", Instanz {processInstanceId}{message}.',
  "c7sum.processDetail":
    'Prozess "{processDefinitionKey}" (alle Versionen; Diagramm v{diagramVersion}): {runningInstances} laufende Instanz(en), {openIncidents} offene Incident(s), {failedJobs} Job(s) ohne Versuche.',
  "c7sum.historyTimeline":
    "Verlaufs-Zeitleiste für Prozessinstanz {processInstanceId}: historische Aktivitäten: {totalActivities}{notFound}.",
  "c7sum.historyTimeline.notFound": " (keine historische Prozessinstanz gefunden)",
  "c7sum.engineHealth":
    'Engine "{engineId}": {status} ({rule}). Offene Incidents: {totalIncidents}, betroffene Aktivitäten: {affectedActivities}, laufende Instanzen: {runningInstances}.{topCluster}',
  "c7sum.engineHealth.topCluster":
    ' Größter Cluster: Aktivität "{activityId}" / {incidentType}, Incidents: {incidentCount}.',
  "c7sum.engineHealth.noIncidents": " Keine offenen Incidents.",
  "c7sum.unknownNumberOf": "unbekannt viele",
  "c7sum.atLeast": "mindestens {count}",
  "c7sum.unknown": "unbekannt",
  "c7sum.clusterDetail":
    'Fehler-Cluster auf Engine "{engineId}": Aktivität "{activityId}" / {incidentType}. Incidents: {incidentCount} ({lastHourCount} in der letzten Stunde), Prozesse: {processes}.{sample}',
  "c7sum.clusterDetail.unknownProcesses": "unbekannte Prozesse",
  "c7sum.clusterDetail.sample": " Beispiel: {message}",
  "c7sum.bpmnViewer": "BPMN-Diagramm für {target}{overlayInfo}{xmlUnavailable}.",
  "c7sum.bpmnViewer.empty":
    "BPMN-Viewer: Keine passende Prozessdefinition gefunden, das Diagramm ist leer.",
  "c7sum.bpmnViewer.targetInstance": "Prozessinstanz {processInstanceId}",
  "c7sum.bpmnViewer.targetDefinition": "Prozessdefinition {definitionId}",
  "c7sum.bpmnViewer.overlays":
    "; laufende Aktivitäten: {activeActivities}, Aktivitäten mit Incidents: {incidentActivities}, Jobs ohne Versuche in dieser Instanz: {failedJobs}",
  "c7sum.bpmnViewer.noOverlays":
    " (keine Instanz-Overlays; die Badges zählen alle laufenden Instanzen dieser Version)",
  "c7sum.bpmnViewer.xmlUnavailable": "; Diagramm-XML nicht verfügbar",
  "c7sum.jobPanel":
    "Job-Panel: {totalCount} Job(s), {failedCount} ohne Versuche{forProcess}{failedOnly}.",
  "c7sum.jobPanel.forProcess": ' für "{processDefinitionKey}"',
  "c7sum.jobPanel.failedOnly": " (nur Jobs ohne Versuche)",
}
