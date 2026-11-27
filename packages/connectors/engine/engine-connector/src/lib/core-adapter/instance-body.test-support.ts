/**
 * The instance screens of the multi-instance case in contract-cases.test-support.ts (#689): the
 * web app's (`buildInstanceScreenData`, whose builder the editors' webview runs over the same
 * detail of c7-core) and the chat's instance view (`buildInstanceDetailData`), of the instance
 * whose body failed and of the one whose items wait. Camunda 7 names the body's token, its job and
 * its incident `<id>#multiInstanceBody`, which no shape of the diagram has: each screen marks and
 * names the body's wait and root incident on the element, the incident card's cause keeps the
 * body's own id, which the cockpit's cause view reads, the chat's incident row keeps it too and is
 * named by the element, and the path keeps the body's run under its own id beside its items' runs.
 * The chat's facts for the model count the body's own token on the element, never a body that runs
 * its items beside them, and name its incident by the element and by the body's own id, which the
 * engine's incident filter takes.
 */

import { expect } from "vitest"
import { buildInstanceDetailData } from "../../data/instance-detail-data.js"
import { buildInstanceScreenData } from "../../data/screens/instance-screen-data.js"
import type { ResolvedEngine } from "../engine/resolve-engine.js"

/**
 * What the case seeded: the element, the instance whose items wait and how many, the body's
 * incident.
 */
interface SeededBody {
  readonly element: string
  readonly items: string
  readonly itemCount: number
  readonly incident: { readonly id: string; readonly processInstanceId: string | null }
}

/** How many of `ids` are `id`. */
const countOf = (ids: readonly string[], id: string) => ids.filter((each) => each === id).length

/** The screens of the instance whose body failed: its wait and its incident on the element. */
async function expectFailedBody(engine: ResolvedEngine, seeded: SeededBody): Promise<void> {
  const { element, incident } = seeded
  const instanceId = incident.processInstanceId ?? ""
  const [screen, chat] = await Promise.all([
    buildInstanceScreenData(engine, instanceId),
    buildInstanceDetailData(engine.client, engine.engineId, { processInstanceId: instanceId }),
  ])
  expect(screen.markers).toContainEqual({ elementId: element, kind: "incident" })
  expect(screen.markers.map((marker) => marker.elementId)).not.toContain(
    `${element}#multiInstanceBody`,
  )
  expect(screen.headline).toMatchObject({
    code: "incident",
    incidentId: incident.id,
    elementId: element,
  })
  expect(screen.waits).toEqual([
    expect.objectContaining({
      elementId: element,
      kind: "asyncContinuation",
      incidentId: incident.id,
      retriesLeft: 0,
    }),
  ])
  expect(screen.incidents.map((card) => card.elementId)).toEqual([element])
  expect(screen.causes).toEqual([
    expect.objectContaining({
      incidentId: incident.id,
      activityId: `${element}#multiInstanceBody`,
      incidentType: "failedJob",
    }),
  ])
  expect(chat.incidentActivityIds).toEqual([element, `${element}#multiInstanceBody`])
  expect(chat.activeActivityIds).not.toContain(`${element}#multiInstanceBody`)
  expect(countOf(chat.activeActivityIds, element)).toBe(1)
  expect(chat.incidents).toEqual([
    expect.objectContaining({
      id: incident.id,
      activityId: `${element}#multiInstanceBody`,
      activityName: "Approve each",
    }),
  ])
}

/** The screens of the instance whose items wait: on the element, the body's run on the path. */
async function expectWaitingItems(engine: ResolvedEngine, seeded: SeededBody): Promise<void> {
  const { element, items, itemCount } = seeded
  const [screen, chat] = await Promise.all([
    buildInstanceScreenData(engine, items),
    buildInstanceDetailData(engine.client, engine.engineId, { processInstanceId: items }),
  ])
  expect(screen.markers).toContainEqual({ elementId: element, kind: "waiting" })
  expect(screen.waits.map((wait) => [wait.elementId, wait.kind])).toEqual([
    [element, "userTask"],
    [element, "userTask"],
    [element, "userTask"],
  ])
  const path = screen.path.map((run) => run.elementId)
  expect([countOf(path, element), countOf(path, `${element}#multiInstanceBody`)]).toEqual([3, 1])
  expect(chat.activeActivityIds).not.toContain(`${element}#multiInstanceBody`)
  expect(countOf(chat.activeActivityIds, element)).toBe(itemCount)
}

/** The screens of both instances: the one whose body failed and the one whose items wait. */
export async function expectInstanceScreensOnElement(
  engine: ResolvedEngine,
  seeded: SeededBody,
): Promise<void> {
  await expectFailedBody(engine, seeded)
  await expectWaitingItems(engine, seeded)
}
