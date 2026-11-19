import {
  C8_WORLD,
  type C8SeedEngine,
  type C8SeededWorld,
  type C8WorldDeployment,
  type C8WorldPlan,
  type C8WorldValue,
} from "./c8-world.js"
import { C8SeedCalls } from "./seed-calls.js"

interface Items<Item> {
  readonly items: readonly Item[]
}

interface DefinitionStatistics {
  readonly processDefinitionId: string
  readonly activeInstancesWithoutIncidentCount: number
  readonly activeInstancesWithIncidentCount: number
}

type LocalVariable = C8WorldPlan<string, string>["localVariable"]

export class C8WorldSeed<Deployment extends string, Instance extends string> {
  private readonly calls: C8SeedCalls

  private constructor(
    engine: C8SeedEngine,
    private readonly plan: C8WorldPlan<Deployment, Instance>,
  ) {
    this.calls = new C8SeedCalls(engine)
  }

  static async seed<Deployment extends string, Instance extends string>(
    engine: C8SeedEngine,
    plan: C8WorldPlan<Deployment, Instance>,
  ): Promise<C8SeededWorld<Deployment, Instance>> {
    const seed = new C8WorldSeed(engine, plan)
    const definitionIds = await seed.deployWorld()
    const instanceIds = await seed.startWorld(definitionIds)
    for (const type of C8_WORLD.failingJobTypes) {
      await seed.failJobsOf(type)
    }
    const local = plan.localVariable
    await seed.addLocalVariable(instanceIds[local.instance], local)
    await seed.untilExported(instanceIds[local.instance], local.name)
    return { definitionIds, instanceIds, unknown: C8_WORLD.unknown }
  }

  private async deployWorld(): Promise<Record<Deployment, string>> {
    const definitionIds: Partial<Record<Deployment, string>> = {}
    for (const alias of C8_WORLD.deploymentOrder) {
      const deployment = this.deploymentOf(alias)
      const diagram = this.diagramOf(deployment.process)
      const marked = deployment.version > 1 ? `${diagram}\n<!-- ${alias} -->\n` : diagram
      definitionIds[deployment.alias] = await this.calls.deploy(deployment.process, marked)
    }
    return definitionIds as Record<Deployment, string>
  }

  private async startWorld(
    definitionIds: Readonly<Record<Deployment, string>>,
  ): Promise<Record<Instance, string>> {
    const instanceIds: Partial<Record<Instance, string>> = {}
    for (const instance of this.plan.instances) {
      const variables = Object.entries(instance.variables).map(
        ([name, value]) => [name, C8WorldSeed.plainValue(value)] as const,
      )
      const started = await this.calls.post<{ readonly processInstanceKey: string }>(
        "/process-instances",
        {
          processDefinitionKey: definitionIds[instance.deployment],
          businessId: instance.businessKey,
          variables: Object.fromEntries(variables),
        },
      )
      instanceIds[instance.businessKey] = started.processInstanceKey
    }
    return instanceIds as Record<Instance, string>
  }

  private async failJobsOf(type: string): Promise<void> {
    const jobs = await this.calls.until(`a job of ${type}`, async () => {
      const answer = await this.calls.post<{ readonly jobs: readonly { jobKey: string }[] }>(
        "/jobs/activation",
        { type, worker: "pulse-seed", timeout: 60_000, maxJobsToActivate: 10 },
      )
      return answer.jobs.length > 0 ? answer.jobs : undefined
    })
    for (const job of jobs) {
      await this.calls.post(`/jobs/${job.jobKey}/failure`, {
        retries: 0,
        errorMessage: C8_WORLD.workerError,
      })
    }
  }

  private async addLocalVariable(instanceId: string, variable: LocalVariable): Promise<void> {
    const element = await this.calls.until("the element of the local variable", async () => {
      const answer = await this.calls.post<Items<{ readonly elementInstanceKey: string }>>(
        "/element-instances/search",
        { filter: { processInstanceKey: instanceId, elementId: variable.elementId } },
      )
      return answer.items[0]
    })
    await this.calls.put(`/element-instances/${element.elementInstanceKey}/variables`, {
      variables: { [variable.name]: variable.value },
      local: true,
    })
  }

  private async untilExported(instanceId: string, name: string): Promise<void> {
    await this.calls.until("the world in its secondary storage", async () => {
      const [statistics, incidents, local] = await Promise.all([
        this.calls.post<Items<DefinitionStatistics>>(
          "/process-definitions/statistics/process-instances",
          {},
        ),
        this.calls.post<Items<unknown>>("/incidents/search", { filter: { state: "ACTIVE" } }),
        this.calls.post<Items<unknown>>("/variables/search", {
          filter: { processInstanceKey: instanceId, name },
        }),
      ])
      const exported =
        C8WorldSeed.countsFit(statistics) &&
        incidents.items.length === C8_WORLD.openIncidents &&
        local.items.length === 1
      return exported ? true : undefined
    })
  }

  private deploymentOf(alias: string): C8WorldDeployment<Deployment> {
    const deployment = this.plan.deployments.find((candidate) => candidate.alias === alias)
    if (deployment === undefined) {
      throw new Error(`the world has no deployment ${alias}`)
    }
    return deployment
  }

  private diagramOf(process: string): string {
    const diagram = this.plan.diagrams[process]
    if (diagram === undefined) {
      throw new Error(`the world has no diagram of ${process}`)
    }
    return diagram
  }

  private static plainValue(value: C8WorldValue): string | number | null {
    return typeof value === "object" && value !== null ? value.date : value
  }

  private static countsFit(statistics: Items<DefinitionStatistics>): boolean {
    return Object.entries(C8_WORLD.activeByProcess).every(([process, expected]) => {
      const row = statistics.items.find((item) => item.processDefinitionId === process)
      return (
        row?.activeInstancesWithoutIncidentCount === expected.withoutIncident &&
        row.activeInstancesWithIncidentCount === expected.withIncident
      )
    })
  }
}
