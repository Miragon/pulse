---
type: regex
pattern: 'operate (?:status|incident (?:list|count)|inspect)\b|@miragon/operate'
match: not_contains
target: last_message
---

The answer does not send a Camunda 8 user to the Camunda 7 CLI.
