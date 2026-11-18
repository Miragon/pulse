/**
 * The one discovery of the server's own identity provider at a replica, by
 * `@miragon/pulse-http/oauth`, which takes only a document that names the issuer exactly. Two
 * halves read it, each checking the document by its own needs, so what one needs never blocks the
 * other: the web sign-in's metadata (PKCE with S256, a client authentication a confidential client
 * can do, endpoints on https or on the machine itself) and the gate's key metadata (the key set's
 * URL by the same rule, on the machine itself only for an issuer there, and the issuer its access
 * tokens carry), so a provider whose clients sign in by a method the web sign-in lacks
 * (`private_key_jwt` alone) still has its tokens verified. It runs when first asked rather than at
 * boot, so a provider that does not answer leaves the server up: meanwhile a sign-in ends on the
 * signed-out page (`unavailable`) and `/mcp` answers 503. The halves share each document: one the
 * other half read within the hour serves a half that has not checked it, so one read an hour
 * serves both. What a half found holds for an hour from its document's read, and another hour
 * after a failed re-read (stale-if-error), said once in the log; a failure before a half's first
 * answer holds for nothing, and its next request reads anew. The requests that wait meanwhile
 * share one read.
 */
import type { Platform } from "@miragon/pulse-http"
import {
  discover,
  keyMetadata,
  serverMetadata,
  type DiscoveryAnswer,
  type KeyMetadata,
  type KeyMetadataProblem,
  type ServerMetadata,
  type TokenFailure,
} from "@miragon/pulse-http/oauth"
import { isLocalHostname } from "./oauth-shared.js"

/** How long the metadata a discovery found holds. */
export const DISCOVERY_HOLD_MS = 3_600_000

/** What the discovery fetches through, and its clock. */
export type DiscoveryPlatform = Platform

/** The network itself, and the wall clock. */
export const NETWORK: DiscoveryPlatform = {
  fetch: (input, init) => fetch(input, init),
  now: () => Date.now(),
}

/** The provider's metadata, `undefined` while it cannot be read: it never rejects. */
export type MetadataSource = () => Promise<ServerMetadata | undefined>

/** What the gate verifies the provider's access tokens by: its key set and their issuer. */
export type GateKeys = KeyMetadata

/** The gate's key metadata, `undefined` while it cannot be read: it never rejects. */
export type KeySource = () => Promise<GateKeys | undefined>

/** The provider's discovery at this replica: the web sign-in's half and the gate's. */
export interface ProviderDiscovery {
  readonly server: MetadataSource
  readonly keys: KeySource
}

type Document = Readonly<Record<string, unknown>>

/** A discovery's answers, or why there are none: the failure's kind, else the error's text. */
async function answersOf(
  issuer: string,
  platform: Platform,
): Promise<readonly DiscoveryAnswer[] | string> {
  try {
    return await discover(issuer, platform)
  } catch (error) {
    return `no answer (${(error as Partial<TokenFailure>).kind ?? (error as Error).message})`
  }
}

/** The document of the issuer's discovery, or why there is none. */
async function documentOf(issuer: string, platform: Platform): Promise<Document | string> {
  const answers = await answersOf(issuer, platform)
  if (typeof answers === "string") return answers
  const [first, second] = answers as [DiscoveryAnswer, DiscoveryAnswer?]
  const { url, status, json } = second ?? first
  if (status !== 200) return `${url} answered ${status}`
  return json ?? `${url} answered no JSON object`
}

/** What a half makes of the document, and what its log says while it has none. */
interface Half<T> {
  /** What the half takes from the document, or why it cannot use it. */
  check(document: Document, issuer: string): T | string
  /** Whose line it is. */
  readonly who: string
  /** What a failure before the first answer means. */
  readonly waiting: string
  /** What a failed re-read keeps. */
  readonly kept: string
}

const LOOPBACK = { isLoopback: isLocalHostname }

const SIGN_IN: Half<ServerMetadata> = {
  check(document, issuer) {
    const found = serverMetadata(document, issuer, { confidential: true, ...LOOPBACK })
    return "problem" in found ? `the document cannot be used (${found.problem})` : found
  },
  who: "Web sign-in",
  waiting: "Until it answers, a sign-in ends on the signed-out page.",
  kept: "It keeps the metadata it found last and reads again in an hour.",
}

/** Why the document gives the gate no key set, a `jwks_uri` worded by its own problem. */
function keyProblem(found: KeyMetadataProblem): string {
  switch (found.problem) {
    case "no-jwks":
      return "the document names no jwks_uri"
    case "jwks-insecure":
      return `its jwks_uri cannot be used (${found.urlProblem})`
    case "jwks-loopback":
      return "its jwks_uri is on this machine, and the issuer is not"
    default:
      return `the document cannot be used (${found.problem})`
  }
}

const GATE: Half<GateKeys> = {
  check(document, issuer) {
    const found = keyMetadata(document, issuer, LOOPBACK)
    return "problem" in found ? keyProblem(found) : found
  },
  who: "OAuth",
  waiting: "Until it answers, /mcp answers 503 (temporarily_unavailable).",
  kept: "It keeps the key set it found last and reads again in an hour.",
}

/** A document the discovery read, and when. */
interface Read {
  readonly document: Document
  readonly at: number
}

/**
 * The issuer's documents, shared by the halves: the last one read, while it is younger than an
 * hour and the asking half has not checked it yet; else a new read, one at a time. A failure is
 * kept by no one.
 */
type Documents = (checked: Read | undefined) => Promise<Read | string>

function documentsOf(issuer: string, platform: Platform): Documents {
  // Before the first read, a document no half is ever served: it was read before all time.
  let last: Read = { document: {}, at: Number.NEGATIVE_INFINITY }
  let reading: Promise<Read | string> | undefined
  const readNow = async (): Promise<Read | string> => {
    const document = await documentOf(issuer, platform)
    if (typeof document === "string") return document
    last = { document, at: platform.now() }
    return last
  }
  return (checked) => {
    if (last !== checked && platform.now() - last.at < DISCOVERY_HOLD_MS) {
      return Promise.resolve(last)
    }
    reading ??= readNow().finally(() => {
      reading = undefined
    })
    return reading
  }
}

/**
 * One half's answer, read when first asked for and again an hour after the document it came from
 * was read: a document another half read meanwhile serves it, one it checked already does not.
 */
function halfSource<T>(
  issuer: string,
  platform: Platform,
  log: (line: string) => void,
  documents: Documents,
  half: Half<T>,
): () => Promise<T | undefined> {
  let found: { readonly value: T; readonly at: number } | undefined
  let reading: Promise<T | undefined> | undefined
  let kept: T | undefined
  let checked: Read | undefined
  const failed = (why: string): string => `${half.who}: the discovery of ${issuer} failed: ${why}.`
  const readOnce = async (): Promise<T | undefined> => {
    const read = await documents(checked)
    if (typeof read !== "string") checked = read
    const result = typeof read === "string" ? read : half.check(read.document, issuer)
    if (typeof result === "string" && found !== undefined) {
      if (kept !== found.value) log(`${failed(result)} ${half.kept}`)
      kept = found.value
      found = { ...found, at: platform.now() }
      return found.value
    }
    if (typeof result === "string") {
      log(`${failed(result)} ${half.waiting}`)
      return undefined
    }
    found = { value: result, at: (read as Read).at }
    return result
  }
  return () => {
    if (found !== undefined && platform.now() - found.at < DISCOVERY_HOLD_MS) {
      return Promise.resolve(found.value)
    }
    reading ??= readOnce().finally(() => {
      reading = undefined
    })
    return reading
  }
}

/** The issuer's one discovery at this replica: both halves over the documents they share. */
export function providerDiscovery(
  issuer: string,
  platform: Platform,
  log: (line: string) => void,
): ProviderDiscovery {
  const documents = documentsOf(issuer, platform)
  return {
    server: halfSource(issuer, platform, log, documents, SIGN_IN),
    keys: halfSource(issuer, platform, log, documents, GATE),
  }
}

/** The web sign-in's half of a discovery of its own, for a provider whose gate discovers nothing. */
export function metadataSource(
  issuer: string,
  platform: Platform,
  log: (line: string) => void,
): MetadataSource {
  return providerDiscovery(issuer, platform, log).server
}
