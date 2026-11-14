import { SearchField as KitSearchField } from "@miragon/pulse-ui"

const SEARCH_DELAY_MS = 400

export interface SearchFieldProps {
  readonly applied: string
  readonly label: string
  readonly placeholder: string
  readonly onSearch: (text: string) => void
}

export function SearchField({ applied, label, placeholder, onSearch }: SearchFieldProps) {
  return (
    <KitSearchField
      value={applied}
      onChange={onSearch}
      delayMs={SEARCH_DELAY_MS}
      placeholder={placeholder}
      aria-label={label}
    />
  )
}
