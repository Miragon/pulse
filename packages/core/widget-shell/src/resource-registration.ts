/**
 * The resources a module registers itself, a finished HTML view above all: what the boot records
 * of each and the rules it holds at registration. `ui://views/` stays the boot's, so no module can
 * replace a view from the bundle; everything else about the resource (its CSP, its document)
 * stays the module's, passed through as registered.
 */
import {
  ResourceTemplate,
  type CompleteResourceTemplateCallback,
  type ListResourcesCallback,
  type McpServer,
  type ReadResourceCallback,
  type ReadResourceTemplateCallback,
} from "@modelcontextprotocol/server"
import { guardedCallback, holdsArray } from "./module-callbacks.js"
import { VIEW_RESOURCE_URI_PREFIX } from "./widget-tool-bindings.js"

/** What `registerResource` takes as its config, the same in both of the SDK's overloads. */
export type ResourceConfig = Parameters<McpServer["registerResource"]>[2]

export interface RecordedResourceBase {
  name: string
  /** The plugin that registered it. */
  owner: string
  /** The resource's URI, or a template's URI template. */
  uri: string
  config: ResourceConfig
}

/** One registration, as the SDK takes it again: a URI with its callback, or a template with its. */
export type RecordedResource = RecordedResourceBase &
  (
    | { template?: undefined; callback: ReadResourceCallback }
    | { template: ResourceTemplate; callback: ReadResourceTemplateCallback }
  )

interface ResourceTarget {
  uri: string
  template?: ResourceTemplate
}

const isTemplate = (value: unknown): value is ResourceTemplate =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as { uriTemplate?: { match?: unknown } }).uriTemplate?.match === "function"

/**
 * `resources/read` looks a URI up in its normal form (`new URL(uri).href`) and `resources/list`
 * names it as registered, so one in any other form lists fine and reads never;
 * `UI://views/x.html` would also slip past the reserved prefix in it. `stated` is what the message
 * names when `uri` stands in for it (a template with its variables filled).
 */
function refuseAbnormalUri(name: string, owner: string, uri: string, stated = uri): void {
  let normal: string | undefined
  try {
    normal = new URL(uri).href
  } catch {
    normal = undefined
  }
  if (normal === uri) return
  throw new Error(
    `Resource "${name}" of "${owner}" registers ${JSON.stringify(stated)}, which no read would find: ` +
      (normal === undefined
        ? "that is no URI. Name a URI of your own, like "
        : `a read looks it up as ${JSON.stringify(normal)}. Write that, or a URI of your own like `) +
      `ui://${owner}/<view>.html.`,
  )
}

/**
 * What a template must spell out so that no variable reaches `ui://views/`: its scheme, in the
 * lower case a read looks it up in, and in a `ui:` template its host (`ui://{+rest}` and
 * `ui://{host}/board.html` would answer under the boot's prefix).
 */
const OWN_SPACE = /^(?!ui:)[a-z][a-z\d+.-]*:|^ui:\/\/[^/{}]+\//

function refuseOpenTemplate(name: string, owner: string, template: string): void {
  if (!OWN_SPACE.test(template)) {
    throw new Error(
      `Resource "${name}" of "${owner}" registers the template ${JSON.stringify(template)}, which ` +
        `could answer under ${VIEW_RESOURCE_URI_PREFIX}, the boot's. Spell out its scheme in lower ` +
        `case, and the host of a ui: template, like ui://${owner}/{view}.html.`,
    )
  }
  refuseAbnormalUri(name, owner, template.replace(/\{[^}]*\}/g, "x"), template)
}

/**
 * The URI or template a registration names, once it holds the rules: a URI in its normal form,
 * and nothing under `ui://views/`, the boot's views from the bundle.
 */
export function resourceTargetOf(name: string, owner: string, target: unknown): ResourceTarget {
  if (typeof target === "string") refuseAbnormalUri(name, owner, target)
  else if (!isTemplate(target)) {
    throw new TypeError(
      `Resource "${name}" of "${owner}" takes neither a URI string nor a ResourceTemplate.`,
    )
  }
  const uri = typeof target === "string" ? target : target.uriTemplate.toString()
  if (uri.startsWith(VIEW_RESOURCE_URI_PREFIX)) {
    throw new Error(
      `Resource "${name}" of "${owner}" registers ${uri}, but ${VIEW_RESOURCE_URI_PREFIX} is the ` +
        "boot's: it serves those views from the bundle, and no module may replace one. Use a URI " +
        `of your own, like ui://${owner}/<view>.html.`,
    )
  }
  if (typeof target === "string") return { uri }
  refuseOpenTemplate(name, owner, uri)
  return { uri, template: target }
}

/** How long `resources/list` waits for a template's `list`, which it runs for every module. */
export const LIST_TIMEOUT_MS = 5000

const TIMED_OUT = Symbol("timed out")

/**
 * The SDK calls every template's `list` inside one `resources/list`, so one that throws or hangs
 * would take the listing of every module down. Here it only loses its own entries, and the log says
 * why. What it names under `ui://views/` stays out too: a read there answers the boot's view.
 */
function guardedList(subject: string, list: ListResourcesCallback): ListResourcesCallback {
  return async (ctx) => {
    let timer: NodeJS.Timeout | undefined
    const expired = new Promise<typeof TIMED_OUT>((resolve) => {
      timer = setTimeout(() => resolve(TIMED_OUT), LIST_TIMEOUT_MS)
    })
    try {
      const listed = await Promise.race([list(ctx), expired])
      if (listed === TIMED_OUT) {
        console.error(
          `${subject}: resources/list goes without its entries, its list callback gave no answer within ${LIST_TIMEOUT_MS} ms.`,
        )
        return { resources: [] }
      }
      const resources = listed.resources.filter(
        ({ uri }) => !uri.startsWith(VIEW_RESOURCE_URI_PREFIX),
      )
      if (resources.length < listed.resources.length) {
        console.warn(`${subject}: its list callback names ${VIEW_RESOURCE_URI_PREFIX}, the boot's.`)
      }
      return { ...listed, resources }
    } catch (thrown) {
      console.error(
        `${subject}: resources/list goes without its entries, its list callback failed:`,
        thrown,
      )
      return { resources: [] }
    } finally {
      clearTimeout(timer)
    }
  }
}

/** The same template with what the SDK calls of it guarded; the template itself is the module's. */
function guardedTemplate(subject: string, template: ResourceTemplate): ResourceTemplate {
  const { uriTemplate, listCallback } = template
  const complete: Record<string, CompleteResourceTemplateCallback> = {}
  for (const variable of uriTemplate.variableNames) {
    const callback = template.completeCallback(variable)
    if (callback) complete[variable] = guardedCallback(subject, callback)
  }
  return new ResourceTemplate(uriTemplate, {
    list: listCallback && guardedList(subject, listCallback),
    complete,
  })
}

/** What the boot records of a registration: as registered, with its callbacks guarded. */
export function recordedResource(
  base: RecordedResourceBase,
  template: ResourceTemplate | undefined,
  callback: unknown,
): RecordedResource {
  const subject = `Resource "${base.name}" of "${base.owner}"`
  const read = guardedCallback(
    subject,
    callback as (...args: unknown[]) => unknown,
    holdsArray("contents"),
  )
  return template
    ? {
        ...base,
        template: guardedTemplate(subject, template),
        callback: read as ReadResourceTemplateCallback,
      }
    : { ...base, callback: read as ReadResourceCallback }
}

/** Whether a read of `uri` reaches one of `resources`: its own URI, or a template that matches. */
export function servesUri(resources: readonly RecordedResource[], uri: string): boolean {
  return resources.some(({ uri: own, template }) =>
    template ? template.uriTemplate.match(uri) !== null : own === uri,
  )
}

/** As recorded, into a request's `McpServer`. */
export function replayResource(server: McpServer, resource: RecordedResource): void {
  const { name, uri, config } = resource
  if (resource.template) {
    server.registerResource(name, resource.template, config, resource.callback)
  } else {
    server.registerResource(name, uri, config, resource.callback)
  }
}
