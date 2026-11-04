import { getBatchInput } from "../schemas/index.js"
import type { ToolRegistrar } from "@miragon/pulse-widget-shell/server"
import { readBatch, type Client } from "@miragon/pulse-engine-client"
import type { EngineRegistry } from "../lib/engine/resolve-engine.js"
import { engineParamShape, withEngine } from "../lib/engine/with-engine.js"
import { isMissingResource } from "../lib/core-adapter/engine-port.js"

/**
 * The batch, or an error that says neither the runtime nor the history knows it (a missing
 * resource by engine-core's rule); any other failure, a wrong REST root included, as it is.
 */
async function batchReport(client: Client, batchId: string) {
  try {
    return await readBatch(client, batchId)
  } catch (error) {
    if (!isMissingResource(error)) throw error
    throw new Error(
      `Batch ${batchId} not found: no running batch has this id and the engine history holds no record of it`,
      { cause: error },
    )
  }
}

/** Batch writes only report a QUEUED batch; this read says what became of it. */
export function registerBatchTools(register: ToolRegistrar<EngineRegistry>) {
  register({
    name: "engine_get_batch",
    category: "batches",
    description:
      "Status of a batch from a batch tool: running, failing (batch jobs out of retries; it cannot finish until they " +
      "are retried), suspended or completed, with job counts while it runs.",
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    inputSchema: { ...getBatchInput.shape, ...engineParamShape },
    handler: withEngine(async (client, args) => batchReport(client, args.batchId)),
  })
}
