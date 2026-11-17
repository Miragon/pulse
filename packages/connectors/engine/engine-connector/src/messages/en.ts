import type { MessageCatalog } from "@miragon/pulse-widget-shell/widgets"
import { countOf } from "./plural.js"

/** The fallback locale: every key MUST exist here. */
export const en: MessageCatalog = {
  "cockpit.section.overview": "Overview",
  "cockpit.section.incidents": "Incidents",
  "cockpit.section.jobs": "Jobs",
  "cockpit.crumb.overview": "Overview",
  "cockpit.crumb.incidents": "Incidents",
  "cockpit.crumb.instances": "Instances",
  "cockpit.crumb.jobs": "Jobs",
  // The {id} arrives pre-truncated (kit `truncate` appends the ellipsis).
  "cockpit.crumb.instance": ({ id }) => `Instance ${String(id)}`,
  "cockpit.crumb.incident": ({ id }) => `Incident ${String(id)}`,
  "cockpit.crumb.cluster": ({ activity }) => `Cluster: ${String(activity)}`,
  "cockpit.crumb.incidentAt": ({ activity }) => `Incident at ${String(activity)}`,
  "cockpit.crumb.history": ({ id }) => `History ${String(id)}`,
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
  "cockpit.landing.subtitle.boards": ({ count, boardCount }) =>
    `${countOf(count, "engine", "engines")} and ${countOf(boardCount, "board", "boards")}. Pick one to work with.`,
  "cockpit.landing.envLabel": ({ env }) => `Environment ${String(env).toUpperCase()}`,
  "cockpit.landing.default": "default",
  "cockpit.landing.status.loading": "loading…",
  "cockpit.landing.status.notLoaded": "not loaded",
  "cockpit.landing.status.refused": "profile refused",
  "cockpit.landing.status.unreachable": "unreachable",
  // describeError's 401 and 403 in short: the engine answered, so it is not unreachable.
  "cockpit.landing.status.unauthorized": "credentials rejected",
  "cockpit.landing.status.forbidden": "access denied",
  "cockpit.landing.status.empty": "empty",
  "cockpit.landing.status.incidents": ({ count }) => countOf(count, "incident", "incidents"),
  "cockpit.landing.status.failedJobs": ({ count }) =>
    countOf(count, "job without retries", "jobs without retries"),
  "cockpit.landing.status.idle": "no running instances",
  "cockpit.landing.status.healthy": "no incidents",
  "cockpit.landing.fleet.open": "Cross-engine overview",
  "cockpit.landing.engines": "Engines",
  "cockpit.landing.boards": "Boards",
  // A board file that gives no board: refused, as a profile the server cannot use.
  "cockpit.landing.boardRefused": ({ count }) =>
    `file refused: ${countOf(count, "problem", "problems")}`,
  "cockpit.landing.boardRefusedHint":
    "Pulse shows no board for a refused file. The file's problems are in the log the server writes at startup, and whoever runs the server can fix the file.",
  "cockpit.crumb.allEngines": "All engines",
  "cockpit.crumb.fleet": "Cross-engine overview",
  "cockpit.engineGone": ({ engineId }) =>
    `Engine ${String(engineId)} is no longer configured on this server.`,
  // An engine of another dialect, which the server reads on boards only: its landing row, the one
  // state of its routes (BoardsOnlyEngineGate) and the cross-engine view's line.
  "cockpit.landing.status.onBoards": ({ product }) => `${String(product)}, on boards`,
  "cockpit.landing.status.onNoBoard": ({ product }) => `${String(product)}, on no board yet`,
  "cockpit.boardsOnly.title": ({ engine, product }) =>
    `${String(engine)} is a ${String(product)} engine`,
  "cockpit.boardsOnly.onBoards": "Pulse shows it here on boards: open one that names it.",
  "cockpit.boardsOnly.noBoard":
    "Pulse shows it here on boards only, and no board names it yet. Ask whoever runs this Pulse server to add one.",
  "cockpit.boardsOnly.boards": ({ engine }) => `Boards that name ${String(engine)}`,
  "cockpit.boardsOnly.webApp": ({ webApp }) => `You can also open it in ${String(webApp)}.`,
  // The engines' ids follow, each kept whole on its line.
  "fleet.boardsOnly": ({ product }) => `${String(product)} on boards only, not in this overview:`,
}
