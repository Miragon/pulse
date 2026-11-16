/**
 * The pages of the web app: the routes of the server that answer with this build's page. The build
 * writes them into its `pages.json` (vite.config.ts), which the server reads at boot, so a page it
 * serves is a page the app knows. `/app` opens the cockpit at its default start, `/app/cockpit` at
 * the start its query names. The signed-out page, `/app/signed-out`, is a route of the server's
 * own, which serves the same page without a session: no page of the build names it.
 */
export const PAGES = {
  app: "/app",
  cockpit: "/app/cockpit",
} as const

/** The routes `pages.json` lists, as the server's router patterns. */
export const PAGE_PATTERNS: readonly string[] = Object.values(PAGES)
