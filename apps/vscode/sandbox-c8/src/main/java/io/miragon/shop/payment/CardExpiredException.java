package io.miragon.shop.payment;

public class CardExpiredException extends RuntimeException {

    public CardExpiredException(String message) {
        super(message);
    }
}
