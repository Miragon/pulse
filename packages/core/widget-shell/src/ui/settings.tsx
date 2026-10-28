import { cloneElement, useId, type ComponentProps, type ReactElement, type ReactNode } from "react"
import { Card, CardContent, cn, TONE_INK } from "@miragon/mcp-toolkit-ui"
import { CircleAlert } from "lucide-react"
import { Icon } from "./icon.js"
import { FIELD_CONTROL } from "./native-select.js"

/** A section whose cards sit directly under the page `h1` passes `titleAs="h2"`, so the outline never skips a level. */
export function SettingsCard({
  title,
  titleAs: Title = "h3",
  children,
}: {
  title: string
  titleAs?: "h2" | "h3"
  children: ReactNode
}) {
  return (
    <Card className="gap-0 py-0 shadow-none">
      <CardContent className="flex flex-col gap-4 p-4">
        <Title className="text-foreground text-section">{title}</Title>
        {children}
      </CardContent>
    </Card>
  )
}

interface FieldControlProps {
  id?: string
  "aria-describedby"?: string
  "aria-invalid"?: boolean
}

/** `error` says what is wrong where it is (CI §8/§9), never corrects silently. */
export function SettingsField({
  label,
  help,
  error,
  group = false,
  children,
}: {
  label: string
  help?: string
  /** What is wrong with the entry, in words ("Enter a whole number of 1 or more."). */
  error?: string
  /** No single control to point htmlFor at. */
  group?: boolean
  children: ReactElement<FieldControlProps>
}) {
  const id = useId()
  const labelId = `${id}-label`
  const helpId = `${id}-help`
  const errorId = `${id}-error`
  const describedBy = [error ? errorId : null, help ? helpId : null].filter(Boolean).join(" ")
  return (
    <div className="flex flex-col gap-1.5">
      {group ? (
        <span id={labelId} className="text-foreground text-dense font-medium">
          {label}
        </span>
      ) : (
        <label htmlFor={id} className="text-foreground text-dense font-medium">
          {label}
        </label>
      )}
      {group ? (
        <div role="group" aria-labelledby={labelId} aria-describedby={describedBy || undefined}>
          {children}
        </div>
      ) : (
        cloneElement(children, {
          id,
          "aria-describedby": describedBy || undefined,
          "aria-invalid": error ? true : undefined,
        })
      )}
      {error && (
        <span id={errorId} className={cn("text-small flex items-center gap-1.5", TONE_INK.danger)}>
          <Icon icon={CircleAlert} dense />
          {error}
        </span>
      )}
      {help && (
        <span id={helpId} className="text-muted-foreground text-small">
          {help}
        </span>
      )}
    </div>
  )
}

export function SettingsInput({ className, ...props }: ComponentProps<"input">) {
  return <input {...props} className={cn(FIELD_CONTROL, className)} />
}
