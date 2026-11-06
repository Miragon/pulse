package io.miragon.shop.shipping;

public class CarrierRejectedException extends RuntimeException {

    public CarrierRejectedException(String message) {
        super(message);
    }
}
