import fc from "fast-check"
import { describe, expect, it } from "vitest"
import { MESSAGE_SIGNATURE_LENGTH, messageSignature } from "./message-signature.js"

/**
 * The cockpit's mask as 0.25.0 shipped it (engine-connector `src/data/cluster-scan.ts`), verbatim:
 * the family's mask must give the same value for every message, or the cluster links stored in
 * earlier results stop opening.
 */
function cockpitSignature025(msg: string | null): string {
  if (!msg) return ""
  return msg
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, "<id>")
    .replace(/\b[0-9a-f]{16,}\b/g, "<id>")
    .replace(/'[^']*'/g, "'<v>'")
    .replace(/"[^"]*"/g, '"<v>"')
    .replace(/\b\d+\b/g, "<n>")
    .trim()
    .slice(0, 160)
}

/** Messages shaped like an engine's: words, ids, numbers, quotes and whitespace. */
const ENGINE_MESSAGE = fc
  .array(
    fc.oneof(
      fc.string({ maxLength: 12 }),
      fc.uuid(),
      fc.stringMatching(/^[0-9a-fA-F]{14,20}$/),
      fc.nat().map(String),
      fc.constantFrom("'", '"', " ", "\n\t", "-", ":", "${x}"),
    ),
    { maxLength: 40 },
  )
  .map((parts) => parts.join(""))

describe("messageSignature", () => {
  // The values are route ids of stored cockpit cluster links: each one is pinned exactly.
  it.each([
    ["no message", null, ""],
    ["an undefined message", undefined, ""],
    ["an empty message", "", ""],
    ["case and whitespace", "  Card\n\tDeclined  ", "card declined"],
    ["a UUID, in any case", "Job 6F2B8C3E-0F4A-11EF-A1B2-0242AC120002 failed", "job <id> failed"],
    ["a hex run of 16+ characters", "token 0123456789abcdef0 rejected", "token <id> rejected"],
    ["a hex run shorter than 16 characters", "commit deadbeef", "commit deadbeef"],
    [
      "single-quoted values",
      "Unknown property 'missingBean' on 'order'",
      "unknown property '<v>' on '<v>'",
    ],
    ["double-quoted values", 'No bean named "mailer"', 'no bean named "<v>"'],
    ["whole numbers", "retried 12 times, 345 left", "retried <n> times, <n> left"],
    ["digits inside a word", "http2 error on node7", "http2 error on node7"],
    [
      "a number in a quoted value, masked as the value",
      "Amount '250' exceeds 100",
      "amount '<v>' exceeds <n>",
    ],
    [
      "the cockpit's stacktrace-sized message",
      "Unknown property used in expression: ${missingBean}. Cause: Cannot resolve identifier 'missingBean'",
      "unknown property used in expression: ${missingbean}. cause: cannot resolve identifier '<v>'",
    ],
  ])("masks %s", (_, message, signature) => {
    expect(messageSignature(message)).toBe(signature)
  })

  it(`cuts at ${MESSAGE_SIGNATURE_LENGTH} characters after masking`, () => {
    const signature = messageSignature(`${"x".repeat(200)} 42`)
    expect(signature).toBe("x".repeat(MESSAGE_SIGNATURE_LENGTH))
    expect(messageSignature(`${"y".repeat(158)} 4242`)).toBe(`${"y".repeat(158)} <`)
  })

  it("groups instance noise into one signature and keeps another cause apart", () => {
    const one = messageSignature("Timeout calling 'https://a.example/1' after 30000 ms")
    expect(messageSignature("timeout calling 'https://b.example/2' after 5000 ms")).toBe(one)
    expect(messageSignature("Connection refused calling 'https://a.example/1'")).not.toBe(one)
  })

  it("gives the value the cockpit gave, for every message", () => {
    fc.assert(
      fc.property(fc.oneof(ENGINE_MESSAGE, fc.string({ maxLength: 300 })), (message) => {
        expect(messageSignature(message)).toBe(cockpitSignature025(message))
      }),
      { numRuns: 2000 },
    )
  })

  it("is stable below the cut: an uncut signature is its own signature", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 300 }), (message) => {
        const signature = messageSignature(message)
        expect(signature.length).toBeLessThanOrEqual(MESSAGE_SIGNATURE_LENGTH)
        // the cut may end on a space the next pass trims, as the cockpit's ids always did
        if (signature.length < MESSAGE_SIGNATURE_LENGTH) {
          expect(messageSignature(signature)).toBe(signature)
        }
      }),
    )
  })
})
