import type { ReactNode } from "react"
import {
  StateLabel,
  Td,
  formatClock,
  formatDuration,
  formatInstant,
  SITUATION_TONES,
  type StateLabelState,
  type ToneVariant,
} from "@miragon/pulse-ui"
import { ListTable, type ListTableColumn } from "@miragon/pulse-widget-shell/widgets"
import { useT, type T } from "../messages/use-t.js"

/** Raw `ActivityData` rows satisfy it structurally, so either source renders without mapping. */
export interface HistoryEntry {
  id: string
  activityId: string
  activityName: string | null
  activityType: string
  startTime: string
  endTime: string | null
  durationInMillis: number | null
  assignee?: string | null
  canceled?: boolean
}

/** Colour marks state only (#322 U14): red on every end event read as an error. */
type HistoryStepState = "incident" | "running" | "canceled" | "completed"

function historyStepState(
  entry: Pick<HistoryEntry, "activityId" | "endTime" | "canceled">,
  incidentActivityIds: ReadonlySet<string>,
): HistoryStepState {
  if (entry.canceled) return "canceled"
  if (entry.endTime) return "completed"
  return incidentActivityIds.has(entry.activityId) ? "incident" : "running"
}

/** The kit's state for each step's, whose icon a `StateLabel` draws. */
const STEP_STATE: Record<HistoryStepState, StateLabelState> = {
  incident: "incident",
  running: "running",
  canceled: "cancelled",
  completed: "completed",
}

/** The step's state as the kit's state label: its tone's icon of its own shape and its word. */
function StepState({ state }: { state: HistoryStepState }) {
  const t = useT()
  // Under 28rem its icon alone, its word read out and in its title.
  return (
    <StateLabel state={STEP_STATE[state]} iconOnlyBelow="md">
      {t(`historyTimeline.step.${state}`)}
    </StateLabel>
  )
}

/** A historic instance's engine state in words ("ACTIVE" → "läuft"); unknown ones verbatim. */
export function instanceStateLabel(t: T, state: string): { label: string; tone: ToneVariant } {
  switch (state) {
    case "ACTIVE":
      return { label: t("historyTimeline.state.active"), tone: SITUATION_TONES.running }
    case "SUSPENDED":
      return { label: t("historyTimeline.state.suspended"), tone: SITUATION_TONES.suspended }
    case "COMPLETED":
      return { label: t("historyTimeline.state.completed"), tone: SITUATION_TONES.ended }
    case "EXTERNALLY_TERMINATED":
    case "INTERNALLY_TERMINATED":
      return { label: t("historyTimeline.state.terminated"), tone: SITUATION_TONES.ended }
    default:
      return { label: state, tone: "neutral" }
  }
}

/**
 * Camunda 7's start and end event types (its `ActivityTypes`, which CIB seven and Operaton keep):
 * each ends in `StartEvent` or `EndEvent` (`startEvent`, `noneEndEvent`, `messageStartEvent` …) but
 * a timer start, `startTimerEvent`, which no suffix rule catches.
 */
const START_OR_END_EVENT = /(?:start|end)Event$|^startTimerEvent$/i

/**
 * Events that happen in an instant (a start, an end, a throw, a boundary event's trigger) have no
 * duration of their own: their row leaves the cell empty, never "0ms". A catching event waits, so
 * its duration stays (a timer's two hours).
 */
function isInstantEvent(activityType: string): boolean {
  return (
    START_OR_END_EVENT.test(activityType) ||
    /throw/i.test(activityType) ||
    /boundary/i.test(activityType)
  )
}

/** A step neither ended nor cancelled: it runs, or waits at an incident. */
function isOpen(entry: Pick<HistoryEntry, "endTime" | "canceled">): boolean {
  return !entry.endTime && !entry.canceled
}

/**
 * How long an open step has run until now, read when the row renders as a time ago is
 * (`formatRelativeTime`); "—" for a start time that does not parse.
 */
function elapsedSince(startTime: string, now: number = Date.now()): string {
  const start = Date.parse(startTime)
  return formatDuration(Number.isNaN(start) ? null : Math.max(0, now - start))
}

/**
 * The one table of an instance's steps, on the history route, an instance's History tab and an
 * incident's (the webview's Element, State, Started and Duration): one 28 px line per step, its
 * name (its BPMN id in its title, never the engine's type) and who it is assigned to, its state as
 * the kit's label, its start to the second (the history's order counts) with its instant in the
 * title, and its duration. An open step reads "since 9:33:14 AM" and how long it has run so far;
 * an instant event has no duration. Props and callbacks only, no host context: the caller hands in
 * the actions at a row's end (`renderActions`, a hand-off), the column there only when it does.
 */
export function HistoryTable({
  entries,
  incidentIds,
  renderActions,
}: {
  entries: HistoryEntry[]
  incidentIds: ReadonlySet<string>
  renderActions?: (entry: HistoryEntry) => ReactNode
}) {
  const t = useT()
  const columns: ListTableColumn[] = [
    { label: t("incidentHistory.columnActivity") },
    { label: t("incidentHistory.columnStatus"), fit: true },
    { label: t("incidentHistory.columnStarted"), align: "right", fit: true, hideBelow: "sm" },
    { label: t("incidentHistory.columnDuration"), align: "right", fit: true },
    ...(renderActions
      ? [{ label: t("procIncTable.columnActions"), align: "right" as const, fit: true }]
      : []),
  ]
  return (
    <ListTable ariaLabel={t("incidentHistory.tableAriaLabel")} columns={columns}>
      {entries.map((entry) => {
        const open = isOpen(entry)
        const started = formatClock(entry.startTime)
        return (
          <tr key={entry.id}>
            <Td className="w-full max-w-0">
              <div className="flex min-w-0 items-baseline gap-2">
                <span className="text-foreground min-w-0 truncate" title={entry.activityId}>
                  {entry.activityName ?? entry.activityId}
                </span>
                {entry.assignee && (
                  <span className="text-muted-foreground text-small shrink-0">
                    {t("historyTimeline.assignedTo", { assignee: entry.assignee })}
                  </span>
                )}
              </div>
            </Td>
            <Td>
              <StepState state={historyStepState(entry, incidentIds)} />
            </Td>
            <Td align="right" className="text-muted-foreground text-small tabular-nums">
              <time dateTime={entry.startTime} title={formatInstant(entry.startTime)}>
                {open ? t("historyTimeline.since", { time: started }) : started}
              </time>
            </Td>
            <Td align="right" className="text-muted-foreground text-small tabular-nums">
              {open
                ? elapsedSince(entry.startTime)
                : isInstantEvent(entry.activityType)
                  ? null
                  : formatDuration(entry.durationInMillis)}
            </Td>
            {renderActions && <Td align="right">{renderActions(entry)}</Td>}
          </tr>
        )
      })}
    </ListTable>
  )
}
