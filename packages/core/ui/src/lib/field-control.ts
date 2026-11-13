import { createContext, useContext, type AriaAttributes } from "react"

/**
 * What a `Field` hands its control: the id its label points at, the ids of its hint and error
 * (`aria-describedby`, the hint first) and `aria-invalid` while it shows an error. A kit control
 * (`Input`, `Textarea`, `NativeSelect`, `Checkbox`, `SearchField`) takes them by itself; spread
 * them onto any other control through the Field's function child.
 */
export interface FieldControlProps {
  id: string
  "aria-describedby"?: string
  "aria-invalid"?: true
}

/** The nearest `Field`'s wiring; `null` outside a Field. */
export const FieldControlContext = createContext<FieldControlProps | null>(null)

interface ControlProps {
  id?: string
  "aria-describedby"?: string
  "aria-invalid"?: AriaAttributes["aria-invalid"]
}

/**
 * A kit control's props joined with its Field's: the Field's id (its label points at it; set
 * `id` on the Field, not on the control), the Field's hint and error ahead of the control's own
 * `aria-describedby`, and `aria-invalid` while the Field shows an error unless the control sets it
 * itself. Outside a Field the props come back as they are.
 */
export function useFieldControl<P extends ControlProps>(props: P): P {
  const field = useContext(FieldControlContext)
  if (!field) return props
  const describedBy = [field["aria-describedby"], props["aria-describedby"]]
    .filter((id) => id !== undefined && id !== "")
    .join(" ")
  return {
    ...props,
    id: field.id,
    "aria-describedby": describedBy === "" ? undefined : describedBy,
    "aria-invalid": props["aria-invalid"] ?? field["aria-invalid"],
  }
}
