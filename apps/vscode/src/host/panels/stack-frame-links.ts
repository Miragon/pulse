import type { CodeLocator, SourceLocation } from "../../contract/index.js"
import * as vscode from "vscode"
import { INCIDENT_SCHEME } from "./incident-documents.js"
import { StackFrames, type ClassMention, type StackFrame } from "./stack-frames.js"

const MAX_LOOKUPS = 40
const EXCLUDED = "**/{node_modules,target,build,dist}/**"

export class StackFrameLinks implements vscode.DocumentLinkProvider {
  private readonly sources = new Map<string, Promise<vscode.Uri | undefined>>()
  private readonly classes = new Map<string, Promise<SourceLocation | undefined>>()

  constructor(private readonly code: CodeLocator) {}

  async provideDocumentLinks(document: vscode.TextDocument): Promise<vscode.DocumentLink[]> {
    if (document.uri.scheme !== INCIDENT_SCHEME) {
      return []
    }
    const text = document.getText()
    const [frames, classes] = await Promise.all([
      this.frameLinks(StackFrames.in(text)),
      this.classLinks(StackFrames.classesIn(text)),
    ])
    return [...frames, ...classes]
  }

  private async frameLinks(frames: readonly StackFrame[]): Promise<vscode.DocumentLink[]> {
    const globs = [...new Set(frames.map((frame) => frame.sourceGlob))].slice(0, MAX_LOOKUPS)
    const resolved = new Map(
      await Promise.all(globs.map(async (glob) => [glob, await this.source(glob)] as const)),
    )
    return frames.flatMap((frame) => {
      const source = resolved.get(frame.sourceGlob)
      if (source === undefined) {
        return []
      }
      const range = new vscode.Range(frame.line, frame.start, frame.line, frame.end)
      const link = new vscode.DocumentLink(range, source.with({ fragment: `L${frame.sourceLine}` }))
      link.tooltip = `Open ${vscode.workspace.asRelativePath(source)} at line ${frame.sourceLine}`
      return [link]
    })
  }

  private async classLinks(mentions: readonly ClassMention[]): Promise<vscode.DocumentLink[]> {
    const names = [...new Set(mentions.map((mention) => mention.className))].slice(0, MAX_LOOKUPS)
    const resolved = new Map(
      await Promise.all(names.map(async (name) => [name, await this.declaration(name)] as const)),
    )
    return mentions.flatMap((mention) => {
      const declaration = resolved.get(mention.className)
      if (declaration === undefined) {
        return []
      }
      const range = new vscode.Range(mention.line, mention.start, mention.line, mention.end)
      const target = vscode.Uri.parse(declaration.uri).with({ fragment: `L${declaration.line}` })
      const link = new vscode.DocumentLink(range, target)
      link.tooltip = `Open the class ${mention.className}`
      return [link]
    })
  }

  private declaration(className: string): Promise<SourceLocation | undefined> {
    let lookup = this.classes.get(className)
    if (lookup === undefined) {
      lookup = this.code.locate({ kind: "class", className }).catch(() => undefined)
      this.classes.set(className, lookup)
    }
    return lookup
  }

  private source(glob: string): Promise<vscode.Uri | undefined> {
    const known = this.sources.get(glob)
    if (known !== undefined) {
      return known
    }
    const lookup = Promise.resolve(vscode.workspace.findFiles(glob, EXCLUDED, 1)).then(
      (files) => files[0],
    )
    this.sources.set(glob, lookup)
    return lookup
  }
}
