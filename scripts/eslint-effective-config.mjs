/**
 * The effective-config half of the ESLint ratchet (scripts/check-ratchets.mjs).
 *
 * The AST half reads only the `ignores` lists and the imports of
 * eslint.config.mjs. This half asks ESLint itself: the merge-base config and
 * the working-tree config are both evaluated, and for every source file under
 * apps/ and packages/ — plus one sample path per `files`/`ignores` glob that
 * matches no file yet, so an exemption pre-planted for a future file is seen
 * too — the settings ESLint would apply are compared:
 *
 *   - a file linted on the base stays linted (never newly ignored);
 *   - complexity / max-lines / no-restricted-syntax at "error" stay "error";
 *   - complexity and max-lines never rise, and max-lines' skip options never
 *     relax;
 *   - no-restricted-syntax never drops, for one file, a selector the new
 *     config still applies to others (a per-file carve-out or an override
 *     block that REPLACES a gate's selectors — flat config never merges one
 *     rule's options); a gate rewritten for every file is rewritten the same
 *     way for every file that shared it, and never ends up with fewer
 *     selectors.
 *
 * Whatever shape produced a setting — a const, a spread, an imported object,
 * a reordered block, an ignore moved between blocks — the outcome is what the
 * gates enforce, so that is what is compared.
 */
import path from "node:path"
import { pathToFileURL } from "node:url"
import { ESLint } from "eslint"
import picomatch from "picomatch"

const GATE_RULES = ["complexity", "max-lines", "no-restricted-syntax"]

// ESLint's own defaults when a rule is enabled without options.
const DEFAULT_COMPLEXITY = 20
const DEFAULT_MAX_LINES = 300

const severity = (setting) => {
  const level = Array.isArray(setting) ? setting[0] : setting
  if (level === 2 || level === "error") return 2
  if (level === 1 || level === "warn") return 1
  return 0
}

const firstOption = (setting) => (Array.isArray(setting) ? setting[1] : undefined)

function complexityMax(setting) {
  const option = firstOption(setting)
  if (typeof option === "number") return option
  return option?.max ?? option?.maximum ?? DEFAULT_COMPLEXITY
}

function maxLinesOptions(setting) {
  const option = firstOption(setting)
  if (typeof option === "number") return { max: option, skipBlankLines: false, skipComments: false }
  return {
    max: option?.max ?? DEFAULT_MAX_LINES,
    skipBlankLines: Boolean(option?.skipBlankLines),
    skipComments: Boolean(option?.skipComments),
  }
}

const selectors = (setting) =>
  new Set(
    (Array.isArray(setting) ? setting.slice(1) : [])
      .map((option) => (typeof option === "string" ? option : option?.selector))
      .filter((selector) => typeof selector === "string"),
  )

/**
 * How the effective config `cur` of one file is laxer than `base` (each the
 * result of calculateConfigForFile; undefined = ignored or matched by no
 * block). `stillApplied`: every no-restricted-syntax selector the new config
 * enforces on any file. `peers`: the selectors a majority of the other files
 * that shared this file's base gate now carry (null when it shared the gate
 * with no other file).
 */
export function loosenings(base, cur, { stillApplied = new Set(), peers = null } = {}) {
  if (!base) return []
  if (!cur) return ["no longer linted at all (ignored, or matched by no config block)"]
  const reasons = []
  for (const rule of GATE_RULES) {
    const before = base.rules?.[rule]
    const after = cur.rules?.[rule]
    if (severity(before) < 2) continue
    if (severity(after) < 2) {
      reasons.push(`${rule} is no longer an error`)
      continue
    }
    if (rule === "complexity" && complexityMax(after) > complexityMax(before))
      reasons.push(`complexity ${complexityMax(before)} -> ${complexityMax(after)}`)
    if (rule === "max-lines") {
      const was = maxLinesOptions(before)
      const now = maxLinesOptions(after)
      if (now.max > was.max) reasons.push(`max-lines ${was.max} -> ${now.max}`)
      for (const skip of ["skipBlankLines", "skipComments"])
        if (now[skip] && !was[skip]) reasons.push(`max-lines now sets ${skip}`)
    }
    if (rule === "no-restricted-syntax") {
      const was = selectors(before)
      const now = selectors(after)
      const lost = [...was].filter((selector) => !now.has(selector))
      const carvedOut = lost.filter((selector) => stillApplied.has(selector))
      // A selector retired from the whole config means the gate was rewritten;
      // every file that shared the gate must then get the same rewrite.
      const missing = lost.length > 0 && peers ? [...peers].filter((s) => !now.has(s)) : []
      if (carvedOut.length > 0) {
        reasons.push(
          `no-restricted-syntax drops ${carvedOut.length} selector(s) other files keep (e.g. "${carvedOut[0]}")`,
        )
      } else if (missing.length > 0) {
        reasons.push(
          `no-restricted-syntax was rewritten differently from the other files that shared its gate (missing e.g. "${missing[0]}")`,
        )
      } else if (lost.length > 0 && now.size < was.size) {
        reasons.push(`no-restricted-syntax shrank from ${was.size} to ${now.size} selector(s)`)
      }
    }
  }
  return reasons
}

/**
 * One concrete path a `files`/`ignores` glob matches, or null (a negation, a
 * character class, or a path outside apps/ and packages/). `{a,b}` takes the
 * first alternative, `**` collapses, `*` becomes `__probe__`, and a directory
 * glob gets a `.ts` file.
 */
export function sampleFromGlob(pattern) {
  if (typeof pattern !== "string" || pattern.startsWith("!") || /[[\]()]/.test(pattern)) return null
  let sample = pattern
    .replace(/\{([^{}]*)\}/g, (_, alternatives) => alternatives.split(",")[0])
    .replace(/^\*\*\//, "packages/__probe__/")
    .replace(/\/\*\*\//g, "/")
    .replace(/\/\*\*$/, "/__probe__.ts")
    .replace(/\*/g, "__probe__")
    .replace(/\?/g, "x")
  if (!/\.(?:[cm]?[jt]s|[jt]sx)$/.test(sample)) sample = `${sample.replace(/\/$/, "")}/__probe__.ts`
  return /^(?:apps|packages)\//.test(sample) ? sample : null
}

/** The flat config array a config module exports (array, object or promise). */
async function loadConfigArray(file) {
  const module = await import(`${pathToFileURL(file).href}?ratchet=${Date.now()}`)
  return [await module.default].flat(Infinity)
}

/** Every string glob of every `files`/`ignores` list in a config array. */
function configGlobs(configs) {
  const globs = new Set()
  for (const config of configs) {
    if (!config || typeof config !== "object") continue
    for (const key of ["files", "ignores"])
      for (const glob of [config[key] ?? []].flat(Infinity))
        if (typeof glob === "string") globs.add(glob)
  }
  return [...globs]
}

/** The no-restricted-syntax selectors a config enforces ("error"), else none. */
const enforcedSelectors = (config) => {
  const setting = config?.rules?.["no-restricted-syntax"]
  return severity(setting) === 2 ? selectors(setting) : new Set()
}

/**
 * For every file whose base config enforced a gate: the selectors a strict
 * majority of the OTHER files with the identical base gate carry in the new
 * config (a majority, so a second carve-out cannot hide the first).
 */
function peerSelectors(effective) {
  const groups = new Map()
  for (const entry of effective) {
    const before = enforcedSelectors(entry.base)
    if (before.size === 0) continue
    const key = [...before].sort().join("\n")
    groups.set(key, [...(groups.get(key) ?? []), entry])
  }
  const peers = new Map()
  for (const members of groups.values()) {
    if (members.length < 2) continue
    const sets = members.map((member) => enforcedSelectors(member.cur))
    const counts = new Map()
    for (const set of sets)
      for (const selector of set) counts.set(selector, (counts.get(selector) ?? 0) + 1)
    members.forEach((member, i) => {
      const shared = [...counts]
        .filter(
          ([selector, count]) => 2 * (count - (sets[i].has(selector) ? 1 : 0)) > members.length - 1,
        )
        .map(([selector]) => selector)
      peers.set(member, new Set(shared))
    })
  }
  return peers
}

/** Per-file loosenings → one violation per reason, naming the files. */
export function describeLoosenings(effective, label) {
  const stillApplied = new Set(effective.flatMap(({ cur }) => [...enforcedSelectors(cur)]))
  const peers = peerSelectors(effective)
  const byReason = new Map()
  for (const entry of effective) {
    const context = { stillApplied, peers: peers.get(entry) ?? null }
    for (const reason of loosenings(entry.base, entry.cur, context))
      byReason.set(reason, [...(byReason.get(reason) ?? []), entry.rel])
  }
  return [...byReason].map(([reason, files]) => {
    const shown = files.slice(0, 5).join(", ")
    return `${label} -> ${reason} for ${files.length} file(s): ${shown}${files.length > 5 ? ", …" : ""}. The effective config is what the gates enforce, whatever shape produced it — fix the code instead (or carry the Ratchet-Exception trailer for a deliberate gate change).`
  })
}

/**
 * Compare the settings ESLint applies under `baseConfigFile` vs
 * `newConfigFile` (both resolved from `cwd`) for `files` (repo-relative) plus
 * a sample path per glob that matches none of them.
 */
export async function compareEffectiveEslint({ cwd, baseConfigFile, newConfigFile, files, label }) {
  const globs = [
    ...configGlobs(await loadConfigArray(baseConfigFile)),
    ...configGlobs(await loadConfigArray(newConfigFile)),
  ]
  const samples = globs
    .filter((glob) => !files.some((file) => picomatch.isMatch(file, glob, { dot: true })))
    .map(sampleFromGlob)
    .filter(Boolean)
  const probes = [...new Set([...files, ...samples])].sort()
  const base = new ESLint({ cwd, overrideConfigFile: baseConfigFile })
  const cur = new ESLint({ cwd, overrideConfigFile: newConfigFile })
  const effective = []
  for (const rel of probes) {
    const abs = path.join(cwd, rel)
    effective.push({
      rel,
      base: await base.calculateConfigForFile(abs),
      cur: await cur.calculateConfigForFile(abs),
    })
  }
  return describeLoosenings(effective, label)
}
