import type { PageHints } from "../page-hints.js"

/**
 * A Claude artifact's words of what to do after a failure (`describeError`'s `pageHints`), where
 * the kit's would send the reader to a chat, to Pulse's start page, to another engine or back to
 * a list: a page in claude.ai has none of them. The kinds any MCP server's failure may be name
 * the server and whoever runs it, never Pulse or an engine, which such a server may not have;
 * only the kinds of the Pulse server's own codes (a refused profile, an engine its tool does not
 * read, a board it does not show) name Pulse.
 * `connectionPlace` is where the viewer manages the page's connectors, claude.ai's settings, which
 * the words of a refused connector name after it ("Reconnect to Pulse in claude.ai, in Settings
 * under Connectors, then try again.").
 */
export const ARTIFACT_PAGE_HINTS: PageHints = {
  en: {
    connectionPlace: "in claude.ai, in Settings under Connectors",
    profileRefused:
      "Whoever runs the Pulse server finds the reason in its log at startup and can fix the profile.",
    unreachable: "Try again in a moment. If it stays unreachable, ask whoever runs the server.",
    notFound: "It may have been deleted since the page read it. Refresh the page.",
    notServed:
      "This Pulse server doesn't read this engine with the tool the page calls. Ask whoever runs the server.",
    unknownBoard: "Ask whoever runs the Pulse server which boards it shows.",
    invalidArguments:
      "You'll find the reason under Details. Whoever published the page can fix the call.",
    notOnServer: "This server doesn't offer the tool the page calls. Ask whoever runs the server.",
    failed: "You'll find the reason under Details. Try again, or ask whoever runs the server.",
    unknown: "Try again. If it fails again, reload the page.",
  },
  de: {
    connectionPlace: "in claude.ai in den Einstellungen unter Connectors",
    profileRefused:
      "Die Person, die den Pulse-Server betreibt, findet den Grund im Log beim Start und kann das Profil korrigieren.",
    unreachable:
      "Versuch es gleich noch mal. Klappt es weiter nicht, frag die Person, die den Server betreibt.",
    notFound:
      "Es wurde vielleicht gelöscht, seit die Seite es gelesen hat. Aktualisiere die Seite.",
    notServed:
      "Dieser Pulse-Server liest diese Engine nicht mit dem Tool, das die Seite aufruft. Frag die Person, die den Server betreibt.",
    unknownBoard: "Frag die Person, die den Pulse-Server betreibt, welche Boards er zeigt.",
    invalidArguments:
      "Den Grund findest du unter Details. Wer die Seite veröffentlicht hat, kann den Aufruf korrigieren.",
    notOnServer:
      "Dieser Server bietet das Tool nicht an, das die Seite aufruft. Frag die Person, die den Server betreibt.",
    failed:
      "Den Grund findest du unter Details. Versuch es noch mal oder frag die Person, die den Server betreibt.",
    unknown: "Versuch es noch mal. Klappt es wieder nicht, lade die Seite neu.",
  },
}
