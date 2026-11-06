import {
  SetupRules,
  type EngineSetup,
  type SetupCredentials,
  type SetupField,
  type SetupValues,
} from "../../../contract/index.js"

const REGION = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const CLUSTER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const TOKEN_ENDPOINT = "https://login.cloud.camunda.io/oauth/token"
const AUDIENCE = "zeebe.camunda.io"
const FROM_HUB = "Camunda Hub shows it in the API client's connection information as"

export class SaasSetup implements EngineSetup {
  readonly label = "Camunda 8 SaaS"

  readonly detail = "A cluster in Camunda Hub, read with an API client's ID and secret."

  readonly title = "Camunda 8 SaaS"

  readonly fields: readonly SetupField[]

  constructor() {
    this.fields = [
      {
        key: "region",
        title: "Region",
        prompt: `The cluster's region, for example bru-2. ${FROM_HUB} CAMUNDA_CLUSTER_REGION.`,
        problem: (value) =>
          REGION.test(value)
            ? undefined
            : "Enter the region in lowercase letters and digits, for example bru-2.",
      },
      {
        key: "clusterId",
        title: "Cluster ID",
        prompt: `${FROM_HUB} CAMUNDA_CLUSTER_ID.`,
        problem: (value) =>
          CLUSTER_ID.test(value.toLowerCase())
            ? undefined
            : "Enter the cluster ID, a UUID such as 12345678-90ab-cdef-1234-567890abcdef.",
      },
      ...SaasSetup.clientFields(),
    ]
  }

  suggestedName(values: SetupValues): string {
    return `saas-${SetupRules.valueOf(values, "region")}`
  }

  profileOf(values: SetupValues): Readonly<Record<string, unknown>> {
    const region = SetupRules.valueOf(values, "region")
    const root = `https://${region}.api.camunda.io/${SetupRules.valueOf(values, "clusterId").toLowerCase()}`
    return {
      url: `${root}/v2`,
      cockpitUrl: `${root}/operate`,
      flavor: "camunda8",
      auth: {
        type: "clientCredentials",
        tokenEndpoint: TOKEN_ENDPOINT,
        audience: SetupRules.valueOf(values, "audience"),
      },
    }
  }

  credentialsOf(values: SetupValues): SetupCredentials {
    return {
      identity: SetupRules.valueOf(values, "clientId"),
      secret: SetupRules.valueOf(values, "clientSecret"),
    }
  }

  private static clientFields(): SetupField[] {
    return [
      {
        key: "clientId",
        title: "Client ID",
        prompt: `The ID of an API client of the cluster. ${FROM_HUB} CAMUNDA_CLIENT_ID.`,
        problem: SetupRules.notBlank("the client ID"),
      },
      {
        key: "clientSecret",
        title: "Client secret",
        prompt: `${FROM_HUB} CAMUNDA_CLIENT_SECRET. Pulse keeps it in VS Code's secret storage and sends it only to login.cloud.camunda.io.`,
        password: true,
        problem: SetupRules.notBlank("the client secret"),
      },
      {
        key: "audience",
        title: "Audience",
        prompt: `The audience of the client's tokens. ${FROM_HUB} CAMUNDA_TOKEN_AUDIENCE; keep ${AUDIENCE} unless it names another.`,
        initial: () => AUDIENCE,
        problem: SetupRules.notBlank("the audience"),
      },
    ]
  }
}
