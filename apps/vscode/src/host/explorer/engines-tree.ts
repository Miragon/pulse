import { DefinitionNodes, Problems, type DefinitionNode } from '../../core/index.js';
import * as vscode from 'vscode';
import { COMMAND } from '../commands/command-ids.js';
import type { Connection } from '../connections/connection.js';
import type { ConnectionRegistry } from '../connections/connection-registry.js';
import type { TargetsProblem } from '../connections/targets-problem.js';
import type { PanelFocus } from '../panels/panel-manager.js';
import type { LiveTree } from './engines-tree-live.js';
import { IncidentDecorations } from './incident-decorations.js';

export type EnginesTreeNode =
  | { readonly kind: 'targetsProblem'; readonly problem: TargetsProblem }
  | { readonly kind: 'engine'; readonly connection: Connection }
  | { readonly kind: 'definition'; readonly connection: Connection; readonly node: DefinitionNode }
  | { readonly kind: 'message'; readonly text: string; readonly detail: string };

type EngineNode = Extract<EnginesTreeNode, { kind: 'engine' }>;
type DefinitionTreeNode = Extract<EnginesTreeNode, { kind: 'definition' }>;

const ENVIRONMENT_LABELS = {
  local: 'LOCAL',
  test: 'TEST',
  production: 'PROD',
  unclassified: '',
} as const;

export class EnginesTree
  implements vscode.TreeDataProvider<EnginesTreeNode>, LiveTree, vscode.Disposable
{
  private readonly changed = new vscode.EventEmitter<EnginesTreeNode | undefined>();
  readonly onDidChangeTreeData = this.changed.event;
  private readonly view: vscode.TreeView<EnginesTreeNode>;
  private readonly subscription: vscode.Disposable;
  private readonly productsByEndpoint = new Map<string, string>();
  private readonly engineNodes = new WeakMap<Connection, EngineNode>();
  private readonly expanded = new Set<string>();

  constructor(private readonly registry: ConnectionRegistry) {
    this.view = vscode.window.createTreeView('pulse.engines', { treeDataProvider: this });
    this.subscription = vscode.Disposable.from(
      this.view,
      registry.onDidChange(() => {
        this.refresh();
      }),
      registry.onDidWrite(() => {
        this.refresh();
      }),
      this.view.onDidCollapseElement((event) => {
        if (event.element.kind === 'engine') {
          this.expanded.delete(event.element.connection.target.name);
        }
      }),
    );
  }

  get visible(): boolean {
    return this.view.visible;
  }

  get onDidChangeVisibility(): vscode.Event<unknown> {
    return this.view.onDidChangeVisibility;
  }

  refresh(): void {
    this.changed.fire(undefined);
  }

  isExpanded(connection: Connection): boolean {
    return this.expanded.has(connection.target.name);
  }

  refreshEngine(connection: Connection): void {
    this.changed.fire(this.engineNode(connection));
  }

  getTreeItem(element: EnginesTreeNode): vscode.TreeItem {
    switch (element.kind) {
      case 'targetsProblem':
        return this.problemItem(element.problem);
      case 'engine':
        return this.engineItem(element.connection);
      case 'definition':
        return this.definitionItem(element.connection, element.node);
      case 'message':
        return this.messageItem(element.text, element.detail);
    }
  }

  async getChildren(element?: EnginesTreeNode): Promise<EnginesTreeNode[]> {
    if (element === undefined) {
      return [
        ...this.registry
          .configurationProblems()
          .map((problem): EnginesTreeNode => ({ kind: 'targetsProblem', problem })),
        ...this.registry.all().map((connection) => this.engineNode(connection)),
      ];
    }
    if (element.kind !== 'engine') {
      return [];
    }
    this.expanded.add(element.connection.target.name);
    void this.learnProduct(element.connection);
    return this.definitionsOf(element.connection);
  }

  getParent(element: EnginesTreeNode): EnginesTreeNode | undefined {
    return element.kind === 'definition' ? this.engineNode(element.connection) : undefined;
  }

  async reveal(focus: PanelFocus): Promise<void> {
    const connection = this.registry.byName(focus.engineName);
    if (!this.view.visible || connection === undefined) {
      return;
    }
    const node =
      focus.bpmnProcessId === undefined
        ? this.engineNode(connection)
        : await this.definitionNode(connection, focus.bpmnProcessId);
    if (node !== undefined) {
      await this.view.reveal(node, { select: true, focus: false });
    }
  }

  dispose(): void {
    this.subscription.dispose();
    this.changed.dispose();
  }

  private problemItem(problem: TargetsProblem): vscode.TreeItem {
    const item = new vscode.TreeItem(problem.label(), vscode.TreeItemCollapsibleState.None);
    item.iconPath = new vscode.ThemeIcon(
      'error',
      new vscode.ThemeColor('problemsErrorIcon.foreground'),
    );
    item.tooltip = problem.detail();
    item.accessibilityInformation = { label: `Error: ${problem.detail()}` };
    item.command = {
      command: COMMAND.openTargetsFile,
      title: 'Open the Targets File',
      arguments: [problem.path],
    };
    return item;
  }

  private engineItem(connection: Connection): vscode.TreeItem {
    const isActive = connection === this.registry.active();
    const item = new vscode.TreeItem(
      connection.target.name,
      isActive
        ? vscode.TreeItemCollapsibleState.Expanded
        : vscode.TreeItemCollapsibleState.Collapsed,
    );
    const environment = ENVIRONMENT_LABELS[connection.badge.environment];
    const product = this.productsByEndpoint.get(connection.target.endpoint);
    item.description = [environment, product ?? connection.badge.host].filter(Boolean).join(' · ');
    item.id = `engine|${connection.target.name}`;
    item.iconPath = new vscode.ThemeIcon(isActive ? 'vm-active' : 'server-environment');
    item.contextValue = 'pulse.engine';
    item.resourceUri = IncidentDecorations.engineUri(
      connection.target.name,
      connection.badge.environment === 'production',
    );
    const access = connection.commands === undefined ? 'read-only' : 'writable';
    item.tooltip = `${connection.target.name} · ${connection.target.endpoint} · ${access}`;
    item.accessibilityInformation = {
      label: `${connection.target.name}, ${item.description}, ${access} engine`,
    };
    item.command = {
      command: COMMAND.openEngineOverview,
      title: 'Open Engine Overview',
      arguments: [connection.target.name],
    };
    return item;
  }

  private definitionItem(connection: Connection, node: DefinitionNode): vscode.TreeItem {
    const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.None);
    item.id = `definition|${connection.target.name}|${node.bpmnProcessId}`;
    item.description = node.description;
    item.iconPath = new vscode.ThemeIcon('type-hierarchy-sub');
    item.resourceUri = IncidentDecorations.definitionUri(
      connection.target.name,
      node.bpmnProcessId,
      node.withIncident,
    );
    item.tooltip = `${node.bpmnProcessId} · ${node.description}`;
    item.accessibilityInformation = {
      label: `${node.label}, ${node.description}, ${node.withIncident} with incident`,
    };
    item.contextValue = 'pulse.definition';
    item.command = {
      command: COMMAND.openDefinition,
      title: 'Open Process Definition',
      arguments: [connection.target.name, node.bpmnProcessId],
    };
    return item;
  }

  private messageItem(text: string, detail: string): vscode.TreeItem {
    const item = new vscode.TreeItem(text, vscode.TreeItemCollapsibleState.None);
    item.iconPath = new vscode.ThemeIcon('debug-disconnect');
    item.tooltip = detail;
    item.description = detail;
    item.accessibilityInformation = { label: [text, detail].filter(Boolean).join(' ') };
    return item;
  }

  private engineNode(connection: Connection): EngineNode {
    const known = this.engineNodes.get(connection);
    if (known !== undefined) {
      return known;
    }
    const node: EngineNode = { kind: 'engine', connection };
    this.engineNodes.set(connection, node);
    return node;
  }

  private async definitionNode(
    connection: Connection,
    bpmnProcessId: string,
  ): Promise<DefinitionTreeNode | undefined> {
    const nodes = await this.definitionsOf(connection);
    return nodes.find(
      (node): node is DefinitionTreeNode =>
        node.kind === 'definition' && node.node.bpmnProcessId === bpmnProcessId,
    );
  }

  private async learnProduct(connection: Connection): Promise<void> {
    const endpoint = connection.target.endpoint;
    if (this.productsByEndpoint.has(endpoint)) {
      return;
    }
    const engine = await connection.runtime.describeEngine().catch(() => undefined);
    if (engine === undefined) {
      return;
    }
    this.productsByEndpoint.set(endpoint, `${engine.product} ${engine.version}`);
    for (const current of this.registry.all()) {
      if (current.target.endpoint === endpoint) {
        this.changed.fire(this.engineNode(current));
      }
    }
  }

  private async definitionsOf(connection: Connection): Promise<EnginesTreeNode[]> {
    try {
      const nodes = await new DefinitionNodes(connection.definitions).list();
      if (nodes.length === 0) {
        return [{ kind: 'message', text: 'No process definitions deployed', detail: '' }];
      }
      return nodes.map((node) => ({ kind: 'definition', connection, node }));
    } catch (error) {
      const problem = Problems.of(error, connection.badge);
      return [{ kind: 'message', text: problem.title, detail: problem.detail }];
    }
  }
}
