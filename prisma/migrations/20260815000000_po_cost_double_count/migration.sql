-- Freight and remittance were stored twice on a purchase order.
--
-- The form asks for them in the order's own currency, and sent both that figure
-- and its rial conversion. The landed cost adds the foreign costs at the rate
-- AND the rial columns, so every order carrying freight or a remittance fee had
-- them counted twice — the stored landed cost was too high, by that amount, for
-- as long as both fields have existed.
--
-- The form now sends only the foreign figure. This clears the duplicate out of
-- the records already written, and recomputes their landed cost.
--
-- Deliberately narrow: a rial column is only cleared when it is what the
-- conversion would have produced (within one rial of rounding). An order whose
-- rial freight is a genuinely separate cost — entered before the foreign fields
-- existed, with no foreign counterpart — does not match and is left exactly as
-- it is, still counted once.

UPDATE [dbo].[purchase_orders]
SET [shippingCostRial] = 0
WHERE [shippingCostForeign] > 0
  AND [exchangeRate] > 0
  AND ABS([shippingCostRial] - ROUND([shippingCostForeign] * [exchangeRate], 0)) <= 1;

UPDATE [dbo].[purchase_orders]
SET [remittanceFeeRial] = 0
WHERE [remittanceFeeForeign] > 0
  AND [exchangeRate] > 0
  AND ABS([remittanceFeeRial] - ROUND([remittanceFeeForeign] * [exchangeRate], 0)) <= 1;

-- The landed cost, re-derived from the corrected inputs. Same rule as
-- `computeTotals`: the rial figure carries everything, and the foreign figure
-- is that money at the order's own rate.
UPDATE [dbo].[purchase_orders]
SET [landedCostRial] =
      ([totalForeignAmount] + [shippingCostForeign] + [remittanceFeeForeign]) * [exchangeRate]
      + [shippingCostRial] + [customsDutyRial] + [remittanceFeeRial];

UPDATE [dbo].[purchase_orders]
SET [landedCostForeign] =
      CASE WHEN [exchangeRate] > 0
           THEN ROUND([landedCostRial] / [exchangeRate], 2)
           ELSE [totalForeignAmount] + [shippingCostForeign] + [remittanceFeeForeign]
      END;
