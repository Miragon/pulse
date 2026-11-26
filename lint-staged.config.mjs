import path from "node:path"

/**
 * The pre-commit hook's checks of the staged files. ESLint reads a package's baseline of budget
 * violations (its eslint-suppressions.json, #688) by paths relative to the folder it runs in, and
 * `pnpm lint` runs it in the package's folder: a staged file of such a package is linted from
 * there too, so the baseline applies to the hook as to the gate; every other file from the root.
 */
const BASELINED = [
  "packages/connectors/engine/engine-connector",
  "packages/core/widget-shell",
  "packages/core/ui",
  "apps/web",
]

const quoted = (files) => files.map((file) => JSON.stringify(file)).join(" ")

/**
 * One `eslint --fix` per baselined package that holds a staged file, one for the rest. lint-staged
 * hands absolute paths with forward slashes; `paths` is node:path's API of the platform (its
 * win32 one on Windows, where the cwd has backslashes), so a package is found on either.
 */
export function eslintRuns(files, cwd = process.cwd(), paths = path) {
  const byPackage = new Map()
  const rest = []
  for (const file of files) {
    const relative = paths.relative(cwd, file).split(paths.sep).join("/")
    const dir = BASELINED.find((each) => relative.startsWith(`${each}/`))
    if (dir === undefined) rest.push(file)
    else byPackage.set(dir, [...(byPackage.get(dir) ?? []), relative.slice(dir.length + 1)])
  }
  return [
    ...[...byPackage].map(([dir, own]) => `pnpm --dir ${dir} exec eslint --fix ${quoted(own)}`),
    ...(rest.length > 0 ? [`eslint --fix ${quoted(rest)}`] : []),
  ]
}

export default {
  "*.{ts,tsx}": (files) => [...eslintRuns(files), `prettier --write ${quoted(files)}`],
  "*.{json,md,yml,yaml,css}": "prettier --write",
}
