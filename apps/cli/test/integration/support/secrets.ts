/**
 * Everything secret the OAuth tests have seen: the tokens the CLI stored (collected from the cache
 * files after every run, rotated ones included), authorization codes, the client secret and the
 * Base64 client credentials. No CLI output may contain any of them; the only exception is the
 * Bearer access token in runs with `--show-secrets` (dry-run and trace, design §16.8).
 */

import { expect } from 'vitest';
import type { CliResult } from './cli.js';
import { storedTokens } from './token-cache.js';

export class SecretLedger {
  readonly #tokenDirectory: string;
  readonly #accessTokens = new Set<string>();
  readonly #others = new Set<string>();

  constructor(tokenDirectory: string) {
    this.#tokenDirectory = tokenDirectory;
  }

  /** Records secrets that are not in the cache (codes, client secrets, replaced tokens). */
  add(...secrets: readonly (string | null | undefined)[]): void {
    for (const secret of secrets) {
      if (secret !== null && secret !== undefined && secret !== '') this.#others.add(secret);
    }
  }

  /** Reads every cache file and records its tokens. */
  async collect(): Promise<void> {
    const { accessTokens, refreshTokens } = await storedTokens(this.#tokenDirectory);
    for (const token of accessTokens) this.#accessTokens.add(token);
    this.add(...refreshTokens);
  }

  /**
   * Collects the tokens the run may have stored, then asserts that its stdout and stderr contain
   * no secret; `revealsAccessTokens` allows access tokens (a run with `--show-secrets`).
   */
  async expectHidden(result: CliResult, revealsAccessTokens = false): Promise<void> {
    await this.collect();
    const secrets = [...this.#others, ...(revealsAccessTokens ? [] : this.#accessTokens)];
    for (const secret of secrets) {
      expect(result.stdout.includes(secret), `stdout reveals a secret\n${result.command}`).toBe(
        false,
      );
      expect(result.stderr.includes(secret), `stderr reveals a secret\n${result.command}`).toBe(
        false,
      );
    }
  }
}
