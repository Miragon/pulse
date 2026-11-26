import { useState } from "react"
import { useLocale } from "./locale/locale-provider.js"
import { Button } from "./primitives/button.js"

/**
 * A later browser entry's stand-in (browser-bundle.test.ts builds it beside pulse-ui.js): it
 * imports React and two of the kit's modules by their paths, as an entry of the package does,
 * so the build must take all three from ./pulse-ui.js. The locale shows that the kit's context
 * is pulse-ui.js's own, the count that its hooks run on pulse-ui.js's React.
 */
export function BrowserProbe() {
  const locale = useLocale()
  const [clicks, setClicks] = useState(0)
  return (
    <Button
      data-slot="browser-probe"
      variant="secondary"
      onClick={() => {
        setClicks(clicks + 1)
      }}
    >
      {locale} {clicks}
    </Button>
  )
}
