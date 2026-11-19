import type { Host } from "../host/host-context.js"

export interface BackProps {
  readonly onBack?: () => void
  readonly backLabel?: string
}

export class BackTarget {
  static propsOf(host: Host): BackProps {
    const back = host.back
    if (back === undefined) {
      return {}
    }
    return {
      backLabel: `Back to ${back.label}`,
      onBack: () => {
        host.post({ type: "goBack" })
      },
    }
  }
}
