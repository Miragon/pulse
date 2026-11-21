import { Fragment } from "react"
import {
  Button,
  cn,
  PagedListFooter,
  formatClock,
  formatInstant,
  LogText,
  NamedId,
  shortId,
  StateLabel,
  Td,
} from "@miragon/pulse-ui"
import {
  FIT_CONTINUES_ROW,
  HandOffButton,
  ListRow,
  ListTable,
  type ListTableColumn,
  OpenInCockpitLink,
  PagedRows,
  usePagedViewData,
  ViewDataState,
} from "@miragon/pulse-widget-shell/widgets"

import type {
  ActivityIncidentsData,
  IncidentInstance,
  IncidentRootCause,
} from "../../view-models.js"
import { ENGINE_ACTIVITY_INCIDENTS_DATA } from "../../tool-names.js"
import { useHandOff, useHandOffsShown, type HandOff } from "../lib/hand-off.js"
import { useT, type T } from "../../messages/use-t.js"
import { EngineActionDialog } from "../lib/engine-action-dialog.js"
import { useIncidentRecovery, type IncidentRecoveryState } from "./use-incident-recovery.js"
import { InstanceLabel, NARROW_SUBJECT_FLOOR } from "../lib/identity.js"
import { incidentTypeWords } from "../lib/incident-type.js"
import { DoneMark } from "../lib/done-mark.js"
import { MoreActions } from "../lib/more-actions.js"
import { WriteError } from "../lib/write-error.js"
import { instanceName } from "../lib/write-feedback.js"
import { useNav } from "../navigation.js"

/** Mirrors the feed's server default. */
const INCIDENT_PAGE_SIZE = 10

/** What a row opens: its incident (a copy's root, `targetOf`) and the element the crumb names. */
export interface IncidentTarget {
  incidentId: string
  /** The element of the incident the row opens, by its name (else its id); null where unknown. */
  label: string | null
}

/**
 * The incident a row leads to: a copy of a called instance's incident (a call activity's) leads on
 * to the root incident it stands for (`rootIncidentId`, c7-core's `rootIdOfCopy` on the server,
 * whether or not its root was read), never to itself, so the copy is no incident of its own on
 * screen; any other incident is its own. Its label is that incident's element.
 */
function targetOf(incident: IncidentInstance): IncidentTarget {
  const rootId = incident.rootIncidentId ?? null
  if (rootId === null) return { incidentId: incident.id, label: incident.activityName }
  const cause = incident.rootCause ?? null
  return { incidentId: rootId, label: cause ? (cause.activityName ?? cause.activityId) : null }
}

/**
 * Its message is engine text, quoted. It names the incident the row opens: a copy's root, in the
 * called instance where that was read.
 */
function draftIncidentTicketHandOff(
  incident: IncidentInstance,
  engine: string | undefined,
): HandOff {
  return {
    intent: "askAi.incident.draftTicket",
    ids: { engine, incidentId: targetOf(incident).incidentId },
    facts: {
      incidentType: incident.incidentType,
      processInstanceId: incident.rootCause?.processInstanceId ?? incident.processInstanceId,
    },
    untrusted: [
      { label: "incidentMessage", text: incident.incidentMessage ?? incident.rootCause?.message },
    ],
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
 * Where a copy's failure is: its root incident's element and its called instance's short id, a
 * quiet link that opens that instance (a control of its own, so the row does not open too).
 */
function CalledInstanceLink({ cause }: { cause: IncidentRootCause }) {
  const t = useT()
  const go = useNav()
  const id = shortId(cause.processInstanceId)
  return (
    <Button
      type="button"
      variant="link"
      size="xs"
      title={t("procIncTable.openCalledInstance", { id: cause.processInstanceId })}
      onClick={() =>
        go({ type: "instance-detail", processInstanceId: cause.processInstanceId, label: id })
      }
      className="text-muted-foreground hover:text-foreground shrink-0 px-0 font-normal underline decoration-1 underline-offset-3"
    >
      {t("procIncTable.inCalledInstance", { activity: cause.activityName ?? cause.activityId, id })}
    </Button>
  )
}

/**
 * The incident's type as its state label and its message on one line, never a pill stacked above
 * it or a message wrapped into a tall row: the message is pulse-ui's `LogText` line, cut with an
 * ellipsis, its whole text in its title, on a disclosure where it is cut and on the incident's
 * page, and keeps 10rem, so a narrow table scrolls inside its region instead of squeezing it.
 * Under 28rem the type shows its icon alone, its word read out and in its title. A copy of a
 * called instance's incident has no message of its own: its root's shows, followed by where that
 * one is; an unread root leaves the "—".
 */
function IncidentMessage({ incident }: { incident: IncidentInstance }) {
  const t = useT()
  const cause = incident.incidentMessage ? null : (incident.rootCause ?? null)
  const message = incident.incidentMessage ?? cause?.message ?? null
  return (
    <div className="flex min-w-0 items-center gap-3 @max-md:gap-1.5">
      <StateLabel state="incident" iconOnlyBelow="md" className="shrink-0">
        {incidentTypeWords(incident.incidentType, t)}
      </StateLabel>
      <div data-incident-message="" className="flex min-w-0 items-center gap-2">
        <LogText kind="message" text={message} line className="min-w-0" />
        {cause && <CalledInstanceLink cause={cause} />}
      </div>
    </div>
  )
}

/** A row's time: the clock without seconds (its day on another day), the whole instant in its title. */
function IncidentTime({ timestamp }: { timestamp: string }) {
  return <span title={formatInstant(timestamp)}>{formatClock(timestamp, { seconds: false })}</span>
}

/**
 * What a row opens, its accessible name: the incident, by its instance or by its element and its
 * time, since an instance can hold several incidents at one element; a copy's row opens its root,
 * so it names that one, by its element and its called instance where its root was read.
 */
function rowLabel(t: T, incident: IncidentInstance, byInstance: boolean) {
  const time = formatClock(incident.incidentTimestamp, { seconds: false })
  if (incident.rootIncidentId) {
    const cause = incident.rootCause ?? null
    return cause
      ? t("procIncTable.rowLabelCopy", {
          element: cause.activityName ?? cause.activityId,
          id: shortId(cause.processInstanceId),
          time,
        })
      : t("procIncTable.rowLabelCopyUnread", { time })
  }
  return byInstance
    ? t("procIncTable.rowLabelInstance", {
        name: instanceName(incident.processInstanceId, incident.businessKey),
      })
    : t("procIncTable.rowLabelElement", {
        element: incident.activityName ?? incident.activityId ?? incident.id,
        time,
      })
}

/**
 * The incidents of an activity (by instance) or of an instance (by element), one line each: a row
 * opens its incident (a copy its root, `targetOf`) on a click or Enter and copies that incident's id
 * on Ctrl or Cmd with C (one row convention, as the webview's lists), its write and its menu at the
 * row's end open nothing, and a row whose incident is done opens nothing either.
 */
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
  onAnalyze: (target: IncidentTarget) => void
  /** The first column: each row's instance (an activity's incidents) or its element (an instance's). */
  subject?: "instance" | "element"
  engine?: string
  vendor?: string
}) {
  const t = useT()
  const { ask } = useHandOff()
  const handOffs = useHandOffsShown()
  const byInstance = subject === "instance"
  // The row itself opens its incident: a column of actions only while a row shows one (a write,
  // its result, the menu).
  const actions =
    handOffs ||
    incidents.some(
      (incident) =>
        recovery.isDone(incident) ||
        recovery.actionFor(incident) !== null ||
        !!incident.cockpitInstanceUrl,
    )

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
    // the actions scroll with the row and the message keeps its 10rem in view. Right-aligned, its
    // head over its buttons, as every table's row actions.
    ...(actions
      ? [
          {
            label: t("procIncTable.columnActions"),
            align: "right" as const,
            sticky: "sm" as const,
            fit: true,
          },
        ]
      : []),
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
            <ListRow
              label={rowLabel(t, incident, byInstance)}
              onOpen={done ? undefined : () => onAnalyze(targetOf(incident))}
              copy={targetOf(incident).incidentId}
            >
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
              <Td align="right" className="text-muted-foreground text-small tabular-nums">
                <IncidentTime timestamp={incident.incidentTimestamp} />
              </Td>
              {actions && (
                <Td align="right">
                  {done ? (
                    // Done in words, never a dimmed row that reads as disabled (#322 U11).
                    <DoneMark>
                      {retried ? t("procIncTable.retried") : t("procIncTable.resolved")}
                    </DoneMark>
                  ) : (
                    // A row's actions are xs, so the row keeps the row height (28 px).
                    <div className="inline-flex items-center justify-end gap-1">
                      <RecoveryButton incident={incident} recovery={recovery} />
                      {/* A menu only while one of its entries shows. */}
                      {(instanceUrl || handOffs) && (
                        <MoreActions label={t("procIncTable.moreActions")}>
                          {instanceUrl && (
                            <OpenInCockpitLink
                              url={instanceUrl}
                              vendor={vendor}
                              variant="menuitem"
                            />
                          )}
                          <HandOffButton
                            action="draftTicket"
                            variant="menuitem"
                            prompt={ask(draftIncidentTicketHandOff(incident, engine))}
                          />
                        </MoreActions>
                      )}
                    </div>
                  )}
                </Td>
              )}
            </ListRow>
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
  onAnalyze: (target: IncidentTarget) => void
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
