import { engineViews } from "@miragon/pulse-engine-connector/widgets"
import { startPage } from "./start.js"
import "./styles.css"

// The web app's one page: every route the server serves it at (pages.ts, the signed-out page)
// starts here, with the engine module's views and the browser's own hands.
void startPage({
  views: engineViews,
  location: window.location,
  history: window.history,
  onPopState: (listener) => {
    window.addEventListener("popstate", listener)
    return () => window.removeEventListener("popstate", listener)
  },
  fetch: (input, init) => fetch(input, init),
  assign: (url) => window.location.assign(url),
  reload: () => window.location.reload(),
})
