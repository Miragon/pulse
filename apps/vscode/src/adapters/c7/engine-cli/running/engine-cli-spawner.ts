export interface EngineCliInvocation {
  readonly command: string;
  readonly args: readonly string[];
  readonly environment: Readonly<Record<string, string>>;
  readonly timeoutMs: number;
  readonly input?: string;
}

export interface EngineCliExit {
  readonly exitCode: number | null;
  readonly timedOut: boolean;
  readonly stdout: string;
  readonly stderr: string;
}

export interface EngineCliSpawner {
  spawn(invocation: EngineCliInvocation): Promise<EngineCliExit>;
}
