import { CopyButton } from "./copy-button.js"

export interface IdTextProps {
  readonly id: string
  readonly shortId: string
  readonly label: string
}

export function IdText({ id, shortId, label }: IdTextProps) {
  return (
    <span class="id-text">
      <code class="id-text__value" title={id}>
        <span class="id-text__short">{shortId}</span>
        <span class="id-text__full">{id}</span>
      </code>
      <CopyButton text={id} label={label} class="id-text__copy" />
    </span>
  )
}
