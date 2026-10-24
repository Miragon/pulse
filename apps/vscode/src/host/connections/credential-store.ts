import type * as vscode from "vscode"
import type { Credentials } from "./connection.js"
import type { EngineTarget } from "./engine-target.js"

const PREFIX = "pulse.connection"
type Field = "username" | "password" | "origin"

export class CredentialStore {
  constructor(private readonly secrets: vscode.SecretStorage) {}

  async read(target: EngineTarget): Promise<Credentials> {
    const [username, password, origin] = await Promise.all([
      this.secrets.get(this.key(target, "username")),
      this.secrets.get(this.key(target, "password")),
      this.secrets.get(this.key(target, "origin")),
    ])
    if (username === undefined || password === undefined) {
      return { kind: "none" }
    }
    if (origin !== this.originOf(target)) {
      return { kind: "savedForAnotherEndpoint", savedFor: origin ?? "an unknown endpoint" }
    }
    return { kind: "basic", username, password }
  }

  async write(target: EngineTarget, username: string, password: string): Promise<void> {
    await this.secrets.store(this.key(target, "username"), username)
    await this.secrets.store(this.key(target, "password"), password)
    await this.secrets.store(this.key(target, "origin"), this.originOf(target))
  }

  private key(target: EngineTarget, field: Field): string {
    return `${PREFIX}.${this.secretScope(target)}.${field}`
  }

  private secretScope(target: EngineTarget): string {
    const scope = target.source.kind === "file" ? target.source.path : "default"
    return `${scope}::${target.name}`
  }

  private originOf(target: EngineTarget): string {
    return new URL(target.endpoint).origin
  }
}
