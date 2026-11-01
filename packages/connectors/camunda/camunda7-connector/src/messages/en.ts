import type { MessageCatalog } from "@miragon/pulse-widget-shell/widgets"
import { countOf } from "./plural.js"

/** The fallback locale: every key MUST exist here. */
export const en: MessageCatalog = {
  "cockpit.crumb.processList": "All processes",
  "cockpit.section.overview": "Overview",
  "cockpit.section.incidents": "Incidents",
  "cockpit.crumb.overview": "Overview",
  "cockpit.crumb.incidents": "Incidents",
  "cockpit.crumb.instances": "Instances",
  "cockpit.crumb.origin": "Start",
  // The {id} arrives pre-truncated (kit `truncate` appends the ellipsis).
  "cockpit.crumb.instance": ({ id }) => `Instance ${String(id)}`,
  "cockpit.crumb.incident": ({ id }) => `Incident ${String(id)}`,
  "cockpit.crumb.cluster": ({ activity }) => `Cluster: ${String(activity)}`,
  "cockpit.crumb.incidentAt": ({ activity }) => `Incident at ${String(activity)}`,
  "cockpit.loading.engines": "Loading engines…",
  "cockpit.empty.enginesTitle": "No engines configured",
  "cockpit.empty.engines":
    "Ask your administrator to add an engine to the server configuration. Then it shows up here.",
  "cockpit.signature": "Pulse",
  "cockpit.nav.crossEngine": "Cross-engine overview",
  "cockpit.aria.breadcrumb": "Breadcrumb",
  "cockpit.aria.sections": "Cockpit sections",
  "cockpit.aria.activeEngine": "Selected engine",
  "cockpit.refresh": "Refresh",
  "cockpit.refreshing": "Refreshing…",
  "cockpit.landing.title": "Operations Cockpit",
  "cockpit.landing.subtitle": ({ count }) =>
    `${countOf(count, "engine", "engines")} configured. Pick one to work with.`,
  "cockpit.landing.subtitle.env": ({ count, envCount }) =>
    `${countOf(count, "engine", "engines")} in ${countOf(envCount, "environment", "environments")}. Pick one to work with.`,
  "cockpit.landing.envLabel": ({ env }) => `Environment ${String(env).toUpperCase()}`,
  "cockpit.landing.default": "default",
  "cockpit.landing.status.loading": "loading…",
  "cockpit.landing.status.unreachable": "unreachable",
  "cockpit.landing.status.empty": "empty",
  "cockpit.landing.status.incidents": ({ count }) => countOf(count, "incident", "incidents"),
  "cockpit.landing.status.failedJobs": ({ count }) =>
    countOf(count, "job without retries", "jobs without retries"),
  "cockpit.landing.status.idle": "no running instances",
  "cockpit.landing.status.healthy": "no incidents",
  "cockpit.landing.fleet.open": "Cross-engine overview",
  "cockpit.crumb.allEngines": "All engines",
  "cockpit.crumb.fleet": "Cross-engine overview",
  "cockpit.engineGone": ({ engineId }) =>
    `Engine ${String(engineId)} is no longer configured on this server.`,
}
