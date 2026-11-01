import type { MessageCatalog } from "@miragon/pulse-widget-shell/widgets"
import { countOf } from "./plural.js"

export const de: MessageCatalog = {
  "cockpit.crumb.processList": "Alle Prozesse",
  "cockpit.section.overview": "Übersicht",
  "cockpit.section.incidents": "Incidents",
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
    `Die Engine ${String(engineId)} ist auf diesem Server nicht mehr konfiguriert.`,
}
