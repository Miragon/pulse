import * as React from "react"

import { cn } from "../lib/utils.js"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        // Input border in --input (3:1 on its surface); focus turns border and a
        // 1px ring --focus: a 2px opaque blue edge (CI §8).
        "border-input selection:bg-primary selection:text-primary-foreground file:text-foreground placeholder:text-muted-foreground bg-background h-9 w-full min-w-0 rounded-md border px-3 py-1 text-base outline-hidden transition-[color,box-shadow,border-color] file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
        "focus-visible:border-focus focus-visible:ring-focus focus-visible:ring-1",
        "aria-invalid:border-danger aria-invalid:ring-danger aria-invalid:ring-1",
        className,
      )}
      {...props}
    />
  )
}

export { Input }
