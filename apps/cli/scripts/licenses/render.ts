/**
 * THIRD_PARTY_LICENSES.txt: rendered from the inventory of the CLI's bundles, and held to it.
 */

import type { BundleName, Inventory, ThirdParty } from "./inventory.js"

const FILE = "THIRD_PARTY_LICENSES.txt"
const REGENERATE = "pnpm --fail-if-no-match --filter @miragon/pulse-cli third-party-licenses"
const RULE = "=".repeat(80)

/** The artifacts a set of bundles reaches, by the bundles' names joined with a space. */
const ARTIFACTS: Readonly<Record<string, string>> = {
  "npm standalone": "the npm package, the image and the executables",
  npm: "the npm package",
  standalone: "the image and the executables",
}

const artifactsOf = (bundles: readonly BundleName[]): string => {
  const artifacts = ARTIFACTS[bundles.join(" ")]
  if (artifacts === undefined) throw new Error(`no bundle holds it: ${JSON.stringify(bundles)}`)
  return artifacts
}

const INTRO = [
  "Third-party licences of the Pulse CLI (@miragon/pulse-cli)",
  "",
  "The npm package @miragon/pulse-cli, the image ghcr.io/miragon/pulse-cli and the single",
  "executables of the Pulse CLI hold the CLI's own code, under the MIT licence in LICENSE, and the",
  "works listed here, each under its own licence. apps/cli/scripts/third-party-licenses.ts of",
  "https://github.com/Miragon/pulse writes this file from the module graphs of the CLI's two",
  "bundles: the npm package's and the standalone bundle of the image and the executables.",
]

const NODE = [
  "Node.js is not listed: the npm package runs on yours, the image on the one of its base image,",
  "with its licence in /nodejs/LICENSE, and each executable embeds the Node.js that built it, whose",
  "licence the .tar.xz archive of a macOS or Linux executable holds as NODE_LICENSE and the GitHub",
  "release attaches for every executable as pulse-cli-NODE_LICENSE.",
]

const section = (title: string, lines: readonly string[]): string[] =>
  lines.length === 0 ? [] : ["", title, "", ...lines.map((line) => `  ${line}`)]

/** One line per work: name and version, licence, the artifacts that hold it, in columns. */
function summary(works: readonly ThirdParty[]): string[] {
  const titles = works.map(({ name, version }) => `${name} ${version}`)
  const width = Math.max(0, ...titles.map((title) => title.length))
  const licenceWidth = Math.max(0, ...works.map(({ licence }) => licence.length))
  return works.map((work, i) =>
    [(titles[i] ?? "").padEnd(width), work.licence.padEnd(licenceWidth), artifactsOf(work.bundles)]
      .join("   ")
      .trimEnd(),
  )
}

function entry(work: ThirdParty): string[] {
  const facts = [
    `Licence: ${work.licence}`,
    `In: ${artifactsOf(work.bundles)}`,
    ...(work.holds === undefined ? [] : [`Holds: ${work.holds}`]),
    ...(work.source === undefined ? [] : [`Source: ${work.source}`]),
  ]
  const texts = work.texts.flatMap(({ file, text }) => ["", `--- ${file} ---`, "", text])
  return ["", RULE, `${work.name} ${work.version}`, ...facts, ...texts]
}

/** The text of THIRD_PARTY_LICENSES.txt for an inventory. */
export function renderLicences(inventory: Inventory): string {
  const lines = [
    ...INTRO,
    ...section("Works of others in the bundles:", summary(inventory.thirdParty)),
    ...section(
      "Pulse's own packages in the bundles, under the MIT licence in LICENSE:",
      inventory.own,
    ),
    ...section(
      "Dependencies npm installs beside the npm package, each with its own licence:",
      inventory.installed,
    ),
    "",
    ...NODE,
    ...inventory.thirdParty.flatMap(entry),
  ]
  return `${lines.join("\n")}\n`
}

/** The works a THIRD_PARTY_LICENSES.txt lists: the name on the line after each rule. */
export function listedWorks(text: string): string[] {
  const lines = text.split("\n")
  return lines.flatMap((line, i) => {
    const title = lines[i + 1]
    if (line !== RULE || title === undefined) return []
    const space = title.lastIndexOf(" ")
    return [space > 0 ? title.slice(0, space) : title]
  })
}

/**
 * What a THIRD_PARTY_LICENSES.txt misses against the inventory: a work a bundle holds that it
 * does not list, a work it lists that no bundle holds any more, else any other difference (a
 * version, a licence text); empty when it is the file the inventory renders.
 */
export function licenceFindings(current: string, inventory: Inventory): string[] {
  if (current === renderLicences(inventory)) return []
  const listed = new Set(listedWorks(current))
  const names = new Set(inventory.thirdParty.map(({ name }) => name))
  const findings = [
    ...inventory.thirdParty
      .filter(({ name }) => !listed.has(name))
      .map(
        (work) =>
          `${work.name} ${work.version} is in ${artifactsOf(work.bundles)}, but ${FILE} does not list it`,
      ),
    ...[...listed]
      .filter((name) => !names.has(name))
      .map((name) => `${FILE} lists ${name}, which no bundle holds any more`),
  ]
  return (findings.length > 0 ? findings : [`${FILE} is out of date`]).map(
    (finding) => `${finding}: run \`${REGENERATE}\``,
  )
}
