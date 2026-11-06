import { SaasSetup } from "./saas-setup.js"
import { SelfManagedSetup } from "./self-managed-setup.js"
import type { EngineSetup, SetupChoice } from "./setup-field.js"

const KINDS: readonly SetupChoice[] = [
  {
    value: "saas",
    label: "Camunda 8 SaaS",
    detail: "A cluster in Camunda Hub, read with an API client's ID and secret.",
  },
  {
    value: "selfManaged",
    label: "Camunda 8 Self-Managed",
    detail:
      "Your own cluster's REST API: without login, with basic auth or with OIDC client credentials.",
  },
  {
    value: "projectFile",
    label: "Camunda 7, Operaton or CIB seven",
    detail: "Opens .pulse-cli.json, with a profile to fill in if the folder has none yet.",
  },
]

export class SetupKinds {
  static choices(): readonly SetupChoice[] {
    return KINDS
  }

  static setupOf(kind: string, taken: ReadonlySet<string>): EngineSetup | undefined {
    if (kind === "saas") {
      return new SaasSetup(taken)
    }
    return kind === "selfManaged" ? new SelfManagedSetup(taken) : undefined
  }
}
