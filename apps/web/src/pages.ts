/**
 * The pages of the web app: the routes of the server that answer with this build's page, one per
 * canonical address of a view (src/router/routes.ts reads and writes them). The build writes them
 * into its `pages.json` (vite.config.ts), which the server reads at boot, so a page it serves is a
 * page the app knows. Every pattern is `/app` or lowercase words and `:params` below it, its first
 * segment none of the server's own routes, so the server takes it as it is.
 *
 * `/app` opens the start page (the cockpit's landing: the engines and the server's boards),
 * `/app/search` the search for an instance across engines (`?q=` what it searches), `/app/fleet`
 * the cross-engine overview, `/app/boards/:id` a board and `/app/engines/:engine/…` an engine's
 * views. These addresses are public and stay stable from the first release that ships
 * them: a change keeps the old address readable and replaces it by the new one for the transition
 * period. `/app/cockpit` is the address of every view before this scheme, whose query names the
 * cockpit's arguments: the page reads it and replaces it by the view's own address, readable as
 * such until one minor version after the start page replaces the cross-engine overview (owner
 * decision of 2026-11-19). It is also the address of a place no path names whole (`urlOf`): an id
 * that can be no segment (empty, `.`, `..`) for good, an incident until the instance screen finds
 * its instance. So taking it out of the pages needs another home for those first. The signed-out
 * page, `/app/signed-out`, is a route of the server's own, which serves the same page without a
 * session: no page of the build names it.
 */
export const PAGES = {
  app: "/app",
  search: "/app/search",
  fleet: "/app/fleet",
  board: "/app/boards/:id",
  engine: "/app/engines/:engine",
  process: "/app/engines/:engine/processes/:process",
  instances: "/app/engines/:engine/instances",
  instance: "/app/engines/:engine/instances/:instance",
  incident: "/app/engines/:engine/instances/:instance/incidents/:incident",
  incidents: "/app/engines/:engine/incidents",
  cause: "/app/engines/:engine/incidents/cause",
  jobs: "/app/engines/:engine/jobs",
  cockpit: "/app/cockpit",
} as const

/** The routes `pages.json` lists, as the server's router patterns. */
export const PAGE_PATTERNS: readonly string[] = Object.values(PAGES)
