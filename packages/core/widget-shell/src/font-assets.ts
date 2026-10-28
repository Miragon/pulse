/**
 * Geist woff2 served by THIS server: no CDN (self-hosted, GDPR-safe) and no ~50 KB base64 per view.
 * Views load cross-origin from the host's sandbox, so the response allows any origin and the view
 * CSP admits the server origin. If a host blocks it, `font-display: swap` keeps the host's font.
 */
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import type { AppResourceCsp } from "@miragon/mcp-toolkit-core"
import type { HttpRouteHost } from "./health.js"
import { SERVED_FONT_FILES, SERVED_FONT_PATH } from "./served-fonts.js"

export interface FontAsset {
  file: string
  body: Uint8Array<ArrayBuffer>
}

/** Never revalidated: a new font release is a new URL. */
export const FONT_CACHE_CONTROL = "public, max-age=31536000, immutable"

const require = createRequire(import.meta.url)

/** Literal `require.resolve` specifiers keep the dependency visible to the dead-code check. */
export function servedFontPaths(): Record<string, string> {
  return {
    [SERVED_FONT_FILES.sans]:
      require.resolve("@fontsource-variable/geist/files/geist-latin-wght-normal.woff2"),
    [SERVED_FONT_FILES.mono]:
      require.resolve("@fontsource-variable/geist-mono/files/geist-mono-latin-wght-normal.woff2"),
  }
}

export function loadServedFonts(
  paths: () => Record<string, string> = servedFontPaths,
): FontAsset[] {
  return Object.entries(paths()).map(([file, path]) => ({ file, body: readFileSync(path) }))
}

/** A fresh `Response` per request: a body is read once. */
export function fontResponse(body: Uint8Array<ArrayBuffer>): Response {
  return new Response(body, {
    headers: {
      "content-type": "font/woff2",
      "content-length": String(body.byteLength),
      "cache-control": FONT_CACHE_CONTROL,
      // CORS from the view's sandboxed (often `null`) origin; public files, no credentials.
      "access-control-allow-origin": "*",
      "cross-origin-resource-policy": "cross-origin",
      "x-content-type-options": "nosniff",
    },
  })
}

export interface FontAssetsOptions {
  path?: string
  load?: () => FontAsset[]
  label?: string
}

/** Unreadable files only warn: Geist is cosmetic, never a reason to refuse service. */
export function installFontAssets(
  server: HttpRouteHost,
  options: FontAssetsOptions = {},
): string[] {
  const { path = SERVED_FONT_PATH, load = loadServedFonts, label = "fonts" } = options
  let assets: FontAsset[]
  try {
    assets = load()
  } catch (error) {
    console.warn(`[${label}] Geist is not served (views use the host's font):`, error)
    return []
  }
  return assets.map(({ file, body }) => {
    const route = `${path}/${file}`
    server.get(route, () => fontResponse(body))
    return route
  })
}

/**
 * `undefined` without `MCP_URL` (local dev): mcp-use still appends the request-resolved origin on
 * every `resources/read`. Call it after `resolveHttpEdgePolicy` validated `MCP_URL`.
 */
export function fontAssetsCsp(env: NodeJS.ProcessEnv): AppResourceCsp | undefined {
  const url = env.MCP_URL?.trim()
  return url ? { resourceDomains: [new URL(url).origin] } : undefined
}
