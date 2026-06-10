# Templates API

## List Templates

```
GET /api/v1/templates
```

## Create Template

```
POST /api/v1/templates
```

**Request Body:**

```json
{
  "name": "My Custom Template",
  "description": "Minimalist invoice design",
  "html_content": "<html>{{invoice_number}}...</html>",
  "css_content": "body { font-family: sans-serif; }"
}
```

## Get Template

```
GET /api/v1/templates/:id
```

## Update Template

```
PUT /api/v1/templates/:id
```

## Delete Template

```
DELETE /api/v1/templates/:id
```

Built-in templates cannot be deleted.

## Set as Default

```
PUT /api/v1/templates/:id/default
```

## Install from URL

```
POST /api/v1/templates/install-url
```

**Request Body:**

```json
{
  "url": "https://example.com/template-package.json"
}
```

## Install from Upload

```
POST /api/v1/templates/install-upload
```

Accepts a multipart form upload of a template file.

## Update from Remote

```
POST /api/v1/templates/:id/update-remote
```

Re-fetches the template from its original source URL.

## Preview

```
POST /api/v1/templates/preview
POST /api/v1/templates/:id/preview
```

Renders the template with sample data and returns the HTML preview.
