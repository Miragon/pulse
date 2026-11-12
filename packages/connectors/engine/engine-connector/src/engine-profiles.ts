/**
 * The engines of the MCP server, read as profiles of the one profile format
 * (@miragon/pulse-profile), the format of the CLI and of Pulse for VS Code. ENGINES_FILE (a path)
 * or ENGINES_JSON (the text) hold a profile file under the credential policy `env`: a secret only
 * by the name of the variable that holds it, and only a name that starts with ENGINE_SECRET_.
 * Without either, ENGINE_BASE_URL and its siblings (or nothing: the local default) yield the one
 * profile of a single engine, through the same parser. A profile's name is the engine id.
 *
 * Each profile is judged on its own: one the parser refuses, one this server cannot serve
 * (SERVER_SURFACE: no headers, no named process engine, no OAuth login, Basic auth only with a
 * user name) or one whose secret is not set is refused, and the other engines run. The boot
 * fails only when the text gives no profiles, when none is usable or when defaultProfile names
 * no profile. No message repeats a value; a variable is named to the operator only, and only in
 * its conventional form (`isConventionalVariable`), never to the model, which reads only the
 * format's own keys (`problemSentence`).
 */

import fs from "node:fs"
import path from "node:path"
import {
  AUTH_KEYS,
  authTypeOf,
  describeProblem,
  isConventionalVariable,
  parseProfileFile,
  type Problem,
  PROFILE_KEYS,
  type Profile,
  type ProfileFile,
  type ProfileVerdict,
  refusalsOn,
  type Surface,
} from "@miragon/pulse-profile"
import type { EngineAuth, EngineEntry } from "./engine-provider.js"
import { credentialProblemOf } from "./lib/engine/credentials.js"
import type { RefusedProfile } from "./lib/engine/resolve-engine.js"
import {
  isSecretProblem,
  NOT_SERVED,
  OLD_FORMS,
  parseHint,
  type SecretProblem,
  secretSentence,
  SINGLE_KEYS,
  singleSecretSentence,
  UNSENDABLE_KEYS,
  unnamedKeySentence,
} from "./engine-profile-words.js"

type Refusal = Problem | SecretProblem

/**
 * What this server serves: the Camunda 7 REST dialect, signing in with nothing, Basic auth, a
 * bearer token or the caller's own token (no OAuth login: no person is there to sign in), a REST
 * root in every profile, the default process engine only (no `/engine/{name}`), and no headers
 * of its own.
 */
export const SERVER_SURFACE: Surface = {
  dialects: ["c7"],
  authTypes: ["none", "basic", "bearer", "passthrough"],
  urlRequired: true,
  defaultEngineOnly: true,
  refusedKeys: ["headers"],
}

/** Where the zero-config engine is: the starter's compose.yaml and the playground serve there. */
export const LOCAL_ENGINE_URL = "http://localhost:8410/engine-rest"

/** The settings of the single engine: next to a profile file they describe nothing. */
export const SINGLE_ENGINE_VARIABLES = [
  "ENGINE_BASE_URL",
  "ENGINE_ID",
  "ENGINE_FLAVOR",
  "ENGINE_COCKPIT_URL",
  "ENGINE_AUTH_TYPE",
  "ENGINE_USERNAME",
  "ENGINE_PASSWORD",
  "ENGINE_TOKEN",
] as const

/** The engines one environment describes. */
export interface EngineProfiles {
  /** The usable profiles as the server connects to them, in the order of the file. */
  readonly engines: EngineEntry[]
  /**
   * The refused profiles that carry a valid name, in the order of the file, each with the reason
   * for the model: the keys only, never a value, a variable or a profile name.
   */
  readonly refused: RefusedProfile[]
  /** Every valid profile name, refused ones included, in the order of the file. */
  readonly engineIds: string[]
  /** Every profile, refused and nameless ones included: one alone is the default. */
  readonly profileCount: number
  /** The file's `defaultProfile`; the parser took it only when it names a profile. */
  readonly defaultProfile?: string
  /** For the operator at boot: each refused profile with its reasons, and the notes on the file. */
  readonly warnings: string[]
}

/** The variable holding the password and the token of a profile: its own, or the single engine's. */
interface SecretSources {
  password(profile: Profile): string | undefined
  token(profile: Profile): string | undefined
}

const FILE_SECRETS: SecretSources = {
  password: (profile) => profile.auth?.passwordEnv,
  token: (profile) => profile.auth?.tokenEnv,
}

const SINGLE_SECRETS: SecretSources = {
  password: () => "ENGINE_PASSWORD",
  token: () => "ENGINE_TOKEN",
}

/** The value of the variable `variable` names for `key`, or why there is none. */
function secretOf(
  key: SecretProblem["key"],
  variable: string | undefined,
  env: NodeJS.ProcessEnv,
): { readonly value?: string; readonly problems: SecretProblem[] } {
  if (variable === undefined) return { problems: [{ code: "secret-missing", key }] }
  const value = env[variable]
  return value === undefined || value === ""
    ? { problems: [{ code: "variable-unset", key, variable }] }
    : { value, problems: [] }
}

/** How the server signs in to the engine of `profile`, its secret read now; or why it cannot. */
function authOf(
  profile: Profile,
  env: NodeJS.ProcessEnv,
  secrets: SecretSources,
): { readonly auth?: EngineAuth; readonly problems: readonly SecretProblem[] } {
  // refusalsOn turned OAuth away before, so the type is one the server serves.
  const type = authTypeOf(profile) as EngineAuth["type"]
  if (type === "basic") {
    const username = profile.auth?.username
    const password = secretOf("auth.passwordEnv", secrets.password(profile), env)
    const problems: SecretProblem[] = [
      ...(username === undefined
        ? [{ code: "username-missing", key: "auth.username" } as const]
        : []),
      ...password.problems,
    ]
    return problems.length > 0
      ? { problems }
      : { auth: { type, username, password: password.value }, problems }
  }
  if (type === "bearer") {
    const token = secretOf("auth.tokenEnv", secrets.token(profile), env)
    return token.value === undefined
      ? { problems: token.problems }
      : { auth: { type, token: token.value }, problems: [] }
  }
  return { auth: { type }, problems: [] }
}

/** The `cockpitUrl` the text of the profile `name` holds, blanks around it trimmed. */
type WrittenCockpitUrl = (name: string) => string | undefined

const isObject = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

/** `text` as JSON, a byte order mark dropped as the parser drops it; undefined when it is none. */
function jsonOf(text: string): unknown {
  try {
    return JSON.parse(text.replace(/^\uFEFF/, "")) as unknown
  } catch {
    return undefined
  }
}

/**
 * The web app address of each profile as the operator wrote it. The format drops its trailing
 * slashes and a start route (`#/`); the server shows the address as written (engine_list_engines),
 * and its links drop them anyway (resolveCockpitBase).
 */
function writtenCockpitUrls(text: string): WrittenCockpitUrl {
  const root = jsonOf(text)
  const profiles = isObject(root) && isObject(root.profiles) ? root.profiles : {}
  return (name) => {
    const profile = Object.hasOwn(profiles, name) ? profiles[name] : undefined
    const cockpitUrl = isObject(profile) ? profile.cockpitUrl : undefined
    return typeof cockpitUrl === "string" ? cockpitUrl.trim() : undefined
  }
}

/** The engine of a usable profile: its name is the id, its `url` the REST root. */
function entryOf(
  id: string,
  profile: Profile,
  auth: EngineAuth,
  written: WrittenCockpitUrl,
): EngineEntry {
  const { url = "", environment, flavor, readOnly, timeout } = profile
  const cockpitUrl =
    profile.cockpitUrl === undefined ? undefined : (written(id) ?? profile.cockpitUrl)
  return {
    id,
    baseUrl: url,
    ...(cockpitUrl === undefined ? {} : { cockpitUrl }),
    ...(environment === undefined ? {} : { environment }),
    ...(flavor === undefined ? {} : { flavor }),
    ...(auth.type === "none" ? {} : { auth }),
    ...(readOnly === true ? { readOnly } : {}),
    ...(timeout === undefined ? {} : { timeoutMs: timeout }),
  }
}

/** One profile as the server judges it. */
interface Judged {
  readonly name?: string
  readonly index: number
  readonly profile?: Profile
  readonly problems: readonly Refusal[]
  readonly entry?: EngineEntry
}

function judge(
  verdict: ProfileVerdict,
  env: NodeJS.ProcessEnv,
  secrets: SecretSources,
  written: WrittenCockpitUrl,
): Judged {
  const { name, index, profile } = verdict
  if (profile === undefined || name === undefined) {
    return { ...(name === undefined ? {} : { name }), index, problems: verdict.problems }
  }
  const refused = refusalsOn(profile, SERVER_SURFACE)
  if (refused.length > 0) return { name, index, profile, problems: refused }
  const { auth, problems } = authOf(profile, env, secrets)
  if (auth === undefined) return { name, index, profile, problems }
  const credential = credentialProblemOf(auth)
  return credential === undefined
    ? { name, index, profile, problems, entry: entryOf(name, profile, auth, written) }
    : {
        name,
        index,
        profile,
        problems: [{ code: "unsendable", key: UNSENDABLE_KEYS[credential], credential }],
      }
}

/** The keys of the profile format: the only keys a reason for the model names. */
const FORMAT_KEYS: ReadonlySet<string> = new Set<string>([
  ...PROFILE_KEYS,
  ...AUTH_KEYS.map((key) => `auth.${key}`),
])

/**
 * A problem about a key outside the format, without its name: the parser names an unknown key
 * that looks like one, and a token pasted where a key goes looks like one (`ghp_…`).
 */
function unnamedKeyProblem({ code, key = "" }: Problem): string {
  const dot = key.indexOf(".")
  if (code === "unknown-key") return unnamedKeySentence(dot < 0 ? undefined : key.slice(0, dot))
  return describeProblem(code === "secret-header" ? { code, key: "headers" } : { code })
}

/**
 * The sentence of a problem of a profile, in the server's words where it cannot serve one. The
 * operator's names every key the parser names; the model's only the format's own keys.
 */
function problemSentence(problem: Problem, forModel: boolean): string {
  const { code, key } = problem
  if (forModel && key !== undefined && !FORMAT_KEYS.has(key)) return unnamedKeyProblem(problem)
  return Object.hasOwn(NOT_SERVED, code) ? NOT_SERVED[code](key) : describeProblem(problem)
}

/**
 * One sentence per refusal. The model's never names a variable, nor a key outside the format;
 * the operator's names a variable in its conventional form (a name in another form may be a
 * secret pasted into the wrong place).
 */
function refusalSentence(problem: Refusal, forOperator: boolean): string {
  if (!isSecretProblem(problem)) return problemSentence(problem, !forOperator)
  const { variable } = problem
  const shown =
    forOperator && variable !== undefined && isConventionalVariable(variable) ? variable : undefined
  return secretSentence(problem, shown)
}

/** Every reason of a refused profile in one line, each sentence once. */
function reasonsOf(problems: readonly Refusal[], forOperator: boolean): string {
  return [...new Set(problems.map((problem) => refusalSentence(problem, forOperator)))].join(" ")
}

/** The profile a sentence speaks of: its name, or its place when its name is not valid. */
function profileLabel({ name, index }: Judged, label: string): string {
  return name === undefined
    ? `Profile ${String(index + 1)} of ${label}`
    : `Profile "${name}" (${label})`
}

/** What the boot tells the operator of a refused profile of the file `label`. */
function refusalWarning(judged: Judged, label: string): string {
  const consequence =
    judged.name === undefined
      ? "No call can name it; the other engines run."
      : "A call to this engine fails with that reason; the other engines run."
  return `${profileLabel(judged, label)} is refused: ${reasonsOf(judged.problems, true)} ${consequence}`
}

// ── The file ───────────────────────────────────────────────────────────────

/** The text of a profile file and where it comes from. */
interface FileText {
  /** `ENGINES_JSON`, or `ENGINES_FILE=<path>`. */
  readonly label: string
  /** The label with the resolved path, for an error about the text as a whole. */
  readonly where: string
  /** What a message withholds: `the value`, `its content`. */
  readonly hidden: string
  readonly text: string
}

/**
 * A read error names the path only, never the content, so it may ride along as the cause. The
 * parser drops a UTF-8 byte order mark (some Windows editors save one).
 */
function readEnginesFile(resolved: string, where: string): string {
  let content: string
  try {
    content = fs.readFileSync(resolved, "utf8")
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code ?? "unknown error"
    throw new Error(
      code === "ENOENT" ? `${where} does not exist.` : `${where} cannot be read (${code}).`,
      { cause: error },
    )
  }
  if (!content.trim()) throw new Error(`${where} is empty.`)
  return content
}

/** Precedence: ENGINES_FILE > ENGINES_JSON; undefined when neither is set. */
function fileTextOf(env: NodeJS.ProcessEnv): FileText | undefined {
  const filePath = env.ENGINES_FILE?.trim()
  if (filePath) {
    if (/^[[{]/.test(filePath)) {
      throw new Error(
        "ENGINES_FILE holds JSON instead of a file path; the value is not shown because it may hold credentials. Inline JSON goes into ENGINES_JSON.",
      )
    }
    const resolved = path.resolve(filePath)
    const label = `ENGINES_FILE=${filePath}`
    const where = resolved === filePath ? label : `${label} (resolved ${resolved})`
    return { label, where, hidden: "its content", text: readEnginesFile(resolved, where) }
  }
  const json = env.ENGINES_JSON?.trim()
  return json
    ? { label: "ENGINES_JSON", where: "ENGINES_JSON", hidden: "the value", text: json }
    : undefined
}

/** The form of `text` up to 0.27: a list, or a map of environments to lists. */
function oldFormOf(text: string): keyof typeof OLD_FORMS | undefined {
  const value = jsonOf(text)
  if (Array.isArray(value)) return "array"
  if (typeof value !== "object" || value === null || Object.hasOwn(value, "profiles")) {
    return undefined
  }
  return Object.values(value).some(Array.isArray) ? "map" : undefined
}

/** Why a text gives no profiles, naming where it came from and never what it holds. */
function fileProblemText(problem: Problem, { where, hidden, text }: FileText): string {
  if (problem.code !== "not-json") return `${where}: ${problemSentence(problem, false)}`
  const at =
    problem.line === undefined
      ? ""
      : ` at line ${String(problem.line)} column ${String(problem.column)}`
  return `${where} is not valid JSON${at}; ${hidden} is not shown because it may hold credentials. ${parseHint(text)}`
}

function parsedFile(source: FileText): ProfileFile {
  const form = oldFormOf(source.text)
  if (form !== undefined) throw new Error(OLD_FORMS[form](source.where))
  const file = parseProfileFile(source.text, { credentials: "env" })
  if (file.problem !== undefined) throw new Error(fileProblemText(file.problem, source))
  return file
}

/** The names of the file's profiles that carry a valid one. */
const namesOf = (judged: readonly Judged[]) =>
  judged.flatMap(({ name }) => (name === undefined ? [] : [name]))

/**
 * The notes on the file's root: a `defaultProfile` that names no profile fails the boot (calls
 * without `engine` would otherwise go somewhere else), the rest is a warning.
 */
function noteWarnings(file: ProfileFile, label: string, names: readonly string[]): string[] {
  const foreign = file.notes.find((note) => note.key === "defaultProfile")
  if (foreign !== undefined) {
    throw new Error(
      `${label}: ${problemSentence(foreign, false)} It must name one of its profiles: ${names.join(", ")}.`,
    )
  }
  return file.notes.map((note) => `${label}: ${problemSentence(note, false)}`)
}

function refusedOf(judged: readonly Judged[]): RefusedProfile[] {
  return judged.flatMap(({ name, profile, problems, entry }) =>
    entry !== undefined || name === undefined
      ? []
      : [
          {
            id: name,
            ...(profile?.environment === undefined ? {} : { environment: profile.environment }),
            reason: reasonsOf(problems, false),
          },
        ],
  )
}

function fromFile(source: FileText, env: NodeJS.ProcessEnv): EngineProfiles {
  const file = parsedFile(source)
  // Before the notes: a defaultProfile in a file without profiles names none of none.
  if (file.profiles.length === 0) {
    throw new Error(
      `${source.label} names no profile: it holds {"profiles": {"<id>": {"url": "…"}}}.`,
    )
  }
  const written = writtenCockpitUrls(source.text)
  const judged = file.profiles.map((verdict) => judge(verdict, env, FILE_SECRETS, written))
  const engineIds = namesOf(judged)
  const notes = noteWarnings(file, source.label, engineIds)
  const engines = judged.flatMap(({ entry }) => (entry === undefined ? [] : [entry]))
  const refusals = judged.filter(({ entry }) => entry === undefined)
  if (engines.length === 0) {
    const reasons = refusals.map(
      (one) => `${profileLabel(one, source.label)} is refused: ${reasonsOf(one.problems, true)}`,
    )
    throw new Error(`${source.label}: no profile is usable. ${reasons.join(" ")}`)
  }
  return {
    engines,
    refused: refusedOf(judged),
    engineIds,
    profileCount: judged.length,
    ...(file.defaultProfile === undefined ? {} : { defaultProfile: file.defaultProfile }),
    warnings: [...notes, ...refusals.map((one) => refusalWarning(one, source.label))],
  }
}

// ── The single engine ──────────────────────────────────────────────────────

/** A refusal of the single engine's profile, naming the variable to fix. */
function singleSentence(problem: Refusal): string {
  if (isSecretProblem(problem)) return singleSecretSentence(problem)
  const variable =
    problem.key === undefined
      ? problem.code === "invalid-name"
        ? "ENGINE_ID"
        : undefined
      : SINGLE_KEYS[problem.key]
  const sentence = problemSentence(problem, false)
  return variable === undefined ? sentence : `${variable}: ${sentence}`
}

/** The profile ENGINE_BASE_URL and its siblings describe: ENGINE_ID names it ("default"). */
function singleProfileText(env: NodeJS.ProcessEnv): { readonly id: string; readonly text: string } {
  const baseUrl = env.ENGINE_BASE_URL?.trim()
  const id = env.ENGINE_ID?.trim() || "default"
  const flavor = env.ENGINE_FLAVOR?.trim()
  // The local default engine takes no cockpit URL: it is derived from the provider.
  const cockpitUrl = baseUrl ? env.ENGINE_COCKPIT_URL?.trim() : undefined
  const type = env.ENGINE_AUTH_TYPE?.trim()
  const username = type === "basic" ? env.ENGINE_USERNAME : undefined
  const profile = {
    url: baseUrl || LOCAL_ENGINE_URL,
    ...(cockpitUrl ? { cockpitUrl } : {}),
    ...(flavor ? { flavor } : {}),
    ...(type ? { auth: { type, ...(username ? { username } : {}) } } : {}),
  }
  return { id, text: JSON.stringify({ profiles: { [id]: profile } }) }
}

function single(env: NodeJS.ProcessEnv): EngineProfiles {
  const { id, text } = singleProfileText(env)
  const [verdict] = parseProfileFile(text, { credentials: "env" }).profiles
  const judged = judge(verdict, env, SINGLE_SECRETS, writtenCockpitUrls(text))
  if (judged.entry === undefined) {
    throw new Error([...new Set(judged.problems.map(singleSentence))].join(" "))
  }
  return { engines: [judged.entry], refused: [], engineIds: [id], profileCount: 1, warnings: [] }
}

/** True when a profile file describes the engines: then the single engine's settings are ignored. */
export function hasProfileFile(env: NodeJS.ProcessEnv): boolean {
  return Boolean(env.ENGINES_FILE?.trim() || env.ENGINES_JSON?.trim())
}

/**
 * The engines `env` describes. Precedence: ENGINES_FILE > ENGINES_JSON > ENGINE_BASE_URL > the
 * local default engine. Throws a one-line error, naming the variable and never a value, when the
 * text gives no profiles, when no profile is usable or when defaultProfile names no profile; a
 * refused profile is a warning and an entry of `refused`.
 */
export function loadEngineProfiles(env: NodeJS.ProcessEnv): EngineProfiles {
  const file = fileTextOf(env)
  return file === undefined ? single(env) : fromFile(file, env)
}

/**
 * The ENGINE_SECRET_ variables the profiles of `env` name, for the typo warner: an operator sets
 * exactly those. Never throws: a broken file fails the boot with its own error.
 */
export function referencedVariables(env: NodeJS.ProcessEnv): string[] {
  let source: FileText | undefined
  try {
    source = fileTextOf(env)
  } catch {
    return []
  }
  if (source === undefined) return []
  const profiles = parseProfileFile(source.text, { credentials: "env" }).profiles
  return profiles.flatMap(({ profile }) =>
    [profile?.auth?.passwordEnv, profile?.auth?.tokenEnv].filter(
      (name): name is string => name !== undefined,
    ),
  )
}
