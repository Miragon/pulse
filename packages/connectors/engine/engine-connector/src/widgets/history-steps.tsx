import {
  StateLabel,
  Td,
  formatDuration,
  formatTimestamp,
  SITUATION_TONES,
  type StateLabelState,
  type ToneVariant,
} from "@miragon/pulse-ui"
import { ListTable } from "@miragon/pulse-widget-shell/widgets"
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
export type HistoryStepState = "incident" | "running" | "canceled" | "completed"

export function historyStepState(
  entry: Pick<HistoryEntry, "activityId" | "endTime" | "canceled">,
  incidentActivityIds: ReadonlySet<string>,
): HistoryStepState {
  if (entry.canceled) return "canceled"
  if (entry.endTime) return "completed"
  return incidentActivityIds.has(entry.activityId) ? "incident" : "running"
}

export const STEP_TONE: Record<HistoryStepState, ToneVariant> = {
  incident: SITUATION_TONES.openIncident,
  running: SITUATION_TONES.running,
  canceled: SITUATION_TONES.ended,
  completed: SITUATION_TONES.ended,
}

/** The kit's state for each step's, whose icon a `StateLabel` draws. */
const STEP_STATE: Record<HistoryStepState, StateLabelState> = {
  incident: "incident",
  running: "running",
  canceled: "cancelled",
  completed: "completed",
}

/** The step's state as the kit's state label: its tone's icon of its own shape and its word. */
export function StepState({ state }: { state: HistoryStepState }) {
  const t = useT()
  return <StateLabel state={STEP_STATE[state]}>{t(`historyTimeline.step.${state}`)}</StateLabel>
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

/** Compact table look for dense embeddings (the incident detail's history tab). */
export function HistoryTable({
  entries,
  incidentIds,
}: {
  entries: HistoryEntry[]
  incidentIds: ReadonlySet<string>
}) {
  const t = useT()
  return (
    <div className="border-border overflow-x-auto rounded-lg border">
      {/* The cells keep the kit's padding (28 px rows, one line each: the activity's type
          quiet beside its name), the wrapper border replaces the header's own top edge, and
          the activity cell takes the remaining width (w-full max-w-0) so long names truncate
          instead of widening the table into horizontal scroll. */}
      <ListTable
        className="[&_th]:border-t-0"
        ariaLabel={t("incidentHistory.tableAriaLabel")}
        columns={[
          { label: t("incidentHistory.columnActivity") },
          { label: t("incidentHistory.columnStarted"), align: "right" },
          { label: t("incidentHistory.columnDuration"), align: "right" },
          { label: t("incidentHistory.columnStatus"), align: "right" },
        ]}
      >
        {entries.map((entry) => (
          <tr key={entry.id} className="[&:last-child>td]:border-b-0">
            <Td className="w-full max-w-0">
              <div className="flex min-w-0 items-baseline gap-2">
                <span className="text-foreground min-w-0 truncate font-semibold">
                  {entry.activityName ?? entry.activityId}
                </span>
                <span className="text-muted-foreground text-small shrink-0 font-mono">
                  {entry.activityType}
                </span>
              </div>
            </Td>
            <Td align="right" className="text-muted-foreground text-small font-mono">
              {formatTimestamp(entry.startTime)}
            </Td>
            <Td align="right" className="text-muted-foreground text-small font-mono">
              {formatDuration(entry.durationInMillis)}
            </Td>
            <Td align="right">
              <StepState state={historyStepState(entry, incidentIds)} />
            </Td>
          </tr>
        ))}
      </ListTable>
    </div>
  )
}
