import {
  listProcessDefinitionsInput,
  getProcessDefinitionXmlInput,
} from "@miragon/pulse-camunda7-client/schemas"
import type { createToolRegistrar } from "@miragon/mcp-toolkit-core/tools"
import { engineLike, engineSorting, trueOnly } from "@miragon/pulse-camunda7-client"
import {
  getProcessDefinitions,
  getProcessDefinitionsCount,
} from "@miragon/pulse-camunda7-client/sdk"
import { paginatedListOutput, toPaginatedList } from "../lib/pagination.js"
import type { EngineRegistry } from "../lib/resolve-engine.js"
import { engineParamShape, withEngine } from "../lib/with-engine.js"
import { fetchDefinitionXml } from "../lib/definition-xml.js"

type Register = ReturnType<typeof createToolRegistrar<EngineRegistry>>

export function registerProcessDefinitionTools(register: Register) {
  register({
    name: "camunda7_list_process_definitions",
    category: "process-definitions",
    description:
      "List deployed process definitions (key, name, version, deployment) with optional filters. " +
      "Returns one page as { items, totalCount, hasMore, nextOffset? }. If hasMore is true, call again with firstResult = nextOffset.",
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
    name: "camunda7_get_process_definition_xml",
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
