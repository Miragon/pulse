import { describe, expect, it } from "vitest"
import { classifyError, describeError, isPermanentError, type ErrorKind } from "./describe-error.js"

/** The mapping table (U1): every error text the wire carries onto one kind, status and source. */
const TABLE: Array<[raw: string, kind: ErrorKind, status: number | undefined, source: string]> = [
  [
    "[503 ProcessEngineException] Engine is shutting down (engine prod-leasing)",
    "unreachable",
    503,
    "engine:prod-leasing",
  ],
  [
    "[502] Bad Gateway — empty response body (engine billing)",
    "unreachable",
    502,
    "engine:billing",
  ],
  ["engine prod-a unreachable (ECONNREFUSED)", "unreachable", undefined, "engine:prod-a"],
  [
    "connection to engine prod-a failed (UND_ERR_SOCKET) — the POST may still have been applied",
    "unreachable",
    undefined,
    "engine:prod-a",
  ],
  // No source of its own any more: a data source the kit does not know reads as unknown.
  ["Prometheus unreachable (ENOTFOUND)", "unreachable", undefined, "unknown"],
  ["TypeError: Failed to fetch", "unreachable", undefined, "unknown"],
  [
    "engine prod-a did not respond within 30000 ms (timeout)",
    "timeout",
    undefined,
    "engine:prod-a",
  ],
  ["upstream did not respond within 10000 ms (timeout)", "timeout", undefined, "unknown"],
  ["MCP error -32001: Request timed out", "timeout", undefined, "unknown"],
  ["[504] Gateway Timeout (engine prod)", "timeout", 504, "engine:prod"],
  ["Tool engine_jobs_data not found", "notOnServer", undefined, "unknown"],
  ["MCP error -32602: Tool notes_list_data not found", "notOnServer", undefined, "unknown"],
  ["Unknown tool: engine_jobs_data", "notOnServer", undefined, "unknown"],
  [
    "[401] Unauthorized (engine prod). Check ENGINES_JSON credentials",
    "unauthorized",
    401,
    "engine:prod",
  ],
  [
    "[404 InvalidRequestException] Process instance with id x does not exist (engine prod-a)",
    "notFound",
    404,
    "engine:prod-a",
  ],
  [
    "[500 ProcessEngineException] Cannot resolve incident (engine prod-a)",
    "failed",
    500,
    "engine:prod-a",
  ],
  ["[400 InvalidRequestException] Invalid variable value", "failed", 400, "unknown"],
  [
    "[ENGINE_NOT_SELECTED] No engine specified and no default engine configured. Pass `engine`, one of: prod-a, prod-b.",
    "unknown",
    undefined,
    "engine",
  ],
  ["Something odd happened", "unknown", undefined, "unknown"],
]

function sourceTag(source: ReturnType<typeof classifyError>["source"]): string {
  if (source.type === "engine") return source.id ? `engine:${source.id}` : "engine"
  return source.type
}

describe("classifyError: the mapping table", () => {
  it.each(TABLE)("%s → %s", (raw, kind, status, source) => {
    const facts = classifyError(new Error(raw))
    expect(facts.kind).toBe(kind)
    expect(facts.status).toBe(status)
    expect(sourceTag(facts.source)).toBe(source)
    expect(facts.raw).toBe(raw)
  })

  it("reads a numeric status off the error object before the text", () => {
    const error = Object.assign(new Error("no details"), { httpStatus: 403 })
    expect(classifyError(error)).toMatchObject({ kind: "forbidden", status: 403 })
    expect(classifyError({ message: "x", status: 401 })).toMatchObject({ kind: "unauthorized" })
    // Out of range or not a number: ignored.
    expect(classifyError({ message: "x", status: 42 }).kind).toBe("unknown")
    expect(classifyError({ message: "x", status: "503" }).kind).toBe("unknown")
  })

  it("takes strings, { message } objects and anything else", () => {
    expect(classifyError("engine e unreachable (ECONNREFUSED)").kind).toBe("unreachable")
    expect(classifyError({ message: "engine e unreachable (x)" }).source).toEqual({
      type: "engine",
      id: "e",
    })
    expect(classifyError(null)).toEqual({
      kind: "unknown",
      source: { type: "unknown" },
      raw: null,
      reason: null,
      mayHaveApplied: false,
    })
    expect(classifyError(42).raw).toBeNull()
    expect(classifyError({ message: 7 }).raw).toBeNull()
    expect(classifyError(new Error("   ")).raw).toBeNull()
    expect(classifyError("  ").raw).toBeNull()
  })

  it("a missing tool wins over a status in the same text", () => {
    expect(classifyError("[404] Tool x not found").kind).toBe("notOnServer")
  })

  it("reads the source's own reason: no status code, engine suffix or write caveat", () => {
    const reason = (text: string) => classifyError(text).reason
    expect(reason("[500 ProcessEngineException] Cannot resolve incident (engine prod)")).toBe(
      "Cannot resolve incident",
    )
    // A prefix before the bracket (a transport's wrapper) goes with it.
    expect(reason("Error: [400 InvalidRequestException] Bad value. (engine p)")).toBe("Bad value.")
    expect(reason("[VALIDATION] amount must be positive")).toBe("amount must be positive")
    expect(
      reason(
        "connection to engine prod failed (UND_ERR_SOCKET) — the POST may still have been applied; check the current state before retrying",
      ),
    ).toBe("connection to engine prod failed (UND_ERR_SOCKET)")
    expect(reason("[500] (engine prod)")).toBeNull()
    expect(reason("plain words")).toBe("plain words")
  })

  it("knows a write whose answer never came may have gone through", () => {
    expect(
      classifyError(
        "engine prod did not respond within 30000 ms (timeout) — the PUT may still have been applied; check the current state before retrying",
      ).mayHaveApplied,
    ).toBe(true)
    // A read's timeout carries no caveat; an engine refusal never does.
    expect(
      classifyError("engine prod did not respond within 30000 ms (timeout)").mayHaveApplied,
    ).toBe(false)
    expect(classifyError("[500 X] boom (engine prod)").mayHaveApplied).toBe(false)
  })
})

describe("classifyError: hostile input stays linear (CodeQL js/polynomial-redos)", () => {
  const spaces = " ".repeat(100_000)

  it("reads a long whitespace run before the write caveat and the engine suffix quickly", () => {
    const started = performance.now()
    const facts = classifyError(`[500 X] boom${spaces}— the POST may still have been applied`)
    expect(facts.mayHaveApplied).toBe(true)
    expect(facts.reason).toBe("boom")
    expect(classifyError(`[500 X] boom${spaces}(engine prod)${spaces}`).reason).toBe("boom")
    expect(classifyError(`[500 X] ${spaces}x`).reason).toBe("x")
    expect(performance.now() - started).toBeLessThan(500)
  })
})

describe("describeError: the words, en and de", () => {
  const down = new Error(
    "[503 ProcessEngineException] Engine is shutting down (engine prod-leasing)",
  )

  it("never leads with the raw engine text; it stays for Details", () => {
    expect(describeError(down, "de-DE")).toEqual({
      kind: "unreachable",
      title: "Die Engine prod-leasing ist nicht erreichbar (HTTP 503)",
      hint: "Prüf, ob die Engine läuft, oder wähl eine andere Engine.",
      details: "[503 ProcessEngineException] Engine is shutting down (engine prod-leasing)",
    })
    expect(describeError(down, "en-US")).toMatchObject({
      title: "Engine prod-leasing is unreachable (HTTP 503)",
      hint: "Check that the engine is running, or pick another engine.",
    })
  })

  it.each([
    [
      "engine e did not respond within 1 ms (timeout)",
      "Die Engine e antwortet nicht rechtzeitig",
      "Versuch es gleich noch mal. Passiert das öfter, ist die Engine vielleicht stark ausgelastet.",
    ],
    [
      "upstream did not respond within 1 ms (timeout)",
      "Die Datenquelle antwortet nicht rechtzeitig",
      "Versuch es gleich noch mal.",
    ],
    [
      "Prometheus unreachable (ECONNREFUSED)",
      "Die Datenquelle ist nicht erreichbar",
      "Prüf die Verbindung und versuch es noch mal.",
    ],
    [
      "Failed to fetch",
      "Die Datenquelle ist nicht erreichbar",
      "Prüf die Verbindung und versuch es noch mal.",
    ],
    [
      "Tool x not found",
      "Diese Daten gibt es auf diesem Server nicht",
      "Das zuständige Modul ist hier nicht aktiv. Frag im Chat, was du stattdessen tun kannst.",
    ],
    [
      "[401] no (engine p)",
      "Die Engine p lehnt die Zugangsdaten des Servers ab (HTTP 401)",
      "Bitte die Person, die den Server betreibt, die Zugangsdaten zu prüfen.",
    ],
    [
      "[403] no (engine p)",
      "Die Engine p verweigert den Zugriff (HTTP 403)",
      "Dem Konto des Servers fehlt dafür die Berechtigung. Bitte die Person, die den Server betreibt, das zu prüfen.",
    ],
    [
      "[404] gone (engine p)",
      "Diesen Eintrag gibt es nicht mehr",
      "Er wurde vielleicht beendet oder gelöscht. Geh zurück zur Liste oder versuch es noch mal.",
    ],
    [
      "[500 ProcessEngineException] boom",
      "Die Engine meldet einen Fehler (HTTP 500)",
      "Den Grund findest du unter Details. Versuch es noch mal oder frag im Chat nach.",
    ],
    [
      "odd",
      "Das hat nicht geklappt",
      "Versuch es noch mal. Klappt es wieder nicht, frag im Chat nach.",
    ],
  ])("de: %s", (raw, title, hint) => {
    expect(describeError(raw, "de")).toMatchObject({ title, hint })
  })

  it.each([
    [
      "engine e did not respond within 1 ms (timeout)",
      "Engine e did not respond in time",
      "Try again in a moment. If it keeps happening, the engine may be under heavy load.",
    ],
    [
      "upstream did not respond within 1 ms (timeout)",
      "The data source did not respond in time",
      "Try again in a moment.",
    ],
    [
      "Prometheus unreachable (ECONNREFUSED)",
      "The data source is unreachable",
      "Check the connection, then try again.",
    ],
    ["Failed to fetch", "The data source is unreachable", "Check the connection, then try again."],
    [
      "Tool x not found",
      "This data isn't available on this server",
      "The module behind it isn't active here. Ask in the chat what you can do instead.",
    ],
    [
      "[401] no (engine p)",
      "Engine p rejected the server's credentials (HTTP 401)",
      "Ask whoever runs this server to check its credentials.",
    ],
    [
      "[403] no",
      "The data source denied access (HTTP 403)",
      "The server's account lacks the permission for this. Ask whoever runs the server to check it.",
    ],
    [
      "[404] gone",
      "This entry no longer exists",
      "It may have ended or been deleted. Go back to the list, or try again.",
    ],
    [
      "[500] boom (engine p)",
      "Engine p reported an error (HTTP 500)",
      "You'll find the reason under Details. Try again, or ask in the chat.",
    ],
    ["odd", "Something went wrong", "Try again. If it fails again, ask in the chat."],
  ])("en: %s", (raw, title, hint) => {
    expect(describeError(raw, "en")).toMatchObject({ title, hint })
  })

  /** The engine module's codes for an engine it does not use and a write it does not send. */
  const REFUSED =
    '[ENGINE_PROFILE_REFUSED] Engine "locked" is configured, but its profile cannot be used: auth.tokenEnv names a variable that is not set. Ask whoever runs this server to fix it.'
  const READ_ONLY =
    '[ENGINE_READ_ONLY] Engine "ro" is read-only on this server: its profile sets readOnly, so no tool writes to it. Nothing was sent.'

  it("a refused profile: names the engine and where its reason is, the code's text under Details", () => {
    expect(describeError(new Error(REFUSED), "en")).toEqual({
      kind: "profileRefused",
      title: "Engine locked cannot be used: its profile is refused",
      hint: "Whoever runs this server finds the reason in its log at startup and can fix the profile. Until then, pick another engine.",
      details: REFUSED,
    })
    expect(describeError(new Error(REFUSED), "de")).toMatchObject({
      title: "Die Engine locked ist nicht nutzbar: ihr Profil ist abgelehnt",
      hint: "Die Person, die den Server betreibt, findet den Grund im Log beim Start und kann das Profil korrigieren. Wähl bis dahin eine andere Engine.",
    })
    expect(classifyError(REFUSED)).toMatchObject({
      kind: "profileRefused",
      source: { type: "engine", id: "locked" },
      reason:
        'Engine "locked" is configured, but its profile cannot be used: auth.tokenEnv names a variable that is not set. Ask whoever runs this server to fix it.',
    })
  })

  it("a code an engine's own message quotes is no refusal: only the server leads with one", () => {
    // A script error that echoes a variable's value: retried, and Try again stays.
    for (const code of ["[ENGINE_PROFILE_REFUSED]", "[ENGINE_READ_ONLY]"]) {
      const quoted = `[500 ProcessEngineException] Script failed on value "${code} x" (engine prod)`
      expect(classifyError(quoted).kind).toBe("failed")
      expect(isPermanentError(new Error(quoted))).toBe(false)
    }
    expect(isPermanentError(new Error(REFUSED))).toBe(true)
    expect(isPermanentError(READ_ONLY)).toBe(true)
  })

  it("a read-only engine: says nothing was changed, en and de", () => {
    expect(describeError(READ_ONLY, "en")).toMatchObject({
      kind: "readOnly",
      title: "Engine ro is read-only on this server",
      hint: "Its profile allows reads only, so nothing was changed. Ask whoever runs this server if you need to change something there.",
    })
    expect(describeError(READ_ONLY, "de")).toMatchObject({
      title: "Die Engine ro ist auf diesem Server nur lesbar",
      hint: "Das Profil dieser Engine erlaubt nur Lesezugriffe, darum hat sich nichts geändert. Bitte die Person, die den Server betreibt, wenn du dort etwas ändern musst.",
    })
  })

  it("English for an unsupported or missing locale", () => {
    expect(describeError("odd", "fr-FR").title).toBe("Something went wrong")
    expect(describeError("odd", undefined).title).toBe("Something went wrong")
  })

  it("an unclassified error takes the caller's title; a classified one keeps its own", () => {
    expect(describeError("odd", "de", { fallbackTitle: "Liste nicht geladen" }).title).toBe(
      "Liste nicht geladen",
    )
    expect(describeError(down, "de", { fallbackTitle: "Liste nicht geladen" }).title).toBe(
      "Die Engine prod-leasing ist nicht erreichbar (HTTP 503)",
    )
  })

  it("has no details without a raw text", () => {
    expect(describeError(undefined, "en").details).toBeNull()
  })
})
