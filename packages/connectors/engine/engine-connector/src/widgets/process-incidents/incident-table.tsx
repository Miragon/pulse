import { Fragment } from "react"
import {
  Button,
  cn,
  PagedListFooter,
  DrillButton,
  formatTimestamp,
  NamedId,
  StateLabel,
  Td,
} from "@miragon/pulse-ui"
import {
  FIT_CONTINUES_ROW,
  HandOffButton,
  ListTable,
  type ListTableColumn,
  OpenInCockpitLink,
  PagedRows,
  usePagedViewData,
  ViewDataState,
} from "@miragon/pulse-widget-shell/widgets"

import type { ActivityIncidentsData, IncidentInstance } from "../../view-models.js"
import { ENGINE_ACTIVITY_INCIDENTS_DATA } from "../../tool-names.js"
import { useHandOff, type HandOff } from "../lib/hand-off.js"
import { useT } from "../../messages/use-t.js"
import { EngineActionDialog } from "../lib/engine-action-dialog.js"
import { useIncidentRecovery, type IncidentRecoveryState } from "./use-incident-recovery.js"
import { InstanceLabel, NARROW_SUBJECT_FLOOR } from "../lib/identity.js"
import { DoneMark } from "../lib/done-mark.js"
import { MoreActions } from "../lib/more-actions.js"
import { WriteError } from "../lib/write-error.js"

/** Mirrors the feed's server default. */
const INCIDENT_PAGE_SIZE = 10

/** Its message is engine text, quoted. */
function draftIncidentTicketHandOff(
  incident: IncidentInstance,
  engine: string | undefined,
): HandOff {
  return {
    intent: "askAi.incident.draftTicket",
    ids: { engine, incidentId: incident.id },
    facts: { incidentType: incident.incidentType, processInstanceId: incident.processInstanceId },
    untrusted: [{ label: "incidentMessage", text: incident.incidentMessage }],
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
      size="xs"
      disabled={recovery.isPending(incident)}
      title={action === "retry" ? t("procIncTable.retryHint") : undefined}
      onClick={() => recovery.act(incident)}
    >
      {action === "retry" ? t("procIncTable.retry") : t("procIncTable.resolve")}
    </Button>
  )
}

/**
 * Where an incident sits, by its element's name (the id where it has none); never blank. Whole in
 * its fitted column, down to 8rem in a phone-width chat, as an instance is.
 */
function IncidentElement({ incident }: { incident: IncidentInstance }) {
  return incident.activityId ? (
    <NamedId
      name={incident.activityName}
      id={incident.activityId}
      className={NARROW_SUBJECT_FLOOR}
    />
  ) : (
    <span className="text-muted-foreground">{"—"}</span>
  )
}

/**
 * The incident's type as its state label and its message on one line, never a pill stacked above
 * it or a message wrapped into a tall row: the message is cut with an ellipsis, its whole text in
 * its title and on the incident's page, and keeps 10rem, so a narrow table scrolls inside its
 * region instead of squeezing it. Under 28rem the type shows its icon alone, its word read out and
 * in its title.
 */
function IncidentMessage({ incident }: { incident: IncidentInstance }) {
  const message = incident.incidentMessage
  return (
    <div className="flex min-w-0 items-center gap-3 @max-md:gap-1.5">
      <StateLabel state="incident" iconOnlyBelow="md" className="shrink-0">
        {incident.incidentType}
      </StateLabel>
      <span className="grid min-w-0 grid-cols-[minmax(10rem,max-content)]">
        <span
          data-incident-message=""
          className="text-muted-foreground text-small min-w-0 truncate font-mono"
          title={message ?? undefined}
        >
          {message || "—"}
        </span>
      </span>
    </div>
  )
}

export function IncidentTable({
  incidents,
  recovery,
  onAnalyze,
  subject = "instance",
  engine,
  vendor,
}: {
  incidents: IncidentInstance[]
  recovery: IncidentRecoveryState
  onAnalyze: (incidentId: string) => void
  /** The first column: each row's instance (an activity's incidents) or its element (an instance's). */
  subject?: "instance" | "element"
  engine?: string
  vendor?: string
}) {
  const t = useT()
  const { ask } = useHandOff()
  const byInstance = subject === "instance"

  // Each row is one line at the row height: the subject, the time and the actions fit their
  // content, the message takes the rest (#322 U2: the summary row above names first and latest).
  const columns: ListTableColumn[] = [
    {
      label: byInstance ? t("procIncTable.columnInstance") : t("procIncTable.columnActivity"),
      fit: true,
    },
    { label: t("procIncTable.columnErrorMessage") },
    {
      label: t("procIncTable.columnTime"),
      align: "right" as const,
      hideBelow: "md" as const,
      fit: true,
    },
    // Pinned from 40rem up only: in a narrower region a pinned column would cover the message, so
    // the actions scroll with the row and the message keeps its 10rem in view.
    { label: t("procIncTable.columnActions"), sticky: "sm" as const, fit: true },
  ]

  // The table on the surface it lies on, its head the kit's (`Th` paints `--table-surface`): the
  // card in an instance's tab, the ground of an activity's group (`PagedIncidentTable`).
  return (
    <ListTable
      ariaLabel={byInstance ? t("procIncTable.tableLabel") : t("procIncTable.tableLabelInstance")}
      columns={columns}
    >
      {/* Inline, the table shows the incidents that fit (its own fit, or the
          paged wrapper's) and says how many there are. */}
      {incidents.map((incident) => {
        const done = recovery.isDone(incident)
        const error = recovery.errorOf(incident)
        const retried = incident.recovery.action !== "resolve"
        const instanceUrl = incident.cockpitInstanceUrl
        return (
          <Fragment key={incident.id}>
            <tr>
              <Td>
                {byInstance ? (
                  // One instance label (#322 U13): its business key, the UUID a copyable chip.
                  <InstanceLabel
                    id={incident.processInstanceId}
                    businessKey={incident.businessKey}
                  />
                ) : (
                  <IncidentElement incident={incident} />
                )}
              </Td>
              <Td>
                <IncidentMessage incident={incident} />
              </Td>
              <Td align="right" className="text-muted-foreground text-small">
                {formatTimestamp(incident.incidentTimestamp)}
              </Td>
              <Td>
                {done ? (
                  // Done in words, never a dimmed row that reads as disabled (#322 U11).
                  <DoneMark>
                    {retried ? t("procIncTable.retried") : t("procIncTable.resolved")}
                  </DoneMark>
                ) : (
                  // A row's actions are xs, so the row keeps the row height (28 px).
                  <div className="flex items-center gap-1">
                    <DrillButton
                      size="xs"
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
                <td colSpan={columns.length} className="border-border px-cell py-cell border-b">
                  <WriteError error={error} />
                </td>
              </tr>
            )}
          </Fragment>
        )
      })}
    </ListTable>
  )
}

/** An activity group's body: the ground under its summary on the card, its table's head too. */
const GROUP_GROUND = "bg-muted [--table-surface:var(--muted)]"

/**
 * Pages `engine_activity_incidents_data` so a group reaches every incident, not just the
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
  /** The route's engine: a page never reads the default engine. */
  engine: string
  vendor?: string
  onAnalyze: (incidentId: string) => void
}) {
  const t = useT()
  const paged = usePagedViewData<IncidentInstance, ActivityIncidentsData>({
    initialData: null,
    key: ["engine:activity-incidents", engine, processDefinitionKey, activityId],
    tool: ENGINE_ACTIVITY_INCIDENTS_DATA,
    args: { processDefinitionKey, activityId, engine },
    pageSize: INCIDENT_PAGE_SIZE,
    ready: true,
    selectItems: (d) => d.incidents,
    selectTotal: (d) => d.totalCount,
  })
  const recovery = useIncidentRecovery(engine, { resetOn: paged.firstPage })

  if (!paged.firstPage) {
    return (
      <div className={cn(GROUP_GROUND, "px-cell py-cell")}>
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
    <div className={GROUP_GROUND}>
      {paged.items.length === 0 ? (
        <p className="text-muted-foreground text-dense px-cell py-cell">
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
      {/* The footer pads itself on the cell's role, so it lines up with the cells above. */}
      <PagedListFooter
        paged={paged}
        noun={(total) => t("procIncTable.footerNoun", { count: total })}
        labels={paged.footerLabels}
      />
      {/* The per-row button only requests the resolve; the actual
          engine_resolve_incident call runs after this confirmation. The
          dialog stays open until success so a failure is shown right here
          (and inline at the row once dismissed). */}
      <EngineActionDialog action={recovery.resolve} />
    </div>
  )
}
