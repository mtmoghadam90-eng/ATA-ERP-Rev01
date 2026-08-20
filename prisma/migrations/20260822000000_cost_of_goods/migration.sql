-- Cost of goods becomes a recorded fact instead of a reconstruction.
--
-- Two problems this fixes.
--
-- A proforma line recorded only what the customer pays. The price calculator
-- worked out the landed cost and then threw it away on apply, so gross profit
-- had to be rebuilt afterwards from the purchase order and the product's
-- current price calculator — which meant re-pricing a product silently
-- rewrote last year's profit and every customer's rank, and a free-text line
-- could never have a cost at all.
--
-- And a purchase order's freight, customs and remittance are recorded once for
-- the whole order, so a line's real cost is its share of the order's landed
-- total. That share was recomputed on demand and stored nowhere.
--
-- `unitCost` is in the **proforma's own currency**, matching `unitPriceRial`
-- beside it (whose name is a historical accident — it holds the document's
-- currency too). Cost and price in the same currency is what makes the margin
-- percentage independent of the exchange rate.

IF COL_LENGTH('proforma_items', 'unitCost') IS NULL
    ALTER TABLE [dbo].[proforma_items] ADD [unitCost] DECIMAL(19,4) NULL;
IF COL_LENGTH('proforma_items', 'costCurrency') IS NULL
    ALTER TABLE [dbo].[proforma_items] ADD [costCurrency] NVARCHAR(20) NULL;
IF COL_LENGTH('proforma_items', 'costSource') IS NULL
    ALTER TABLE [dbo].[proforma_items] ADD [costSource] NVARCHAR(20) NULL;

IF COL_LENGTH('purchase_order_items', 'landedUnitCostForeign') IS NULL
    ALTER TABLE [dbo].[purchase_order_items] ADD [landedUnitCostForeign] DECIMAL(19,4) NULL;
IF COL_LENGTH('purchase_order_items', 'landedUnitCostRial') IS NULL
    ALTER TABLE [dbo].[purchase_order_items] ADD [landedUnitCostRial] DECIMAL(19,2) NULL;

-- Back-fill the purchase-order allocation: each line's share of its order's
-- landed cost, apportioned by value, which is the same rule the application
-- applies from now on. Orders with no value or no landed cost are left null
-- rather than given a zero, because zero would read as "free".
EXEC(N'
    UPDATE poi
    SET
        poi.[landedUnitCostRial] = CASE
            WHEN poi.[quantity] > 0
            THEN (po.[landedCostRial] * (poi.[totalPriceForeign] / NULLIF(po.[totalForeignAmount], 0))) / poi.[quantity]
        END,
        poi.[landedUnitCostForeign] = CASE
            WHEN poi.[quantity] > 0 AND po.[exchangeRate] > 0
            THEN ((po.[landedCostRial] * (poi.[totalPriceForeign] / NULLIF(po.[totalForeignAmount], 0))) / poi.[quantity]) / po.[exchangeRate]
        END
    FROM [dbo].[purchase_order_items] poi
    INNER JOIN [dbo].[purchase_orders] po ON po.[id] = poi.[purchaseOrderId]
    WHERE poi.[landedUnitCostRial] IS NULL
      AND po.[totalForeignAmount] > 0
      AND po.[landedCostRial] > 0
');

-- Back-fill proforma lines from the purchase order that fulfilled them, where
-- one exists. Marked BACKFILL rather than PURCHASE_ORDER: it is the same
-- arithmetic, but nobody confirmed it at the time of sale, and the difference
-- is worth being able to see. Everything else stays null — unknown, which is
-- what it is — and the application asks for it on the next save.
--
-- Converted into the proforma's currency, since that is what `unitCost` is in.
EXEC(N'
    UPDATE pi
    SET
        pi.[unitCost] = CASE
            WHEN pf.[currency] = N''ریال'' OR pf.[currency] IS NULL THEN poi.[landedUnitCostRial]
            WHEN pf.[historicalExchangeRate] > 0 THEN poi.[landedUnitCostRial] / pf.[historicalExchangeRate]
        END,
        pi.[costCurrency] = ISNULL(pf.[currency], N''ریال''),
        pi.[costSource] = N''BACKFILL''
    FROM [dbo].[proforma_items] pi
    INNER JOIN [dbo].[proformas] pf ON pf.[id] = pi.[proformaId]
    INNER JOIN [dbo].[purchase_order_items] poi ON poi.[proformaItemId] = pi.[id]
    WHERE pi.[unitCost] IS NULL
      AND poi.[landedUnitCostRial] IS NOT NULL
      AND (
            pf.[currency] = N''ریال''
         OR pf.[currency] IS NULL
         OR pf.[historicalExchangeRate] > 0
      )
');
