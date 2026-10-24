export interface WorkspaceFiles {
  find(glob: string, limit: number): Promise<readonly string[]>;
  read(uri: string): Promise<string>;
}
