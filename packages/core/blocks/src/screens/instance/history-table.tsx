import { StateLabel, formatDuration, type StateLabelState } from "@miragon/pulse-ui"
import type { PathRowData, PathStateCode } from "@miragon/pulse-screens"
import { useInstanceWords } from "../../messages/instance-words.js"
import type { InstanceSlots } from "../slots.js"
import { InstanceTime, NoValue } from "./instance-time.js"

const STATES: Readonly<Record<PathStateCode, StateLabelState>> = {
  active: "running",
  completed: "completed",
  canceled: "cancelled",
}

export interface HistoryTableProps {
  /** The elements the instance ran through, in their order (`InstanceScreenData.path`). */
  readonly path: readonly PathRowData[]
  /** An element's name, as the surface knows it, where a row names none. */
  readonly nameOf: (elementId: string) => string
  readonly slots: Pick<InstanceSlots, "PlainTable">
}

/**
 * An instance's history in the surface's table: each element it ran through with its state (in
 * the kit's words), when it started and ended to the millisecond and how long it took; an open run
 * has no end and no duration. Its rows open nothing.
 */
export function HistoryTable({ path, nameOf, slots }: HistoryTableProps) {
  const t = useInstanceWords()
  const { PlainTable } = slots
  return (
    <PlainTable<PathRowData>
      name="history"
      label={t("history.label")}
      columns={[
        {
          key: "element",
          label: t("history.element"),
          cell: (row) => row.elementName ?? nameOf(row.elementId),
        },
        {
          key: "state",
          label: t("history.state"),
          cell: (row) => <StateLabel state={STATES[row.state]} />,
        },
        {
          key: "started",
          label: t("history.started"),
          cell: (row) => <InstanceTime iso={row.startedAt} precise />,
        },
        {
          key: "ended",
          label: t("history.ended"),
          cell: (row) => <InstanceTime iso={row.endedAt} precise />,
        },
        {
          key: "duration",
          label: t("history.duration"),
          cell: (row) =>
            row.durationMs === undefined ? <NoValue /> : formatDuration(row.durationMs),
        },
      ]}
      rows={path}
      rowKey={(row) => `${row.elementId}:${row.startedAt}`}
      empty={t("history.empty")}
    />
  )
}
