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
  PLAYGROUND_BOARDS,
  PLAYGROUND_PASSWORD_VARIABLE,
  PLAYGROUND_WEB_CLIENT,
  portOwners,
  presetToolsets,
  profilesFor,
  SERVICES,
  serverPreset,
  SERVER_READY_PATH,
  servicesFor,
  WEB_BUILD,
  webClientProbe,
  withPreset,
} from "./local-env.mjs"

const compose = parse(readFileSync(new URL(`../${COMPOSE_FILE}`, import.meta.url), "utf8"))

/** The playground realm, which `--auth` and `--web` import into Keycloak. */
const realm = JSON.parse(
  readFileSync(
    new URL("../playground/docker/keycloak/realm-miragon.json", import.meta.url),
    "utf8",
  ),
)

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
    assert.deepEqual(ids({}), ["engine"])
    assert.deepEqual(ids({ multiEngine: true, auth: true }), ["engine", "engine-b", "keycloak"])
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
  it("point the server at the playground engine and loopback, the engine module", () => {
    assert.deepEqual(serverPreset(), {
      ENGINE_BASE_URL: "http://localhost:8410/engine-rest",
      ENGINE_ID: "prod-a",
      ENGINE_FLAVOR: "cibseven",
      ENGINE_COCKPIT_URL: "http://localhost:8410/webapp",
      ENGINE_AUTH_TYPE: "basic",
      ENGINE_USERNAME: "demo",
      ENGINE_PASSWORD: "demo",
      HOST: "127.0.0.1",
      MCP_ACTIVE_MODULES: "engine",
    })
  })

  it("hands the Compose engines no metrics settings: no plugin in them reads one", () => {
    for (const service of ["cibseven", "cibseven-b"]) {
      const names = compose.services[service].environment.map((entry) => entry.split("=")[0])
      const metrics = names.filter((name) => /^(?:ENGINE_ID|METRICS_ENABLED|OTEL_)/.test(name))
      assert.deepEqual(metrics, [], service)
    }
  })

  it("names both engines as profiles with --multi-engine, each with its own login", () => {
    const preset = serverPreset({ multiEngine: true })
    const auth = { type: "basic", username: "demo", passwordEnv: PLAYGROUND_PASSWORD_VARIABLE }
    assert.deepEqual(JSON.parse(preset.ENGINES_JSON), {
      profiles: {
        "prod-a": {
          url: "http://localhost:8410/engine-rest",
          cockpitUrl: "http://localhost:8410/webapp",
          flavor: "cibseven",
          auth,
        },
        "prod-b": {
          url: "http://localhost:8411/engine-rest",
          cockpitUrl: "http://localhost:8411/webapp",
          flavor: "cibseven",
          auth,
        },
      },
    })
    assert.equal(preset[PLAYGROUND_PASSWORD_VARIABLE], "demo")
    // The profile names its secret's variable under the prefix the server reads.
    assert.match(PLAYGROUND_PASSWORD_VARIABLE, /^ENGINE_SECRET_/)
    // The single engine's settings would only be ignored next to the profiles (a boot warning).
    for (const name of [
      "ENGINE_BASE_URL",
      "ENGINE_ID",
      "ENGINE_AUTH_TYPE",
      "ENGINE_USERNAME",
      "ENGINE_PASSWORD",
    ]) {
      assert.equal(preset[name], undefined, name)
    }
    // --auth puts the same profiles behind the playground's Keycloak.
    const behindAuth = serverPreset({ multiEngine: true, auth: true })
    assert.equal(behindAuth.ENGINES_JSON, preset.ENGINES_JSON)
    assert.equal(behindAuth.MCP_OAUTH_KEYCLOAK_REALM, "miragon")
  })

  it("hands the server the playground's board files by their absolute path", () => {
    assert.equal(serverPreset().ENGINE_BOARDS_DIR, undefined)
    const preset = serverPreset({ boardsDir: "/repo/playground/boards" })
    assert.equal(preset.ENGINE_BOARDS_DIR, "/repo/playground/boards")
    // The board names the playground's engine, a profile with and without --multi-engine.
    const board = JSON.parse(
      readFileSync(
        new URL(`../${PLAYGROUND_BOARDS}/operations.board.json`, import.meta.url),
        "utf8",
      ),
    )
    assert.deepEqual(board.engines, [serverPreset().ENGINE_ID])
    assert.ok(
      Object.hasOwn(
        JSON.parse(serverPreset({ multiEngine: true }).ENGINES_JSON).profiles,
        "prod-a",
      ),
    )
    // The containerized server (`--profile full`) reads the same files, mounted read-only.
    const server = compose.services["mcp-server"]
    assert.ok(server.environment.includes("ENGINE_BOARDS_DIR=/boards"))
    assert.ok(server.volumes.includes("../boards:/boards:ro"))
  })

  it("widens the toolset with --admin and registers deployments with --deploy", () => {
    assert.equal(serverPreset().MCP_ACTIVE_MODULES, "engine")
    assert.equal(serverPreset({ admin: true }).MCP_ACTIVE_MODULES, "engine:admin")
    assert.equal(serverPreset({ admin: true }).ENGINE_ALLOW_DEPLOYMENTS, undefined)
    assert.equal(serverPreset({ admin: true, deploy: true }).ENGINE_ALLOW_DEPLOYMENTS, "true")
  })

  it("names the toolsets play starts: the --admin suffix, else the engine module's default", () => {
    assert.equal(presetToolsets(serverPreset()), "engine, read-only")
    assert.equal(presetToolsets(serverPreset(), { auth: true }), "engine, its default under OAuth")
    assert.equal(presetToolsets(serverPreset({ admin: true }), { auth: true }), "engine:admin")
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

  it("turns on the web app with --web, behind the same Keycloak, from the web app's own build", () => {
    assert.equal(serverPreset({ auth: true }).MCP_WEB_CLIENT_ID, undefined)
    const preset = serverPreset({
      web: true,
      webDir: "/repo/apps/web/dist",
      sessionKey: "key",
    })
    assert.equal(preset.MCP_OAUTH_KEYCLOAK_REALM, "miragon")
    assert.equal(preset.MCP_URL, `http://localhost:${DEFAULT_SERVER_PORT}`)
    assert.equal(preset.MCP_WEB_CLIENT_ID, PLAYGROUND_WEB_CLIENT.id)
    assert.equal(preset.MCP_WEB_CLIENT_SECRET, PLAYGROUND_WEB_CLIENT.secret)
    assert.equal(preset.MCP_WEB_SESSION_KEYS, "key")
    assert.equal(preset.MCP_WEB_DIR, "/repo/apps/web/dist")
    // The web app's build, never the server package's web/, which only the image fills.
    const manifest = JSON.parse(
      readFileSync(new URL("../apps/web/package.json", import.meta.url), "utf8"),
    )
    assert.equal(manifest.scripts.build, "vite build")
    assert.equal(WEB_BUILD, "apps/web/dist")
    const ignored = readFileSync(new URL("../.gitignore", import.meta.url), "utf8")
    assert.match(ignored, /^apps\/mcp-server\/web\/?$/m)
  })

  it("matches the realm's web client: confidential, its addresses on MCP_URL, the gate's audience", () => {
    // Keycloak stores a client's description in 255 characters and fails its import beyond.
    for (const { clientId, description } of realm.clients) {
      assert.ok(description.length <= 255, `${clientId}'s description: ${description.length}`)
    }
    const client = realm.clients.find(({ clientId }) => clientId === PLAYGROUND_WEB_CLIENT.id)
    const { MCP_URL } = serverPreset({ web: true, webDir: "/d", sessionKey: "k" })
    assert.equal(client.publicClient, false)
    assert.equal(client.secret, PLAYGROUND_WEB_CLIENT.secret)
    assert.equal(client.standardFlowEnabled, true)
    assert.deepEqual(client.redirectUris, [`${MCP_URL}/app/auth/callback`])
    assert.equal(client.attributes["post.logout.redirect.uris"], `${MCP_URL}/app/signed-out`)
    assert.equal(client.attributes["pkce.code.challenge.method"], "S256")
    const audiences = client.protocolMappers
      .filter(({ protocolMapper }) => protocolMapper === "oidc-audience-mapper")
      .map(({ config }) => config["included.custom.audience"])
    assert.deepEqual(audiences, [`${MCP_URL}/mcp`])
    // The probe asks that Keycloak for this client with this redirect URI, on its loopback port.
    const probe = new URL(webClientProbe())
    const keycloak = SERVICES.find(({ id }) => id === "keycloak")
    assert.equal(probe.port, String(keycloak.ports[0]))
    assert.match(probe.pathname, new RegExp(`^/realms/${realm.realm}/`))
    assert.equal(probe.searchParams.get("client_id"), client.clientId)
    assert.equal(probe.searchParams.get("redirect_uri"), client.redirectUris[0])
    assert.equal(probe.searchParams.get("code_challenge_method"), "S256")
  })

  // An MCP client that registered itself keeps its session past Keycloak's 5-minute access token:
  // anonymous registration gives a client no optional scope its registration does not name (the
  // MCP Inspector names none, an empty scope), so only a default client scope reaches its client,
  // and it asks offline_access when it signs in again. The realm defines the scope: Keycloak adds
  // its own only after the import set the realm's defaults, which then miss it.
  it("gives a client that registers itself offline_access with its role, which the demo user holds", () => {
    assert.ok(realm.defaultDefaultClientScopes.includes("offline_access"))
    const offline = realm.clientScopes.find(({ name }) => name === "offline_access")
    assert.equal(offline.protocol, "openid-connect")
    assert.ok(offline.description.length <= 255)
    // Registered clients get no full scope (the policies below): the scope maps the role.
    assert.deepEqual(realm.scopeMappings, [
      { clientScope: "offline_access", roles: ["offline_access"] },
    ])
    // An imported user gets none of the realm's default roles unless the import names them.
    const demo = realm.users.find(({ username }) => username === "demo")
    assert.deepEqual(demo.realmRoles, [`default-roles-${realm.realm}`])
    // The realm's own clients keep it optional: the web sign-in never asks it.
    for (const { clientId, defaultClientScopes, optionalClientScopes } of realm.clients) {
      assert.deepEqual(defaultClientScopes, ["basic", "profile", "email", "mcp-resource"], clientId)
      assert.deepEqual(optionalClientScopes, ["offline_access"], clientId)
    }
  })

  it("keeps the registration policies of anonymous clients as strict as they are", () => {
    const policies = realm.components[
      "org.keycloak.services.clientregistration.policy.ClientRegistrationPolicy"
    ].filter(({ subType }) => subType === "anonymous")
    const byProvider = Object.fromEntries(policies.map((policy) => [policy.providerId, policy]))
    assert.deepEqual(Object.keys(byProvider).sort(), [
      "allowed-client-templates",
      "allowed-protocol-mappers",
      "consent-required",
      "default-roles",
      "max-clients",
      "registration-web-origins",
      "scope",
      "trusted-hosts",
    ])
    assert.deepEqual(byProvider["trusted-hosts"].config, {
      "trusted-hosts": ["localhost", "127.0.0.1", "github.com"],
      "host-sending-registration-request-must-match": ["false"],
      "client-uris-must-match": ["true"],
    })
    assert.deepEqual(byProvider["max-clients"].config, { "max-clients": ["200"] })
    // The realm's default scopes only, no scope of its own choosing.
    assert.deepEqual(byProvider["allowed-client-templates"].config, {
      "allow-default-scopes": ["true"],
    })
    // No mapper that could write aud, a claim or a session note (auth_time).
    const mappers = byProvider["allowed-protocol-mappers"].config["allowed-protocol-mapper-types"]
    for (const forbidden of [
      "oidc-audience-mapper",
      "oidc-hardcoded-claim-mapper",
      "oidc-usersessionmodel-note-mapper",
      "oidc-hardcoded-role-mapper",
    ]) {
      assert.ok(!mappers.includes(forbidden), forbidden)
    }
  })

  it("points the CLI at the same engine", () => {
    assert.equal(cliPreset().PULSE_CLI_URL, serverPreset().ENGINE_BASE_URL)
    assert.equal(cliPreset().PULSE_CLI_AUTH, "basic")
  })

  it("lets the caller's environment win and names what it replaced", () => {
    const { env, overridden } = withPreset(
      { ENGINE_ID: "prod-a", HOST: "127.0.0.1", ENGINE_FLAVOR: "cibseven" },
      { ENGINE_ID: "mine", HOST: "127.0.0.1", PATH: "/bin" },
    )
    assert.deepEqual(env, {
      ENGINE_ID: "mine",
      HOST: "127.0.0.1",
      ENGINE_FLAVOR: "cibseven",
      PATH: "/bin",
    })
    assert.deepEqual(overridden, ["ENGINE_ID"])
  })

  it("names the engine sources of the caller that outrank the playground engines", () => {
    const single = serverPreset()
    assert.deepEqual(withPreset(single, {}).outranking, [])
    assert.deepEqual(
      withPreset(single, { ENGINES_FILE: "e.json", ENGINES_JSON: "{}" }).outranking,
      ["ENGINES_FILE", "ENGINES_JSON"],
    )
    assert.deepEqual(withPreset(single, { ENGINES_FILE: " " }).outranking, [])
    const multi = serverPreset({ multiEngine: true })
    assert.deepEqual(withPreset(multi, { ENGINES_JSON: "{}" }).outranking, [])
    assert.deepEqual(withPreset(multi, { ENGINES_FILE: "e.json" }).outranking, ["ENGINES_FILE"])
    assert.deepEqual(withPreset(cliPreset(), { ENGINES_FILE: "e.json" }).outranking, [])
  })

  it("orders the engine sources as the engine module reads them", () => {
    const module = readFileSync(
      new URL(
        "../packages/connectors/engine/engine-connector/src/engine-profiles.ts",
        import.meta.url,
      ),
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
