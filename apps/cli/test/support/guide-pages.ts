/**
 * The pages of the agent guide for the docs tests, as [name, markdown]: the core guide of
 * `pulse-cli guide` and every topic of `pulse-cli guide <topic>`, in index order.
 */

import { GUIDE, GUIDE_TOPICS } from "../../src/docs/guide.js"

export const GUIDE_PAGES: readonly (readonly [string, string])[] = [
  ["core", GUIDE],
  ...GUIDE_TOPICS.map((topic) => [topic.name, topic.text] as const),
]
