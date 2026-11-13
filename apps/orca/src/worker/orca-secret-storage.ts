import type { SecretStorage } from "@miragon/pulse-runtime-view/host-kit"
import type { OrcaWorkerApi } from "orca/worker"

type SecretsApi = OrcaWorkerApi["secrets"]

export class OrcaSecretStorage implements SecretStorage {
  constructor(private readonly secrets: SecretsApi) {}

  async get(key: string): Promise<string | undefined> {
    return (await this.secrets.get(key)) ?? undefined
  }

  async store(key: string, value: string): Promise<void> {
    await this.secrets.set(key, value)
  }
}
