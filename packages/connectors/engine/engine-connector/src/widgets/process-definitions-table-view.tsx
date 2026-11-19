import type { ReactNode } from "react"
import { NamedId, TableEmptyState, Td, VersionChip, formatNumber } from "@miragon/pulse-ui"
import { ListRow, ListTable, type ListTableColumn } from "@miragon/pulse-widget-shell/widgets"
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

/**
 * The overview's process definitions table: with `onOpen` a row opens its process on a click or
 * Enter and copies its key on Ctrl or Cmd with C (one row convention, as the webview's process
 * list); the actions column, at the row's end, is there when a renderer is.
 */
export function ProcessDefinitionsTableView({
  rows,
  ariaLabel,
  emptyText,
  onOpen,
  renderActions,
}: {
  rows: ProcessDefinitionsTableRow[]
  ariaLabel: string
  emptyText: string
  onOpen?: (row: ProcessDefinitionsTableRow) => void
  renderActions?: (row: ProcessDefinitionsTableRow) => ReactNode
}) {
  const t = useT()

  if (rows.length === 0) {
    return <TableEmptyState>{emptyText}</TableEmptyState>
  }

  const columns: ListTableColumn[] = [
    { label: t("cockpitDefs.colProcess") },
    // A narrow region drops by importance, never by position: the version first (the counts sum
    // every version, so the chip is not theirs, #322 U2), then the running instances, so the
    // name and the alarms (jobs without retries, incidents) stay in view.
    { label: t("cockpitDefs.colLatestVersion"), hideBelow: "md" },
    { label: t("cockpitDefs.colRunning"), align: "right", hideBelow: "sm" },
    { label: t("cockpitDefs.colFailedJobs"), align: "right" },
    { label: t("cockpitDefs.colIncidents"), align: "right" },
    // Pinned from 40rem up only: in a narrower region a pinned column would cover the process, so
    // the actions scroll with the row, their head's word for a screen reader alone, and the name
    // gives way with its ellipsis.
    ...(renderActions
      ? [{ label: t("cockpitDefs.colActions"), align: "right" as const, sticky: "sm" as const }]
      : []),
  ]

  return (
    <ListTable ariaLabel={ariaLabel} columns={columns}>
      {rows.map((row) => (
        <ListRow
          key={row.id}
          label={t("cockpitDefs.rowLabel", { name: row.name ?? row.key })}
          onOpen={onOpen && (() => onOpen(row))}
          copy={row.key}
        >
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
              <div className="flex items-center justify-end gap-1">{renderActions(row)}</div>
            </Td>
          )}
        </ListRow>
      ))}
    </ListTable>
  )
}
