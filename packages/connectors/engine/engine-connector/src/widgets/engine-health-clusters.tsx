import {
  LogText,
  NamedId,
  SectionHeading,
  StateLabel,
  Td,
  formatCount,
  formatNumber,
} from "@miragon/pulse-ui"
import {
  HandOffButton,
  ListRow,
  ListTable,
  type ListTableColumn,
} from "@miragon/pulse-widget-shell/widgets"
import type { EngineHealthCluster } from "../view-models.js"
import type { OnNavigate } from "./navigation.js"
import { remediationHandOff, UNKNOWN_KEY as UNKNOWN } from "./remediation.js"
import { useActionAllowed } from "./lib/engine-action.js"
import { useHandOff, useHandOffsShown } from "./lib/hand-off.js"
import { incidentTypeWords } from "./lib/incident-type.js"
import { useT } from "../messages/use-t.js"

/**
 * A cluster's cause on its row's one line: its type as the kit's state label (the row's one alarm
 * sign, its icon alone under 28rem), then its message as a `LogText` line, cut with an ellipsis and
 * whole in its title, as an incident's row shows it.
 */
function ClusterCause({ cluster }: { cluster: EngineHealthCluster }) {
  const t = useT()
  return (
    <div className="flex min-w-0 items-center gap-3 @max-md:gap-1.5">
      <StateLabel state="incident" iconOnlyBelow="md" className="shrink-0">
        {incidentTypeWords(cluster.incidentType, t)}
      </StateLabel>
      {cluster.representativeMessage && (
        <div data-incident-message="" className="min-w-0">
          <LogText kind="message" text={cluster.representativeMessage} line />
        </div>
      )}
    </div>
  )
}

/**
 * One cross-process incident cluster (#322 U12) as a table row: the row opens the cluster on a
 * click or Enter and copies its activity's id (one row convention); its counts are neutral numbers
 * (the type's label alarms), and the hand-off sits at the row's end where the host shows one.
 */
function ClusterRow({
  cluster,
  engine,
  go,
  handOffs,
}: {
  cluster: EngineHealthCluster
  engine: string
  go: OnNavigate
  handOffs: boolean
}) {
  const t = useT()
  const { ask } = useHandOff()
  const canFix = useActionAllowed("engine_set_job_retries", engine)
  const primaryKey = cluster.processDefinitionKeys.find((k) => k !== UNKNOWN)
  // Drill keeps the cluster scope (activity + type + message signature), not a list that loses the root-cause filter.
  const drill = () =>
    go({
      type: "cluster-detail",
      activityId: cluster.activityId,
      incidentType: cluster.incidentType,
      messageSignature: cluster.messageSignature,
      label: cluster.activityName ?? undefined,
    })

  const scope =
    cluster.processDefinitionKeys.length > 1
      ? t("engineHealth.scopeProcesses", {
          count: formatNumber(cluster.processDefinitionKeys.length),
        })
      : (cluster.processDefinitionName ?? primaryKey ?? UNKNOWN)

  return (
    <ListRow
      label={t("engineHealth.clusterRowLabel", {
        activity: cluster.activityName ?? cluster.activityId,
      })}
      onOpen={drill}
      copy={cluster.activityId}
    >
      <Td>
        <NamedId name={cluster.activityName} id={cluster.activityId} />
      </Td>
      <Td>
        <ClusterCause cluster={cluster} />
      </Td>
      {/* A capped scan vouches for its scanned share only (#335): a lower bound, never its size. */}
      <Td align="right" className="tabular-nums">
        {formatCount(cluster.incidentCount ?? { atLeast: cluster.scannedIncidentCount })}
      </Td>
      {/* Unknown (the scan does not reach back a day) is "—", never 0. */}
      <Td align="right" className="tabular-nums">
        {formatCount(cluster.last24hCount)}
      </Td>
      <Td>
        <span className="block max-w-48 truncate" title={scope}>
          {scope}
        </span>
      </Td>
      {handOffs && (
        <Td align="right">
          <HandOffButton
            action={canFix ? "planFix" : "explainError"}
            variant="icon"
            size="xs"
            prompt={ask(remediationHandOff(cluster, engine, canFix))}
          />
        </Td>
      )}
    </ListRow>
  )
}

/**
 * The top failures as one table, a row per cause: the activity and the cause fit their line, the
 * counts and the process beside them give way first in a narrow card, the hand-off at the row's
 * end only where the host shows one. Its region carries the section's name, so the heading names
 * one landmark, not two.
 */
export function ClustersSection({
  clusters,
  engine,
  go,
}: {
  clusters: EngineHealthCluster[]
  engine: string
  go: OnNavigate
}) {
  const t = useT()
  const handOffs = useHandOffsShown()
  if (clusters.length === 0) return null
  const title = t("engineHealth.clustersHeading")
  const columns: ListTableColumn[] = [
    { label: t("engineHealth.colActivity"), fit: true },
    { label: t("engineHealth.colCause") },
    { label: t("engineHealth.colIncidents"), align: "right", fit: true },
    { label: t("engineHealth.new24h"), align: "right", fit: true, hideBelow: "sm" },
    { label: t("engineHealth.colProcess"), hideBelow: "md" },
    ...(handOffs
      ? [{ label: t("engineHealth.colActions"), align: "right" as const, fit: true }]
      : []),
  ]
  return (
    <div className="flex flex-col">
      <SectionHeading as="h2" title={title} />
      <ListTable ariaLabel={title} columns={columns}>
        {clusters.map((cluster) => (
          <ClusterRow
            key={cluster.id}
            cluster={cluster}
            engine={engine}
            go={go}
            handOffs={handOffs}
          />
        ))}
      </ListTable>
    </div>
  )
}
