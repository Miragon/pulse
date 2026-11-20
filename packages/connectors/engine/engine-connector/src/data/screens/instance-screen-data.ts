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
 * Camunda 7 each card's cause as the cockpit's cause view takes it (c7-core's `causeKeyOf`), null
 * on a dialect the cause view does not read.
 */

import { causeKeyOf } from "@miragon/pulse-c7-core"
import { InstanceId } from "@miragon/pulse-engine-core"
import type { IncidentCardData, InstanceScreenData } from "@miragon/pulse-screens"
import {
  InstanceScreen,
  type InstanceScreenReads,
  ScreenJson,
} from "@miragon/pulse-screens/builder"
import { buildInstanceCockpitUrl } from "../../lib/engine/cockpit-url.js"
import { diagramXmlOf } from "../../lib/engine/diagram-xml.js"
import { runtimeOf } from "../../lib/engine/engine-runtime.js"
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

/**
 * The reads the builder takes of `engine`: its runtime's, the diagram through the one XML cache
 * (per engine and caller), none where the engine has none.
 */
function readsOf(engine: RuntimeEngine): InstanceScreenReads {
  const runtime = runtimeOf(engine)
  return {
    getInstanceDetail: (id) => runtime.getInstanceDetail(id),
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
  engine: RuntimeEngine,
  incidents: readonly IncidentCardData[],
): IncidentCauseData[] | null {
  if (!("client" in engine)) return null
  return incidents.map(({ rootIncident, elementId, type, message }) => {
    const cause = causeKeyOf({
      activityId: elementId,
      incidentType: type,
      incidentMessage: message,
    })
    return {
      incidentId: rootIncident.id,
      activityId: cause.activityId,
      incidentType: cause.incidentType,
      signature: cause.signature,
    }
  })
}

/** The instance screen of `instanceId` on `engine`, read at `now`. */
export async function buildInstanceScreenData(
  engine: RuntimeEngine,
  instanceId: string,
  now: () => Date = () => new Date(),
): Promise<InstanceScreenFeedData> {
  const model = await InstanceScreen.read(
    engine.engineId,
    InstanceId(instanceId),
    readsOf(engine),
    now,
  )
  if (model === undefined) throw new UnknownInstanceError(instanceId, engine.engineId)
  const screen = ScreenJson.instance(model)
  return { ...screen, webApp: webAppOf(engine, screen), causes: causesOf(engine, screen.incidents) }
}
