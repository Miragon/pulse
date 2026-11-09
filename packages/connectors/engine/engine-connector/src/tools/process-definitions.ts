import { listProcessDefinitionsInput, getProcessDefinitionXmlInput } from "../schemas/index.js"
import type { ToolRegistrar } from "@miragon/pulse-widget-shell/server"
import { engineLike, engineSorting, trueOnly } from "@miragon/pulse-c7-core"
import { getProcessDefinitions, getProcessDefinitionsCount } from "@miragon/pulse-c7-client/sdk"
import { paginatedListOutput, toPaginatedList } from "../lib/mcp/pagination.js"
import type { EngineRegistry } from "../lib/engine/resolve-engine.js"
import { engineParamShape, withEngine } from "../lib/engine/with-engine.js"
import { fetchDefinitionXml } from "../lib/bpmn/definition-xml.js"

export function registerProcessDefinitionTools(register: ToolRegistrar<EngineRegistry>) {
  register({
    name: "engine_list_process_definitions",
    category: "process-definitions",
    description: "List deployed process definitions (key, name, version, deployment).",
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    inputSchema: { ...listProcessDefinitionsInput.shape, ...engineParamShape },
    outputSchema: paginatedListOutput,
    handler: withEngine(async (client, args) => {
      const filters = {
        key: args.processDefinitionKey,
        nameLike: engineLike(args.nameLike),
        latestVersion: trueOnly(args.latestVersion),
      }
      const [items, count] = await Promise.all([
        getProcessDefinitions({
          client,
          query: {
            ...filters,
            firstResult: args.firstResult,
            maxResults: args.maxResults,
            ...engineSorting(args),
          },
        }),
        getProcessDefinitionsCount({ client, query: filters }),
      ])
      return toPaginatedList(items, count, args.firstResult)
    }),
  })

  register({
    name: "engine_get_process_definition_xml",
    category: "process-definitions",
    description:
      "Get the BPMN 2.0 XML of a process definition by ID. Returns the raw BPMN XML string.",
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    inputSchema: { ...getProcessDefinitionXmlInput.shape, ...engineParamShape },
    handler: withEngine(async (client, args) => ({
      id: args.processDefinitionId,
      bpmn20Xml: await fetchDefinitionXml(client, args.processDefinitionId),
    })),
  })
}
