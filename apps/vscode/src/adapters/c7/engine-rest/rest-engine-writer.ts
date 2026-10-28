import type { EngineWriter, RetryOutcome } from "./engine-writer.js"
import { EngineRequestError } from "./http/engine-request-error.js"
import type { EngineHttp } from "./http/engine-http.js"
import { RequestArguments } from "./request-arguments.js"
import { BatchViewParser } from "./views/batch-view-parser.js"
import { JsonObject } from "./views/json-object.js"
import type { BatchRef } from "./views/views.js"

const RETRY_PATHS: ReadonlyMap<string, string> = new Map([
  ["failedJob", "/job"],
  ["failedExternalTask", "/external-task"],
])
const ONE_RETRY = JSON.stringify({ retries: 1 })

export class RestEngineWriter implements EngineWriter {
  constructor(private readonly http: EngineHttp) {}

  async retryIncident(incidentId: string): Promise<RetryOutcome> {
    const root = await this.rootCauseOf(incidentId)
    if (root === undefined) {
      return "gone"
    }
    const path = RETRY_PATHS.get(root.requiredString("incidentType"))
    const configuration = root.optionalString("configuration")
    if (path === undefined || configuration === undefined) {
      return "skipped"
    }
    try {
      await this.http.write(
        "PUT",
        `${path}/${RequestArguments.segment(configuration)}/retries`,
        ONE_RETRY,
      )
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
    return BatchViewParser.reference(
      await this.http.write("POST", "/process-instance/delete", body),
    )
  }

  async migrateInstancesAsync(body: string): Promise<BatchRef> {
    return BatchViewParser.reference(await this.http.write("POST", "/migration/executeAsync", body))
  }

  async suspendBatch(batchId: string): Promise<void> {
    const batch = RequestArguments.segment(batchId)
    await this.http.write("PUT", `/batch/${batch}/suspended`, JSON.stringify({ suspended: true }))
  }

  async deleteBatch(batchId: string): Promise<void> {
    const batch = RequestArguments.segment(batchId)
    await this.http.write("DELETE", `/batch/${batch}`, undefined, { cascade: "false" })
  }

  private async rootCauseOf(incidentId: string): Promise<JsonObject | undefined> {
    const path = `/incident/${RequestArguments.segment(incidentId)}`
    const incident = JsonObject.of(await this.http.read(path), "incident")
    const rootId = incident.optionalString("rootCauseIncidentId")
    if (rootId === undefined || rootId === incident.requiredString("id")) {
      return incident
    }
    const root = await this.http.find(`/incident/${RequestArguments.segment(rootId)}`)
    return root === undefined ? undefined : JsonObject.of(root, "root cause incident")
  }
}
