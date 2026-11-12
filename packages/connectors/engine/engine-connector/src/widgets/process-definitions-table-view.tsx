import type { ReactNode } from "react"
import {
  NamedId,
  TableEmptyState,
  Td,
  formatNumber,
  CountPill,
  TONE_DOT,
  cn,
  countTone,
  type ToneVariant,
} from "@miragon/pulse-ui"
import { ListTable, type ListTableColumn } from "@miragon/pulse-widget-shell/widgets"
import { useT } from "../messages/use-t.js"

// One row per deployed definition key: its counts span every version.
export interface ProcessDefinitionsTableRow {
  id: string
  key: string
  name: string | null
  version: number
  tone: ToneVariant
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
        <tr key={row.id} className="hover:bg-muted transition-colors">
          <Td>
            {/* Name first, the key a quiet mono line (#322 U13). */}
            <NamedId
              name={row.name}
              id={row.key}
              lead={
                <span
                  aria-hidden="true"
                  className={cn("size-1.5 shrink-0 rounded-full", TONE_DOT[row.tone])}
                />
              }
            />
          </Td>
          <Td>
            <span className="border-border bg-muted text-muted-foreground text-small inline-block rounded border px-1.5 py-0.5 font-mono">
              v{row.version}
            </span>
          </Td>
          {/* A count without a state is a plain number; jobs without retries and open incidents
              take the one severity ladder (#322 U14): danger while there are any, else neutral. */}
          <Td align="right" className="text-foreground tabular-nums">
            {formatNumber(row.counts.instances)}
          </Td>
          <Td align="right">
            <CountPill tone={countTone(row.counts.failedJobs)}>
              {formatNumber(row.counts.failedJobs)}
            </CountPill>
          </Td>
          <Td align="right">
            <CountPill tone={countTone(row.counts.totalIncidents)}>
              {formatNumber(row.counts.totalIncidents)}
            </CountPill>
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
