import { BOARD_USE_CASES } from "./board-use-cases.mjs"
import { LOCAL_SOURCES_USE_CASES } from "./local-sources-use-cases.mjs"
import { ENGINE_OVERVIEW_USE_CASES, NAVIGATION_USE_CASES } from "./navigation-use-cases.mjs"
import { READING_USE_CASES } from "./reading-use-cases.mjs"
import { MIGRATING_USE_CASES, MOVING_USE_CASES, WRITING_USE_CASES } from "./writing-use-cases.mjs"

export const USE_CASES = [
  ...READING_USE_CASES,
  ...WRITING_USE_CASES,
  ...NAVIGATION_USE_CASES,
  ...ENGINE_OVERVIEW_USE_CASES,
  ...LOCAL_SOURCES_USE_CASES,
  ...MOVING_USE_CASES,
  ...MIGRATING_USE_CASES,
  ...BOARD_USE_CASES,
]
