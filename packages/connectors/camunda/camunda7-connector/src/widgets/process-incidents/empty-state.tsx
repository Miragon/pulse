import { CountPill, FOCUS_RING, cn } from "@miragon/mcp-toolkit-ui"
import { formatNumber } from "@miragon/pulse-widget-shell/widgets"
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
      <div className="text-foreground font-medium">
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
                  "border-border bg-muted text-muted-foreground hover:text-foreground hover:bg-muted text-small inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 font-medium transition-colors",
                  FOCUS_RING,
                )}
              >
                <span className="text-foreground">
                  {s.processDefinitionName ?? s.processDefinitionKey}
                </span>
                {/* No coloured digits: the count on the danger tint and edge. */}
                <CountPill tone="danger">{formatNumber(s.incidentCount)}</CountPill>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
