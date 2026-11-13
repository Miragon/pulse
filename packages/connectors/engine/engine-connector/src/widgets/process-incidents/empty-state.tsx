import { CountBadge, FOCUS_RING, TableEmptyState, cn, formatNumber } from "@miragon/pulse-ui"
import type { IncidentsByProcess } from "../../view-models.js"
import { useT } from "../../messages/use-t.js"

/**
 * The incidents focus of a process without one: the kit's neutral empty note (a process without a
 * problem is never green), its help line on the engine's other processes and a way to each that
 * has open incidents.
 */
export function EmptyStateWithSiblings({
  processName,
  siblings,
  onJumpTo,
}: {
  processName: string
  /** Null when they could not be read. */
  siblings: IncidentsByProcess[] | null
  onJumpTo: (key: string, label?: string) => void
}) {
  const t = useT()
  const description =
    siblings === null
      ? t("procIncEmpty.siblingsUnavailable")
      : siblings.length === 0
        ? t("procIncEmpty.noOpenIncidentsInEngine")
        : t("procIncEmpty.otherProcessesHaveIncidents")
  return (
    <TableEmptyState
      description={description}
      action={
        siblings && siblings.length > 0 ? (
          <div className="flex flex-wrap items-center justify-center gap-1.5">
            {siblings.map((s) => (
              <button
                type="button"
                key={s.processDefinitionKey}
                onClick={() =>
                  onJumpTo(s.processDefinitionKey, s.processDefinitionName ?? undefined)
                }
                className={cn(
                  "border-border bg-raised text-muted-foreground hover:text-foreground hover:bg-accent text-small min-h-control rounded-button inline-flex items-center gap-1.5 border px-2.5 transition-colors",
                  FOCUS_RING,
                )}
              >
                <span className="text-foreground">
                  {s.processDefinitionName ?? s.processDefinitionKey}
                </span>
                {/* A neutral count with the incident's icon, never a coloured number. */}
                <CountBadge
                  count={s.incidentCount}
                  situation="openIncident"
                  label={t("procIncHeader.openIncidents", { count: formatNumber(s.incidentCount) })}
                />
              </button>
            ))}
          </div>
        ) : undefined
      }
    >
      {t("procIncEmpty.noOpenIncidentsOnProcess", { processName })}
    </TableEmptyState>
  )
}
