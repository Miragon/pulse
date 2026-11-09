import assert from "node:assert/strict"
import path from "node:path"
import { describe, it } from "node:test"
import { repoTextFiles } from "./check-package-scripts.mjs"

/**
 * Names that fail SILENTLY where they survive: a package someone else owns installs a
 * stranger's code, an image off the GitHub Container Registry pulls nothing (nothing
 * publishes to Docker Hub), a technical name of the retired operate CLI points to an
 * archived product, a package of the retired MCP toolkit installs a library Pulse no longer
 * builds on, and a retired package of an engine family installs a release that never gets a fix
 * again. No other gate reads them, so this guard reads every tracked text file (and every
 * untracked one git does not ignore) and fails on them.
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
  // Pulse grew out of the @miragon/mcp-toolkit-* packages and owns what it used: the registrar,
  // the view meta and the server i18n are @miragon/pulse-widget-shell/server, the design kit
  // @miragon/pulse-ui, the view runtime @miragon/pulse-widget-shell/widgets. No package depends
  // on the toolkit any more (an import of it fails to resolve); a doc or a skill that names one
  // installs the old library next to Pulse. The toolkit's repository stays citable as the origin.
  { name: "retired toolkit package", pattern: /@miragon\/mcp-toolkit-/ },
  // The Camunda 7 REST API is the dialect family c7: its core moved from the engine family to
  // @miragon/pulse-c7-core (packages/connectors/c7/c7-core) in 0.28, and the old name gets no
  // further release, so a doc or a manifest that names it installs 0.27 forever. The engine
  // module keeps its names (@miragon/pulse-engine-connector), and the word engine-core stays
  // citable as history.
  {
    name: "retired engine family package",
    pattern:
      /@miragon\/pulse-engine-core(?![\w-])|packages\/connectors\/engine\/engine-core(?![\w-])/,
  },
]

/**
 * Never read: what `repoTextFiles` leaves out (the changelog release-please owns, the
 * lockfile, the vendored docs kit) and this guard, which spells out the names it bans.
 */
const SELF = path.relative(path.resolve(import.meta.dirname, ".."), import.meta.filename)

const root = path.resolve(import.meta.dirname, "..")
const textFiles = repoTextFiles(root)
  .filter(({ file }) => file !== SELF)
  .map(({ file, text }) => ({ file, lines: text.split("\n") }))

const rulesMatching = (text) =>
  RULES.filter((rule) => rule.pattern.test(text)).map((rule) => rule.name)

/** Every hit: its file, its 1-based line (0 is the path itself), the text and the rule. */
const hits = textFiles.flatMap(({ file, lines }) =>
  [file, ...lines].flatMap((text, line) =>
    rulesMatching(text).map((rule) => ({ file, line, text: text.trim(), rule })),
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

  it("no file names an old name", () => {
    assert.deepEqual(hits.map(where), [])
  })
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
    ['import { Button } from "@miragon/mcp-toolkit-ui"', "retired toolkit package"],
    ['"@miragon/mcp-toolkit-core": "2.6.0"', "retired toolkit package"],
    ["pnpm add @miragon/mcp-toolkit-ui@2.8.1", "retired toolkit package"],
    [
      'import { inspectInstance } from "@miragon/pulse-engine-core"',
      "retired engine family package",
    ],
    ['"@miragon/pulse-engine-core": "workspace:*"', "retired engine family package"],
    ["npm install @miragon/pulse-engine-core@0.27.1", "retired engine family package"],
    [
      'import { fakePort } from "@miragon/pulse-engine-core/testing"',
      "retired engine family package",
    ],
    ["packages/connectors/engine/engine-core/src/index.ts", "retired engine family package"],
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
    // The official SDK and its inspector.
    'import { McpServer } from "@modelcontextprotocol/server"',
    'import { App } from "@modelcontextprotocol/ext-apps"',
    "pnpm exec mcp-inspector --cli --method tools/list",
    // The dialect family c7, the engine module's own names and engine-core as history.
    "@miragon/pulse-c7-core",
    "packages/connectors/c7/c7-core/src/index.ts",
    "@miragon/pulse-engine-connector",
    "packages/connectors/engine/engine-connector/src/module.ts",
    "c7-core (engine-core until 0.27) holds the pure engine rules",
    "@miragon/pulse-engine-cores",
    // The toolkit as the origin of ported code stays citable.
    "ported from mcp-toolkit's examples/test/helpers/golden.ts",
    "the outline `Button` at that scale (Miragon/mcp-toolkit#194)",
  ]) {
    it(`${text} is no old name`, () => {
      assert.deepEqual(rulesMatching(text), [])
    })
  }
})
