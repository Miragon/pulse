import type { ErrorKind } from "./describe-error.js"
import type { Locale } from "./host-context.js"

/**
 * A page's words of what to do after a failure (`describeError` where its `followUp` is not
 * `chat`), for each kind whose chat words send the reader to the chat: on a page that posts to no
 * chat they say what to do there instead. Every other kind's hint is the same in both.
 */
export type PageHints = Readonly<Record<Locale, Readonly<Partial<Record<ErrorKind, string>>>>>

/**
 * Only a page's host brings them (`ViewHost.pageHints`: `BrowserViewHost`, and `TestViewHost` off
 * a chat), so a chat's bundle carries none of them. Checked with the error words by
 * `kit-words.test.ts`.
 */
export const PAGE_HINTS: PageHints = {
  en: {
    // A view of one engine whose dialect its route does not read: the page shows the engine's
    // processes and instances on screens of its own, which its start page leads to.
    notServed:
      "Pulse shows its processes and instances on pages of their own. Open the engine from Pulse's start page.",
    unknownBoard: "Go to Pulse's start page, which shows this server's boards and engines.",
    invalidArguments:
      "You'll find the reason under Details. Open the view from Pulse's start page instead.",
    notOnServer:
      "The module behind it isn't active here. Pulse's start page shows what this server offers.",
    failed: "You'll find the reason under Details. Try again, or ask whoever runs this server.",
    unknown: "Try again. If it fails again, reload the page.",
  },
  de: {
    notServed:
      "Pulse zeigt ihre Prozesse und Instanzen auf eigenen Seiten. Öffne die Engine über die Startseite von Pulse.",
    unknownBoard: "Geh zur Startseite von Pulse. Sie zeigt die Boards und Engines dieses Servers.",
    invalidArguments:
      "Den Grund findest du unter Details. Öffne die Ansicht stattdessen von der Startseite von Pulse aus.",
    notOnServer:
      "Das zuständige Modul ist hier nicht aktiv. Die Startseite von Pulse zeigt, was dieser Server bietet.",
    failed:
      "Den Grund findest du unter Details. Versuch es noch mal oder frag die Person, die den Server betreibt.",
    unknown: "Versuch es noch mal. Klappt es wieder nicht, lade die Seite neu.",
  },
}
