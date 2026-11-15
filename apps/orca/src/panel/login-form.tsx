import { Button, Callout, Input, plugin, read, set, Stack, Text } from "orca"
import { PanelState, type Login } from "./panel-state.js"

class LoginActions {
  static async save(): Promise<void> {
    const current = read(PanelState.login)
    if (current === undefined || !LoginActions.complete(current)) {
      return
    }
    const { engine, fields, identity, secret } = current
    const { ok } = await plugin.request("engines.setCredentials", {
      engine,
      ...(fields.identity === undefined ? {} : { identity }),
      secret,
    })
    set(PanelState.login, ok ? undefined : { ...current, failed: true })
    await PanelState.load()
  }

  static complete({ fields, identity, secret }: Login): boolean {
    return (fields.identity === undefined || identity !== "") && secret !== ""
  }
}

export function LoginForm({ current }: { readonly current: Login }) {
  const { fields } = current
  return (
    <Callout tone="warning" icon="plug" title={`Sign in to ${current.engine}`}>
      <Stack gap="sm">
        <Text muted size="xs">
          {fields.sendsTo}
        </Text>
        {fields.identity === undefined ? null : (
          <Input
            label={fields.identity}
            value={current.identity}
            onChange={(identity) => {
              set(PanelState.login, { ...current, identity })
            }}
          />
        )}
        <Input
          label={fields.secret}
          type="password"
          value={current.secret}
          onChange={(secret) => {
            set(PanelState.login, { ...current, secret })
          }}
          onSubmit={() => void LoginActions.save()}
        />
        {current.failed ? (
          <Text tone="danger">Pulse couldn't save the login on this machine.</Text>
        ) : null}
        <Button onPress={() => void LoginActions.save()} disabled={!LoginActions.complete(current)}>
          Save login
        </Button>
      </Stack>
    </Callout>
  )
}
