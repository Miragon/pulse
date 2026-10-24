/**
 * Every example command line (curated and generic) and every `operate` command in the code blocks
 * of the guide (the core and every topic) must be valid against the catalog: known group and
 * command, the right number of positional arguments, only options the command registers (operation
 * options from `operationOptions`, `--no-x` for boolean options, the global options of
 * GLOBAL_FLAGS) and values the CLI accepts. So neither the examples nor the guide can drift from
 * the catalog.
 */

import { describe, expect, it } from "vitest"
import { DOC_PAGES } from "../../test/support/doc-pages.js"
import { GUIDE_PAGES } from "../../test/support/guide-pages.js"
import { GLOBAL_OPTIONS } from "./globals.js"
import { examplesFor } from "../docs/examples.js"
import { commandWords } from "../docs/text.js"
import { WORKFLOW_DOCS } from "../docs/workflow.js"
import { catalog, commandLineChecker, guideCommands } from "../../test/support/command-lines.js"

const { checkCommandLine, checkOperationCommand } = commandLineChecker(GLOBAL_OPTIONS)

describe("the command line checker", () => {
  const ok = (line: string) => () => {
    checkCommandLine(commandWords(line))
  }

  it("accepts valid operation and utility commands", () => {
    expect(ok("operate process-instance get abc -o table --pretty")).not.toThrow()
    expect(ok("operate process-instance list --no-with-incident --all")).not.toThrow()
    expect(ok("operate task complete t1 --var 'note=a b' --no-validate")).not.toThrow()
    expect(ok("operate deployment create a.bpmn b.dmn --base-dir .")).not.toThrow()
    expect(ok("operate metrics sum job-acquisition-attempt")).not.toThrow()
    expect(ok("operate commands task --search claim --effect write")).not.toThrow()
    expect(ok("operate describe getProcessInstances")).not.toThrow()
    expect(ok("operate config unset prod url headers")).not.toThrow()
    expect(
      ok("operate config set p --auth basic --auth-user demo --auth-password-env PW"),
    ).not.toThrow()
    expect(ok("operate ping --auth basic --auth-user demo --auth-password-stdin")).not.toThrow()
    expect(ok('operate api PUT /job/j1/retries --body {"retries":1}')).not.toThrow()
    expect(ok("operate inspect p1 --history --no-variables -o table")).not.toThrow()
    expect(
      ok("operate wait --business-key B --until task:a --until ended --wait-timeout 2m"),
    ).not.toThrow()
    expect(ok("operate retry --process-definition-key k --dry-run")).not.toThrow()
    expect(ok("operate deploy a b --start-key k --var x=1")).not.toThrow()
    expect(ok("operate status --fail-on warning --stale-after 10m")).not.toThrow()
    expect(ok("operate completion zsh")).not.toThrow()
    expect(ok("operate describe inspect")).not.toThrow()
    expect(ok("operate commands workflow")).not.toThrow()
    expect(ok("operate guide")).not.toThrow()
    expect(ok("operate guide auth")).not.toThrow()
    expect(ok("operate guide --list -o table")).not.toThrow()
  })

  it("rejects drift from the catalog", () => {
    expect(ok("operate process-instance get")).toThrow()
    expect(ok("operate process-instance get a b")).toThrow()
    expect(ok("operate process-instance lists")).toThrow()
    expect(ok("operate process-instance get abc --nope")).toThrow()
    expect(ok("operate process-instance get abc --no-pretty")).toThrow()
    expect(ok("operate process-instance list --active=true")).toThrow()
    expect(ok("operate process-instance list --no-active")).toThrow()
    expect(ok("operate process-instance list --sort-order up")).toThrow()
    expect(ok("operate metrics sum my-metrics-name")).toThrow()
    expect(ok("operate process-instance list --max-results ten")).toThrow()
    expect(ok("operate process-instance list --fields")).toThrow()
    expect(ok("operate process-instance list -o yaml")).toThrow()
    expect(ok("operate historic-process-instance list --started-after yesterday")).toThrow()
    expect(ok("operate task complete t1 --var novalue")).toThrow()
    expect(ok("operate task complete t1 --body '{\"variablez\":{}}'")).toThrow()
    expect(ok("operate process-instance delete abc")).toThrow()
    expect(ok("operate deployment create")).toThrow()
    expect(ok("operate commands no-such-group")).toThrow()
    expect(ok("operate commands --effect remove")).toThrow()
    expect(ok("operate describe task nothing")).toThrow()
    expect(ok("operate config set")).toThrow()
    expect(ok("operate config set p --auth digest")).toThrow()
    expect(ok("operate config set p --oauth-issuer http://login.example.com")).toThrow()
    expect(ok("operate config set p --auth-password-env MY-VAR")).toThrow()
    expect(ok("operate config set p --auth-token-env MY-VAR")).toThrow()
    expect(ok("operate config set p --auth-user a:b")).toThrow()
    expect(ok("operate config rename a b")).toThrow()
    expect(ok("operate api FETCH /x")).toThrow()
    expect(ok("operate api DELETE /process-instance/abc")).toThrow()
    expect(ok("operate ping extra")).toThrow()
    expect(ok("operate guide --pretty")).toThrow()
    expect(ok("operate guide setup")).toThrow()
    expect(ok("operate guide auth recipes")).toThrow()
    expect(ok("operate guide auth --list")).toThrow()
    expect(ok("operate guide --list -o yaml")).toThrow()
    expect(ok("operate inspect a b")).toThrow()
    expect(ok("operate inspect a --nope")).toThrow()
    expect(ok("operate wait a --until done")).toThrow()
    expect(ok("operate wait a --wait-timeout soon")).toThrow()
    expect(ok("operate status x")).toThrow()
    expect(ok("operate status --fail-on never")).toThrow()
    expect(ok("operate deploy")).toThrow()
    expect(ok("operate retry --process-definition-key k")).toThrow()
    expect(ok("operate retry a --retries one")).toThrow()
    expect(ok("operate completion powershell")).toThrow()
  })

  it("finds commands in fenced code blocks only, split at shell operators", () => {
    const markdown = [
      "operate outside a block",
      "```sh",
      "echo '{}' | operate task list --body - > out.json",
      "operate ping && operate guide",
      "export X=1",
      "```",
      "operate after the block",
    ].join("\n")
    expect(guideCommands(markdown)).toEqual([
      ["operate", "task", "list", "--body", "-"],
      ["operate", "ping"],
      ["operate", "guide"],
    ])
  })
})

describe("examples", () => {
  it("are valid for every operation of the catalog", () => {
    for (const operation of catalog.operations) {
      for (const example of examplesFor(operation)) {
        const words = commandWords(example)
        expect(words.slice(0, 3), example).toEqual(["operate", operation.group, operation.name])
        expect(() => {
          checkOperationCommand(operation, words.slice(3))
        }, example).not.toThrow()
      }
    }
  })
})

const TOP_LEVEL = new Set([...WORKFLOW_DOCS.map((doc) => doc.name), "completion"])

describe("workflow command lines of the README and the docs pages", () => {
  const lines = DOC_PAGES.flatMap(([, text]) => guideCommands(text)).filter((words) =>
    TOP_LEVEL.has(words[1] ?? ""),
  )

  it("has the workflow commands and the completion commands", () => {
    expect(new Set(lines.map((words) => words[1]))).toEqual(TOP_LEVEL)
  })

  it.each(lines.map((words) => [words.join(" "), words] as const))("%s is valid", (_, words) => {
    checkCommandLine(words)
  })
})

describe("workflow examples", () => {
  it("are valid for every workflow command", () => {
    for (const doc of WORKFLOW_DOCS) {
      for (const example of doc.examples) {
        expect(() => {
          checkCommandLine(commandWords(example))
        }, example).not.toThrow()
      }
    }
  })
})

/**
 * The minimum number of command lines over all guide pages: well below their count, so that
 * independent edits that each drop a few lines cannot break main by a narrow margin.
 */
const MIN_GUIDE_COMMANDS = 60

describe("guide", () => {
  const commands = GUIDE_PAGES.flatMap(([page, text]) =>
    guideCommands(text).map((words) => [page, words] as const),
  )

  it("has plenty of command lines over all pages, and some on every page", () => {
    expect(commands.length).toBeGreaterThanOrEqual(MIN_GUIDE_COMMANDS)
    expect(new Set(commands.map(([page]) => page))).toEqual(
      new Set(GUIDE_PAGES.map(([page]) => page)),
    )
  })

  it.each(commands.map(([page, words]) => [page, words.join(" "), words] as const))(
    "%s: %s is valid",
    (_, __, words) => {
      checkCommandLine(words)
    },
  )
})
