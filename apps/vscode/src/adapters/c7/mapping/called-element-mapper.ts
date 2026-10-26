import type { Mapper } from "./mapper.js"

export type CalledElementBinding =
  | { readonly kind: "latest" | "deployment" }
  | { readonly kind: "version"; readonly version: number }
  | { readonly kind: "versionTag"; readonly versionTag: string }

export interface CalledElement {
  readonly elementId: string
  readonly processKey: string
  readonly binding: CalledElementBinding
}

const CALL_ACTIVITY_TAG = /<(?:[\w-]+:)?callActivity\b(?:[^>"]|"[^"]*")*>/g
const EXPRESSION = /[$#]\{/
const WHOLE_NUMBER = /^\d+$/

export class CalledElementMapper implements Mapper<string, CalledElement[]> {
  map(xml: string): CalledElement[] {
    return [...xml.matchAll(CALL_ACTIVITY_TAG)].flatMap(([tag]) => this.calledElementOf(tag))
  }

  private calledElementOf(tag: string): CalledElement[] {
    const elementId = this.attribute(tag, "id")
    const processKey = this.attribute(tag, "calledElement")
    const binding = this.bindingOf(tag)
    if (elementId === undefined || processKey === undefined || binding === undefined) {
      return []
    }
    return EXPRESSION.test(processKey) ? [] : [{ elementId, processKey, binding }]
  }

  private bindingOf(tag: string): CalledElementBinding | undefined {
    const kind = this.attribute(tag, "calledElementBinding") ?? "latest"
    if (kind === "latest" || kind === "deployment") {
      return { kind }
    }
    if (kind === "version") {
      const version = this.attribute(tag, "calledElementVersion") ?? ""
      return WHOLE_NUMBER.test(version) ? { kind, version: Number(version) } : undefined
    }
    const versionTag = this.attribute(tag, "calledElementVersionTag")
    return kind === "versionTag" && versionTag !== undefined && !EXPRESSION.test(versionTag)
      ? { kind, versionTag }
      : undefined
  }

  private attribute(tag: string, name: string): string | undefined {
    return new RegExp(`\\s(?:[\\w-]+:)?${name}="([^"]*)"`).exec(tag)?.[1]
  }
}
