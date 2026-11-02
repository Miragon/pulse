import { correlateMessageInput, throwSignalInput } from "@miragon/pulse-camunda7-client/schemas"
import type { ToolRegistrar } from "@miragon/pulse-widget-shell/server"
import { toEngineVariables } from "@miragon/pulse-camunda7-client"
import { deliverMessage, throwSignal } from "@miragon/pulse-camunda7-client/sdk"
import type { EngineRegistry } from "../lib/resolve-engine.js"
import { engineParamShape, withEngine } from "../lib/with-engine.js"

export function registerMessageSignalTools(register: ToolRegistrar<EngineRegistry>) {
  register({
    name: "camunda7_correlate_message",
    category: "messages-signals",
    description:
      "Correlate a message to a waiting catch event or a message start event; target it via processInstanceId, " +
      "businessKey or correlationKeys. Unless all=true the engine needs EXACTLY one match: several fail, and so does " +
      "none without a message start event.",
    annotations: { destructiveHint: false, openWorldHint: true },
    inputSchema: { ...correlateMessageInput.shape, ...engineParamShape },
    handler: withEngine(async (client, args) =>
      deliverMessage({
        client,
        body: {
          messageName: args.messageName,
          processInstanceId: args.processInstanceId,
          businessKey: args.businessKey,
          correlationKeys: toEngineVariables(args.correlationKeys),
          processVariables: toEngineVariables(args.processVariables),
          all: args.all,
          resultEnabled: args.resultEnabled,
        },
      }),
    ),
  })

  register({
    name: "camunda7_throw_signal",
    category: "messages-signals",
    description:
      "Throw a signal: an ENGINE-WIDE broadcast, not a targeted call. It triggers every matching signal catch event " +
      "in every running process instance and starts a new instance through every matching signal start event. " +
      "Cannot be undone or scoped to one instance (use camunda7_correlate_message for targeted delivery).",
    // Engine-wide side effects (admin-only via ADMIN_ONLY_TOOLS).
    annotations: { destructiveHint: true, openWorldHint: true },
    inputSchema: { ...throwSignalInput.shape, ...engineParamShape },
    handler: withEngine(async (client, args) => {
      await throwSignal({
        client,
        body: {
          name: args.name,
          variables: toEngineVariables(args.variables),
        },
      })
      return { success: true, signalName: args.name }
    }),
  })
}
