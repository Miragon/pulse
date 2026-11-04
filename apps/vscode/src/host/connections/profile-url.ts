import { EndpointPath } from "./endpoint-path.js"

const WEB_PROTOCOLS: ReadonlySet<string> = new Set(["http:", "https:"])
const QUERY_OR_FRAGMENT = /[?#]/

export class ProfileUrl {
  static of(value: unknown): string | undefined {
    if (typeof value !== "string") {
      return undefined
    }
    const trimmed = value.trim()
    if (!URL.canParse(trimmed) || QUERY_OR_FRAGMENT.test(trimmed)) {
      return undefined
    }
    const url = new URL(trimmed)
    const plain = url.username === "" && url.password === "" && WEB_PROTOCOLS.has(url.protocol)
    return plain ? EndpointPath.withoutTrailingSlashes(trimmed) : undefined
  }
}
