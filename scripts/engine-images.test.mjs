import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, it } from "node:test"
import { REPO_ROOT } from "./source-scan.mjs"

/**
 * The engines people start from this repository are the engines CI proves: every Camunda 7 engine
 * image of the starter's Compose file (mirrored to Miragon/pulse-starter), the playground's and the
 * VS Code sandbox's is the image of an Engines leg of ci.yml, where the read laws, the adapter's
 * conformance and the CLI's suites run on it. Dependabot moves the Compose files' images on its
 * own, so a bump that reaches one of them fails here until its leg joins the matrix in the same
 * change (owner decision of 2026-11-26: CIB seven is tested on 3.0, the version the starter and
 * the playground run). Images of other repositories (Keycloak) are no engines and pass.
 */

const CI_WORKFLOW = ".github/workflows/ci.yml"

/** The repositories of the Camunda 7 engines the Engines legs start. */
const ENGINE_REPOSITORIES = ["cibseven/cibseven", "operaton/operaton"]

/** Each file that starts an engine, and how it names an image. */
const STARTERS = {
  "templates/composed-server/compose.yaml": /^ +image: *(\S+) *$/gm,
  "playground/docker/docker-compose.yml": /^ +image: *(\S+) *$/gm,
  "apps/vscode/scripts/sandbox/engines.mjs": /\bimage: "([^"]+)"/g,
}

const read = (file) => readFileSync(join(REPO_ROOT, file), "utf8")

/** The images of the Engines legs, as `ci-configs.test.ts` of the C7 adapter reads them. */
function legImages(workflow) {
  return [...workflow.matchAll(/^ +- flavor: \S+\n +image: (\S+)$/gm)].map(([, image]) => image)
}

/** The engine images `text` names, Docker Hub's `docker.io/` prefix dropped. */
function engineImagesOf(text, pattern) {
  return [...text.matchAll(pattern)]
    .map(([, image]) => image.replace(/^docker\.io\//, ""))
    .filter((image) => ENGINE_REPOSITORIES.includes(image.split(/[:@]/)[0]))
}

/** The engine images of `text` that no leg starts. */
function strayImages(text, pattern, legs) {
  return engineImagesOf(text, pattern).filter((image) => !legs.includes(image))
}

describe("the engine images the repository starts", () => {
  const legs = legImages(read(CI_WORKFLOW))

  it("are read from the Engines legs of ci.yml", () => {
    assert.ok(legs.length > 0, `${CI_WORKFLOW} names no Engines leg`)
    for (const image of legs) {
      assert.ok(engineImagesOf(`  image: ${image}`, /image: (\S+)/g).length === 1, image)
    }
  })

  for (const [file, pattern] of Object.entries(STARTERS)) {
    it(`are each an Engines leg in ${file}`, () => {
      const text = read(file)
      assert.ok(engineImagesOf(text, pattern).length > 0, `${file} names no engine image`)
      assert.deepEqual(
        strayImages(text, pattern, legs),
        [],
        `${file} starts an engine no Engines leg of ${CI_WORKFLOW} tests: add its leg to the ` +
          "matrix (and the CLI's ENGINES) in the same change",
      )
    })
  }

  it("refuse a planted image no leg starts, with and without Docker Hub's prefix", () => {
    const legs = ["cibseven/cibseven:run-2.2.0"]
    const compose = "services:\n  engine:\n    image: cibseven/cibseven:run-3.1.0\n"
    assert.deepEqual(
      strayImages(compose, STARTERS["templates/composed-server/compose.yaml"], legs),
      ["cibseven/cibseven:run-3.1.0"],
    )
    const sandbox =
      'image: "docker.io/operaton/operaton:2.2.0",\nimage: "docker.io/cibseven/cibseven:run-2.2.0",'
    assert.deepEqual(
      strayImages(sandbox, STARTERS["apps/vscode/scripts/sandbox/engines.mjs"], legs),
      ["operaton/operaton:2.2.0"],
    )
    const keycloak = "    image: quay.io/keycloak/keycloak:26.8\n"
    assert.deepEqual(
      strayImages(keycloak, STARTERS["playground/docker/docker-compose.yml"], legs),
      [],
    )
  })
})
