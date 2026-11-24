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

interface UriComponents {
  readonly scheme: string
  readonly path: string
  readonly query?: string
}

export class Uri {
  readonly fsPath: string

  private constructor(
    readonly scheme: string,
    readonly path: string,
    readonly query = "",
  ) {
    this.fsPath = path
  }

  static file(fsPath: string): Uri {
    return new Uri("file", fsPath)
  }

  static parse(value: string): Uri {
    const url = new URL(value)
    return new Uri(url.protocol.slice(0, -1), decodeURIComponent(url.pathname), url.search.slice(1))
  }

  static from(components: UriComponents): Uri {
    return new Uri(components.scheme, components.path, components.query)
  }

  static joinPath(base: Uri, ...parts: string[]): Uri {
    return new Uri(base.scheme, [base.path, ...parts].join("/"))
  }

  toString(): string {
    return `${this.scheme}://${this.path}${this.query === "" ? "" : `?${this.query}`}`
  }
}

export class TabInputText {
  constructor(readonly uri: Uri) {}
}

export class TabInputCustom {
  constructor(
    readonly uri: Uri,
    readonly viewType: string,
  ) {}
}

export enum ViewColumn {
  Active = -1,
  Beside = -2,
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

export const tabGroups: { activeTabGroup: { activeTab?: { readonly input: unknown } } } = {
  activeTabGroup: {},
}

export const informed: string[] = []

export const window = {
  state: { focused: true, active: true },
  onDidChangeWindowState: windowStateChanged.event,
  tabGroups,
  activeTextEditor: undefined,
  createTreeView: (): FakeTreeView => {
    const view = new FakeTreeView()
    treeViews.push(view)
    return view
  },
  showInformationMessage: (message: string): Promise<undefined> => {
    informed.push(message)
    return Promise.resolve(undefined)
  },
}

export const documentSaved = new EventEmitter<{ readonly uri: { readonly path: string } }>()
export const debugEnded = new EventEmitter<unknown>()
export const taskEnded = new EventEmitter<unknown>()

export const workspace = { onDidSaveTextDocument: documentSaved.event }
export const debug = { onDidTerminateDebugSession: debugEnded.event }
export const tasks = { onDidEndTaskProcess: taskEnded.event }
