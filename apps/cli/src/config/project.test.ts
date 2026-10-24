import fc from "fast-check"
import { describe, expect, it } from "vitest"
import { fakeRuntime } from "../../test/support/fake-runtime.js"
import { OperateError } from "../errors.js"
import type { FileSystem } from "../runtime.js"
import {
  findProjectFile,
  mergeProject,
  parseProjectFile,
  projectProblem,
  projectSecretProblem,
  readProjectFile,
} from "./project.js"
import type { ConfigFile, ProjectSource } from "./types.js"

const LINUX = { homedir: "/home/me", platform: "linux" }
const WINDOWS = { homedir: "C:\\Users\\me", platform: "win32" }

function find(cwd: string, files: Record<string, string> = {}, dirs: string[] = []) {
  const runtime = fakeRuntime({ files, dirs })
  return findProjectFile(runtime.fs, cwd, LINUX)
}

async function failure(action: () => unknown): Promise<OperateError> {
  try {
    await action()
  } catch (error) {
    if (error instanceof OperateError) return error
    throw error
  }
  throw new Error("expected an OperateError")
}

describe("findProjectFile", () => {
  it("finds the nearest .operate.json from the working directory up", async () => {
    const files = {
      "/home/me/repo/.operate.json": "{}",
      "/home/me/repo/sub/.operate.json": "{}",
    }
    const dirs = ["/home/me/repo/.git", "/home/me/repo/sub/deep"]
    expect(await find("/home/me/repo/sub/deep", files, dirs)).toEqual({
      path: "/home/me/repo/sub/.operate.json",
      exists: true,
    })
    expect(await find("/home/me/repo", files, dirs)).toEqual({
      path: "/home/me/repo/.operate.json",
      exists: true,
    })
  })

  it("stops at the repository root and proposes a new file there", async () => {
    const files = { "/home/me/.operate.json": "{}", "/home/me/repo/x/.keep": "" }
    expect(await find("/home/me/repo/x", files, ["/home/me/repo/.git"])).toEqual({
      path: "/home/me/repo/.operate.json",
      exists: false,
    })
    // a worktree or submodule has a .git file
    const worktree = { ...files, "/home/me/repo/.git": "gitdir: /elsewhere" }
    expect(await find("/home/me/repo/x", worktree)).toEqual({
      path: "/home/me/repo/.operate.json",
      exists: false,
    })
  })

  it("never reads the home directory: it is nobody project", async () => {
    const files = { "/home/me/.operate.json": "{}" }
    expect(await find("/home/me", files)).toBeUndefined()
    expect(await find("/home/me/", files)).toBeUndefined()
    expect(await find("/home/me//", files)).toBeUndefined()
    // other file systems than Windows compare with case
    expect(await find("/home/Me", files)).toEqual({
      path: "/home/Me/.operate.json",
      exists: false,
    })
    expect(await find("/home/me/work/x", files)).toEqual({
      path: "/home/me/work/x/.operate.json",
      exists: false,
    })
  })

  it("walks up to the file system root outside the home directory", async () => {
    expect(await find("/srv/app/src", { "/.operate.json": "{}" })).toEqual({
      path: "/.operate.json",
      exists: true,
    })
    expect(await find("/srv/app/src")).toEqual({
      path: "/srv/app/src/.operate.json",
      exists: false,
    })
  })

  it("counts anything named .operate.json, so reading it reports a directory", async () => {
    expect(await find("/home/me/repo", {}, ["/home/me/repo/.operate.json"])).toEqual({
      path: "/home/me/repo/.operate.json",
      exists: true,
    })
  })

  it("uses Windows paths and compares the home directory without case", async () => {
    const runtime = fakeRuntime({ files: { "C:\\work\\repo\\.operate.json": "{}" } })
    expect(await findProjectFile(runtime.fs, "C:\\work\\repo\\src", WINDOWS)).toEqual({
      path: "C:\\work\\repo\\.operate.json",
      exists: true,
    })
    expect(await findProjectFile(runtime.fs, "c:\\users\\ME", WINDOWS)).toBeUndefined()
    expect(await findProjectFile(runtime.fs, "C:\\", WINDOWS)).toEqual({
      path: "C:\\.operate.json",
      exists: false,
    })
  })
})

const SECRET_HINT = /a project file is shared and names no credentials/

describe("parseProjectFile", () => {
  const path = "/repo/.operate.json"

  it("accepts profiles that name engines and auth settings without credentials", () => {
    const text = JSON.stringify({
      defaultProfile: "a",
      profiles: {
        a: { url: "http://h/engine-rest", auth: { type: "bearer" } },
        b: { auth: { username: "demo" }, headers: { "X-Tenant-Id": "acme" } },
        c: { auth: { type: "oauth", issuer: "https://idp.example", clientId: "c" } },
      },
    })
    expect(parseProjectFile(text, path).defaultProfile).toBe("a")
  })

  it.each([
    [{ username: "u", password: "S3cr3t-pw" }, "password", "OPERATE_PASSWORD"],
    [{ username: "u", passwordEnv: "S3cr3t_VAR" }, "passwordEnv", "OPERATE_PASSWORD"],
    [
      { type: "oauth", clientId: "c", clientSecret: "S3cr3t-cs" },
      "clientSecret",
      "OPERATE_OAUTH_CLIENT_SECRET",
    ],
    [
      { type: "oauth", clientId: "c", clientSecretEnv: "S3cr3t_VAR" },
      "clientSecretEnv",
      "OPERATE_OAUTH_CLIENT_SECRET",
    ],
    [{ type: "bearer", token: "S3cr3t-tk" }, "token", "OPERATE_TOKEN or OPERATE_TOKEN_COMMAND"],
    [
      { type: "bearer", tokenEnv: "S3cr3t_VAR" },
      "tokenEnv",
      "OPERATE_TOKEN or OPERATE_TOKEN_COMMAND",
    ],
  ])("refuses the credential of %j without quoting it", async (auth, key, instead) => {
    const text = JSON.stringify({ profiles: { p: { auth } } })
    const error = await failure(() => parseProjectFile(text, path))
    expect(error.code).toBe("CONFIG")
    expect(error.message).toBe(
      `Invalid project file ${path}: profile "p" sets auth.${key}; a project file is shared and names no credentials, so it comes from ${instead} or a profile "p" of your own config file`,
    )
    expect(error.details.hint).toContain("`operate config unset <profile> auth --project`")
    expect(error.details.hint).toContain("history of your repository")
    expect(`${error.message}${error.details.hint ?? ""}`).not.toContain("S3cr3t")
  })

  it("refuses a defaultProfile that is not one of its own profiles", async () => {
    const text = JSON.stringify({ defaultProfile: "prod", profiles: { svc: {} } })
    const error = await failure(() => parseProjectFile(text, path))
    expect(error.message).toBe(
      `Invalid project file ${path}: defaultProfile "prod" is not one of its profiles; a project file chooses only among its own profiles`,
    )
    const blank = JSON.stringify({ defaultProfile: " ", profiles: {} })
    expect(parseProjectFile(blank, path).profiles).toEqual({})
    const padded = JSON.stringify({ defaultProfile: " svc ", profiles: { svc: {} } })
    expect(parseProjectFile(padded, path).defaultProfile).toBe(" svc ")
  })

  it("refuses secret headers", async () => {
    const text = JSON.stringify({ profiles: { p: { headers: { "X-Api-Key": "k-123" } } } })
    const error = await failure(() => parseProjectFile(text, path))
    expect(error.message).toContain('profile "p" stores the secret header X-Api-Key')
    expect(error.message).toContain("OPERATE_HEADERS")
    expect(error.message).not.toContain("k-123")
  })

  it("reports the parse errors of a config file", async () => {
    const error = await failure(() => parseProjectFile("{", path))
    expect(error.message).toBe(`Invalid config file ${path}: not valid JSON (line 1, column 2)`)
  })
})

describe("projectSecretProblem and projectProblem", () => {
  it("finds the first profile with a credential, or none", () => {
    const file: ConfigFile = {
      profiles: { ok: { url: "http://h" }, bad: { auth: { type: "bearer", token: "t" } } },
    }
    expect(projectSecretProblem(file)).toMatch(/^profile "bad" sets auth\.token;/)
    expect(projectSecretProblem({ profiles: { ok: {} } })).toBeUndefined()
    expect(projectSecretProblem({ profiles: {} })).toBeUndefined()
    expect(projectSecretProblem(file)).toMatch(SECRET_HINT)
  })

  it("reports a credential before a foreign default, and nothing for a valid file", () => {
    const both: ConfigFile = { defaultProfile: "x", profiles: { p: { auth: { token: "t" } } } }
    expect(projectProblem(both)?.problem).toMatch(/^profile "p" sets auth\.token/)
    expect(projectProblem(both)?.hint).toMatch(/^Credentials come from the environment/)
    const foreign = projectProblem({ defaultProfile: "x", profiles: {} })
    expect(foreign?.problem).toMatch(/^defaultProfile "x" is not one of its profiles/)
    expect(foreign?.hint).toBe(
      "Make one of its profiles the default with `operate config use <profile> --project`, or remove defaultProfile from the file.",
    )
    expect(projectProblem({ defaultProfile: "p", profiles: { p: {} } })).toBeUndefined()
  })
})

describe("readProjectFile", () => {
  it("returns the checked file", async () => {
    const runtime = fakeRuntime({ files: { "/r/.operate.json": '{"profiles":{"a":{}}}' } })
    expect(await readProjectFile(runtime.fs, "/r/.operate.json")).toEqual({ profiles: { a: {} } })
    const invalid = fakeRuntime({
      files: { "/r/.operate.json": '{"profiles":{"a":{"auth":{"type":"bearer","token":"t"}}}}' },
    })
    expect((await failure(() => readProjectFile(invalid.fs, "/r/.operate.json"))).message).toMatch(
      /^Invalid project file \/r\/\.operate\.json: profile "a" sets auth\.token/,
    )
  })

  it("is a CONFIG error naming the file and the reason when it cannot be read", async () => {
    const runtime = fakeRuntime({ dirs: ["/r/.operate.json"] })
    const error = await failure(() => readProjectFile(runtime.fs, "/r/.operate.json"))
    expect(error.code).toBe("CONFIG")
    expect(error.message).toBe("Cannot read project file /r/.operate.json (EISDIR)")
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
  const source: ProjectSource = { path: "/r/.operate.json", directory: "/r" }
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
      const { defaultProfile: _ignored, ...withoutDefault } = file
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
    const none = mergeProject(undefined, { source, file: { profiles: { svc: {} } } })
    expect(none).toEqual({
      profiles: { svc: {} },
      project: { source, profiles: ["svc"], defaultProfile: false },
    })
    expect(none !== undefined && "defaultProfile" in none).toBe(false)
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
    // a default that is not one of the project's profiles never selects one of the user's
    const dangling = mergeProject(user, { source, file: { defaultProfile: "mine", profiles: {} } })
    expect(dangling?.defaultProfile).toBe("mine")
    expect(dangling?.project?.defaultProfile).toBe(false)
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
