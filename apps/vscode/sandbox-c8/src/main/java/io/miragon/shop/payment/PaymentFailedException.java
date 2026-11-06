package io.miragon.shop.payment;

public class PaymentFailedException extends RuntimeException {

    public PaymentFailedException(String message, Throwable cause) {
        super(message, cause);
    }
}
