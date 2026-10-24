import type { WorkspaceFiles } from '../../../src/contract/index.js';

export class MemoryFiles implements WorkspaceFiles {
  readonly globs: string[] = [];

  constructor(private readonly files: Readonly<Record<string, string>>) {}

  find(glob: string, limit: number): Promise<readonly string[]> {
    this.globs.push(glob);
    const pattern = MemoryFiles.patternOf(glob);
    return Promise.resolve(
      Object.keys(this.files)
        .filter((uri) => pattern.test(uri))
        .slice(0, limit),
    );
  }

  read(uri: string): Promise<string> {
    const text = this.files[uri];
    return text === undefined ? Promise.reject(new Error(`no ${uri}`)) : Promise.resolve(text);
  }

  private static patternOf(glob: string): RegExp {
    const source = glob
      .replace(/[.+^$()|[\]\\]/g, '\\$&')
      .replace(/\{([^}]*)\}/g, (_, options: string) => `(?:${options.split(',').join('|')})`)
      .replace(/\*\*\//g, '(?:.*/)?')
      .replace(/(?<!\.)\*/g, '[^/]*');
    return new RegExp(`^file:///workspace/${source}$`);
  }
}
