/**
 * The web app's instance screen over the engine a call resolved, in any dialect: an instance's
 * head, head strip, markers, call links, root incident cards, waits, path and variables by the
 * screens' builder (`InstanceScreen` of @miragon/pulse-screens/builder) over the engine contract's
 * runtime of the engine (`runtimeOf`), its diagram through the one XML cache (`diagramXmlOf`),
 * serialized by `ScreenJson`: the same JSON the editors' adapters build from the same answers (D2).
 * The instance's detail is primary: its failure is the read's, and an instance the engine does not
 * know is a refusal no retry changes (`UNKNOWN_INSTANCE`). The diagram, the processes it calls and
 * its caller are the builder's enrichments, each named in `unread` where its read failed. Beside
 * the screen: the instance in the engine's own web app where the provider's routes know it, and on
 * Camunda 7 each card's cause as the cockpit's cause view takes it, null on a dialect the cause view
 * does not read: c7-core reads it with the detail (`getInstanceDetailWithCauses`, `causeKeyOf` over
 * the incident as the engine names it), since a card names a multi-instance body's incident by the
 * activity it repeats and the cause view reads the body's own id.
 */

import type { IncidentCauseKey } from "@miragon/pulse-c7-core"
import { IncidentId, type InstanceDetail, InstanceId } from "@miragon/pulse-engine-core"
import type { IncidentCardData, InstanceScreenData } from "@miragon/pulse-screens"
import {
  InstanceScreen,
  type InstanceScreenReads,
  ScreenJson,
} from "@miragon/pulse-screens/builder"
import { buildInstanceCockpitUrl } from "../../lib/engine/cockpit-url.js"
import { diagramXmlOf } from "../../lib/engine/diagram-xml.js"
import { c7RuntimeOf, runtimeOf } from "../../lib/engine/engine-runtime.js"
import type { RuntimeEngine } from "../../lib/engine/resolve-engine.js"

/** An instance in the engine's own web app: its address and its vendor's name, which the link names. */
interface InstanceWebAppData {
  readonly url: string
  readonly vendor: string
}

/**
 * A root incident's cause as the cockpit's cause view (`cluster-detail`) takes it: the element, the
 * incident type and the message's signature, by c7-core's one rule (`causeKeyOf`).
 */
interface IncidentCauseData {
  readonly incidentId: string
  readonly activityId: string
  readonly incidentType: string
  readonly signature: string
}

/**
 * The instance screen's feed: the screen's JSON form, the instance in the engine's web app (null
 * without one) and each card's cause on Camunda 7 (null on another dialect).
 */
export interface InstanceScreenFeedData extends InstanceScreenData {
  readonly webApp: InstanceWebAppData | null
  readonly causes: readonly IncidentCauseData[] | null
}

/**
 * The refusal of an instance the engine does not know, running or ended: no retry changes it, so a
 * page offers no Try again (its code, which the page reads).
 */
class UnknownInstanceError extends Error {
  readonly code = "UNKNOWN_INSTANCE" as const

  constructor(instanceId: string, engineId: string) {
    super(`Instance "${instanceId}" is not on engine "${engineId}", neither running nor ended.`)
    this.name = "UnknownInstanceError"
  }
}

/** The instance's detail and, on Camunda 7, the cause of each root incident; null elsewhere. */
interface DetailRead {
  readonly detail: InstanceDetail | undefined
  readonly causes: ReadonlyMap<IncidentId, IncidentCauseKey> | null
}

/** The detail of `instanceId` on `engine`, on Camunda 7 with its root incidents' causes. */
async function detailOf(engine: RuntimeEngine, instanceId: InstanceId): Promise<DetailRead> {
  if (!("client" in engine)) {
    return { detail: await runtimeOf(engine).getInstanceDetail(instanceId), causes: null }
  }
  const read = await c7RuntimeOf(engine.client).getInstanceDetailWithCauses(instanceId)
  return { detail: read?.detail, causes: read?.causes ?? new Map() }
}

/**
 * The reads the builder takes of `engine`: the instance's `detail` as read, its runtime's, the
 * diagram through the one XML cache (per engine and caller), none where the engine has none.
 */
function readsOf(engine: RuntimeEngine, detail: InstanceDetail | undefined): InstanceScreenReads {
  const runtime = runtimeOf(engine)
  return {
    getInstanceDetail: () => Promise.resolve(detail),
    getCalledProcesses: (id) => runtime.getCalledProcesses(id),
    searchInstances: (filter, page) => runtime.searchInstances(filter, page),
    getDiagramXml: async (id) => (await diagramXmlOf(engine, id)) ?? undefined,
  }
}

/** The instance in the engine's web app: a Camunda 7 engine's by its provider's route, else none. */
function webAppOf(engine: RuntimeEngine, screen: InstanceScreenData): InstanceWebAppData | null {
  if (!("client" in engine)) return null
  const { id, definition } = screen.instance
  const url = buildInstanceCockpitUrl(engine, {
    key: definition.bpmnProcessId,
    version: definition.version,
    definitionId: definition.id,
    instanceId: id,
  })
  return url === null ? null : { url, vendor: engine.provider.branding.displayName }
}

/** Each card's cause on a Camunda 7 engine, whose cockpit's cause view takes it; else null. */
function causesOf(
  causes: DetailRead["causes"],
  incidents: readonly IncidentCardData[],
): IncidentCauseData[] | null {
  if (causes === null) return null
  return incidents.flatMap(({ rootIncident }) => {
    const cause = causes.get(IncidentId(rootIncident.id))
    if (cause === undefined) return []
    const { activityId, incidentType, signature } = cause
    return [{ incidentId: rootIncident.id, activityId, incidentType, signature }]
  })
}

/** The instance screen of `instanceId` on `engine`, read at `now`. */
export async function buildInstanceScreenData(
  engine: RuntimeEngine,
  instanceId: string,
  now: () => Date = () => new Date(),
): Promise<InstanceScreenFeedData> {
  // When the reads began, the detail's first: the screen's "As of".
  const asOf = now()
  const id = InstanceId(instanceId)
  const read = await detailOf(engine, id)
  const model = await InstanceScreen.read(
    engine.engineId,
    id,
    readsOf(engine, read.detail),
    () => asOf,
  )
  if (model === undefined) throw new UnknownInstanceError(instanceId, engine.engineId)
  const screen = ScreenJson.instance(model)
  return {
    ...screen,
    webApp: webAppOf(engine, screen),
    causes: causesOf(read.causes, screen.incidents),
  }
}
