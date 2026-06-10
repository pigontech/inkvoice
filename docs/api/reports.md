# Reports API

All report endpoints support CSV export by appending `/csv` to the path.

## Tax Summary

```
GET /api/v1/reports/tax-summary
GET /api/v1/reports/tax-summary/csv
```

**Query Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `from_date` | string | Start date (ISO 8601) |
| `to_date` | string | End date (ISO 8601) |

## Aging Report

```
GET /api/v1/reports/aging
GET /api/v1/reports/aging/csv
```

Returns outstanding invoices grouped by age brackets (current, 1-30, 31-60, 61-90, 90+ days).

## Revenue by Customer

```
GET /api/v1/reports/revenue-by-customer
GET /api/v1/reports/revenue-by-customer/csv
```

**Query Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `from_date` | string | Start date (ISO 8601) |
| `to_date` | string | End date (ISO 8601) |

## Revenue by Product

```
GET /api/v1/reports/revenue-by-product
GET /api/v1/reports/revenue-by-product/csv
```

**Query Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `from_date` | string | Start date (ISO 8601) |
| `to_date` | string | End date (ISO 8601) |

## Dashboard Stats

```
GET /api/v1/dashboard/stats
```

Returns overview metrics: total revenue, outstanding amount, overdue amount, and invoice counts by status.

## Revenue Chart

```
GET /api/v1/dashboard/revenue-chart
```

Returns monthly revenue data for chart rendering.

## Recent Invoices

```
GET /api/v1/dashboard/recent-invoices
```

Returns the most recent invoices.
