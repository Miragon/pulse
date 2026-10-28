import {
  HandOffButton,
  ListTable,
  LogText,
  NamedId,
  PagedRows,
  TableEmptyState,
  Td,
  ViewDataState,
  WidgetShell,
  formatNumber,
  formatTimestamp,
  usePagedListView,
} from "@miragon/pulse-widget-shell/widgets"
import { HostModelContext } from "@miragon/mcp-toolkit-ui/app"
import {
  FilterBar,
  KpiGrid,
  StatusBadge,
  WidgetHeader,
  PagedListFooter,
  DrillButton,
} from "@miragon/mcp-toolkit-ui"
import type { ClusterDetailData, ClusterIncidentRow } from "../view-models.js"
import { DetailPage } from "./detail-page.js"
import { useNav } from "./navigation.js"
import { CAMUNDA7_CLUSTER_DETAIL_DATA } from "../tool-names.js"
import {
  clusterCountFacts,
  clusterKeyParts,
  clusterScanComplete,
  remediationHandOff,
} from "./remediation.js"
import { useHandOff, type ViewContext } from "./lib/hand-off.js"
import { formatCount, formatCountAtLeast } from "./lib/format-count.js"
import { EngineMeta } from "./lib/engine-context.js"
import { InstanceLabel } from "./lib/identity.js"
import { instanceName } from "./lib/write-feedback.js"
import { useT } from "../messages/use-t.js"

/** Page size — mirrors the server default (`CLUSTER_DETAIL_ROWS`). */
const PAGE_SIZE = 50

/** Grounding context; the sample message is engine text, quoted, never inlined. */
export function describeCluster(data: ClusterDetailData): ViewContext {
  // The scanned incidents' keys ("(unknown)" dropped) scope only while the
  // scan held the whole cluster.
  const keys = clusterKeyParts(data, data.processDefinitionKeys)
  return {
    summary:
      "The operator is inspecting ONE failure cluster and its affected instances (with their business keys). Propose remediation only scoped to this cluster.",
    ids: {
      engine: data.engineId,
      activityId: data.activityId,
      incidentType: data.incidentType,
      processDefinitionKey: keys.processDefinitionKey,
      processDefinitionKeyIn: keys.processDefinitionKeyIn,
    },
    // Counts a capped scan cannot vouch for are a lower bound or left out —
    // never a 0 (#335); the list then covers only the newest scanned ones.
    facts: {
      ...clusterCountFacts(data),
      scannedProcessDefinitionKeys: keys.scannedProcessDefinitionKeys,
      lastHour: data.lastHourCount,
      last24h: data.last24hCount,
      firstSeen: data.firstSeen,
      latestIncident: data.latestIncident,
      listCoversNewest: listCapped(data) ? data.scannedIncidentCount : undefined,
    },
    untrusted: [{ label: "sampleMessage", text: data.representativeMessage }],
    tools: ["camunda7_list_incidents", "camunda7_get_process_instance"],
  }
}

/** loadMore() must carry the cluster identity and engine, or it would page the caller's default engine. */
function clusterFeedParams({
  initialData,
  engine,
  activityId,
  incidentType,
  messageSignature,
}: {
  initialData: ClusterDetailData | null
  engine?: string
  activityId?: string
  incidentType?: string
  messageSignature?: string
}) {
  const clusterActivityId = activityId ?? initialData?.activityId
  const clusterIncidentType = incidentType ?? initialData?.incidentType
  const clusterSignature = messageSignature ?? initialData?.messageSignature ?? undefined
  const feedEngine = engine ?? initialData?.engineId
  // Unlike engine-health, this feed REQUIRES the cluster identity; the show tool passes data instead.
  const ready = !!(clusterActivityId && clusterIncidentType)
  const args: Record<string, unknown> = {}
  if (feedEngine) args.engine = feedEngine
  if (clusterActivityId) args.activityId = clusterActivityId
  if (clusterIncidentType) args.incidentType = clusterIncidentType
  if (clusterSignature) args.messageSignature = clusterSignature
  return { clusterActivityId, clusterIncidentType, clusterSignature, feedEngine, ready, args }
}

/** By name where a row carries one (#322 U13), else by key. */
function clusterProcesses(data: ClusterDetailData, unknown: string): string {
  const names = new Map<string, string>()
  for (const row of data.incidents) {
    if (row.processDefinitionName) names.set(row.processDefinitionKey, row.processDefinitionName)
  }
  return data.processDefinitionKeys.map((key) => names.get(key) ?? key).join(", ") || unknown
}

function ClusterHeader({ data, engineId }: { data: ClusterDetailData; engineId: string }) {
  const t = useT()
  const { ask, surface } = useHandOff()
  const { handOff, canFix } = remediationHandOff(
    {
      activityId: data.activityId,
      incidentType: data.incidentType,
      incidentCount: data.incidentCount,
      scannedIncidentCount: data.scannedIncidentCount,
      last24hCount: data.last24hCount,
      processDefinitionKeys: data.processDefinitionKeys,
      representativeMessage: data.representativeMessage,
    },
    engineId,
    surface,
  )
  return (
    <WidgetHeader
      badge={<StatusBadge tone="danger">{data.incidentType}</StatusBadge>}
      // The activity by its name; its BPMN id only where it has none (#322 U13).
      title={data.activityName ?? <span className="font-mono">{data.activityId}</span>}
      sub={
        <>
          <EngineMeta engineId={engineId} asOf={data.fetchedAt} />
          <span>
            {t("clusterDetail.affectedAcross", {
              count: formatCountAtLeast(data.incidentCount, data.scannedIncidentCount),
              keys: clusterProcesses(data, t("clusterDetail.unknownKeys")),
            })}
            {/* A point in time is a fact of the line, not a KPI tile it
                would not fit in (#322 U12). */}
            {data.firstSeen &&
              ` · ${t("clusterDetail.firstSeen", { time: formatTimestamp(data.firstSeen) })}`}
          </span>
        </>
      }
      actions={<HandOffButton action={canFix ? "planFix" : "explainError"} prompt={ask(handOff)} />}
    />
  )
}

/** A count a capped scan cannot vouch for renders as a lower bound ("≥2,000") or "—". */
function ClusterKpis({ data }: { data: ClusterDetailData }) {
  const t = useT()
  return (
    <KpiGrid
      boxed
      cells={[
        {
          label: t("clusterDetail.kpiAffected"),
          value: formatCountAtLeast(data.incidentCount, data.scannedIncidentCount),
          tone: "danger",
        },
        // How fast it grows is a count, not a second state (#322 U14).
        { label: t("clusterDetail.kpiNewLastHour"), value: formatCount(data.lastHourCount) },
        { label: t("clusterDetail.kpiNew24h"), value: formatCount(data.last24hCount) },
      ]}
    />
  )
}

/** When the cluster outruns the scan, the footer says its total is the scan's share, not the cluster's size. */
function listCapped(data: ClusterDetailData): boolean {
  return !clusterScanComplete(data)
}

/** Only a cluster spanning several processes needs the process column. */
function spansProcesses(data: ClusterDetailData): boolean {
  return data.processDefinitionKeys.length > 1
}

/** One affected instance (#322 U2, U13). */
function IncidentRow({
  row,
  activityName,
  showProcess,
}: {
  row: ClusterIncidentRow
  activityName: string | null
  showProcess: boolean
}) {
  const go = useNav()
  const t = useT()
  const label = instanceName(row.processInstanceId, row.businessKey)
  return (
    <tr className="hover:bg-muted transition-colors">
      <Td>
        <InstanceLabel id={row.processInstanceId} businessKey={row.businessKey} />
      </Td>
      {showProcess && (
        <Td>
          <NamedId name={row.processDefinitionName} id={row.processDefinitionKey} />
        </Td>
      )}
      <Td align="right" className="text-muted-foreground text-small whitespace-nowrap">
        {formatTimestamp(row.incidentTimestamp)}
      </Td>
      <Td align="right">
        <div className="inline-flex items-center justify-end gap-1">
          <DrillButton
            onDrill={() =>
              go({ type: "instance-detail", processInstanceId: row.processInstanceId, label })
            }
            ariaLabel={t("clusterDetail.openInstanceAria", { ref: label })}
          >
            {t("clusterDetail.instance")}
          </DrillButton>
          {row.incidentId && (
            <DrillButton
              onDrill={() =>
                go({
                  type: "incident-detail",
                  incidentId: row.incidentId,
                  label: activityName ?? undefined,
                })
              }
              ariaLabel={t("clusterDetail.openIncidentAria", { ref: label })}
            >
              {t("clusterDetail.incident")}
            </DrillButton>
          )}
        </div>
      </Td>
    </tr>
  )
}

/** Drill-in for ONE failure cluster, between the engine overview's cluster list and the single-incident detail. */
export function ClusterDetailView({
  data: initialData = null,
  engine,
  activityId,
  incidentType,
  messageSignature,
}: {
  data?: ClusterDetailData | null
  engine?: string
  activityId?: string
  incidentType?: string
  messageSignature?: string
}) {
  const t = useT()
  const { clusterActivityId, clusterIncidentType, clusterSignature, feedEngine, ready, args } =
    clusterFeedParams({ initialData, engine, activityId, incidentType, messageSignature })
  // SERVER-side, so the search covers the whole cluster, not just the loaded page.
  const { paged, search, setSearch, interacted } = usePagedListView<
    ClusterIncidentRow,
    ClusterDetailData
  >({
    initialData,
    key: [
      "camunda7:cluster-detail",
      feedEngine ?? null,
      clusterActivityId ?? null,
      clusterIncidentType ?? null,
      clusterSignature ?? null,
    ],
    tool: CAMUNDA7_CLUSTER_DETAIL_DATA,
    args,
    searchArg: "businessKeyLike",
    pageSize: PAGE_SIZE,
    ready,
    selectItems: (d) => d.incidents,
    selectTotal: (d) => d.totalMatching,
  })
  const data = paged.firstPage

  if (!data) {
    return (
      <WidgetShell>
        <ViewDataState
          loading={paged.loading}
          error={paged.error}
          onRetry={paged.retry}
          loadingText={t("clusterDetail.loading")}
          emptyText={t("clusterDetail.noData")}
        />
      </WidgetShell>
    )
  }

  const engineId = engine ?? data.engineId

  return (
    <DetailPage
      header={<ClusterHeader data={data} engineId={engineId} />}
      kpi={<ClusterKpis data={data} />}
      /* A single content block, no tabs: the failure message stays beside its instances. */
      content={
        <>
          {data.representativeMessage && (
            <div>
              <h2 className="text-foreground text-dense font-semibold">
                {t("clusterDetail.failureMessage")}
              </h2>
              <LogText text={data.representativeMessage} className="mt-1" />
            </div>
          )}

          <section
            aria-label={t("clusterDetail.affectedInstances")}
            className="flex flex-col gap-2"
          >
            <h2 className="text-foreground text-dense font-semibold">
              {t("clusterDetail.affectedInstances")}
            </h2>
            <FilterBar
              search={search}
              onSearchChange={setSearch}
              searchPlaceholder={t("clusterDetail.searchPlaceholder")}
              searchAriaLabel={t("clusterDetail.searchLabel")}
              chips={[]}
              onChipToggle={() => undefined}
            />
            <PagedRows paged={paged}>
              {paged.items.length === 0 ? (
                <TableEmptyState>
                  {interacted ? t("clusterDetail.noMatch") : t("clusterDetail.noMatchingIncidents")}
                </TableEmptyState>
              ) : (
                <ListTable
                  ariaLabel={t("clusterDetail.affectedInstances")}
                  columns={[
                    { label: t("clusterDetail.colInstance") },
                    ...(spansProcesses(data)
                      ? [{ label: t("clusterDetail.colProcess"), hideBelow: "sm" as const }]
                      : []),
                    { label: t("clusterDetail.colOccurred"), align: "right" },
                    { plain: true, sticky: true },
                  ]}
                >
                  {paged.items.map((row) => (
                    <IncidentRow
                      // The engine can report rows without an incident id — fall back to
                      // instance+timestamp so React keys stay unique per incident row.
                      key={row.incidentId || `${row.processInstanceId}-${row.incidentTimestamp}`}
                      row={row}
                      activityName={data.activityName}
                      showProcess={spansProcesses(data)}
                    />
                  ))}
                </ListTable>
              )}
            </PagedRows>
            <PagedListFooter
              paged={paged}
              noun={t("clusterDetail.footerNoun")}
              labels={paged.footerLabels}
            />
            {listCapped(data) && (
              <p className="text-muted-foreground text-small">
                {t("clusterDetail.listCapped", { count: formatNumber(data.scannedIncidentCount) })}
              </p>
            )}
          </section>
        </>
      }
    >
      <ClusterModelContext data={data} />
    </DetailPage>
  )
}

function ClusterModelContext({ data }: { data: ClusterDetailData }) {
  const { context } = useHandOff()
  return <HostModelContext content={context(describeCluster(data))}>{null}</HostModelContext>
}

export function ClusterDetailWidget({
  data,
  engine,
  activityId,
  incidentType,
  messageSignature,
}: {
  data: ClusterDetailData | null
  engine?: string
  activityId?: string
  incidentType?: string
  messageSignature?: string
}) {
  return (
    <ClusterDetailView
      data={data}
      engine={engine}
      activityId={activityId}
      incidentType={incidentType}
      messageSignature={messageSignature}
    />
  )
}
