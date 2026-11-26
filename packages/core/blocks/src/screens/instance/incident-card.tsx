import {
  CopyableId,
  CountFigure,
  Facts,
  StateLabel,
  formatClock,
  formatCount,
  formatInstant,
  formatRelativeTime,
  type Fact,
} from "@miragon/pulse-ui"
import type { IncidentCardData, RootIncidentData } from "@miragon/pulse-screens"
import type { ReactNode } from "react"
import { useInstanceWords, type InstanceWords } from "../../messages/instance-words.js"
import type { InstanceSlots } from "../slots.js"
import { CalledInstanceLink } from "./called-instance-link.js"

/** What an incident card shows of a root incident (`InstanceScreenData.incidents`). */
export type IncidentCardFields = Pick<
  IncidentCardData,
  | "elementId"
  | "type"
  | "message"
  | "createdAt"
  | "retriesLeft"
  | "job"
  | "rootCauseLine"
  | "causeSource"
  | "liesIn"
> & { readonly rootIncident: Pick<RootIncidentData, "id"> }

export interface IncidentCardProps {
  /** The engine the instance runs on, as the surface names it. */
  readonly engine: string
  readonly card: IncidentCardFields
  /** The name of the element the incident stops, as the surface knows it (else its id). */
  readonly elementName: string
  /**
   * Facts the surface knows of the incident beyond the screen's (the editors' local model: its
   * settings and its file), placed before the incident's id.
   */
  readonly facts?: readonly Fact[]
  /**
   * The incident's text, the surface's way to it: the editors' document, a page's `IncidentText`
   * read in place. It comes first under the facts.
   */
  readonly detail?: ReactNode
  /** The surface's actions on the incident (the editors' model and code, its retry, a write slot). */
  readonly actions?: ReactNode
  readonly slots: Pick<InstanceSlots, "Link" | "onCopy">
}

function copyable(id: string, label: string, onCopy: InstanceSlots["onCopy"]): ReactNode {
  return (
    <CopyableId
      id={id}
      label={label}
      onCopy={(text) => {
        onCopy({ text, label })
      }}
    />
  )
}

function causeFacts(t: InstanceWords, card: IncidentCardFields): Fact[] {
  const { rootCauseLine, causeSource, message } = card
  const cause: Fact[] =
    rootCauseLine === null
      ? []
      : [
          {
            label: t(causeSource === null ? "cause.errorMessage" : `cause.${causeSource}`),
            value: rootCauseLine,
            mono: true,
            emphasis: true,
          },
        ]
  return rootCauseLine?.includes(message) === true
    ? cause
    : [...cause, { label: t("fact.message"), value: message }]
}

function whereFacts(
  t: InstanceWords,
  { engine, card, slots }: Pick<IncidentCardProps, "engine" | "card" | "slots">,
): Fact[] {
  const { liesIn, job, retriesLeft } = card
  return [
    ...(liesIn === null
      ? []
      : [
          {
            label: t("fact.liesIn"),
            value: (
              <CalledInstanceLink
                engine={engine}
                called={liesIn}
                incidentId={card.rootIncident.id}
                Link={slots.Link}
              />
            ),
          },
        ]),
    ...(job === undefined
      ? []
      : [
          {
            label: t("fact.job"),
            value: (
              <>
                {copyable(job.id, t("id.job"), slots.onCopy)}
                {job.type !== undefined && (
                  <span className="text-muted-foreground" title={t("fact.jobType")}>
                    {job.type}
                  </span>
                )}
              </>
            ),
          },
        ]),
    ...(retriesLeft === undefined
      ? []
      : [{ label: t("fact.retriesLeft"), value: retriesFigure(t, retriesLeft) }]),
  ]
}

/** The retries left as a neutral figure; none left alarms, with its tone's icon and words. */
function retriesFigure(t: InstanceWords, retriesLeft: number): ReactNode {
  return retriesLeft === 0 ? (
    <CountFigure situation="jobWithoutRetries" label={t("fact.noRetriesLeft")}>
      {formatCount(retriesLeft)}
    </CountFigure>
  ) : (
    <CountFigure>{formatCount(retriesLeft)}</CountFigure>
  )
}

/**
 * A root incident of an instance's tree as a card: its type at the element it stops and since
 * when, then its facts: the line `RootCauses` names as its root cause (the stack trace's, a
 * worker's error or the engine's message), the message where the cause does not hold it, the
 * called instance it lies in, its job and the retries left (none left with the danger icon and
 * its words, `CountFigure`), the surface's own facts and its id.
 * Under them the surface's way to its text and its actions; a copy at a call activity is never a
 * card.
 */
export function IncidentCard(props: IncidentCardProps) {
  const { card, elementName, facts = [], detail, actions, slots } = props
  const t = useInstanceWords()
  const type = t("incident.type", { type: card.type })
  return (
    <article
      className="border-border bg-card flex flex-col items-start gap-2.5 rounded-md border px-4 py-3"
      data-part="incident-card"
      aria-label={t("incident.label", { type, element: elementName })}
    >
      <header className="flex w-full flex-wrap items-baseline justify-between gap-x-4 gap-y-1 font-semibold">
        <StateLabel state="incident">
          {t("incident.head", { type, element: elementName })}
        </StateLabel>
        <span
          className="text-muted-foreground font-normal tabular-nums"
          title={formatInstant(card.createdAt)}
        >
          {t("incident.since", {
            clock: formatClock(card.createdAt, { seconds: false }),
            relative: formatRelativeTime(card.createdAt),
          })}
        </span>
      </header>
      <Facts
        facts={[
          ...causeFacts(t, card),
          ...whereFacts(t, props),
          ...facts,
          {
            label: t("fact.incident"),
            value: copyable(card.rootIncident.id, t("id.incident"), slots.onCopy),
          },
        ]}
      />
      <div className="flex w-full min-w-0 flex-wrap gap-2">
        {detail}
        {actions}
      </div>
    </article>
  )
}
