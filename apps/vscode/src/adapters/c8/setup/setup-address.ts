const WEB_PROTOCOLS: ReadonlySet<string> = new Set(["http:", "https:"])
const QUERY_OR_FRAGMENT = /[?#]/
const NOT_A_WEB_URL = "that is an http or https URL"

type WrittenUrl = { readonly url: string } | { readonly needs: string }

export class SetupAddress {
  static of(value: string): string | undefined {
    const trimmed = value.trim()
    if (!URL.canParse(trimmed) || QUERY_OR_FRAGMENT.test(trimmed)) {
      return undefined
    }
    const url = new URL(trimmed)
    const plain = url.username === "" && url.password === "" && WEB_PROTOCOLS.has(url.protocol)
    return plain ? trimmed.replace(/\/+$/, "") : undefined
  }

  static asWritten(value: string): WrittenUrl {
    const trimmed = value.trim()
    if (!URL.canParse(trimmed)) {
      return { needs: NOT_A_WEB_URL }
    }
    const url = new URL(trimmed)
    if (url.username !== "" || url.password !== "") {
      return { needs: "without credentials" }
    }
    if (!WEB_PROTOCOLS.has(url.protocol)) {
      return { needs: NOT_A_WEB_URL }
    }
    if (url.hash !== "" || url.href.endsWith("#")) {
      return { needs: "without a fragment" }
    }
    return { url: trimmed }
  }
}
