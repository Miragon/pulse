import { useState } from "react"
import { Field, formatCount, Icon, Input, useResetOnChange } from "@miragon/pulse-ui"
import { Search } from "lucide-react"
import { useT } from "../messages/index.js"
import type { Navigate } from "../router/page-link.js"
import { SEARCH_TEXT_MOST, searchUrlOf } from "../router/search-address.js"

/**
 * The navigation's search for an instance across engines (plan 2.1), at its top and in its drawer
 * under 64rem: a `search` landmark with one field (pulse-ui's `Field`, its label for screen readers
 * alone), named by what it finds and described by its hint that the search is exact. Enter goes to
 * the search's address (`/app/search?q=…`), a new entry of the page's history; nothing searches
 * while typing and no single key starts it (WCAG 2.1.4). A text longer than an id or a business key
 * can be (`SEARCH_TEXT_MOST`, trimmed) is said next to the field, which it marks invalid, and
 * searches nothing; the field never cuts it. On the search's page the field shows what it searched
 * (`text`), and follows a move to another search.
 */
export function SearchForm({ text, navigate }: { text: string; navigate: Navigate }) {
  const t = useT()
  const [value, setValue] = useState(text)
  useResetOnChange(text, () => {
    setValue(text)
  })
  const wanted = value.trim()
  const tooLong = wanted.length > SEARCH_TEXT_MOST
  return (
    <form
      role="search"
      aria-label={t("nav.search.label")}
      className="px-gutter pb-2"
      onSubmit={(event) => {
        event.preventDefault()
        if (wanted !== "" && !tooLong) navigate(searchUrlOf(wanted))
      }}
    >
      <Field
        label={t("nav.search.label")}
        hint={t("nav.search.hint")}
        error={
          tooLong ? t("nav.search.tooLong", { most: formatCount(SEARCH_TEXT_MOST) }) : undefined
        }
        className="[&>label]:sr-only"
      >
        <span className="relative flex items-center">
          <Icon
            icon={Search}
            className="text-muted-foreground pointer-events-none absolute left-2"
          />
          <Input
            type="search"
            name="q"
            value={value}
            onChange={(event) => {
              setValue(event.target.value)
            }}
            placeholder={t("nav.search.placeholder")}
            autoComplete="off"
            spellCheck={false}
            className="pl-7"
          />
        </span>
      </Field>
    </form>
  )
}
