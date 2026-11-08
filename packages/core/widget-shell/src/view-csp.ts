/**
 * A view's CSP in its two wire spellings: SEP-1865's on the resource (`_meta.ui.csp`), the Apps
 * SDK's on the tool (`openai/widgetCSP`), and how the boot adds its server-wide defaults to both.
 */

/** A view's CSP in the SEP-1865 spelling: origins other than the server's own. */
export interface AppResourceCsp {
  connectDomains?: string[]
  resourceDomains?: string[]
  frameDomains?: string[]
  baseUriDomains?: string[]
}

/** The Apps SDK spelling of {@link AppResourceCsp}. */
export interface WidgetCspMeta {
  connect_domains?: string[]
  resource_domains?: string[]
  frame_domains?: string[]
  base_uri_domains?: string[]
}

type Lists = Readonly<Record<string, readonly string[] | undefined>>

export function toWidgetCspMeta(csp: AppResourceCsp): WidgetCspMeta {
  const meta: WidgetCspMeta = {}
  if (csp.connectDomains) meta.connect_domains = csp.connectDomains
  if (csp.resourceDomains) meta.resource_domains = csp.resourceDomains
  if (csp.frameDomains) meta.frame_domains = csp.frameDomains
  if (csp.baseUriDomains) meta.base_uri_domains = csp.baseUriDomains
  return meta
}

/** The SEP-1865 spelling of an Apps SDK `openai/widgetCSP`. */
export function fromWidgetCspMeta(meta: WidgetCspMeta | undefined): AppResourceCsp {
  const csp: AppResourceCsp = {}
  if (meta?.connect_domains) csp.connectDomains = meta.connect_domains
  if (meta?.resource_domains) csp.resourceDomains = meta.resource_domains
  if (meta?.frame_domains) csp.frameDomains = meta.frame_domains
  if (meta?.base_uri_domains) csp.baseUriDomains = meta.base_uri_domains
  return csp
}

/** The tool's own entries come first; each default origin is appended once. */
export function mergeDomainLists<T extends object>(own: T | undefined, defaults: T): T {
  const mine = (own ?? {}) as Lists
  const merged: Record<string, unknown> = { ...mine }
  for (const [key, domains] of Object.entries(defaults as Lists)) {
    if (!domains?.length) continue
    merged[key] = [...new Set([...(mine[key] ?? []), ...domains])]
  }
  return merged as T
}

export const hasDomains = (lists: object | undefined): lists is object =>
  lists !== undefined && Object.values(lists as Lists).some((domains) => (domains?.length ?? 0) > 0)
