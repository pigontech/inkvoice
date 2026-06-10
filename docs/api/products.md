# Products API

## List Products

```
GET /api/v1/products
```

**Query Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `category` | string | Filter by category |
| `is_active` | boolean | Filter active/inactive products |
| `search` | string | Search by name, description, or SKU |
| `page` | number | Page number |
| `limit` | number | Items per page |

## Create Product

```
POST /api/v1/products
```

**Request Body:**

```json
{
  "name": "Web Development",
  "description": "Full-stack web development services",
  "sku": "WEB-DEV-001",
  "unit_price": 150,
  "unit": "hour",
  "category": "service",
  "tax_id": "tax-uuid"
}
```

## Get Product

```
GET /api/v1/products/:id
```

## Update Product

```
PUT /api/v1/products/:id
```

## Delete Product

```
DELETE /api/v1/products/:id
```

Products in use on invoices are deactivated instead of deleted.

## Reactivate Product

```
POST /api/v1/products/:id/reactivate
```

## Product Usage

```
GET /api/v1/products/:id/usage
```

Returns a summary of which invoices use this product.

## Export CSV

```
GET /api/v1/products/export/csv
```

## Categories

```
GET    /api/v1/products/categories
POST   /api/v1/products/categories
PUT    /api/v1/products/categories/:id
DELETE /api/v1/products/categories/:id
```

## Units

```
GET    /api/v1/products/units
POST   /api/v1/products/units
PUT    /api/v1/products/units/:id
DELETE /api/v1/products/units/:id
```

## Batch Operations

```
POST /api/v1/products/batch
```
