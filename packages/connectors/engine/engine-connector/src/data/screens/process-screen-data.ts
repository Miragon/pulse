/**
 * The web app's process screen over the engine a call resolved, in any dialect: a process, a key in
 * one tenant (where the request names none, the one engine-core's `ProcessTenants` names on every
 * surface: the key's process without a tenant, else its first tenant by id, which the answer
 * names), in one version (the one its number names among that tenant's, else the latest) with
 * every version and its counts, the
 * badges on the version's diagram, its call targets and the notice that older versions still run,
 * by the screens' builder (`ProcessScreen` of @miragon/pulse-screens/builder) over the engine
 * contract's runtime of the engine (`runtimeOf`), the diagram through the one XML cache
 * (`diagramXmlOf`), serialized by `ScreenJson`: the same JSON the editors' adapters build from the
 * same answers (D2). The versions are primary: their failure is the read's, and a process the
 * engine has no version of is a refusal no retry changes (`UNKNOWN_PROCESS`). The diagram, the
 * element statistics and the called processes are the builder's enrichments, each named in
 * `unread` where its read failed, never a 0. Its element statistics load the engine's database, so
 * the screen stands on the floor of 30 s per caller and arguments (`screen-floor.ts`); a screen an
 * enrichment is missing from is not kept, so a Refresh reads it again. Beside the screen: the
 * selected version in the engine's own web app where the provider's routes know it.
 */

import {
  BpmnProcessId,
  ProcessTenants,
  TenantId,
  type ProcessRuntime,
  type TenantVersions,
} from "@miragon/pulse-engine-core"
import type { ProcessScreenData } from "@miragon/pulse-screens"
import { ProcessScreen, type ProcessScreenReads, ScreenJson } from "@miragon/pulse-screens/builder"
import { buildProcessCockpitUrl } from "../../lib/engine/cockpit-url.js"
import { diagramXmlOf } from "../../lib/engine/diagram-xml.js"
import { runtimeOf } from "../../lib/engine/engine-runtime.js"
import type { RuntimeEngine } from "../../lib/engine/resolve-engine.js"
import { screenFloor } from "./screen-floor.js"

/** A version in the engine's own web app: its address and its vendor's name, which the link names. */
interface ProcessWebAppData {
  readonly url: string
  readonly vendor: string
}

/** The process screen's feed: the screen's JSON form and its version in the engine's web app. */
export interface ProcessScreenFeedData extends ProcessScreenData {
  readonly webApp: ProcessWebAppData | null
}

/**
 * What the feed takes: the process's BPMN process ID, its tenant (none without it) and the number
 * of the version to show.
 */
export interface ProcessScreenRequestData {
  readonly process: string
  readonly tenantId?: string | undefined
  readonly version?: number | undefined
}

/**
 * The refusal of a process the engine has no version of: no retry changes it, so a page offers no
 * Try again (its code, which the page reads).
 */
class UnknownProcessError extends Error {
  readonly code = "UNKNOWN_PROCESS" as const

  constructor(process: string, tenantId: string | undefined, engineId: string) {
    const tenant = tenantId === undefined ? "" : ` in tenant "${tenantId}"`
    super(`Process "${process}" has no version${tenant} on engine "${engineId}".`)
    this.name = "UnknownProcessError"
  }
}

/**
 * The process `request` names on `runtime` with its versions: its tenant's, else the one the key
 * names without a tenant (`ProcessTenants.versionsOf`, the key's process without a tenant where it
 * has a version without one, so a process without a tenant reads as it did).
 */
async function processOf(
  runtime: ProcessRuntime,
  { process, tenantId }: ProcessScreenRequestData,
): Promise<TenantVersions> {
  const bpmnProcessId = BpmnProcessId(process)
  if (tenantId === undefined) return ProcessTenants.versionsOf(runtime, bpmnProcessId)
  const tenant = TenantId(tenantId)
  return { tenantId: tenant, versions: await runtime.listVersions(bpmnProcessId, tenant) }
}

/**
 * The reads the builder takes of `engine`: the versions of the process already read, its runtime's
 * other reads, the diagram through the one XML cache (per engine and caller), none where the
 * engine has none.
 */
function readsOf(
  engine: RuntimeEngine,
  runtime: ProcessRuntime,
  { versions }: TenantVersions,
): ProcessScreenReads {
  return {
    listVersions: () => Promise.resolve(versions),
    getElementStatistics: (id) => runtime.getElementStatistics(id),
    getCalledProcesses: (version) => runtime.getCalledProcesses(version),
    getDiagramXml: async (id) => (await diagramXmlOf(engine, id)) ?? undefined,
  }
}

/** The selected version in the engine's web app: a Camunda 7 engine's by its provider's route, else none. */
function webAppOf(engine: RuntimeEngine, screen: ProcessScreenData): ProcessWebAppData | null {
  const { selected } = screen
  if (!("client" in engine) || selected === null) return null
  const url = buildProcessCockpitUrl(engine, {
    key: selected.bpmnProcessId,
    version: selected.version,
    definitionId: selected.id,
  })
  return url === null ? null : { url, vendor: engine.provider.branding.displayName }
}

/** The process screen of `request` on `engine`, read at `now`. */
async function readProcessScreen(
  engine: RuntimeEngine,
  request: ProcessScreenRequestData,
  now: () => Date,
): Promise<ProcessScreenFeedData> {
  const { process, tenantId, version } = request
  const runtime = runtimeOf(engine)
  const named = await processOf(runtime, request)
  const model = await ProcessScreen.read(
    engine.engineId,
    {
      bpmnProcessId: BpmnProcessId(process),
      tenantId: named.tenantId,
      ...(version === undefined ? {} : { version }),
    },
    readsOf(engine, runtime, named),
    now,
  )
  if (model === undefined) throw new UnknownProcessError(process, tenantId, engine.engineId)
  const screen = ScreenJson.process(model)
  return { ...screen, webApp: webAppOf(engine, screen) }
}

/** The floor of the process screen: a screen with every enrichment read stays for it. */
const processFloor = screenFloor<ProcessScreenFeedData>(({ unread }) => unread.length === 0)

/** The process screen of `request` on `engine`: one read in the floor's 30 s, else read at `now`. */
export function buildProcessScreenData(
  engine: RuntimeEngine,
  request: ProcessScreenRequestData,
  now: () => Date = () => new Date(),
): Promise<ProcessScreenFeedData> {
  const args = {
    process: request.process,
    tenantId: request.tenantId ?? null,
    version: request.version ?? null,
  }
  return processFloor(engine, args, () => readProcessScreen(engine, request, now))
}
