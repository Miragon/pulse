/// <reference types="node" />
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  EQUAL_FIX,
  fixtureRepo,
  manifestOf,
  type FixtureRepo,
} from "./vendored-token-fixtures.test-support.js"
import { scopedTokens } from "./vendored-tokens.test-support.js"

/**
 * Token equality, the rule of the drift guard (`token-drift.test.ts`) that
 * spans the vendored copies: a `--cd-*` two sanctioned copies declare in the
 * same scope has one value in both, so a CI release reaches every copy in one
 * re-vendor. Over fixture repos (`vendored-token-fixtures.test-support.ts`).
 */

const PALETTE = new Map([
  ["--cd-blau", "#335DE5"],
  ["--cd-gruen", "#00E676"],
])

let repo: FixtureRepo

beforeEach(() => {
  repo = fixtureRepo(PALETTE)
})

afterEach(() => {
  repo.remove()
})

/** Shaped like the App and web variant: light and system grouped, the dark theme in a media block. */
const APP_TOKENS = `:root {
  --cd-blau: #335DE5;
  --cd-gruen: #00E676;
  --cd-ui-grund: #FFFFFF;
}
[data-cd-theme="light"],
[data-cd-theme="system"] {
  --cd-ui-grund: #F9F7F7;
}
@media screen {
  [data-cd-theme="dark"] {
    --cd-ui-grund: #1D1D1D;
  }
}
`

/** Shaped like the docs kit's token file: the dark theme also under `html.dark`. */
const kitTokens = ({ light = "#F9F7F7", dark = "#1D1D1D" } = {}) => `:root {
  --cd-blau: #335DE5;
  --cd-gruen: #00E676;
  --cd-ui-grund: #FFFFFF;
}
@media screen {
  html.dark,
  [data-cd-theme="dark"] {
    --cd-ui-grund: ${dark};
  }
}
[data-cd-theme="light"] {
  --cd-ui-grund: ${light};
}
`

const APP_COPY = {
  "app/vscode/theme/cd-tokens.generated.css": APP_TOKENS,
  "app/vscode/theme/manifest.json": manifestOf({
    "app/vscode/theme/cd-tokens.generated.css": APP_TOKENS,
  }),
}

const kitCopy = (css: string) => ({
  "app/kit/theme/cd-tokens.generated.css": css,
  "app/kit/manifest.json": manifestOf({ "app/kit/theme/cd-tokens.generated.css": css }),
})

const bothManifests = () =>
  repo.findings(["app/vscode/theme/manifest.json", "app/kit/manifest.json"])

const differs = (scope: string, app: string, kit: string) =>
  `--cd-ui-grund in ${scope} differs between the vendored copies (${app} in app/vscode/theme/cd-tokens.generated.css; ${kit} in app/kit/theme/cd-tokens.generated.css): ${EQUAL_FIX}`

describe("vendoredTokenFindings: token equality over every sanctioned copy", () => {
  it("two copies that declare a token in the same scope give it one value, in :root, the light and the dark theme", () => {
    repo.write({ ...APP_COPY, ...kitCopy(kitTokens()) })
    expect(bothManifests()).toEqual([])
  })

  it("a copy whose dark or light theme drifts fails, naming every value and the copies that say it", () => {
    repo.write({ ...APP_COPY, ...kitCopy(kitTokens({ dark: "#6B6666", light: "#E6E2E2" })) })
    expect(bothManifests()).toEqual([
      differs('[data-cd-theme="light"]', "#F9F7F7", "#E6E2E2"),
      differs('@media screen { [data-cd-theme="dark"] }', "#1D1D1D", "#6B6666"),
    ])
  })

  it("a role token outside the palette is held to the other copies in :root too", () => {
    const kit = kitTokens().replace("--cd-ui-grund: #FFFFFF", "--cd-ui-grund: #E6E2E2")
    repo.write({ ...APP_COPY, ...kitCopy(kit) })
    expect(bothManifests()).toEqual([differs(":root", "#FFFFFF", "#E6E2E2")])
  })

  it("a copy that lost its sanction has no say: its edit is reported as an edit and a fork, never as a difference", () => {
    repo.write({ ...APP_COPY, ...kitCopy(kitTokens()) })
    repo.write({ "app/kit/theme/cd-tokens.generated.css": kitTokens({ dark: "#6B6666" }) })
    expect(bothManifests()).toEqual([
      expect.stringMatching(/^app\/kit\/theme\/cd-tokens\.generated\.css: differs from/),
      expect.stringMatching(/^app\/kit\/theme\/cd-tokens\.generated\.css: declares --cd-\*/),
    ])
  })
})

describe("scopedTokens", () => {
  it("reads every --cd-* declaration by the selector it applies to and the at-rules around it", () => {
    const css = `@charset "UTF-8";
--cd-stray: #1D1D1D;
/* :root { --cd-kommentar: #1D1D1D; } */
:root {
  --cd-blau: #335DE5;
  color: black;
  --cd-gradient: linear-gradient(
    120deg,
    #335DE5 30%
  );
}
[data-cd-theme="light"],
[data-cd-theme="system"] { --cd-ui-text: #1D1D1D; }
:is(.a, .b), [data-x="a,b"] { --cd-list: #6B6666 }
@media screen {
  html.dark,
  [data-cd-theme="dark"] { --cd-ui-text: #FFFFFF; }
}
@media screen and (prefers-color-scheme: dark) {
  @supports (color: red) { [data-cd-theme="system"] { --cd-ui-text: #F9F7F7; } }
}
:root { --cd-blau: #2B50D4; }
`
    const scopes = [...scopedTokens(css)].map(([scope, tokens]) => [
      scope,
      Object.fromEntries(tokens),
    ])
    expect(Object.fromEntries(scopes)).toEqual({
      ":root": {
        "--cd-blau": "#2B50D4",
        "--cd-gradient": "linear-gradient( 120deg, #335DE5 30% )",
      },
      '[data-cd-theme="light"]': { "--cd-ui-text": "#1D1D1D" },
      '[data-cd-theme="system"]': { "--cd-ui-text": "#1D1D1D" },
      ":is(.a, .b)": { "--cd-list": "#6B6666" },
      '[data-x="a,b"]': { "--cd-list": "#6B6666" },
      "@media screen { html.dark }": { "--cd-ui-text": "#FFFFFF" },
      '@media screen { [data-cd-theme="dark"] }': { "--cd-ui-text": "#FFFFFF" },
      '@media screen and (prefers-color-scheme: dark) { @supports (color: red) { [data-cd-theme="system"] } }':
        { "--cd-ui-text": "#F9F7F7" },
    })
  })

  it("survives a stray closing brace and yields nothing without a declaration", () => {
    expect(Object.fromEntries(scopedTokens("} .a { --cd-blau: #335DE5; }"))).toEqual({
      ".a": new Map([["--cd-blau", "#335DE5"]]),
    })
    expect(scopedTokens(".a { color: black; }").size).toBe(0)
  })
})
