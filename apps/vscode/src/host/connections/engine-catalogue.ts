import type { CredentialType, EngineAdapter, EngineSetup } from "../../contract/index.js"
import type { EngineTarget } from "./engine-target.js"

export type CataloguedEngine = Pick<EngineAdapter, "id" | "profiles" | "setups">

export interface EngineChoice {
  readonly label: string
  readonly detail: string
  readonly setup?: EngineSetup
}

const PROJECT_FILE = "Opens .pulse-cli.json, with a profile to fill in if the folder has none yet."

export class EngineCatalogue {
  constructor(private readonly engines: readonly CataloguedEngine[]) {}

  engineOf(flavor: unknown): string | undefined {
    const engine =
      flavor === undefined
        ? this.engines.find((each) => each.profiles.withoutFlavor)
        : this.engines.find((each) => each.profiles.flavors.some((known) => known === flavor))
    return engine?.id
  }

  knowsFlavor(flavor: string): boolean {
    return this.engines.some((each) => each.profiles.flavors.includes(flavor))
  }

  flavors(): string {
    return EngineCatalogue.listed(this.engines.flatMap((each) => each.profiles.flavors))
  }

  credentialTypesOf(engine: string): readonly CredentialType[] {
    return this.engines.find((each) => each.id === engine)?.profiles.credentials ?? []
  }

  flavorsSending(type: CredentialType): string {
    const flavors = this.engines
      .filter((each) => each.profiles.credentials.includes(type))
      .flatMap((each) => each.profiles.flavors)
    return `${flavors.length === 1 ? "the flavor" : "the flavors"} ${EngineCatalogue.listed(flavors)}`
  }

  choices(): readonly EngineChoice[] {
    return [
      ...this.engines.flatMap((each) =>
        each.setups.map((setup) => ({ label: setup.label, detail: setup.detail, setup })),
      ),
      ...this.engines
        .filter((each) => each.setups.length === 0)
        .map((each) => ({ label: each.profiles.name, detail: PROJECT_FILE })),
    ]
  }

  localTarget(): EngineTarget | undefined {
    const engine = this.engines.find((each) => each.profiles.localEndpoint !== undefined)
    return engine?.profiles.localEndpoint === undefined
      ? undefined
      : {
          name: "local",
          engine: engine.id,
          endpoint: engine.profiles.localEndpoint,
          auth: { kind: "none" },
          source: { kind: "default" },
        }
  }

  private static listed(items: readonly string[]): string {
    return items.length <= 1
      ? items.join("")
      : `${items.slice(0, -1).join(", ")} or ${items.at(-1) ?? ""}`
  }
}
