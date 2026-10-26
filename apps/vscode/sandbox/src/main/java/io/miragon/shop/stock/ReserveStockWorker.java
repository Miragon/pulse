package io.miragon.shop.stock;

import java.util.Map;
import org.operaton.bpm.client.spring.annotation.ExternalTaskSubscription;
import org.operaton.bpm.client.task.ExternalTask;
import org.operaton.bpm.client.task.ExternalTaskHandler;
import org.operaton.bpm.client.task.ExternalTaskService;
import org.springframework.stereotype.Component;

@Component
@ExternalTaskSubscription("reserve-stock")
public class ReserveStockWorker implements ExternalTaskHandler {

    @Override
    public void execute(ExternalTask task, ExternalTaskService service) {
        String reservation = "RES-" + task.getId().substring(0, 8);
        service.complete(task, Map.of("stockReservation", reservation));
    }
}
