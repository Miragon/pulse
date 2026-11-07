import { ProfileAuthReader } from "./profile-auth-reader.js"
import { ProfileUrl } from "./profile-url.js"
import type {
  EngineSetup,
  SetupChoice,
  SetupCredentials,
  SetupField,
  SetupValues,
} from "./setup-field.js"
import { SetupFields } from "./setup-fields.js"

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
  readonly title = "Camunda 8 Self-Managed"

  readonly fields: readonly SetupField[]

  constructor(taken: ReadonlySet<string>) {
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
      SetupFields.name((values) => SelfManagedSetup.nameOf(values), taken),
      SetupFields.environment(),
    ]
  }

  profileOf(values: SetupValues): Readonly<Record<string, unknown>> {
    const operate = ProfileUrl.of(SetupFields.valueOf(values, "operateUrl"))
    return {
      url: ProfileUrl.of(SetupFields.valueOf(values, "url")),
      ...(operate === undefined ? {} : { cockpitUrl: operate }),
      flavor: "camunda8",
      ...SelfManagedSetup.authOf(values),
    }
  }

  credentialsOf(values: SetupValues): SetupCredentials | undefined {
    const login = SetupFields.valueOf(values, "login")
    if (login === "basic") {
      return {
        identity: SetupFields.valueOf(values, "username"),
        secret: SetupFields.valueOf(values, "password"),
      }
    }
    return login === "oidc"
      ? {
          identity: SetupFields.valueOf(values, "clientId"),
          secret: SetupFields.valueOf(values, "clientSecret"),
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
          ProfileUrl.of(SetupFields.valueOf(values, "url"))?.replace(REST_PATH, "/operate") ?? "",
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
        problem: SetupFields.notBlank("the username"),
      },
      {
        key: "password",
        title: "Password",
        prompt: "Pulse keeps it in VS Code's secret storage and sends it only to the cluster.",
        password: true,
        when: basic,
        problem: SetupFields.notBlank("the password"),
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
        problem: SetupFields.notBlank("the client ID"),
      },
      {
        key: "clientSecret",
        title: "Client secret",
        prompt:
          "Pulse keeps it in VS Code's secret storage and sends it only to the token endpoint.",
        password: true,
        when: oidc,
        problem: SetupFields.notBlank("the client secret"),
      },
    ]
  }

  private static authOf(values: SetupValues): {
    readonly auth?: Readonly<Record<string, unknown>>
  } {
    const login = SetupFields.valueOf(values, "login")
    if (login === "basic") {
      return { auth: { type: "basic" } }
    }
    if (login !== "oidc") {
      return {}
    }
    const scopes = SelfManagedSetup.scopesOf(SetupFields.valueOf(values, "scopes"))
    const audience = SetupFields.valueOf(values, "audience")
    return {
      auth: {
        type: "clientCredentials",
        tokenEndpoint: SetupFields.valueOf(values, "tokenEndpoint"),
        ...(scopes.length === 0 ? {} : { scopes }),
        ...(audience === "" ? {} : { audience }),
      },
    }
  }

  private static addressProblem(value: string, path: RegExp, ending: string): string | undefined {
    const url = ProfileUrl.of(value)
    if (url === undefined) {
      return "Enter an http or https address without credentials, query or fragment."
    }
    return path.test(url) ? undefined : `End the address with ${ending}.`
  }

  private static tokenEndpointProblem(value: string): string | undefined {
    const written = ProfileUrl.asWritten(value)
    return "needs" in written ? `Enter a token endpoint ${written.needs}.` : undefined
  }

  private static scopesProblem(value: string): string | undefined {
    return ProfileAuthReader.isScopeList(SelfManagedSetup.scopesOf(value))
      ? undefined
      : "Separate distinct scopes with spaces. A scope has no quotes or backslashes."
  }

  private static scopesOf(value: string): string[] {
    return value.split(/\s+/).filter((scope) => scope !== "")
  }

  private static nameOf(values: SetupValues): string {
    const url = ProfileUrl.of(SetupFields.valueOf(values, "url"))
    const host = url === undefined ? "" : new URL(url).hostname.replace(NOT_A_NAME, "-")
    return `c8-${host.replace(/^-+|-+$/g, "")}`
  }
}
