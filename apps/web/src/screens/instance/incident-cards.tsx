import { useEffect, useRef, useState } from "react"
import {
  IncidentCard,
  IncidentText,
  type IncidentTextRead,
  type InstanceSlots,
} from "@miragon/pulse-blocks"
import type { IncidentCardData, IncidentTextKind } from "@miragon/pulse-screens"
import { Button, Icon, useLocale, useUiMessages } from "@miragon/pulse-ui"
import {
  describeError,
  isPermanentError,
  isSessionEnded,
  useErrorWords,
  useToolQuery,
} from "@miragon/pulse-widget-shell/widgets"
import { ArrowRight } from "lucide-react"
import { useT } from "../../messages/index.js"
import { PageLink, type Navigate } from "../../router/page-link.js"
import { screenUrlOf, urlOf } from "../../router/routes.js"
import {
  INCIDENT_TEXT_FEED,
  incidentTextKey,
  isUnknownIncident,
  type IncidentCause,
  type IncidentTextFeed,
} from "./instance-feed.js"

/**
 * Which text a card's incident has: the one its detail read, else a stack trace where the incident
 * has a job (on Camunda 7 every root incident after the first ten is read without its text), else
 * none.
 */
function textKindOf(card: IncidentCardData): IncidentTextKind | null {
  return card.text ?? (card.job === undefined ? null : "stacktrace")
}

/**
 * The words of a text's read that no retry changes, or none for a failure a retry may change: an
 * ended session only that the text is missing (the page's frame says the rest, once), an incident
 * the engine has no text of (resolved since the screen read it, say) what happened and what to do,
 * another refusal of the kit in the kit's words.
 */
function useTextRefusal(): (error: Error) => string | undefined {
  const t = useT()
  const locale = useLocale()
  const words = useErrorWords()
  const { common } = useUiMessages()
  return (error) => {
    if (isSessionEnded(error)) return common.loadFailed
    if (isUnknownIncident(error)) return t("incident.textGone")
    if (!isPermanentError(error)) return undefined
    const described = describeError(error, locale, words)
    return `${described.title}. ${described.hint}`
  }
}

/** The read of a text, as the block takes it, from the page's query of it. */
function readOf(
  asked: boolean,
  query: { data: IncidentTextFeed | undefined; error: Error | null },
  refusalOf: (error: Error) => string | undefined,
): IncidentTextRead | undefined {
  if (!asked) return undefined
  const { data, error } = query
  if (data !== undefined) {
    return {
      status: "read",
      text: data.text,
      truncated: data.truncated,
      ...(data.rootCauseLine === null ? {} : { rootCauseLine: data.rootCauseLine }),
    }
  }
  if (error === null) return { status: "reading" }
  const reason = refusalOf(error)
  return reason === undefined ? { status: "failed" } : { status: "refused", reason }
}

/**
 * A root incident's text in place (the blocks' `IncidentText`), read only when it first shows open,
 * through the text feed, once; a failed read reads again on the reader's retry, never by itself,
 * and a refusal no retry changes says why with no retry.
 */
function CardText({
  engine,
  incidentId,
  kind,
  open,
  slots,
}: {
  readonly engine: string
  readonly incidentId: string
  readonly kind: IncidentTextKind
  readonly open: boolean
  readonly slots: Pick<InstanceSlots, "onCopy">
}) {
  const [asked, setAsked] = useState(false)
  const refusalOf = useTextRefusal()
  const query = useToolQuery<IncidentTextFeed>(
    incidentTextKey(engine, incidentId),
    INCIDENT_TEXT_FEED,
    { engine, incident: incidentId },
    { enabled: asked, retry: false, staleTime: Infinity },
  )
  return (
    <IncidentText
      kind={kind}
      defaultOpen={open}
      read={readOf(asked, query, refusalOf)}
      onRead={() => {
        if (asked) void query.refetch()
        else setAsked(true)
      }}
      slots={slots}
    />
  )
}

/** A card's way on: the incident in focus at its own address, or every incident with its cause. */
function CardAction({
  href,
  label,
  navigate,
}: {
  readonly href: string
  readonly label: string
  readonly navigate: Navigate
}) {
  return (
    <Button asChild variant="outline">
      <PageLink href={href} navigate={navigate}>
        {label}
        <Icon icon={ArrowRight} />
      </PageLink>
    </Button>
  )
}

export interface IncidentCardsProps {
  readonly engine: string
  readonly incidents: readonly IncidentCardData[]
  /** Each card's cause as the cockpit's cause view takes it (Camunda 7); null elsewhere. */
  readonly causes: readonly IncidentCause[] | null
  /** The root incident in focus, by its id: its card open and in sight. */
  readonly focus?: string
  readonly nameOf: (elementId: string) => string
  readonly navigate: Navigate
  readonly slots: InstanceSlots
}

/**
 * An instance's root incidents as the blocks' cards, its own and those of the instances it called
 * ("Located in"), never a copy at a call activity. Each card's text reads only when it opens; a card
 * leads to its incident in focus, at the address under the instance that holds it. The card in focus
 * opens its text from the start and scrolls into sight, and on Camunda 7 leads to every incident with
 * its cause (the cockpit's cause view). No card offers a write: the page writes nothing.
 */
export function IncidentCards(props: IncidentCardsProps) {
  const { engine, incidents, causes, focus, nameOf, navigate, slots } = props
  const t = useT()
  const focused = useRef<HTMLDivElement>(null)
  useEffect(() => {
    // After the frame's move of focus to the page's heading, which runs in the same commit where
    // the screen shows from the cache and would scroll the page back up to the heading.
    const frame = requestAnimationFrame(() => {
      focused.current?.scrollIntoView?.({ block: "nearest" })
    })
    return () => {
      cancelAnimationFrame(frame)
    }
  }, [focus])
  return (
    <ul className="flex flex-col gap-3" aria-label={t("tab.incidents")}>
      {incidents.map((card) => {
        const { id, instanceId } = card.rootIncident
        const inFocus = id === focus
        const kind = textKindOf(card)
        const cause = causes?.find(({ incidentId }) => incidentId === id)
        const own = screenUrlOf({ kind: "instance", engine, instance: instanceId, incident: id })
        const action = inFocus ? (
          cause && (
            <CardAction
              href={urlOf({
                view: "cluster-detail",
                engine,
                activityId: cause.activityId,
                incidentType: cause.incidentType,
                messageSignature: cause.signature,
              })}
              label={t("incident.sameCause")}
              navigate={navigate}
            />
          )
        ) : (
          <CardAction href={own} label={t("incident.open")} navigate={navigate} />
        )
        return (
          <li key={id}>
            <div ref={inFocus ? focused : undefined} data-focus={inFocus || undefined}>
              <IncidentCard
                engine={engine}
                card={card}
                elementName={nameOf(card.elementId)}
                detail={
                  kind !== null && (
                    <CardText
                      engine={engine}
                      incidentId={id}
                      kind={kind}
                      open={inFocus}
                      slots={slots}
                    />
                  )
                }
                actions={action}
                slots={slots}
              />
            </div>
          </li>
        )
      })}
    </ul>
  )
}
