package io.miragon.shop.stock;

import io.camunda.client.annotation.JobWorker;
import io.camunda.client.api.response.ActivatedJob;
import java.util.Map;
import org.springframework.stereotype.Component;

@Component
public class ReserveStockWorker {

    @JobWorker(type = "reserve-stock")
    public Map<String, Object> reserveStock(ActivatedJob job) {
        return Map.of("stockReservation", "RES-" + job.getKey());
    }
}
