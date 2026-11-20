import { readdirSync, readFileSync } from "node:fs"
import { join, relative } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

const SRC = fileURLToPath(new URL(".", import.meta.url))

/**
 * What a block may import (the package's dependency rule, blocks-are-building-blocks): React,
 * Lucide, pulse-ui's root and its framework-free entries, the board format's and the screens'
 * main entries, and its own modules.
 */
const ALLOWED =
  /^(?:react|react-dom|react\/jsx-runtime|lucide-react|@miragon\/pulse-ui(?:\/(?:format|tones))?|@miragon\/pulse-board|@miragon\/pulse-screens|\.{1,2}\/.*)$/

/**
 * What only a host has, which a block never reaches for (D1, ui-foundation.md): a host's query,
 * confirmation, hand-off or bridge, the view host of widget-shell, and a React context of its own.
 */
const HOST_CONTEXT =
  /\b(?:useToolQuery|useToolQueries|useToolMutation|useViewData|ConfirmDialog|HandOffButton|HostBridge|useHost|useViewHost|useHostWrites|useHostFollowUp|createContext|useContext)\b/g

function shippedSources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return shippedSources(path)
    return /\.tsx?$/.test(entry.name) && !/\.test(?:-support)?\.tsx?$/.test(entry.name)
      ? [path]
      : []
  })
}

/** Every import a source names that a block may not make, and every host context it reaches for. */
function findingsOf(file: string, source: string): string[] {
  const imports = [...source.matchAll(/\bfrom\s+"([^"]+)"|\bimport\s+"([^"]+)"/g)]
    .map(([, from, bare]) => from ?? bare ?? "")
    .filter((specifier) => !ALLOWED.test(specifier))
    .map((specifier) => `${file}: imports ${specifier}`)
  const contexts = [...source.matchAll(HOST_CONTEXT)].map(([name]) => `${file}: uses ${name}`)
  return [...imports, ...contexts]
}

describe("the building blocks bring no host context", () => {
  it("import only React, Lucide, pulse-ui, the board format and the screens, and reach for no host", () => {
    const sources = shippedSources(SRC)

    expect(sources.map((path) => relative(SRC, path))).toEqual(
      expect.arrayContaining([
        "screens/instance/incident-card.tsx",
        "screens/instance/variables-table.tsx",
        "screens/process-table.tsx",
        "board/board-grid.tsx",
      ]),
    )
    expect(
      sources.flatMap((path) => findingsOf(relative(SRC, path), readFileSync(path, "utf8"))),
    ).toEqual([])
  })

  it("is not blind: a planted host import and host contexts fail it", () => {
    const planted = [
      'import { useToolQuery } from "@miragon/pulse-widget-shell/widgets"',
      'import { createContext, useContext } from "react"',
      'import "@modelcontextprotocol/ext-apps"',
      'import { InstanceScreen } from "@miragon/pulse-screens/builder"',
    ].join("\n")

    expect(findingsOf("probe.tsx", planted)).toEqual([
      "probe.tsx: imports @miragon/pulse-widget-shell/widgets",
      "probe.tsx: imports @modelcontextprotocol/ext-apps",
      "probe.tsx: imports @miragon/pulse-screens/builder",
      "probe.tsx: uses useToolQuery",
      "probe.tsx: uses createContext",
      "probe.tsx: uses useContext",
    ])
  })
})
