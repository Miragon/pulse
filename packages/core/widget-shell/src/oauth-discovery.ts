/**
 * The identity provider's metadata for the web sign-in: discovery of the provider's issuer by
 * `@miragon/pulse-http/oauth`, which checks the issuer exactly, PKCE with S256, a client
 * authentication a confidential client can do and endpoints on https or on the machine itself.
 * It runs on the first sign-in rather than at boot, so a provider that does not answer leaves the
 * server up and sends a sign-in to the signed-out page (`unavailable`). What it found holds for an
 * hour; a failure holds for nothing, and the requests that wait meanwhile share one read.
 * What it found outlives a failed re-read by another hour (stale-if-error), said once in the log.
 */
import type { Platform } from "@miragon/pulse-http"
import {
  discover,
  serverMetadata,
  type DiscoveryAnswer,
  type ServerMetadata,
  type TokenFailure,
} from "@miragon/pulse-http/oauth"
import { isLocalHostname } from "./oauth-shared.js"

/** How long the metadata a discovery found holds. */
export const DISCOVERY_HOLD_MS = 3_600_000

/** What a failed re-read keeps, said once per metadata kept. */
const KEPT = "It keeps the metadata it found last and reads again in an hour."

/** The provider's metadata, `undefined` while it cannot be read: it never rejects. */
export type MetadataSource = () => Promise<ServerMetadata | undefined>

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

/** The metadata of the issuer's discovery, or why it cannot be used. */
async function read(issuer: string, platform: Platform): Promise<ServerMetadata | string> {
  const answers = await answersOf(issuer, platform)
  if (typeof answers === "string") return answers
  const [first, second] = answers as [DiscoveryAnswer, DiscoveryAnswer?]
  const { url, status, json } = second ?? first
  if (status !== 200) return `${url} answered ${status}`
  if (json === undefined) return `${url} answered no JSON object`
  const found = serverMetadata(json, issuer, { confidential: true, isLoopback: isLocalHostname })
  return "problem" in found ? `the document cannot be used (${found.problem})` : found
}

/** The issuer's metadata, read when first asked for and again an hour after each read. */
export function metadataSource(
  issuer: string,
  platform: Platform,
  log: (line: string) => void,
): MetadataSource {
  let found: { readonly metadata: ServerMetadata; readonly at: number } | undefined
  let reading: Promise<ServerMetadata | undefined> | undefined
  let kept: ServerMetadata | undefined
  const readOnce = async (): Promise<ServerMetadata | undefined> => {
    const result = await read(issuer, platform)
    if (typeof result === "string" && found !== undefined) {
      if (kept !== found.metadata) {
        log(`Web sign-in: the discovery of ${issuer} failed: ${result}. ${KEPT}`)
      }
      kept = found.metadata
      found = { ...found, at: platform.now() }
      return found.metadata
    }
    if (typeof result === "string") {
      log(
        `Web sign-in: the discovery of ${issuer} failed: ${result}. ` +
          "Until it answers, a sign-in ends on the signed-out page.",
      )
      return undefined
    }
    found = { metadata: result, at: platform.now() }
    return result
  }
  return () => {
    if (found !== undefined && platform.now() - found.at < DISCOVERY_HOLD_MS) {
      return Promise.resolve(found.metadata)
    }
    reading ??= readOnce().finally(() => {
      reading = undefined
    })
    return reading
  }
}
