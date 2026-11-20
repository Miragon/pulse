import type { MessageCatalog } from "@miragon/pulse-widget-shell/widgets"

/**
 * The web app's own words in English: its frame and its navigation, its notices, the chrome of its
 * screens (their bars and states; the blocks word their tables) and the signed-out page.
 */
export const en = {
  "frame.product": "Pulse",
  "frame.signedInAs": "Signed in as {name}",
  "frame.signOut": "Sign out",
  "frame.signingOut": "Signing out…",
  "frame.skipToContent": "Skip to content",
  "title.page": "{page} · Pulse",

  "nav.label": "Pulse",
  "nav.start": "Start",
  "nav.fleet": "Cross-engine overview",
  "nav.engines": "Engines",
  "nav.boards": "Boards",
  "nav.section.processes": "Processes",
  "nav.section.incidents": "Incidents",
  "nav.section.jobs": "Jobs",
  "nav.boardsOnly": "boards only",
  "nav.refused": "refused",
  "nav.enginesFailed": "The engines couldn't be loaded. Reload the page.",
  "nav.menu": "Menu",
  "nav.close": "Close menu",
  "title.board": "Board {board} · Pulse",

  "notice.ended.title": "Your session has ended",
  "notice.ended.detail": "Sign in again to go on where you left off.",
  "notice.signOutFailed.title": "Sign-out didn't go through",
  "notice.signOutFailed.detail": "Pulse kept your session. Try again.",
  "notice.signInAgain": "Sign in again",

  "page.ended.title": "Your session has ended",
  "page.ended.description": "Sign in again to open this page.",
  "page.unreachable.title": "Pulse doesn't answer",
  "page.unreachable.description": "Your session couldn't be read. Try again in a moment.",

  "screen.refresh": "Refresh",
  "screen.refreshing": "Refreshing…",
  "screen.refreshFailed": "Couldn't refresh this view",
  "screen.refreshStale": "You're seeing the last loaded state.",
  "screen.productUnknown": "The engine didn't say what it is",
  "screen.engine.loading": "Loading the processes of {engine}…",
  "screen.engine.failed": "The processes of {engine} couldn't be loaded",

  "screen.instance.loading": "Loading instance {instance}…",
  "screen.instance.failed": "Instance {instance} couldn't be loaded",
  "screen.instance.unknown.title": "Instance {instance} isn't on engine {engine}",
  "screen.instance.unknown.description":
    "The engine knows no such instance, running or ended. Check the address, or find the instance among the engine's processes.",
  "screen.instance.unknown.processes": "Processes of {engine}",
  "screen.instance.id": "instance ID",
  "screen.instance.details": "Instance details",
  "screen.instance.split": "Resize diagram and details",
  "screen.instance.truncated": "Some lists are cut off, so Pulse shows only part of them.",
  "screen.instance.noIncidents": "This instance has no open incidents.",

  "tab.history": "History",
  "tab.incidents": "Incidents",
  "tab.waiting": "Waiting",
  "tab.variables": "Variables",

  "diagram.label": "Diagram of {process}",
  "diagram.loading": "Loading the diagram…",
  "diagram.none": "The engine has no diagram for this version.",
  "diagram.readFailed": "The diagram couldn't be loaded. Refresh to try again.",
  "diagram.drawFailed": "The diagram couldn't be drawn.",
  "diagram.callInstance": "Open the instance {id} that {element} called",
  "diagram.callVersion": "Open {process} v{version}, called at {element}",

  "caller.calledBy": "Called by {caller}",
  "caller.processUnread": "The caller's process couldn't be read",
  "caller.open": "Open caller",

  "incident.title": "Incident {incident}",
  "incident.open": "Open incident",
  "incident.sameCause": "All with this cause",
  "incident.missing.title": "Incident {incident} isn't open in this instance",
  "incident.missing.detail":
    "It may be resolved already. The instance shows the incidents it has now.",
  "incident.missing.show": "Show the instance",
  "incident.resolving": "Finding the instance of incident {incident}…",
  "incident.resolveFailed": "The instance of incident {incident} couldn't be loaded",
  "incident.textGone":
    "The engine has no text for this incident. It may be resolved already. Refresh the instance.",

  "copy.done": "Copied the {label}",
  "copy.failed": "Couldn't copy the {label}",
  "copy.failedHint": "Your browser didn't allow it. Select the text and copy it yourself.",

  "start.unknownEngine.title": "Engine {engine} isn't on this server",
  "start.unknownEngine.description":
    "Go to Pulse's start page, which shows this server's engines and boards.",

  "signedOut.denied.title": "Sign-in was refused",
  "signedOut.denied.description":
    "Your identity provider didn't let you sign in to Pulse. Ask your administrator for access, or sign in with another account.",
  "signedOut.expired.title": "Your sign-in took too long",
  "signedOut.expired.description": "The sign-in expired before it was finished. Sign in again.",
  "signedOut.failed.title": "Sign-in didn't work",
  "signedOut.failed.description": "Pulse couldn't finish your sign-in. Sign in again.",
  "signedOut.audience.title": "Your sign-in isn't valid for this server",
  "signedOut.audience.description":
    "Your identity provider issued a token that isn't meant for this Pulse server. Ask your administrator to add the server to the audience of the sign-in client.",
  "signedOut.signed_out.title": "You signed out",
  "signedOut.signed_out.description": "Sign in again to open Pulse.",
  "signedOut.unavailable.title": "The sign-in service doesn't answer",
  "signedOut.unavailable.description":
    "Pulse can't reach your identity provider. Try again in a moment.",

  "action.signIn": "Sign in",
  "action.signInAgain": "Sign in again",
  "action.tryAgain": "Try again",
} satisfies MessageCatalog
