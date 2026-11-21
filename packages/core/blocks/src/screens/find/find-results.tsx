import { shortId } from "@miragon/pulse-ui"
import type { FindHitData, FindScreenData, ScreenTarget } from "@miragon/pulse-screens"
import { useFindWords } from "../../messages/find-words.js"
import { InstanceTime, NoValue } from "../instance/instance-time.js"
import { InstanceStateCell } from "../process/instance-table.js"
import type { ScreenSlots, ScreenTableColumn } from "../slots.js"

/** A hit of the search and the engine it was found on, a row of the table. */
export interface FoundRow {
  readonly engine: string
  readonly hit: FindHitData
}

export interface FindResultsProps {
  /** What each engine that answered found, in the surface's order of its engines. */
  readonly found: readonly FindScreenData[]
  /** What was searched for: an empty table says it. */
  readonly text: string
  /** How many instances with the business key an engine lists at most (the finder's). */
  readonly most: number
  /**
   * Whether some engines could not be searched (refused, failing): an empty table then speaks of
   * the engines that could alone, never of an instance nowhere.
   */
  readonly partial?: boolean
  readonly slots: Pick<ScreenSlots, "Table" | "Id" | "onOpen" | "linkOf">
}

const keyOf = ({ engine, hit }: FoundRow): string => JSON.stringify([engine, hit.id])

const targetOf = ({ engine, hit }: FoundRow): ScreenTarget => ({
  kind: "instance",
  engine,
  instanceId: hit.id,
})

/**
 * What the search found on every engine that answered, one row per instance over the surface's
 * table: its id, its business key, its process in its version, its engine, its state with an open
 * incident beside it, when it started (a region narrower than 40rem keeps the id, the engine and
 * the state). A row opens its instance and copies its id; under the rows the engines that hold more
 * instances with the business key than they list. An empty table says what was searched and that
 * the search is exact, of the engines that could be searched alone where some could not (`partial`).
 */
export function FindResults({ found, text, most, partial = false, slots }: FindResultsProps) {
  const t = useFindWords()
  const { Table, Id, onOpen, linkOf } = slots
  const rows = found.flatMap(({ engine, hits }) => hits.map((hit) => ({ engine, hit })))
  const cut = found.filter((screen) => screen.cut).map(({ engine }) => engine)
  const columns: ScreenTableColumn<FoundRow>[] = [
    {
      key: "instance",
      label: t("find.column.instance"),
      cell: ({ hit }) => <Id id={hit.id} label={t("find.instanceId")} />,
    },
    {
      key: "businessKey",
      label: t("find.column.businessKey"),
      cell: ({ hit }) => hit.businessKey ?? <NoValue />,
      hideBelow: "40rem",
    },
    {
      key: "process",
      label: t("find.column.process"),
      cell: ({ hit }) =>
        t("find.version", {
          process: hit.definition.name ?? hit.definition.bpmnProcessId,
          version: hit.definition.version,
        }),
      hideBelow: "40rem",
    },
    { key: "engine", label: t("find.column.engine"), cell: ({ engine }) => engine },
    {
      key: "state",
      label: t("find.column.state"),
      cell: ({ hit }) => <InstanceStateCell state={hit.state} hasIncident={hit.hasIncident} />,
    },
    {
      key: "started",
      label: t("find.column.started"),
      cell: ({ hit }) => <InstanceTime iso={hit.startedAt} />,
      hideBelow: "40rem",
    },
  ]
  const footer =
    cut.length === 0 ? undefined : (
      <span className="flex flex-col gap-1" data-part="find-cut">
        {cut.map((engine) => (
          <span key={engine}>{t("find.cut", { engine, most })}</span>
        ))}
      </span>
    )
  return (
    <Table<FoundRow>
      name="found"
      label={t("find.label")}
      columns={columns}
      rows={rows}
      rowKey={keyOf}
      onOpen={(row, how) => {
        onOpen(targetOf(row), how)
      }}
      {...(linkOf === undefined ? {} : { linkOf: (row: FoundRow) => linkOf(targetOf(row)) })}
      rowLabel={(row) =>
        t("find.row", { name: row.hit.businessKey ?? shortId(row.hit.id), engine: row.engine })
      }
      copyOf={(row) => ({ text: row.hit.id, label: t("find.instanceId") })}
      empty={t(partial ? "find.noneSearched" : "find.none", { text })}
      {...(footer === undefined ? {} : { footer })}
    />
  )
}
