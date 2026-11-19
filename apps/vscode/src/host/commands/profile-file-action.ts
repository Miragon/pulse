import { type EngineTarget, ProfileSource } from "@miragon/pulse-runtime-view/host-kit"

export class ProfileFileAction {
  static labelOf(target: EngineTarget): string {
    const { source } = target
    return source.kind === "default"
      ? "Configure Engines…"
      : `Open ${ProfileSource.of(source.kind).inSentence(source.path)}`
  }

  static pathOf(target: EngineTarget): string | undefined {
    const { source } = target
    return source.kind === "default" ? undefined : source.path
  }
}
