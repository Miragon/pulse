package io.miragon.shop.payment;

import io.camunda.client.annotation.JobWorker;
import io.camunda.client.annotation.Variable;
import java.math.BigDecimal;
import java.util.Map;
import org.springframework.stereotype.Component;

@Component
public class ChargePaymentWorker {

    private final CardGateway gateway;

    public ChargePaymentWorker(CardGateway gateway) {
        this.gateway = gateway;
    }

    @JobWorker(type = "charge-payment")
    public Map<String, Object> chargePayment(
            @Variable String orderId,
            @Variable String cardLast4,
            @Variable String cardExpiry,
            @Variable Double amount) {
        String paymentId = charge(orderId, cardLast4, cardExpiry, BigDecimal.valueOf(amount));
        return Map.of("paymentId", paymentId);
    }

    private String charge(String orderId, String cardLast4, String cardExpiry, BigDecimal amount) {
        try {
            return gateway.authorize(cardLast4, cardExpiry, amount);
        } catch (CardExpiredException expired) {
            throw new PaymentFailedException("Payment for order " + orderId + " failed", expired);
        }
    }
}
