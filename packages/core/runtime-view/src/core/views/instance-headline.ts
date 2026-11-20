import type { HeadlineData } from "@miragon/pulse-screens"
import type { IncidentRow, Notice } from "../protocol/index.js"
import { Labels } from "./labels.js"

export class InstanceHeadline {
  static of(headline: HeadlineData | null, rows: readonly IncidentRow[]): Notice | undefined {
    switch (headline?.code) {
      case "incidents":
        return InstanceHeadline.incidents(headline.count, headline.suspended, rows)
      case "incident":
      case "incidentInCalledInstance":
        return headline.suspended ? InstanceHeadline.state("Suspended") : undefined
      case "suspended":
        return InstanceHeadline.state("Suspended")
      case "ended":
        return InstanceHeadline.state(Labels.instanceState(headline.state))
      case undefined:
        return undefined
    }
  }

  private static incidents(
    count: number,
    suspended: boolean,
    rows: readonly IncidentRow[],
  ): Notice {
    const [first] = rows
    return {
      tone: "danger",
      title: `${Labels.plural(count, "incident")}${suspended ? " · suspended" : ""}`,
      ...(first === undefined ? {} : { detail: first.rootCause ?? first.message }),
      actions: [],
    }
  }

  private static state(label: string): Notice {
    return { tone: "info", title: `This instance is ${label.toLowerCase()}.`, actions: [] }
  }
}
