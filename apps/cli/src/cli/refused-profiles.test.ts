/**
 * A profile the format refuses, through `run()`: the file still loads, a command fails only when
 * it uses that profile, `config list` shows why and `config show` fails with it, the notes on a
 * file's root go to stderr, and `config set|unset` repair the profile without dropping a key. A
 * refused profile's values are never shown: one may be a credential in the wrong place.
 */

import { describe, expect, it } from "vitest"
import { BASE_URL, fakeServer, json } from "../../test/support/fake-fetch.js"
import {
  CONFIG_PATH,
  execute,
  fakeRuntime,
  type FakeRuntime,
  fileText,
} from "../../test/support/fake-runtime.js"
import { run } from "./run.js"

const LEAK = "https://demo:pa55word@engine.example.com/engine-rest"

const FILE = JSON.stringify({
  defaultProfile: "good",
  profiles: {
    good: { url: BASE_URL },
    broken: { url: BASE_URL, flavour: "operaton" },
    leaky: { url: LEAK },
    "pa55 word": {},
  },
  default: "good",
})

function runtimeOf(): FakeRuntime {
  const server = fakeServer()
    .on("GET", "/version", json({ version: "7.24.0" }))
    .on("GET", "/engine", json([{ name: "default" }]))
  return fakeRuntime({ fetch: server.fetch, files: { [CONFIG_PATH]: FILE } })
}

async function cli(runtime: FakeRuntime, args: readonly string[]) {
  runtime.stdout.chunks.length = 0
  runtime.stderr.chunks.length = 0
  const result = await execute(run, args, runtime)
  expect(`${result.stdout}${result.stderr}`).not.toMatch(/pa55/)
  return result
}

function errorOf(stderr: string): Record<string, unknown> {
  return (JSON.parse(stderr) as { error: Record<string, unknown> }).error
}

const INVALID_NAME =
  'The profile\'s name is not valid (it is not shown): use letters, digits, ".", "_" and "-", starting with a letter or digit.'

const NOTICES = [
  `Notice: the config file ${CONFIG_PATH}: default is no key of a profile file, which holds $schema, defaultProfile and profiles.`,
  `Notice: the config file ${CONFIG_PATH}: ${INVALID_NAME}`,
]

describe("a refused profile", () => {
  it("fails only the command that uses it", async () => {
    const runtime = runtimeOf()
    expect(await cli(runtime, ["ping", "-o", "json"])).toMatchObject({ code: 0 })
    const broken = await cli(runtime, ["ping", "--profile", "broken"])
    expect(broken.code).toBe(3)
    expect(errorOf(broken.stderr)).toMatchObject({
      code: "CONFIG",
      message:
        'Profile "broken" of your config file cannot be used: flavour is no key of a profile.',
      hint: "Remove it with `pulse config unset broken flavour`, or fix its spelling in the file.",
    })
    const leaky = await cli(runtime, ["config", "show", "--profile", "leaky"])
    expect(errorOf(leaky.stderr)).toMatchObject({
      message:
        'Profile "leaky" of your config file cannot be used: url must not contain credentials (they are not shown): put them into auth.',
      hint: "Fix it in the file, or set it with `pulse config set leaky --url <url>`.",
    })
    // a name that is no valid name is never repeated, not even the one --profile gave
    const unnamed = await cli(runtime, ["ping", "--profile", "pa55 word"])
    expect(errorOf(unnamed.stderr)).toMatchObject({
      message: `The profile of your config file cannot be used: ${INVALID_NAME}`,
      hint: "Fix the profile in the file, or change it with `pulse config set <profile> <options>`.",
    })
  })

  it("is listed with why instead of its values, and the file's notes go to stderr", async () => {
    const list = await cli(runtimeOf(), ["config", "list"])
    expect(list.code).toBe(0)
    expect(JSON.parse(list.stdout)).toEqual([
      expect.objectContaining({
        name: "broken",
        url: null,
        auth: null,
        problems: "flavour is no key of a profile.",
      }),
      {
        name: "good",
        default: true,
        url: BASE_URL,
        engine: null,
        auth: null,
        readOnly: false,
        scope: "user",
      },
      expect.objectContaining({ name: "leaky", url: null }),
    ])
    expect(list.stderr).toBe(`${NOTICES.join("\n")}\n`)
    const show = await cli(runtimeOf(), ["config", "show"])
    expect(show.code).toBe(0)
    expect(show.stderr).toBe(`${NOTICES.join("\n")}\n`)
  })

  it("is repaired by config set and unset, which keep every key until it is removed", async () => {
    const runtime = runtimeOf()
    const set = await cli(runtime, ["config", "set", "broken", "--read-only"])
    expect(set.code).toBe(0)
    expect(JSON.parse(set.stdout)).toEqual({
      name: "broken",
      default: false,
      problems: "flavour is no key of a profile.",
    })
    expect(set.stderr).toBe(
      'Notice: profile "broken" is stored, but a command cannot use it yet: flavour is no key of a profile.\n',
    )
    const stored = JSON.parse(fileText(runtime, CONFIG_PATH) ?? "") as Record<string, unknown>
    expect(stored).toMatchObject({
      profiles: { broken: { url: BASE_URL, readOnly: true, flavour: "operaton" } },
      default: "good",
    })
    expect(Object.keys(stored.profiles as object)).toEqual(["good", "broken", "leaky", "pa55 word"])
    const unset = await cli(runtime, ["config", "unset", "broken", "flavour"])
    expect(unset).toMatchObject({ code: 0, stderr: "" })
    expect(JSON.parse(unset.stdout)).toEqual({
      name: "broken",
      default: false,
      url: BASE_URL,
      readOnly: true,
    })
    expect(await cli(runtime, ["ping", "--profile", "broken", "-o", "json"])).toMatchObject({
      code: 0,
    })
  })

  it("never makes the file fail, unless it gives no profiles at all", async () => {
    const runtime = fakeRuntime({ files: { [CONFIG_PATH]: '{"profiles": {"a": ' } })
    const result = await cli(runtime, ["config", "list"])
    expect(result.code).toBe(3)
    expect(errorOf(result.stderr)).toMatchObject({
      message: `Invalid config file ${CONFIG_PATH}: The text is not valid JSON (line 1, column 20).`,
    })
  })

  it("keeps the auth keys it does not know when an auth option changes the profile", async () => {
    const auth = { type: "basic", username: "u", passwordEnv: "PW", audiance: "x" }
    const text = JSON.stringify({ profiles: { p: { url: BASE_URL, auth } } })
    const runtime = fakeRuntime({ files: { [CONFIG_PATH]: text } })
    const set = await cli(runtime, ["config", "set", "p", "--auth-user", "v"])
    expect(set.stderr).toBe(
      'Notice: profile "p" is stored, but a command cannot use it yet: auth.audiance is no key of a profile.\n',
    )
    expect(JSON.parse(fileText(runtime, CONFIG_PATH) ?? "")).toEqual({
      profiles: { p: { url: BASE_URL, auth: { ...auth, username: "v" } } },
    })
  })
})

describe("a profile name of Object.prototype", () => {
  const text = JSON.stringify({
    defaultProfile: "toString",
    profiles: {
      toString: { url: BASE_URL },
      constructor: { url: BASE_URL, readOnly: true },
      broken: { url: BASE_URL, flavour: "operaton" },
    },
  })

  it("is a profile like any other, next to a refused one", async () => {
    const server = fakeServer()
      .on("GET", "/version", json({ version: "7.24.0" }))
      .on("GET", "/engine", json([{ name: "default" }]))
    const runtime = fakeRuntime({ fetch: server.fetch, files: { [CONFIG_PATH]: text } })
    const list = await cli(runtime, ["config", "list"])
    expect(list.code).toBe(0)
    expect(JSON.parse(list.stdout)).toEqual([
      expect.objectContaining({ name: "broken", problems: "flavour is no key of a profile." }),
      expect.objectContaining({ name: "constructor", url: BASE_URL, readOnly: true }),
      expect.objectContaining({ name: "toString", default: true, url: BASE_URL }),
    ])
    const show = await cli(runtime, ["config", "show", "--profile", "constructor", "-o", "json"])
    expect(JSON.parse(show.stdout)).toMatchObject({
      profile: "constructor",
      values: { readOnly: { value: true, source: "profile" } },
    })
    expect(await cli(runtime, ["ping", "-o", "json"])).toMatchObject({ code: 0 })
  })

  it("never finds a hint of Object.prototype for a key of that name", async () => {
    const twice = '{"profiles": {"p": {"url": "http://h", "constructor": 1, "constructor": 2}}}'
    const runtime = fakeRuntime({ files: { [CONFIG_PATH]: twice } })
    const result = await cli(runtime, ["ping", "--profile", "p"])
    expect(errorOf(result.stderr)).toMatchObject({
      hint: "Fix the profile in the file, or change it with `pulse config set p <options>`.",
    })
  })
})

describe("an edit of a file that holds a name or a key twice", () => {
  const prod = (readOnly: string) => `"prod": {"url": "${BASE_URL}", ${readOnly}}`
  const keyTwice = `{"profiles": {${prod('"readOnly": true, "readOnly": false')}, "dev": {"url": "${BASE_URL}"}}}`
  const nameTwice = `{"profiles": {${prod('"readOnly": true')}, ${prod('"timeout": 5')}, "dev": {"url": "${BASE_URL}"}}}`

  it.each([
    [keyTwice, ["config", "set", "dev", "--timeout", "5000"], "readOnly is set twice"],
    [nameTwice, ["config", "use", "dev"], "The file lists this profile name twice"],
    [keyTwice, ["config", "unset", "prod", "readOnly"], "readOnly is set twice"],
  ])("never settles it without a word: %#", async (text, args, sentence) => {
    const runtime = fakeRuntime({ files: { [CONFIG_PATH]: text } })
    const result = await cli(runtime, args)
    expect(result.code).toBe(3)
    expect(errorOf(result.stderr)).toMatchObject({
      code: "CONFIG",
      message: expect.stringContaining(
        `Your config file is left as it is, since profile "prod" cannot be written back as the file holds it: ${sentence}`,
      ) as unknown,
      hint: "pulse config writes the whole file and would keep only the last of the two without a word: fix the file in an editor first, then run the command again.",
    })
    expect(fileText(runtime, CONFIG_PATH)).toBe(text)
  })

  it("deletes such a profile, and keeps a header name in two spellings as it is", async () => {
    const runtime = fakeRuntime({ files: { [CONFIG_PATH]: nameTwice } })
    expect(await cli(runtime, ["config", "delete", "prod"])).toMatchObject({ code: 0 })
    expect(JSON.parse(fileText(runtime, CONFIG_PATH) ?? "")).toEqual({
      profiles: { dev: { url: BASE_URL } },
    })
    const headers = { "X-Tenant": "a", "x-tenant": "b" }
    const spelled = JSON.stringify({ profiles: { prod: { url: BASE_URL, headers }, dev: {} } })
    const other = fakeRuntime({ files: { [CONFIG_PATH]: spelled } })
    expect(await cli(other, ["config", "set", "dev", "--url", BASE_URL])).toMatchObject({ code: 0 })
    expect(JSON.parse(fileText(other, CONFIG_PATH) ?? "")).toMatchObject({
      profiles: { prod: { headers }, dev: { url: BASE_URL } },
    })
  })
})
