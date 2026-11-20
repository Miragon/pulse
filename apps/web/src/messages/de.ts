import type { en } from "./en.js"

/**
 * Die eigenen Worte der Web-App auf Deutsch: Rahmen und Navigation, Hinweise und die Seite nach der
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
  "nav.section.overview": "Übersicht",
  "nav.section.incidents": "Incidents",
  "nav.section.jobs": "Jobs",
  "nav.boardsOnly": "nur Boards",
  "nav.refused": "abgelehnt",
  "nav.enginesFailed": "Die Engines konnten nicht geladen werden. Lade die Seite neu.",
  "nav.menu": "Menü",
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
} satisfies Record<keyof typeof en, string>
