package io.miragon.shop.payment;

import java.math.BigDecimal;
import java.util.Map;
import org.operaton.bpm.client.spring.annotation.ExternalTaskSubscription;
import org.operaton.bpm.client.task.ExternalTask;
import org.operaton.bpm.client.task.ExternalTaskHandler;
import org.operaton.bpm.client.task.ExternalTaskService;
import org.springframework.stereotype.Component;

@Component
@ExternalTaskSubscription("charge-payment")
public class ChargePaymentWorker implements ExternalTaskHandler {

    private final CardGateway gateway;

    public ChargePaymentWorker(CardGateway gateway) {
        this.gateway = gateway;
    }

    @Override
    public void execute(ExternalTask task, ExternalTaskService service) {
        String paymentId = charge(task);
        service.complete(task, Map.of("paymentId", paymentId));
    }

    private String charge(ExternalTask task) {
        String cardLast4 = task.getVariable("cardLast4");
        String cardExpiry = task.getVariable("cardExpiry");
        BigDecimal amount = BigDecimal.valueOf((Double) task.getVariable("amount"));
        try {
            return gateway.authorize(cardLast4, cardExpiry, amount);
        } catch (CardExpiredException expired) {
            throw new PaymentFailedException("Payment for order " + task.getBusinessKey() + " failed", expired);
        }
    }
}
