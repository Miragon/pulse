import { spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const app = fileURLToPath(new URL("../", import.meta.url))
const plugin = join(app, "dist")
const projectFile = resolve(process.argv[2] ?? join(app, "..", "vscode", "sandbox", ".pulse.json"))
const orca = join(app, "scripts", "orca.mjs")
const PLUGIN_KEY = "local.pulse-cockpit"
const WAIT_MS = 90_000
const POLL_MS = 3_000
const STARTED = Date.now()

class Smoke {
  static run() {
    Smoke.require(
      existsSync(join(plugin, "orca-plugin.json")),
      `No plugin folder at ${plugin}: build it first.`,
    )
    Smoke.require(existsSync(projectFile), `No project file at ${projectFile}.`)
    Smoke.load()
    Smoke.request("engines.setProjectFile", { path: projectFile })
    const engines = Smoke.waitForEngines()
    Smoke.step(
      `engines: ${engines.map((engine) => `${engine.name} (${engine.definitions.length} processes)`).join(", ")}`,
    )
    const view = Smoke.request("views.open", { engine: engines[0].name, view: "engine" })
    Smoke.require(existsSync(view.path), `views.open answered ${view.path}, which does not exist`)
    Smoke.step(`opened ${view.path}`)
    Smoke.orca(["plugin", "open", PLUGIN_KEY])
    Smoke.settle()
    Smoke.checkLogs()
    Smoke.step("ok")
  }

  static load() {
    const first = Smoke.orca(["plugin", "dev", "load", plugin, "--json"], { allow: [3] })
    if (first.status === 0) {
      Smoke.step("loaded")
      return
    }
    const fingerprint = Smoke.fingerprintOf(first.stdout)
    Smoke.require(
      fingerprint !== undefined,
      `dev load asked for approval without a fingerprint:\n${first.stdout}`,
    )
    Smoke.orca(["plugin", "dev", "load", plugin, "--approve", fingerprint, "--json"])
    Smoke.step(`loaded and approved ${fingerprint}`)
  }

  static waitForEngines() {
    const deadline = Date.now() + WAIT_MS
    for (;;) {
      const list = Smoke.request("engines.list")
      const ready = list.engines.filter(
        (engine) => engine.problem === undefined && engine.definitions.length > 0,
      )
      const reachable = list.engines.filter((engine) => !Smoke.unreachable(engine))
      if (list.problems.length === 0 && ready.length > 0 && ready.length === reachable.length) {
        for (const engine of list.engines.filter((candidate) => Smoke.unreachable(candidate))) {
          Smoke.step(`${engine.name}: ${engine.problem.title}`)
        }
        return ready
      }
      if (Date.now() > deadline) {
        Smoke.fail(
          `the engines did not answer within ${String(WAIT_MS / 1000)} s:\n${JSON.stringify(list, null, 2)}`,
        )
      }
      Smoke.pause(POLL_MS)
    }
  }

  static unreachable(engine) {
    return engine.problem !== undefined && /ENOTFOUND|ECONNREFUSED/.test(engine.problem.detail)
  }

  static checkLogs() {
    const { stdout } = Smoke.orca(["plugin", "logs", PLUGIN_KEY])
    const failures = stdout
      .split("\n")
      .filter((line) => Date.parse(line.split(" ")[0] ?? "") >= STARTED)
      .filter((line) => /failed|refused|error/i.test(line))
    Smoke.require(failures.length === 0, `the plugin logged failures:\n${failures.join("\n")}`)
  }

  static request(name, data) {
    const args = ["plugin", "dev", "request", plugin, name, "--json"]
    const { stdout } = Smoke.orca(
      data === undefined ? args : [...args, "--data", JSON.stringify(data)],
    )
    const answer = JSON.parse(stdout)
    Smoke.require(answer.ok === true, `${name} failed:\n${stdout}`)
    return answer.result.result
  }

  static orca(args, { allow = [] } = {}) {
    const result = spawnSync(process.execPath, [orca, ...args], { encoding: "utf8" })
    if (result.status !== 0 && !allow.includes(result.status)) {
      Smoke.fail(
        `orca ${args.join(" ")} exited with ${String(result.status)}:\n${result.stdout}${result.stderr}`,
      )
    }
    return result
  }

  static fingerprintOf(stdout) {
    return /ap1-[0-9a-f]+/.exec(stdout)?.[0]
  }

  static settle() {
    Smoke.pause(POLL_MS * 2)
  }

  static pause(ms) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
  }

  static step(message) {
    console.log(`[pulse-orca smoke] ${message}`)
  }

  static require(condition, message) {
    if (!condition) Smoke.fail(message)
  }

  static fail(message) {
    console.error(`[pulse-orca smoke] ${message}`)
    process.exit(1)
  }
}

Smoke.run()
