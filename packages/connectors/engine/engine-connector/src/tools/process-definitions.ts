import { listProcessDefinitionsInput, getProcessDefinitionXmlInput } from "../schemas/index.js"
import type { ToolRegistrar } from "@miragon/pulse-widget-shell/server"
import { engineLike, engineSorting, trueOnly } from "@miragon/pulse-engine-core"
import { getProcessDefinitions, getProcessDefinitionsCount } from "@miragon/pulse-engine-client/sdk"
import { paginatedListOutput, toPaginatedList } from "../lib/pagination.js"
import type { EngineRegistry } from "../lib/resolve-engine.js"
import { engineParamShape, withEngine } from "../lib/with-engine.js"
import { fetchDefinitionXml } from "../lib/definition-xml.js"

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
