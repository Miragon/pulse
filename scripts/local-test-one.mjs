/**
 * The plan of `pnpm test:one <file...>`, the inner loop's focused run (pure;
 * scripts/local-test-one.test.mjs). vitest checks a package's coverage floors on a filtered run
 * too, so a file whose tests all pass would fail on the code it never loaded; this run switches
 * coverage off, and the floors stay the gate of the package's pinned `vitest run`
 * (scripts/check-package-scripts.mjs). A library's `exports` point at its dist, so the packages
 * under the file build first, or the run would test their last build.
 */
import path from "node:path"

/** The suites a package's `test` leaves out: they need more than vitest and keep their scripts. */
const OTHER_SUITES = [
  { pattern: /\.(?:it|engine)\.test\.ts$/, script: "test:engines", needs: "Docker" },
  { pattern: /(?:^|[\\/])test-host[\\/]/, script: "test:host", needs: "Playwright" },
]

const isInside = (dir, file) => {
  const relative = path.relative(dir, file)
  return !relative.startsWith("..") && !path.isAbsolute(relative)
}

/**
 * What to say when a run fails in a package that runs tests in a browser: Playwright's own box
 * names a bare `pnpm exec playwright install`, which finds no playwright at the root.
 */
const browserHint = ({ name, devDependencies }) =>
  devDependencies?.["@vitest/browser-playwright"] === undefined
    ? undefined
    : `${name} runs tests in Chromium. If Playwright says its browser is missing, install it ` +
      `once: pnpm --fail-if-no-match --filter ${name} exec playwright install chromium`

/** A package with none has nothing to build, and turbo warns about a filter that selects nothing. */
const hasWorkspaceDependency = ({ dependencies, devDependencies }) =>
  Object.values({ ...dependencies, ...devDependencies }).some((range) =>
    range.startsWith("workspace:"),
  )

/**
 * Why `file` cannot run, or undefined. `abs`: where it resolved to (a relative path is read from
 * where pnpm ran); `pkg`: the workspace package that owns it, if any.
 */
function refusal(file, abs, pkg, fileExists) {
  if (!fileExists) return `No such file: ${abs}`
  if (pkg === undefined) {
    return (
      `${file} belongs to no workspace package. The repo guards run on node:test ` +
      `(node --test scripts/<name>.test.mjs); the template has its own workspace.`
    )
  }
  const { name, scripts } = pkg.manifest
  if (scripts?.test === undefined) return `${file} belongs to ${name}, which has no tests.`
  const suite = OTHER_SUITES.find(({ pattern }) => pattern.test(file))
  return suite
    ? `${file} needs ${suite.needs}, so test:one does not run it: ` +
        `pnpm --fail-if-no-match --filter ${name} ${suite.script}`
    : undefined
}

/**
 * `{ builds, runs }` for `files`, or an Error naming what is wrong. `builds`: the turbo filters
 * of the packages under the files. `runs`: per owning package, the pnpm arguments to run in its
 * `dir` (a `--watch` run follows one package: a watcher never returns to the next one) and the
 * `hint` to show when it fails, if any.
 */
export function testOnePlan({ files, watch, root, cwd, workspace, exists }) {
  const owned = new Map()
  for (const file of files) {
    const abs = path.resolve(cwd, file)
    const pkg = workspace.find(({ dir }) => isInside(path.join(root, dir), abs))
    const refused = refusal(file, abs, pkg, exists(abs))
    if (refused !== undefined) return new Error(refused)
    // vitest filters by POSIX path; a package's own directory selects all of its tests.
    const relative = path.relative(path.join(root, pkg.dir), abs).split(path.sep).join("/")
    owned.set(pkg, [...(owned.get(pkg) ?? []), relative || "."])
  }
  const packages = [...owned.keys()]
  if (watch && packages.length > 1) {
    const names = packages.map(({ manifest }) => manifest.name).join(", ")
    return new Error(`--watch follows one package; these files belong to ${names}.`)
  }
  return {
    builds: packages
      .filter(({ manifest }) => hasWorkspaceDependency(manifest))
      .map(({ manifest }) => `${manifest.name}^...`),
    runs: packages.map((pkg) => ({
      dir: pkg.dir,
      name: pkg.manifest.name,
      args: [
        "exec",
        "vitest",
        watch ? "watch" : "run",
        ...owned.get(pkg),
        "--coverage.enabled=false",
      ],
      hint: browserHint(pkg.manifest),
    })),
  }
}
