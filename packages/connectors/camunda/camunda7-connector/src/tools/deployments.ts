import type { z } from "zod"
import {
  listDeploymentsInput,
  createDeploymentInput,
  getDeploymentInput,
} from "@miragon/pulse-camunda7-client/schemas"
import type { createToolRegistrar } from "@miragon/mcp-toolkit-core/tools"
import { engineLike, engineSorting } from "@miragon/pulse-camunda7-client"
import {
  getDeployments,
  getDeploymentsCount,
  getDeployment,
  createDeployment,
} from "@miragon/pulse-camunda7-client/sdk"
import type { MultiFormDeploymentDto } from "@miragon/pulse-camunda7-client/types"
import { paginatedListOutput, toPaginatedList } from "../lib/pagination.js"
import type { EngineRegistry } from "../lib/resolve-engine.js"
import { engineParamShape, withEngine } from "../lib/with-engine.js"

type Register = ReturnType<typeof createToolRegistrar<EngineRegistry>>

/**
 * A PLAIN record: the SDK serializer walks `Object.entries(body)`, so a prebuilt `FormData`
 * went out EMPTY (#326). Part names are synthetic (`resource-<n>`) because the engine reads
 * reserved part names (`tenant-id`, …) as fields, which a resource could otherwise hijack.
 */
type DeploymentForm = MultiFormDeploymentDto & Record<`resource-${number}`, File>

function deploymentForm(args: z.infer<typeof createDeploymentInput>): DeploymentForm {
  const form: DeploymentForm = {
    "deployment-name": args.deploymentName,
    "enable-duplicate-filtering": args.enableDuplicateFiltering,
    "deploy-changed-only": args.deployChangedOnly,
    "deployment-source": args.deploymentSource || undefined,
    "tenant-id": args.tenantId || undefined,
  }
  args.resources.forEach((resource, index) => {
    form[`resource-${index}`] = new File([resource.content], resource.name)
  })
  return form
}

export function registerDeploymentTools(
  register: Register,
  { allowDeployments }: { allowDeployments: boolean },
) {
  register({
    name: "camunda7_get_deployment",
    category: "deployments",
    description:
      "Get a deployment by ID — returns deployment timestamp + source, used for pre/post deployment correlation (commit-hash → deployment-ID → timestamp).",
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    inputSchema: { ...getDeploymentInput.shape, ...engineParamShape },
    handler: withEngine(async (client, args) =>
      getDeployment({ client, path: { id: args.deploymentId } }),
    ),
  })

  register({
    name: "camunda7_list_deployments",
    category: "deployments",
    description:
      "List deployments with optional filters. Returns one page as { items, totalCount, hasMore, nextOffset? }. If hasMore is true, call again with firstResult = nextOffset.",
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    inputSchema: { ...listDeploymentsInput.shape, ...engineParamShape },
    outputSchema: paginatedListOutput,
    handler: withEngine(async (client, args) => {
      const filters = { name: args.name, nameLike: engineLike(args.nameLike) }
      const [items, count] = await Promise.all([
        getDeployments({
          client,
          query: {
            ...filters,
            firstResult: args.firstResult,
            maxResults: args.maxResults,
            ...engineSorting(args),
          },
        }),
        getDeploymentsCount({ client, query: filters }),
      ])
      return toPaginatedList(items, count, args.firstResult)
    }),
  })

  // Deploying IS code execution in the engine JVM (JUEL alone suffices), so this is opt-in on
  // top of admin-only.
  if (!allowDeployments) return

  register({
    name: "camunda7_create_deployment",
    category: "deployments",
    description:
      "Deploy BPMN process definitions and other resources to the engine. Supports duplicate filtering and deploy-changed-only. " +
      "WARNING: deploying runs code inside the engine JVM — expressions, scripts and listener/delegate references in the " +
      "deployed models execute with the engine's privileges. Available only in the admin toolset with CAMUNDA_ALLOW_DEPLOYMENTS=true.",
    annotations: { destructiveHint: true, openWorldHint: true },
    inputSchema: { ...createDeploymentInput.shape, ...engineParamShape },
    handler: withEngine(async (client, args) =>
      createDeployment({ client, body: deploymentForm(args) }),
    ),
  })
}
