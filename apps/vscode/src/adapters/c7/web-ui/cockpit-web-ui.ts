import type { DefinitionRef, EngineWebUi, InstanceSummary } from "../../../contract/index.js"

interface CockpitRoutes {
  readonly root: RegExp
  readonly overview: string
  readonly instance: string
  readonly incidents: string
  readonly definition: string
}

const CLASSIC_COCKPIT: CockpitRoutes = {
  root: /^(.*\/app\/cockpit\/[^/]+)\/?$/,
  overview: "#/dashboard",
  instance: "#/process-instance/{id}/runtime",
  incidents: "?detailsTab=incidents-tab",
  definition: "#/process-definition/{id}/runtime",
}

const CIB_SEVEN_WEBCLIENT: CockpitRoutes = {
  root: /^(.*\/webapp)\/?$/,
  overview: "#/seven/auth/start",
  instance: "#/seven/auth/processes/instance/{id}",
  incidents: "?tab=incidents",
  definition: "#/seven/auth/processes/definition/{id}?tab=instances",
}

export class CockpitWebUi implements EngineWebUi {
  readonly name = "Cockpit"

  constructor(
    private readonly base: string,
    private readonly routes: CockpitRoutes,
  ) {}

  static at(webUiUrl: string): CockpitWebUi | undefined {
    if (!URL.canParse(webUiUrl)) {
      return undefined
    }
    const url = new URL(webUiUrl)
    for (const routes of [CLASSIC_COCKPIT, CIB_SEVEN_WEBCLIENT]) {
      const root = routes.root.exec(url.pathname)?.[1]
      if (root !== undefined) {
        return new CockpitWebUi(`${url.origin}${root}/`, routes)
      }
    }
    return undefined
  }

  overviewUrl(): string {
    return `${this.base}${this.routes.overview}`
  }

  instanceUrl(instance: InstanceSummary): string {
    const incidents = instance.hasIncident ? this.routes.incidents : ""
    return `${this.base}${this.route(this.routes.instance, instance.id)}${incidents}`
  }

  definitionUrl(definition: DefinitionRef): string {
    return `${this.base}${this.route(this.routes.definition, definition.id)}`
  }

  private route(template: string, id: string): string {
    return template.replace("{id}", encodeURIComponent(id).replaceAll("%3A", ":"))
  }
}
