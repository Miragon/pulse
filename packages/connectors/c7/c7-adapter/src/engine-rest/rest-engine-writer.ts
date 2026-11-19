import { rootIdOfCopy } from "@miragon/pulse-c7-core"
import { JsonView } from "@miragon/pulse-c7-core/runtime"
import type { BatchRef, EngineWriter, RetryOutcome } from "./engine-writer.js"
import { EngineRequestError } from "./http/engine-request-error.js"
import type { EngineHttp } from "./http/engine-http.js"
import { RecoveryTargets } from "./recovery-targets.js"
import { RequestArguments } from "./request-arguments.js"

const ONE_RETRY = JSON.stringify({ retries: 1 })

export class RestEngineWriter implements EngineWriter {
  constructor(private readonly http: EngineHttp) {}

  async retryIncident(incidentId: string): Promise<RetryOutcome> {
    const root = await this.rootCauseOf(incidentId)
    if (root === undefined) {
      return "gone"
    }
    const target = RecoveryTargets.of({
      incidentType: root.requiredString("incidentType"),
      configuration: root.optionalString("configuration"),
    })
    if (target === undefined) {
      return "skipped"
    }
    const retries = `${target.resource}/${RequestArguments.segment(target.id)}/retries`
    try {
      await this.http.write("PUT", retries, ONE_RETRY)
      return "retried"
    } catch (error: unknown) {
      if (EngineRequestError.isMissingResource(error)) {
        return "gone"
      }
      throw error
    }
  }

  async setVariable(instanceId: string, name: string, body: string): Promise<void> {
    const instance = RequestArguments.segment(instanceId)
    await this.http.write(
      "PUT",
      `/process-instance/${instance}/variables/${RequestArguments.variableName(name)}`,
      body,
    )
  }

  async modify(instanceId: string, body: string): Promise<void> {
    const instance = RequestArguments.segment(instanceId)
    await this.http.write("POST", `/process-instance/${instance}/modification`, body)
  }

  async deleteInstancesAsync(body: string): Promise<BatchRef> {
    return RestEngineWriter.batchOf(await this.http.write("POST", "/process-instance/delete", body))
  }

  async migrateInstancesAsync(body: string): Promise<BatchRef> {
    return RestEngineWriter.batchOf(await this.http.write("POST", "/migration/executeAsync", body))
  }

  async suspendBatch(batchId: string): Promise<void> {
    const batch = RequestArguments.segment(batchId)
    await this.http.write("PUT", `/batch/${batch}/suspended`, JSON.stringify({ suspended: true }))
  }

  async deleteBatch(batchId: string): Promise<void> {
    const batch = RequestArguments.segment(batchId)
    await this.http.write("DELETE", `/batch/${batch}`, undefined, { cascade: "false" })
  }

  private static batchOf(answer: unknown): BatchRef {
    return { id: JsonView.of(answer, "batch").requiredString("id") }
  }

  private async rootCauseOf(incidentId: string): Promise<JsonView | undefined> {
    const path = `/incident/${RequestArguments.segment(incidentId)}`
    const incident = JsonView.of(await this.http.read(path), "incident")
    const namedRoot = incident.optionalString("rootCauseIncidentId")
    const rootId =
      namedRoot === undefined
        ? undefined
        : rootIdOfCopy({ rootCauseIncidentId: namedRoot, id: incident.requiredString("id") })
    if (rootId === undefined) {
      return incident
    }
    const root = await this.http.find(`/incident/${RequestArguments.segment(rootId)}`)
    return root === undefined ? undefined : JsonView.of(root, "root cause incident")
  }
}
