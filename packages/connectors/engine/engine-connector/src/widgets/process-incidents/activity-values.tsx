import { NamedId, Section, Td, formatNumber } from "@miragon/pulse-ui"
import { ListTable, type ListTableColumn } from "@miragon/pulse-widget-shell/widgets"
import { useT } from "../../messages/use-t.js"

/** A count column of the values table: its header and its number per element. */
export interface ValueColumn<A> extends Pick<ListTableColumn, "hideBelow"> {
  label: string
  value: (activity: A) => number
}

interface ActivityRow {
  activityId: string
  activityName: string | null
  inDiagram: boolean | null
}

/**
 * The numbers behind a flow mode's badges or heat, one row per element, and the diagram's text
 * alternative; an element only older versions have is marked, since the diagram cannot show it.
 */
export function ActivityValues<A extends ActivityRow>({
  activities,
  columns,
}: {
  activities: readonly A[]
  columns: ReadonlyArray<ValueColumn<A>>
}) {
  const t = useT()
  const title = t("procIncFlow.valuesTitle")
  return (
    <Section title={title}>
      <ListTable
        ariaLabel={title}
        columns={[
          { label: t("procIncFlow.valuesColActivity") },
          ...columns.map(({ label, hideBelow }) => ({ label, hideBelow, align: "right" as const })),
        ]}
      >
        {activities.map((activity) => (
          <tr key={activity.activityId}>
            <Td>
              <NamedId
                name={activity.activityName}
                id={activity.activityId}
                detail={
                  activity.inDiagram === false ? [t("procIncFlow.olderVersionsOnly")] : undefined
                }
              />
            </Td>
            {columns.map((column) => (
              <Td key={column.label} align="right" className="tabular-nums">
                {formatNumber(column.value(activity))}
              </Td>
            ))}
          </tr>
        ))}
      </ListTable>
    </Section>
  )
}
