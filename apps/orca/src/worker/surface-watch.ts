const HOLD_MS = 100_000
const CLOSE_GRACE_MS = 5_000

interface Watched {
  readonly visible: boolean
  readonly release: () => void
  closing?: ReturnType<typeof setTimeout>
}

export interface SurfaceEvents {
  changed(caller: string, visible: boolean): void
  closed(caller: string): void
}

export class SurfaceWatch {
  private readonly surfaces = new Map<string, Watched>()

  constructor(private readonly events: SurfaceEvents) {}

  watch(caller: string, visible: boolean, signal: AbortSignal): Promise<{ again: boolean }> {
    const known = this.surfaces.get(caller)
    clearTimeout(known?.closing)
    known?.release()
    return new Promise((resolve) => {
      const finish = (again: boolean) => {
        clearTimeout(held)
        signal.removeEventListener("abort", aborted)
        resolve({ again })
      }
      const held = setTimeout(() => {
        finish(true)
      }, HOLD_MS)
      const aborted = () => {
        finish(false)
        this.closeLater(caller)
      }
      signal.addEventListener("abort", aborted, { once: true })
      this.surfaces.set(caller, {
        visible,
        release: () => {
          finish(false)
        },
      })
      if (known?.visible !== visible) {
        this.events.changed(caller, visible)
      }
    })
  }

  dispose(): void {
    for (const watched of this.surfaces.values()) {
      clearTimeout(watched.closing)
      watched.release()
    }
    this.surfaces.clear()
  }

  isVisible(caller: string): boolean {
    return this.surfaces.get(caller)?.visible === true
  }

  private closeLater(caller: string): void {
    const watched = this.surfaces.get(caller)
    if (watched === undefined) {
      return
    }
    clearTimeout(watched.closing)
    watched.closing = setTimeout(() => {
      this.surfaces.delete(caller)
      this.events.closed(caller)
    }, CLOSE_GRACE_MS)
  }
}
