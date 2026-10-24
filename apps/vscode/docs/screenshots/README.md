# What Pulse can do, in screenshots

Taken from VS Code against the shop sandbox (`apps/vscode/sandbox/`). Recreate them with
`pnpm --filter pulse-vscode run sandbox:up` followed by
`pnpm --filter pulse-vscode run docs:screenshots`; with
`PULSE_SCREENSHOTS=28-engine-overview` it takes only the shots whose file name contains that.

| # | Use case | Screenshot | What it shows |
| - | -------- | ---------- | ------------- |
| 1 | Engines at a glance | [01-engines-at-a-glance.png](01-engines-at-a-glance.png) | The Engines view with LOCAL, TEST and an unreachable PROD engine, each process with its running instances and open incidents; the status bar names the active engine. |
| 2 | A process definition with its runtime | [02-definition-overview.png](02-definition-overview.png) | The deployed diagram with waiting and incident badges per element, the version picker, the docked notice about older versions and the running instances under one filter bar with scopes, counts, search and the legend button. |
| 3 | Filter the instances by an element | [03-definition-filter-by-element.png](03-definition-filter-by-element.png) | Clicking Charge payment in the diagram filters the list to the instances there; the filter bar shows the element as a chip and the scope counts follow it. |
| 4 | Instances on an older version | [04-definition-older-version.png](04-definition-older-version.png) | Show v2 from the notice switches the diagram, the badges and the list to version 2. |
| 5 | An instance with an incident | [05-instance-incident-root-cause.png](05-instance-incident-root-cause.png) | A single incident needs no strip: its card holds root cause, job, retries, model and incident id with Stacktrace, Open in model, Open code and Retry; the header names the instance, its definition and when it started. |
| 6 | The stack trace as a document | [06-stacktrace-with-source-links.png](06-stacktrace-with-source-links.png) | Stacktrace opens a read-only document at the last Caused by; frames of the project link to their sources (underlined while Cmd/Ctrl is held). |
| 7 | Retry an incident of a worker task | [07-retry-waiting-for-worker.png](07-retry-waiting-for-worker.png) | Retry on a local engine runs without a dialog; three seconds later the panel says honestly that the task waits for a worker to fetch it again. |
| 8 | A retry that fails again | [08-retry-failed-again.png](08-retry-failed-again.png) | The panel keeps checking for up to a minute; when the job executor runs the Groovy job again and it fails, it says "Failed again" with the root cause. |
| 9 | Go to an instance by business key | [09-same-business-key-picker.png](09-same-business-key-picker.png) | The order and its shipment share ORD-10142, so Go to Process Instance asks which one. |
| 10 | An incident inside a called instance | [10-incident-in-called-instance.png](10-incident-in-called-instance.png) | The call activity is marked dashed; the card says it is located in the called shipment, links to it and retries there. |
| 11 | Every kind of wait state | [11-wait-states.png](11-wait-states.png) | A return waits for a message, a signal and a 14-day timer at once. |
| 12 | Variables with their engine type and scope | [12-variables-typed-and-scoped.png](12-variables-typed-and-scoped.png) | Engine types, a Long beyond 2^53 kept exact, JSON, null, a 3.6 KB note and a task-local variable scoped to Check order. |
| 13 | Change a variable | [13-edit-variable.png](13-edit-variable.png) | The pencil opens an editor that keeps the engine type; text is edited without quotes, the old value stays visible. |
| 14 | Set a variable that is null | [14-edit-null-variable.png](14-edit-null-variable.png) | A null variable asks which type to write, so 4117 stays text unless you choose a number. |
| 15 | Fix the data, then retry | [15-variable-changed-retry-now.png](15-variable-changed-retry-now.png) | After the change the panel confirms it and the incident strip right below offers Retry for the incident that waited for this fix. |
| 16 | Runtime data from an open BPMN file | [16-model-entry-points.png](16-model-entry-points.png) | With a .bpmn open, the status bar shows its running instances and incidents on the active engine, and the editor title has a Show Runtime Data action. |
| 17 | A model that differs from the engine | [17-model-drift.png](17-model-drift.png) | The project adds Notify customer to the shipment, so no deployed version matches. |
| 18 | A model that matches its deployed version | [18-model-matches-deployed.png](18-model-matches-deployed.png) | order-fulfillment.bpmn is deployed as v3. |
| 19 | An engine behind a login | [19-credentials-set.png](19-credentials-set.png) | After Set Credentials with demo / demo the TEST engine (CIB seven) shows its processes. |
| 20 | Writes on a TEST engine are confirmed | [20-write-confirmation-test-engine.png](20-write-confirmation-test-engine.png) | On shop-test the retry asks first and names instance, element, root cause, retries, engine, host and the identity it writes as. |
| 21 | Filter the instances by scope, with counts | [21-definition-filter-with-incident.png](21-definition-filter-with-incident.png) | One filter bar above the instances: every scope carries its count, the incident count in red; With incident lists only the instances of v3 with an incident. Search and the legend button share the bar. |
| 22 | Filter the instances by a badge count | [22-definition-filter-by-badge.png](22-definition-filter-by-badge.png) | A click on the red count of Charge payment lists the instances with an incident there: the scope switches to With incident and the chip says At Charge payment. The blue count lists the running ones. |
| 23 | Resize a table column | [23-resize-table-columns.png](23-resize-table-columns.png) | Dragging the right edge of Value widens the column, so the JSON and text values show more before they end in "…"; the blue line marks the edge being dragged. |
| 24 | The jump button on a call activity | [24-call-activity-jump-button.png](24-call-activity-jump-button.png) | Under Ship order sits an arrow button, here with keyboard focus; its tooltip says "Open called process Shipment". A click on the shape itself still filters the list. |
| 25 | The called process in its own tab | [25-called-process-opened.png](25-called-process-opened.png) | The arrow opens the Shipment definition in another editor tab, with its own badges and instances; the order stays open in its tab. |
| 26 | A called instance links back to its caller | [26-called-instance-parent-link.png](26-called-instance-parent-link.png) | From ORD-10137 the arrow under Ship order opens the shipment it called; the shipment’s header says "from" with the short id of the order and leads back to it. |
| 27 | An instance links into Cockpit | [27-open-in-cockpit.png](27-open-in-cockpit.png) | Where Pulse stops, the engine's web UI goes on: shop-dev has a cockpitUrl, so Open in Cockpit (hovered) follows Copy handover. Its tooltip, "Open ORD-10129 in Cockpit on shop-dev", is drawn by the OS and not part of the screenshot. |
| 28 | The processes of an engine at a glance | [28-engine-overview.png](28-engine-overview.png) | A click on shop-dev in the Engines view opens its overview: product and version, access, Refresh and Open in Cockpit in the header; one filter bar with the scopes and their counts, a search by name or key and the summary of the engine; the processes with incidents first, their incident counts in red. A row opens the process, Ctrl/Cmd+click to the side. |
| 29 | What the local model configures on the failed element | [29-local-sources-model-and-code.png](29-local-sources-model-and-code.png) | The incident card of a worker task reads order-fulfillment.bpmn from the workspace: the model file, with Open in model and Open code (the task type only when it differs from the job type; mappings and error codes show the same way when the element has them). Open stacktrace and Retry sit in the strip only. Without a local model these facts and buttons are absent. |
| 30 | From the incident to the worker | [30-local-sources-open-code.png](30-local-sources-open-code.png) | Open code opens ChargePaymentWorker.java as a tab over the panel at the line that subscribes to the task type charge-payment. |
| 31 | A local model that differs from the deployed version | [31-local-sources-model-differs.png](31-local-sources-model-differs.png) | The shipment of ORD-10142 runs on Shipment v1, but shipment.bpmn in the workspace adds a step: the card says that the local file differs from the deployed version. |
| 32 | Model and code of any element in the diagram | [32-local-sources-selected-element.png](32-local-sources-selected-element.png) | A click on Reserve stock in the diagram of ORD-10129 selects it: a code button on its shape, like the jump arrow of a call activity, opens ReserveStockWorker.java. Charge payment, which has the incident, shows its code button without a click. |
| 33 | Start a move on the diagram | [33-move-token-entry.png](33-move-token-entry.png) | A click on Charge payment, where the token of ORD-10131 waits with its incident, adds a move button under its shape, beside the code button. |
| 34 | Move a token past a broken step | [34-move-token.png](34-move-token.png) | The move button opens the move panel: the diagram marks where the token may go, and once a target is picked the source shows −1, the target +1 and the review list what happens. |
| 35 | A move is always confirmed | [35-move-token-confirm.png](35-move-token-confirm.png) | Even on the local engine a move asks first, names what happens and says that it cannot be undone. |
| 36 | Migrate selected instances | [36-migration-entry.png](36-migration-entry.png) | On an older version, the selection bar offers Migrate to version… next to Cancel instances…; the ids stay in Pulse, the webview names none. |
| 37 | The engine proposes the mapping | [37-migration-plan.png](37-migration-plan.png) | A tab of its own shows both versions and the mapping the engine generated, how many of the selected instances wait at each element and whether the engine finds a problem. |
| 38 | An element without a mapping where instances wait | [38-migration-unmapped.png](38-migration-unmapped.png) | Without a mapping for Check order, Pulse flags it on the diagram and in the table and offers to leave those instances out instead of letting the engine fail them. |
| 39 | A migration is confirmed with its count | [39-migration-confirm.png](39-migration-confirm.png) | The dialog names the versions, the mapping, what changes and what stays, then asks to type the count, as a bulk cancel does. |

## 1. Engines at a glance

The Engines view with LOCAL, TEST and an unreachable PROD engine, each process with its running instances and open incidents; the status bar names the active engine.

![Engines at a glance](01-engines-at-a-glance.png)

## 2. A process definition with its runtime

The deployed diagram with waiting and incident badges per element, the version picker, the docked notice about older versions and the running instances under one filter bar with scopes, counts, search and the legend button.

![A process definition with its runtime](02-definition-overview.png)

## 3. Filter the instances by an element

Clicking Charge payment in the diagram filters the list to the instances there; the filter bar shows the element as a chip and the scope counts follow it.

![Filter the instances by an element](03-definition-filter-by-element.png)

## 4. Instances on an older version

Show v2 from the notice switches the diagram, the badges and the list to version 2.

![Instances on an older version](04-definition-older-version.png)

## 5. An instance with an incident

A single incident needs no strip: its card holds root cause, job, retries, model and incident id with Stacktrace, Open in model, Open code and Retry; the header names the instance, its definition and when it started.

![An instance with an incident](05-instance-incident-root-cause.png)

## 6. The stack trace as a document

Stacktrace opens a read-only document at the last Caused by; frames of the project link to their sources (underlined while Cmd/Ctrl is held).

![The stack trace as a document](06-stacktrace-with-source-links.png)

## 7. Retry an incident of a worker task

Retry on a local engine runs without a dialog; three seconds later the panel says honestly that the task waits for a worker to fetch it again.

![Retry an incident of a worker task](07-retry-waiting-for-worker.png)

## 8. A retry that fails again

The panel keeps checking for up to a minute; when the job executor runs the Groovy job again and it fails, it says "Failed again" with the root cause.

![A retry that fails again](08-retry-failed-again.png)

## 9. Go to an instance by business key

The order and its shipment share ORD-10142, so Go to Process Instance asks which one.

![Go to an instance by business key](09-same-business-key-picker.png)

## 10. An incident inside a called instance

The call activity is marked dashed; the card says it is located in the called shipment, links to it and retries there.

![An incident inside a called instance](10-incident-in-called-instance.png)

## 11. Every kind of wait state

A return waits for a message, a signal and a 14-day timer at once.

![Every kind of wait state](11-wait-states.png)

## 12. Variables with their engine type and scope

Engine types, a Long beyond 2^53 kept exact, JSON, null, a 3.6 KB note and a task-local variable scoped to Check order.

![Variables with their engine type and scope](12-variables-typed-and-scoped.png)

## 13. Change a variable

The pencil opens an editor that keeps the engine type; text is edited without quotes, the old value stays visible.

![Change a variable](13-edit-variable.png)

## 14. Set a variable that is null

A null variable asks which type to write, so 4117 stays text unless you choose a number.

![Set a variable that is null](14-edit-null-variable.png)

## 15. Fix the data, then retry

After the change the panel confirms it and the incident strip right below offers Retry for the incident that waited for this fix.

![Fix the data, then retry](15-variable-changed-retry-now.png)

## 16. Runtime data from an open BPMN file

With a .bpmn open, the status bar shows its running instances and incidents on the active engine, and the editor title has a Show Runtime Data action.

![Runtime data from an open BPMN file](16-model-entry-points.png)

## 17. A model that differs from the engine

The project adds Notify customer to the shipment, so no deployed version matches.

![A model that differs from the engine](17-model-drift.png)

## 18. A model that matches its deployed version

order-fulfillment.bpmn is deployed as v3.

![A model that matches its deployed version](18-model-matches-deployed.png)

## 19. An engine behind a login

After Set Credentials with demo / demo the TEST engine (CIB seven) shows its processes.

![An engine behind a login](19-credentials-set.png)

## 20. Writes on a TEST engine are confirmed

On shop-test the retry asks first and names instance, element, root cause, retries, engine, host and the identity it writes as.

![Writes on a TEST engine are confirmed](20-write-confirmation-test-engine.png)

## 21. Filter the instances by scope, with counts

One filter bar above the instances: every scope carries its count, the incident count in red; With incident lists only the instances of v3 with an incident. Search and the legend button share the bar.

![Filter the instances by scope, with counts](21-definition-filter-with-incident.png)

## 22. Filter the instances by a badge count

A click on the red count of Charge payment lists the instances with an incident there: the scope switches to With incident and the chip says At Charge payment. The blue count lists the running ones.

![Filter the instances by a badge count](22-definition-filter-by-badge.png)

## 23. Resize a table column

Dragging the right edge of Value widens the column, so the JSON and text values show more before they end in "…"; the blue line marks the edge being dragged.

![Resize a table column](23-resize-table-columns.png)

## 24. The jump button on a call activity

Under Ship order sits an arrow button, here with keyboard focus; its tooltip says "Open called process Shipment". A click on the shape itself still filters the list.

![The jump button on a call activity](24-call-activity-jump-button.png)

## 25. The called process in its own tab

The arrow opens the Shipment definition in another editor tab, with its own badges and instances; the order stays open in its tab.

![The called process in its own tab](25-called-process-opened.png)

## 26. A called instance links back to its caller

From ORD-10137 the arrow under Ship order opens the shipment it called; the shipment’s header says "from" with the short id of the order and leads back to it.

![A called instance links back to its caller](26-called-instance-parent-link.png)

## 27. An instance links into Cockpit

Where Pulse stops, the engine's web UI goes on: shop-dev has a cockpitUrl, so Open in Cockpit (hovered) follows Copy handover. Its tooltip, "Open ORD-10129 in Cockpit on shop-dev", is drawn by the OS and not part of the screenshot.

![An instance links into Cockpit](27-open-in-cockpit.png)

## 28. The processes of an engine at a glance

A click on shop-dev in the Engines view opens its overview: product and version, access, Refresh and Open in Cockpit in the header; one filter bar with the scopes and their counts, a search by name or key and the summary of the engine; the processes with incidents first, their incident counts in red. A row opens the process, Ctrl/Cmd+click to the side.

![The processes of an engine at a glance](28-engine-overview.png)

## 29. What the local model configures on the failed element

The incident card of a worker task reads order-fulfillment.bpmn from the workspace: the model file, with Open in model and Open code (the task type only when it differs from the job type; mappings and error codes show the same way when the element has them). Open stacktrace and Retry sit in the strip only. Without a local model these facts and buttons are absent.

![What the local model configures on the failed element](29-local-sources-model-and-code.png)

## 30. From the incident to the worker

Open code opens ChargePaymentWorker.java as a tab over the panel at the line that subscribes to the task type charge-payment.

![From the incident to the worker](30-local-sources-open-code.png)

## 31. A local model that differs from the deployed version

The shipment of ORD-10142 runs on Shipment v1, but shipment.bpmn in the workspace adds a step: the card says that the local file differs from the deployed version.

![A local model that differs from the deployed version](31-local-sources-model-differs.png)

## 32. Model and code of any element in the diagram

A click on Reserve stock in the diagram of ORD-10129 selects it: a code button on its shape, like the jump arrow of a call activity, opens ReserveStockWorker.java. Charge payment, which has the incident, shows its code button without a click.

![Model and code of any element in the diagram](32-local-sources-selected-element.png)

## 33. Start a move on the diagram

A click on Charge payment, where the token of ORD-10131 waits with its incident, adds a move button under its shape, beside the code button.

![Start a move on the diagram](33-move-token-entry.png)

## 34. Move a token past a broken step

The move button opens the move panel: the diagram marks where the token may go, and once a target is picked the source shows −1, the target +1 and the review list what happens.

![Move a token past a broken step](34-move-token.png)

## 35. A move is always confirmed

Even on the local engine a move asks first, names what happens and says that it cannot be undone.

![A move is always confirmed](35-move-token-confirm.png)

## 36. Migrate selected instances

On an older version, the selection bar offers Migrate to version… next to Cancel instances…; the ids stay in Pulse, the webview names none.

![Migrate selected instances](36-migration-entry.png)

## 37. The engine proposes the mapping

A tab of its own shows both versions and the mapping the engine generated, how many of the selected instances wait at each element and whether the engine finds a problem.

![The engine proposes the mapping](37-migration-plan.png)

## 38. An element without a mapping where instances wait

Without a mapping for Check order, Pulse flags it on the diagram and in the table and offers to leave those instances out instead of letting the engine fail them.

![An element without a mapping where instances wait](38-migration-unmapped.png)

## 39. A migration is confirmed with its count

The dialog names the versions, the mapping, what changes and what stays, then asks to type the count, as a bulk cancel does.

![A migration is confirmed with its count](39-migration-confirm.png)

