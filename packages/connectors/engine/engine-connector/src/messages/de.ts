import type { MessageCatalog } from "@miragon/pulse-widget-shell/widgets"
import { countOf } from "./plural.js"

export const de: MessageCatalog = {
  "cockpit.section.overview": "Übersicht",
  "cockpit.section.incidents": "Incidents",
  "cockpit.section.jobs": "Jobs",
  "cockpit.crumb.overview": "Übersicht",
  "cockpit.crumb.incidents": "Incidents",
  "cockpit.crumb.instances": "Instanzen",
  "cockpit.crumb.jobs": "Jobs",
  // Die {id} kommt bereits gekürzt an (Kit-`truncate` ergänzt die Ellipse).
  "cockpit.crumb.instance": ({ id }) => `Instanz ${String(id)}`,
  "cockpit.crumb.incident": ({ id }) => `Incident ${String(id)}`,
  "cockpit.crumb.cluster": ({ activity }) => `Cluster: ${String(activity)}`,
  "cockpit.crumb.incidentAt": ({ activity }) => `Incident bei ${String(activity)}`,
  "cockpit.crumb.history": ({ id }) => `Verlauf ${String(id)}`,
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
  "cockpit.landing.subtitle.boards": ({ count, boardCount }) =>
    `${countOf(count, "Engine", "Engines")} und ${countOf(boardCount, "Board", "Boards")}. Wähl aus, womit du arbeiten willst.`,
  "cockpit.landing.envLabel": ({ env }) => `Umgebung ${String(env).toUpperCase()}`,
  "cockpit.landing.default": "Standard",
  "cockpit.landing.status.loading": "lädt …",
  "cockpit.landing.status.notLoaded": "nicht geladen",
  "cockpit.landing.status.refused": "Profil abgelehnt",
  "cockpit.landing.status.unreachable": "nicht erreichbar",
  "cockpit.landing.status.unauthorized": "Zugangsdaten abgelehnt",
  "cockpit.landing.status.forbidden": "Zugriff verweigert",
  "cockpit.landing.status.empty": "leer",
  "cockpit.landing.status.incidents": ({ count }) => countOf(count, "Incident", "Incidents"),
  "cockpit.landing.status.failedJobs": ({ count }) =>
    countOf(count, "Job ohne Versuche", "Jobs ohne Versuche"),
  "cockpit.landing.status.idle": "keine laufenden Instanzen",
  "cockpit.landing.status.healthy": "keine Incidents",
  "cockpit.landing.fleet.open": "Engine-übergreifende Übersicht",
  "cockpit.landing.engines": "Engines",
  "cockpit.landing.boards": "Boards",
  // Eine Board-Datei, die kein Board ergibt: abgelehnt, wie ein Profil, das der Server nicht nutzt.
  "cockpit.landing.boardRefused": ({ count }) =>
    `Datei abgelehnt: ${countOf(count, "Problem", "Probleme")}`,
  "cockpit.landing.boardRefusedHint":
    "Zu einer abgelehnten Datei zeigt Pulse kein Board. Die Probleme der Datei stehen im Log, das der Server beim Start schreibt. Wer den Server betreibt, kann die Datei korrigieren.",
  "cockpit.crumb.allEngines": "Alle Engines",
  "cockpit.crumb.fleet": "Engine-übergreifende Übersicht",
  "cockpit.engineGone": ({ engineId }) =>
    `Die Engine ${String(engineId)} ist auf diesem Server nicht mehr konfiguriert.`,
  // Eine Engine eines anderen Dialekts, die der Server nur auf Boards liest: ihre Zeile auf der
  // Landing, der eine Zustand ihrer Routen (BoardsOnlyEngineGate) und die Zeile der Übersicht.
  "cockpit.landing.status.onBoards": ({ product }) => `${String(product)}, auf Boards`,
  "cockpit.landing.status.onNoBoard": ({ product }) => `${String(product)}, noch auf keinem Board`,
  "cockpit.boardsOnly.title": ({ engine, product }) =>
    `${String(engine)} läuft auf ${String(product)}`,
  "cockpit.boardsOnly.onBoards": "Pulse zeigt sie hier auf Boards: Öffne eines, das sie nennt.",
  "cockpit.boardsOnly.noBoard":
    "Pulse zeigt sie hier nur auf Boards, und noch kein Board nennt sie. Bitte die Person, die diesen Pulse-Server betreibt, eines anzulegen.",
  "cockpit.boardsOnly.boards": ({ engine }) => `Boards, die ${String(engine)} nennen`,
  "cockpit.boardsOnly.webApp": ({ webApp }) => `Du kannst sie auch in ${String(webApp)} öffnen.`,
  // Die IDs der Engines folgen, jede ganz in ihrer Zeile.
  "fleet.boardsOnly": ({ product }) =>
    `${String(product)} nur auf Boards, nicht in dieser Übersicht:`,
}
