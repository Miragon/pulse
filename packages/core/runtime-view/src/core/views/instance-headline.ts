import type { HeadlineData } from "@miragon/pulse-screens"
import type { IncidentRow, InstanceHead, Notice } from "../protocol/index.js"
import { Labels } from "./labels.js"

export class InstanceHeadline {
  static headOf(headline: HeadlineData | null): InstanceHead | undefined {
    switch (headline?.code) {
      case "incidents":
      case "incidentsAtLeast":
        return { code: headline.code, count: headline.count, suspended: headline.suspended }
      case "incident":
      case "incidentInCalledInstance":
        return headline.suspended ? { code: "suspended" } : undefined
      case "suspended":
        return { code: "suspended" }
      case "ended":
        return { code: "ended", state: headline.state }
      case undefined:
        return undefined
    }
  }

  static of(headline: HeadlineData | null, rows: readonly IncidentRow[]): Notice | undefined {
    const head = InstanceHeadline.headOf(headline)
    switch (head?.code) {
      case "incidents":
      case "incidentsAtLeast":
        return InstanceHeadline.incidents(head, rows)
      case "suspended":
        return InstanceHeadline.state("Suspended")
      case "ended":
        return InstanceHeadline.state(Labels.instanceState(head.state))
      case undefined:
        return undefined
    }
  }

  private static incidents(
    { code, count, suspended }: Extract<InstanceHead, { readonly count: number }>,
    rows: readonly IncidentRow[],
  ): Notice {
    const [first] = rows
    const bound = code === "incidentsAtLeast" ? { atLeast: count } : count
    const counted = Labels.plural(bound, "incident")
    return {
      tone: "danger",
      title: `${counted}${suspended ? " · suspended" : ""}`,
      ...(first === undefined ? {} : { detail: first.rootCause ?? first.message }),
      actions: [],
    }
  }

  private static state(label: string): Notice {
    return { tone: "info", title: `This instance is ${label.toLowerCase()}.`, actions: [] }
  }
}
