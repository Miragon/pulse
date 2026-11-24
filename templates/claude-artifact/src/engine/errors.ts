import {
  describeError,
  isPermanentError,
  type PageHints,
} from "@miragon/pulse-widget-shell/widgets"
import { CONNECTOR_NAME } from "./claude-connector.ts"
import type { EngineError, EngineErrorCode } from "./connector.ts"

/** A failure in words: what happened, what you can do, the raw text for "Details". */
export interface ErrorWords {
  title: string
  hint: string
  details: string | null
  /** Whether Try again can help: false for a refusal no retry changes. */
  retry: boolean
}

type Language = "en" | "de"

/**
 * The runtime's codes in words, each what happened and what you can do, `{connector}` the name the
 * page calls the viewer's connector by (`CONNECTOR_NAME`). A hint that says try again comes with
 * Try again (`retry`); the connector asks the runtime anew after a refusal, so a connector
 * connected, picked or reconnected meanwhile answers the next try without a reload.
 */
const RUNTIME_WORDS: Readonly<
  Record<
    Language,
    Readonly<Record<Exclude<EngineErrorCode, "tool_error">, readonly [string, string]>>
  >
> = {
  en: {
    needs_reauth: [
      "Your Pulse connector needs a new sign-in",
      "Reconnect {connector} in claude.ai, in Settings under Connectors, then try again.",
    ],
    not_connected: [
      "This page has no Pulse connector",
      "Add the Pulse MCP server as a connector named {connector} in claude.ai, in Settings under Connectors, or pick it when claude.ai asks for one, then try again.",
    ],
    not_allowed: [
      "This page may not call the tool it needs",
      "The page's mcp capability doesn't name the tool, or a policy of your organization blocks the access. Ask whoever published the page.",
    ],
    approval_required: [
      "This read waits for your approval",
      "Allow the page to use {connector} when claude.ai asks, then try again.",
    ],
    unavailable: [
      "The Pulse connector doesn't answer",
      "Try again in a moment. If it keeps failing, check that the Pulse MCP server runs.",
    ],
  },
  de: {
    needs_reauth: [
      "Dein Pulse-Connector braucht eine neue Anmeldung",
      "Verbinde {connector} in claude.ai neu, in den Einstellungen unter Connectors, und versuch es dann noch mal.",
    ],
    not_connected: [
      "Diese Seite hat keinen Pulse-Connector",
      "Füge den Pulse-MCP-Server in claude.ai in den Einstellungen unter Connectors als Connector {connector} hinzu oder wähl ihn aus, wenn claude.ai danach fragt, und versuch es dann noch mal.",
    ],
    not_allowed: [
      "Diese Seite darf das Tool nicht aufrufen, das sie braucht",
      "Die mcp-Fähigkeit der Seite nennt das Tool nicht, oder eine Richtlinie deiner Organisation sperrt den Zugriff. Frag die Person, die die Seite veröffentlicht hat.",
    ],
    approval_required: [
      "Dieser Lesezugriff wartet auf deine Freigabe",
      "Erlaube der Seite, {connector} zu nutzen, wenn claude.ai fragt, und versuch es dann noch mal.",
    ],
    unavailable: [
      "Der Pulse-Connector antwortet nicht",
      "Versuch es gleich noch mal. Klappt es weiter nicht, prüf, ob der Pulse-MCP-Server läuft.",
    ],
  },
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
 * A failed call in the viewer's language: the runtime's refusals in the page's own words, the
 * server's errors (`tool_error`) classified by the kit (`describeError`), never the raw text as
 * the title; the raw text only under "Details".
 */
export function describeEngineError(error: EngineError, locale: string): ErrorWords {
  if (error.code !== "tool_error") {
    const [title, hint] = RUNTIME_WORDS[languageOf(locale)][error.code]
    return {
      title,
      hint: hint.replaceAll("{connector}", CONNECTOR_NAME),
      details: error.detail,
      retry: error.code !== "not_allowed",
    }
  }
  const described = describeError(error.detail, locale, {
    followUp: "none",
    pageHints: ARTIFACT_HINTS,
  })
  return {
    title: described.title,
    hint: described.hint,
    details: described.details,
    retry: !isPermanentError(error.detail),
  }
}

/** Every word of this file, for the brand test's catalog gates. */
export const ERROR_CATALOGS = {
  en: { runtime: RUNTIME_WORDS.en, hints: ARTIFACT_HINTS.en },
  de: { runtime: RUNTIME_WORDS.de, hints: ARTIFACT_HINTS.de },
} as const
