/**
 * The engine image the connector's engine suites start (`PULSE_ENGINE_IMAGE`, Operaton 2.1.5
 * without one), by the dialect it speaks: a Camunda 7 engine of the REST family (Operaton or CIB
 * seven, by its vendor's flavor), which c7-runtime.engine.test.ts runs, or a Camunda 8 cluster
 * (`camunda/camunda`), which c8-runtime.engine.test.ts runs. Each suite skips on the other
 * dialect's image, and both fail on an image of neither, so a typo never passes as a skipped run.
 */

import type { C7Flavor } from "../../engine-provider.js"

/** The image when PULSE_ENGINE_IMAGE names none: the Camunda 7 engine CI pins first. */
export const DEFAULT_ENGINE_IMAGE = "operaton/operaton:2.1.5"

/** The dialect an image speaks, a C7 engine's flavor too. */
type ImageDialect =
  { readonly dialect: "c7"; readonly flavor: C7Flavor } | { readonly dialect: "c8" }

/** An image the suites start: its name and the dialect it speaks. */
type EngineImage = ImageDialect & { readonly name: string }

/** The repository of each image the suites start, by tag or digest. */
const IMAGES: readonly { readonly repository: RegExp; readonly image: ImageDialect }[] = [
  { repository: /^operaton\/operaton[:@]/, image: { dialect: "c7", flavor: "operaton" } },
  { repository: /^cibseven\/cibseven[:@]/, image: { dialect: "c7", flavor: "cibseven" } },
  { repository: /^camunda\/camunda[:@]/, image: { dialect: "c8" } },
]

/** The image `name` names (DEFAULT_ENGINE_IMAGE without one); throws on an image of neither dialect. */
export function engineImageOf(name: string | undefined): EngineImage {
  const image = name?.trim() || DEFAULT_ENGINE_IMAGE
  const known = IMAGES.find(({ repository }) => repository.test(image))
  if (known === undefined) {
    throw new Error(
      `PULSE_ENGINE_IMAGE names ${image}, which is neither a Camunda 7 engine the suites start ` +
        "(operaton/operaton, cibseven/cibseven) nor a Camunda 8 cluster (camunda/camunda)",
    )
  }
  return { name: image, ...known.image }
}
