import { getBatchInput } from "../schemas/index.js"
import type { ToolRegistrar } from "@miragon/pulse-widget-shell/server"
import { readBatch } from "@miragon/pulse-engine-client"
import type { EngineRegistry } from "../lib/resolve-engine.js"
import { engineParamShape, withEngine } from "../lib/with-engine.js"

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
    handler: withEngine(async (client, args) => readBatch(client, args.batchId)),
  })
}
