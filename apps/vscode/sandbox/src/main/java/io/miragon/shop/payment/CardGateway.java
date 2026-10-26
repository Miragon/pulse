package io.miragon.shop.payment;

import java.math.BigDecimal;
import java.time.YearMonth;
import java.time.format.DateTimeFormatter;
import java.util.UUID;
import org.springframework.stereotype.Service;

@Service
public class CardGateway {

    private static final DateTimeFormatter EXPIRY = DateTimeFormatter.ofPattern("MM/yyyy");

    public String authorize(String cardLast4, String cardExpiry, BigDecimal amount) {
        if (YearMonth.parse(cardExpiry, EXPIRY).isBefore(YearMonth.now())) {
            throw new CardExpiredException("Card ending " + cardLast4 + " expired on " + cardExpiry);
        }
        return "PAY-" + UUID.randomUUID();
    }
}
