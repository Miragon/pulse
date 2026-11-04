/**
 * Every example command line (curated and generic) and every `pulse` command in the code blocks
 * of the core guide must be valid against the catalog: known group and
 * command, the right number of positional arguments, only options the command registers (operation
 * options from `operationOptions`, `--no-x` for boolean options, the global options of
 * GLOBAL_FLAGS) and values the CLI accepts. So neither the examples nor the guide can drift from
 * the catalog.
 */

import { describe, expect, it } from "vitest"
import { DOC_PAGES } from "../../test/support/doc-pages.js"
import { GLOBAL_OPTIONS } from "./globals.js"
import { examplesFor } from "../docs/examples.js"
import { GUIDE } from "../docs/guide.js"
import { commandWords } from "../docs/text.js"
import { WORKFLOW_DOCS } from "../docs/workflow.js"
import { catalog, commandLineChecker, guideCommands } from "../../test/support/command-lines.js"

const { checkCommandLine, checkOperationCommand } = commandLineChecker(GLOBAL_OPTIONS)

describe("the command line checker", () => {
  const ok = (line: string) => () => {
    checkCommandLine(commandWords(line))
  }

  it("accepts valid operation and utility commands", () => {
    expect(ok("pulse process-instance get abc -o table --pretty")).not.toThrow()
    expect(ok("pulse process-instance list --no-with-incident --all")).not.toThrow()
    expect(ok("pulse task complete t1 --var 'note=a b' --no-validate")).not.toThrow()
    expect(ok("pulse deployment create a.bpmn b.dmn --base-dir .")).not.toThrow()
    expect(ok("pulse metrics sum job-acquisition-attempt")).not.toThrow()
    expect(ok("pulse commands task --search claim --effect write")).not.toThrow()
    expect(ok("pulse describe getProcessInstances")).not.toThrow()
    expect(ok("pulse config unset prod url headers")).not.toThrow()
    expect(
      ok("pulse config set p --auth basic --auth-user demo --auth-password-env PW"),
    ).not.toThrow()
    expect(ok("pulse ping --auth basic --auth-user demo --auth-password-stdin")).not.toThrow()
    expect(ok('pulse api PUT /job/j1/retries --body {"retries":1}')).not.toThrow()
    expect(ok("pulse inspect p1 --history --no-variables -o table")).not.toThrow()
    expect(
      ok("pulse wait --business-key B --until task:a --until ended --wait-timeout 2m"),
    ).not.toThrow()
    expect(ok("pulse retry --process-definition-key k --dry-run")).not.toThrow()
    expect(ok("pulse deploy a b --start-key k --var x=1")).not.toThrow()
    expect(ok("pulse status --fail-on warning --stale-after 10m")).not.toThrow()
    expect(ok("pulse describe inspect")).not.toThrow()
    expect(ok("pulse commands workflow")).not.toThrow()
    expect(ok("pulse guide")).not.toThrow()
    expect(ok("pulse guide auth")).not.toThrow()
    expect(ok("pulse guide --list -o table")).not.toThrow()
  })

  it("rejects drift from the catalog", () => {
    expect(ok("pulse process-instance get")).toThrow()
    expect(ok("pulse process-instance get a b")).toThrow()
    expect(ok("pulse process-instance lists")).toThrow()
    expect(ok("pulse process-instance get abc --nope")).toThrow()
    expect(ok("pulse process-instance get abc --no-pretty")).toThrow()
    expect(ok("pulse process-instance list --active=true")).toThrow()
    expect(ok("pulse process-instance list --no-active")).toThrow()
    expect(ok("pulse process-instance list --sort-order up")).toThrow()
    expect(ok("pulse metrics sum my-metrics-name")).toThrow()
    expect(ok("pulse process-instance list --max-results ten")).toThrow()
    expect(ok("pulse process-instance list --fields")).toThrow()
    expect(ok("pulse process-instance list -o yaml")).toThrow()
    expect(ok("pulse historic-process-instance list --started-after yesterday")).toThrow()
    expect(ok("pulse task complete t1 --var novalue")).toThrow()
    expect(ok("pulse task complete t1 --body '{\"variablez\":{}}'")).toThrow()
    expect(ok("pulse process-instance delete abc")).toThrow()
    expect(ok("pulse deployment create")).toThrow()
    expect(ok("pulse commands no-such-group")).toThrow()
    expect(ok("pulse commands --effect remove")).toThrow()
    expect(ok("pulse describe task nothing")).toThrow()
    expect(ok("pulse config set")).toThrow()
    expect(ok("pulse config set p --auth digest")).toThrow()
    expect(ok("pulse config set p --oauth-issuer http://login.example.com")).toThrow()
    expect(ok("pulse config set p --auth-password-env MY-VAR")).toThrow()
    expect(ok("pulse config set p --auth-token-env MY-VAR")).toThrow()
    expect(ok("pulse config set p --auth-user a:b")).toThrow()
    expect(ok("pulse config rename a b")).toThrow()
    expect(ok("pulse api FETCH /x")).toThrow()
    expect(ok("pulse api DELETE /process-instance/abc")).toThrow()
    expect(ok("pulse ping extra")).toThrow()
    expect(ok("pulse guide --pretty")).toThrow()
    expect(ok("pulse guide setup")).toThrow()
    expect(ok("pulse guide auth recipes")).toThrow()
    expect(ok("pulse guide auth --list")).toThrow()
    expect(ok("pulse guide --list -o yaml")).toThrow()
    expect(ok("pulse inspect a b")).toThrow()
    expect(ok("pulse inspect a --nope")).toThrow()
    expect(ok("pulse wait a --until done")).toThrow()
    expect(ok("pulse wait a --wait-timeout soon")).toThrow()
    expect(ok("pulse status x")).toThrow()
    expect(ok("pulse status --fail-on never")).toThrow()
    expect(ok("pulse deploy")).toThrow()
    expect(ok("pulse retry --process-definition-key k")).toThrow()
    expect(ok("pulse retry a --retries one")).toThrow()
  })

  it("finds commands in fenced code blocks only, split at shell operators", () => {
    const markdown = [
      "pulse outside a block",
      "```sh",
      "echo '{}' | pulse task list --body - > out.json",
      "pulse ping && pulse guide",
      "export X=1",
      "```",
      "pulse after the block",
    ].join("\n")
    expect(guideCommands(markdown)).toEqual([
      ["pulse", "task", "list", "--body", "-"],
      ["pulse", "ping"],
      ["pulse", "guide"],
    ])
  })
})

describe("examples", () => {
  it("are valid for every operation of the catalog", () => {
    for (const operation of catalog.operations) {
      for (const example of examplesFor(operation)) {
        const words = commandWords(example)
        expect(words.slice(0, 3), example).toEqual(["pulse", operation.group, operation.name])
        expect(() => {
          checkOperationCommand(operation, words.slice(3))
        }, example).not.toThrow()
      }
    }
  })
})

const TOP_LEVEL = new Set(WORKFLOW_DOCS.map((doc) => doc.name))

describe("workflow command lines of the README and the docs pages", () => {
  const lines = DOC_PAGES.flatMap(([, text]) => guideCommands(text)).filter((words) =>
    TOP_LEVEL.has(words[1] ?? ""),
  )

  it("has the workflow commands", () => {
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
 * The minimum number of command lines of the core guide: well below their count, so that
 * independent edits that each drop a few lines cannot break main by a narrow margin.
 */
const MIN_GUIDE_COMMANDS = 15

describe("core guide", () => {
  const commands = guideCommands(GUIDE)

  it("has plenty of command lines", () => {
    expect(commands.length).toBeGreaterThanOrEqual(MIN_GUIDE_COMMANDS)
  })

  it.each(commands.map((words) => [words.join(" "), words] as const))("%s is valid", (_, words) => {
    checkCommandLine(words)
  })
})
