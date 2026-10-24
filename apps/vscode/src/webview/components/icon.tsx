export interface IconProps {
  readonly of: string
  readonly size?: 12 | 16
  readonly class?: string | undefined
}

export function Icon({ of: glyph, size = 16, class: className }: IconProps) {
  return (
    <svg
      class={className === undefined ? "icon" : `icon ${className}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2.5"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      focusable="false"
      dangerouslySetInnerHTML={{ __html: glyph }}
    />
  )
}
