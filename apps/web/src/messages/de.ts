import type { Message } from "@miragon/pulse-widget-shell/widgets"
import type { en } from "./en.js"

/**
 * Die eigenen Worte der Web-App auf Deutsch: Rahmen und Navigation, Hinweise, das Drumherum ihrer
 * Screens (Leisten und Zustände; ihre Tabellen formulieren die Blöcke) und die Seite nach der
 * Abmeldung.
 */
export const de = {
  "frame.product": "Pulse",
  "frame.signedInAs": "Angemeldet als {name}",
  "frame.signOut": "Abmelden",
  "frame.signingOut": "Wird abgemeldet…",
  "frame.skipToContent": "Zum Inhalt springen",
  "title.page": "{page} · Pulse",

  "nav.label": "Pulse",
  "nav.start": "Start",
  "nav.fleet": "Engine-übergreifende Übersicht",
  "nav.engines": "Engines",
  "nav.boards": "Boards",
  "nav.section.processes": "Prozesse",
  "nav.section.incidents": "Incidents",
  "nav.section.jobs": "Jobs",
  "nav.boardsOnly": "nur Boards",
  "nav.refused": "abgelehnt",
  "nav.enginesFailed": "Die Engines konnten nicht geladen werden. Lade die Seite neu.",
  "nav.menu": "Menü",
  "nav.search.label": "Instanz suchen",
  "nav.search.placeholder": "Instanz suchen",
  "nav.search.hint": "ID oder Geschäftsschlüssel, genau",
  "nav.search.tooLong":
    "Eine ID oder ein Geschäftsschlüssel hat höchstens {most} Zeichen. Kürze den Text, um zu suchen.",
  "nav.close": "Menü schließen",
  "title.board": "Board {board} · Pulse",

  "notice.ended.title": "Deine Sitzung ist abgelaufen",
  "notice.ended.detail": "Melde dich erneut an, um dort weiterzumachen, wo du warst.",
  "notice.signOutFailed.title": "Abmelden hat nicht geklappt",
  "notice.signOutFailed.detail": "Pulse hat deine Sitzung behalten. Versuche es erneut.",
  "notice.signInAgain": "Erneut anmelden",

  "page.ended.title": "Deine Sitzung ist abgelaufen",
  "page.ended.description": "Melde dich erneut an, um diese Seite zu öffnen.",
  "page.unreachable.title": "Pulse antwortet nicht",
  "page.unreachable.description":
    "Deine Sitzung konnte nicht gelesen werden. Versuche es gleich noch einmal.",

  "screen.refresh": "Aktualisieren",
  "screen.refreshing": "Wird aktualisiert…",
  "screen.refreshFailed": "Die Ansicht konnte nicht aktualisiert werden",
  "screen.refreshStale": "Du siehst den zuletzt geladenen Stand.",
  "screen.productUnknown": "Die Engine hat nicht gesagt, was sie ist",
  "screen.engine.loading": "Die Prozesse von {engine} werden geladen…",
  "screen.engine.failed": "Die Prozesse von {engine} konnten nicht geladen werden",
  "screen.engine.atInstances.title": "Incidents und Jobs stehen bei ihren Instanzen",
  "screen.engine.atInstances.detail": "Öffne einen Prozess, dann eine Instanz.",
  "screen.cluster.floor.title": "Pulse liest Camunda {floor} oder neuer",
  "screen.cluster.floor.detail":
    "Der Cluster von {engine} läuft auf Camunda {runs}. Bitte die Person, die ihn betreibt, ihn auf {floor} oder neuer zu aktualisieren.",
  "screen.cluster.storage.title": "Der Cluster von {engine} hat keinen Sekundärspeicher",
  "screen.cluster.storage.detail":
    "Pulse liest die Such-API des Clusters, und die braucht einen Sekundärspeicher wie Elasticsearch, OpenSearch oder eine relationale Datenbank. Bitte die Person, die den Cluster betreibt, einen einzurichten.",

  "screen.instance.loading": "Die Instanz {instance} wird geladen…",
  "screen.instance.failed": "Die Instanz {instance} konnte nicht geladen werden",
  "screen.instance.unknown.title": "Die Instanz {instance} gibt es auf der Engine {engine} nicht",
  "screen.instance.unknown.description":
    "Die Engine kennt keine solche Instanz, weder laufend noch beendet. Prüfe die Adresse oder such die Instanz bei den Prozessen der Engine.",
  "screen.instance.unknown.processes": "Prozesse von {engine}",
  "screen.instance.id": "Instanz-ID",
  "screen.instance.details": "Details der Instanz",
  "screen.instance.split": "Diagramm und Details anders aufteilen",
  "screen.instance.truncated": "Manche Listen sind gekürzt, Pulse zeigt nur einen Teil davon.",
  "screen.instance.noIncidents": "Diese Instanz hat keine offenen Incidents.",

  "screen.process.loading": "Der Prozess {process} wird geladen…",
  "screen.process.failed": "Der Prozess {process} konnte nicht geladen werden",
  "screen.process.unknown.title": "Den Prozess {process} gibt es auf der Engine {engine} nicht",
  "screen.process.unknown.description":
    "Die Engine hat keine Version dieses Prozesses. Prüfe die Adresse oder such den Prozess bei den Prozessen der Engine.",
  "screen.process.unknown.processes": "Prozesse von {engine}",
  "screen.process.versionMissing":
    "Die Version {version} dieses Prozesses gibt es auf der Engine nicht",
  "screen.process.versionShown": "Pulse zeigt v{shown}, die neueste Version.",
  "screen.process.statisticsUnread":
    "Die Zahlen im Diagramm konnten nicht geladen werden. Aktualisiere, um es erneut zu versuchen.",
  "screen.process.callsUnread":
    "Die Prozesse, die diese Version aufruft, konnten nicht geladen werden. Aktualisiere, um es erneut zu versuchen.",
  "screen.process.split": "Diagramm und Instanzen anders aufteilen",
  "screen.process.instances": "Liste der Instanzen",
  "screen.process.list.loading": "Die Instanzen werden geladen…",
  "screen.process.list.failed": "Die Instanzen konnten nicht geladen werden",
  "screen.process.list.refused": "Mit diesen Variablenbedingungen kann die Engine nicht suchen",
  "screen.process.list.clear": "Variablenbedingungen entfernen",
  "screen.process.more.failed": "Weitere Instanzen konnten nicht geladen werden",

  "screen.search.title": "Instanz suchen",
  "screen.search.empty":
    "Gib die ID einer Instanz oder ihren genauen Geschäftsschlüssel in das Suchfeld der Navigation ein.",
  "screen.search.loading": "Alle Engines werden nach {text} durchsucht…",
  "screen.search.listFailed": "Die Engines für die Suche konnten nicht geladen werden",
  "screen.search.found": ({ count }: Readonly<Record<string, unknown>>) =>
    String(count) === "1" ? "1 Instanz gefunden" : `${String(count)} Instanzen gefunden`,
  "screen.search.searched": ({ count }: Readonly<Record<string, unknown>>) =>
    String(count) === "1" ? "1 Engine durchsucht" : `${String(count)} Engines durchsucht`,
  "screen.search.exact": "genaue Suche",
  "screen.search.failed": "{engine} konnte nicht durchsucht werden",
  "screen.search.tooLong":
    "Die ID oder der Geschäftsschlüssel einer Instanz hat höchstens {most} Zeichen. Kürze den Text im Suchfeld und suche noch einmal.",
  "screen.search.unsearched": "Keine Engine konnte durchsucht werden",
  "screen.search.unsearchedHint":
    "Oben steht für jede Engine, warum sie nicht durchsucht werden konnte und was du tun kannst.",

  "tab.history": "Verlauf",
  "tab.incidents": "Incidents",
  "tab.waiting": "Wartet",
  "tab.variables": "Variablen",

  "diagram.label": "Diagramm von {process}",
  "diagram.loading": "Das Diagramm wird geladen…",
  "diagram.none": "Die Engine hat kein Diagramm für diese Version.",
  "diagram.readFailed":
    "Das Diagramm konnte nicht geladen werden. Aktualisiere, um es erneut zu versuchen.",
  "diagram.drawFailed": "Das Diagramm konnte nicht gezeichnet werden.",
  "diagram.callInstance": "Die Instanz {id} öffnen, die {element} aufgerufen hat",
  "diagram.callVersion": "{process} v{version} öffnen, aufgerufen an {element}",

  "caller.calledBy": "Aufgerufen von {caller}",
  "caller.processUnread": "Der Prozess des Aufrufers konnte nicht gelesen werden",
  "caller.open": "Aufrufer öffnen",

  "incident.title": "Incident {incident}",
  "incident.open": "Incident öffnen",
  "incident.sameCause": "Alle mit dieser Ursache",
  "incident.missing.title": "Der Incident {incident} ist in dieser Instanz nicht offen",
  "incident.missing.detail":
    "Vielleicht ist er schon gelöst. Die Instanz zeigt die Incidents, die sie jetzt hat.",
  "incident.missing.show": "Instanz zeigen",
  "incident.resolving": "Die Instanz des Incidents {incident} wird gesucht…",
  "incident.resolveFailed": "Die Instanz des Incidents {incident} konnte nicht geladen werden",
  "incident.textGone":
    "Die Engine hat zu diesem Incident keinen Text. Vielleicht ist er schon gelöst. Aktualisiere die Instanz.",

  "copy.done": "{label} kopiert",
  "copy.failed": "{label} nicht kopiert",
  "copy.failedHint": "Dein Browser hat es nicht erlaubt. Markiere den Text und kopiere ihn selbst.",

  "start.unknownEngine.title": "Die Engine {engine} gibt es auf diesem Server nicht",
  "start.unknownEngine.description":
    "Geh zur Startseite von Pulse. Sie zeigt die Engines und Boards dieses Servers.",

  "signedOut.denied.title": "Anmeldung abgelehnt",
  "signedOut.denied.description":
    "Dein Identitätsanbieter hat die Anmeldung bei Pulse abgelehnt. Frag deine Administration nach Zugang oder melde dich mit einem anderen Konto an.",
  "signedOut.expired.title": "Anmeldung abgelaufen",
  "signedOut.expired.description":
    "Die Anmeldung ist abgelaufen, bevor sie abgeschlossen war. Melde dich erneut an.",
  "signedOut.failed.title": "Anmeldung fehlgeschlagen",
  "signedOut.failed.description":
    "Pulse konnte deine Anmeldung nicht abschließen. Melde dich erneut an.",
  "signedOut.audience.title": "Anmeldung gilt nicht für diesen Server",
  "signedOut.audience.description":
    "Dein Identitätsanbieter hat ein Token ausgestellt, das nicht für diesen Pulse-Server bestimmt ist. Bitte deine Administration, den Server als Zielgruppe des Anmelde-Clients einzutragen.",
  "signedOut.signed_out.title": "Du hast dich abgemeldet",
  "signedOut.signed_out.description": "Melde dich wieder an, um Pulse zu öffnen.",
  "signedOut.unavailable.title": "Der Anmeldedienst antwortet nicht",
  "signedOut.unavailable.description":
    "Pulse erreicht deinen Identitätsanbieter nicht. Versuche es gleich noch einmal.",

  "action.signIn": "Anmelden",
  "action.signInAgain": "Erneut anmelden",
  "action.tryAgain": "Erneut versuchen",
} satisfies Record<keyof typeof en, Message>
