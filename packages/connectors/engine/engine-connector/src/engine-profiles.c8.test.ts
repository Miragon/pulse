/**
 * A Camunda 8 profile (`flavor: "camunda8"`) as the server judges it: served with none, Basic
 * auth or the client credentials grant, its client secret only from the ENGINE_SECRET_* variable
 * auth.clientSecretEnv names; a fixed bearer token, a token endpoint the grant cannot use and a
 * credential in clear text beyond loopback refuse it. A refusal names the profile's keys to the
 * model, never a variable, the token endpoint's URL or the cluster's url; the operator reads the
 * variable too. The single engine's variables stay Camunda 7's.
 */

import { describe, expect, it } from "vitest"
import { loadEngineProfiles, referencedVariables } from "./engine-profiles.js"

const CLUSTER = "https://c8.example.com/v2"
const TOKEN_ENDPOINT = "https://login.example.com/realms/pulse/protocol/openid-connect/token"
const GRANT = {
  type: "clientCredentials",
  tokenEndpoint: TOKEN_ENDPOINT,
  clientId: "pulse",
  clientSecretEnv: "ENGINE_SECRET_C8_CLIENT",
}
const SECRET = { ENGINE_SECRET_C8_CLIENT: "s3cret-of-the-client" }

/** ENGINES_JSON with one Camunda 8 profile `c8` next to a Camunda 7 one, and `env`. */
function loaded(profile: Record<string, unknown>, env: NodeJS.ProcessEnv = SECRET) {
  return loadEngineProfiles({
    ENGINES_JSON: JSON.stringify({
      profiles: {
        c7: { url: "http://a.example/engine-rest" },
        c8: { url: CLUSTER, flavor: "camunda8", ...profile },
      },
    }),
    ...env,
  })
}

/** The one refusal of the Camunda 8 profile: the model's reason and the operator's warning. */
function refusalOf(profile: Record<string, unknown>, env: NodeJS.ProcessEnv = SECRET) {
  const { engines, refused, warnings } = loaded(profile, env)
  expect(engines.map(({ id }) => id)).toEqual(["c7"])
  expect(refused.map(({ id }) => id)).toEqual(["c8"])
  const [warning] = warnings
  expect(JSON.stringify([refused, warning])).not.toContain(SECRET.ENGINE_SECRET_C8_CLIENT)
  return { reason: refused[0].reason, warning }
}

describe("a Camunda 8 profile the server serves", () => {
  it("signs in with nothing or Basic auth, as on Camunda 7", () => {
    const none = loaded({ cockpitUrl: " https://c8.example.com/operate " })
    expect(none.engines[1]).toEqual({
      id: "c8",
      baseUrl: CLUSTER,
      cockpitUrl: "https://c8.example.com/operate",
      flavor: "camunda8",
    })
    const basic = loaded(
      { auth: { type: "basic", username: "demo", passwordEnv: "ENGINE_SECRET_C8_PASSWORD" } },
      { ENGINE_SECRET_C8_PASSWORD: "demo" },
    )
    expect(basic.engines[1].auth).toEqual({ type: "basic", username: "demo", password: "demo" })
    expect([none.refused, basic.refused]).toEqual([[], []])
  })

  it("signs in with the client credentials grant, its secret read from its variable", () => {
    const { engines, refused, warnings } = loaded({
      readOnly: true,
      timeout: 10_000,
      auth: {
        ...GRANT,
        tokenEndpoint: ` ${TOKEN_ENDPOINT} `,
        audience: "zeebe-api",
        scopes: ["read"],
      },
    })
    expect([refused, warnings]).toEqual([[], []])
    expect(engines[1]).toEqual({
      id: "c8",
      baseUrl: CLUSTER,
      flavor: "camunda8",
      readOnly: true,
      timeoutMs: 10_000,
      auth: {
        type: "clientCredentials",
        tokenEndpoint: TOKEN_ENDPOINT,
        clientId: "pulse",
        clientSecret: "s3cret-of-the-client",
        audience: "zeebe-api",
        scopes: ["read"],
      },
    })
  })

  it("takes a token endpoint with a query, and plain http on this machine, as c8:up prints it", () => {
    const local = loaded({
      url: "http://localhost:18088/v2",
      auth: {
        ...GRANT,
        tokenEndpoint: "http://localhost:18089/realms/pulse/protocol/openid-connect/token",
      },
    })
    expect(local.refused).toEqual([])
    const query = loaded({ auth: { ...GRANT, tokenEndpoint: `${TOKEN_ENDPOINT}?tenant=acme` } })
    expect(query.engines[1].auth?.tokenEndpoint).toBe(`${TOKEN_ENDPOINT}?tenant=acme`)
  })

  it("reads a cluster without credentials over plain http beyond this machine: nothing to leak", () => {
    expect(loaded({ url: "http://c8.example.com/v2" }).refused).toEqual([])
  })

  it("names its client secret's variable to the typo warner", () => {
    expect(
      referencedVariables({
        ENGINES_JSON: JSON.stringify({
          profiles: { c8: { url: CLUSTER, flavor: "camunda8", auth: GRANT } },
        }),
      }),
    ).toEqual(["ENGINE_SECRET_C8_CLIENT"])
  })
})

describe("a Camunda 8 profile the server refuses on its own", () => {
  it.each<[string, Record<string, unknown>, string]>([
    [
      "a fixed bearer token",
      { auth: { type: "bearer", tokenEnv: "ENGINE_SECRET_C8_TOKEN" } },
      "This server cannot sign in to a Camunda 8 engine with this auth.type: it signs in with none, basic or clientCredentials, whose tokens it gets itself.",
    ],
    [
      "the caller's own token",
      { auth: { type: "passthrough" } },
      "auth.type does not fit the API of the flavor",
    ],
    [
      "a token endpoint that is no URL",
      { auth: { ...GRANT, tokenEndpoint: "login.example.com/token" } },
      "auth.tokenEndpoint is no URL: use the URL that issues tokens, such as https://login.example.com/oauth/token.",
    ],
    [
      "a token endpoint with a user",
      { auth: { ...GRANT, tokenEndpoint: "https://pulse:s3cret@login.example.com/token" } },
      "auth.tokenEndpoint must not contain credentials (they are not shown): the server sends the client's ID and secret itself.",
    ],
    [
      "a token endpoint of another scheme",
      { auth: { ...GRANT, tokenEndpoint: "ftp://login.example.com/token" } },
      "auth.tokenEndpoint must start with http:// or https://.",
    ],
    [
      "a token endpoint with a fragment",
      { auth: { ...GRANT, tokenEndpoint: `${TOKEN_ENDPOINT}#top` } },
      "auth.tokenEndpoint must not contain a fragment.",
    ],
    [
      "a token endpoint over plain http beyond this machine",
      { auth: { ...GRANT, tokenEndpoint: "http://login.example.com/token" } },
      "auth.tokenEndpoint is plain http:// to a host beyond this machine, so the client secret would travel unencrypted: use https://.",
    ],
    [
      "a cluster over plain http beyond this machine, with credentials",
      { url: "http://c8.example.com/v2", auth: GRANT },
      "url is plain http:// to a host beyond this machine, so the cluster's credentials would travel unencrypted: use https://.",
    ],
    [
      "Basic auth to a cluster over plain http beyond this machine",
      {
        url: "http://127.0.0.1.example.com/v2",
        auth: { type: "basic", username: "demo", passwordEnv: "ENGINE_SECRET_C8_CLIENT" },
      },
      "url is plain http:// to a host beyond this machine",
    ],
    [
      "the client credentials grant without a client",
      { auth: { ...GRANT, clientId: undefined } },
      "auth.clientId is missing: the client credentials grant needs the client's ID.",
    ],
    [
      "the client credentials grant without its secret's variable",
      { auth: { ...GRANT, clientSecretEnv: undefined } },
      "auth.clientSecretEnv is missing: the server reads the secret from the variable it names.",
    ],
    [
      "the client secret itself in the file",
      { auth: { ...GRANT, clientSecretEnv: undefined, clientSecret: "s3cret" } },
      "auth.clientSecret holds a secret itself (it is not shown)",
    ],
    [
      "a client secret's variable outside ENGINE_SECRET_",
      { auth: { ...GRANT, clientSecretEnv: "C8_CLIENT_SECRET" } },
      "auth.clientSecretEnv must name a variable that starts with ENGINE_SECRET_",
    ],
    [
      "no url",
      { url: undefined },
      "url is missing: this server needs the REST API root, a URL such as http://localhost:8080/v2.",
    ],
  ])("%s", (_case, profile, says) => {
    const { reason, warning } = refusalOf(profile)
    expect(reason).toContain(says)
    expect(warning).toContain(says)
    // The model never reads the token endpoint's URL or the cluster's url.
    const auth = profile.auth as { tokenEndpoint?: string } | undefined
    for (const written of [CLUSTER, profile.url, auth?.tokenEndpoint]) {
      if (typeof written === "string") expect(reason).not.toContain(written)
    }
  })

  it("a client secret's variable that is not set: the model reads the key, the operator the variable", () => {
    const { reason, warning } = refusalOf({ auth: GRANT }, {})
    expect(reason).toBe("auth.clientSecretEnv names a variable that is not set.")
    expect(warning).toBe(
      'Profile "c8" (ENGINES_JSON) is refused: auth.clientSecretEnv names ENGINE_SECRET_C8_CLIENT, which is not set. A call to this engine fails with that reason; the other engines run.',
    )
  })

  it("a Basic password the transport cannot send names the profile's keys, never a single-engine variable", () => {
    const { reason, warning } = refusalOf(
      { auth: { type: "basic", username: "demo", passwordEnv: "ENGINE_SECRET_C8_PASSWORD" } },
      { ENGINE_SECRET_C8_PASSWORD: "pw\nsecond-line" },
    )
    expect(reason).toBe(
      "The password auth.passwordEnv names holds a control character (a line break, say), which Basic auth (RFC 7617) cannot carry; the value is not shown.",
    )
    expect(`${reason} ${warning}`).not.toMatch(/ENGINE_USERNAME|ENGINE_PASSWORD|ENGINE_AUTH_TYPE/)
  })
})

describe("the single engine's variables describe a Camunda 7 engine", () => {
  it("refuses ENGINE_FLAVOR=camunda8, naming where a Camunda 8 engine goes", () => {
    expect(() =>
      loadEngineProfiles({ ENGINE_BASE_URL: CLUSTER, ENGINE_FLAVOR: " camunda8 " }),
    ).toThrow(
      'ENGINE_FLAVOR=camunda8: ENGINE_BASE_URL and its siblings describe a Camunda 7 engine. A camunda8 engine is a profile in ENGINES_JSON or ENGINES_FILE, for example {"profiles": {"<id>": {"url": "https://<cluster>/v2", "flavor": "camunda8", "auth": {"type": "clientCredentials", "tokenEndpoint": "…", "clientId": "…", "clientSecretEnv": "ENGINE_SECRET_<NAME>"}}}}.',
    )
  })

  it("refuses the client credentials grant there as the format does: it is Camunda 8's", () => {
    expect(() =>
      loadEngineProfiles({ ENGINE_BASE_URL: CLUSTER, ENGINE_AUTH_TYPE: "clientCredentials" }),
    ).toThrow("ENGINE_AUTH_TYPE: auth.type does not fit the API of the flavor")
  })
})
