/** Token commands: a script that fetches the token for a project file's profile, and again after a 401. */

import { mkdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { beforeAll, describe, expect, it } from "vitest"
import { globalFlag } from "../support/catalog.js"
import { expectSuccess, required } from "../support/expect.js"
import { CI_CLIENT_SECRET, CLIENTS, endpointsOf } from "../support/keycloak.js"
import type { EnvOverrides } from "../support/process.js"
import { MASKED_BEARER } from "../support/trace.js"
import type { BearerStatusOutput, Count } from "../support/types.js"
import { RUN_TIMEOUT_MS, SERVICE_ACCOUNT, countArgs, type BearerSuite } from "./suite.js"

export function registerTokenCommands(suite: BearerSuite): void {
  const { cli, top, trace, remember, expectHidden } = suite

  describe("token commands", () => {
    /**
     * The token command: the client credentials grant of `pulse-ci`, run by the shell. It logs
     * every run and every token it prints (so no output may contain one); IT_GARBAGE_FIRST prints
     * a token the gateway rejects on its first run.
     */
    const SCRIPT = `import { appendFileSync, readFileSync } from 'node:fs';
const { IT_RUNS, IT_TOKENS, IT_ENDPOINT, IT_CLIENT, IT_SECRET } = process.env;
const runs = (() => { try { return readFileSync(IT_RUNS, 'utf8').split('\\n').filter(Boolean).length; } catch { return 0; } })();
appendFileSync(IT_RUNS, 'run\\n');
let token = 'garbage-token-it';
if (!process.env.IT_GARBAGE_FIRST || runs > 0) {
  const answer = await fetch(IT_ENDPOINT, { method: 'POST', body: new URLSearchParams({ grant_type: 'client_credentials', client_id: IT_CLIENT, client_secret: IT_SECRET }) });
  token = (await answer.json()).access_token;
}
appendFileSync(IT_TOKENS, token + '\\n');
console.log(token);
`
    let repo = ""
    let runsFile = ""
    let tokensFile = ""
    /** The command line: the script by its full path, so it runs in every directory. */
    const command = () => `${JSON.stringify(process.execPath)} ${join(repo, "token.mjs")}`

    const runs = async () =>
      (await readFile(runsFile, "utf8").catch(() => "")).split("\n").filter(Boolean).length

    /** The variables of the command (passed through pulse-cli's environment). */
    function commandEnv(extra: EnvOverrides = {}): EnvOverrides {
      return {
        IT_RUNS: runsFile,
        IT_TOKENS: tokensFile,
        IT_ENDPOINT: endpointsOf(top().issuer).token,
        IT_CLIENT: CLIENTS.ci,
        IT_SECRET: CI_CLIENT_SECRET,
        ...extra,
      }
    }

    /**
     * Runs in the repository without PULSE_CLI_CONFIG and PULSE_CLI_URL, so the project file counts;
     * checks that no output contains a token the command printed.
     */
    async function inRepo(args: readonly string[], extra: EnvOverrides = {}, directory = "src") {
      const result = await cli(args, {
        timeoutMs: RUN_TIMEOUT_MS,
        cwd: join(repo, directory),
        env: commandEnv({ PULSE_CLI_CONFIG: undefined, PULSE_CLI_URL: undefined, ...extra }),
      })
      remember(...(await readFile(tokensFile, "utf8").catch(() => "")).split("\n").filter(Boolean))
      expectHidden(result)
      return result
    }

    beforeAll(async () => {
      const dir = required(suite.workdir, "the work directory")
      repo = join(dir, "repo")
      await mkdir(join(repo, ".git"), { recursive: true })
      await mkdir(join(repo, "src"), { recursive: true })
      await writeFile(join(repo, "token.mjs"), SCRIPT)
      runsFile = join(dir, "token-runs.log")
      tokensFile = join(dir, "token-values.log")
    })

    it("fetches the token for a profile of the project file and reuses it", async () => {
      const set = await inRepo([
        "config",
        "set",
        "it-command",
        "--project",
        "--url",
        top().url,
        "--auth",
        "bearer",
      ])
      expect(expectSuccess(set).stderr).toContain(
        `Created the project file ${join(repo, ".pulse-cli.json")}`,
      )
      const env = { PULSE_CLI_TOKEN_COMMAND: command() }
      const count = await inRepo(countArgs(), env)
      expect(expectSuccess(count).json<Count>().count).toBeGreaterThanOrEqual(0)
      expect(await runs()).toBe(1)
      // the next call takes the cached JWT
      const verbose = await inRepo(countArgs(globalFlag("verbose")), env)
      expectSuccess(verbose)
      expect(verbose.stderr).toContain(
        "* Using the token of the bearer token command of PULSE_CLI_TOKEN_COMMAND, cached until it expires",
      )
      expect(verbose.stderr).toMatch(MASKED_BEARER)
      expect(await runs()).toBe(1)
      const status = expectSuccess(await inRepo(["auth", "status"], env)).json<BearerStatusOutput>()
      expect(status).toMatchObject({
        profile: "it-command",
        source: "env",
        origin: "PULSE_CLI_TOKEN_COMMAND",
        command: command(),
        cached: true,
        format: "jwt",
        user: SERVICE_ACCOUNT,
      })
    })

    it("runs the command again after a 401 and retries with the new token", async () => {
      const retryRuns = join(required(suite.workdir, "the work directory"), "retry-runs.log")
      const result = await inRepo(countArgs(globalFlag("verbose")), {
        PULSE_CLI_TOKEN_COMMAND: command(),
        PULSE_CLI_URL: top().url,
        PULSE_CLI_CONFIG: suite.configFile,
        IT_GARBAGE_FIRST: "1",
        IT_RUNS: retryRuns,
      })
      expectSuccess(result)
      const answers = trace(result).filter((event) => event.startsWith("< "))
      expect(answers).toEqual(["< 401", "< 200"])
      expect((await readFile(retryRuns, "utf8")).split("\n").filter(Boolean)).toHaveLength(2)
    })
  })
}
