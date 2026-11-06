# Camunda 8 shop sandbox

The webshop of the [shop sandbox](../sandbox/README.md) as a Camunda 8 project, for trying Pulse
on Camunda 8 by hand. It has the same three processes as Camunda 8 models with job workers, two
real clusters with seeded runtime data and a production profile that can't be reached. Optional
live traffic keeps the data moving. Pulse only reads Camunda 8, so this charter has no writes.

## Start

From the repository root (podman or docker):

```sh
pnpm --filter pulse-cockpit run sandbox:c8:open      # builds Pulse, starts the clusters if needed, opens this folder in VS Code
pnpm --filter pulse-cockpit run sandbox:c8:up        # (re)creates both clusters and seeds them, under a minute once the image is pulled
pnpm --filter pulse-cockpit run sandbox:c8:traffic   # optional: live orders on shop-dev until Ctrl+C
pnpm --filter pulse-cockpit run sandbox:c8:down      # removes both clusters
```

`sandbox:c8:open` needs the `code` command on your PATH. It starts its own VS Code instance with
a profile of its own in the temp folder (`pulse-sandbox-c8`), so it never mixes with your VS Code
window; it runs the build from this repository next to your installed extensions. Alternatively,
open `apps/vscode` in VS Code and press **F5 → "Run Pulse (sandbox, Camunda 8)"**.

`sandbox:c8:up` always starts from scratch, so run it again to reset all data. It uses other
ports than the shop sandbox, so both can run at the same time.

## What is inside

| Target      | Cluster                                                   | Login                               | Data after `sandbox:c8:up`                 |
| ----------- | --------------------------------------------------------- | ----------------------------------- | ------------------------------------------ |
| `shop-dev`  | Camunda 8.10.8 on `:18092`, API without login             | none                                | 174 running · 12 open incidents · 25 ended |
| `shop-test` | Camunda 8.10.8 on `:18093`, basic auth and authorizations | `pulse` / `pulse` (Set Credentials) | 9 running · 1 open incident · 2 ended      |
| `prod-eu`   | does not exist (client credentials, as on SaaS)           | –                                   | shows an unreachable production cluster    |

Both clusters keep their data in memory (H2) and run Operate for comparison: shop-dev at
<http://localhost:18092/operate> and shop-test at <http://localhost:18093/operate>, both with
`demo` / `demo`. On shop-test, `pulse` holds only the three read permissions Pulse needs
([What the login may read](../../../docs/vscode/camunda8.md#what-the-login-may-read)) and
`nobody` / `nobody` holds none.

| Process           | File                                             | Deployed on shop-dev                       |
| ----------------- | ------------------------------------------------ | ------------------------------------------ |
| Order fulfillment | `src/main/resources/bpmn/order-fulfillment.bpmn` | v1, v2 and v3 (= this file)                |
| Shipment (called) | `src/main/resources/bpmn/shipment.bpmn`          | v1 only; this file adds an undeployed step |
| Return handling   | `src/main/resources/bpmn/return-handling.bpmn`   | v1 (= this file)                           |

The job workers are Spring beans with `@JobWorker`: the payment worker in
`src/main/java/io/miragon/shop/payment`, the stock worker in `src/main/java/io/miragon/shop/stock`
and the carrier worker in `src/main/java/io/miragon/shop/shipping`. Their error messages are Java
stack traces that point at real lines in those files. Two steps fail without a worker: _Calculate
loyalty points_ is a FEEL script that refuses the customer tier `legacy`, and _Order ok?_ finds no
flow for an order nobody decided on.

## Test charter

Business keys are stable after every `sandbox:c8:up`. Use **Pulse: Go to Process Instance…** to
jump to them.

| #   | Scenario                        | Where                                                              | What you should see                                                                                                                                                                                                                                                                          |
| --- | ------------------------------- | ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Engine overview                 | Click `shop-dev` in the Engines view                               | "shop-dev · Processes": Order fulfillment, Shipment, Return handling; "3 processes · 174 running · 15 with incident" (12 orders and 3 shipments); _With incident 2_.                                                                                                                         |
| 2   | Read-only                       | `shop-dev` in the Engines view, any panel                          | "LOCAL · Camunda 8 8.10.8, read-only engine"; every panel says Read-only: no checkboxes in the lists, no Retry on an incident, no pencil on a variable.                                                                                                                                      |
| 3   | Paging                          | Order fulfillment → Running                                        | 146 running on v3; 50 per page and _Load more_ for the rest.                                                                                                                                                                                                                                 |
| 4   | Older versions                  | Order fulfillment                                                  | "9 instances still run on older versions."; the version picker shows v1 (no gateway, no timer) and v2 (no loyalty step).                                                                                                                                                                     |
| 5   | Badges per element              | Order fulfillment, v3                                              | Check order 120 waiting; Order ok? 2 incidents; Charge payment 4 incidents + 2 waiting; Await payment confirmation 8 waiting; Calculate loyalty points 2 incidents; Ship order 3 incidents in called instances + 8 running.                                                                  |
| 6   | Java root cause and source link | `ORD-10129` … `ORD-10132`                                          | _Worker error_ `CardExpiredException: Card ending … expired on 03/2025`; _Error message_ opens the stack trace, where Cmd/Ctrl+click on `ChargePaymentWorker.java:NN` opens the source at that line, on a class name such as `io.miragon.shop.payment.CardExpiredException` its declaration. |
| 7   | A FEEL script that fails        | `ORD-10135`, `ORD-10136`                                           | _Extract value error · Calculate loyalty points_; the cause ends in "No loyalty rules for customer tier legacy". No job, so no _Open code_.                                                                                                                                                  |
| 8   | An order nobody decided on      | `ORD-10145`, `ORD-10146`                                           | _Extract value error · Order ok?_: the condition `not(approved)` found no variable `approved`.                                                                                                                                                                                               |
| 9   | Incident in a called instance   | `ORD-10142` … `ORD-10144` (Order fulfillment)                      | The card says "Located in shipment …" and _Worker error_ `CarrierRejectedException`, because the parcel is too heavy.                                                                                                                                                                        |
| 10  | Same business key twice         | Go to `ORD-10142`                                                  | A picker with the order and its shipment, which carries the business key on.                                                                                                                                                                                                                 |
| 11  | Retrying without incident       | `ORD-10133`, `ORD-10134`                                           | Waiting at Charge payment, no incident. **Known gap:** Pulse does not show the failed attempt (PayPal timeout, 2 retries left, the next one in 15 minutes).                                                                                                                                  |
| 12  | Variables                       | `ORD-10118` … `ORD-10120`                                          | JSON values without an engine type (Type shows –): `customer` and `items` as JSON, `erpOrderNumber` beyond 2^53 with every digit, `couponCode` null, `orderedAt` as a string, 3.6 KB `notes`, and `reviewNote` scoped to Check order.                                                        |
| 13  | Every kind of wait state        | Return handling                                                    | `RET-5001` … `RET-5004`: worker task without a worker. `RET-5007` … `RET-5009`: the event-based gateway. `RET-5010`, `RET-5011`: user task. **Known gap:** at the gateway Pulse names only the message `ReturnParcelReceived`, not the signal and the timer.                                 |
| 14  | Instance without business key   | Return handling → Running                                          | One row with only its id.                                                                                                                                                                                                                                                                    |
| 15  | Multi-instance                  | Shipment                                                           | Pack parcel counts 6: one per shipment, although they pack 9 parcels.                                                                                                                                                                                                                        |
| 16  | Ended instances                 | Order fulfillment → Ended                                          | Rejected, fulfilled, timed out and cancelled orders (`ORD-10147` … `ORD-10161`); `ORD-10160` "is terminated".                                                                                                                                                                                |
| 17  | Model drift                     | `shipment.bpmn` → _Show Runtime Data for This Model_               | "shipment.bpmn differs from every deployed version." (this file adds _Notify customer_). `order-fulfillment.bpmn` "matches the deployed v3".                                                                                                                                                 |
| 18  | Credentials                     | `shop-test`                                                        | TEST label; "rejected the credentials" until _Set Credentials…_ with `pulse` / `pulse` (the prompt says "Pulse sends it to localhost:18093"), then "3 processes · 9 running · 1 with incident".                                                                                              |
| 19  | A login without permissions     | `shop-test`, _Set Credentials…_ with `nobody` / `nobody`           | "0 processes · 0 running" and "No processes deployed on shop-test, or you may not have permission to see them."                                                                                                                                                                              |
| 20  | Unreachable production          | `prod-eu`                                                          | Red PROD label and "Can't reach prod-eu."; _Set Credentials…_ asks for a client ID and secret and says "Pulse sends it to login.shop.invalid and the tokens it gets to prod-eu.shop.invalid."                                                                                                |
| 21  | Live data                       | `pnpm --filter pulse-cockpit run sandbox:c8:traffic`, then Refresh | New `ORD-9xxxx` orders, new incident counts in the Engines tree, the "As of" time moves.                                                                                                                                                                                                     |
| 22  | Jump into a called instance     | `ORD-10137`, arrow under Ship order                                | Opens its shipment; the shipment's header says "from …".                                                                                                                                                                                                                                     |
| 23  | Not called yet                  | `ORD-10118`, arrow under Ship order                                | "Not called yet: open called process Shipment" opens the Shipment definition.                                                                                                                                                                                                                |
| 24  | Open in Operate                 | `shop-dev`, `ORD-10129`                                            | _Open ORD-10129 in Operate on shop-dev_ opens Operate (`demo` / `demo`) on that instance's incidents.                                                                                                                                                                                        |
| 25  | Model and code of an incident   | `ORD-10129`, Incidents tab                                         | The card shows the job type `charge-payment` and the model `order-fulfillment.bpmn`; _Open code_ opens `ChargePaymentWorker.java` at `@JobWorker(type = "charge-payment")`.                                                                                                                  |
| 26  | Local model differs             | `ORD-10142`, or `ORD-10167` on v2                                  | "shipment.bpmn · differs from the deployed version" (and `order-fulfillment.bpmn` for v2).                                                                                                                                                                                                   |
| 27  | A board across engines          | Boards view → Shop operations, after _Set Credentials_             | shop-dev and shop-test counted with each engine named; prod-eu gets "Can't reach prod-eu." and "not read", totals read "from 2 of 3 engines".                                                                                                                                                |
| 28  | A process board                 | Boards view → Order fulfillment, after _Set Credentials_           | The diagram of order-fulfillment on shop-dev and on shop-test with their badges; open incidents of both engines with element and message.                                                                                                                                                    |

## How the data is made

`apps/vscode/scripts/sandbox-c8` holds everything that is not part of this project: the cluster
definitions, the deployed older versions, the scenario catalogue (`scenarios.mjs`), the shop's
workers (`workers.mjs`) and their error texts (`error-texts.mjs`); the order data is the shop
sandbox's (`apps/vscode/scripts/sandbox/shop-data.mjs`). The seed starts every instance at its
start event and walks it along the path its scenario names (`journeys.mjs`): it completes user
tasks, correlates messages, broadcasts the recall and runs the workers until nothing is left, which
creates the failures from the business data, such as an expired card or an overweight parcel.
Timers that a journey needs fire on their own: the seed starts those orders with a payment window
or a pickup wait of one second. The seed counts the open incidents at the end and fails when they
differ from the catalogue.
