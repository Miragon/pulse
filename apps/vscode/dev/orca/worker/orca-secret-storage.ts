import type * as vscode from "vscode"
import type { OrcaWorkerApi } from "orca/worker"

type SecretsApi = OrcaWorkerApi["secrets"]

export class OrcaSecretStorage implements vscode.SecretStorage {
  constructor(private readonly secrets: SecretsApi) {}

  async get(key: string): Promise<string | undefined> {
    return (await this.secrets.get(key)) ?? undefined
  }

  async store(key: string, value: string): Promise<void> {
    await this.secrets.set(key, value)
  }

  async delete(key: string): Promise<void> {
    await this.secrets.delete(key)
  }

  keys(): Promise<string[]> {
    return Promise.resolve([])
  }

  onDidChange(): vscode.Disposable {
    return { dispose: () => undefined }
  }
}
