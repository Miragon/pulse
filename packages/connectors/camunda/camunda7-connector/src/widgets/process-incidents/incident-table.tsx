import { Fragment } from "react"
import { Button, StatusBadge, PagedListFooter, DrillButton } from "@miragon/mcp-toolkit-ui"
import {
  FIT_CONTINUES_ROW,
  formatTimestamp,
  HandOffButton,
  Icon,
  ListTable,
  type ListTableColumn,
  LogText,
  OpenInCockpitLink,
  PagedRows,
  Td,
  usePagedViewData,
  ViewDataState,
} from "@miragon/pulse-widget-shell/widgets"
import { Check } from "lucide-react"

import type { ActivityIncidentsData, IncidentInstance } from "../../view-models.js"
import { CAMUNDA7_ACTIVITY_INCIDENTS_DATA } from "../../tool-names.js"
import { useHandOff, type HandOff } from "../lib/hand-off.js"
import { useT } from "../../messages/use-t.js"
import { EngineActionDialog } from "../lib/engine-action-dialog.js"
import { recoveryOf } from "../lib/incident-recovery.js"
import { useIncidentRecovery, type IncidentRecoveryState } from "./use-incident-recovery.js"
import { InstanceLabel } from "../lib/identity.js"
import { MoreActions } from "../lib/more-actions.js"

/** Mirrors the feed's server default. */
const INCIDENT_PAGE_SIZE = 10

/** Its message is engine text, quoted. */
export function draftIncidentTicketHandOff(
  incident: IncidentInstance,
  engine: string | undefined,
): HandOff {
  return {
    intent: "askAi.incident.draftTicket",
    ids: { engine, incidentId: incident.id },
    facts: { incidentType: incident.incidentType, processInstanceId: incident.processInstanceId },
    untrusted: [{ label: "incidentMessage", text: incident.incidentMessage }],
    tools: ["camunda7_format_incident_issue"],
  }
}

function RecoveryButton({
  incident,
  recovery,
}: {
  incident: IncidentInstance
  recovery: IncidentRecoveryState
}) {
  const t = useT()
  const action = recovery.actionFor(incident)
  if (!action) return null
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={recovery.isPending(incident)}
      title={action === "retry" ? t("procIncTable.retryHint") : undefined}
      onClick={() => recovery.act(incident)}
    >
      {action === "retry" ? t("procIncTable.retry") : t("procIncTable.resolve")}
    </Button>
  )
}

export function IncidentTable({
  incidents,
  recovery,
  onAnalyze,
  hideInstanceColumn = false,
  engine,
  vendor,
}: {
  incidents: IncidentInstance[]
  recovery: IncidentRecoveryState
  onAnalyze: (incidentId: string) => void
  hideInstanceColumn?: boolean
  engine?: string
  vendor?: string
}) {
  const t = useT()
  const { ask } = useHandOff()
  // Aligns under the activity summary's icon column; standalone the indent would float.
  const leadPad = hideInstanceColumn ? undefined : "pl-12"
  const columnCount = hideInstanceColumn ? 3 : 4

  const columns: ListTableColumn[] = [
    ...(hideInstanceColumn
      ? []
      : [{ label: t("procIncTable.columnInstance"), className: leadPad }]),
    { label: t("procIncTable.columnErrorMessage") },
    // The summary row above names first and latest; the message keeps the room (#322 U2).
    { label: t("procIncTable.columnTime"), align: "right" as const, hideBelow: "md" as const },
    { label: t("procIncTable.columnActions"), sticky: true },
  ]

  return (
    <div className="bg-muted [--list-table-surface:var(--muted)]">
      <ListTable ariaLabel={t("procIncTable.tableLabel")} columns={columns}>
        {/* Inline, the table shows the incidents that fit (its own fit, or the
            paged wrapper's) and says how many there are. */}
        {incidents.map((incident) => {
          const done = recovery.isDone(incident)
          const error = recovery.errorOf(incident)
          const retried = recoveryOf(incident).action !== "resolve"
          const instanceUrl = incident.cockpitInstanceUrl
          return (
            <Fragment key={incident.id}>
              <tr>
                {!hideInstanceColumn && (
                  <Td className={leadPad}>
                    {/* One instance label (#322 U13): its business key, the
                        UUID a copyable chip. */}
                    <InstanceLabel
                      id={incident.processInstanceId}
                      businessKey={incident.businessKey}
                    />
                  </Td>
                )}
                <Td>
                  <div className="flex flex-col items-start gap-1">
                    <StatusBadge tone="danger">{incident.incidentType}</StatusBadge>
                    <LogText text={incident.incidentMessage} />
                  </div>
                </Td>
                <Td align="right" className="text-muted-foreground text-small whitespace-nowrap">
                  {formatTimestamp(incident.incidentTimestamp)}
                </Td>
                <Td>
                  {done ? (
                    // Done in words, never a dimmed row that reads as disabled (#322 U11).
                    <StatusBadge tone="success" className="whitespace-nowrap">
                      <Icon icon={Check} dense />
                      {retried ? t("procIncTable.retried") : t("procIncTable.resolved")}
                    </StatusBadge>
                  ) : (
                    <div className="flex items-center gap-1">
                      <DrillButton
                        onDrill={() => onAnalyze(incident.id)}
                        ariaLabel={t("procIncTable.openIncidentDetail")}
                      >
                        {t("procIncTable.open")}
                      </DrillButton>
                      <RecoveryButton incident={incident} recovery={recovery} />
                      <MoreActions label={t("procIncTable.moreActions")}>
                        {instanceUrl && (
                          <OpenInCockpitLink url={instanceUrl} vendor={vendor} variant="menuitem" />
                        )}
                        <HandOffButton
                          action="draftTicket"
                          variant="menuitem"
                          prompt={ask(draftIncidentTicketHandOff(incident, engine))}
                        />
                      </MoreActions>
                    </div>
                  )}
                </Td>
              </tr>
              {/* The error line belongs to its incident: one item in the fit. */}
              {error && (
                <tr {...FIT_CONTINUES_ROW}>
                  <td
                    colSpan={columnCount}
                    className={`border-border border-b px-4 py-1.5 ${leadPad ?? ""}`}
                  >
                    <span role="alert" className="text-danger-ink text-small">
                      {retried
                        ? t("procIncTable.retryError", { message: error })
                        : t("procIncTable.resolveError", { message: error })}
                    </span>
                  </td>
                </tr>
              )}
            </Fragment>
          )
        })}
      </ListTable>
    </div>
  )
}

/**
 * Pages `camunda7_activity_incidents_data` so a group reaches every incident, not just the
 * definition feed's 200-row scan. Success marks reset on THIS feed: the definition feed can
 * answer the invalidation first with pre-write rows and would bring a cleared button back.
 */
export function PagedIncidentTable({
  processDefinitionKey,
  activityId,
  engine,
  vendor,
  onAnalyze,
}: {
  processDefinitionKey: string
  activityId: string
  /** Omitted: the caller's saved default engine. */
  engine?: string
  vendor?: string
  onAnalyze: (incidentId: string) => void
}) {
  const t = useT()
  const args: Record<string, unknown> = { processDefinitionKey, activityId }
  if (engine) args.engine = engine
  const paged = usePagedViewData<IncidentInstance, ActivityIncidentsData>({
    initialData: null,
    key: ["camunda7:activity-incidents", engine ?? null, processDefinitionKey, activityId],
    tool: CAMUNDA7_ACTIVITY_INCIDENTS_DATA,
    args,
    pageSize: INCIDENT_PAGE_SIZE,
    ready: !!(processDefinitionKey && activityId),
    selectItems: (d) => d.incidents,
    selectTotal: (d) => d.totalCount,
  })
  const recovery = useIncidentRecovery(engine, { resetOn: paged.firstPage })

  if (!paged.firstPage) {
    return (
      <div className="bg-muted px-4 py-3">
        <ViewDataState
          loading={paged.loading}
          error={paged.error}
          onRetry={paged.retry}
          loadingText={t("procIncTable.loading")}
          emptyText={t("procIncTable.noIncidents")}
        />
      </div>
    )
  }

  return (
    <>
      {paged.items.length === 0 ? (
        <p className="bg-muted text-muted-foreground text-dense px-4 py-3">
          {t("procIncTable.noIncidents")}
        </p>
      ) : (
        // #396
        <PagedRows paged={paged}>
          <IncidentTable
            incidents={paged.items}
            recovery={recovery}
            onAnalyze={onAnalyze}
            engine={engine}
            vendor={vendor}
          />
        </PagedRows>
      )}
      <div className="bg-muted px-3 pb-1">
        <PagedListFooter
          paged={paged}
          noun={t("procIncTable.footerNoun")}
          labels={paged.footerLabels}
        />
      </div>
      {/* The per-row button only requests the resolve; the actual
          camunda7_resolve_incident call runs after this confirmation. The
          dialog stays open until success so a failure is shown right here
          (and inline at the row once dismissed). */}
      <EngineActionDialog action={recovery.resolve} />
    </>
  )
}
