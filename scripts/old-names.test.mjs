import assert from "node:assert/strict"
import path from "node:path"
import { describe, it } from "node:test"
import { repoTextFiles } from "./check-package-scripts.mjs"

/**
 * Names that fail SILENTLY where they survive: a package someone else owns installs a
 * stranger's code, an image off the GitHub Container Registry pulls nothing (nothing
 * publishes to Docker Hub), a technical name of the retired operate CLI points to an
 * archived product, the retired OAuth JSON variable configures nothing, and a name of the
 * retired camunda7 module (its tools, module name, packages, variables and metric names) names
 * nothing the server registers, reads or exports any more, a package of the retired MCP
 * toolkit installs a library Pulse no longer builds on. No other gate
 * reads them, so this guard reads every tracked text file (and every untracked one git does
 * not ignore) and fails on them.
 */

const RULES = [
  // The images live on GHCR only: a Docker Hub reference (docker.io/…, hub.docker.com/r/…)
  // or a bare name, which Docker resolves on Docker Hub, pulls nothing.
  {
    name: "image off GHCR",
    pattern: /(?<!ghcr\.io\/)(?<![\w.@-])miragon\/pulse-(?:server|cli)(?![\w-])/i,
  },
  // The CLI grew up as its own product, operate, in its own repo. In Pulse it ships under
  // Pulse names only (npm @miragon/pulse-cli, its variables PULSE_CLI_*), so every
  // technical name of the old product is retired: the package (any @miragon/operate-*
  // too), the repo, the image, the Homebrew tap, the docs, the product page, its
  // OPERATE_* variables, its config file and its config directory. The plain word stays
  // ("read and operate your engines", the cockpit's fleet.operate key, Camunda 8 Operate).
  // No file points to the archived repo.
  { name: "old operate package", pattern: /@miragon\/operate(?!\w)/i },
  { name: "old operate repo", pattern: /(?<![\w.-])miragon\/operate(?![\w-])/i },
  { name: "old operate image", pattern: /ghcr\.io\/miragon\/operate/i },
  { name: "old operate tap", pattern: /miragon\/tap\/operate/i },
  { name: "old operate docs URL", pattern: /miragon\.github\.io\/operate/i },
  { name: "old operate product page", pattern: /miragon\.ai\/tools\/operate/i },
  // A name of its own only: Camunda 8's CAMUNDA_OPERATE_* stays clean.
  { name: "old operate env var", pattern: /\bOPERATE_[A-Z]/ },
  { name: "old operate config file", pattern: /\.operate\.json/ },
  { name: "old operate config dir", pattern: /\.config\/operate/ },
  // The CLI ships as @miragon/pulse-cli and installs the commands pulse and pulse-cli: the
  // unscoped packages of either name are strangers', so `npx pulse status` or
  // `npm i -g pulse-cli` installs someone else's code.
  {
    name: "unscoped pulse or pulse-cli package",
    pattern:
      /(?:\bnpx|\bbunx|\bdlx)\s+(?:-{1,2}[\w-]+(?:=\S+)?\s+)*pulse(?:-cli)?(?![\w-])|\b(?:npm|pnpm|yarn|bun)\s+(?:i|install|add)\s+(?:-{1,2}[\w-]+\s+)*pulse(?:-cli)?(?![\w-])/,
  },
  // OAuth comes from one provider's variables (MCP_OAUTH_*); the server refuses to boot while
  // the retired JSON variable is set, so a doc or a config that still names it sends an operator
  // into a failed boot. Only the refusal and its test name it (ALLOWED).
  { name: "retired MCP_OAUTH", pattern: /\bMCP_OAUTH\b/ },
  // Pulse grew out of the @miragon/mcp-toolkit-* packages and owns what it used: the registrar,
  // the view meta and the server i18n are @miragon/pulse-widget-shell/server, the design kit
  // @miragon/pulse-ui, the view runtime @miragon/pulse-widget-shell/widgets. No package depends
  // on the toolkit any more (an import of it fails to resolve); a doc or a skill that names one
  // installs the old library next to Pulse. The toolkit's repository stays citable as the origin.
  { name: "retired toolkit package", pattern: /@miragon\/mcp-toolkit-/ },
  // The engine module was the camunda7 module up to 0.24: one REST API family three vendors
  // implement, named after one of them. Every technical name of it is retired; the vendor stays
  // (the flavor value `camunda7`, `camunda7Provider`, "Camunda 7"), and so do Camunda's own names
  // (CAMUNDA_BPM_RUN_*, CAMUNDA_OPERATE_*, the camunda: XML namespace, org.camunda.*). The boot
  // refuses the old module name and variables, naming their replacements (ALLOWED).
  { name: "retired camunda7_ tool prefix", pattern: /(?<![A-Za-z0-9-])camunda7_[A-Za-z0-9*<{$]/ },
  {
    name: "retired camunda7 module",
    // `camunda7: ` with a space is a key (the flavor map, YAML), not a module:toolset.
    pattern:
      /(?<![\w.-])camunda7:(?! )|MCP_ACTIVE_MODULES\s*[=:]\s*["'`]?[\w:,-]*(?<![\w-])camunda7(?![\w-])|(?<![\w-])camunda7[ -]Modul/i,
  },
  {
    name: "retired package or path",
    pattern:
      /@miragon\/pulse-(?:camunda7-(?:client|connector)|mcp-server-camunda7)(?![\w-])|(?<![\w-])(?:(?:mcp-)?server-camunda7|camunda7-(?:client|connector))(?![\w-])|connectors\\?\/camunda\\?\//,
  },
  {
    name: "retired public name",
    // The exports a composed server imported, and the heatmap's verdict without the module:
    // a type check catches them in code, nothing in prose (a README, a skill, the template).
    pattern:
      /(?<![\w$])(?:camunda7(?:Module|ConfigSchema|Views)|Camunda7(?:PluginConfig|ClientOptions|AuthType)|createCamunda7Client|CAMUNDA7_[A-Z_]+|bpmnNoCamunda7)(?![\w$])|(?<![\w-])no-camunda7(?![\w-])/,
  },
  {
    name: "retired server variable",
    // The exact sixteen (and the family wildcards), never a CAMUNDA_ prefix: Camunda's own
    // variables stay.
    pattern: new RegExp(
      `(?<![\\w])CAMUNDA_(?:(?:${[
        "ENGINES_FILE",
        "ENGINES_JSON",
        "BASE_URL",
        "ENGINE_ID",
        "ENGINE_FLAVOR",
        "DEFAULT_ENGINE",
        "COCKPIT_URL",
        "AUTH_TYPE",
        "USERNAME",
        "PASSWORD",
        "TOKEN",
        "INCIDENT_ISSUE_REPO",
        "HEALTH_CRITICAL_INCIDENTS",
        "HEALTH_CRITICAL_CLUSTER_SIZE",
        "ALLOW_DEPLOYMENTS",
        "REQUEST_TIMEOUT_MS",
      ].join("|")})(?![\\w])|\\*|HEALTH_CRITICAL_\\*|ENGINES_\\*)`,
    ),
  },
  {
    name: "retired metric name",
    // The nineteen in their Prometheus (`_`) and OTel (`.`) form, and the family wildcard.
    pattern: new RegExp(
      `(?<![\\w.])camunda[._](?:${[
        "process_instance_started",
        "process_instance_ended",
        "process_instance_duration",
        "activity_ended",
        "activity_duration",
        "usertask_created",
        "usertask_completed",
        "usertask_duration",
        "incident_created",
        "incident_resolved",
        "process_instances_running",
        "jobs_failed",
        "incidents_open",
        "jobs_executable",
        "jobs_suspended",
        "jobs_due_future",
        "usertasks_open",
        "process_definitions_deployed",
        "external_tasks_open",
      ]
        .map((stem) => stem.replace(/_/g, "[._]"))
        .join("|")})|(?<![\\w])camunda_\\*`,
    ),
  },
]

/**
 * Never read: what `repoTextFiles` leaves out (the changelog release-please owns, the
 * lockfile, the vendored docs kit) and this guard, which spells out the names it bans.
 */
const SELF = path.relative(path.resolve(import.meta.dirname, ".."), import.meta.filename)

/**
 * Hits that are right where they are. Shrink-only: an entry that covers no hit fails.
 * `file` is one file, `under` every file below a directory. `section`: only under a Markdown
 * heading that matches, up to the next heading of its level or above. `match`: only the names
 * it matches; the rest of the hit's text must be clean of the rule.
 */
const ALLOWED = [
  {
    file: "packages/core/widget-shell/src/oauth-env.ts",
    rules: ["retired MCP_OAUTH"],
    reason: "the boot refuses the retired variable and says what replaces it",
  },
  {
    file: "packages/core/widget-shell/src/oauth-env.test.ts",
    rules: ["retired MCP_OAUTH"],
    reason: "the refusal's own test",
  },
  {
    file: "packages/connectors/engine/engine-connector/src/retired-settings.ts",
    rules: ["retired server variable"],
    reason: "the boot refuses the camunda7 module's variables and says what replaces each",
  },
  {
    file: "packages/connectors/engine/engine-connector/src/retired-settings.test.ts",
    rules: ["retired server variable"],
    reason: "the refusal table's own test",
  },
  {
    under: "apps/cli/",
    rules: ["retired server variable"],
    match: /\bCAMUNDA_PASSWORD\b/g,
    reason: "the CLI names CAMUNDA_PASSWORD as an example of its own --auth-password-env",
  },
  {
    under: "docs/cli/",
    rules: ["retired server variable"],
    match: /\bCAMUNDA_PASSWORD\b/g,
    reason: "the CLI's docs name the same example variable",
  },
]

const root = path.resolve(import.meta.dirname, "..")
const textFiles = repoTextFiles(root)
  .filter(({ file }) => file !== SELF)
  .map(({ file, text }) => ({ file, lines: text.split("\n") }))

const rulesMatching = (text) =>
  RULES.filter((rule) => rule.pattern.test(text)).map((rule) => rule.name)

/** The 1-based lines under each heading that matches `heading`, fenced code skipped as headings. */
function sectionLines(lines, heading) {
  const inside = new Set()
  let level
  let fenced = false
  lines.forEach((text, index) => {
    if (/^\s*```/.test(text)) fenced = !fenced
    const depth = fenced ? undefined : /^(#{1,6})\s/.exec(text)?.[1]?.length
    if (depth !== undefined && level !== undefined && depth <= level) level = undefined
    if (depth !== undefined && heading.test(text)) level = depth
    if (level !== undefined) inside.add(index + 1)
  })
  return inside
}

const ruleNamed = (name) => RULES.find((rule) => rule.name === name)

function allows(entry, hit, lines) {
  if (!entry.rules.includes(hit.rule)) return false
  if (entry.file ? hit.file !== entry.file : !hit.file.startsWith(entry.under)) return false
  if (entry.match && ruleNamed(hit.rule).pattern.test(hit.text.replace(entry.match, ""))) {
    return false
  }
  return entry.section ? sectionLines(lines, entry.section).has(hit.line) : true
}

/** Every hit: its file, its 1-based line (0 is the path itself), the text and the rule. */
const hits = textFiles.flatMap(({ file, lines }) =>
  [file, ...lines].flatMap((text, line) =>
    rulesMatching(text).map((rule) => ({ hit: { file, line, text: text.trim(), rule }, lines })),
  ),
)

const where = ({ file, line, text, rule }) =>
  `${file}${line > 0 ? `:${line}` : ""} [${rule}] ${text.slice(0, 160)}`

describe("old and foreign names", () => {
  it("reads the repo", () => {
    assert.ok(textFiles.some(({ file }) => file === "CLAUDE.md"))
    assert.ok(textFiles.length > 500, `${textFiles.length} files`)
    assert.ok(!textFiles.some(({ file }) => file === SELF))
  })

  it("no file names an old name outside its allowance", () => {
    const stale = hits
      .filter(({ hit, lines }) => !ALLOWED.some((entry) => allows(entry, hit, lines)))
      .map(({ hit }) => where(hit))
    assert.deepEqual(stale, [])
  })

  for (const entry of ALLOWED) {
    // Per rule: an entry that lists a rule none of its hits trips would wave that rule through.
    for (const rule of entry.rules) {
      it(`the allowance still covers a hit of ${rule}: ${entry.reason}`, () => {
        assert.ok(hits.some(({ hit, lines }) => hit.rule === rule && allows(entry, hit, lines)))
      })
    }
  }
})

describe("the name rules", () => {
  for (const [text, rule] of [
    ['import { run } from "@miragon/operate"', "old operate package"],
    ["npm install -g @miragon/operate@1.4.0", "old operate package"],
    ['"name": "@miragon/operate-docs"', "old operate package"],
    ["https://github.com/Miragon/operate/issues", "old operate repo"],
    ["git@github.com:miragon/operate.git", "old operate repo"],
    ["gh repo clone MIRAGON/OPERATE", "old operate repo"],
    ["docker pull ghcr.io/miragon/operate:latest", "old operate image"],
    ["brew install miragon/tap/operate", "old operate tap"],
    ["https://miragon.github.io/operate/guide/", "old operate docs URL"],
    ["https://miragon.ai/tools/operate/", "old operate product page"],
    ["OPERATE_ENGINE_URL=http://localhost:8080/engine-rest", "old operate env var"],
    ["const token = process.env.OPERATE_TOKEN", "old operate env var"],
    ["echo $OPERATE_PROFILE", "old operate env var"],
    ["reads ./.operate.json first", "old operate config file"],
    ["~/.config/operate/engines.json", "old operate config dir"],
    ["npx pulse-cli status", "unscoped pulse or pulse-cli package"],
    ["npm i -g pulse-cli", "unscoped pulse or pulse-cli package"],
    ["pnpm dlx pulse-cli guide", "unscoped pulse or pulse-cli package"],
    ["npx pulse status", "unscoped pulse or pulse-cli package"],
    ["npx -y pulse@latest guide", "unscoped pulse or pulse-cli package"],
    ["npm install -g pulse", "unscoped pulse or pulse-cli package"],
    ["docker run --rm miragon/pulse-cli --version", "image off GHCR"],
    ["docker.io/miragon/pulse-cli:latest", "image off GHCR"],
    ["docker.io/miragon/pulse-server:latest", "image off GHCR"],
    ["https://hub.docker.com/r/miragon/pulse-server", "image off GHCR"],
    ["the Docker image `miragon/pulse-server`", "image off GHCR"],
    ['MCP_OAUTH={"provider":"keycloak"}', "retired MCP_OAUTH"],
    ["fly secrets set MCP_OAUTH=… -a app", "retired MCP_OAUTH"],
    ["- MCP_OAUTH", "retired MCP_OAUTH"],
    ['import { Button } from "@miragon/mcp-toolkit-ui"', "retired toolkit package"],
    ['"@miragon/mcp-toolkit-core": "2.6.0"', "retired toolkit package"],
    ["pnpm add @miragon/mcp-toolkit-ui@2.8.1", "retired toolkit package"],
    ["MCP_ACTIVE_MODULES=camunda7:operations,analytics", "retired camunda7 module"],
    ["MCP_ACTIVE_MODULES=analytics,camunda7", "retired camunda7 module"],
    ["Ohne das camunda7-Modul", "retired camunda7 module"],
    ['queryKey: ["camunda7:incidents"]', "retired camunda7 module"],
    ["camunda7_open_cockpit", "retired camunda7_ tool prefix"],
    ["mcp__pulse__camunda7_*", "retired camunda7_ tool prefix"],
    ["@miragon/pulse-camunda7-client", "retired package or path"],
    ["fly deploy -c playground/fly/server-camunda7.fly.toml", "retired package or path"],
    ['import { camunda7Module } from "@miragon/pulse-engine-connector"', "retired public name"],
    ["camunda7ConfigSchema.parse(raw)", "retired public name"],
    ["camunda7Views", "retired public name"],
    ["type C = Camunda7PluginConfig", "retired public name"],
    ["createCamunda7Client({ baseUrl })", "retired public name"],
    ["Camunda7ClientOptions, Camunda7AuthType", "retired public name"],
    ["CAMUNDA7_ADMIN_ONLY_TOOLS", "retired public name"],
    ["CAMUNDA7_HOST_WIDGET_REFS", "retired public name"],
    ['bpmnMissing: "no-camunda7"', "retired public name"],
    ["t.bpmnNoCamunda7", "retired public name"],
    ["@miragon/pulse-camunda7-connector", "retired package or path"],
    ['"name": "@miragon/pulse-mcp-server-camunda7"', "retired package or path"],
    ["apps/mcp-server-camunda7/test", "retired package or path"],
    ["packages/connectors/camunda/camunda7-client/src", "retired package or path"],
    ["/^packages\\/connectors\\/camunda\\/x/", "retired package or path"],
    ["CAMUNDA_BASE_URL=http://x", "retired server variable"],
    ["-e CAMUNDA_ENGINES_JSON='[…]'", "retired server variable"],
    ["Unknown `CAMUNDA_*` variables warn", "retired server variable"],
    ["CAMUNDA_HEALTH_CRITICAL_*", "retired server variable"],
    ["camunda_jobs_failed", "retired metric name"],
    ["camunda.jobs.due_future", "retired metric name"],
    ["increase(camunda_process_instance_duration_milliseconds_bucket[5m])", "retired metric name"],
    ["every camunda_* series", "retired metric name"],
  ]) {
    it(`${text} is ${rule}`, () => {
      assert.ok(rulesMatching(text).includes(rule), rulesMatching(text).join(", "))
    })
  }

  for (const text of [
    "@miragon/pulse-widget-shell",
    "@miragon/modeler-shell",
    "ghcr.io/miragon/pulse-server:latest",
    "ghcr.io/miragon/pulse-server:0.21.0-RC1",
    "https://github.com/Miragon/pulse/pkgs/container/pulse-server",
    "docker build -t pulse-server .",
    // operate as a word, the cockpit's key, the Camunda 8 product and its variables.
    "Pulse lets Claude read and operate your Camunda 7, CIB seven and Operaton engines",
    '"fleet.operate": "Open"',
    "Camunda 8 Operate shows the same instance",
    "operate",
    "Operate one engine",
    "CAMUNDA_OPERATE_BASE_URL=http://localhost:8081",
    'flavor: "operaton"',
    "https://docs.operaton.org/",
    "@miragon/pulse-cli",
    "npx -y @miragon/pulse-cli status",
    "npx @miragon/pulse-cli guide && pulse status",
    "npm i -g @miragon/pulse-ui",
    "npm i -g @miragon/pulse-cli",
    "brew install miragon/tap/pulse-cli",
    "ghcr.io/miragon/pulse-cli:0.22.0",
    "PULSE_CLI_URL=http://localhost:8080/engine-rest",
    "~/.config/pulse-cli/config.json",
    "reads ./.pulse-cli.json first",
    "deployment-source operate",
    'workerId: "operate"',
    // The OAuth variables and the log level of today, and the official SDK.
    "MCP_OAUTH_KEYCLOAK_SERVER_URL=https://kc.example.com",
    "MCP_OAUTH_*",
    "MCP_OAUTH_DEBUG=true",
    "MCP_LOG_LEVEL=debug",
    'import { McpServer } from "@modelcontextprotocol/server"',
    'import { App } from "@modelcontextprotocol/ext-apps"',
    "pnpm exec mcp-inspector --cli --method tools/list",
    // The toolkit as the origin of ported code stays citable.
    "ported from mcp-toolkit's examples/test/helpers/golden.ts",
    "the outline `Button` at that scale (Miragon/mcp-toolkit#194)",
    // The vendor and Camunda's own names stay; so do the new names.
    'flavor: "camunda7"',
    "export const camunda7: EngineAdapter",
    "camunda7: camunda7Provider,",
    "CAMUNDA_BPM_RUN_AUTH_ENABLED=true",
    "CAMUNDA_TYPE_MAP",
    "CAMUNDA_TOKEN_X",
    "engine_jobs_failed",
    "camunda.bpm.run.auth",
    "org.camunda.bpm.engine",
    "camunda7-rest",
    "MCP_ACTIVE_MODULES=engine:operations,analytics",
    "@miragon/pulse-engine-client",
    "ENGINE_BASE_URL=http://x",
    "engineModule, createEngineClient, ENGINE_ADMIN_ONLY_TOOLS",
    'bpmnMissing: "no-engine-module"',
    "playground/fly/server.fly.toml",
    // The CLI's own client of the vendor stays.
    "createCamunda7RestClient",
  ]) {
    it(`${text} is no old name`, () => {
      assert.deepEqual(rulesMatching(text), [])
    })
  }
})

describe("the allowances", () => {
  const cli = ALLOWED.find((entry) => entry.under === "apps/cli/")
  const hitIn = (file, text) => ({ file, line: 1, text, rule: rulesMatching(text)[0] })

  it("allow the CLI's example variable under the CLI", () => {
    const hit = hitIn("apps/cli/src/config/auth.ts", "--auth-password-env CAMUNDA_PASSWORD")
    assert.equal(hit.rule, "retired server variable")
    assert.ok(allows(cli, hit, []))
  })

  it("allow no other retired variable there, not even next to the example", () => {
    for (const text of [
      "--auth-password-env CAMUNDA_BASE_URL",
      "CAMUNDA_PASSWORD or CAMUNDA_BASE_URL",
    ]) {
      assert.ok(!allows(cli, hitIn("apps/cli/src/config/auth.ts", text), []), text)
    }
  })

  it("allow nothing outside the directory", () => {
    const hit = hitIn("apps/mcp-server/README.md", "--auth-password-env CAMUNDA_PASSWORD")
    assert.ok(!allows(cli, hit, []))
  })
})
