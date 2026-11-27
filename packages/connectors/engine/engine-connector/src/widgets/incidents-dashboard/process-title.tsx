import type { IncidentsDashboardProcess } from "../../view-models.js"
import { useT } from "../../messages/use-t.js"

/**
 * The group's name in its toggle: the full process name, never cut, its key quiet in mono after
 * it, and its tenant where it has one, so the toggle is named by the process and two tenants of a
 * key read apart.
 */
export function ProcessTitle({ process }: { process: IncidentsDashboardProcess }) {
  const t = useT()
  return (
    <span className="text-dense min-w-0 font-semibold break-words">
      {process.processDefinitionName ?? process.processDefinitionKey}
      {process.processDefinitionName && (
        <span className="text-muted-foreground text-small ms-2 font-mono font-normal">
          {process.processDefinitionKey}
        </span>
      )}
      {process.tenantId !== undefined && (
        <span className="text-muted-foreground text-small ms-2 font-normal">
          {t("procIncHeader.tenant", { tenant: process.tenantId })}
        </span>
      )}
    </span>
  )
}
