import { buildProcessListData } from "../data/cockpit-data.js"
import { adapterStep, stringKey } from "./shared.js"

export const loadProcessDefinitionsStep = adapterStep({
  name: "load-process-definitions",
  description:
    "Deployed process definitions (latest version of each, first page, exact total). Powers camunda7:process-list.",
  dataType: "camunda7:processDefinitionList",
  optionalKeys: [
    {
      key: "camunda7:processDefinitionKey",
      description: "Restrict the list to this exact definition key.",
    },
    {
      key: "camunda7:nameLike",
      description: "Filter by definition name (substring; % wildcards allowed).",
    },
  ],
  read: (context, { client, engineId }) =>
    buildProcessListData(client, engineId, {
      processDefinitionKey: stringKey(context, "camunda7:processDefinitionKey"),
      nameLike: stringKey(context, "camunda7:nameLike"),
    }),
  produces: { "camunda7:definitions": (data) => data.definitions },
})
