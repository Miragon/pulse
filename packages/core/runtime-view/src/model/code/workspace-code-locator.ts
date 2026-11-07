import type {
  CodeLocator,
  ElementImplementation,
  SourceLocation,
  WorkspaceFiles,
} from "../../contract/index.js"
import { SourceSearch } from "./source-search.js"

const JVM_SOURCES = "{java,kt,groovy,scala}"
const WORKER_SOURCES = `**/*.{java,kt,groovy,scala,js,ts}`
const BEAN_NAME = /^[$#]\{\s*([A-Za-z_$][\w$]*)/
const SUBSCRIPTION =
  "(?:ExternalTaskSubscription|JobWorker|ZeebeWorker|subscribe|jobType|topicName)\\b.*"

export class WorkspaceCodeLocator implements CodeLocator {
  private readonly search: SourceSearch

  constructor(files: WorkspaceFiles) {
    this.search = new SourceSearch(files)
  }

  locate(implementation: ElementImplementation): Promise<SourceLocation | undefined> {
    switch (implementation.kind) {
      case "class":
        return this.classOf(implementation.className)
      case "delegate":
      case "expression":
        return this.bean(implementation.expression)
      case "workerTask":
        return this.worker(implementation.taskType)
    }
  }

  private classOf(className: string): Promise<SourceLocation | undefined> {
    const outerClass = className.split("$")[0] ?? className
    const simpleName = outerClass.slice(outerClass.lastIndexOf(".") + 1)
    return this.search.declaration(
      `**/${outerClass.replaceAll(".", "/")}.${JVM_SOURCES}`,
      this.declared(simpleName),
    )
  }

  private declared(simpleName: string): RegExp {
    return new RegExp(`\\b(?:class|interface|enum|record|object)\\s+${this.escaped(simpleName)}\\b`)
  }

  private async bean(expression: string): Promise<SourceLocation | undefined> {
    const name = BEAN_NAME.exec(expression.trim())?.[1]
    if (name === undefined) {
      return undefined
    }
    const className = `${name.charAt(0).toUpperCase()}${name.slice(1)}`
    const named = new RegExp(
      `@(?:Component|Service|Repository|Named|Bean)\\s*\\(\\s*(?:value\\s*=\\s*)?["']${this.escaped(name)}["']`,
    )
    return (
      (await this.search.declaration(`**/${className}.${JVM_SOURCES}`, this.declared(className))) ??
      (await this.search.firstLine(`**/*.${JVM_SOURCES}`, named))
    )
  }

  private async worker(taskType: string): Promise<SourceLocation | undefined> {
    return (
      (await this.search.firstLine(WORKER_SOURCES, this.quoted(taskType, SUBSCRIPTION))) ??
      (await this.search.firstLine(WORKER_SOURCES, this.quoted(taskType)))
    )
  }

  private quoted(literal: string, before = ""): RegExp {
    return new RegExp(`${before}(["'\`])${this.escaped(literal)}\\1`)
  }

  private escaped(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  }
}
