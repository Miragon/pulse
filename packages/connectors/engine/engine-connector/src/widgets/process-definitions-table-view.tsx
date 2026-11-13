import type { ReactNode } from "react"
import { NamedId, TableEmptyState, Td, VersionChip, formatNumber } from "@miragon/pulse-ui"
import { ListTable, type ListTableColumn } from "@miragon/pulse-widget-shell/widgets"
import { useT } from "../messages/use-t.js"
import { AlarmCount } from "./lib/alarm-count.js"

// One row per deployed definition key: its counts span every version.
export interface ProcessDefinitionsTableRow {
  id: string
  key: string
  name: string | null
  version: number
  counts: { instances: number; failedJobs: number; totalIncidents: number }
}

/** The overview's process definitions table; the actions column is there when a renderer is. */
export function ProcessDefinitionsTableView({
  rows,
  ariaLabel,
  emptyText,
  renderActions,
}: {
  rows: ProcessDefinitionsTableRow[]
  ariaLabel: string
  emptyText: string
  renderActions?: (row: ProcessDefinitionsTableRow) => ReactNode
}) {
  const t = useT()

  if (rows.length === 0) {
    return <TableEmptyState>{emptyText}</TableEmptyState>
  }

  const columns: ListTableColumn[] = [
    { label: t("cockpitDefs.colProcess") },
    // Counts sum every version, so the version chip is not theirs; it yields its room inline (#322 U2).
    { label: t("cockpitDefs.colLatestVersion"), hideBelow: "md" },
    { label: t("cockpitDefs.colRunning"), align: "right" },
    { label: t("cockpitDefs.colFailedJobs"), align: "right" },
    { label: t("cockpitDefs.colIncidents"), align: "right" },
    ...(renderActions ? [{ plain: true, sticky: true }] : []),
  ]

  return (
    <ListTable ariaLabel={ariaLabel} columns={columns}>
      {rows.map((row) => (
        <tr key={row.id}>
          <Td>
            {/* Name first, the key quiet beside it (#322 U13). */}
            <NamedId name={row.name} id={row.key} />
          </Td>
          <Td>
            <VersionChip version={row.version} className="ml-0" />
          </Td>
          {/* Every count is a neutral number; jobs without retries and open incidents alarm while
              there are any, by the tone's icon and words, never a coloured number (#322 U14). */}
          <Td align="right">
            <AlarmCount>{formatNumber(row.counts.instances)}</AlarmCount>
          </Td>
          <Td align="right">
            <AlarmCount alarm={row.counts.failedJobs > 0 && "jobsWithoutRetries"}>
              {formatNumber(row.counts.failedJobs)}
            </AlarmCount>
          </Td>
          <Td align="right">
            <AlarmCount alarm={row.counts.totalIncidents > 0 && "openIncidents"}>
              {formatNumber(row.counts.totalIncidents)}
            </AlarmCount>
          </Td>
          {renderActions && (
            <Td>
              <div className="flex items-center justify-end gap-1.5">{renderActions(row)}</div>
            </Td>
          )}
        </tr>
      ))}
    </ListTable>
  )
}
