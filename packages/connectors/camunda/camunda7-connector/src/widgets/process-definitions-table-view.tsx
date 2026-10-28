import type { ReactNode } from "react"
import {
  ListTable,
  NamedId,
  TableEmptyState,
  Td,
  countTone,
  formatNumber,
  type ListTableColumn,
} from "@miragon/pulse-widget-shell/widgets"
import { CountPill, TONE_DOT, cn, type ToneVariant } from "@miragon/mcp-toolkit-ui"
import { useT } from "../messages/use-t.js"

// Superset of both lists: cockpit rows carry `counts`, the standalone list `suspended`/`versionTag`.
export interface ProcessDefinitionsTableRow {
  id: string
  key: string
  name: string | null
  version: number
  tone: ToneVariant
  versionTag?: string | null
  suspended?: boolean
  counts?: { instances: number; failedJobs: number; totalIncidents: number }
}

// The single table for process definitions, shared by the cockpit table and the standalone list;
// optional columns are absent when their data or renderer isn't provided.
export function ProcessDefinitionsTableView({
  rows,
  ariaLabel,
  emptyText,
  status,
  renderActions,
}: {
  rows: ProcessDefinitionsTableRow[]
  ariaLabel: string
  emptyText: string
  status?: { header: string; render: (row: ProcessDefinitionsTableRow) => ReactNode }
  renderActions?: (row: ProcessDefinitionsTableRow) => ReactNode
}) {
  const t = useT()

  if (rows.length === 0) {
    return <TableEmptyState>{emptyText}</TableEmptyState>
  }

  const showCounts = rows.some((row) => row.counts !== undefined)

  const columns: ListTableColumn[] = [
    { label: t("cockpitDefs.colProcess") },
    // Count rows sum every version, so the version chip is not theirs; it yields its room inline (#322 U2).
    showCounts
      ? { label: t("cockpitDefs.colLatestVersion"), hideBelow: "md" }
      : { label: t("cockpitDefs.colVersion") },
    ...(status ? [{ label: status.header }] : []),
    ...(showCounts
      ? ([
          { label: t("cockpitDefs.colRunning"), align: "right" },
          { label: t("cockpitDefs.colFailedJobs"), align: "right" },
          { label: t("cockpitDefs.colIncidents"), align: "right" },
        ] satisfies ListTableColumn[])
      : []),
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
            {row.versionTag && (
              <span className="border-border bg-muted text-muted-foreground text-small ml-1.5 inline-block rounded border px-1.5 py-0.5 font-mono">
                {row.versionTag}
              </span>
            )}
          </Td>
          {status && <Td>{status.render(row)}</Td>}
          {showCounts && (
            <>
              {/* A count without a state is a plain number; jobs without
                  retries and open incidents take the one severity ladder
                  (#322 U14) — danger while there are any, else neutral. */}
              <Td align="right" className="text-foreground tabular-nums">
                {formatNumber(row.counts?.instances ?? 0)}
              </Td>
              <Td align="right">
                <CountPill tone={countTone(row.counts?.failedJobs)}>
                  {formatNumber(row.counts?.failedJobs ?? 0)}
                </CountPill>
              </Td>
              <Td align="right">
                <CountPill tone={countTone(row.counts?.totalIncidents)}>
                  {formatNumber(row.counts?.totalIncidents ?? 0)}
                </CountPill>
              </Td>
            </>
          )}
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
