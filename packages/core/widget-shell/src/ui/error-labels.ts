import type { Locale } from "./host-context.js"

export type ErrorSource = { type: "engine"; id?: string } | { type: "unknown" }

export interface ErrorKindLabels {
  title: (p: { source: string; status: string }) => string
  /**
   * What you can do. `page` where the view sits on a page that posts to no chat (a host whose
   * `followUp` is not `chat`): those words never send the reader to a chat.
   */
  hint: (p: { source: ErrorSource["type"]; page: boolean }) => string
}

/** Checked branch by branch by the catalog text and glossary tests in `kit-words.test.ts`. */
export interface ErrorLabels {
  /** The source as the subject of a title, sentence-initial. */
  source: (p: { source: ErrorSource }) => string
  /** The HTTP status as a title suffix (" (HTTP 503)"). */
  status: (p: { status: number }) => string
  profileRefused: ErrorKindLabels
  readOnly: ErrorKindLabels
  signedOut: ErrorKindLabels
  unknownBoard: ErrorKindLabels
  boardRefused: ErrorKindLabels
  invalidArguments: ErrorKindLabels
  unreachable: ErrorKindLabels
  timeout: ErrorKindLabels
  notOnServer: ErrorKindLabels
  unauthorized: ErrorKindLabels
  forbidden: ErrorKindLabels
  notFound: ErrorKindLabels
  failed: ErrorKindLabels
  unknown: ErrorKindLabels
  /** A toast has no "Details": these words never point there and carry the reason themselves. */
  toast: {
    reason: (p: { title: string; reason: string }) => string
    failedHint: () => string
    /** The write's answer never came (timeout, lost connection): it may have gone through. */
    mayHaveApplied: () => string
  }
}

/** A reason as a quotation ends without its own full stop; the sentence's comes after the quote. */
const unstop = (reason: string) => reason.replace(/[.\s]+$/, "")

const EN: ErrorLabels = {
  source: ({ source }) =>
    source.type === "engine"
      ? source.id
        ? `Engine ${source.id}`
        : "The engine"
      : "The data source",
  status: ({ status }) => ` (HTTP ${status})`,
  profileRefused: {
    title: ({ source }) => `${source} cannot be used: its profile is refused`,
    hint: () =>
      "Whoever runs this server finds the reason in its log at startup and can fix the profile. Until then, pick another engine.",
  },
  readOnly: {
    title: ({ source }) => `${source} is read-only on this server`,
    hint: () =>
      "Its profile allows reads only, so nothing was changed. Ask whoever runs this server if you need to change something there.",
  },
  signedOut: {
    title: () => "You're signed out",
    hint: () => "Sign in again to see the current state.",
  },
  unknownBoard: {
    title: () => "This board isn't on this server",
    hint: ({ page }) =>
      page
        ? "Go to Pulse's start page, which shows this server's boards and engines."
        : "Ask in the chat which boards this server shows.",
  },
  boardRefused: {
    title: () => "This board can't be shown: its file gives no board",
    hint: () =>
      "Its problems are under Details and in the server's log at startup. Ask whoever runs this server to fix the file.",
  },
  invalidArguments: {
    title: () => "The server refused this request",
    hint: ({ page }) =>
      page
        ? "You'll find the reason under Details. Open the view from Pulse's start page instead."
        : "You'll find the reason under Details. Ask in the chat to try it another way.",
  },
  unreachable: {
    title: ({ source, status }) => `${source} is unreachable${status}`,
    hint: ({ source }) =>
      source === "engine"
        ? "Check that the engine is running, or pick another engine."
        : "Check the connection, then try again.",
  },
  timeout: {
    title: ({ source }) => `${source} did not respond in time`,
    hint: ({ source }) =>
      source === "engine"
        ? "Try again in a moment. If it keeps happening, the engine may be under heavy load."
        : "Try again in a moment.",
  },
  notOnServer: {
    title: () => "This data isn't available on this server",
    hint: ({ page }) =>
      page
        ? "The module behind it isn't active here. Pulse's start page shows what this server offers."
        : "The module behind it isn't active here. Ask in the chat what you can do instead.",
  },
  unauthorized: {
    title: ({ source, status }) => `${source} rejected the server's credentials${status}`,
    hint: () => "Ask whoever runs this server to check its credentials.",
  },
  forbidden: {
    title: ({ source, status }) => `${source} denied access${status}`,
    hint: () =>
      "The server's account lacks the permission for this. Ask whoever runs the server to check it.",
  },
  notFound: {
    title: () => "This entry no longer exists",
    hint: () => "It may have ended or been deleted. Go back to the list, or try again.",
  },
  failed: {
    title: ({ source, status }) => `${source} reported an error${status}`,
    hint: ({ page }) =>
      page
        ? "You'll find the reason under Details. Try again, or ask whoever runs this server."
        : "You'll find the reason under Details. Try again, or ask in the chat.",
  },
  unknown: {
    title: () => "Something went wrong",
    hint: ({ page }) =>
      page
        ? "Try again. If it fails again, reload the page."
        : "Try again. If it fails again, ask in the chat.",
  },
  toast: {
    reason: ({ title, reason }) => `${title}: “${unstop(reason)}”.`,
    failedHint: () => "Try again, or ask in the chat.",
    mayHaveApplied: () =>
      "It may have worked anyway. Check the current state before you try again.",
  },
}

const DE: ErrorLabels = {
  source: ({ source }) =>
    source.type === "engine"
      ? source.id
        ? `Die Engine ${source.id}`
        : "Die Engine"
      : "Die Datenquelle",
  status: ({ status }) => ` (HTTP ${status})`,
  profileRefused: {
    title: ({ source }) => `${source} ist nicht nutzbar: ihr Profil ist abgelehnt`,
    hint: () =>
      "Die Person, die den Server betreibt, findet den Grund im Log beim Start und kann das Profil korrigieren. Wähl bis dahin eine andere Engine.",
  },
  readOnly: {
    title: ({ source }) => `${source} ist auf diesem Server nur lesbar`,
    hint: () =>
      "Das Profil dieser Engine erlaubt nur Lesezugriffe, darum hat sich nichts geändert. Bitte die Person, die den Server betreibt, wenn du dort etwas ändern musst.",
  },
  signedOut: {
    title: () => "Du bist abgemeldet",
    hint: () => "Melde dich erneut an, um den aktuellen Stand zu sehen.",
  },
  unknownBoard: {
    title: () => "Dieses Board gibt es auf diesem Server nicht",
    hint: ({ page }) =>
      page
        ? "Geh zur Startseite von Pulse. Sie zeigt die Boards und Engines dieses Servers."
        : "Frag im Chat, welche Boards dieser Server zeigt.",
  },
  boardRefused: {
    title: () => "Dieses Board lässt sich nicht zeigen: seine Datei ergibt kein Board",
    hint: () =>
      "Die Probleme stehen unter Details und im Log des Servers beim Start. Bitte die Person, die den Server betreibt, die Datei zu korrigieren.",
  },
  invalidArguments: {
    title: () => "Der Server hat diese Anfrage abgelehnt",
    hint: ({ page }) =>
      page
        ? "Den Grund findest du unter Details. Öffne die Ansicht stattdessen von der Startseite von Pulse aus."
        : "Den Grund findest du unter Details. Frag im Chat nach einem anderen Weg.",
  },
  unreachable: {
    title: ({ source, status }) => `${source} ist nicht erreichbar${status}`,
    hint: ({ source }) =>
      source === "engine"
        ? "Prüf, ob die Engine läuft, oder wähl eine andere Engine."
        : "Prüf die Verbindung und versuch es noch mal.",
  },
  timeout: {
    title: ({ source }) => `${source} antwortet nicht rechtzeitig`,
    hint: ({ source }) =>
      source === "engine"
        ? "Versuch es gleich noch mal. Passiert das öfter, ist die Engine vielleicht stark ausgelastet."
        : "Versuch es gleich noch mal.",
  },
  notOnServer: {
    title: () => "Diese Daten gibt es auf diesem Server nicht",
    hint: ({ page }) =>
      page
        ? "Das zuständige Modul ist hier nicht aktiv. Die Startseite von Pulse zeigt, was dieser Server bietet."
        : "Das zuständige Modul ist hier nicht aktiv. Frag im Chat, was du stattdessen tun kannst.",
  },
  unauthorized: {
    title: ({ source, status }) => `${source} lehnt die Zugangsdaten des Servers ab${status}`,
    hint: () => "Bitte die Person, die den Server betreibt, die Zugangsdaten zu prüfen.",
  },
  forbidden: {
    title: ({ source, status }) => `${source} verweigert den Zugriff${status}`,
    hint: () =>
      "Dem Konto des Servers fehlt dafür die Berechtigung. Bitte die Person, die den Server betreibt, das zu prüfen.",
  },
  notFound: {
    title: () => "Diesen Eintrag gibt es nicht mehr",
    hint: () =>
      "Er wurde vielleicht beendet oder gelöscht. Geh zurück zur Liste oder versuch es noch mal.",
  },
  failed: {
    title: ({ source, status }) => `${source} meldet einen Fehler${status}`,
    hint: ({ page }) =>
      page
        ? "Den Grund findest du unter Details. Versuch es noch mal oder frag die Person, die den Server betreibt."
        : "Den Grund findest du unter Details. Versuch es noch mal oder frag im Chat nach.",
  },
  unknown: {
    title: () => "Das hat nicht geklappt",
    hint: ({ page }) =>
      page
        ? "Versuch es noch mal. Klappt es wieder nicht, lade die Seite neu."
        : "Versuch es noch mal. Klappt es wieder nicht, frag im Chat nach.",
  },
  toast: {
    reason: ({ title, reason }) => `${title}: „${unstop(reason)}“.`,
    failedHint: () => "Versuch es noch mal oder frag im Chat nach.",
    mayHaveApplied: () =>
      "Vielleicht hat es trotzdem geklappt. Prüf den aktuellen Stand, bevor du es noch mal versuchst.",
  },
}

export const ERROR_LABELS: Readonly<Record<Locale, ErrorLabels>> = { en: EN, de: DE }
