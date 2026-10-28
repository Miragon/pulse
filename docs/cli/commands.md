# Command structure

Every GET, POST, PUT and DELETE operation of the REST API is a command generated from the OpenAPI
spec: 396 commands in 52 groups. The OPTIONS operations (HATEOAS link discovery) are reachable with
`pulse-cli api OPTIONS <path>`. This page has the rules for names and values;
`pulse-cli describe <group> <command>` shows the arguments, options and body schema of one command.

```text
pulse-cli <group> <command> [path-args...] [options] [global options]
pulse-cli commands [group] [--search <text>] [--effect <effect>]
pulse-cli describe <group> [command]  |  pulse-cli describe <operationId>
pulse-cli api <METHOD> <path> [--query key=value]... [--body <json|@file|->]
pulse-cli ping
pulse-cli guide [topic] | --list
pulse-cli config path | show | list | set | unset | use | delete
```

## Names

- **Group**: the kebab-case OpenAPI tag (`process-instance`, `historic-task-instance`, ...).
- **Command**: the operationId without the tag noun: `getProcessInstances` →
  `process-instance list`, `startProcessInstanceByKey` → `process-definition start`. The kebab-case
  operationId is always an alias (`pulse-cli task get-tasks` = `pulse-cli task list`), and
  `pulse-cli describe getTasks` works too. Collections are `list`, single resources `get <id>`;
  every command has a summary that is unique in its group (`pulse-cli commands <group>`).
- **Effect**: every command is a `read`, `write`, `delete` or `bulk` operation. `pulse-cli commands`
  and `pulse-cli describe` show it; it drives the [safety](safety.md) checks.

## Arguments and options

Path parameters are positional arguments in path order
(`pulse-cli process-instance get-variable <id> <var-name>`). Query parameters and body properties
are kebab-case flags (`businessKey` → `--business-key`); integers, numbers and enums are validated
before sending. Booleans have a `--no-` form (`--no-with-incident` sends `false`), and arrays are
comma separated or repeated (`--process-instance-ids a,b --process-instance-ids c`).

## Variables

Variable maps are repeatable `--var name=value` flags. Values are auto typed:

| Input           | Type                                         |
| --------------- | -------------------------------------------- |
| `true`, `false` | `Boolean`                                    |
| integer         | `Integer`, or `Long` outside the int32 range |
| decimal         | `Double`                                     |
| `null`          | `Null`                                       |
| anything else   | `String`                                     |

Force a type with `name:Type=value`, where `Type` is one of `String`, `Integer`, `Short`, `Long`,
`Double`, `Boolean`, `Date`, `Json`, `Xml`, `Null`. `Date` values accept the
[date-time forms](#date-time-values).

```sh
pulse-cli process-definition start invoice --var amount=250 --var zip:String=01234 --var due:Date=2024-06-01T12:00+02:00 --var 'order:Json={"id":42}' --dry-run
```

sends

```json
{
  "variables": {
    "amount": { "value": 250, "type": "Integer" },
    "zip": { "value": "01234", "type": "String" },
    "due": { "value": "2024-06-01T12:00:00.000+0200", "type": "Date" },
    "order": { "value": "{\"id\":42}", "type": "Json" }
  }
}
```

Other variable maps (`--local-var`, `--correlation-key`, ...) use the same syntax. Commands that
set a single variable take `--value <raw>` plus an optional `--type <Type>`. Integers beyond 2^53
(`Long` values up to 9223372036854775807) are sent and printed exactly.

```sh
pulse-cli process-instance set-variable $INSTANCE_ID dueDate --value 2024-06-01T12:00 --type Date
```

## Request bodies

- `--body <json>`, `--body @file.json` or `--body -` (stdin) is the base JSON body. Flags are
  merged on top: field flags override properties, `--var` entries win per variable name. Use it
  for nested structures such as start instructions, topics or sorting.
- The final body is validated against the API schema before it is sent; `--no-validate` skips the
  check (e.g. for engine extensions the spec does not know):

```text
$ pulse-cli process-definition start invoice --body '{"businesKey":"INV-1"}'
{"error":{"code":"VALIDATION","exitCode":2,"message":"Invalid request body: $: unknown property \"businesKey\", did you mean \"businessKey\"?","hint":"Run `pulse-cli describe process-definition start` to see the body schema, or pass --no-validate to skip this check.","data":[{"path":"$","message":"unknown property \"businesKey\", did you mean \"businessKey\"?"}]}}
```

```sh
pulse-cli process-definition start invoice --body @start.json --business-key INV-1002
echo '{"businessKey":"INV-1003"}' | pulse-cli process-definition start invoice --body -
```

## Files (multipart)

- `deployment create` takes the resource files as arguments. The resource name is the file name,
  or the path relative to `--base-dir <dir>`:

```sh
pulse-cli deployment create invoice.bpmn invoice-approval.dmn --deployment-name invoice
pulse-cli deployment create bpmn/invoice.bpmn forms/approve.form --base-dir . --deploy-changed-only
```

- Binary and file variables upload a file with `--data <path>`:

```sh
pulse-cli process-instance set-variable-binary $INSTANCE_ID contract --data contract.pdf --value-type File
pulse-cli process-instance get-variable-binary $INSTANCE_ID contract --out-file contract.pdf
```

## Pagination

List commands with `--max-results` also take `--all`: `pulse-cli` fetches page after page
(page size `--max-results`, default 500, starting at `--first-result`) and prints one list.

```sh
pulse-cli process-instance list --process-definition-key invoice --all --fields id,businessKey
```

## Date-time values

Options shown as `<date-time>` in `--help` and `Date` variables accept several forms and are
converted to the engine format `yyyy-MM-dd'T'HH:mm:ss.SSSZ`. Times without an offset are UTC;
invalid dates (`2024-02-30`) are usage errors. This includes the date filters of `task list` and
`task count` (`--due-date`, `--created-after`, `--follow-up-before`, ...), which the OpenAPI spec
does not mark as dates; their `...-expression` variants take an expression and stay unchanged.

| Input                          | Sent                           |
| ------------------------------ | ------------------------------ |
| `2024-05-01`                   | `2024-05-01T00:00:00.000+0000` |
| `2024-05-01T10:00`             | `2024-05-01T10:00:00.000+0000` |
| `2024-05-01T10:00:00Z`         | `2024-05-01T10:00:00.000+0000` |
| `2024-05-01T10:00:00.5+02:00`  | `2024-05-01T10:00:00.500+0200` |
| `2024-05-01T10:00:00.000+0200` | unchanged                      |
