import { useHost } from "../host/host-context.js"
import { Icon } from "./icon.js"
import { glyphs } from "./lucide-glyphs.json"

export function BackButton({ class: className }: { readonly class: string }) {
  const host = useHost()
  if (host.back === undefined) {
    return null
  }
  const label = `Back to ${host.back.label}`
  return (
    <button
      type="button"
      class={`icon-button ${className}`}
      aria-label={label}
      title={label}
      onClick={() => {
        host.post({ type: "goBack" })
      }}
    >
      <Icon of={glyphs.ArrowLeft} />
    </button>
  )
}
