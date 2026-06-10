import {
  ArrowLeft,
  BookOpen,
  ChevronDown,
  Eye,
  FileText,
  Pencil,
  Plus,
  RotateCcw,
  Save,
  Star,
  Trash2,
} from "lucide-react";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { api, getAuthToken } from "@/api/client";
import { CodeEditor, type CodeEditorHandle } from "@/components/shared/CodeEditor";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { FormField } from "@/components/shared/FormField";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { useTranslation } from "@/i18n";
import { formatApiError } from "@/lib/format-api-error";

/**
 * Renders a downscaled preview of a template by fetching the rendered HTML
 * from the preview endpoint and embedding it in a sandboxed iframe at A4
 * width, scaled down to fit a 4:3 thumbnail. The iframe is non-interactive.
 */
function TemplateThumbnail({ templateId }: { templateId: string }) {
  const [html, setHtml] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const token = getAuthToken();
        const res = await fetch(`/api/v1/templates/${templateId}/preview`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: "{}",
        });
        if (!res.ok) throw new Error("preview failed");
        const text = await res.text();
        if (!cancelled) setHtml(text);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [templateId]);

  if (failed) {
    return (
      <div className="h-40 flex items-center justify-center text-xs text-muted-foreground bg-muted/40">
        Preview unavailable
      </div>
    );
  }

  // A4 is 794x1122px at 96dpi. We render the iframe at full A4 size and scale
  // it down with a CSS transform so the thumbnail shows the page-top portion
  // legibly. The container clips the overflow.
  const SCALE = 0.32;
  return (
    <div className="h-40 relative overflow-hidden bg-white border-b">
      {html ? (
        <iframe
          srcDoc={html}
          title="Template thumbnail"
          aria-hidden="true"
          tabIndex={-1}
          sandbox="allow-same-origin"
          className="absolute top-0 left-0 pointer-events-none"
          style={{
            width: "794px",
            height: "1122px",
            transform: `scale(${SCALE})`,
            transformOrigin: "top left",
            border: "0",
          }}
        />
      ) : (
        <div className="absolute inset-0 animate-pulse bg-muted" />
      )}
    </div>
  );
}

export default function Templates() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const isNew = location.pathname === "/settings/templates/new";
  const isEditing = !!id;

  const [templates, setTemplates] = useState<any[]>([]);
  const [editingTemplate, setEditingTemplate] = useState<any>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<{ open: boolean; id: string | null }>({
    open: false,
    id: null,
  });
  const [deleteLoading, setDeleteLoading] = useState(false);

  const fetchTemplates = useCallback(async () => {
    const res = await api.listTemplates();
    setTemplates(res.data);
  }, []);

  useEffect(() => {
    fetchTemplates();
  }, [fetchTemplates]);

  // Reset editing state when route id changes (fixes stale template when navigating between edits)
  // biome-ignore lint/correctness/useExhaustiveDependencies: id triggers the effect intentionally
  useEffect(() => {
    setEditingTemplate(null);
  }, [id]);

  // Load template for editing when route has an id
  useEffect(() => {
    if (isEditing && templates.length > 0) {
      const tpl = templates.find((t: any) => t.id === id);
      if (tpl) {
        setEditingTemplate(tpl);
      } else {
        // Template not found, go back to list
        navigate("/settings/templates", { replace: true });
      }
    }
  }, [isEditing, id, templates, navigate]);

  const handleSetDefault = async (id: string) => {
    await api.setDefaultTemplate(id);
    toast.success(t("templates.default_updated"));
    fetchTemplates();
  };

  const handleDelete = async () => {
    if (!deleteConfirm.id) return;
    setDeleteLoading(true);
    try {
      await api.deleteTemplate(deleteConfirm.id);
      toast.success(t("templates.template_deleted"));
      fetchTemplates();
    } catch (err: unknown) {
      toast.error(formatApiError(err, t));
    } finally {
      setDeleteLoading(false);
      setDeleteConfirm({ open: false, id: null });
    }
  };

  const handleSave = async (data: any) => {
    try {
      if (data.id) {
        await api.updateTemplate(data.id, data);
        toast.success(t("templates.template_updated"));
      } else {
        await api.createTemplate(data);
        toast.success(t("templates.template_created"));
      }
      await fetchTemplates();
      navigate("/settings/templates");
    } catch (err: unknown) {
      toast.error(formatApiError(err, t));
    }
  };

  if (isEditing && editingTemplate) {
    return (
      <TemplateEditor
        template={editingTemplate}
        onSave={handleSave}
        onCancel={() => navigate("/settings/templates")}
      />
    );
  }

  if (isNew) {
    return (
      <TemplateEditor
        template={null}
        onSave={handleSave}
        onCancel={() => navigate("/settings/templates")}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">{t("templates.title")}</h1>
        <Button onClick={() => navigate("/settings/templates/new")}>
          <Plus className="h-4 w-4 mr-2" /> {t("templates.new_template")}
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {templates.map((tpl: any) => (
          <Card key={tpl.id} className="group hover:shadow-md transition-shadow overflow-hidden">
            <button
              type="button"
              onClick={() => navigate(`/settings/templates/${tpl.id}/edit`)}
              className="block w-full bg-muted/40 cursor-pointer focus:outline-none focus:ring-2 focus:ring-ring rounded-t-lg"
              aria-label={t("templates.thumbnail_alt", { name: tpl.name })}
            >
              <TemplateThumbnail templateId={tpl.id} />
            </button>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">{tpl.name}</CardTitle>
              <div className="flex gap-1">
                {tpl.is_default ? (
                  <Badge className="bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                    {t("templates.default")}
                  </Badge>
                ) : (
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={() => handleSetDefault(tpl.id)}
                    title={t("templates.set_as_default")}
                    aria-label={t("a11y.set_default")}
                  >
                    <Star className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground mb-3">
                {tpl.description || t("templates.no_description")}
              </p>
              <div className="flex gap-1 items-center">
                <Badge variant="secondary" className="capitalize">
                  {tpl.type}
                </Badge>
                <div className="flex-1" />
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={t("common.edit")}
                  onClick={() => navigate(`/settings/templates/${tpl.id}/edit`)}
                >
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                {tpl.type !== "builtin" && !tpl.is_default && (
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label={t("common.delete")}
                    onClick={() => setDeleteConfirm({ open: true, id: tpl.id })}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <ConfirmDialog
        open={deleteConfirm.open}
        onOpenChange={(open) => {
          if (!open) setDeleteConfirm({ open: false, id: null });
        }}
        title={t("templates.delete_title")}
        description={t("templates.delete_description")}
        confirmLabel={t("common.delete")}
        variant="destructive"
        onConfirm={handleDelete}
        loading={deleteLoading}
      />
    </div>
  );
}

// Mustache template variable groups for insert dropdown and reference
const TEMPLATE_VARIABLES = [
  {
    group: "Document",
    vars: [
      { tag: "invoice_number", desc: "Invoice/quote number" },
      { tag: "issue_date", desc: "Formatted issue date" },
      { tag: "due_date", desc: "Formatted due date" },
      { tag: "status", desc: "Document status (draft, sent, paid, etc.)" },
      { tag: "currency", desc: "Currency code (e.g. USD)" },
      { tag: "is_quote", desc: "Boolean — true for quotes" },
      { tag: "document_title", desc: '"Quote" when is_quote is true' },
    ],
  },
  {
    group: "Company",
    vars: [
      { tag: "company.name", desc: "Company name" },
      { tag: "company.logo", desc: "Company logo (data URI or URL)" },
      { tag: "company.email", desc: "Company email" },
      { tag: "company.phone", desc: "Company phone" },
      { tag: "company.address", desc: "Company address (HTML, <br> separated)" },
      { tag: "company.tax_id", desc: "Company tax/VAT ID" },
      { tag: "company.bank_details", desc: "Bank details (HTML, <br> separated)" },
    ],
  },
  {
    group: "Customer",
    vars: [
      { tag: "customer.name", desc: "Customer name" },
      { tag: "customer.email", desc: "Customer email" },
      { tag: "customer.phone", desc: "Customer phone" },
      { tag: "customer.address_line1", desc: "Address line 1" },
      { tag: "customer.address_line2", desc: "Address line 2" },
      { tag: "customer.city", desc: "City" },
      { tag: "customer.state", desc: "State/province" },
      { tag: "customer.postal_code", desc: "Postal/ZIP code" },
      { tag: "customer.country", desc: "Country code (ISO)" },
      { tag: "customer.tax_id", desc: "Customer tax/VAT ID" },
    ],
  },
  {
    group: "Line Items",
    section: true,
    vars: [
      { tag: "description", desc: "Item description" },
      { tag: "quantity", desc: "Quantity" },
      { tag: "unit", desc: "Unit (piece, hour, kg, etc.)" },
      { tag: "unit_price", desc: "Raw unit price number" },
      { tag: "formatted_unit_price", desc: "Formatted unit price" },
      { tag: "tax_rate", desc: "Tax rate percentage" },
      { tag: "line_total", desc: "Raw line total number" },
      { tag: "formatted_line_total", desc: "Formatted line total" },
    ],
  },
  {
    group: "Totals",
    vars: [
      { tag: "formatted_subtotal", desc: "Formatted subtotal" },
      { tag: "has_discount", desc: "Boolean — true when discount > 0" },
      { tag: "formatted_discount", desc: "Formatted discount amount" },
      { tag: "formatted_total", desc: "Formatted grand total" },
    ],
  },
  {
    group: "Tax Summary",
    section: true,
    vars: [
      { tag: "name", desc: "Tax name (e.g. VAT)" },
      { tag: "rate", desc: "Tax rate percentage" },
      { tag: "formatted_amount", desc: "Formatted tax amount" },
    ],
  },
  {
    group: "Other",
    vars: [
      { tag: "payment_terms", desc: "Payment terms text" },
      { tag: "notes", desc: "Invoice/quote notes" },
    ],
  },
  {
    group: "QR Code (optional)",
    vars: [
      { tag: "qr", desc: "Truthy when QR codes are enabled and the document is published" },
      { tag: "qr.image", desc: 'QR code as a data URI — use as <img src="...">' },
      { tag: "qr.url", desc: "The public share URL the QR code points at" },
    ],
  },
];

function TemplateEditor({
  template,
  onSave,
  onCancel,
}: {
  template: any;
  onSave: (data: any) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState(template?.name || "");
  const [description, setDescription] = useState(template?.description || "");
  const [htmlContent, setHtmlContent] = useState(template?.html_content || "");
  const [cssContent] = useState(template?.css_content || "");
  const [previewHtml, setPreviewHtml] = useState("");
  const [previewLoading, setPreviewLoading] = useState(false);
  const previewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const htmlEditorRef = useRef<CodeEditorHandle>(null);
  const [refDialogOpen, setRefDialogOpen] = useState(false);
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);
  const [resetLoading, setResetLoading] = useState(false);
  const [testPdfLoading, setTestPdfLoading] = useState(false);

  const isBuiltin = template?.type === "builtin";

  const handleTestPdf = async () => {
    setTestPdfLoading(true);
    try {
      const token = getAuthToken();
      const url = template?.id
        ? `/api/v1/templates/${template.id}/preview`
        : "/api/v1/templates/preview";
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          html_content: htmlContent,
          css_content: cssContent,
        }),
      });
      if (!res.ok) throw new Error(`Preview failed: ${res.status}`);
      const html = await res.text();
      // Open in a new tab via Blob URL so the user can use the browser's
      // print dialog (Cmd/Ctrl+P) to save as PDF without saving the template.
      const blob = new Blob([html], { type: "text/html" });
      const blobUrl = URL.createObjectURL(blob);
      const win = window.open(blobUrl, "_blank");
      // Revoke the URL once the window has had time to load it.
      setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
      if (!win) {
        toast.error(t("templates.test_pdf_failed"));
      }
    } catch (err: unknown) {
      toast.error(formatApiError(err, t));
    } finally {
      setTestPdfLoading(false);
    }
  };

  const handleReset = async () => {
    if (!template?.id) return;
    setResetLoading(true);
    try {
      const res = await api.getBundledTemplate(template.id);
      setHtmlContent(res.data.html_content);
      toast.success(t("templates.reset_done"));
    } catch (err: unknown) {
      toast.error(formatApiError(err, t));
    } finally {
      setResetLoading(false);
      setResetConfirmOpen(false);
    }
  };

  const insertVariable = (tag: string, group?: { section?: boolean; group: string }) => {
    setTimeout(() => {
      let snippet: string;
      if (group?.group === "Line Items") {
        snippet = `{{${tag}}}`;
      } else if (group?.group === "Tax Summary") {
        snippet = `{{${tag}}}`;
      } else if (tag === "company.logo") {
        snippet = `{{#company.logo}}<img src="{{company.logo}}" alt="" style="max-height:60px;">{{/company.logo}}`;
      } else if (tag === "qr") {
        snippet = `{{#qr}}<img src="{{qr.image}}" alt="" style="width:25mm;height:25mm">{{/qr}}`;
      } else if (tag === "has_discount") {
        snippet = `{{#has_discount}}...{{/has_discount}}`;
      } else if (tag === "is_quote") {
        snippet = `{{#is_quote}}...{{/is_quote}}`;
      } else {
        snippet = `{{${tag}}}`;
      }
      htmlEditorRef.current?.insertAtCursor(snippet);
    }, 0);
  };

  // Live preview with debounce
  useEffect(() => {
    if (previewTimerRef.current) {
      clearTimeout(previewTimerRef.current);
    }

    previewTimerRef.current = setTimeout(async () => {
      if (!htmlContent.trim()) {
        setPreviewHtml("");
        return;
      }

      setPreviewLoading(true);
      try {
        const token = getAuthToken();
        const url = template?.id
          ? `/api/v1/templates/${template.id}/preview`
          : "/api/v1/templates/preview";

        const res = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({
            html_content: htmlContent,
            css_content: cssContent,
          }),
        });
        const html = await res.text();
        setPreviewHtml(html);
      } catch {
        // Fallback to raw HTML
        const fullHtml = cssContent ? `<style>${cssContent}</style>${htmlContent}` : htmlContent;
        setPreviewHtml(fullHtml);
      } finally {
        setPreviewLoading(false);
      }
    }, 600);

    return () => {
      if (previewTimerRef.current) {
        clearTimeout(previewTimerRef.current);
      }
    };
  }, [htmlContent, cssContent, template?.id]);

  return (
    <div className="space-y-4 h-[calc(100vh-7rem)] flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" aria-label={t("common.back")} onClick={onCancel}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h1 className="text-2xl font-bold tracking-tight">
            {template ? t("templates.edit_template") : t("templates.new_template")}
          </h1>
        </div>
        <div className="flex gap-2">
          {isBuiltin && (
            <Button
              variant="outline"
              onClick={() => setResetConfirmOpen(true)}
              title={t("templates.reset_to_default")}
            >
              <RotateCcw className="h-4 w-4 mr-1" /> {t("templates.reset_to_default")}
            </Button>
          )}
          <Button
            variant="outline"
            onClick={handleTestPdf}
            disabled={testPdfLoading || !htmlContent.trim()}
            title={t("templates.test_pdf")}
          >
            <FileText className="h-4 w-4 mr-1" />
            {testPdfLoading ? t("templates.test_pdf_loading") : t("templates.test_pdf")}
          </Button>
          <Button
            onClick={() =>
              onSave({
                id: template?.id,
                name,
                description,
                html_content: htmlContent,
                css_content: cssContent,
              })
            }
          >
            <Save className="h-4 w-4 mr-1" /> {t("common.save")}
          </Button>
          <Button variant="outline" onClick={onCancel}>
            {t("common.cancel")}
          </Button>
        </div>
      </div>

      <ConfirmDialog
        open={resetConfirmOpen}
        onOpenChange={setResetConfirmOpen}
        title={t("templates.reset_to_default")}
        description={t("templates.reset_confirm_description")}
        confirmLabel={t("templates.reset_to_default")}
        onConfirm={handleReset}
        loading={resetLoading}
      />

      {/* Name & Description */}
      <div className="grid grid-cols-2 gap-4 shrink-0">
        <FormField label={t("templates.name")} required>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("templates.name_placeholder")}
          />
        </FormField>
        <FormField label={t("templates.description")}>
          <Input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={t("templates.description_placeholder")}
          />
        </FormField>
      </div>

      {/* Editor + Preview split */}
      <div className="grid grid-cols-2 gap-4 flex-1 min-h-0">
        {/* Editor side */}
        <div className="flex flex-col min-h-0">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {t("templates.html_mustache")}
            </span>

            <div className="flex-1" />

            {/* Insert Variable dropdown */}
            <DropdownMenu>
              <DropdownMenuTrigger className="inline-flex items-center justify-center gap-1 rounded-md border border-input bg-background px-2.5 py-1 text-xs font-medium shadow-xs hover:bg-accent hover:text-accent-foreground cursor-pointer transition-colors">
                {t("templates.insert_variable")}
                <ChevronDown className="h-3 w-3" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="max-h-80 overflow-y-auto !w-72">
                {TEMPLATE_VARIABLES.map((group, gi) => (
                  <React.Fragment key={group.group}>
                    {gi > 0 && <DropdownMenuSeparator />}
                    <DropdownMenuGroup>
                      <DropdownMenuLabel className="text-xs">{group.group}</DropdownMenuLabel>
                      {group.vars.map((v) => (
                        <DropdownMenuItem
                          key={v.tag}
                          className="text-xs gap-2 justify-between"
                          onClick={() => insertVariable(v.tag, group)}
                        >
                          <code className="bg-muted px-1 rounded text-[11px]">
                            {"{{"}
                            {v.tag}
                            {"}}"}
                          </code>
                          <span className="text-muted-foreground truncate ml-1">{v.desc}</span>
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuGroup>
                  </React.Fragment>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Variable Reference dialog */}
            <Button
              variant="ghost"
              size="sm"
              className="text-xs gap-1"
              onClick={() => setRefDialogOpen(true)}
            >
              <BookOpen className="h-3.5 w-3.5" />
              {t("templates.variable_reference")}
            </Button>
            <Dialog open={refDialogOpen} onOpenChange={setRefDialogOpen}>
              <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>{t("templates.variable_reference")}</DialogTitle>
                </DialogHeader>
                <div className="space-y-5 text-sm">
                  <p className="text-muted-foreground">{t("templates.variable_reference_desc")}</p>
                  {TEMPLATE_VARIABLES.map((group) => (
                    <div key={group.group}>
                      <h3 className="font-semibold mb-2">{group.group}</h3>
                      {group.section && (
                        <p className="text-xs text-muted-foreground mb-2">
                          {group.group === "Line Items"
                            ? t("templates.line_items_hint")
                            : t("templates.tax_summary_hint")}
                        </p>
                      )}
                      <div className="border rounded-md overflow-hidden">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="bg-muted/50 border-b">
                              <th className="text-left px-3 py-1.5 font-medium">
                                {t("templates.variable_tag")}
                              </th>
                              <th className="text-left px-3 py-1.5 font-medium">
                                {t("templates.description")}
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {group.vars.map((v) => (
                              <tr key={v.tag} className="border-b last:border-0">
                                <td className="px-3 py-1.5">
                                  <code className="bg-muted px-1.5 py-0.5 rounded text-[11px]">
                                    {"{{"}
                                    {v.tag}
                                    {"}}"}
                                  </code>
                                </td>
                                <td className="px-3 py-1.5 text-muted-foreground">{v.desc}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ))}
                  <div>
                    <h3 className="font-semibold mb-2">{t("templates.mustache_syntax")}</h3>
                    <div className="space-y-2 text-xs text-muted-foreground">
                      <p>
                        <code className="bg-muted px-1.5 py-0.5 rounded">{"{{variable}}"}</code> —{" "}
                        {t("templates.syntax_output")}
                      </p>
                      <p>
                        <code className="bg-muted px-1.5 py-0.5 rounded">{"{{{variable}}}"}</code> —{" "}
                        {t("templates.syntax_unescaped")}
                      </p>
                      <p>
                        <code className="bg-muted px-1.5 py-0.5 rounded">
                          {"{{#section}}...{{/section}}"}
                        </code>{" "}
                        — {t("templates.syntax_section")}
                      </p>
                      <p>
                        <code className="bg-muted px-1.5 py-0.5 rounded">
                          {"{{^section}}...{{/section}}"}
                        </code>{" "}
                        — {t("templates.syntax_inverted")}
                      </p>
                    </div>
                  </div>
                </div>
              </DialogContent>
            </Dialog>
          </div>

          <div className="flex-1 mt-2 min-h-0">
            <CodeEditor
              ref={htmlEditorRef}
              value={htmlContent}
              onChange={setHtmlContent}
              language="html"
              className="h-full"
            />
          </div>
        </div>

        {/* Preview side */}
        <div className="flex flex-col min-h-0">
          <div className="flex items-center gap-2 h-8 mb-2">
            <Eye className="h-4 w-4 text-muted-foreground" />
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {t("templates.live_preview")}
            </span>
            {previewLoading && (
              <div
                className="h-3 w-3 border-2 border-primary border-t-transparent rounded-full animate-spin"
                role="status"
                aria-label={t("common.loading")}
              />
            )}
          </div>
          <div className="flex-1 border rounded-lg overflow-hidden bg-white min-h-0">
            {previewHtml ? (
              <iframe
                srcDoc={previewHtml}
                className="w-full h-full"
                title="Template Preview"
                sandbox="allow-same-origin"
              />
            ) : (
              <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
                {t("templates.start_typing")}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
