import { atom, plugin, read, set, type PanelContext } from "orca"
import type { EngineList, FileRow, FoundInstance, ModelRow, Notice, Prompt } from "../protocol.js"

export interface Login {
  readonly engine: string
  readonly username: string
  readonly password: string
  readonly failed: boolean
}

const NOTICE_MS = 8000
const WATCH_TIMEOUT_MS = 120_000
const WATCH_AFTER_MS = 1000
const RECONNECT_AFTER_MS = 2000

export class PanelState {
  static readonly list = atom<EngineList | undefined>(undefined)
  static readonly expanded = atom<readonly string[]>([])
  static readonly selected = atom<string | undefined>(undefined)
  static readonly login = atom<Login | undefined>(undefined)
  static readonly prompts = atom<readonly Prompt[]>([])
  static readonly boards = atom<readonly FileRow[]>([])
  static readonly models = atom<readonly ModelRow[]>([])
  static readonly found = atom<readonly FoundInstance[] | undefined>(undefined)
  static readonly notices = atom<readonly Notice[]>([])
  private static context: PanelContext | undefined
  private static reported: boolean | undefined
  private static armed = false

  static setup(context: PanelContext): void {
    context.subscriptions.push(
      plugin.on("engines.changed", () => void PanelState.load()),
      plugin.on("prompts.changed", () => void PanelState.loadPrompts()),
      plugin.on("notices.show", ({ notice }) => {
        PanelState.notice(notice)
      }),
      plugin.on("engines.login", ({ engine }) => {
        set(PanelState.login, { engine, username: "", password: "", failed: false })
      }),
      plugin.on("engines.focus", ({ key }) => {
        set(PanelState.selected, key)
      }),
    )
    void PanelState.load()
    void PanelState.loadPrompts()
    void PanelState.loadFiles()
    PanelState.context = context
    const arming = setTimeout(() => {
      PanelState.armed = true
      PanelState.reportVisibility()
    }, WATCH_AFTER_MS)
    context.subscriptions.push({
      dispose: () => {
        clearTimeout(arming)
      },
    })
  }

  static async load(): Promise<void> {
    const answer = await plugin.request("engines.list")
    const firstLoad = read(PanelState.list) === undefined
    set(PanelState.list, answer)
    if (firstLoad) {
      set(
        PanelState.expanded,
        answer.engines.filter((engine) => engine.active).map((engine) => `engine|${engine.name}`),
      )
    }
  }

  static async loadPrompts(): Promise<void> {
    const { prompts } = await plugin.request("prompts.list")
    set(PanelState.prompts, prompts)
  }

  static async loadFiles(): Promise<void> {
    const [{ boards }, { models }] = await Promise.all([
      plugin.request("boards.list"),
      plugin.request("models.list"),
    ])
    set(PanelState.boards, boards)
    set(PanelState.models, models)
  }

  static notice(notice: Notice): void {
    set(PanelState.notices, [...read(PanelState.notices), notice].slice(-3))
    setTimeout(() => {
      set(
        PanelState.notices,
        read(PanelState.notices).filter((shown) => shown !== notice),
      )
    }, NOTICE_MS)
  }

  static reportVisibility(): void {
    const context = PanelState.context
    if (context === undefined) {
      return
    }
    const visible = read(context.visible)
    if (!PanelState.armed || visible === PanelState.reported) {
      return
    }
    PanelState.reported = visible
    PanelState.watch(context, visible)
  }

  private static watch(context: PanelContext, visible: boolean): void {
    plugin
      .request(
        "engines.watch",
        { visible },
        { timeoutMs: WATCH_TIMEOUT_MS, signal: context.signal },
      )
      .then((answer) => {
        if (answer.again && PanelState.reported === visible) {
          PanelState.watch(context, visible)
        }
      })
      .catch(() => {
        PanelState.reconnectLater(context)
      })
  }

  private static reconnectLater(context: PanelContext): void {
    if (context.signal.aborted) {
      return
    }
    setTimeout(() => {
      PanelState.reported = undefined
      PanelState.reportVisibility()
      void PanelState.load()
    }, RECONNECT_AFTER_MS)
  }
}
