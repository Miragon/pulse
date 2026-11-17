import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { bootServer, type BootedServer } from "./boot-server.js"
import {
  type EngineAnswer,
  ISSUED_TOKEN,
  type LoopbackServer,
  startC8Engine,
  startSilentC8Engine,
} from "./engine-goldens/fake-c8-cluster.js"
import { problemOf } from "./engine-goldens/c8-cluster-world.js"

/**
 * What a Camunda 8 cluster and its token endpoint can make the server tell the model, through the
 * real app (`createApp`) over a profile of the client credentials grant whose cluster and token
 * endpoint listen on loopback ports of their own: the model never reads the profile's url, its
 * token endpoint's URL or the client's secret, whether the cluster redirects to its own host over
 * https, to the login page beside the token endpoint, or quotes the URLs in its error text, on any
 * of the three ways a failure of the engine reaches it (the board feed's JSON, the XML feed's tool
 * error, the cockpit's board as structured content). A token endpoint that never answers fails a
 * call at the profile's deadline, not at the token request's own 30 s.
 */

const SECRET = "probe-secret-of-the-client"
const REALM = "/realms/probe-realm"
const TOKEN_PATH = `${REALM}/protocol/openid-connect/token`
const BOARD = "cluster"

/** One engine, one tile: the instances of a process. */
const BOARD_FILE = {
  schemaVersion: 1,
  title: "Cluster",
  engines: ["c8"],
  rows: [{ row: [{ widget: "instanceList", props: { filter: { process: "pulse-order" } } }] }],
}

/** The three ways a failure of the engine reaches the model, each as a call. */
const PROBES = [
  { name: "engine_board_data", arguments: { board: BOARD } },
  {
    name: "engine_bpmn_xml_data",
    arguments: { engine: "c8", processDefinitionId: "2251799813685326" },
  },
  { name: "engine_open_cockpit", arguments: { view: "board", board: BOARD } },
] as const

const issuing: EngineAnswer = () => ({
  body: { access_token: ISSUED_TOKEN, token_type: "Bearer", expires_in: 300 },
})

let boardsDir: string

beforeAll(() => {
  boardsDir = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-c8-urls-"))
  fs.writeFileSync(path.join(boardsDir, `${BOARD}.board.json`), JSON.stringify(BOARD_FILE))
})

afterAll(() => {
  fs.rmSync(boardsDir, { recursive: true, force: true })
})

beforeEach(() => {
  for (const level of ["info", "warn", "log"] as const) {
    vi.spyOn(console, level).mockImplementation(() => {})
  }
})

afterEach(() => {
  vi.restoreAllMocks()
})

interface Probed {
  /** Every result as the model may read it: its content and its structured content. */
  readonly results: string[]
  readonly ms: number[]
}

/** The server over the cluster and its token endpoint, each probe called once. */
async function probe(
  cluster: LoopbackServer,
  tokenEndpoint: LoopbackServer,
  timeout?: number,
): Promise<Probed> {
  const profile = {
    url: `${cluster.origin}/v2`,
    flavor: "camunda8",
    auth: {
      type: "clientCredentials",
      tokenEndpoint: `${tokenEndpoint.origin}${TOKEN_PATH}`,
      clientId: "pulse-probe",
      clientSecretEnv: "ENGINE_SECRET_C8_CLIENT",
    },
    ...(timeout === undefined ? {} : { timeout }),
  }
  const server: BootedServer = await bootServer({
    env: {
      ENGINE_BASE_URL: undefined,
      ENGINES_JSON: JSON.stringify({ profiles: { c8: profile } }),
      ENGINE_BOARDS_DIR: boardsDir,
      ENGINE_SECRET_C8_CLIENT: SECRET,
    },
  })
  try {
    const results: string[] = []
    const ms: number[] = []
    for (const call of PROBES) {
      const started = Date.now()
      const result = await server.client.callTool({ ...call, arguments: { ...call.arguments } })
      ms.push(Date.now() - started)
      results.push(JSON.stringify([result.content, result.structuredContent ?? null]))
    }
    return { results, ms }
  } finally {
    await server.close()
  }
}

/**
 * Texts no result may hold: the host and the ports of both (each listens on 127.0.0.1), the realm,
 * the secret, the issued token.
 */
function never(cluster: LoopbackServer, tokenEndpoint: LoopbackServer): RegExp[] {
  const port = (origin: string) => new RegExp(`:${new URL(origin).port}\\b`)
  return [
    /127\.0\.0\.1/,
    port(cluster.origin),
    port(tokenEndpoint.origin),
    /probe-realm/,
    /probe-secret/,
    /c8-access-token/,
  ]
}

describe("the profile's URLs in what the model reads of a Camunda 8 cluster's failure", () => {
  const servers: LoopbackServer[] = []

  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => server.close()))
  })

  /** A cluster that answers its version by `answer`, with its token endpoint on a port of its own. */
  async function started(answer: (cluster: string, tokenEndpoint: string) => EngineAnswer) {
    const tokenEndpoint = await startC8Engine(issuing)
    const origin: { value?: string } = {}
    const cluster = await startC8Engine((request) =>
      answer(origin.value ?? "", `${tokenEndpoint.origin}${TOKEN_PATH}`)(request),
    )
    origin.value = cluster.origin
    servers.push(cluster, tokenEndpoint)
    return { cluster, tokenEndpoint }
  }

  it.each<[string, (cluster: string, tokenEndpoint: string) => EngineAnswer, string]>([
    [
      "a redirect to its own host over https",
      (cluster) => () => ({
        status: 301,
        raw: "",
        headers: { Location: `${cluster.replace("http:", "https:")}/v2/topology?token=4711` },
      }),
      "[301] redirect to the cluster's host over https (engine c8)",
    ],
    [
      "a redirect to the login page beside the token endpoint",
      (_, tokenEndpoint) => () => ({
        status: 302,
        raw: "",
        headers: { Location: tokenEndpoint.replace(/token$/, "auth?client_id=camunda") },
      }),
      "[302] redirect to the token endpoint's host (engine c8)",
    ],
    [
      "an error text that quotes both URLs and the cluster's host",
      (cluster, tokenEndpoint) => (request) =>
        problemOf(
          500,
          `Failed at ${cluster}`,
          `upstream ${cluster}/v2 issuer ${tokenEndpoint.replace(/\/protocol.*$/, "")} ` +
            `token ${tokenEndpoint} gateway ${new URL(cluster).host} secret ${SECRET}`,
          request.target,
        ),
      "[500 Failed at ***] upstream *** issuer *** token *** gateway *** secret *** (engine c8)",
    ],
    [
      "an error text that quotes their host without its port, and either URL in the other scheme",
      (cluster, tokenEndpoint) => (request) =>
        problemOf(
          502,
          "Bad gateway",
          `connect to ${new URL(cluster).hostname} failed; see ` +
            `${cluster.replace("http:", "https:").replace(/:\d+$/, "")}/v2 and ` +
            `${tokenEndpoint.replace("http:", "https:").replace(/:\d+\//, "/")}`,
          request.target,
        ),
      "[502 Bad gateway] connect to *** failed; see *** and *** (engine c8)",
    ],
  ])("never names them after %s", async (_, answer, message) => {
    const { cluster, tokenEndpoint } = await started(answer)
    const { results } = await probe(cluster, tokenEndpoint)
    for (const [index, result] of results.entries()) {
      expect(result, PROBES[index]?.name).toContain(JSON.stringify(message).slice(1, -1))
      for (const text of never(cluster, tokenEndpoint)) {
        expect(result, PROBES[index]?.name).not.toMatch(text)
      }
    }
  })
})

describe("a token endpoint that never answers", () => {
  let cluster: LoopbackServer
  let tokenEndpoint: LoopbackServer

  beforeAll(async () => {
    cluster = await startC8Engine(issuing)
    tokenEndpoint = await startSilentC8Engine()
  })

  afterAll(async () => {
    await Promise.all([cluster.close(), tokenEndpoint.close()])
  })

  it("fails the call at the profile's deadline, and the cluster sees nothing", async () => {
    const { results, ms } = await probe(cluster, tokenEndpoint, 300)
    expect(results[1]).toContain(
      "[unreachable] the token endpoint of engine c8 did not answer in time",
    )
    expect(Math.max(...ms)).toBeLessThan(3000)
    expect(tokenEndpoint.requests.map(({ method, target }) => `${method} ${target}`)).toEqual([
      `POST ${TOKEN_PATH}`,
    ])
    expect(cluster.requests).toEqual([])
  })
})
