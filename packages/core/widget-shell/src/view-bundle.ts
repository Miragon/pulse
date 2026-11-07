/**
 * The packages a host's view bundle must resolve to ONE instance: spread it into Vite's
 * `resolve.dedupe` (`dedupe: [...VIEW_BUNDLE_DEDUPE]`) in every server that bundles views.
 *
 * pnpm installs a package once per peer set, so the connectors, your own modules and the app
 * can each see their own copy of these. Each copy carries its own React context or module
 * state: the view root (widget-shell's copy) provides the view host and the ONE `QueryClient`,
 * but a widget that reads another copy finds no host and no client, and every in-widget query
 * hangs on "Loading…". (The official `App` keeps no React context, so a second copy costs only
 * bytes and it stays off this list.) The same holds for the locale and
 * toast contexts of `@miragon/pulse-ui`, the view runtime of this package and the
 * `LucideProvider` of `lucide-react` (dedupe a 1.x copy: 0.x has no `LucideProvider`).
 * A version bump of this package ships a change to the list; never trim it in a host.
 */
export const VIEW_BUNDLE_DEDUPE = [
  "react",
  "react-dom",
  "@tanstack/react-query",
  "@miragon/pulse-ui",
  "@miragon/pulse-widget-shell",
  "lucide-react",
] as const
