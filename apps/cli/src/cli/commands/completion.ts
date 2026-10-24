/**
 * `operate completion <bash|zsh|fish>` (design §17.10): prints the completion script of a shell.
 * The scripts call the hidden `operate __complete <words>` (src/cli/completion-model.ts), which
 * answers from the command definitions alone, without network or stdin.
 */

import {
  COMPLETION_SCRIPTS,
  INSTALL_LINES,
  type Shell,
  SHELLS,
} from '../../docs/completion-scripts.js';
import { usageError } from '../../errors.js';
import { subcommand } from '../command.js';
import { setPositional } from '../completion-meta.js';
import type { UtilityCommand } from './types.js';

const DESCRIPTION = [
  'Print the shell completion script for bash, zsh or fish. It completes commands, groups, options and their fixed values (enums, output formats, profile names, files) without contacting the engine.',
  '',
  'Install:',
  ...INSTALL_LINES.map((line) => `  ${line}`),
].join('\n');

function isShell(value: string | undefined): value is Shell {
  return SHELLS.some((shell) => shell === value);
}

export const completionCommand: UtilityCommand = {
  name: 'completion',
  nested: false,
  register(program, context) {
    const command = subcommand(program, 'completion')
      .summary('Print the shell completion script for bash, zsh or fish')
      .description(DESCRIPTION)
      .usage('<bash|zsh|fish>')
      .argument('[shell]', `Shell: ${SHELLS.join(', ')}`);
    setPositional(command, { kind: 'values', values: SHELLS });
    command.action((shell: string | undefined) => {
      if (!isShell(shell)) {
        throw usageError(
          shell === undefined ? 'Missing shell' : `Unknown shell "${shell}"`,
          `Pass one of ${SHELLS.join(', ')}, e.g. operate completion bash.`,
        );
      }
      context.runtime.stdout.write(COMPLETION_SCRIPTS[shell]);
    });
  },
};
