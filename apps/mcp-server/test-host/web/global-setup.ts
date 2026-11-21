import { randomBytes } from "node:crypto"
import http from "node:http"
import type { AddressInfo } from "node:net"
import path from "node:path"
import {
  FAKE_OIDC_CLIENT,
  startFakeOidc,
  type FakeOidc,
  type FakeOidcOptions,
} from "@miragon/pulse-widget-shell/testing/oidc"
import { createApp } from "../../src/app.js"
import { startC8HostEngine } from "../c8-engine.js"
import {
  BROKEN_ENGINE,
  C8_CONTROL_ENV,
  C8_ENGINE,
  CHAIN_ENGINE,
  C8_OPERATE,
  C8_UNBOARDED_ENGINE,
  ENGINE_CONTROL_ENV,
  HEALTHY_ENGINE,
  REFUSED_C8_ENGINE,
} from "../engines.js"
import { startStubEngine } from "../stub-engine.js"
import {
  CONTROL_ENV,
  DEPLOYMENTS,
  SHORT_TOKEN_SECONDS,
  WEB_CLIENT_ID,
  type Deployment,
  type IdpRecord,
} from "./web-sim.js"

/** The web app's build, which `test:web` builds first: `MCP_WEB_DIR`, never the package's web/. */
const WEB_BUILD = path.resolve(import.meta.dirname, "..", "..", "..", "web", "dist")

/**
 * test:host's board files (`ENGINE_BOARDS_DIR`): a board over the stub and the broken engine, and
 * a file that gives no board.
 */
const BOARDS_DIR = path.resolve(import.meta.dirname, "..", "fixtures", "boards")

/** test:host's Camunda 8 board files: a board over the stub engine and a Camunda 8 one. */
const CAMUNDA8_BOARDS_DIR = path.resolve(import.meta.dirname, "..", "fixtures", "camunda8-boards")

interface WebDeployment {
  readonly origin: string
  readonly idp: FakeOidc
  close(): Promise<void>
}

/** A port no listener holds now, for an origin `MCP_URL` names before the server listens on it. */
async function freePort(): Promise<number> {
  const probe = http.createServer()
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve))
  const { port } = probe.address() as AddressInfo
  await new Promise<void>((resolve) => probe.close(() => resolve()))
  return port
}

/**
 * One composition root (`createApp`, what `src/index.ts` runs) under OAuth at
 * `http://localhost:<port>`, its own fake identity provider (Keycloak's paths and the boot's
 * Keycloak provider, with `flavor: "adfs"` ADFS's and the generic OpenID Connect provider, or with
 * `flavor: "entra"` an Entra ID tenant's and the boot's Entra ID provider, as the fake's `env` names
 * them) with the web client's callback and post-logout URIs exactly, the
 * web app on with the build of apps/web, the engines `profiles` and the variables of `env` besides.
 * OAuth gives the operations toolset, so the server registers the writes a page never offers.
 */
async function deploy(
  profiles: Record<string, Readonly<Record<string, unknown>>>,
  { idp: idpOptions = {}, env = {} }: { idp?: FakeOidcOptions; env?: Record<string, string> } = {},
): Promise<WebDeployment> {
  const port = await freePort()
  const origin = `http://localhost:${port}`
  const idp = await startFakeOidc({
    ...idpOptions,
    audience: `${origin}/mcp`,
    clients: [
      {
        ...FAKE_OIDC_CLIENT,
        redirectUris: [`${origin}/app/auth/callback`],
        postLogoutRedirectUris: [`${origin}/app/signed-out`],
      },
    ],
  })
  const composed = await createApp({
    ...idp.env(origin),
    MCP_WEB_CLIENT_ID: WEB_CLIENT_ID,
    MCP_WEB_CLIENT_SECRET: FAKE_OIDC_CLIENT.secret,
    MCP_WEB_SESSION_KEYS: randomBytes(32).toString("base64url"),
    MCP_WEB_DIR: WEB_BUILD,
    ENGINES_JSON: JSON.stringify({ profiles }),
    ...env,
  })
  const running = await composed.listen({ port, host: "127.0.0.1", drainTimeoutMs: 1000 })
  return {
    origin,
    idp,
    close: async () => {
      await running.shutdown()
      await idp.close()
    },
  }
}

/**
 * What a deployment's identity provider recorded (web-sim.ts's `IdpRecord`), each refresh token
 * a request presented or a client revoked named with its session.
 */
function recordOf(idp: FakeOidc): IdpRecord {
  const sessionOf = (token: string | null) => (token === null ? undefined : idp.sessionOf(token))
  return {
    issuer: idp.issuer,
    issued: idp.issued,
    revoked: idp.revoked.map((token) => ({ token, session: sessionOf(token) })),
    endedSessions: idp.endedSessions,
    grants: idp.requests
      .filter((request) => request.endpoint === "token")
      .map((request) => ({
        type: request.form.get("grant_type") ?? "",
        session: sessionOf(request.form.get("refresh_token")),
        resources: request.form.getAll("resource"),
      })),
  }
}

/**
 * The control of the identity providers, for the workers: `GET /idp/<deployment>` answers what the
 * deployment's provider recorded, its issuer first; `POST /idp/<deployment>/end-grant?session=<sid>`
 * ends that session's grant, as when the provider takes back a user's access.
 */
async function startControl(idps: Record<Deployment, FakeOidc>) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://control")
    const [, scope, name, action] = url.pathname.split("/")
    const idp = scope === "idp" ? idps[name as Deployment] : undefined
    const session = url.searchParams.get("session")
    if (idp !== undefined && req.method === "POST" && action === "end-grant" && session) {
      idp.endGrant(session)
      res.writeHead(204).end()
      return
    }
    if (idp === undefined || req.method !== "GET" || action !== undefined) {
      res.writeHead(404).end()
      return
    }
    res.writeHead(200, { "content-type": "application/json" })
    res.end(JSON.stringify(recordOf(idp)))
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  }
}

/**
 * Boots the system under test once per run: the REAL composition root (`createApp`) with the web
 * app on, serving the BUILT page of apps/web (`MCP_WEB_DIR` on `apps/web/dist`) and the built view
 * bundle, against test-host's stub engine, each deployment beside a fake identity provider of its
 * own, everything on ephemeral loopback ports. The browser reaches a deployment at
 * `http://localhost:<port>`, its `MCP_URL`, where Chromium keeps the `__Host-` cookies of plain
 * http. The workers find the deployments in `WEB_SIM_URL`, `WEB_SIM_SHORT_URL` and
 * `WEB_SIM_ADFS_URL` (the generic OpenID Connect provider at a fake ADFS) and `WEB_SIM_ENTRA_URL`
 * (the Entra ID provider at a fake tenant), the control
 * of their identity providers in `WEB_SIM_CONTROL_URL`, the stub engine's in `HOST_SIM_ENGINE_URL`
 * and the Camunda 8 cluster's in `HOST_SIM_C8_ENGINE_URL` (all inherited from this process). The
 * `camunda8` deployment, in `WEB_SIM_CAMUNDA8_URL`, reads test:host's loopback Camunda 8 cluster
 * (c8-engine.ts) beside the stub engine: one profile a board names, one no board names, each shown
 * whole on the page's screens. The `refusedC8` deployment, in
 * `WEB_SIM_REFUSED_C8_URL`, refuses a Camunda 8 profile beside the stub. The `chain` deployment, in
 * `WEB_SIM_CHAIN_URL`, reads the stub's chain engine alone (the instance screen's journey). The
 * `search` deployment, in `WEB_SIM_SEARCH_URL`, reads the stub and the Camunda 8 cluster beside a
 * refused Camunda 8 profile (the search across engines).
 */
export default async function globalSetup(): Promise<() => Promise<void>> {
  const engine = await startStubEngine()
  // Two engines and the board files: /app lists both engines and the boards (boards.spec.ts).
  const main = await deploy(
    {
      [HEALTHY_ENGINE]: { url: engine.baseUrl },
      [BROKEN_ENGINE]: { url: engine.brokenBaseUrl },
    },
    { env: { ENGINE_BOARDS_DIR: BOARDS_DIR } },
  )
  // Access tokens of 5 s are due at once by the shared expiry policy: the server renews the token
  // before each call it forwards, and a refusal of the renewal (the session ended at the provider)
  // ends the session once the token expired. One engine and no board: /app opens that engine.
  const short = await deploy(
    { [HEALTHY_ENGINE]: { url: engine.baseUrl } },
    { idp: { accessTokenSeconds: SHORT_TOKEN_SECONDS } },
  )
  // The generic OpenID Connect provider at a fake ADFS whose issuance rule names the caller in sub:
  // its access tokens of 5 s renew before each call, with the resource, as the short ones do.
  const adfs = await deploy(
    { [HEALTHY_ENGINE]: { url: engine.baseUrl } },
    { idp: { flavor: "adfs", callerClaim: "sub", accessTokenSeconds: SHORT_TOKEN_SECONDS } },
  )
  // Entra ID's tenant behind the boot's Entra ID provider: the sign-in and every renewal through its
  // v2.0 authority, without a resource and with the API's scope, its access tokens of 5 s.
  const entra = await deploy(
    { [HEALTHY_ENGINE]: { url: engine.baseUrl } },
    { idp: { flavor: "entra", accessTokenSeconds: SHORT_TOKEN_SECONDS } },
  )
  // Camunda 8 beside the stub: a board page over both, and the page's screens on a Camunda 8 engine,
  // which the page reads whole (the chat on boards only); the one no board names is the default,
  // which a page without `engine` goes to.
  const c8 = await startC8HostEngine()
  const camunda8 = await deploy(
    {
      [HEALTHY_ENGINE]: { url: engine.baseUrl },
      [C8_ENGINE]: c8.profile("ENGINE_SECRET_WEB_SIM_C8", { cockpitUrl: C8_OPERATE }),
      [C8_UNBOARDED_ENGINE]: c8.profile("ENGINE_SECRET_WEB_SIM_C8"),
    },
    {
      env: {
        ENGINE_BOARDS_DIR: CAMUNDA8_BOARDS_DIR,
        ENGINE_SECRET_WEB_SIM_C8: "web-sim-client-secret",
        ENGINE_DEFAULT: C8_UNBOARDED_ENGINE,
      },
    },
  )
  // A refused Camunda 8 profile beside the stub (its client secret's variable is not set): the
  // server offers it no feed, so its page reads nothing of it and says its own reason.
  const refusedC8 = await deploy({
    [HEALTHY_ENGINE]: { url: engine.baseUrl },
    [REFUSED_C8_ENGINE]: c8.profile("ENGINE_SECRET_WEB_SIM_NEVER_SET"),
  })
  // The instance screen's journey: the stub's chain engine alone, one engine and no board.
  const chain = await deploy({ [CHAIN_ENGINE]: { url: engine.chainBaseUrl } })
  // The search across engines: the stub engine and the Camunda 8 cluster, each holding an instance
  // of order ORD-7003 (an ended invoice, a running order), beside a refused Camunda 8 profile.
  const search = await deploy(
    {
      [HEALTHY_ENGINE]: { url: engine.baseUrl },
      [C8_ENGINE]: c8.profile("ENGINE_SECRET_WEB_SIM_C8"),
      [REFUSED_C8_ENGINE]: c8.profile("ENGINE_SECRET_WEB_SIM_NEVER_SET"),
    },
    { env: { ENGINE_SECRET_WEB_SIM_C8: "web-sim-client-secret" } },
  )
  const control = await startControl({
    main: main.idp,
    short: short.idp,
    adfs: adfs.idp,
    entra: entra.idp,
    camunda8: camunda8.idp,
    refusedC8: refusedC8.idp,
    chain: chain.idp,
    search: search.idp,
  })
  process.env[DEPLOYMENTS.main] = main.origin
  process.env[DEPLOYMENTS.short] = short.origin
  process.env[DEPLOYMENTS.adfs] = adfs.origin
  process.env[DEPLOYMENTS.entra] = entra.origin
  process.env[DEPLOYMENTS.camunda8] = camunda8.origin
  process.env[DEPLOYMENTS.refusedC8] = refusedC8.origin
  process.env[DEPLOYMENTS.chain] = chain.origin
  process.env[DEPLOYMENTS.search] = search.origin
  process.env[CONTROL_ENV] = control.url
  process.env[ENGINE_CONTROL_ENV] = engine.controlUrl
  process.env[C8_CONTROL_ENV] = c8.origin

  return async () => {
    await control.close()
    await main.close()
    await short.close()
    await adfs.close()
    await entra.close()
    await camunda8.close()
    await refusedC8.close()
    await chain.close()
    await search.close()
    await engine.close()
    await c8.close()
  }
}
