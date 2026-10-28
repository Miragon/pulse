import type { Locale } from "../profile-constants.js"

export type ErrorSource =
  { type: "engine"; id?: string } | { type: "prometheus" } | { type: "unknown" }

export interface ErrorKindLabels {
  title: (p: { source: string; status: string }) => string
  hint: (p: { source: ErrorSource["type"] }) => string
}

/** Checked branch by branch by the catalog text and glossary tests in `brand-gates.test.ts`. */
export interface ErrorLabels {
  /** The source as the subject of a title, sentence-initial. */
  source: (p: { source: ErrorSource }) => string
  /** The HTTP status as a title suffix (" (HTTP 503)"). */
  status: (p: { status: number }) => string
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
      : source.type === "prometheus"
        ? "Prometheus"
        : "The data source",
  status: ({ status }) => ` (HTTP ${status})`,
  unreachable: {
    title: ({ source, status }) => `${source} is unreachable${status}`,
    hint: ({ source }) =>
      source === "engine"
        ? "Check that the engine is running, or pick another engine."
        : source === "prometheus"
          ? "Check that Prometheus is running and reachable."
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
    hint: () => "The module behind it isn't active here. Ask in the chat what you can do instead.",
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
    hint: () => "You'll find the reason under Details. Try again, or ask in the chat.",
  },
  unknown: {
    title: () => "Something went wrong",
    hint: () => "Try again. If it fails again, ask in the chat.",
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
      : source.type === "prometheus"
        ? "Prometheus"
        : "Die Datenquelle",
  status: ({ status }) => ` (HTTP ${status})`,
  unreachable: {
    title: ({ source, status }) => `${source} ist nicht erreichbar${status}`,
    hint: ({ source }) =>
      source === "engine"
        ? "Prüf, ob die Engine läuft, oder wähl eine andere Engine."
        : source === "prometheus"
          ? "Prüf, ob Prometheus läuft und erreichbar ist."
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
    hint: () =>
      "Das zuständige Modul ist hier nicht aktiv. Frag im Chat, was du stattdessen tun kannst.",
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
    hint: () => "Den Grund findest du unter Details. Versuch es noch mal oder frag im Chat nach.",
  },
  unknown: {
    title: () => "Das hat nicht geklappt",
    hint: () => "Versuch es noch mal. Klappt es wieder nicht, frag im Chat nach.",
  },
  toast: {
    reason: ({ title, reason }) => `${title}: „${unstop(reason)}“.`,
    failedHint: () => "Versuch es noch mal oder frag im Chat nach.",
    mayHaveApplied: () =>
      "Vielleicht hat es trotzdem geklappt. Prüf den aktuellen Stand, bevor du es noch mal versuchst.",
  },
}

export const ERROR_LABELS: Readonly<Record<Locale, ErrorLabels>> = { en: EN, de: DE }
