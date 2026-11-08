import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { describe, it } from "node:test"
import { parse } from "yaml"
import {
  claudeCodeHint,
  cliPreset,
  COMPOSE_FILE,
  COMPOSE_PROJECT,
  composeArgs,
  DEFAULT_SERVER_PORT,
  ENGINE_SOURCES,
  inspectorLink,
  inspectorPorts,
  portConflict,
  portOwners,
  profilesFor,
  SERVICES,
  serverPreset,
  SERVER_READY_PATH,
  servicesFor,
  withPreset,
} from "./local-env.mjs"

const compose = parse(readFileSync(new URL(`../${COMPOSE_FILE}`, import.meta.url), "utf8"))

describe("the playground services", () => {
  it("match the Compose file: its project name, every published port, the profiles", () => {
    assert.equal(compose.name, COMPOSE_PROJECT)
    const byId = { engine: "cibseven", "engine-b": "cibseven-b" }
    for (const service of SERVICES) {
      const spec = compose.services[byId[service.id] ?? service.id]
      const published = spec.ports.map((port) => Number(port.split(":")[1]))
      assert.deepEqual(published, service.ports, service.id)
      assert.deepEqual(spec.profiles ?? [], service.profile ? [service.profile] : [], service.id)
    }
  })

  it("adds the second engine and Keycloak only with their options", () => {
    const ids = (options) => servicesFor(options).map(({ id }) => id)
    assert.deepEqual(ids({}), ["engine", "otel-collector", "prometheus", "grafana"])
    assert.deepEqual(ids({ multiEngine: true, auth: true }).slice(4), ["engine-b", "keycloak"])
    assert.deepEqual(profilesFor({ auth: true }), ["auth"])
  })

  it("builds docker compose arguments", () => {
    assert.deepEqual(composeArgs("/r/c.yml", ["auth"], "up", "-d"), [
      "compose",
      "-f",
      "/r/c.yml",
      "--profile",
      "auth",
      "up",
      "-d",
    ])
  })
})

describe("the presets", () => {
  it("point the server at the playground engine, its Prometheus and loopback", () => {
    assert.deepEqual(serverPreset(), {
      ENGINE_BASE_URL: "http://localhost:8410/engine-rest",
      ENGINE_ID: "prod-a",
      ENGINE_FLAVOR: "cibseven",
      ENGINE_COCKPIT_URL: "http://localhost:8410/webapp",
      ENGINE_AUTH_TYPE: "basic",
      ENGINE_USERNAME: "demo",
      ENGINE_PASSWORD: "demo",
      PROMETHEUS_URL: "http://localhost:8460",
      HOST: "127.0.0.1",
    })
  })

  it("hands the Compose engines no metrics settings: no plugin in them reads one", () => {
    for (const service of ["cibseven", "cibseven-b"]) {
      const names = compose.services[service].environment.map((entry) => entry.split("=")[0])
      const metrics = names.filter((name) => /^(?:ENGINE_ID|METRICS_ENABLED|OTEL_)/.test(name))
      assert.deepEqual(metrics, [], service)
    }
  })

  it("lists both engines with --multi-engine instead of the single-engine shorthand", () => {
    const preset = serverPreset({ multiEngine: true })
    assert.equal(preset.ENGINE_BASE_URL, undefined)
    assert.deepEqual(JSON.parse(preset.ENGINES_JSON), [
      {
        id: "prod-a",
        baseUrl: "http://localhost:8410/engine-rest",
        flavor: "cibseven",
        cockpitUrl: "http://localhost:8410/webapp",
      },
      {
        id: "prod-b",
        baseUrl: "http://localhost:8411/engine-rest",
        flavor: "cibseven",
        cockpitUrl: "http://localhost:8411/webapp",
      },
    ])
  })

  it("widens the toolset with --admin and registers deployments with --deploy", () => {
    assert.equal(serverPreset().MCP_ACTIVE_MODULES, undefined)
    assert.equal(serverPreset({ admin: true }).MCP_ACTIVE_MODULES, "engine:admin,analytics")
    assert.equal(serverPreset({ admin: true }).ENGINE_ALLOW_DEPLOYMENTS, undefined)
    assert.equal(serverPreset({ admin: true, deploy: true }).ENGINE_ALLOW_DEPLOYMENTS, "true")
  })

  it("puts the server behind the playground's Keycloak with --auth", () => {
    assert.equal(serverPreset().MCP_OAUTH_KEYCLOAK_SERVER_URL, undefined)
    const preset = serverPreset({ auth: true })
    const keycloak = SERVICES.find(({ id }) => id === "keycloak")
    assert.equal(preset.MCP_OAUTH_KEYCLOAK_SERVER_URL, `http://localhost:${keycloak.ports[0]}`)
    assert.match(keycloak.probe, new RegExp(`/realms/${preset.MCP_OAUTH_KEYCLOAK_REALM}$`))
    // OAuth refuses to boot without MCP_URL; the server's own port, on the name the realm stamps.
    assert.equal(preset.MCP_URL, `http://localhost:${DEFAULT_SERVER_PORT}`)
    assert.equal(serverPreset({ auth: true, port: 8500 }).MCP_URL, "http://localhost:8500")
    assert.equal(serverPreset({ port: 8500 }).MCP_URL, undefined)
    // The three lines .env.example names for the local playground.
    const example = readFileSync(new URL("../.env.example", import.meta.url), "utf8")
    for (const [name, value] of Object.entries(preset).filter(([name]) =>
      /OAUTH|MCP_URL/.test(name),
    )) {
      assert.ok(example.includes(`# ${name}=${value}\n`), name)
    }
  })

  it("points the CLI at the same engine", () => {
    assert.equal(cliPreset().PULSE_CLI_URL, serverPreset().ENGINE_BASE_URL)
    assert.equal(cliPreset().PULSE_CLI_AUTH, "basic")
  })

  it("lets the caller's environment win and names what it replaced", () => {
    const { env, overridden } = withPreset(
      { ENGINE_ID: "prod-a", HOST: "127.0.0.1", PROMETHEUS_URL: "http://localhost:8460" },
      { ENGINE_ID: "mine", HOST: "127.0.0.1", PATH: "/bin" },
    )
    assert.deepEqual(env, {
      ENGINE_ID: "mine",
      HOST: "127.0.0.1",
      PROMETHEUS_URL: "http://localhost:8460",
      PATH: "/bin",
    })
    assert.deepEqual(overridden, ["ENGINE_ID"])
  })

  it("names the engine sources of the caller that outrank the playground engines", () => {
    const single = serverPreset()
    assert.deepEqual(withPreset(single, {}).outranking, [])
    assert.deepEqual(
      withPreset(single, { ENGINES_FILE: "e.json", ENGINES_JSON: "[]" }).outranking,
      ["ENGINES_FILE", "ENGINES_JSON"],
    )
    assert.deepEqual(withPreset(single, { ENGINES_FILE: " " }).outranking, [])
    const multi = serverPreset({ multiEngine: true })
    assert.deepEqual(withPreset(multi, { ENGINES_JSON: "[]" }).outranking, [])
    assert.deepEqual(withPreset(multi, { ENGINES_FILE: "e.json" }).outranking, ["ENGINES_FILE"])
    assert.deepEqual(withPreset(cliPreset(), { ENGINES_FILE: "e.json" }).outranking, [])
  })

  it("orders the engine sources as the engine module reads them", () => {
    const module = readFileSync(
      new URL("../packages/connectors/engine/engine-connector/src/module.ts", import.meta.url),
      "utf8",
    )
    assert.ok(module.includes(`Precedence: ${ENGINE_SOURCES.join(" > ")} >`))
  })
})

describe("the server port", () => {
  it("is the one .mcp.json points Claude Code at when PORT is unset", () => {
    const { mcpServers } = JSON.parse(
      readFileSync(new URL("../.mcp.json", import.meta.url), "utf8"),
    )
    assert.equal(mcpServers.pulse.url, `http://localhost:\${PORT:-${DEFAULT_SERVER_PORT}}/mcp`)
  })

  it("names how a session reaches a server off the default port, and nothing on it", () => {
    assert.equal(claudeCodeHint(DEFAULT_SERVER_PORT), "")
    assert.equal(
      claudeCodeHint(8401),
      "  Claude Code   a session reaches it when started as PORT=8401 claude\n",
    )
  })

  it("is ready on the probe the boot answers, never on a dev-only page", () => {
    assert.equal(SERVER_READY_PATH, "/health/ready")
  })
})

describe("the inspector", () => {
  const manifest = JSON.parse(
    readFileSync(new URL("../apps/mcp-server/package.json", import.meta.url), "utf8"),
  )

  it("starts with the server: loopback, no browser, the dev server's endpoint", () => {
    const script = manifest.scripts["dev:inspector"]
    assert.match(manifest.scripts.dev, /pnpm run "\/\^dev:\/"/)
    assert.match(script, /^HOST=127\.0\.0\.1 /)
    assert.match(script, /\bMCP_AUTO_OPEN_ENABLED=false\b/)
    // On localhost, the origin `--auth`'s MCP_URL names: under OAuth the inspector's client
    // refuses a protected resource on another origin than the one it connects to.
    assert.match(script, /--server-url http:\/\/localhost:\$\{PORT:-8400\}\/mcp"?$/)
    assert.equal(
      new URL(serverPreset({ auth: true }).MCP_URL).host,
      new URL(script.split("--server-url ")[1].replace("${PORT:-8400}", "8400")).host,
    )
    assert.match(manifest.devDependencies["@modelcontextprotocol/inspector"], /^\d+\.\d+\.\d+$/)
  })

  // A second worktree's inspector collides on any port the command leaves on its default, and
  // `pnpm play` refuses to start on a taken one.
  it("the docs' second-worktree command moves every port the inspector binds", () => {
    const page = readFileSync(new URL("../docs/mcp/developer.md", import.meta.url), "utf8")
    const command = page.split("\n").find((line) => line.includes("<port> pnpm play"))
    assert.ok(command, "docs/mcp/developer.md names the second worktree's command")
    const named = Object.fromEntries(
      [...command.matchAll(/\b([A-Z_]+)=<port>/g)].map(([, name], index) => [
        name,
        String(7000 + index),
      ]),
    )
    assert.ok(named.PORT)
    const defaults = new Set(inspectorPorts({}).map(({ port }) => port))
    assert.deepEqual(
      inspectorPorts(named).filter(({ port }) => defaults.has(port)),
      [],
    )
  })

  it("listens on its defaults unless its own variables move it", () => {
    assert.deepEqual(inspectorPorts({}), [
      { variable: "CLIENT_PORT", port: 6274, fromEnv: false },
      { variable: "MCP_SANDBOX_PORT", port: 6275, fromEnv: false },
      { variable: "MCP_APP_ORIGIN_PORT", port: 6278, fromEnv: false },
    ])
    assert.deepEqual(
      inspectorPorts({
        CLIENT_PORT: "7000",
        SERVER_PORT: "7001",
        MCP_APP_ORIGIN_PORT: " 7002 ",
      }).map(({ port, fromEnv }) => [port, fromEnv]),
      [
        [7000, true],
        [7001, true],
        [7002, true],
      ],
    )
    assert.equal(inspectorPorts({ MCP_SANDBOX_PORT: "7003", SERVER_PORT: "7001" })[1].port, 7003)
    // A value the inspector would ignore leaves its default.
    assert.equal(inspectorPorts({ CLIENT_PORT: "next" })[0].port, 6274)
  })

  it("links its web UI signed in", () => {
    assert.equal(inspectorLink(6274, "a b"), "http://127.0.0.1:6274/?MCP_INSPECTOR_API_TOKEN=a%20b")
  })
})

describe("port owners", () => {
  const ps = [
    "pulse-cibseven-1\tpulse\t127.0.0.1:8410->8410/tcp",
    "old-otel\tmiragon-ai\t127.0.0.1:8430->4317/tcp, 127.0.0.1:8431->4318/tcp",
    "plain\t\t0.0.0.0:8460->9090/tcp, [::]:8460->9090/tcp",
    "range\tx\t0.0.0.0:9000-9002->9000-9002/tcp",
    "no-ports\tx\t",
    "",
  ].join("\n")
  const owners = portOwners(ps)

  it("maps every published host port to its container and Compose project", () => {
    assert.deepEqual(owners.get(8410), { container: "pulse-cibseven-1", project: "pulse" })
    assert.deepEqual(owners.get(8431), { container: "old-otel", project: "miragon-ai" })
    assert.deepEqual(owners.get(8460), { container: "plain", project: "" })
    assert.deepEqual(owners.get(9001), { container: "range", project: "x" })
    assert.equal(owners.size, 7)
  })

  it("lets the stack's own project through and names how to stop anything else", () => {
    assert.equal(portConflict(8410, owners.get(8410)), undefined)
    assert.match(
      portConflict(8431, owners.get(8431)),
      /container old-otel \(Compose project miragon-ai\).*docker compose -p miragon-ai down/,
    )
    assert.match(portConflict(8460, owners.get(8460)), /`docker stop plain`/)
    assert.match(portConflict(8470, undefined), /process outside Docker/)
  })
})
