# Pulse web app

The web app shows the MCP server's views as pages of the same server, under `/app`: the cockpit and
the boards in a browser, for people with no AI chat at hand, support and operations teams first.
They sign in through the identity provider that already protects the server (Keycloak,
Microsoft Entra ID, ADFS or another OpenID Connect provider), and every page calls it with their own
token, under the same toolset, engine routing and numbers as a chat.

The web app only reads: a page shows no write control and, posting to no chat, no hand-off.

## Pages

| URL                                  | What it shows                                                                                                                     |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| `/app`                               | The engines and the server's [boards](../mcp/boards.md) to pick from; with one engine and no board, that engine's overview        |
| `/app/boards/<id>`                   | A board, with the tiles and numbers the chat shows; a [Camunda 8](../mcp/camunda8.md) cluster's as the server's client reads them |
| `/app/cockpit?view=jobs&engine=prod` | The start the query names: each parameter is one argument of `engine_open_cockpit`, which refuses one it does not take            |
| `/app/signed-out`                    | Why a sign-in ended, and a new one                                                                                                |

A URL names where a page starts. Inside the page you move as in the cockpit (a row opened by a
click or Enter, the trail, **All engines**) and the address stays; the browser's Back leaves the
page. `/app` has no trailing slash, like `/mcp`: `/app/` answers 404.

The bar names who is signed in and holds **Sign out**. The page speaks German or English by the
browser, follows the system's light or dark theme, and is compact on a desktop and comfortable on
touch.

## When something ends

- **The session ends** while a page is open (its hours are up, or the identity provider refuses to
  renew it): one notice under the bar says so, and **Sign in again** comes back to the same page.
  The views keep what they show and retry nothing.
- **The server doesn't answer** when a page opens: the page says so and offers **Try again** (an
  engine that doesn't answer keeps the cockpit's tabs above the view that says so).
- **A start the server refuses for good** (a board it does not have or cannot read, arguments
  `engine_open_cockpit` does not take): the page says why and links to the start page.
- **A sign-in fails**: `/app/signed-out` says what happened (the identity provider refused it, it
  took too long, its token isn't meant for this server, the identity provider doesn't answer) and
  starts a new one. [Set up the sign-in](sign-in.md#when-a-sign-in-fails) lists the causes.

## Run it

The image `ghcr.io/miragon/pulse-server` holds the web app. It stays off until you name a sign-in
client beside the server's OAuth provider: [Set up the sign-in](sign-in.md) has the variables and
the provider's side, [How it works](architecture.md) the routes, the cookie and what a page may
call. To try it on your machine, run `pnpm play --web` ([locally](sign-in.md#try-it-locally)).

A server built from the [starter](../mcp/build-your-own.md) serves no page: its server names no web
build. `createComposedServer` takes one with its `web` option, so a starter can serve a page it
builds itself.
