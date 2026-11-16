import type { MessageCatalog } from "@miragon/pulse-widget-shell/widgets"

/** The web app's own words in English: its frame, its notices and the signed-out page. */
export const en = {
  "frame.product": "Pulse",
  "frame.signedInAs": "Signed in as {name}",
  "frame.signOut": "Sign out",
  "frame.signingOut": "Signing out…",

  "notice.ended.title": "Your session has ended",
  "notice.ended.detail": "Sign in again to go on where you left off.",
  "notice.signOutFailed.title": "Sign-out didn't go through",
  "notice.signOutFailed.detail": "Pulse kept your session. Try again.",
  "notice.signInAgain": "Sign in again",

  "page.ended.title": "Your session has ended",
  "page.ended.description": "Sign in again to open this page.",
  "page.unreachable.title": "Pulse doesn't answer",
  "page.unreachable.description": "Your session couldn't be read. Try again in a moment.",

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
