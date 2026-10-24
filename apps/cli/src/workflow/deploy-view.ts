/**
 * The resources of a deployment as `operate deploy` reports them (design §17.8): which ones were
 * deployed now, and the definitions in effect for every resource.
 */

import type { EnginePort } from "../engine-port/engine-port.js"
import type { Resource } from "../operation/multipart.js"
import { isBpmn, isDmn } from "../operation/resources.js"
import { compact, isRecord } from "../util.js"
import { json } from "./engine.js"
import { amount, compareText, field, type Rec, records, str } from "./records.js"

type DefinitionType = "process" | "decision" | "drd"

interface DefinitionSummary {
  readonly type: DefinitionType
  readonly key: string
  readonly version: number
  readonly id: string
  readonly name?: string
}

interface ResourceView {
  readonly resource: string
  readonly status: "deployed" | "unchanged"
  readonly definitions: readonly DefinitionSummary[]
}

export interface DeployResult {
  readonly deploymentId: string
  readonly name: string
  readonly changed: boolean
  readonly deploymentTime: string
  readonly resources: readonly ResourceView[]
}

/** The `deployed*` maps of a deployment and their definition type. */
const DEPLOYED_MAPS: readonly (readonly [string, DefinitionType])[] = [
  ["deployedProcessDefinitions", "process"],
  ["deployedDecisionDefinitions", "decision"],
  ["deployedDecisionRequirementsDefinitions", "drd"],
]

function summary(type: DefinitionType, dto: Rec): DefinitionSummary {
  return {
    type,
    key: field(dto, "key"),
    version: amount(dto, "version"),
    id: field(dto, "id"),
    ...compact({ name: str(dto, "name") }),
  }
}

/** The definitions of the `deployed*` maps with the resource they come from. */
function deployedDefinitions(
  deployment: Rec,
): { resource: string; definition: DefinitionSummary }[] {
  return DEPLOYED_MAPS.flatMap(([property, type]) => {
    const map = deployment[property]
    return isRecord(map)
      ? records(Object.values(map)).map((dto) => ({
          resource: field(dto, "resource"),
          definition: summary(type, dto),
        }))
      : []
  })
}

/** The list operations that find the definitions of a resource. */
function lookupsOf(resource: string): (readonly [string, DefinitionType])[] {
  if (isBpmn(resource)) return [["getProcessDefinitions", "process"]]
  if (!isDmn(resource)) return []
  return [
    ["getDecisionDefinitions", "decision"],
    ["getDecisionRequirementsDefinitions", "drd"],
  ]
}

/** The highest version per key. */
function latestPerKey(rows: readonly Rec[]): Rec[] {
  const byKey = new Map<string, Rec>()
  for (const row of rows) {
    const current = byKey.get(field(row, "key"))
    if (current === undefined || amount(row, "version") > amount(current, "version")) {
      byKey.set(field(row, "key"), row)
    }
  }
  return [...byKey.values()]
}

/** Every version of the definitions of a resource name, engine-wide (filtered later). */
async function definitionRows(port: EnginePort, resource: string, tenantId: string | undefined) {
  const query = { resourceName: resource, tenantIdIn: tenantId }
  return Promise.all(
    lookupsOf(resource).map(async ([operationId, type]) => ({
      type,
      rows: (await port.list(operationId, query)).items,
    })),
  )
}

type DefinitionRows = Awaited<ReturnType<typeof definitionRows>>

/**
 * The definitions in effect for an unchanged resource: the latest version per key among the
 * deployments of this name and source. A resource of the same name in another deployment (another
 * team's `diagram_1.bpmn` on a shared engine) is not this file.
 */
function ownDefinitions(found: DefinitionRows, deployments: ReadonlySet<string>) {
  return found.flatMap(({ type, rows }) =>
    latestPerKey(rows.filter((row) => deployments.has(field(row, "deploymentId")))).map((dto) =>
      summary(type, dto),
    ),
  )
}

/** The ids of the deployments of this name and source (they hold the unchanged resources). */
async function ownDeployments(port: EnginePort, facts: DeploymentFacts): Promise<Set<string>> {
  const query = { name: facts.name, source: facts.source, tenantIdIn: facts.tenantId }
  const page = await port.list("getDeployments", query)
  return new Set(page.items.flatMap((row) => str(row, "id") ?? []))
}

function sorted(definitions: readonly DefinitionSummary[]): DefinitionSummary[] {
  const order: readonly DefinitionType[] = ["process", "decision", "drd"]
  return definitions.toSorted(
    (left, right) =>
      order.indexOf(left.type) - order.indexOf(right.type) || compareText(left.key, right.key),
  )
}

export interface DeploymentFacts {
  readonly deployment: Rec
  readonly changed: boolean
  readonly resources: readonly Resource[]
  /** Deployment name and source: unchanged resources are looked up in these deployments only. */
  readonly name: string
  readonly source: string
  readonly tenantId?: string | undefined
}

/** Per resource: deployed now or unchanged, with the definitions in effect. */
export async function resourceViews(
  port: EnginePort,
  facts: DeploymentFacts,
): Promise<DeployResult> {
  const { deployment, changed } = facts
  const deploymentId = field(deployment, "id")
  const deployed = deployedDefinitions(deployment)
  const withDefinitions = new Set(deployed.map((entry) => entry.resource))
  const unchanged = facts.resources.filter(
    (resource) => !withDefinitions.has(resource.name) && lookupsOf(resource.name).length > 0,
  )
  const [held, deployments, found] = await Promise.all([
    changed ? json(port, "getDeploymentResources", { pathArgs: [deploymentId], query: {} }) : [],
    unchanged.length > 0 ? ownDeployments(port, facts) : new Set<string>(),
    Promise.all(
      unchanged.map(async (resource) => definitionRows(port, resource.name, facts.tenantId)),
    ),
  ])
  const latest = new Map(
    unchanged.map((resource, index) => [
      resource.name,
      ownDefinitions(found[index] ?? [], deployments),
    ]),
  )
  const deployedNow = new Set(records(held).flatMap((resource) => str(resource, "name") ?? []))
  return {
    deploymentId,
    name: field(deployment, "name"),
    changed,
    deploymentTime: field(deployment, "deploymentTime"),
    resources: facts.resources.map((resource): ResourceView => {
      const own = deployed
        .filter((entry) => entry.resource === resource.name)
        .map((entry) => entry.definition)
      const now = deployedNow.has(resource.name) || own.length > 0
      return {
        resource: resource.name,
        status: now ? "deployed" : "unchanged",
        definitions: sorted(now ? own : (latest.get(resource.name) ?? [])),
      }
    }),
  }
}
