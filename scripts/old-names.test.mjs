import assert from "node:assert/strict"
import path from "node:path"
import { describe, it } from "node:test"
import { repoTextFiles } from "./check-package-scripts.mjs"

/**
 * Names that fail SILENTLY where they survive: a package someone else owns installs a
 * stranger's code, an image off the GitHub Container Registry pulls nothing (nothing
 * publishes to Docker Hub), a technical name of the retired operate CLI points to an
 * archived product, and the retired OAuth JSON variable configures nothing. No other gate
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
  // Only the "Renamed from operate" section may point to the archived repo (ALLOWED).
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
  // The CLI ships as @miragon/pulse-cli: the unscoped package pulse-cli is a stranger's, so
  // `npx pulse-cli` or `npm i -g pulse-cli` installs someone else's code.
  {
    name: "unscoped pulse-cli package",
    pattern:
      /(?:\bnpx|\bbunx|\bdlx)\s+(?:-{1,2}[\w-]+(?:=\S+)?\s+)*pulse-cli(?![\w-])|\b(?:npm|pnpm|yarn|bun)\s+(?:i|install|add)\s+(?:-{1,2}[\w-]+\s+)*pulse-cli(?![\w-])/,
  },
  // OAuth comes from mcp-use's own provider variables (MCP_USE_OAUTH_*); the server refuses
  // to boot while the retired JSON variable is set, so a doc or a config that still names it
  // sends an operator into a failed boot. Only the refusal and the operations page's upgrade
  // note name it (ALLOWED).
  { name: "retired MCP_OAUTH", pattern: /\bMCP_OAUTH\b/ },
]

/**
 * Never read: what `repoTextFiles` leaves out (the changelog release-please owns, the
 * lockfile, the vendored docs kit) and this guard, which spells out the names it bans.
 */
const SELF = path.relative(path.resolve(import.meta.dirname, ".."), import.meta.filename)

/**
 * Hits that are right where they are. Shrink-only: an entry that covers no hit fails.
 * `section`: only under a Markdown heading that matches, up to the next heading of its level
 * or above.
 */
const ALLOWED = [
  {
    file: "apps/cli/README.md",
    rules: ["old operate repo"],
    section: /^#{2,6} Renamed from operate\b/,
    reason: "the npm README points to the archived repository of operate (up to 0.10.0)",
  },
  {
    file: "docs/mcp/operations.md",
    rules: ["retired MCP_OAUTH"],
    section: /^#{2,6} Security\b/,
    reason: "the upgrade note names the retired variable an operator unsets",
  },
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

function allows(entry, hit, lines) {
  if (hit.file !== entry.file || !entry.rules.includes(hit.rule)) return false
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
    it(`the allowance still covers a hit: ${entry.reason}`, () => {
      assert.ok(hits.some(({ hit, lines }) => allows(entry, hit, lines)))
    })
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
    ["npx pulse-cli status", "unscoped pulse-cli package"],
    ["npm i -g pulse-cli", "unscoped pulse-cli package"],
    ["pnpm dlx pulse-cli guide", "unscoped pulse-cli package"],
    ["docker run --rm miragon/pulse-cli --version", "image off GHCR"],
    ["docker.io/miragon/pulse-cli:latest", "image off GHCR"],
    ["docker.io/miragon/pulse-server:latest", "image off GHCR"],
    ["https://hub.docker.com/r/miragon/pulse-server", "image off GHCR"],
    ["the Docker image `miragon/pulse-server`", "image off GHCR"],
    ['MCP_OAUTH={"provider":"keycloak"}', "retired MCP_OAUTH"],
    ["fly secrets set MCP_OAUTH=… -a app", "retired MCP_OAUTH"],
    ["- MCP_OAUTH", "retired MCP_OAUTH"],
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
    "npm i -g @miragon/pulse-cli",
    "brew install miragon/tap/pulse-cli",
    "ghcr.io/miragon/pulse-cli:0.22.0",
    "PULSE_CLI_URL=http://localhost:8080/engine-rest",
    "~/.config/pulse-cli/config.json",
    "reads ./.pulse-cli.json first",
    "deployment-source operate",
    'workerId: "operate"',
    // mcp-use's own OAuth variables, and a look-alike the boot refuses by itself.
    "MCP_USE_OAUTH_KEYCLOAK_SERVER_URL=https://kc.example.com",
    "MCP_USE_OAUTH_*",
    "MCP_OAUTH_KEYCLOAK_SERVER_URL",
  ]) {
    it(`${text} is no old name`, () => {
      assert.deepEqual(rulesMatching(text), [])
    })
  }
})
