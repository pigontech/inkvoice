import { AlertCircle, CheckCircle2, FileUp, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api } from "@/api/client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useTranslation } from "@/i18n";
import { formatApiError } from "@/lib/format-api-error";

type Resource = "customers" | "products" | "expenses";

const TITLE_KEYS: Record<Resource, string> = {
  customers: "import.title_customers",
  products: "import.title_products",
  expenses: "import.title_expenses",
};

interface PreviewData {
  headers: string[];
  sample_rows: string[][];
  total_rows: number;
  suggested_mapping: Record<string, string>;
  available_fields: readonly string[];
}

interface DryRunResult {
  would_create: number;
  errors: { row: number; reason: string }[];
}

interface ImportResult {
  created: number;
  failed: number;
  errors: { row: number; reason: string }[];
}

interface Props {
  resource: Resource;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported: () => void;
}

export function CsvImportDialog({ resource, open, onOpenChange, onImported }: Props) {
  const { t } = useTranslation();
  const [step, setStep] = useState<"upload" | "map" | "preview" | "done">("upload");
  const [file, setFile] = useState<File | null>(null);
  const [csvText, setCsvText] = useState<string>("");
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [dryRun, setDryRun] = useState<DryRunResult | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState(false);

  // Reset state every time the dialog re-opens
  useEffect(() => {
    if (!open) {
      setStep("upload");
      setFile(null);
      setCsvText("");
      setPreview(null);
      setMapping({});
      setDryRun(null);
      setResult(null);
      setBusy(false);
    }
  }, [open]);

  const handleFileSelect = async (selectedFile: File) => {
    setFile(selectedFile);
    setBusy(true);
    try {
      const text = await selectedFile.text();
      setCsvText(text);
      const res = await api.previewCsvImport(resource, selectedFile);
      if (!res.success) {
        toast.error(res.error || t("import.preview_failed"));
        return;
      }
      setPreview(res.data);
      setMapping(res.data.suggested_mapping);
      setStep("map");
    } catch (err) {
      toast.error(formatApiError(err, t));
    } finally {
      setBusy(false);
    }
  };

  const handleDryRun = async () => {
    if (!preview) return;
    setBusy(true);
    try {
      const res = await api.runCsvImport(resource, {
        csv: csvText,
        mapping,
        dry_run: true,
      });
      if (!res.success || !res.data) {
        toast.error(t("import.preview_failed"));
        return;
      }
      setDryRun({
        would_create: res.data.would_create ?? 0,
        errors: res.data.errors ?? [],
      });
      setStep("preview");
    } catch (err) {
      toast.error(formatApiError(err, t));
    } finally {
      setBusy(false);
    }
  };

  const handleConfirmImport = async () => {
    setBusy(true);
    try {
      const res = await api.runCsvImport(resource, {
        csv: csvText,
        mapping,
        dry_run: false,
      });
      if (!res.success) {
        toast.error(t("import.import_failed"));
        return;
      }
      setResult({
        created: res.data.created ?? 0,
        failed: res.data.failed ?? 0,
        errors: res.data.errors ?? [],
      });
      setStep("done");
      onImported();
    } catch (err) {
      toast.error(formatApiError(err, t));
    } finally {
      setBusy(false);
    }
  };

  const isMappingValid = Object.values(mapping).includes("name");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t(TITLE_KEYS[resource])}</DialogTitle>
        </DialogHeader>

        {step === "upload" && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">{t("import.upload_description")}</p>
            <label
              htmlFor={`csv-file-${resource}`}
              className="flex flex-col items-center justify-center border-2 border-dashed border-border rounded-md p-8 cursor-pointer hover:bg-accent/50 transition-colors"
            >
              <FileUp className="h-8 w-8 text-muted-foreground mb-2" />
              <span className="text-sm text-muted-foreground">{t("import.choose_file")}</span>
              <span className="text-xs text-muted-foreground mt-1">{t("import.csv_only")}</span>
              <input
                id={`csv-file-${resource}`}
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleFileSelect(f);
                }}
              />
            </label>
            {busy && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> {t("import.parsing")}
              </div>
            )}
          </div>
        )}

        {step === "map" && preview && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {t("import.map_description", {
                rows: String(preview.total_rows),
                file: file?.name ?? "",
              })}
            </p>
            <div className="border border-border rounded-md max-h-72 overflow-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-muted">
                  <tr>
                    <th className="text-left p-2 font-medium">{t("import.csv_column")}</th>
                    <th className="text-left p-2 font-medium">{t("import.sample")}</th>
                    <th className="text-left p-2 font-medium">{t("import.maps_to")}</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.headers.map((header, i) => (
                    <tr key={`${header}-${i}`} className="border-t border-border">
                      <td className="p-2 font-medium">{header}</td>
                      <td className="p-2 text-muted-foreground truncate max-w-[200px]">
                        {preview.sample_rows[0]?.[i] ?? ""}
                      </td>
                      <td className="p-2">
                        <select
                          className="bg-background border border-input rounded px-2 py-1 text-sm w-full"
                          value={mapping[String(i)] ?? ""}
                          onChange={(e) => {
                            const v = e.target.value;
                            setMapping((prev) => {
                              const next = { ...prev };
                              if (v) next[String(i)] = v;
                              else delete next[String(i)];
                              return next;
                            });
                          }}
                        >
                          <option value="">{t("import.skip_column")}</option>
                          {preview.available_fields.map((f) => (
                            <option key={f} value={f}>
                              {f}
                            </option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!isMappingValid && (
              <p className="text-sm text-destructive flex items-center gap-1.5">
                <AlertCircle className="h-4 w-4" /> {t("import.name_required")}
              </p>
            )}
          </div>
        )}

        {step === "preview" && dryRun && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm">
              <CheckCircle2 className="h-5 w-5 text-emerald-600" />
              <span>
                {t("import.dry_run_summary", {
                  count: String(dryRun.would_create),
                })}
              </span>
            </div>
            {dryRun.errors.length > 0 && (
              <div className="space-y-1">
                <p className="text-sm font-medium text-destructive flex items-center gap-1.5">
                  <AlertCircle className="h-4 w-4" />{" "}
                  {t("import.error_count", { count: String(dryRun.errors.length) })}
                </p>
                <div className="border border-destructive/30 rounded-md max-h-48 overflow-auto bg-destructive/5">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-destructive/10">
                      <tr>
                        <th className="text-left p-2 w-20">{t("import.row")}</th>
                        <th className="text-left p-2">{t("import.reason")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dryRun.errors.slice(0, 50).map((err) => (
                        <tr
                          key={`${err.row}-${err.reason}`}
                          className="border-t border-destructive/20"
                        >
                          <td className="p-2 tabular-nums">{err.row}</td>
                          <td className="p-2">{err.reason}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {step === "done" && result && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm">
              <CheckCircle2 className="h-5 w-5 text-emerald-600" />
              <span>{t("import.success_summary", { count: String(result.created) })}</span>
            </div>
            {result.failed > 0 && (
              <p className="text-sm text-muted-foreground">
                {t("import.error_count", { count: String(result.failed) })}
              </p>
            )}
          </div>
        )}

        <DialogFooter>
          {step === "upload" && (
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              {t("common.cancel")}
            </Button>
          )}
          {step === "map" && (
            <>
              <Button variant="ghost" onClick={() => setStep("upload")}>
                {t("common.back")}
              </Button>
              <Button disabled={!isMappingValid || busy} onClick={handleDryRun}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                {t("import.preview_button")}
              </Button>
            </>
          )}
          {step === "preview" && dryRun && (
            <>
              <Button variant="ghost" onClick={() => setStep("map")}>
                {t("common.back")}
              </Button>
              <Button disabled={dryRun.would_create === 0 || busy} onClick={handleConfirmImport}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                {t("import.confirm_button", { count: String(dryRun.would_create) })}
              </Button>
            </>
          )}
          {step === "done" && (
            <Button onClick={() => onOpenChange(false)}>{t("common.close")}</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
