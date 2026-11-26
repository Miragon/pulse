import { StatusStrip, formatClock, formatCount, type StatusStripTone } from "@miragon/pulse-ui"
import type { HeadlineData, IncidentCardData } from "@miragon/pulse-screens"
import { useInstanceWords, type InstanceWords } from "../../messages/instance-words.js"

export interface HeadlineStripProps {
  /** The head strip's code, as the screen gives it (`InstanceScreenData.headline`). */
  readonly headline: HeadlineData
  /** The root incidents the instance shows, in their order: a strip of several names the first's cause. */
  readonly incidents: readonly Pick<IncidentCardData, "rootCauseLine" | "message">[]
  /** An element's name, as the surface knows it (the diagram's, else its id). */
  readonly nameOf: (elementId: string) => string
}

interface Strip {
  readonly tone: StatusStripTone
  readonly title: string
  readonly detail?: string
}

function suspendedToo(t: InstanceWords, title: string, suspended: boolean): string {
  return suspended ? t("headline.suspendedToo", { title }) : title
}

function stripOf(t: InstanceWords, { headline, incidents, nameOf }: HeadlineStripProps): Strip {
  switch (headline.code) {
    case "incident": {
      const time = formatClock(headline.since, { seconds: false })
      const title = t("headline.incident", { element: nameOf(headline.elementId), time })
      return { tone: "danger", title: suspendedToo(t, title, headline.suspended) }
    }
    case "incidentInCalledInstance": {
      const time = formatClock(headline.since, { seconds: false })
      const title =
        headline.elementId === null
          ? t("headline.incidentInCalledInstanceAnywhere", { time })
          : t("headline.incidentInCalledInstance", { element: nameOf(headline.elementId), time })
      return { tone: "danger", title: suspendedToo(t, title, headline.suspended) }
    }
    case "incidents": {
      const [first] = incidents
      const title = t("headline.incidents", { count: formatCount(headline.count) })
      return {
        tone: "danger",
        title: suspendedToo(t, title, headline.suspended),
        ...(first === undefined ? {} : { detail: first.rootCauseLine ?? first.message }),
      }
    }
    case "suspended":
      return { tone: "info", title: t("headline.suspended") }
    case "ended":
      return {
        tone: "info",
        title: t(headline.state === "completed" ? "headline.completed" : "headline.terminated"),
      }
  }
}

/**
 * The strip under an instance's bar that says where it stands, from the screen's code: it waits
 * at an incident here or in an instance it called (since when, and where), it has several
 * incidents (the first's cause beside them), it is suspended, or it ended. A surface shows the
 * strips it decides to (the editors name one incident on its card alone).
 */
export function HeadlineStrip(props: HeadlineStripProps) {
  const t = useInstanceWords()
  const { tone, title, detail } = stripOf(t, props)
  return <StatusStrip tone={tone} title={title} {...(detail === undefined ? {} : { detail })} />
}
