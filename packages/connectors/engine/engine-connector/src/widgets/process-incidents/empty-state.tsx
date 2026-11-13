import { CountBadge, FOCUS_RING, cn, formatNumber } from "@miragon/pulse-ui"
import type { IncidentsByProcess } from "../../view-models.js"
import { useT } from "../../messages/use-t.js"

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
  return (
    <div className="border-border bg-card text-dense flex flex-col items-center gap-3 rounded-lg border px-6 py-8 text-center">
      <div className="text-foreground font-semibold">
        {t("procIncEmpty.noOpenIncidentsOnProcess", { processName })}
      </div>
      {siblings === null ? (
        <div className="text-muted-foreground text-small">
          {t("procIncEmpty.siblingsUnavailable")}
        </div>
      ) : siblings.length === 0 ? (
        <div className="text-muted-foreground text-small">
          {t("procIncEmpty.noOpenIncidentsInEngine")}
        </div>
      ) : (
        <>
          <div className="text-muted-foreground text-small">
            {t("procIncEmpty.otherProcessesHaveIncidents")}
          </div>
          <div className="flex flex-wrap items-center justify-center gap-1.5">
            {siblings.map((s) => (
              <button
                type="button"
                key={s.processDefinitionKey}
                onClick={() =>
                  onJumpTo(s.processDefinitionKey, s.processDefinitionName ?? undefined)
                }
                className={cn(
                  "border-border bg-raised text-muted-foreground hover:text-foreground hover:bg-accent text-small min-h-control inline-flex items-center gap-1.5 rounded-md border px-2.5 transition-colors",
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
        </>
      )}
    </div>
  )
}
