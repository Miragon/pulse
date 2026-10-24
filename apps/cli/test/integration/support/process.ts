/** Runs child processes with a clean environment and captures their output. */

import { spawn } from 'node:child_process';

export type EnvOverrides = Readonly<Record<string, string | undefined>>;

export interface ProcessOptions {
  readonly cwd?: string;
  /** Complete environment of the child process. Defaults to {@link cleanEnv}. */
  readonly env?: NodeJS.ProcessEnv;
  /** Written to stdin, which is then closed. Without it stdin is closed immediately. */
  readonly stdin?: string | Uint8Array;
  readonly timeoutMs?: number;
}

export interface ProcessResult {
  /** Command line, for diagnostics. */
  readonly command: string;
  readonly code: number;
  readonly stdout: string;
  readonly stdoutBytes: Uint8Array;
  readonly stderr: string;
}

const DEFAULT_TIMEOUT_MS = 120_000;
const OPERATE_PREFIX = 'OPERATE_';

/**
 * The parent environment without any `OPERATE_*` variable, then `overrides` applied
 * (an `undefined` value removes the variable).
 */
export function cleanEnv(overrides: EnvOverrides = {}): NodeJS.ProcessEnv {
  const inherited = Object.entries(process.env).filter(
    ([name]) => !name.startsWith(OPERATE_PREFIX),
  );
  // later entries win, so overrides replace inherited values
  const merged = Object.fromEntries([...inherited, ...Object.entries(overrides)]);
  return Object.fromEntries(Object.entries(merged).filter(([, value]) => value !== undefined));
}

function quoteForShell(arg: string): string {
  return /[\s"]/.test(arg) ? `"${arg.replaceAll('"', '\\"')}"` : arg;
}

/** Windows can only start `.cmd` shims (npm, installed bins) through a shell. */
function needsShell(file: string): boolean {
  return process.platform === 'win32' && /\.(cmd|bat)$/i.test(file);
}

/** A child process that is still running: its stderr can be watched while it runs. */
export interface RunningProcess {
  /** Command line, for diagnostics. */
  readonly command: string;
  /** Everything the process wrote to stderr so far. */
  stderr(): string;
  /**
   * Resolves with the first match of `pattern` in stderr, as soon as it arrives; rejects when the
   * process ends without writing it.
   */
  waitForStderr(pattern: RegExp): Promise<RegExpExecArray>;
  /** Exit code and output; rejects on timeout, a start failure or termination by a signal. */
  readonly result: Promise<ProcessResult>;
  /** Kills the process (SIGKILL); `result` then rejects. */
  kill(): void;
}

interface StderrWaiter {
  readonly pattern: RegExp;
  resolve(match: RegExpExecArray): void;
  reject(error: Error): void;
}

/** Starts a child process with piped stdio; stdin gets `options.stdin` and is closed. */
export function startProcess(
  file: string,
  args: readonly string[],
  options: ProcessOptions = {},
): RunningProcess {
  const shell = needsShell(file);
  const command = [file, ...args].map(quoteForShell).join(' ');
  const child = spawn(shell ? quoteForShell(file) : file, shell ? args.map(quoteForShell) : args, {
    cwd: options.cwd,
    env: options.env ?? cleanEnv(),
    shell,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  let waiters: StderrWaiter[] = [];
  let closed = false;
  const stderrText = () => Buffer.concat(stderr).toString('utf8');
  const failWaiters = () => {
    closed = true;
    for (const waiter of waiters) {
      waiter.reject(new Error(`${command} ended without the expected output\n${stderrText()}`));
    }
    waiters = [];
  };
  const settleWaiters = () => {
    const text = stderrText();
    waiters = waiters.filter((waiter) => {
      const match = waiter.pattern.exec(text);
      if (match !== null) waiter.resolve(match);
      return match === null;
    });
  };
  child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
  child.stderr.on('data', (chunk: Buffer) => {
    stderr.push(chunk);
    settleWaiters();
  });
  // The child may exit without reading stdin; that is not an error of the test harness.
  child.stdin.on('error', () => undefined);
  child.stdin.end(options.stdin ?? '');
  const result = new Promise<ProcessResult>((resolve, reject) => {
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`Timed out after ${timeoutMs} ms: ${command}\nstderr: ${stderrText()}`));
    }, timeoutMs);
    child.on('error', (error) => {
      clearTimeout(timer);
      failWaiters();
      reject(new Error(`Cannot start ${command}: ${error.message}`, { cause: error }));
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      settleWaiters();
      failWaiters();
      const out = Buffer.concat(stdout);
      if (code === null) {
        reject(new Error(`${command} was terminated by ${signal ?? 'a signal'}`));
        return;
      }
      resolve({
        command,
        code,
        stdout: out.toString('utf8'),
        stdoutBytes: new Uint8Array(out),
        stderr: stderrText(),
      });
    });
  });
  // A process that a failed test leaves behind is killed later; that is no unhandled rejection.
  result.catch(() => undefined);
  return {
    command,
    stderr: stderrText,
    waitForStderr: (wanted) =>
      new Promise((resolve, reject) => {
        // without g/y, exec keeps no lastIndex state between the checks
        const pattern = new RegExp(wanted.source, wanted.flags.replace(/[gy]/g, ''));
        const match = pattern.exec(stderrText());
        if (match !== null) resolve(match);
        else if (closed) reject(new Error(`${command} ended without the expected output`));
        else waiters.push({ pattern, resolve, reject });
      }),
    result,
    kill: () => {
      child.kill('SIGKILL');
    },
  };
}

export function runProcess(
  file: string,
  args: readonly string[],
  options: ProcessOptions = {},
): Promise<ProcessResult> {
  return startProcess(file, args, options).result;
}

/** Multi-line description of a finished process, used as assertion message. */
export function describeResult(result: ProcessResult): string {
  const clip = (text: string) => (text.length > 2000 ? `${text.slice(0, 2000)}…` : text);
  return [
    `$ ${result.command}`,
    `exit code: ${result.code}`,
    `stdout: ${clip(result.stdout)}`,
    `stderr: ${clip(result.stderr)}`,
  ].join('\n');
}
