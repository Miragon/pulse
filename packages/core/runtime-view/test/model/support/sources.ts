export const CHARGE_PAYMENT_WORKER = `package io.miragon.shop.payment;

import org.operaton.bpm.client.spring.annotation.ExternalTaskSubscription;
import org.springframework.stereotype.Component;

// handles "charge-payment"
@Component
@ExternalTaskSubscription("charge-payment")
public class ChargePaymentWorker implements ExternalTaskHandler {
}
`

export const CHARGE_PAYMENT_TEST = `package io.miragon.shop.payment;

class ChargePaymentWorkerTest {
  String topic = "charge-payment";
}
`

export const AUDIT_SERVICE = `package io.miragon.shop.audit;

@Service("auditLogger")
public class AuditService implements JavaDelegate {
}
`

export const CARRIER_WORKER = `export class CarrierWorker {
  register(client: Client): void {
    client.subscribe('book-carrier', this.handle);
  }
}
`

export const TOPICS = `package io.miragon.shop;

public final class Topics {
  public static final String CHARGE_PAYMENT = "charge-payment";
  public static final String SHIP_ORDER = "ship-order";
}
`
