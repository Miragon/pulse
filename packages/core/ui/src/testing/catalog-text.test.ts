import { describe, expect, it } from "vitest"
import { catalogTextFindings } from "./catalog-text.js"

const rules = (catalog: Record<string, unknown>, language: "de" | "en" = "de") =>
  catalogTextFindings(catalog, { language }).map((f) => `${f.key}:${f.rule}`)

describe("catalogTextFindings — the voice rules over a message catalog", () => {
  it("passes a clean catalog in both languages", () => {
    const de = {
      a: "Die Liste konnte nicht aktualisiert werden. Du siehst das vorherige Ergebnis.",
      b: ({ count }: { count: number }) => `${count} ${count === 1 ? "Incident" : "Incidents"}`,
      c: "1–2 Versuche",
      d: "—",
      e: "Sie ist erledigt.",
      f: "In CIB seven öffnen",
      g: 42,
    }
    const en = {
      a: "Open in CIB seven",
      b: "1 process",
      c: "Status: 1 class",
      d: "{count} of 1 has run",
    }
    expect(rules(de)).toEqual([])
    expect(rules(en, "en")).toEqual([])
  })

  it("flags an em dash as a connector, spaced or glued, and a spaced en dash", () => {
    expect(
      rules(
        {
          spaced: "Fehler — bitte erneut versuchen",
          glued: "Fehler—bitte",
          enSpaced: "Fehler – bitte",
          enEnd: "Fehler –",
          placeholder: " — ",
        },
        "en",
      ),
    ).toEqual([
      "spaced:dash-connector",
      "glued:dash-connector",
      "enSpaced:dash-connector",
      "enEnd:dash-connector",
    ])
  })

  it("flags KI and CIB Seven in both languages", () => {
    expect(
      rules({ ki: "KI-gestützt", ok: "Kiel", cib: "CIB Seven", caps: "CIB SEVEN" }, "en"),
    ).toEqual(["ki:ki", "cib:cib-seven", "caps:cib-seven"])
  })

  it("flags Sie/Ihr/Ihnen as address in German, mid-sentence", () => {
    expect(
      rules({
        ihnen: "Wir zeigen Ihnen die Liste.",
        ihr: "Speichere Ihre Einstellungen.",
        sie: "Möchten Sie fortfahren?",
      }),
    ).toEqual(["ihnen:formal-address", "ihr:formal-address", "sie:formal-address"])
    expect(rules({ en: "Sie Ihnen" }, "en")).toEqual([])
  })

  it("flags formal address at the start of an entry or a sentence too", () => {
    // In a UI catalog the start of an entry is exactly where address sits.
    expect(
      rules({
        expired: "Ihre Sitzung ist abgelaufen.",
        noRight: "Sie haben keine Berechtigung für diese Aktion.",
        missing: "Ihnen fehlt die Berechtigung.",
        retry: "Die Liste konnte nicht geladen werden. Sie können es erneut versuchen.",
        afterColon: "Hinweis: Sie sind abgemeldet.",
        possessive: "Ihr Team sieht das.",
        adjective: "Ihr neuer Bericht ist fertig.",
        quotedVerb: "„Sie haben“ steht da.",
      }),
    ).toEqual([
      "expired:formal-address",
      "noRight:formal-address",
      "missing:formal-address",
      "retry:formal-address",
      "afterColon:formal-address",
      "possessive:formal-address",
      "adjective:formal-address",
      "quotedVerb:formal-address",
    ])
  })

  it("leaves a sentence-initial she/it and the team's ihr alone", () => {
    expect(
      rules({
        she: "Fertig. Sie ist gespeichert.",
        modal: "Sie kann nicht geladen werden.",
        past: "Sie wurde gelöscht.",
        team: "Ihr könnt das gemeinsam ansehen.",
        teamSeid: "Ihr seid fertig.",
        quoted: "„Sie“ steht in Anführungszeichen.",
      }),
    ).toEqual([])
  })

  it("takes an allowance per key and rule, with a reason, and reports a stale one", () => {
    const catalog = {
      kept: "Die Instanz läuft weiter. Ihre Variablen bleiben erhalten.",
      clean: "Die Liste ist leer.",
    }
    const its = { key: "kept", rule: "formal-address", reason: "Ihre = the instance's" } as const
    expect(rules(catalog)).toEqual(["kept:formal-address"])
    expect(catalogTextFindings(catalog, { language: "de", allow: [its] })).toEqual([])
    expect(
      catalogTextFindings(catalog, {
        language: "de",
        allow: [its, { key: "clean", rule: "formal-address", reason: "was formal once" }],
      }),
    ).toEqual([{ key: "clean", rule: "unused-allowance", text: "formal-address: was formal once" }])
    expect(() =>
      catalogTextFindings(catalog, {
        language: "de",
        allow: [{ key: "kept", rule: "formal-address", reason: " " }],
      }),
    ).toThrow(/reason/)
  })

  it("flags an impersonal man in German only", () => {
    expect(
      rules({ man: "Hier kann man filtern.", Man: "Man sieht nichts.", ok: "Manche" }),
    ).toEqual(["man:impersonal-man", "Man:impersonal-man"])
    expect(rules({ man: "man" }, "en")).toEqual([])
  })

  it("renders function entries with 1 and 2 and flags a missing singular", () => {
    expect(
      rules(
        {
          plural: ({ count }: { count: number }) => `${count} incidents`,
          ok: ({ count }: { count: number }) => `${count} incident${count === 1 ? "" : "s"}`,
          template: "{count} engines configured",
          message: (message: string) => `Failed: ${message}`,
        },
        "en",
      ),
    ).toEqual(["plural:plural", "template:plural"])
    expect(
      rules({
        tage: "{n} Tage",
        tag: ({ n }: { n: number }) => (n === 1 ? "1 Tag" : `${n} Tage`),
        fehler: "{n} Fehler",
      }),
    ).toEqual(["tage:plural"])
  })

  it("walks nested objects with dotted keys and reports an entry it cannot render", () => {
    const nested = {
      group: { inner: "KI", deeper: { leaf: "CIB Seven" } },
      broken: (p: { list: string[] }) => p.list.join(", "),
    }
    expect(rules(nested)).toEqual([
      "group.inner:ki",
      "group.deeper.leaf:cib-seven",
      "broken:render-error",
    ])
    const withParams = catalogTextFindings(nested, {
      language: "de",
      params: { broken: { list: ["a", "b"] } },
    })
    expect(withParams.map((f) => f.key)).toEqual(["group.inner", "group.deeper.leaf"])
  })

  it("reports the rendered text of the finding", () => {
    expect(catalogTextFindings({ k: "{count} jobs" }, { language: "en" })).toEqual([
      { key: "k", rule: "plural", text: "1 jobs" },
    ])
  })
})
