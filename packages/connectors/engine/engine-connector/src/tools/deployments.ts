import type { z } from "zod"
import {
  listDeploymentsInput,
  createDeploymentInput,
  getDeploymentInput,
} from "../schemas/index.js"
import type { ToolRegistrar } from "@miragon/pulse-widget-shell/server"
import { engineLike, engineSorting } from "@miragon/pulse-engine-core"
import {
  getDeployments,
  getDeploymentsCount,
  getDeployment,
  createDeployment,
} from "@miragon/pulse-engine-client/sdk"
import type { MultiFormDeploymentDto } from "@miragon/pulse-engine-client/types"
import { paginatedListOutput, toPaginatedList } from "../lib/mcp/pagination.js"
import type { EngineRegistry } from "../lib/engine/resolve-engine.js"
import { engineParamShape, withEngine } from "../lib/engine/with-engine.js"

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
  register: ToolRegistrar<EngineRegistry>,
  { allowDeployments }: { allowDeployments: boolean },
) {
  register({
    name: "engine_get_deployment",
    category: "deployments",
    description:
      "Get a deployment by ID: its timestamp and source, for pre/post deployment correlation (commit hash → deployment ID → timestamp).",
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    inputSchema: { ...getDeploymentInput.shape, ...engineParamShape },
    handler: withEngine(async (client, args) =>
      getDeployment({ client, path: { id: args.deploymentId } }),
    ),
  })

  register({
    name: "engine_list_deployments",
    category: "deployments",
    description: "List deployments.",
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
    name: "engine_create_deployment",
    category: "deployments",
    description:
      "Deploy BPMN process definitions and other resources to the engine. Supports duplicate filtering and deploy-changed-only. " +
      "WARNING: deploying runs code inside the engine JVM, since expressions, scripts and listener/delegate references in the " +
      "deployed models execute with the engine's privileges. Available only in the admin toolset with ENGINE_ALLOW_DEPLOYMENTS=true.",
    annotations: { destructiveHint: true, openWorldHint: true },
    inputSchema: { ...createDeploymentInput.shape, ...engineParamShape },
    handler: withEngine(async (client, args) =>
      createDeployment({ client, body: deploymentForm(args) }),
    ),
  })
}
