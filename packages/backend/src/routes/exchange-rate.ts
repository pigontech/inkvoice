import { Hono } from "hono";
import { fetchRate, getBaseCurrency } from "../services/exchange-rate.service";

const exchangeRate = new Hono();

// Best-effort live rate lookup for the invoice/expense forms. `to` defaults to
// the configured base currency. `rate` is null when offline / unknown currency,
// in which case the UI keeps the user's manual entry.
exchangeRate.get("/", async (c) => {
  const from = (c.req.query("from") || "").toUpperCase();
  const to = (c.req.query("to") || getBaseCurrency()).toUpperCase();
  if (!/^[A-Z]{3}$/.test(from) || !/^[A-Z]{3}$/.test(to)) {
    return c.json({ success: false, error: "Invalid currency code" }, 400);
  }
  const rate = await fetchRate(from, to);
  return c.json({ success: true, data: { from, to, rate } });
});

export { exchangeRate };
