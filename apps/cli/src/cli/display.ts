/**
 * Output settings of the commands that do not talk to the engine (`config`, `commands`,
 * `describe`): the output format rule of design §2.6 (src/cli/output-format.ts), with the profile
 * read best effort, since these commands need no configuration.
 */

import type { OutputFormat } from '../config/types.js';
import { validateOutput } from '../config/resolve.js';
import { parseFieldList } from '../output/fields.js';
import { renderValue } from '../output/render.js';
import type { CliContext } from './context.js';
import {
  envFormat,
  maxWidthOf,
  type ProfileFlags,
  profileFormat,
  terminalFormat,
} from './output-format.js';

export interface Display {
  readonly format: OutputFormat;
  readonly pretty: boolean;
  readonly maxWidth: number;
  /** `--fields` projection, if given. */
  readonly fields: readonly string[] | undefined;
}

/** The display related global options; absent ones were not given. */
export interface DisplayFlags extends ProfileFlags {
  readonly output?: string;
  readonly pretty?: boolean;
  readonly fields?: string;
}

/**
 * The value as JSON (or as a table of the `--fields`), else the readable `text` of a command that
 * has its own human format (`commands`, `describe`).
 */
export function displayText(value: unknown, display: Display, text: () => string): string {
  if (display.format === 'json' || display.fields !== undefined) return renderValue(value, display);
  return text();
}

/**
 * `-o/--output`, else OPERATE_OUTPUT, else the profile's output, else table on a terminal and JSON
 * otherwise. JSON is indented with `--pretty` or on a terminal. Records the format for errors.
 */
export async function displayOf(context: CliContext, flags: DisplayFlags): Promise<Display> {
  const { runtime } = context;
  const format =
    (flags.output === undefined ? undefined : validateOutput(flags.output)) ??
    envFormat(runtime, true) ??
    (await profileFormat(runtime, flags)) ??
    terminalFormat(runtime);
  context.state.format = format;
  return {
    format,
    pretty: flags.pretty === true || runtime.stdout.isTTY,
    maxWidth: maxWidthOf(runtime),
    fields: parseFieldList(flags.fields),
  };
}
