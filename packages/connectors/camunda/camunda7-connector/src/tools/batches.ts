import { getBatchInput } from "@miragon/pulse-camunda7-client/schemas"
import type { createToolRegistrar } from "@miragon/mcp-toolkit-core/tools"
import { readBatch } from "@miragon/pulse-camunda7-client"
import type { EngineRegistry } from "../lib/resolve-engine.js"
import { engineParamShape, withEngine } from "../lib/with-engine.js"

type Register = ReturnType<typeof createToolRegistrar<EngineRegistry>>

/** Batch writes only report a QUEUED batch; this read says what became of it. */
export function registerBatchTools(register: Register) {
  register({
    name: "camunda7_get_batch",
    category: "batches",
    description:
      "Status of a batch from a batch tool: running, failing (batch jobs out of retries; it cannot finish until they " +
      "are retried), suspended or completed, with job counts while it runs.",
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    inputSchema: { ...getBatchInput.shape, ...engineParamShape },
    handler: withEngine(async (client, args) => readBatch(client, args.batchId)),
  })
}
