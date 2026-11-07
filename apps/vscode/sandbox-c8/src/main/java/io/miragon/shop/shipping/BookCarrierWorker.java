package io.miragon.shop.shipping;

import io.camunda.client.annotation.JobWorker;
import io.camunda.client.annotation.Variable;
import java.util.Map;
import org.springframework.stereotype.Component;

@Component
public class BookCarrierWorker {

    private static final double CARRIER_LIMIT_KG = 31.5;

    @JobWorker(type = "book-carrier")
    public Map<String, Object> bookCarrier(@Variable String orderId, @Variable Double weightKg) {
        if (weightKg > CARRIER_LIMIT_KG) {
            throw new CarrierRejectedException("Carrier rejected parcel for " + orderId + ": "
                    + weightKg + " kg exceeds the " + CARRIER_LIMIT_KG + " kg limit");
        }
        return Map.of("trackingNumber", "00340434" + orderId.substring("ORD-".length()));
    }
}
