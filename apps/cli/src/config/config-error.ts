/** The CONFIG error (exit code 3) of every configuration problem. */

import { OperateError } from '../errors.js';

export function configError(message: string, hint?: string): OperateError {
  return new OperateError('CONFIG', message, hint === undefined ? {} : { hint });
}
