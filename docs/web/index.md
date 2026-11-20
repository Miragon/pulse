# Pulse web app

The web app shows the MCP server's views in a browser, as pages of the same server under `/app`: the
cockpit and the boards for people with no AI chat at hand, support and operations teams first. They
sign in through the identity provider that already protects the server (Keycloak, Microsoft Entra
ID, ADFS or any OpenID Connect provider), and every page calls it with their own token, under a
chat's toolset, engine routing and numbers. It only reads: no write control, no hand-off to a chat.

## Pages

| URL                                     | What it shows                                                                                                                               |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `/app`                                  | The engines and the server's [boards](../mcp/boards.md) to pick from; with one engine and no board, that engine                             |
| `/app/fleet`                            | The cross-engine overview, with two engines or more: each engine's row opens it                                                             |
| `/app/boards/<id>`                      | A board, with the tiles and numbers the chat shows; a [Camunda 8](../mcp/camunda8.md) cluster's as the server reads it                      |
| `/app/engines/<engine>`                 | The engine's processes (`?scope=incident&q=…`: filtered), or why the page shows no view of it (an engine on boards only, a refused profile) |
| `…/processes/<key>`, `…/instances/<id>` | A process (`?scope=incident`: its incidents), an instance (`?tab=history`: its history, `/incidents/<id>`: an incident)                     |
| `…/instances`, `…/incidents`, `…/jobs`  | The engine's instances (`?process=<key>`), incidents (`/cause?activity=…&type=…`: one cause) and jobs (`?failed=true`)                      |
| `/app/signed-out`                       | Why a sign-in ended, and a new one                                                                                                          |

Each view you open (an entry, a row, the trail) has its own URL, stable from the release that ships
it: Back returns to the view before, a reload or a copied link shows it again, and the page never
loads anew. An earlier release's URL (`/app/cockpit?view=…`) gives way to the view's own, which an
incident and an id no path holds (`.`, `..`) keep; `/app/` is a 404. The page speaks the browser's
German or English, follows the system's light or dark theme (its diagrams too), and is compact on a
desktop, comfortable on touch.

## Navigation

The side navigation holds **Start**, the cross-engine overview (with two engines or more), the
engines by environment, the open one with its sections (processes, incidents, jobs; an engine's
entry opens its processes), and the boards; at its foot who is signed in and **Sign out**. A
Camunda 8 engine says it shows on boards only, a refused profile says so; each opens its one state.
Every entry is a link, so Ctrl or Cmd+click and a middle click open a new tab. Under 64rem it is a
drawer behind the menu button, the first of each view's bar. It shows no numbers: the views do.
An engine's processes list each with its latest version, running instances and instances with
incident over every version, the numbers Pulse for VS Code shows; scopes and search filter in the
browser, a row opens its process, and **Refresh** reads again (on its own when you return after 60 s).

## When something ends

- **The session ends** while a page is open (its hours are up, or the identity provider refuses to
  renew it): one notice above the view says so, and **Sign in again** comes back to the same page.
  The views keep what they show and retry nothing.
- **The server doesn't answer** when a page opens: the page says so and offers **Try again** (an
  engine that doesn't answer keeps its sections in the navigation beside the view that says so).
- **A start the server refuses for good** (a board or an engine it does not have, a board it cannot
  read, arguments `engine_open_cockpit` does not take): the page says why, links to the start page.
- **A sign-in fails**: `/app/signed-out` says what happened (the identity provider refused it, it
  took too long, its token isn't meant for this server, the identity provider doesn't answer) and
  starts a new one. [Set up the sign-in](sign-in.md#when-a-sign-in-fails) lists the causes.

## Run it

The image `ghcr.io/miragon/pulse-server` holds the web app. It stays off until you name a sign-in
client beside the server's OAuth provider: [Set up the sign-in](sign-in.md) has the variables and
the provider's side, [How it works](architecture.md) the routes, the cookie and what a page may
call. To try it on your machine, run `pnpm play --web` ([locally](sign-in.md#try-it-locally)).

A server built from the [starter](../mcp/build-your-own.md) serves no page until it builds one and
hands it to `createComposedServer` with its `web` option.
