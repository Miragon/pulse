// @ts-check
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, it } from "node:test"
import ts from "typescript"
import { repoTextFiles } from "./check-package-scripts.mjs"
import { REPO_ROOT } from "./source-scan.mjs"

/**
 * engine-core's admission rule (#694, F30): a port, read model or rule stands in
 * `@miragon/pulse-engine-core` when both dialects answer it with the same meaning, proven by a law
 * of the conformance kit on both; what stands there ahead of that, the table of the package's
 * README lists ("## The admission rule"). This guard holds every name the main entry exports, and
 * each member of `ProcessRuntime`, to exactly one of the two: proven (`PROVEN`, by the topics the
 * kit names its laws by, `definitions:`, `incidents:` …, each a law of a set every dialect's
 * suites register), or a row of the table, whose last cell names the topics that admit it once
 * both dialects run them. A row whose laws both run fails as admitted; a proof whose laws one
 * dialect runs alone fails as unproven. Which sets a dialect runs is read from its suites
 * (`HARNESSES`, each call of `registerRuntimeLaws`, `registerCommandLaws`, `registerTenantLaws`
 * with the whole set), and laws that hold only for a runtime with an optional pair of members
 * (`OPTIONAL_TOPICS`: the migration plan laws pass without a plan) prove it only where every
 * dialect's runtime declares the pair.
 */

const CORE = "packages/connectors/engine/engine-core"
const README = `${CORE}/README.md`

/** Each dialect's conformance suites, the only files outside engine-core's tests that run the kit. */
const HARNESSES = {
  c7: [
    "packages/connectors/c7/c7-adapter/test/c7-conformance.engine.test.ts",
    "packages/connectors/c7/c7-adapter/test/c7-history-audit.engine.test.ts",
    "packages/connectors/c7/c7-adapter/test/c7-tenants.engine.test.ts",
    "packages/connectors/engine/engine-connector/src/lib/core-adapter/c7-runtime.engine.test.ts",
  ],
  c8: [
    "packages/connectors/c8/c8-adapter/test/c8-conformance.engine.test.ts",
    "packages/connectors/engine/engine-connector/src/lib/core-adapter/c8-runtime.engine.test.ts",
  ],
}

/** Each dialect's runtime, whose members say which optional pair it answers. */
const RUNTIMES = {
  c7: { file: "packages/connectors/c7/c7-core/src/runtime/c7-runtime.ts", name: "C7Runtime" },
  c8: { file: "packages/connectors/c8/c8-core/src/c8-runtime.ts", name: "C8Runtime" },
}

/** The kit's law sets: the object of each set's law names and the call that registers it whole. */
const LAW_SETS = {
  read: { file: `${CORE}/src/testing/conformance/conformance-case.ts`, names: "CASE" },
  command: { file: `${CORE}/src/testing/conformance/command-harness.ts`, names: "COMMAND_CASE" },
  tenant: { file: `${CORE}/src/testing/conformance/tenant-harness.ts`, names: "TENANT_CASE" },
}
const REGISTERS = {
  registerRuntimeLaws: "read",
  registerCommandLaws: "command",
  registerTenantLaws: "tenant",
}

/** Topics whose laws pass for a runtime without the optional members named, so prove nothing there. */
const OPTIONAL_TOPICS = { "migration:": ["proposeMigration", "checkMigration"] }

/** Outside the rule: the contract's own, which answers no engine, so no dialect has to. */
const OUTSIDE_THE_RULE = {
  FailingRuntime:
    "the contract's own runtime, which refuses every call with one RuntimeError (the runtime " +
    "view's refused connection); engine-core's test/failing-runtime.test.ts holds it",
}

/** What both dialects answer, by the topics of the laws that prove it on both. */
const PROVEN = {
  BpmnProcessId: ["definitions:", "calls:"],
  DefinitionId: ["versions:", "diagram:"],
  ElementId: ["statistics:", "detail:"],
  IncidentId: ["incidents:"],
  InstanceId: ["instances:", "detail:"],
  IsoTimestamp: ["instances:"],
  PageCursor: ["instances:", "incidents:"],
  IncidentFilter: ["incidents:"],
  InstanceCount: ["instances:"],
  InstanceFilter: ["instances:", "variables:"],
  Page: ["instances:", "incidents:"],
  PageRequest: ["instances:", "incidents:"],
  VariableComparison: ["variables:"],
  VariableCondition: ["variables:"],
  VariableConditionKind: ["variables:"],
  CalledInstance: ["detail:"],
  CalledProcess: ["calls:"],
  CallingVersion: ["calls:"],
  DefinitionRef: ["incidents:", "calls:"],
  DefinitionSummary: ["definitions:"],
  ElementStatistics: ["statistics:"],
  EngineInfo: ["engine:"],
  Incident: ["incidents:"],
  IncidentDetails: ["incidents:"],
  IncidentJob: ["incidents:"],
  ElementRun: ["detail:"],
  InstanceDetail: ["detail:"],
  InstanceState: ["instances:"],
  InstanceSummary: ["instances:"],
  ValueKind: ["detail:"],
  Variable: ["detail:", "variables:"],
  VersionSummary: ["versions:"],
  WaitState: ["detail:"],
  WaitStateKind: ["detail:"],
  RootCauses: ["incidents:"],
  RuntimeError: ["errors:", "variables:"],
  RuntimeFailure: ["errors:", "variables:"],
  ValueKinds: ["detail:"],
  "ProcessRuntime.describeEngine": ["engine:"],
  "ProcessRuntime.listDefinitions": ["definitions:"],
  "ProcessRuntime.listVersions": ["versions:"],
  "ProcessRuntime.getDiagramXml": ["diagram:"],
  "ProcessRuntime.getElementStatistics": ["statistics:"],
  "ProcessRuntime.getCalledProcesses": ["calls:"],
  "ProcessRuntime.searchInstances": ["instances:"],
  "ProcessRuntime.countInstances": ["instances:"],
  "ProcessRuntime.refusedVariableConditions": ["variables:"],
  "ProcessRuntime.listVariableNames": ["variables:"],
  "ProcessRuntime.getInstanceDetail": ["detail:"],
  "ProcessRuntime.searchIncidents": ["incidents:"],
  "ProcessRuntime.getIncidentDetails": ["incidents:"],
}

/** @param {string} file */
function sourceOf(file) {
  const text = readFileSync(path.join(REPO_ROOT, file), "utf8")
  return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
}

/**
 * Every name the module `file` exports, its types included, as a program of the package's own
 * compiler options resolves it: a named re-export, `export *` of a module, and a declaration
 * exported in place (`export const`, `export function`).
 */
function exportedNames(file) {
  const dir = path.join(REPO_ROOT, CORE)
  const { config } = ts.readConfigFile(path.join(dir, "tsconfig.json"), ts.sys.readFile)
  const { options } = ts.parseJsonConfigFileContent(config, ts.sys, dir)
  const entry = path.join(REPO_ROOT, file)
  const program = ts.createProgram([entry], { ...options, noEmit: true })
  const checker = program.getTypeChecker()
  const source = program.getSourceFile(entry)
  const module = source === undefined ? undefined : checker.getSymbolAtLocation(source)
  assert.ok(module, `${file} is no module`)
  return checker.getExportsOfModule(module).map((symbol) => symbol.getName())
}

/**
 * The declaration named `name` in `file` that `is` accepts.
 *
 * @template {ts.InterfaceDeclaration | ts.ClassDeclaration} T
 * @param {string} file
 * @param {string} name
 * @param {(node: ts.Node) => node is T} is
 * @returns {T}
 */
function declarationOf(file, name, is) {
  const found = sourceOf(file)
    .statements.filter(is)
    .find((statement) => statement.name?.text === name)
  assert.ok(found, `${file} declares no ${name}`)
  return found
}

/** The members `ProcessRuntime` declares. */
function runtimeMembers() {
  const port = declarationOf(
    `${CORE}/src/ports/process-runtime.ts`,
    "ProcessRuntime",
    ts.isInterfaceDeclaration,
  )
  return port.members.flatMap((member) =>
    member.name ? [`ProcessRuntime.${member.name.getText()}`] : [],
  )
}

/** The members a dialect's runtime class declares. */
function classMembers({ file, name }) {
  const runtime = declarationOf(file, name, ts.isClassDeclaration)
  return new Set(runtime.members.flatMap((member) => (member.name ? [member.name.getText()] : [])))
}

/** The law names of one set, the string values of its names object. */
function lawNames({ file, names }) {
  const statement = sourceOf(file)
    .statements.filter(ts.isVariableStatement)
    .find((candidate) =>
      candidate.declarationList.declarations.some((decl) => decl.name.getText() === names),
    )
  assert.ok(statement, `${file} declares no ${names}`)
  const [declaration] = statement.declarationList.declarations
  let literal = declaration.initializer
  while (literal && ts.isAsExpression(literal)) literal = literal.expression
  assert.ok(literal && ts.isObjectLiteralExpression(literal), `${names} is no object literal`)
  return literal.properties.map((property) => {
    assert.ok(ts.isPropertyAssignment(property) && ts.isStringLiteralLike(property.initializer))
    return property.initializer.text
  })
}

/** The law sets `text` registers whole: a call of a set's register method with one argument. */
function setsRegisteredIn(file, text) {
  const sets = new Set()
  const visit = (node) => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const set = REGISTERS[node.expression.name.text]
      if (set !== undefined && node.arguments.length === 1) sets.add(set)
    }
    ts.forEachChild(node, visit)
  }
  visit(ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS))
  return sets
}

/** The sets every dialect registers whole. */
function setsBothRun() {
  const perDialect = Object.values(HARNESSES).map((files) => {
    const sets = new Set()
    for (const file of files) {
      for (const set of setsRegisteredIn(file, readFileSync(path.join(REPO_ROOT, file), "utf8"))) {
        sets.add(set)
      }
    }
    return sets
  })
  return new Set(Object.keys(LAW_SETS).filter((set) => perDialect.every((sets) => sets.has(set))))
}

/** The rows of the README's table: the names of its first cell and the topics of its last. */
function admittedAhead() {
  const text = readFileSync(path.join(REPO_ROOT, README), "utf8")
  const section = text.slice(text.indexOf("## The admission rule"))
  const rows = section
    .slice(0, section.indexOf("\n## ", 1) === -1 ? undefined : section.indexOf("\n## ", 1))
    .split("\n")
    .filter((line) => line.startsWith("| `"))
  const ticked = (cell) => [...cell.matchAll(/`([^`]+)`/g)].map((match) => match[1])
  return rows.map((row) => {
    const cells = row.split("|").slice(1, -1)
    return { row, names: ticked(cells[0] ?? ""), topics: ticked(cells.at(-1) ?? "") }
  })
}

/** Why `topics` do not prove a name on both dialects, or undefined when they do. */
function unproven(topics, laws, bothRun, runtimes) {
  for (const topic of topics) {
    const sets = Object.keys(laws).filter((set) => laws[set].some((law) => law.startsWith(topic)))
    if (sets.length === 0) return `no law of the kit is named ${topic}`
    if (!sets.some((set) => bothRun.has(set))) return `one dialect alone runs the ${topic} laws`
    const pair = OPTIONAL_TOPICS[topic] ?? []
    const lacking = Object.entries(runtimes).filter(([, members]) =>
      pair.some((member) => !members.has(member)),
    )
    if (lacking.length > 0) {
      return `${lacking.map(([dialect]) => dialect).join(", ")} declares no ${pair.join(" or ")}`
    }
  }
  return undefined
}

/** Whether `topics` are all run by both dialects: then a row of the table is admitted. */
function runByBoth(topics, laws, bothRun, runtimes) {
  return topics.every((topic) => {
    const sets = Object.keys(laws).filter((set) => laws[set].some((law) => law.startsWith(topic)))
    return (
      sets.every((set) => bothRun.has(set)) &&
      unproven([topic], laws, bothRun, runtimes) === undefined
    )
  })
}

describe("engine-core's admission rule", () => {
  const exported = exportedNames(`${CORE}/src/index.ts`)
  const members = runtimeMembers()
  const rows = admittedAhead()
  const listed = rows.flatMap(({ names }) => names)
  const laws = Object.fromEntries(Object.entries(LAW_SETS).map(([set, at]) => [set, lawNames(at)]))
  const bothRun = setsBothRun()
  const runtimes = Object.fromEntries(
    Object.entries(RUNTIMES).map(([dialect, runtime]) => [dialect, classMembers(runtime)]),
  )

  it("reads the kit, the suites and the table: the read laws run on both dialects", () => {
    assert.ok(exported.length > 40 && members.length > 15 && rows.length > 0)
    assert.deepEqual([...bothRun], ["read"])
    assert.ok(laws.read.length > 50 && laws.command.length > 0 && laws.tenant.length > 0)
  })

  it("classifies each export and each port member once: proven, outside the rule or listed", () => {
    const classified = [
      ...Object.keys(PROVEN),
      ...Object.keys(OUTSIDE_THE_RULE),
      ...listed,
      "ProcessRuntime",
    ]
    const names = [...exported, ...members]
    assert.deepEqual(
      names.filter((name) => !classified.includes(name)),
      [],
      "an export of engine-core that no law proves on both dialects goes into the README's table",
    )
    assert.deepEqual(
      classified.filter((name) => !names.includes(name)),
      [],
      "a classified name engine-core no longer exports",
    )
    assert.deepEqual(
      classified.filter((name, index) => classified.indexOf(name) !== index),
      [],
      "a name classified twice",
    )
  })

  it("proves each proven name by laws both dialects run", () => {
    const failures = Object.entries(PROVEN).flatMap(([name, topics]) => {
      const why = unproven(topics, laws, bothRun, runtimes)
      return why === undefined ? [] : [`${name}: ${why}`]
    })
    assert.deepEqual(failures, [])
  })

  it("names in each row of the table the laws that admit it, which one dialect alone runs yet", () => {
    for (const { row, topics } of rows) {
      assert.ok(topics.length > 0, `the row names no law that admits it: ${row}`)
      assert.equal(
        topics.every((topic) =>
          Object.values(laws)
            .flat()
            .some((law) => law.startsWith(topic)),
        ),
        true,
        `the row names a topic no law of the kit has: ${row}`,
      )
      assert.equal(
        runByBoth(topics, laws, bothRun, runtimes),
        false,
        `both dialects run the laws of this row: admit it, and move it out of the table: ${row}`,
      )
    }
  })

  it("knows every suite that runs the kit outside engine-core's own tests", () => {
    const known = new Set(Object.values(HARNESSES).flat())
    const unknown = repoTextFiles(REPO_ROOT)
      .filter(({ file }) => /\.[cm]?tsx?$/.test(file) && !file.startsWith(`${CORE}/`))
      .filter(
        ({ file, text }) =>
          /\.register(?:Runtime|Command|Tenant)Laws\(/.test(text) && !known.has(file),
      )
      .map(({ file }) => file)
    assert.deepEqual(unknown, [], "a new suite runs the kit: name its dialect in HARNESSES")
  })
})
