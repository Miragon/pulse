interface Disposable {
  dispose(): unknown
}

export class EventEmitter<T> {
  private listeners: ((value: T) => void)[] = []

  readonly event = (listener: (value: T) => void): Disposable => {
    this.listeners.push(listener)
    return {
      dispose: () => {
        this.listeners = this.listeners.filter((known) => known !== listener)
      },
    }
  }

  fire(value: T): void {
    for (const listener of [...this.listeners]) {
      listener(value)
    }
  }

  dispose(): void {
    this.listeners = []
  }
}

export const Disposable = {
  from: (...parts: Disposable[]): Disposable => ({
    dispose: () => {
      for (const part of parts) {
        part.dispose()
      }
    },
  }),
}

export enum TreeItemCollapsibleState {
  None = 0,
  Collapsed = 1,
  Expanded = 2,
}

export class TreeItem {
  constructor(
    readonly label: string,
    readonly collapsibleState?: TreeItemCollapsibleState,
  ) {}
}

export class ThemeColor {
  constructor(readonly id: string) {}
}

export class ThemeIcon {
  constructor(
    readonly id: string,
    readonly color?: ThemeColor,
  ) {}
}

export const Uri = {
  from: (components: object): object => components,
}

export class FakeTreeView {
  visible = true
  readonly revealed: { readonly element: unknown; readonly options: unknown }[] = []
  readonly collapsed = new EventEmitter<{ readonly element: unknown }>()
  readonly visibility = new EventEmitter<unknown>()
  readonly onDidCollapseElement = this.collapsed.event
  readonly onDidChangeVisibility = this.visibility.event

  reveal(element: unknown, options: unknown): Promise<void> {
    this.revealed.push({ element, options })
    return Promise.resolve()
  }

  dispose(): void {
    this.revealed.length = 0
  }
}

export const treeViews: FakeTreeView[] = []

export const windowStateChanged = new EventEmitter<{ focused: boolean; active: boolean }>()

export const window = {
  state: { focused: true, active: true },
  onDidChangeWindowState: windowStateChanged.event,
  createTreeView: (): FakeTreeView => {
    const view = new FakeTreeView()
    treeViews.push(view)
    return view
  },
}

export const documentSaved = new EventEmitter<{ readonly uri: { readonly path: string } }>()
export const debugEnded = new EventEmitter<unknown>()
export const taskEnded = new EventEmitter<unknown>()

export const workspace = { onDidSaveTextDocument: documentSaved.event }
export const debug = { onDidTerminateDebugSession: debugEnded.event }
export const tasks = { onDidEndTaskProcess: taskEnded.event }
