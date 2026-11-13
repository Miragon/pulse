import { Button, Callout, Input, plugin, read, set, Stack, Text } from "orca"
import { PanelState, type Login } from "./panel-state.js"

class LoginActions {
  static async save(): Promise<void> {
    const current = read(PanelState.login)
    if (current === undefined) {
      return
    }
    const { engine, username, password } = current
    const { ok } = await plugin.request("engines.setCredentials", { engine, username, password })
    set(PanelState.login, ok ? undefined : { ...current, failed: true })
    await PanelState.load()
  }
}

export function LoginForm({ current }: { readonly current: Login }) {
  return (
    <Callout tone="warning" icon="plug" title={`Sign in to ${current.engine}`}>
      <Stack gap="sm">
        <Input
          label="Username"
          value={current.username}
          onChange={(username) => {
            set(PanelState.login, { ...current, username })
          }}
        />
        <Input
          label="Password"
          type="password"
          value={current.password}
          onChange={(password) => {
            set(PanelState.login, { ...current, password })
          }}
          onSubmit={() => void LoginActions.save()}
        />
        {current.failed ? (
          <Text tone="danger">Pulse couldn't save the login on this machine.</Text>
        ) : null}
        <Button
          onPress={() => void LoginActions.save()}
          disabled={current.username === "" || current.password === ""}
        >
          Save login
        </Button>
      </Stack>
    </Callout>
  )
}
