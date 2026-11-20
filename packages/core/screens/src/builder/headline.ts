import type { InstanceSummary } from "@miragon/pulse-engine-core"
import type { HeadlineData } from "../format/instance-screen-data.js"
import type { IncidentCardModel } from "./instance-screen-model.js"
import type { InstanceTree } from "./instance-tree.js"

export class Headline {
  static of(
    instance: InstanceSummary,
    cards: readonly IncidentCardModel[],
    tree: InstanceTree,
  ): HeadlineData | undefined {
    const suspended = instance.state === "suspended"
    const [first, second] = cards
    if (second !== undefined) {
      return { code: "incidents", count: cards.length, suspended }
    }
    if (instance.state === "completed" || instance.state === "terminated") {
      return { code: "ended", state: instance.state }
    }
    if (first !== undefined) {
      return Headline.single(first, tree, suspended)
    }
    return suspended ? { code: "suspended" } : undefined
  }

  private static single(
    { incident, liesIn }: IncidentCardModel,
    tree: InstanceTree,
    suspended: boolean,
  ): HeadlineData {
    const since = incident.createdAt
    if (liesIn === undefined) {
      return {
        code: "incident",
        incidentId: incident.id,
        elementId: incident.elementId,
        since,
        suspended,
      }
    }
    return {
      code: "incidentInCalledInstance",
      incidentId: incident.id,
      elementId: tree.locate(incident.instanceId, incident.elementId) ?? null,
      liesIn,
      since,
      suspended,
    }
  }
}
