import { HostModelContext } from "@miragon/mcp-toolkit-ui/app"

import type { InstanceDetailData } from "../../view-models.js"
import { useHandOff, type ViewContext } from "../lib/hand-off.js"

/** `unconfirmed`: the instance may have ended since the shown read. */
type InstanceState = "cancelled" | "ended" | "unconfirmed" | "suspended" | "running"

/** The instance the operator is looking at; its writes only as far as the deployment has them. */
export function describeInstance({
  instance,
  engineId,
  state,
  openIncidentCount,
}: {
  instance: InstanceDetailData["instance"]
  engineId: string | undefined
  state: InstanceState
  openIncidentCount: number
}): ViewContext {
  return {
    summary: "The operator is viewing one process instance.",
    ids: {
      engine: engineId,
      processInstanceId: instance.id,
      processDefinitionId: instance.definitionId,
    },
    facts: { state, openIncidents: openIncidentCount },
    untrusted: [{ label: "businessKey", text: instance.businessKey }],
    tools: [
      "camunda7_list_incidents",
      "camunda7_query_historic_activity_instances",
      "camunda7_resolve_incident",
      "camunda7_set_job_retries",
      "camunda7_set_process_instance_suspension",
      "camunda7_delete_process_instance",
      "camunda7_modify_process_instance",
    ],
  }
}

export function InstanceModelContext({
  instance,
  engineId,
  cancelled,
  unconfirmed,
  isSuspended,
  openIncidentCount,
}: {
  instance: InstanceDetailData["instance"]
  engineId: string | undefined
  cancelled: boolean
  unconfirmed: boolean
  isSuspended: boolean
  openIncidentCount: number
}) {
  const { context } = useHandOff()
  const state: InstanceState = cancelled
    ? "cancelled"
    : instance.ended
      ? "ended"
      : unconfirmed
        ? "unconfirmed"
        : isSuspended
          ? "suspended"
          : "running"
  return (
    <HostModelContext
      content={context(describeInstance({ instance, engineId, state, openIncidentCount }))}
    >
      {null}
    </HostModelContext>
  )
}
