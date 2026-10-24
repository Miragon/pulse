import {
  StatePublisher,
  type BulkRuns,
  type LocalSources,
  type Panel,
  type PanelContext,
  type PanelEffects,
} from '../../core/index.js';
import { MessageGuards, type BackLink, type PanelState } from '../../core/protocol/index.js';
import { connectThemeBridge } from '@miragon/modeler-shell/vscode/extension';
import * as vscode from 'vscode';
import type { Connection } from '../connections/connection.js';
import type { LiveWiring } from '../live/live-wiring.js';
import { PanelTitle } from './panel-title.js';

export type SessionFactory<Session extends Panel> = (context: PanelContext) => Session;

type EffectsFactory = (connection: Connection) => PanelEffects;

export interface PanelNavigation {
  readonly effectsFor: EffectsFactory;
  readonly backOf: () => BackLink | undefined;
  readonly sources: LocalSources | undefined;
  readonly live: LiveWiring;
  readonly bulkRunsFor: (connection: Connection) => BulkRuns;
}

export const THEMES = { themes: ['light', 'dark'] } as const;

export class OpenPanel<Session extends Panel> implements vscode.Disposable {
  private current: Session;
  private readonly publish: (state: PanelState) => void;
  private readonly subscriptions: vscode.Disposable[];

  constructor(
    readonly panel: vscode.WebviewPanel,
    private connection: Connection,
    private readonly createSession: SessionFactory<Session>,
    private readonly navigation: PanelNavigation,
  ) {
    const fallbackTitle = panel.title;
    const publisher = new StatePublisher((message) => {
      panel.title = PanelTitle.of(message.state, fallbackTitle);
      const back = navigation.backOf();
      void panel.webview.postMessage(back === undefined ? message : { ...message, back });
    });
    this.publish = (state) => {
      publisher.publish(state);
    };
    this.current = createSession(this.contextFor(connection));
    this.subscriptions = [
      panel.webview.onDidReceiveMessage((message: unknown) => {
        this.receive(message);
      }),
      panel.onDidChangeViewState(() => {
        this.attend();
      }),
      navigation.live.attention.onDidChange(() => {
        this.attend();
      }),
      connectThemeBridge(vscode, panel, THEMES),
    ];
    this.attend();
  }

  get session(): Session {
    return this.current;
  }

  get engineName(): string {
    return this.connection.target.name;
  }

  rebind(connection: Connection): void {
    if (connection === this.connection) {
      return;
    }
    this.connection = connection;
    this.current.dispose();
    this.current = this.createSession(this.contextFor(connection));
    if (this.panel.visible && !connection.lane.isBlocked) {
      void this.current.handle({ type: 'ready' });
    }
    this.attend();
  }

  nudgeLocal(): void {
    if (this.connection.badge.environment === 'local') {
      this.current.nudge();
    }
  }

  dispose(): void {
    this.current.dispose();
    for (const subscription of this.subscriptions) {
      subscription.dispose();
    }
  }

  private receive(message: unknown): void {
    if (!MessageGuards.isWebviewIntent(message)) {
      return;
    }
    if (message.type === 'activity') {
      this.navigation.live.attention.noteActivity();
      return;
    }
    void this.current.handle(message);
  }

  private attend(): void {
    this.current.attend(this.navigation.live.attention.of(this.panel.visible));
  }

  private contextFor(connection: Connection): PanelContext {
    return {
      runtime: connection.runtime,
      engine: connection.badge,
      diagrams: connection.diagrams,
      definitions: connection.definitions,
      effects: this.navigation.effectsFor(connection),
      publish: this.publish,
      now: () => new Date(),
      wait: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
      ...(connection.commands === undefined ? {} : { commands: connection.commands }),
      ...(this.navigation.sources === undefined ? {} : { sources: this.navigation.sources }),
      live: this.navigation.live.contextFor(connection),
      bulkRuns: this.navigation.bulkRunsFor(connection),
    };
  }
}
