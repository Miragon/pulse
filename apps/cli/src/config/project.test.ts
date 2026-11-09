import fc from "fast-check"
import { describe, expect, it } from "vitest"
import { fakeRuntime } from "../../test/support/fake-runtime.js"
import { PulseCliError } from "../errors.js"
import type { FileSystem } from "../runtime.js"
import { omit } from "../util.js"
import {
  findProjectFile,
  mergeProject,
  parseProjectFile,
  projectWriteError,
  readProjectFile,
  userDefault,
} from "./project.js"
import { selectProfile } from "./resolve.js"
import type { ConfigFile, ProjectSource } from "./types.js"

const LINUX = { homedir: "/home/me", platform: "linux" }
const WINDOWS = { homedir: "C:\\Users\\me", platform: "win32" }

function find(cwd: string, files: Record<string, string> = {}, dirs: string[] = []) {
  const runtime = fakeRuntime({ files, dirs })
  return findProjectFile(runtime.fs, cwd, LINUX)
}

async function failure(action: () => unknown): Promise<PulseCliError> {
  try {
    await action()
  } catch (error) {
    if (error instanceof PulseCliError) return error
    throw error
  }
  throw new Error("expected an PulseCliError")
}

describe("findProjectFile", () => {
  it("finds the nearest .pulse-cli.json from the working directory up", async () => {
    const files = {
      "/home/me/repo/.pulse-cli.json": "{}",
      "/home/me/repo/sub/.pulse-cli.json": "{}",
    }
    const dirs = ["/home/me/repo/.git", "/home/me/repo/sub/deep"]
    expect(await find("/home/me/repo/sub/deep", files, dirs)).toEqual({
      path: "/home/me/repo/sub/.pulse-cli.json",
      exists: true,
    })
    expect(await find("/home/me/repo", files, dirs)).toEqual({
      path: "/home/me/repo/.pulse-cli.json",
      exists: true,
    })
  })

  it("stops at the repository root and proposes a new file there", async () => {
    const files = { "/home/me/.pulse-cli.json": "{}", "/home/me/repo/x/.keep": "" }
    expect(await find("/home/me/repo/x", files, ["/home/me/repo/.git"])).toEqual({
      path: "/home/me/repo/.pulse-cli.json",
      exists: false,
    })
    // a worktree or submodule has a .git file
    const worktree = { ...files, "/home/me/repo/.git": "gitdir: /elsewhere" }
    expect(await find("/home/me/repo/x", worktree)).toEqual({
      path: "/home/me/repo/.pulse-cli.json",
      exists: false,
    })
  })

  it("never reads the home directory: it is nobody project", async () => {
    const files = { "/home/me/.pulse-cli.json": "{}" }
    expect(await find("/home/me", files)).toBeUndefined()
    expect(await find("/home/me/", files)).toBeUndefined()
    expect(await find("/home/me//", files)).toBeUndefined()
    // other file systems than Windows compare with case
    expect(await find("/home/Me", files)).toEqual({
      path: "/home/Me/.pulse-cli.json",
      exists: false,
    })
    expect(await find("/home/me/work/x", files)).toEqual({
      path: "/home/me/work/x/.pulse-cli.json",
      exists: false,
    })
  })

  it("walks up to the file system root outside the home directory", async () => {
    expect(await find("/srv/app/src", { "/.pulse-cli.json": "{}" })).toEqual({
      path: "/.pulse-cli.json",
      exists: true,
    })
    expect(await find("/srv/app/src")).toEqual({
      path: "/srv/app/src/.pulse-cli.json",
      exists: false,
    })
  })

  it("counts anything named .pulse-cli.json, so reading it reports a directory", async () => {
    expect(await find("/home/me/repo", {}, ["/home/me/repo/.pulse-cli.json"])).toEqual({
      path: "/home/me/repo/.pulse-cli.json",
      exists: true,
    })
  })

  it("uses Windows paths and compares the home directory without case", async () => {
    const runtime = fakeRuntime({ files: { "C:\\work\\repo\\.pulse-cli.json": "{}" } })
    expect(await findProjectFile(runtime.fs, "C:\\work\\repo\\src", WINDOWS)).toEqual({
      path: "C:\\work\\repo\\.pulse-cli.json",
      exists: true,
    })
    expect(await findProjectFile(runtime.fs, "c:\\users\\ME", WINDOWS)).toBeUndefined()
    expect(await findProjectFile(runtime.fs, "C:\\", WINDOWS)).toEqual({
      path: "C:\\.pulse-cli.json",
      exists: false,
    })
  })
})

describe("parseProjectFile", () => {
  const path = "/repo/.pulse-cli.json"
  const source: ProjectSource = { path, directory: "/repo" }

  /** What a command that uses `name` of the project file `text` fails with. */
  async function useFailure(text: string, name?: string): Promise<PulseCliError> {
    const config = mergeProject(undefined, { source, file: parseProjectFile(text, path) })
    return failure(() => selectProfile(name === undefined ? {} : { profile: name }, {}, config))
  }

  it("accepts profiles that name engines and auth settings without credentials", () => {
    const text = JSON.stringify({
      defaultProfile: "a",
      profiles: {
        a: { url: "http://h/engine-rest", auth: { type: "bearer" } },
        b: { auth: { username: "demo" }, headers: { "X-Tenant-Id": "acme" } },
        c: { auth: { type: "oauth", issuer: "https://idp.example", clientId: "c" } },
      },
    })
    const file = parseProjectFile(text, path)
    expect(file.defaultProfile).toBe("a")
    expect(file.refused).toBeUndefined()
  })

  it.each([
    [{ username: "u", password: "S3cr3t-pw" }, "password", "PULSE_CLI_PASSWORD"],
    [{ username: "u", passwordEnv: "S3cr3t_VAR" }, "passwordEnv", "PULSE_CLI_PASSWORD"],
    [
      { type: "oauth", clientId: "c", clientSecret: "S3cr3t-cs" },
      "clientSecret",
      "PULSE_CLI_OAUTH_CLIENT_SECRET",
    ],
    [
      { type: "oauth", clientId: "c", clientSecretEnv: "S3cr3t_VAR" },
      "clientSecretEnv",
      "PULSE_CLI_OAUTH_CLIENT_SECRET",
    ],
    [{ type: "bearer", token: "S3cr3t-tk" }, "token", "PULSE_CLI_TOKEN or PULSE_CLI_TOKEN_COMMAND"],
    [
      { type: "bearer", tokenEnv: "S3cr3t_VAR" },
      "tokenEnv",
      "PULSE_CLI_TOKEN or PULSE_CLI_TOKEN_COMMAND",
    ],
  ])(
    "refuses the profile with the credential of %j, without quoting it",
    async (auth, key, instead) => {
      const text = JSON.stringify({ profiles: { p: { auth }, q: {} } })
      expect(parseProjectFile(text, path).refused).toStrictEqual({
        p: [{ code: "credential-in-shared-file", key: `auth.${key}` }],
      })
      const error = await useFailure(text, "p")
      expect(error.code).toBe("CONFIG")
      expect(error.message).toBe(
        `Profile "p" of the project file ${path} cannot be used: auth.${key} is set, but a file others share names no credential, neither a secret nor the variable that holds one.`,
      )
      expect(error.details.hint).toBe(
        `A project file is shared and names no credentials: they come from the environment (${instead}) or a profile "p" of your own config file. Remove it with \`pulse config unset p auth --project\`, and a committed secret from the history of your repository too.`,
      )
      expect(`${error.message}${error.details.hint ?? ""}`).not.toContain("S3cr3t")
    },
  )

  it("keeps a defaultProfile that names none of its profiles, which gives no default", async () => {
    const text = JSON.stringify({ defaultProfile: "prod", profiles: { svc: {} } })
    expect(parseProjectFile(text, path).notes).toStrictEqual([
      { code: "default-not-found", key: "defaultProfile" },
    ])
    const error = await useFailure(text)
    expect(error.message).toBe(
      `The default profile of the project file ${path} cannot be used: defaultProfile names no profile of this file.`,
    )
    expect(error.details.hint).toBe(
      "Choose a profile with --profile or PULSE_CLI_PROFILE, or make one the default with `pulse config use <profile> --project`.",
    )
    const blank = JSON.stringify({ defaultProfile: " ", profiles: {} })
    expect(parseProjectFile(blank, path).profiles).toEqual({})
    const padded = JSON.stringify({ defaultProfile: " svc ", profiles: { svc: {} } })
    expect(parseProjectFile(padded, path).defaultProfile).toBe(" svc ")
  })

  it("refuses a profile with a secret header", async () => {
    const text = JSON.stringify({ profiles: { p: { headers: { "X-Api-Key": "k-123" } } } })
    expect(parseProjectFile(text, path).refused).toStrictEqual({
      p: [{ code: "secret-header", key: "headers.X-Api-Key" }],
    })
    const error = await useFailure(text, "p")
    expect(error.message).toContain("headers.X-Api-Key carries a secret")
    expect(error.details.hint).toContain("PULSE_CLI_HEADERS")
    expect(`${error.message}${error.details.hint ?? ""}`).not.toContain("k-123")
  })

  it("reports the parse errors of a project file", async () => {
    const error = await failure(() => parseProjectFile("{", path))
    expect(error.message).toBe(
      `Invalid project file ${path}: The text is not valid JSON (line 1, column 2).`,
    )
    expect(error.details.hint).toBe(
      "Fix the file or recreate it with `pulse config set <profile> --project`.",
    )
  })
})

describe("projectWriteError", () => {
  const path = "/r/.pulse-cli.json"

  it("refuses a credential in any profile, without quoting it", () => {
    const file: ConfigFile = {
      profiles: { ok: { url: "http://h" }, bad: { auth: { type: "bearer", token: "t0k" } } },
    }
    const error = projectWriteError(file, path)
    expect(error?.message).toBe(
      `The project file ${path} cannot be written: in profile "bad", auth.token is set, but a file others share names no credential, neither a secret nor the variable that holds one.`,
    )
    expect(error?.details.hint).toContain("`pulse config unset bad auth --project`")
    expect(JSON.stringify(error?.details)).not.toContain("t0k")
    expect(projectWriteError({ profiles: { ok: {} } }, path)).toBeUndefined()
    expect(projectWriteError({ profiles: {} }, path)).toBeUndefined()
  })

  it("reports a credential before a foreign default, and nothing for a valid file", () => {
    const both: ConfigFile = { defaultProfile: "x", profiles: { p: { auth: { token: "t" } } } }
    expect(projectWriteError(both, path)?.message).toMatch(/in profile "p", auth\.token is set/)
    const foreign = projectWriteError({ defaultProfile: "x", profiles: {} }, path)
    expect(foreign?.message).toBe(
      `The project file ${path} cannot be written: defaultProfile names no profile of this file.`,
    )
    expect(foreign?.details.hint).toBe(
      "Make one of its profiles the default with `pulse config use <profile> --project`, or remove defaultProfile from the file.",
    )
    expect(projectWriteError({ defaultProfile: "p", profiles: { p: {} } }, path)).toBeUndefined()
  })
})

describe("userDefault", () => {
  it("names why the user's defaultProfile gives no default, unless it is a valid name", () => {
    expect(userDefault({ defaultProfile: "prod", profiles: {} })).toEqual({})
    expect(userDefault({ defaultProfile: " ", profiles: {} })).toEqual({})
    expect(userDefault({ defaultProfile: "../x", profiles: {} })).toEqual({
      defaultProblem: { problem: { code: "invalid-name", key: "defaultProfile" } },
    })
    const note = { code: "invalid", key: "defaultProfile" } as const
    expect(userDefault({ profiles: {}, notes: [note] })).toEqual({
      defaultProblem: { problem: note },
    })
  })
})

describe("readProjectFile", () => {
  it("returns the checked file, a profile with a credential refused", async () => {
    const runtime = fakeRuntime({ files: { "/r/.pulse-cli.json": '{"profiles":{"a":{}}}' } })
    expect(await readProjectFile(runtime.fs, "/r/.pulse-cli.json")).toEqual({ profiles: { a: {} } })
    const invalid = fakeRuntime({
      files: { "/r/.pulse-cli.json": '{"profiles":{"a":{"auth":{"type":"bearer","token":"t"}}}}' },
    })
    expect((await readProjectFile(invalid.fs, "/r/.pulse-cli.json")).refused).toStrictEqual({
      a: [{ code: "credential-in-shared-file", key: "auth.token" }],
    })
  })

  it("is a CONFIG error naming the file and the reason when it cannot be read", async () => {
    const runtime = fakeRuntime({ dirs: ["/r/.pulse-cli.json"] })
    const error = await failure(() => readProjectFile(runtime.fs, "/r/.pulse-cli.json"))
    expect(error.code).toBe("CONFIG")
    expect(error.message).toBe("Cannot read project file /r/.pulse-cli.json (EISDIR)")
    expect(error.details.hint).toContain("up to the repository root")
    const broken = {
      ...runtime.fs,
      readFile: () => Promise.reject(new Error("disk on fire")),
    }
    expect((await failure(() => readProjectFile(broken, "/x"))).message).toBe(
      "Cannot read project file /x (disk on fire)",
    )
    const odd: FileSystem = {
      ...runtime.fs,
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- a non-Error rejection
      readFile: () => Promise.reject("odd"),
    }
    expect((await failure(() => readProjectFile(odd, "/x"))).message).toBe(
      "Cannot read project file /x (odd)",
    )
  })
})

describe("mergeProject", () => {
  const source: ProjectSource = { path: "/r/.pulse-cli.json", directory: "/r" }
  const project: ConfigFile = {
    defaultProfile: "svc",
    profiles: { svc: { url: "http://project" }, shared: { url: "http://project-shared" } },
  }

  it("returns the user file as it is without a project file", () => {
    const user = { profiles: { a: {} } }
    expect(mergeProject(user, undefined)).toBe(user)
    expect(mergeProject(undefined, undefined)).toBeUndefined()
  })

  it("lets a profile of the user replace the project profile as a whole", () => {
    const user: ConfigFile = {
      defaultProfile: "mine",
      profiles: { shared: { engine: "e" }, mine: {} },
    }
    expect(mergeProject(user, { source, file: project })).toEqual({
      defaultProfile: "svc",
      profiles: { svc: { url: "http://project" }, shared: { engine: "e" }, mine: {} },
      project: { source, profiles: ["svc"], defaultProfile: true },
    })
  })

  it("keeps the user's default when the project has none (or a blank one)", () => {
    const user: ConfigFile = { defaultProfile: "mine", profiles: { mine: {} } }
    for (const defaultProfile of [undefined, "  "]) {
      const file = { ...project, ...(defaultProfile === undefined ? {} : { defaultProfile }) }
      const withoutDefault = omit(file, "defaultProfile")
      const merged = mergeProject(user, {
        source,
        file: defaultProfile === undefined ? withoutDefault : file,
      })
      expect(merged?.defaultProfile).toBe("mine")
      expect(merged?.project?.defaultProfile).toBe(false)
    }
    const padded = mergeProject(undefined, {
      source,
      file: { defaultProfile: " svc ", profiles: { svc: {} } },
    })
    expect(padded?.defaultProfile).toBe("svc")
    const only = mergeProject(user, { source, file: { profiles: { svc: {} } } })
    expect(only).toEqual({
      defaultProfile: "svc",
      profiles: { svc: {}, mine: {} },
      project: { source, profiles: ["svc"], defaultProfile: true },
    })
    const two = mergeProject(undefined, { source, file: { profiles: { a: {}, b: {} } } })
    expect(two !== undefined && "defaultProfile" in two).toBe(false)
  })

  it("makes the only profile of the project file its default, a refused one too", () => {
    const refused = { svc: [{ code: "credential-in-shared-file", key: "auth.token" }] } as const
    const file: ConfigFile = { profiles: { svc: { auth: { token: "t" } } }, refused }
    const merged = mergeProject(
      { defaultProfile: "mine", profiles: { mine: {} } },
      { source, file },
    )
    expect(merged?.defaultProfile).toBe("svc")
    expect(merged?.refused).toEqual(refused)
    const overridden = mergeProject({ profiles: { svc: {} } }, { source, file })
    expect(overridden?.refused).toBeUndefined()
    expect(overridden?.defaultProfile).toBeUndefined()
  })

  it("never makes a profile of the user's the default", () => {
    // the project names a profile the user also has (e.g. "prod"): the user's default applies
    const file: ConfigFile = { defaultProfile: "prod", profiles: { prod: { url: "http://evil" } } }
    const user: ConfigFile = {
      defaultProfile: "mine",
      profiles: { prod: { url: "https://prod" }, mine: {} },
    }
    expect(mergeProject(user, { source, file })).toEqual({
      defaultProfile: "mine",
      profiles: { prod: { url: "https://prod" }, mine: {} },
      project: { source, profiles: [], defaultProfile: false },
    })
    const noDefault = mergeProject({ profiles: { prod: {} } }, { source, file })
    expect(noDefault?.defaultProfile).toBeUndefined()
    // a default that is not one of the project's profiles never selects one of the user's, and
    // never falls back to the user's default either
    for (const defaultProfile of ["mine", "../mine"]) {
      const dangling = mergeProject(user, { source, file: { defaultProfile, profiles: {} } })
      expect(dangling?.defaultProfile).toBeUndefined()
      expect(dangling?.defaultProblem?.project).toBe(source.path)
      expect(dangling?.project?.defaultProfile).toBe(false)
    }
    const note = { code: "invalid", key: "defaultProfile" } as const
    const odd = mergeProject(user, { source, file: { profiles: { a: {} }, notes: [note] } })
    expect(odd?.defaultProblem).toEqual({ problem: note, project: source.path })
  })

  it("never lets a project profile win over a user profile of the same name", () => {
    const name = fc.stringMatching(/^[a-z][a-z0-9]{0,8}$/)
    fc.assert(
      fc.property(fc.uniqueArray(name, { maxLength: 5 }), fc.uniqueArray(name), (own, shared) => {
        const user: ConfigFile = {
          profiles: Object.fromEntries(own.map((key) => [key, { engine: `user-${key}` }])),
        }
        const file: ConfigFile = {
          profiles: Object.fromEntries(shared.map((key) => [key, { engine: `project-${key}` }])),
        }
        const merged = mergeProject(user, { source, file })
        for (const key of own) expect(merged?.profiles[key]?.engine).toBe(`user-${key}`)
        expect(merged?.project?.profiles).toEqual(shared.filter((key) => !own.includes(key)))
      }),
    )
  })
})
