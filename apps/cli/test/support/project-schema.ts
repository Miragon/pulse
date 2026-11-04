/**
 * The JSON Schema of the project file (apps/cli/schema/project-file.schema.json), the shared
 * fixtures (apps/cli/test/fixtures/project-file/, which Pulse for VS Code's parser test reads by
 * path, too) and what the parser and the schema say about a file. A fixture holds the file and
 * the CLI's verdict only; the extension keeps its own expectations next to its test.
 */

import { readdirSync, readFileSync } from "node:fs"
import { Ajv } from "ajv"
import { parseProjectFile } from "../../src/config/project.js"
import { PulseCliError } from "../../src/errors.js"
import { isRecord } from "../../src/util.js"

export const SCHEMA_URL = new URL("../../schema/project-file.schema.json", import.meta.url)
const FIXTURES_URL = new URL("../fixtures/project-file/", import.meta.url)
export const PROJECT_PATH = "/repo/.pulse-cli.json"

/** A node of the schema, as far as the structural checks read it. */
export interface SchemaNode {
  readonly properties?: Readonly<Record<string, SchemaNode>>
  readonly additionalProperties?: SchemaNode | boolean
  readonly definitions?: Readonly<Record<string, SchemaNode>>
  readonly dependencies?: Readonly<Record<string, SchemaNode>>
  readonly enum?: readonly unknown[]
  readonly examples?: readonly unknown[]
  readonly $ref?: string
  readonly $id?: string
}

export const SCHEMA = JSON.parse(readFileSync(SCHEMA_URL, "utf8")) as SchemaNode

/**
 * Strict: an unknown keyword, an unknown format or a type mix-up throws here instead of passing
 * silently. Only `strictRequired` is off: the dependency subschemas name required keys whose
 * definitions live in the auth object around them, which is how draft-07 dependencies work.
 */
const ajv = new Ajv({ strict: true, strictRequired: false, allErrors: true })
const validate = ajv.compile(SCHEMA)

/** A profile as the CLI uses it: resolved values, or the start of the error it fails with. */
export type ExpectedProfile =
  | {
      readonly url: string
      readonly flavor: string
      readonly readOnly: boolean
      readonly auth: string
      readonly cockpitUrl?: string
      readonly engine?: string
    }
  | { readonly refused: string }

export interface Fixture {
  readonly name: string
  readonly about: string
  /** The file's text: `text` as given, else `file` as the CLI writes JSON. */
  readonly text: string
  readonly cli:
    | { readonly valid: true; readonly profiles: Readonly<Record<string, ExpectedProfile>> }
    | { readonly valid: false; readonly error: string }
}

interface RawFixture extends Omit<Fixture, "name" | "text"> {
  readonly file?: unknown
  readonly text?: string
}

const FIXTURE_KEYS: ReadonlySet<string> = new Set(["about", "file", "text", "cli"])

/** The CLI's verdict: `{ valid: true, profiles }` or `{ valid: false, error }`. */
function isVerdict(value: unknown): boolean {
  if (!isRecord(value)) return false
  return value.valid === true ? isRecord(value.profiles) : typeof value.error === "string"
}

/**
 * The fixture's shape, so a renamed or added field fails here by name instead of as a wrong
 * verdict: `about`, exactly one of `file` and `text`, and `cli`.
 */
function checked(entry: string, raw: unknown): RawFixture {
  const fits =
    isRecord(raw) &&
    Object.keys(raw).every((key) => FIXTURE_KEYS.has(key)) &&
    typeof raw.about === "string" &&
    Object.hasOwn(raw, "file") !== (typeof raw.text === "string") &&
    isVerdict(raw.cli)
  if (!fits) {
    throw new Error(
      `${entry}: a fixture holds "about", "file" or "text", and "cli" ({ valid: true, profiles } or { valid: false, error }), nothing else`,
    )
  }
  return raw as unknown as RawFixture
}

/** Every fixture, sorted by file name. */
export function fixtures(): Fixture[] {
  return readdirSync(FIXTURES_URL)
    .filter((entry) => entry.endsWith(".json"))
    .sort()
    .map((entry) => {
      const raw = checked(entry, JSON.parse(readFileSync(new URL(entry, FIXTURES_URL), "utf8")))
      const text = raw.text ?? `${JSON.stringify(raw.file, null, 2)}\n`
      return { name: entry.replace(/\.json$/, ""), about: raw.about, text, cli: raw.cli }
    })
}

export type Verdict = { readonly valid: true } | { readonly valid: false; readonly reason: string }

const VALID: Verdict = { valid: true }

/** What pulse-cli says about a project file: it loads, or the CONFIG error it fails with. */
export function parserVerdict(text: string): Verdict {
  try {
    parseProjectFile(text, PROJECT_PATH)
    return VALID
  } catch (error) {
    if (error instanceof PulseCliError && error.code === "CONFIG") {
      return { valid: false, reason: error.message }
    }
    throw error
  }
}

/**
 * The one rule of a project file that JSON Schema cannot express: a defaultProfile that is not
 * blank names one of the file's profiles (pulse-cli compares the trimmed name).
 */
function foreignDefault(value: unknown): string | undefined {
  if (!isRecord(value) || typeof value.defaultProfile !== "string") return undefined
  const name = value.defaultProfile.trim()
  const profiles = isRecord(value.profiles) ? value.profiles : {}
  return name === "" || Object.hasOwn(profiles, name) ? undefined : `defaultProfile "${name}"`
}

/** What the schema says about a file's text, plus the defaultProfile rule outside JSON Schema. */
export function schemaVerdict(text: string): Verdict {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return { valid: false, reason: "not JSON" }
  }
  if (!validate(value)) return { valid: false, reason: ajv.errorsText(validate.errors) }
  const foreign = foreignDefault(value)
  return foreign === undefined ? VALID : { valid: false, reason: `${foreign} names no profile` }
}
