import { describe, expect, it } from "vitest"
import { HttpFailure } from "@miragon/pulse-http"
import { type C8Auth, createC8Connection, type RedirectTarget } from "./c8-connection.js"
import { c8Platform, CLUSTER, problem, token, TOKEN_ENDPOINT } from "./test-support/c8-platform.js"

/**
 * What the server's Camunda 8 wire lets through of the profile's URLs, which the model never reads
 * (c8-connection.ts): the cluster's text with the cluster's url and the token endpoint's URL
 * masked in every form it may quote them in, and where a redirect points, said by whose host it
 * is rather than by its target.
 */

const CLIENT: C8Auth = {
  type: "clientCredentials",
  tokenEndpoint: TOKEN_ENDPOINT,
  clientId: "pulse-reader",
  clientSecret: "reader-secret-42",
}

/** The fields the wire copies of a cluster's 500 that states `title` and `detail`. */
async function fieldsOf(
  title: string,
  detail: string,
  baseUrl = CLUSTER,
  auth: C8Auth = CLIENT,
): Promise<unknown> {
  const platform = c8Platform({
    "POST /realms/pulse/token": () => token("tok-cluster-1"),
    "GET /v2/topology": () => problem(500, title, detail),
  })
  const connection = createC8Connection({ id: "c8", baseUrl }, auth, {}, platform)
  try {
    await connection.transport().get("/topology")
  } catch (error) {
    return connection.failure(error)
  }
  throw new Error("the read did not fail")
}

const redirect = (location?: string) =>
  new HttpFailure("redirect", {
    method: "GET",
    target: `${CLUSTER}/topology`,
    mayHaveApplied: false,
    status: 302,
    ...(location === undefined ? {} : { location }),
  })

describe("the profile's URLs in a cluster's text", () => {
  it("masks each as written, by its origin and every path prefix in either scheme, and by host", async () => {
    const detail = [
      "upstream http://cluster.c8.test/v2/topology",
      "root https://cluster.c8.test/v2",
      "issuer https://login.c8.test/realms/pulse",
      `token ${encodeURIComponent(TOKEN_ENDPOINT)}`,
      "gateway cluster.c8.test:443",
      "secret reader-secret-42",
    ].join(", ")
    expect(await fieldsOf("Failed at https://cluster.c8.test", detail)).toMatchObject({
      title: "Failed at ***",
      detail: "upstream ***/topology, root ***, issuer ***, token ***, gateway ***:443, secret ***",
    })
  })

  it("masks a host with its port, and keeps a single name without one where a word holds it", async () => {
    const detail =
      "io.camunda failed at http://camunda/v2/topology, https://camunda and camunda:26500"
    expect(await fieldsOf("", detail, "http://camunda/v2", { type: "none" })).toMatchObject({
      detail: "io.camunda failed at ***/topology, *** and camunda:26500",
    })
    const ported = "connect to camunda:8080 refused, io.camunda gave up, see https://camunda/v2"
    expect(await fieldsOf("", ported, "http://camunda:8080/v2", { type: "none" })).toMatchObject({
      detail: "connect to *** refused, io.camunda gave up, see ***",
    })
  })

  it("masks the hostname of a URL with a port alone too, and so its other scheme on its default port", async () => {
    const auth: C8Auth = {
      ...CLIENT,
      tokenEndpoint: "https://keycloak.corp:8443/realms/pulse/token",
    }
    const detail = [
      "connect to zeebe.internal.corp failed",
      "see https://zeebe.internal.corp/v2 and zeebe.internal.corp:8080",
      "issuer http://keycloak.corp/realms/pulse at keycloak.corp",
    ].join("; ")
    expect(await fieldsOf("", detail, "http://zeebe.internal.corp:8080/v2", auth)).toMatchObject({
      detail: "connect to *** failed; see *** and ***; issuer *** at ***",
    })
  })

  it("masks an IP address of either version, with its port and without", async () => {
    const auth: C8Auth = { ...CLIENT, tokenEndpoint: "https://[fd00::7]:8443/realms/pulse/token" }
    const detail =
      "peer 10.0.0.7 at https://10.0.0.7/v2, 10.0.0.7:8080; issuer [fd00::7] at http://[fd00::7]/realms"
    expect(await fieldsOf("", detail, "http://10.0.0.7:8080/v2", auth)).toMatchObject({
      detail: "peer *** at ***, ***; issuer *** at ***",
    })
  })
})

describe("where the wire says a redirect points", () => {
  const LOCAL = createC8Connection(
    { id: "c8", baseUrl: "http://127.0.0.1:8080/v2" },
    {
      ...CLIENT,
      tokenEndpoint: "http://127.0.0.1:18080/realms/pulse/protocol/openid-connect/token",
    },
  )
  const APART = createC8Connection({ id: "c8", baseUrl: CLUSTER }, CLIENT)

  it.each<[string, string, RedirectTarget]>([
    [
      "https://127.0.0.1:8443/v2/topology",
      "the cluster's host over https",
      { host: "cluster", scheme: "https" },
    ],
    ["http://127.0.0.1:8080/v2/", "the cluster's own host", { host: "cluster" }],
    ["http://127.0.0.1:9090/login", "the cluster's host on another port", { host: "cluster" }],
    [
      "http://127.0.0.1:18080/realms/pulse/protocol/openid-connect/auth",
      "the token endpoint's host and port",
      { host: "tokenEndpoint" },
    ],
    [
      "https://sso.example.com/realms/ops/auth",
      "another host",
      { host: "other", location: "https://sso.example.com/realms/ops/auth" },
    ],
  ])("names %s as %s, beside the token endpoint on the cluster's host", (location, _, target) => {
    expect(LOCAL.redirectTarget(redirect(location))).toEqual(target)
  })

  it.each<[string, string, RedirectTarget]>([
    [
      "http://cluster.c8.test/v2/topology",
      "the cluster's host over http",
      { host: "cluster", scheme: "http" },
    ],
    [
      "https://login.c8.test:8443/realms/pulse/auth",
      "the token endpoint's host",
      { host: "tokenEndpoint" },
    ],
    [
      "https://other.c8.test/reader-secret-42/auth",
      "another host, masked",
      { host: "other", location: "https://other.c8.test/***/auth" },
    ],
    [
      "https://other.c8.test/http://cluster.c8.test/v2",
      "another host, masked",
      { host: "other", location: "https://other.c8.test/***" },
    ],
  ])("names %s as %s, apart from the token endpoint", (location, _, target) => {
    expect(APART.redirectTarget(redirect(location))).toEqual(target)
  })

  it("names no target of a redirect without one, nor of another failure", () => {
    expect(APART.redirectTarget(redirect())).toBeUndefined()
    expect(APART.redirectTarget(new Error("boom"))).toBeUndefined()
  })
})
