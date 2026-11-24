import { describePageError, resolveUiMessages, type SectionFailure } from "@miragon/pulse-ui"
import {
  describeError,
  isPermanentError,
  type PageHints,
} from "@miragon/pulse-widget-shell/widgets"
import { CONNECTOR_NAME } from "./claude-connector.ts"
import type { EngineError } from "./connector.ts"

type Language = "en" | "de"

/**
 * Where the viewer manages the page's connector, the place pulse-ui's page errors name after the
 * connector (`describePageError`'s `place`): "Reconnect to Pulse in claude.ai, in Settings under
 * Connectors, then try again."
 */
export const CLAUDE_PLACE: Readonly<Record<Language, string>> = {
  en: "in claude.ai, in Settings under Connectors",
  de: "in claude.ai in den Einstellungen unter Connectors",
}

/**
 * A page's words of what to do after the server's errors, where the kit's would send the reader
 * to a chat, to Pulse's start page, to another engine or back to a list (`describeError`'s
 * `pageHints`): a dashboard of one engine has none of them.
 */
export const ARTIFACT_HINTS: PageHints = {
  en: {
    profileRefused:
      "Whoever runs the Pulse server finds the reason in its log at startup and can fix the profile.",
    unreachable: "Check that the engine is running and reachable, then try again.",
    notFound: "It may have been deleted since the page read it. Refresh the page.",
    notServed:
      "This Pulse server doesn't read this engine with the tool the page calls. Ask whoever runs the server.",
    unknownBoard: "Ask whoever runs the Pulse server which boards it shows.",
    invalidArguments:
      "You'll find the reason under Details. Whoever published the page can fix the call.",
    notOnServer:
      "The module behind it isn't active on this Pulse server. Ask whoever runs the server.",
    failed:
      "You'll find the reason under Details. Try again, or ask whoever runs the Pulse server.",
    unknown: "Try again. If it fails again, reload the page.",
  },
  de: {
    profileRefused:
      "Die Person, die den Pulse-Server betreibt, findet den Grund im Log beim Start und kann das Profil korrigieren.",
    unreachable: "Prüf, ob die Engine läuft und erreichbar ist, und versuch es dann noch mal.",
    notFound:
      "Es wurde vielleicht gelöscht, seit die Seite es gelesen hat. Aktualisiere die Seite.",
    notServed:
      "Dieser Pulse-Server liest diese Engine nicht mit dem Tool, das die Seite aufruft. Frag die Person, die den Server betreibt.",
    unknownBoard: "Frag die Person, die den Pulse-Server betreibt, welche Boards er zeigt.",
    invalidArguments:
      "Den Grund findest du unter Details. Wer die Seite veröffentlicht hat, kann den Aufruf korrigieren.",
    notOnServer:
      "Das zuständige Modul ist auf diesem Pulse-Server nicht aktiv. Frag die Person, die den Server betreibt.",
    failed:
      "Den Grund findest du unter Details. Versuch es noch mal oder frag die Person, die den Pulse-Server betreibt.",
    unknown: "Versuch es noch mal. Klappt es wieder nicht, lade die Seite neu.",
  },
}

export function languageOf(locale: string): Language {
  return locale.toLowerCase().startsWith("de") ? "de" : "en"
}

/**
 * A failed call in the viewer's language, as pulse-ui's `SectionState` and `ErrorState` show it:
 * the runtime's refusals in the kit's page error words (`describePageError`) with the connector's
 * name and claude.ai's place, the server's errors (`tool_error`) classified by the kit's
 * `describeError` with the page's own hints; never the raw text as the title, the raw text only
 * under "Details", `permanent` where Try again cannot help.
 */
export function describeEngineError(error: EngineError, locale: string): SectionFailure {
  if (error.code !== "tool_error") {
    return describePageError(error, {
      messages: resolveUiMessages(locale),
      connector: CONNECTOR_NAME,
      place: CLAUDE_PLACE[languageOf(locale)],
    })
  }
  const described = describeError(error.detail, locale, {
    followUp: "none",
    pageHints: ARTIFACT_HINTS,
  })
  return {
    title: described.title,
    hint: described.hint,
    ...(described.details ? { details: described.details } : {}),
    ...(isPermanentError(error.detail) ? { permanent: true } : {}),
  }
}

/** Every word of this file, for the brand test's catalog gates. */
export const ERROR_CATALOGS = {
  en: { place: CLAUDE_PLACE.en, hints: ARTIFACT_HINTS.en },
  de: { place: CLAUDE_PLACE.de, hints: ARTIFACT_HINTS.de },
} as const
