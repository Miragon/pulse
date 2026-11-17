# Pulse web app

The page a Pulse server serves under `/app`: the MCP server's views, the operations cockpit first,
on a page of the server, for people who sign in through the server's OAuth provider instead of
asking a chat. It reads the engines through the server's tools with the user's own token and writes
to none.

- `/app` opens the cockpit's landing: the engines and the server's boards to pick from (with one
  engine and no board, that engine); `/app/boards/<id>` a board, as the chat shows it;
  `/app/cockpit?view=jobs&engine=prod` the start the query names, with the arguments of
  `engine_open_cockpit`.
- The bar names who is signed in and signs out; a session that ends while a page is open shows a
  notice whose sign-in comes back to the page.
- `/app/signed-out` says why a sign-in ended and starts a new one.

The server turns the web app on with `MCP_WEB_CLIENT_ID` beside its OAuth provider and reads this
build (`pnpm --fail-if-no-match --filter @miragon/pulse-web build`, into `dist/`) from the folder
`MCP_WEB_DIR` names; its routes, its session and its security headers are widget-shell's
([README](../../packages/core/widget-shell/README.md#the-web-app)). How to set up its sign-in and
run it: the docs' [web app pages](../../docs/web/index.md). How the app is built and checked:
[CLAUDE.md](CLAUDE.md).
