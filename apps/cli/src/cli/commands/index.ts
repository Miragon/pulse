/**
 * Registry of the utility commands (everything that is not a catalog group), in the order of the
 * root help. They are registered on every run, before the groups, so the root help lists them
 * under "Commands:" ahead of the "API groups:".
 */

import { apiCommand } from './api.js';
import { authCommand } from './auth.js';
import { commandsCommand } from './commands.js';
import { completionCommand } from './completion.js';
import { configCommand } from './config.js';
import { describeCommand } from './describe.js';
import { guideCommand } from './guide.js';
import { pingCommand } from './ping.js';
import type { UtilityCommand } from './types.js';

export const UTILITY_COMMANDS: readonly UtilityCommand[] = [
  commandsCommand,
  describeCommand,
  guideCommand,
  apiCommand,
  pingCommand,
  configCommand,
  authCommand,
  completionCommand,
];
