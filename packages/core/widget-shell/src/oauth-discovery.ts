/**
 * The one discovery of the server's own identity provider at a replica, by
 * `@miragon/pulse-http/oauth`, which takes only a document that names the issuer exactly. Two
 * halves read it, each checking the document by its own needs, so what one needs never blocks the
 * other: the web sign-in's metadata (PKCE with S256, a client authentication a confidential client
 * can do, endpoints on https or on the machine itself, there only for an issuer there) and the
 * gate's key metadata (the key set's URL by the same rules, and the issuer its access tokens
 * carry), so a provider whose clients sign in by a method the web sign-in lacks
 * (`private_key_jwt` alone) still has its tokens verified. It runs when first asked rather than at
 * boot, so a provider that does not answer leaves the server up: meanwhile a sign-in ends on the
 * signed-out page (`unavailable`) and `/mcp` answers 503. The halves share each document: one the
 * other half read within the hour serves a half that has not checked it, so one read an hour
 * serves both. What a half found holds for an hour from its document's read, and another hour
 * after each failed re-read (stale-if-error), for a day after its last good read at most: then a
 * failed re-read drops it. A half without an answer holds a failure too, 5 s where the provider
 * gave no document and a minute where the half cannot use the one it gave, so a request a
 * stranger sends (a login, any bearer token) reads the provider no more often than that. The log
 * names each failure once, again only when its reason changes or an hour has passed; the requests
 * that wait meanwhile share one read.
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

/** How long the metadata a discovery found holds, and how often the log repeats a failure. */
export const DISCOVERY_HOLD_MS = 3_600_000

/**
 * How long a half that has no answer holds a read that gave no document (no answer, a refusal, no
 * JSON): the 5 s pulse-http holds a silent provider for (`TokenFailure`'s `holdMs`).
 */
export const NO_DOCUMENT_HOLD_MS = 5_000

/** How long a half that has no answer holds a document it cannot use: a setting, no outage. */
export const UNUSABLE_HOLD_MS = 60_000

/** How long after its last good read a half keeps its answer through failed re-reads. */
export const STALE_LIMIT_MS = 86_400_000

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
  /** What a failed re-read a day after the last good one drops. */
  readonly dropped: string
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
  dropped:
    "Its last good read is a day old, so it drops the metadata it kept: until it answers, a " +
    "sign-in ends on the signed-out page.",
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
  dropped:
    "Its last good read is a day old, so it drops the key set it kept: until it answers, /mcp " +
    "answers 503 (temporarily_unavailable).",
}

/** A document the discovery read, and when. */
interface Read {
  readonly document: Document
  readonly at: number
}

/**
 * The issuer's documents, shared by the halves: the last one read, while it is younger than an
 * hour and the asking half has not checked it yet; else a new read, one at a time. A failure is
 * kept here by no one: each half holds its own.
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

/** What a half found, from the document read at `goodAt`, served without a read until `until`. */
interface Found<T> {
  readonly value: T
  readonly goodAt: number
  readonly until: number
}

/**
 * A half's log of its failures: a failure's line once, again only for another reason or an hour
 * after it said it (a failed re-read comes an hour after the last, so each one is said).
 */
function failureLog(log: (line: string) => void, now: () => number) {
  let said: { readonly why: string; readonly at: number } | undefined
  return (why: string, line: string): void => {
    if (said?.why === why && now() - said.at < DISCOVERY_HOLD_MS) return
    said = { why, at: now() }
    log(line)
  }
}

/**
 * One half's answer, read when first asked for and again an hour after the document it came from
 * was read: a document another half read meanwhile serves it, one it checked already does not. A
 * failed re-read keeps the answer another hour, for a day after its last good read; a half without
 * an answer holds its failure for a while (no document 5 s, an unusable one a minute).
 */
function halfSource<T>(
  issuer: string,
  platform: Platform,
  log: (line: string) => void,
  documents: Documents,
  half: Half<T>,
): () => Promise<T | undefined> {
  let found: Found<T> | undefined
  let failedUntil = Number.NEGATIVE_INFINITY
  let reading: Promise<T | undefined> | undefined
  let checked: Read | undefined
  const say = failureLog(log, () => platform.now())
  const failed = (why: string): string => `${half.who}: the discovery of ${issuer} failed: ${why}.`
  const failure = (why: string, holdMs: number): T | undefined => {
    const now = platform.now()
    if (found !== undefined && now - found.goodAt < STALE_LIMIT_MS) {
      say(why, `${failed(why)} ${half.kept}`)
      found = { ...found, until: now + DISCOVERY_HOLD_MS }
      return found.value
    }
    say(why, `${failed(why)} ${found === undefined ? half.waiting : half.dropped}`)
    found = undefined
    failedUntil = now + holdMs
    return undefined
  }
  const readOnce = async (): Promise<T | undefined> => {
    const read = await documents(checked)
    if (typeof read === "string") return failure(read, NO_DOCUMENT_HOLD_MS)
    checked = read
    const result = half.check(read.document, issuer)
    if (typeof result === "string") return failure(result, UNUSABLE_HOLD_MS)
    found = { value: result, goodAt: read.at, until: read.at + DISCOVERY_HOLD_MS }
    return result
  }
  return () => {
    const now = platform.now()
    if (found !== undefined && now < found.until) return Promise.resolve(found.value)
    // A failure is held only before an answer: one that is found later never comes before it.
    if (now < failedUntil) return Promise.resolve(undefined)
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
