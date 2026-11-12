import { spawnSync } from "node:child_process"
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { beforeEach, describe, expect, it } from "vitest"
import { parse } from "yaml"
import { EXE_TARGETS, exeTarget } from "./exe/sea.js"
import { CLI_LAYOUT, LICENCES_FILE } from "./licenses/bundles.js"

const cliFile = (path: string): string => readFileSync(join(CLI_LAYOUT.cli, path), "utf8")

/** The parts of publish-cli.yml the licences of a release pass through. */
interface Step {
  name?: string
  uses?: string
  run?: string
  "working-directory"?: string
  with?: Record<string, unknown>
}
interface Job {
  needs?: string | string[]
  strategy?: { matrix?: { include?: Record<string, string | undefined>[] } }
  steps?: Step[]
}
interface Workflow {
  jobs: Partial<Record<"binaries" | "licences" | "assets", Job>>
}

const publishCli = (): Workflow =>
  parse(
    readFileSync(join(CLI_LAYOUT.repo, ".github/workflows/publish-cli.yml"), "utf8"),
  ) as Workflow
const stepsOf = (job: Job | undefined): Step[] => job?.steps ?? []
const stepOf = (job: Job | undefined, test: (step: Step) => boolean): Step | undefined =>
  stepsOf(job).find(test)
const withOf = (step: Step | undefined, key: string): string | undefined => {
  const value = step?.with?.[key]
  return typeof value === "string" ? value : undefined
}
const setWith = (step: Step | undefined, key: string, value: string): void => {
  if (step?.with) step.with[key] = value
}
const isAction = (step: Step, action: string): boolean => step.uses?.split("@")[0] === action
const uploadOf = (job: Job | undefined): Step | undefined =>
  stepOf(job, (step) => isAction(step, "actions/upload-artifact"))
const runOf = (job: Job | undefined, name: string): string =>
  stepOf(job, (step) => step.name === name)?.run ?? ""
/** A folder as a step's script names it: `${{ runner.temp }}` is $RUNNER_TEMP there. */
const inRun = (path: string | undefined): string =>
  path?.replaceAll("${{ runner.temp }}", "$RUNNER_TEMP") ?? ""
const globMatches = (glob: string, name: string): boolean =>
  new RegExp(
    `^${glob
      .split("*")
      .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
      .join(".*")}$`,
  ).test(name)
/** The two folders a step's script hands release-licenses.sh: its input and its output. */
const scriptArgs = (step: Step): [string, string] | undefined => {
  const call = /^bash apps\/cli\/scripts\/release-licenses\.sh "([^"]+)" "([^"]+)"$/
  const [, from, to] = call.exec(step.run?.trim() ?? "") ?? []
  return from !== undefined && to !== undefined ? [from, to] : undefined
}
/** Where build:exe keeps the licence of the Node.js an executable embeds (scripts/build-exe.ts). */
const KEPT = "apps/cli/build/node-license/${{ matrix.file }}"
const keptLicenceUpload = (binaries: Job | undefined): Step | undefined =>
  stepOf(
    binaries,
    (step) => isAction(step, "actions/upload-artifact") && withOf(step, "path") === KEPT,
  )

/** The artifacts of the binary jobs that hold the kept licences, one per target. */
function keptArtifacts(binaries: Job | undefined): string[] {
  const name = withOf(keptLicenceUpload(binaries), "name") ?? ""
  const targets = (binaries?.strategy?.matrix?.include ?? []).map(({ target }) => target ?? "")
  const names = targets.map((target) => name.replaceAll("${{ matrix.target }}", target))
  return name !== "" && new Set(names).size === targets.length ? names : []
}

const needs = (job: Job | undefined, other: string): boolean =>
  [job?.needs ?? []].flat().includes(other)
const isFinding = (finding: string | false): finding is string => finding !== false

/** The download of the kept licences: its pattern takes every one, all into one folder. */
function downloadFindings(download: Step | undefined, kept: readonly string[]) {
  const pattern = withOf(download, "pattern") ?? ""
  const missed = kept.filter((name) => !globMatches(pattern, name))
  return [
    kept.length === 0 && `binaries: no step uploads ${KEPT}, one artifact per target`,
    missed.length > 0 && `licences: the download ${pattern} misses ${missed.join(", ")}`,
    download?.with?.["merge-multiple"] !== true && "licences: the download merges no artifacts",
  ]
}

/** The licences job: every kept licence into the folder the script reads, what it writes out. */
function licencesJobFindings(job: Job | undefined, kept: readonly string[]) {
  const download = stepOf(job, (step) => isAction(step, "actions/download-artifact"))
  const filled = withOf(download, "path") ?? ""
  const [from, to] = stepsOf(job)
    .map(scriptArgs)
    .find((args) => args !== undefined) ?? ["", ""]
  const upload = uploadOf(job)
  const findings = [
    !needs(job, "binaries") && "licences: needs no binaries",
    ...downloadFindings(download, kept),
    from !== inRun(filled) && `licences: the script reads ${from}, the download fills ${filled}`,
    inRun(withOf(upload, "path")) !== `${to}/pulse-cli-*` &&
      "licences: no step uploads the folder the script writes, as pulse-cli-*",
  ]
  return { findings: findings.filter(isFinding), artifact: withOf(upload, "name") ?? "" }
}

/** The assets job: the licences beside the executables, where the checksums and upload take all. */
function assetsJobFindings(job: Job | undefined, artifact: string): string[] {
  const executables = stepOf(job, (step) => withOf(step, "pattern") === "cli-binary-*")
  const folder = withOf(executables, "path") ?? ""
  const download = stepOf(job, (step) => artifact !== "" && withOf(step, "name") === artifact)
  const into = withOf(download, "path") ?? ""
  const outside = ["Write pulse-cli-SHA256SUMS", "Upload to the release"].filter(
    (name) => stepOf(job, (step) => step.name === name)?.["working-directory"] !== folder,
  )
  return [
    !needs(job, "licences") && "assets: needs no licences",
    download === undefined && `assets: downloads no ${artifact || "licences"}`,
    download !== undefined &&
      into !== folder &&
      `assets: downloads ${artifact} into ${into}, the executables into ${folder}`,
    ...outside.map((name) => `assets: "${name}" works outside ${folder}`),
  ].filter(isFinding)
}

/**
 * Where publish-cli.yml breaks the way of the Node.js licences to the release: each binary job
 * uploads the one build:exe kept, the licences job downloads them all into the folder
 * release-licenses.sh reads and uploads what it writes, and the assets job waits for it and puts
 * that beside the executables, where the checksums, the attestation and the upload take every file.
 */
function licenceChainFindings({ jobs }: Workflow): string[] {
  const { findings, artifact } = licencesJobFindings(jobs.licences, keptArtifacts(jobs.binaries))
  return [...findings, ...assetsJobFindings(jobs.assets, artifact)]
}

/**
 * apps/cli/CLAUDE.md, "Licences": a release attaches the licences of the archives for every
 * executable, the Windows one and the raw ones included, as assets of their own
 * (scripts/release-licenses.sh in publish-cli.yml's licences job); the archives' own are in
 * scripts/third-party-licenses.test.ts.
 */
describe.skipIf(process.platform === "win32")("the licences a release attaches", () => {
  const executables = EXE_TARGETS.map((key) => {
    const [platform = "", arch = ""] = key.split("-")
    return exeTarget(platform, arch).fileName
  })
  const ASSETS = [
    "pulse-cli-LICENSE",
    "pulse-cli-NODE_LICENSE",
    "pulse-cli-THIRD_PARTY_LICENSES.txt",
  ]
  const NODE = "Node.js is licensed for use as follows:\n\nthe licence of Node.js 24\n"
  let dir = ""
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "pulse-cli-release-"))
    mkdirSync(join(dir, "node-license"))
    return () => {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  /** Each executable's Node.js licence as build:exe keeps it: Windows's with CRLF line ends. */
  const ofEvery = (text: string): Record<string, string | undefined> =>
    Object.fromEntries(
      executables.map((name) => [
        name,
        name.endsWith(".exe") ? text.replaceAll("\n", "\r\n") : text,
      ]),
    )
  const assemble = (licences: Readonly<Record<string, string | undefined>>) => {
    for (const [name, text] of Object.entries(licences)) {
      if (text !== undefined) writeFileSync(join(dir, "node-license", name), text)
    }
    const args = [join(dir, "node-license"), join(dir, "assets")]
    return spawnSync("bash", [join(CLI_LAYOUT.cli, "scripts", "release-licenses.sh"), ...args], {
      encoding: "utf8",
    })
  }

  it("attaches the archive's licences once for every executable, as assets the upload takes", () => {
    const assembled = assemble(ofEvery(NODE))
    // the status, not an empty stderr: bash may warn there of a locale the machine lacks
    expect(assembled.status).toBe(0)
    expect(assembled.stderr).not.toContain("release-licenses.sh")
    const asset = (name: string) => readFileSync(join(dir, "assets", name), "utf8")
    expect(readdirSync(join(dir, "assets")).toSorted()).toEqual(ASSETS)
    expect(asset("pulse-cli-LICENSE")).toBe(cliFile("LICENSE"))
    expect(asset("pulse-cli-THIRD_PARTY_LICENSES.txt")).toBe(readFileSync(LICENCES_FILE, "utf8"))
    expect(asset("pulse-cli-NODE_LICENSE")).toBe(NODE)
    // publish-cli.yml: the licences job writes them, the assets job counts every pulse-cli-*
    // file (the executables, the archives of all but Windows's, the licences), sums, attests
    // and uploads them
    const { binaries, assets } = publishCli().jobs
    const matrix = binaries?.strategy?.matrix?.include ?? []
    expect(matrix.map(({ file }) => file).toSorted()).toEqual(executables.toSorted())
    expect(ASSETS.filter((name) => !name.startsWith("pulse-cli-"))).toEqual([])
    expect(runOf(assets, "Upload to the release")).toMatch(
      /^gh release upload "\$TAG" pulse-cli-\* --clobber /,
    )
    const sums = runOf(assets, "Write pulse-cli-SHA256SUMS")
    const counted = /\n\s*if \[ "\$\{#files\[@\]\}" -ne (\d+) \]; then\n/.exec(sums)?.[1]
    const archives = executables.filter((name) => !name.endsWith(".exe"))
    expect(Number(counted)).toBe(executables.length + archives.length + ASSETS.length)
  })

  it("hands each executable's Node.js licence from its binary job through the script to the upload", () => {
    expect(licenceChainFindings(publishCli())).toEqual([])
  })

  it.each<[string, (jobs: Workflow["jobs"]) => void, string]>([
    [
      "a binary job uploads its licence under a name the download misses",
      ({ binaries }) => {
        setWith(keptLicenceUpload(binaries), "name", "cli-node-licence-${{ matrix.target }}")
      },
      "licences: the download cli-node-license-* misses cli-node-licence-linux-x64",
    ],
    [
      "the script reads another folder than the download fills",
      ({ licences }) => {
        const step = stepOf(licences, (it) => scriptArgs(it) !== undefined)
        if (step?.run) step.run = step.run.replace("/node-licenses", "/node-licences")
      },
      "licences: the script reads $RUNNER_TEMP/node-licences",
    ],
    [
      "the licences job uploads another folder than the script writes",
      ({ licences }) => {
        setWith(uploadOf(licences), "path", "${{ runner.temp }}/licenses/pulse-cli-*")
      },
      "licences: no step uploads the folder the script writes",
    ],
    [
      "the assets job does not wait for the licences",
      ({ assets }) => {
        if (assets) assets.needs = ["bundle", "binaries"]
      },
      "assets: needs no licences",
    ],
    [
      "the assets job downloads no licences",
      ({ assets }) => {
        if (assets) assets.steps = stepsOf(assets).filter((it) => withOf(it, "name") === undefined)
      },
      "assets: downloads no cli-licences",
    ],
    [
      "the licences land beside no other asset",
      ({ assets }) => {
        const step = stepOf(assets, (it) => withOf(it, "name") === "cli-licences")
        setWith(step, "path", "${{ runner.temp }}/licences")
      },
      "assets: downloads cli-licences into ${{ runner.temp }}/licences",
    ],
  ])("finds the chain broken where %s", (_, plant, finding) => {
    const workflow = publishCli()
    plant(workflow.jobs)
    expect(licenceChainFindings(workflow).join("\n")).toContain(finding)
  })

  it.each([
    [
      "takes another Node.js licence",
      { "pulse-cli-linux-x64": "the licence of Node.js 22\n" },
      "\n  pulse-cli-linux-x64\n  pulse-cli-linux-arm64 pulse-cli-macos-x64 pulse-cli-macos-arm64 pulse-cli-windows-x64.exe\n",
    ],
    [
      "kept no licence",
      { "pulse-cli-windows-x64.exe": undefined },
      "pulse-cli-windows-x64.exe does not exist or is empty",
    ],
    [
      "is no executable of the release",
      { "pulse-cli-freebsd-x64": NODE },
      "pulse-cli-freebsd-x64 is the licence of no executable of the release",
    ],
  ])("attaches nothing while a target %s, naming it", (_, planted, message) => {
    const assembled = assemble({ ...ofEvery(NODE), ...planted })
    expect(assembled.status).toBe(1)
    expect(assembled.stderr).toContain(message)
    expect(existsSync(join(dir, "assets"))).toBe(false)
  })
})
