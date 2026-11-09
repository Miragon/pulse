import { readFileSync } from "node:fs"
import { pathToFileURL } from "node:url"

const PLUGIN_SCOPES = ["orca", "runtime-view", "engine-adapter"]
const CHANGELOG_LIMIT = 1900

export class ReleaseNotes {
  static of(changelog, tag, repository) {
    const lines = ReleaseNotes.section(changelog.split("\n"), tag.replace(/^v/, ""))
    const link = tag
      ? `[Every change of Pulse ${tag}](https://github.com/${repository}/releases/tag/${tag})`
      : ""
    const body = ReleaseNotes.pluginLines(lines).join("\n")
    const room = CHANGELOG_LIMIT - link.length - 2
    const kept =
      body.length > room ? body.slice(0, Math.max(0, body.lastIndexOf("\n", room))) : body
    return { tag, changelog: [kept, link].filter(Boolean).join("\n\n") }
  }

  static section(lines, version) {
    const heads = lines.flatMap((line, index) => (line.startsWith("## ") ? [index] : []))
    const start =
      heads.find((index) => version && lines[index].includes(`[${version}]`)) ?? heads[0]
    if (start === undefined) return []
    const end = heads.find((index) => index > start) ?? lines.length
    return lines.slice(start + 1, end)
  }

  static pluginLines(lines) {
    const scoped = new RegExp(`^\\* \\*\\*(${PLUGIN_SCOPES.join("|")}):\\*\\*`)
    const kept = []
    let heading
    for (const line of lines) {
      if (line.startsWith("### ")) heading = line
      else if (scoped.test(line)) {
        if (heading !== undefined) kept.push("", heading, "")
        heading = undefined
        kept.push(line)
      }
    }
    return kept.length === 0 ? ["No change to the Orca plugin itself."] : kept.slice(1)
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const [changelogPath, tag = "", repository = "Miragon/pulse"] = process.argv.slice(2)
  if (changelogPath === undefined) {
    console.error("usage: release-notes.mjs <CHANGELOG.md> [tag] [owner/repo]")
    process.exit(1)
  }
  const notes = ReleaseNotes.of(readFileSync(changelogPath, "utf8"), tag, repository)
  console.log(JSON.stringify(notes))
}
