import type { SourceLocation, WorkspaceFiles } from '../../contract/index.js';

const MAX_SOURCES = 5000;
const COMMENT_LINE = /^\s*(?:\/\/|\/?\*)/;
const TEST_SOURCE = /\/(?:test|tests|__tests__)\/|[.-]test\.|Tests?\.\w+$/;

export class SourceSearch {
  constructor(private readonly files: WorkspaceFiles) {}

  async declaration(glob: string, pattern: RegExp): Promise<SourceLocation | undefined> {
    const [uri] = this.ranked(await this.files.find(glob, MAX_SOURCES));
    return uri === undefined
      ? undefined
      : { uri, line: this.lineOf(await this.files.read(uri), pattern) ?? 1 };
  }

  async firstLine(glob: string, pattern: RegExp): Promise<SourceLocation | undefined> {
    for (const uri of this.ranked(await this.files.find(glob, MAX_SOURCES))) {
      const line = this.lineOf(await this.files.read(uri), pattern);
      if (line !== undefined) {
        return { uri, line };
      }
    }
    return undefined;
  }

  private ranked(uris: readonly string[]): string[] {
    const rank = (uri: string) => (TEST_SOURCE.test(uri) ? 1 : 0);
    return [...uris].sort((left, right) => rank(left) - rank(right) || left.localeCompare(right));
  }

  private lineOf(text: string, pattern: RegExp): number | undefined {
    const index = text
      .split(/\r?\n/)
      .findIndex((line) => !COMMENT_LINE.test(line) && pattern.test(line));
    return index < 0 ? undefined : index + 1;
  }
}
