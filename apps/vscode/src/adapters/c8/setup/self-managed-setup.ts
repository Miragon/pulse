import {
  ProfileRules,
  SetupRules,
  type EngineSetup,
  type SetupChoice,
  type SetupCredentials,
  type SetupField,
  type SetupValues,
} from "../../../contract/index.js"
import { SetupAddress } from "./setup-address.js"

const LOGINS: readonly SetupChoice[] = [
  { value: "none", label: "No login", detail: "The REST API answers without credentials." },
  { value: "basic", label: "Basic auth", detail: "A username and password of the cluster." },
  {
    value: "oidc",
    label: "OIDC client credentials",
    detail:
      "A client ID and secret that your identity provider, such as Keycloak or Microsoft Entra ID, exchanges for tokens.",
  },
]
const REST_PATH = /\/v2$/
const WEB_APP_PATH = /\/operate$/
const NOT_A_NAME = /[^A-Za-z0-9._-]+/g

export class SelfManagedSetup implements EngineSetup {
  readonly label = "Camunda 8 Self-Managed"

  readonly detail =
    "Your own cluster's REST API: without login, with basic auth or with OIDC client credentials."

  readonly title = "Camunda 8 Self-Managed"

  readonly fields: readonly SetupField[]

  constructor() {
    this.fields = [
      ...SelfManagedSetup.addressFields(),
      {
        key: "login",
        title: "Login",
        prompt: "How does the REST API check who calls it?",
        choices: LOGINS,
      },
      ...SelfManagedSetup.basicFields(),
      ...SelfManagedSetup.oidcFields(),
    ]
  }

  suggestedName(values: SetupValues): string {
    const url = SetupAddress.of(SetupRules.valueOf(values, "url"))
    const host = url === undefined ? "" : new URL(url).hostname.replace(NOT_A_NAME, "-")
    return `c8-${host.replace(/^-+|-+$/g, "")}`
  }

  profileOf(values: SetupValues): Readonly<Record<string, unknown>> {
    const operate = SetupAddress.of(SetupRules.valueOf(values, "operateUrl"))
    return {
      url: SetupAddress.of(SetupRules.valueOf(values, "url")),
      ...(operate === undefined ? {} : { cockpitUrl: operate }),
      flavor: "camunda8",
      ...SelfManagedSetup.authOf(values),
    }
  }

  credentialsOf(values: SetupValues): SetupCredentials | undefined {
    const login = SetupRules.valueOf(values, "login")
    if (login === "basic") {
      return {
        identity: SetupRules.valueOf(values, "username"),
        secret: SetupRules.valueOf(values, "password"),
      }
    }
    return login === "oidc"
      ? {
          identity: SetupRules.valueOf(values, "clientId"),
          secret: SetupRules.valueOf(values, "clientSecret"),
        }
      : undefined
  }

  private static addressFields(): SetupField[] {
    return [
      {
        key: "url",
        title: "REST address",
        prompt:
          "The address of the cluster's REST API, ending in /v2, for example https://camunda.example.com/v2.",
        problem: (value) => SelfManagedSetup.addressProblem(value, REST_PATH, "/v2"),
      },
      {
        key: "operateUrl",
        title: "Operate address",
        prompt:
          "The address of Operate, ending in /operate. Pulse links to it; leave it empty for no links.",
        optional: true,
        initial: (values) =>
          SetupAddress.of(SetupRules.valueOf(values, "url"))?.replace(REST_PATH, "/operate") ?? "",
        problem: (value) => SelfManagedSetup.addressProblem(value, WEB_APP_PATH, "/operate"),
      },
    ]
  }

  private static basicFields(): SetupField[] {
    const basic = (values: SetupValues) => values.login === "basic"
    return [
      {
        key: "username",
        title: "Username",
        prompt: "A user of the cluster. Pulse needs read permissions only.",
        when: basic,
        problem: SetupRules.notBlank("the username"),
      },
      {
        key: "password",
        title: "Password",
        prompt: "Pulse keeps it in VS Code's secret storage and sends it only to the cluster.",
        password: true,
        when: basic,
        problem: SetupRules.notBlank("the password"),
      },
    ]
  }

  private static oidcFields(): SetupField[] {
    const oidc = (values: SetupValues) => values.login === "oidc"
    return [
      {
        key: "tokenEndpoint",
        title: "Token endpoint",
        prompt:
          "The URL that issues tokens, for example https://keycloak.example.com/realms/camunda/protocol/openid-connect/token.",
        when: oidc,
        problem: (value) => SelfManagedSetup.tokenEndpointProblem(value),
      },
      {
        key: "audience",
        title: "Audience",
        prompt:
          "The audience your identity provider puts into the tokens for the cluster, if it needs one. Leave it empty otherwise.",
        optional: true,
        when: oidc,
      },
      {
        key: "scopes",
        title: "Scopes",
        prompt:
          "Scopes to ask for, separated by spaces, for example api://camunda/.default for Microsoft Entra ID. Leave it empty otherwise.",
        optional: true,
        when: oidc,
        problem: (value) => SelfManagedSetup.scopesProblem(value),
      },
      {
        key: "clientId",
        title: "Client ID",
        prompt:
          "The ID of the client your identity provider issued for Pulse. Pulse needs read permissions only.",
        when: oidc,
        problem: SetupRules.notBlank("the client ID"),
      },
      {
        key: "clientSecret",
        title: "Client secret",
        prompt:
          "Pulse keeps it in VS Code's secret storage and sends it only to the token endpoint.",
        password: true,
        when: oidc,
        problem: SetupRules.notBlank("the client secret"),
      },
    ]
  }

  private static authOf(values: SetupValues): {
    readonly auth?: Readonly<Record<string, unknown>>
  } {
    const login = SetupRules.valueOf(values, "login")
    if (login === "basic") {
      return { auth: { type: "basic" } }
    }
    if (login !== "oidc") {
      return {}
    }
    const scopes = SelfManagedSetup.scopesOf(SetupRules.valueOf(values, "scopes"))
    const audience = SetupRules.valueOf(values, "audience")
    return {
      auth: {
        type: "clientCredentials",
        tokenEndpoint: SetupRules.valueOf(values, "tokenEndpoint"),
        ...(scopes.length === 0 ? {} : { scopes }),
        ...(audience === "" ? {} : { audience }),
      },
    }
  }

  private static addressProblem(value: string, path: RegExp, ending: string): string | undefined {
    const url = SetupAddress.of(value)
    if (url === undefined) {
      return "Enter an http or https address without credentials, query or fragment."
    }
    return path.test(url) ? undefined : `End the address with ${ending}.`
  }

  private static tokenEndpointProblem(value: string): string | undefined {
    const written = SetupAddress.asWritten(value)
    return "needs" in written ? `Enter a token endpoint ${written.needs}.` : undefined
  }

  private static scopesProblem(value: string): string | undefined {
    return ProfileRules.isScopeList(SelfManagedSetup.scopesOf(value))
      ? undefined
      : "Separate distinct scopes with spaces. A scope has no quotes or backslashes."
  }

  private static scopesOf(value: string): string[] {
    return value.split(/\s+/).filter((scope) => scope !== "")
  }
}
