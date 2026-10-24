/**
 * Runs a command line in the shell for the bearer token command (OPERATE_TOKEN_COMMAND): in the
 * working directory, stdin closed (operate never waits for input), stdout and stderr captured up
 * to 1 MiB each, killed after the timeout. A kill does not wait for grandchildren that keep the
 * pipes open.
 */

import { spawn } from 'node:child_process';
import type { CommandOptions, CommandResult } from '../runtime.js';

/** Bytes kept of each output stream. */
const MAX_OUTPUT = 1_048_576;

/** Collects the chunks of a stream up to MAX_OUTPUT bytes. */
function collector() {
  const chunks: Buffer[] = [];
  let size = 0;
  return {
    add(chunk: Buffer) {
      if (size >= MAX_OUTPUT) return;
      const kept = chunk.subarray(0, MAX_OUTPUT - size);
      chunks.push(kept);
      size += kept.length;
    },
    bytes: () => new Uint8Array(Buffer.concat(chunks)),
  };
}

export function runCommand(command: string, options: CommandOptions): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, {
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    const stdout = collector();
    const stderr = collector();
    child.stdout.on('data', (chunk: Buffer) => {
      stdout.add(chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr.add(chunk);
    });
    const result = (exitCode: number | null, timedOut: boolean): CommandResult => ({
      exitCode,
      timedOut,
      stdout: stdout.bytes(),
      stderr: stderr.bytes(),
    });
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      child.stdout.destroy();
      child.stderr.destroy();
      resolve(result(null, true));
    }, options.timeoutMs);
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve(result(code, false));
    });
  });
}
