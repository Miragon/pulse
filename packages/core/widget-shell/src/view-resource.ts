/**
 * A view's resource on the wire: the document (the bundle inlined), the `_meta.ui` the host builds
 * its CSP from, the Apps SDK fields on the resource, and the `ui` stamps on a view tool's result.
 * The boot registers it per request for every view a tool binds; `ext-apps`' `registerAppResource`
 * gives only the MIME type, the rest has no official helper.
 */
import { viewResourceUri } from "./widget-tool-bindings.js"

const UI_MIME_TYPE = "text/html;profile=mcp-app"
/** The view config the Apps SDK half names; picture-in-picture is no Apps SDK mode. */
const DISPLAY_MODES = ["inline", "fullscreen"]
/** Every view comes from the one bundle, whose cards draw no frame of their own (#344). */
const PREFERS_BORDER = true

/** A view's CSP in the SEP-1865 spelling: origins other than the server's own. */
export interface AppResourceCsp {
  connectDomains?: string[]
  resourceDomains?: string[]
  frameDomains?: string[]
  baseUriDomains?: string[]
}

/** A view the boot serves (keyed by its name), as the tool that binds it states it. */
export interface ViewBinding {
  /** The binding tool's title: the resource's description and `openai/widgetDescription`. */
  description?: string
  csp?: AppResourceCsp
}

export interface ViewBundle {
  kind: "inline"
  js: string
  css: string
}
export type ViewsManifest = Record<string, ViewBundle>

export function viewResultMeta(viewName: string): Record<string, unknown> {
  const resourceUri = viewResourceUri(viewName)
  return { ui: { resourceUri }, "ui/resourceUri": resourceUri }
}

function forwardedOrigin(request: Request): string | undefined {
  const forwarded = request.headers.get("forwarded")
  if (forwarded !== null) {
    for (const part of forwarded.split(",")) {
      const params = new Map(
        part.split(";").map((token) => {
          const [key, ...rest] = token.trim().split("=")
          return [key.toLowerCase(), rest.join("=").replace(/^"|"$/g, "")] as const
        }),
      )
      const [proto, host] = [params.get("proto"), params.get("host")]
      if (proto && host) return `${proto}://${host}`
    }
  }
  const proto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim()
  const host = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim()
  return proto && host ? `${proto}://${host}` : undefined
}

function serverOrigin(request: Request | undefined, env: NodeJS.ProcessEnv): string {
  const url = env.MCP_URL?.trim()
  if (url) return new URL(url).origin
  if (!request) return ""
  return forwardedOrigin(request) ?? new URL(request.url).origin
}

const merged = (own: readonly string[] | undefined, origin: string): string[] => [
  ...new Set([...(own ?? []), ...(origin ? [origin] : [])]),
]

const escapeScript = (code: string) =>
  code.replaceAll(/<\/script/gi, "<\\/script").replaceAll("<!--", "\\x3C!--")
const escapeStyle = (css: string) => css.replaceAll(/<\/style/gi, "<\\/style")

/** A bundle's escaped script and style, once per bundle: every read serves the same megabyte. */
const escapedParts = new WeakMap<ViewBundle, { script: string; style: string }>()

function escaped(bundle: ViewBundle): { script: string; style: string } {
  let parts = escapedParts.get(bundle)
  if (!parts) {
    const { css, js } = bundle
    parts = { script: escapeScript(js), style: css ? `<style>${escapeStyle(css)}</style>` : "" }
    escapedParts.set(bundle, parts)
  }
  return parts
}

/** The served document: `publicBase` is the origin the view loads its fonts from. */
export function viewDocument(bundle: ViewBundle, publicBase: string): string {
  const config = JSON.stringify({ publicBase }).replaceAll("<", "\\u003c")
  const { script, style } = escaped(bundle)
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<script>globalThis.__pulseViewConfig=${config};</script>
<style>html,body,#root{background:transparent}html,body{margin:0}</style>
${style}
</head>
<body>
<div id="root"></div>
<script type="module">${script}</script>
</body>
</html>`
}

export function viewResourceConfig(viewName: string, binding: ViewBinding, env: NodeJS.ProcessEnv) {
  const description = binding.description
  const readMeta = (request: Request | undefined): Record<string, unknown> => {
    const origin = serverOrigin(request, env)
    const csp = {
      ...binding.csp,
      connectDomains: merged(binding.csp?.connectDomains, origin),
      resourceDomains: merged(binding.csp?.resourceDomains, origin),
      frameDomains: merged(binding.csp?.frameDomains, ""),
      baseUriDomains: merged(binding.csp?.baseUriDomains, ""),
    }
    return {
      ui: { csp, prefersBorder: PREFERS_BORDER },
      ...(description !== undefined && { "openai/widgetDescription": description }),
      "openai/ui": { availableDisplayModes: DISPLAY_MODES },
    }
  }
  return {
    uri: viewResourceUri(viewName),
    mimeType: UI_MIME_TYPE,
    config: { mimeType: UI_MIME_TYPE, ...(description !== undefined && { description }) },
    readMeta,
    publicBase: (request: Request | undefined) => {
      const origin = serverOrigin(request, env)
      return origin ? `${origin}/` : ""
    },
  }
}
