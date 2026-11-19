import { C8_WORLD, type C8SeedEngine, type C8SeedRequest } from "./c8-world.js"

interface DeploymentAnswer {
  readonly deployments: readonly {
    readonly processDefinition?: { readonly processDefinitionKey: string }
  }[]
}

export class C8SeedCalls {
  private static readonly BOUNDARY = "pulse-c8-world"

  constructor(private readonly engine: C8SeedEngine) {}

  post<Body>(path: string, body: unknown): Promise<Body> {
    return this.json<Body>(path, C8SeedCalls.jsonRequest("POST", body))
  }

  async put(path: string, body: unknown): Promise<void> {
    await this.json(path, C8SeedCalls.jsonRequest("PUT", body))
  }

  async deploy(process: string, diagram: string): Promise<string> {
    const answer = await this.json<DeploymentAnswer>(
      "/deployments",
      C8SeedCalls.deploymentRequest(process, diagram),
    )
    const key = answer.deployments[0]?.processDefinition?.processDefinitionKey
    if (key === undefined) {
      throw new Error(`deploying ${process} created no process definition`)
    }
    return key
  }

  async until<Result>(what: string, read: () => Promise<Result | undefined>): Promise<Result> {
    const deadline = this.engine.now() + C8_WORLD.settledWithinMs
    for (;;) {
      const result = await read()
      if (result !== undefined) {
        return result
      }
      if (this.engine.now() > deadline) {
        throw new Error(`the cluster did not show ${what} within ${C8_WORLD.settledWithinMs} ms`)
      }
      await this.engine.wait(C8_WORLD.pollIntervalMs)
    }
  }

  private async json<Body>(path: string, request: C8SeedRequest): Promise<Body> {
    const answer = await this.engine.send(`${this.engine.url}${path}`, request)
    const text = await answer.text()
    if (!answer.ok) {
      throw new Error(`${request.method} ${path}: HTTP ${answer.status} ${text}`)
    }
    return (text === "" ? undefined : JSON.parse(text)) as Body
  }

  private static jsonRequest(method: C8SeedRequest["method"], body: unknown): C8SeedRequest {
    return { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
  }

  private static deploymentRequest(process: string, diagram: string): C8SeedRequest {
    const boundary = C8SeedCalls.BOUNDARY
    const body = [
      `--${boundary}`,
      `Content-Disposition: form-data; name="resources"; filename="${process}.bpmn"`,
      "Content-Type: application/xml",
      "",
      diagram,
      `--${boundary}--`,
      "",
    ].join("\r\n")
    return {
      method: "POST",
      headers: { "Content-Type": `multipart/form-data; boundary=${boundary}` },
      body,
    }
  }
}
