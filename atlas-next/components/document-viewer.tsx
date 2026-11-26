"use client";

import {
  ChevronLeft,
  ChevronRight,
  Download,
  ExternalLink,
  FileText,
  ImageIcon,
  Loader2,
  Maximize,
  Printer,
  RotateCw,
  Trash2,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, Dialog } from "@/components/ui/dialog";
import { PdfPages, pdfPageImages, type PdfInfo } from "@/components/pdf-pages";
import { authedFetch, errorMessage, parseError } from "@/lib/api";
import { fmtDate } from "@/lib/format";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/** Only these render inline; anything else (SVG, HTML, Office) is download-only. */
const PREVIEW_PDF = "application/pdf";
const PREVIEW_IMAGES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
export const UPLOAD_TYPES = new Set(["application/pdf", "image/jpeg", "image/png"]);
export const UPLOAD_MAX_BYTES = 25 * 1024 * 1024;
const ZOOM_STEPS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];

export type ViewerDoc = {
  key: string;
  name: string;
  label?: string;
  contentType?: string | null;
  sizeBytes?: number | null;
  createdAt?: string | null;
  /** Stored attachment id, a local file chosen but not uploaded yet, or a document generated on open. */
  source: { attachmentId: string } | { file: File } | { load: () => Promise<Blob> };
  removable?: boolean;
};

type Loaded = { url: string; type: string; blob: Blob };

/**
 * Phone and tablet browsers (Android Chrome, iOS Safari) cannot show a PDF inside an iframe:
 * Android shows nothing and iOS shows only page one. Only desktop browsers with a built-in
 * PDF viewer get the iframe; everyone else gets pages drawn with pdf.js.
 */
function canEmbedPdf(): boolean {
  if (typeof window === "undefined") return false;
  const nav = navigator as Navigator & { pdfViewerEnabled?: boolean };
  return nav.pdfViewerEnabled === true && !window.matchMedia("(pointer: coarse)").matches;
}

function isTouch(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;
}

function printImages(urls: string[], title: string, cleanup?: () => void) {
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0";
  const safeTitle = title.replace(/[<>&"]/g, "");
  const pages = urls.map((url) => `<div class="p"><img src="${url}"></div>`).join("");
  frame.srcdoc = `<!doctype html><title>${safeTitle}</title><style>@page{size:A4 portrait;margin:12mm 14mm 16mm 14mm}html,body{margin:0;padding:0;background:#fff}.p{display:flex;justify-content:center;align-items:flex-start;break-after:page;width:100%;box-sizing:border-box}.p:last-child{break-after:auto}img{width:100%;max-width:100%;height:auto;object-fit:contain}</style>${pages}`;
  frame.onload = () => {
    frame.contentWindow?.focus();
    frame.contentWindow?.print();
    window.setTimeout(() => {
      frame.remove();
      cleanup?.();
    }, 60_000);
  };
  document.body.appendChild(frame);
}

export function formatBytes(bytes?: number | null): string {
  if (bytes == null || !Number.isFinite(bytes)) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Returns an error key when a picked file cannot be uploaded, else null. */
export function uploadProblem(file: File): "type" | "size" | "empty" | null {
  if (file.size === 0) return "empty";
  if (file.size > UPLOAD_MAX_BYTES) return "size";
  if (!UPLOAD_TYPES.has((file.type || "").toLowerCase())) return "type";
  return null;
}

function previewKind(type: string): "pdf" | "image" | "none" {
  const mime = type.split(";")[0].trim().toLowerCase();
  if (mime === PREVIEW_PDF) return "pdf";
  if (PREVIEW_IMAGES.has(mime)) return "image";
  return "none";
}

export function DocumentViewer({
  docs,
  index,
  onIndexChange,
  onClose,
  onRemove,
  title,
}: {
  docs: ViewerDoc[];
  index: number | null;
  onIndexChange: (index: number) => void;
  onClose: () => void;
  onRemove?: (doc: ViewerDoc) => Promise<void>;
  title?: string;
}) {
  const t = useT();
  const open = index !== null && docs.length > 0;
  const current = open ? docs[Math.min(index, docs.length - 1)] : null;
  const cache = useRef(new Map<string, Loaded>());
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [zoom, setZoom] = useState<number | "fit">("fit");
  const [rotation, setRotation] = useState(0);
  const [natural, setNatural] = useState({ w: 0, h: 0 });
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [embedPdf] = useState(canEmbedPdf);
  const [touch] = useState(isTouch);
  const [stage, setStage] = useState<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const attachStage = useCallback((el: HTMLDivElement | null) => {
    stageRef.current = el;
    setStage(el);
  }, []);
  const pdfRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    if (open) return;
    for (const item of cache.current.values()) URL.revokeObjectURL(item.url);
    cache.current.clear();
  }, [open]);

  useEffect(() => {
    const store = cache.current;
    return () => {
      for (const item of store.values()) URL.revokeObjectURL(item.url);
      store.clear();
    };
  }, []);

  const currentRef = useRef(current);
  currentRef.current = current;
  const currentKey = current?.key ?? null;

  useEffect(() => {
    const current = currentRef.current;
    if (!current || currentKey === null) return;
    setZoom("fit");
    setRotation(0);
    setNatural({ w: 0, h: 0 });
    setError(null);
    const hit = cache.current.get(current.key);
    if (hit) {
      setLoaded(hit);
      setLoading(false);
      return;
    }
    setLoaded(null);
    setLoading(true);
    let cancelled = false;
    (async () => {
      try {
        let blob: Blob;
        let type = (current.contentType || "").toLowerCase();
        if ("file" in current.source) {
          blob = current.source.file;
          type = (current.source.file.type || type).toLowerCase();
        } else if ("load" in current.source) {
          blob = await current.source.load();
          type = type || blob.type.toLowerCase();
        } else {
          const resp = await authedFetch(`/attachments/${current.source.attachmentId}/content`);
          if (!resp.ok) throw await parseError(resp);
          blob = await resp.blob();
          type = type || (resp.headers.get("Content-Type") || "").toLowerCase();
        }
        // Re-type the bytes with the verified stored type so the browser never sniffs another.
        const typed = new Blob([blob], { type: type || "application/octet-stream" });
        const item = { url: URL.createObjectURL(typed), type, blob: typed };
        if (cancelled) {
          URL.revokeObjectURL(item.url);
          return;
        }
        cache.current.set(current.key, item);
        setLoaded(item);
      } catch (err) {
        if (!cancelled) setError(errorMessage(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [currentKey, attempt]);

  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const measure = () => setBox({ w: stage.clientWidth, h: stage.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(stage);
    return () => observer.disconnect();
  }, [open, loaded]);

  const kind = loaded ? previewKind(loaded.type) : "none";
  const drawnPdf = kind === "pdf" && !embedPdf;
  const zoomable = kind === "image" || drawnPdf;
  const turned = rotation % 180 !== 0;
  const fitScale = useMemo(() => {
    if (!natural.w || !natural.h || !box.w || !box.h) return 1;
    const w = turned ? natural.h : natural.w;
    const h = turned ? natural.w : natural.h;
    // PDF pages fit the width and scroll down; images fit the whole box.
    if (drawnPdf) return Math.min(Math.max((box.w - 32) / w, 0.1), 1.5);
    return Math.min((box.w - 32) / w, (box.h - 32) / h, 1);
  }, [natural, box, turned, drawnPdf]);
  const onPdfInfo = useCallback((info: PdfInfo) => setNatural(info.first), []);
  const onPdfError = useCallback((message: string) => setError(message), []);
  const scale = zoom === "fit" ? fitScale : zoom;

  const step = useCallback(
    (dir: 1 | -1) => {
      setZoom((z) => {
        const now = z === "fit" ? fitScale : z;
        const next = dir > 0 ? ZOOM_STEPS.find((s) => s > now + 0.001) : [...ZOOM_STEPS].reverse().find((s) => s < now - 0.001);
        return next ?? now;
      });
    },
    [fitScale]
  );

  const go = useCallback(
    (dir: 1 | -1) => {
      if (index === null || docs.length < 2) return;
      onIndexChange((index + dir + docs.length) % docs.length);
    },
    [index, docs.length, onIndexChange]
  );

  useEffect(() => {
    if (!open || confirmRemove) return;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key === "ArrowRight") go(1);
      else if (event.key === "ArrowLeft") go(-1);
      else if (!zoomable) return;
      else if (event.key === "+" || event.key === "=") step(1);
      else if (event.key === "-") step(-1);
      else if (event.key === "0") setZoom("fit");
      else if (event.key.toLowerCase() === "r") setRotation((r) => (r + (event.shiftKey ? 270 : 90)) % 360);
      else return;
      event.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, go, step, zoomable, confirmRemove]);

  const download = () => {
    if (!loaded || !current) return;
    const anchor = document.createElement("a");
    anchor.href = loaded.url;
    anchor.download = current.name;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  };

  const print = async () => {
    if (!loaded) return;
    const name = current?.name ?? "";
    if (kind === "image") {
      printImages([loaded.url], name);
      return;
    }
    if (kind !== "pdf") return;
    if (embedPdf) {
      const win = pdfRef.current?.contentWindow;
      win?.focus();
      win?.print();
      return;
    }
    setPrinting(true);
    try {
      const pages = await pdfPageImages(loaded.blob);
      printImages(pages, name, () => pages.forEach((url) => URL.revokeObjectURL(url)));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPrinting(false);
    }
  };

  const remove = async () => {
    if (!current || !onRemove) return;
    setRemoving(true);
    try {
      await onRemove(current);
      const hit = cache.current.get(current.key);
      if (hit) URL.revokeObjectURL(hit.url);
      cache.current.delete(current.key);
      setConfirmRemove(false);
    } finally {
      setRemoving(false);
    }
  };

  const shownW = natural.w * scale;
  const shownH = natural.h * scale;
  const frameW = turned ? shownH : shownW;
  const frameH = turned ? shownW : shownH;

  return (
    <>
      <Dialog
        open={open}
        onClose={onClose}
        size="full"
        scroll="content"
        title={current ? `${current.label ? `${current.label} · ` : ""}${current.name}` : (title ?? t("viewer.title"))}
        description={
          current
            ? [
                docs.length > 1 ? `${(index ?? 0) + 1} / ${docs.length}` : null,
                formatBytes(current.sizeBytes ?? ("file" in current.source ? current.source.file.size : null)),
                "file" in current.source ? t("viewer.notUploaded") : current.createdAt ? fmtDate(current.createdAt) : null,
              ]
                .filter(Boolean)
                .join(" · ")
            : undefined
        }
      >
        <div className="flex min-h-0 flex-1 flex-col gap-3" data-testid="document-viewer">
          <div className="flex flex-wrap items-center gap-2" role="toolbar" aria-label={t("viewer.title")}>
            {docs.length > 1 ? (
              <div className="flex items-center gap-1">
                <Button size="sm" variant="outline" onClick={() => go(-1)} aria-label={t("viewer.prev")}>
                  <ChevronLeft size={15} />
                </Button>
                <Button size="sm" variant="outline" onClick={() => go(1)} aria-label={t("viewer.next")}>
                  <ChevronRight size={15} />
                </Button>
              </div>
            ) : null}
            {zoomable ? (
              <div className="flex items-center gap-1">
                <Button size="sm" variant="outline" onClick={() => step(-1)} aria-label={t("viewer.zoomOut")}>
                  <ZoomOut size={15} />
                </Button>
                <span className="w-14 text-center text-xs font-semibold tabular-nums" aria-live="polite">
                  {Math.round(scale * 100)}%
                </span>
                <Button size="sm" variant="outline" onClick={() => step(1)} aria-label={t("viewer.zoomIn")}>
                  <ZoomIn size={15} />
                </Button>
                <Button
                  size="sm"
                  variant={zoom === "fit" ? "secondary" : "outline"}
                  onClick={() => setZoom("fit")}
                  aria-label={t("viewer.fit")}
                >
                  <Maximize size={15} />
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setRotation((r) => (r + 90) % 360)}
                  aria-label={t("viewer.rotate")}
                >
                  <RotateCw size={15} />
                </Button>
              </div>
            ) : null}
            <div className="ml-auto flex items-center gap-1">
              <Button
                size="sm"
                variant="gradient"
                disabled={!loaded || kind === "none" || printing}
                onClick={() => void print()}
                data-testid="viewer-print"
              >
                {printing ? <Loader2 size={15} className="animate-spin" /> : <Printer size={15} />} {t("viewer.print")}
              </Button>
              <Button size="sm" variant="outline" disabled={!loaded} onClick={download} data-testid="viewer-download">
                <Download size={15} /> {t("viewer.download")}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={!loaded || kind === "none"}
                onClick={() => loaded && window.open(loaded.url, "_blank", "noopener")}
              >
                <ExternalLink size={15} /> {t("viewer.newTab")}
              </Button>
              {onRemove && current?.removable ? (
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => setConfirmRemove(true)}
                  data-testid="viewer-remove"
                >
                  <Trash2 size={15} /> {t("viewer.remove")}
                </Button>
              ) : null}
            </div>
          </div>

          <div className="flex min-h-0 flex-1 gap-3">
            {docs.length > 1 ? (
              <nav aria-label={t("viewer.files")} className="hidden w-48 shrink-0 flex-col gap-1.5 overflow-y-auto overscroll-contain md:flex">
                {docs.map((doc, i) => {
                  const type = ("file" in doc.source ? doc.source.file.type : doc.contentType) || "";
                  const Icon = previewKind(type) === "image" ? ImageIcon : FileText;
                  return (
                    <button
                      key={doc.key}
                      type="button"
                      aria-current={i === index ? "true" : undefined}
                      onClick={() => onIndexChange(i)}
                      className={cn(
                        "flex items-start gap-2 rounded-[var(--radius-sm)] border p-2 text-left text-xs transition-colors",
                        i === index
                          ? "border-[var(--color-primary)] bg-[var(--color-primary-muted)]"
                          : "border-[var(--color-border)] hover:bg-[var(--color-secondary)]"
                      )}
                    >
                      <Icon size={15} className="mt-0.5 shrink-0 text-[var(--color-primary)]" />
                      <span className="min-w-0">
                        {doc.label ? <span className="block font-semibold">{doc.label}</span> : null}
                        <span className="block truncate text-[var(--color-muted-foreground)]">{doc.name}</span>
                      </span>
                    </button>
                  );
                })}
              </nav>
            ) : null}

            <div
              ref={attachStage}
              className="relative min-h-0 flex-1 overflow-auto overscroll-contain rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-secondary)]"
              data-testid="viewer-stage"
            >
              {loading ? (
                <div className="flex h-full items-center justify-center gap-2 text-sm text-[var(--color-muted-foreground)]">
                  <Loader2 size={18} className="animate-spin" /> {t("viewer.loading")}
                </div>
              ) : error ? (
                <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
                  <p className="text-sm text-[var(--color-destructive)]">{error}</p>
                  <Button size="sm" variant="outline" onClick={() => setAttempt((a) => a + 1)}>
                    {t("viewer.retry")}
                  </Button>
                </div>
              ) : loaded && drawnPdf ? (
                <div className="min-h-full" onDoubleClick={() => setZoom((z) => (z === "fit" ? 1 : "fit"))}>
                  <PdfPages
                    blob={loaded.blob}
                    scale={scale}
                    rotation={rotation}
                    title={current?.name ?? "PDF"}
                    scrollRoot={stage}
                    onInfo={onPdfInfo}
                    onError={onPdfError}
                  />
                </div>
              ) : loaded && kind === "pdf" ? (
                <iframe
                  ref={pdfRef}
                  key={loaded.url}
                  src={loaded.url}
                  title={current?.name ?? "PDF"}
                  className="h-full w-full bg-white"
                  data-testid="viewer-pdf"
                />
              ) : loaded && kind === "image" ? (
                <div
                  className="flex min-h-full min-w-full items-center justify-center p-4"
                  onDoubleClick={() => setZoom((z) => (z === "fit" ? 1 : "fit"))}
                >
                  <div className="relative shrink-0" style={{ width: frameW || undefined, height: frameH || undefined }}>
                    <img
                      src={loaded.url}
                      alt={current?.name ?? ""}
                      data-testid="viewer-image"
                      draggable={false}
                      onLoad={(e) =>
                        setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })
                      }
                      className="absolute left-1/2 top-1/2 max-w-none select-none shadow-[var(--shadow-card)] motion-safe:transition-transform"
                      style={{
                        width: shownW || undefined,
                        height: shownH || undefined,
                        transform: `translate(-50%, -50%) rotate(${rotation}deg)`,
                      }}
                    />
                  </div>
                </div>
              ) : loaded ? (
                <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
                  <FileText size={36} className="text-[var(--color-muted-foreground)]" />
                  <p className="text-sm text-[var(--color-muted-foreground)]">{t("viewer.noPreview")}</p>
                  <Button size="sm" variant="outline" onClick={download}>
                    <Download size={15} /> {t("viewer.download")}
                  </Button>
                </div>
              ) : null}
            </div>
          </div>
          {zoomable && !touch ? (
            <p className="text-[11px] text-[var(--color-muted-foreground)]">{t("viewer.keys")}</p>
          ) : null}
        </div>
      </Dialog>
      <ConfirmDialog
        open={confirmRemove}
        onClose={() => setConfirmRemove(false)}
        onConfirm={() => void remove()}
        title={t("viewer.removeTitle")}
        message={current ? `${current.label ? `${current.label}: ` : ""}${current.name} — ${t("viewer.removeBody")}` : ""}
        confirmLabel={t("viewer.remove")}
        destructive
        busy={removing}
      />
    </>
  );
}
