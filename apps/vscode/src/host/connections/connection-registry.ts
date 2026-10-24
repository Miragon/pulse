import * as vscode from 'vscode';
import type { Connection } from './connection.js';
import type { ConnectionBuilder } from './connection-builder.js';
import type { CredentialStore } from './credential-store.js';
import { EngineLanes } from './engine-lanes.js';
import { LivePolicy } from './live-policy.js';
import { EnvironmentClassifier } from './environment-classifier.js';
import { PulseSettings } from './pulse-settings.js';
import { TargetDiscovery } from './target-discovery.js';
import type { TargetsProblem } from './targets-problem.js';

const ACTIVE_KEY = 'pulse.activeEngine';

export class ConnectionRegistry implements vscode.Disposable {
  private connections: readonly Connection[] = [];
  private problems: readonly TargetsProblem[] = [];
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChange = this.changed.event;
  private readonly written = new vscode.EventEmitter<void>();
  readonly onDidWrite = this.written.event;
  private readonly lanes = new EngineLanes();

  constructor(
    private readonly state: vscode.Memento,
    private readonly credentials: CredentialStore,
    private readonly builder: ConnectionBuilder,
  ) {}

  async reload(): Promise<void> {
    const discovered = await TargetDiscovery.discover();
    const environments = PulseSettings.environments();
    const writes = PulseSettings.writes();
    const requests = await Promise.all(
      discovered.targets.map(async (target) => ({
        target,
        credentials: await this.credentials.read(target),
      })),
    );
    const live = PulseSettings.liveUpdates();
    this.connections = this.lanes
      .assign(requests)
      .map(({ target, credentials, lane }) =>
        this.builder.build(
          target,
          credentials,
          EnvironmentClassifier.classify(target, environments),
          { writes, live, lane },
        ),
      );
    this.problems = discovered.problems;
    this.changed.fire();
  }

  applyLiveSettings(): void {
    const live = PulseSettings.liveUpdates();
    for (const connection of this.connections) {
      connection.live.set(LivePolicy.settingFor(connection.badge.environment, live));
    }
  }

  all(): readonly Connection[] {
    return this.connections;
  }

  configurationProblems(): readonly TargetsProblem[] {
    return this.problems;
  }

  byName(name: string): Connection | undefined {
    return this.connections.find((connection) => connection.target.name === name);
  }

  active(): Connection | undefined {
    const name = this.state.get<string>(ACTIVE_KEY);
    return (name === undefined ? undefined : this.byName(name)) ?? this.connections[0];
  }

  noteWrite(): void {
    for (const connection of this.connections) {
      connection.definitions.forget();
    }
    this.written.fire();
  }

  async activate(name: string): Promise<void> {
    await this.state.update(ACTIVE_KEY, name);
    this.changed.fire();
  }

  dispose(): void {
    this.changed.dispose();
    this.written.dispose();
  }
}
