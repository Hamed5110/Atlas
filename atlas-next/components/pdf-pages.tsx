"use client";

import { Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";

type Pdfjs = typeof import("pdfjs-dist");

/** PDF points are 1/72 in; CSS pixels are 1/96 in, so 100% zoom is 4/3 px per point. */
const PX_PER_PT = 96 / 72;
/** iOS Safari refuses canvases above ~16.7M pixels; stay well under it per page. */
const MAX_CANVAS_PIXELS = 8_000_000;

let pdfjsPromise: Promise<Pdfjs> | null = null;

function loadPdfjs(): Promise<Pdfjs> {
  pdfjsPromise ??= import("pdfjs-dist/legacy/build/pdf.mjs")
    .then((mod) => {
      mod.GlobalWorkerOptions.workerPort = new Worker(
        new URL("pdfjs-dist/legacy/build/pdf.worker.min.mjs", import.meta.url),
        { type: "module" }
      );
      return mod;
    })
    .catch((err) => {
      pdfjsPromise = null;
      throw err;
    });
  return pdfjsPromise;
}

type OpenedPdf = { doc: PDFDocumentProxy; close: () => void };

async function openPdf(blob: Blob): Promise<OpenedPdf> {
  const pdfjs = await loadPdfjs();
  const data = new Uint8Array(await blob.arrayBuffer());
  const task = pdfjs.getDocument({ data });
  const close = () => void task.destroy();
  try {
    return { doc: await task.promise, close };
  } catch (err) {
    close();
    throw err;
  }
}

function isCancelled(err: unknown): boolean {
  return err instanceof Error && err.name === "RenderingCancelledException";
}

/** Page size in CSS pixels at 100%, including the page's own /Rotate. */
type PageSize = { w: number; h: number };
export type PdfInfo = { pages: number; first: PageSize };

/** Renders every page of a PDF to canvases, so PDFs show on phones whose browsers cannot embed them. */
export function PdfPages({
  blob,
  scale,
  rotation,
  title,
  scrollRoot,
  onInfo,
  onError,
}: {
  blob: Blob;
  /** Same meaning as image zoom: 1 = the page's printed size on a 96 dpi screen. */
  scale: number;
  rotation: number;
  title: string;
  /** The scrolling box the pages sit in; pages render as they approach its visible area. */
  scrollRoot: HTMLElement | null;
  onInfo: (info: PdfInfo) => void;
  onError: (message: string) => void;
}) {
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [sizes, setSizes] = useState<PageSize[]>([]);
  const onInfoRef = useRef(onInfo);
  const onErrorRef = useRef(onError);
  onInfoRef.current = onInfo;
  onErrorRef.current = onError;

  useEffect(() => {
    let cancelled = false;
    let opened: OpenedPdf | null = null;
    setDoc(null);
    setSizes([]);
    (async () => {
      try {
        opened = await openPdf(blob);
        if (cancelled) {
          opened.close();
          return;
        }
        const found: PageSize[] = [];
        for (let n = 1; n <= opened.doc.numPages; n++) {
          const page = await opened.doc.getPage(n);
          const viewport = page.getViewport({ scale: PX_PER_PT });
          found.push({ w: viewport.width, h: viewport.height });
          if (cancelled) return;
        }
        if (cancelled) return;
        setDoc(opened.doc);
        setSizes(found);
        onInfoRef.current({ pages: found.length, first: found[0] ?? { w: 0, h: 0 } });
      } catch (err) {
        if (!cancelled) onErrorRef.current(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
      opened?.close();
    };
  }, [blob]);

  if (!doc) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <Loader2 size={18} className="animate-spin text-[var(--color-muted-foreground)]" />
      </div>
    );
  }

  return (
    <div className="flex w-max min-w-full flex-col items-center gap-3 p-4" data-testid="viewer-pdf-pages">
      {sizes.map((size, i) => (
        <PdfPage
          key={i}
          doc={doc}
          number={i + 1}
          size={size}
          scale={scale}
          rotation={rotation}
          label={`${title} — ${i + 1} / ${sizes.length}`}
          scrollRoot={scrollRoot}
        />
      ))}
    </div>
  );
}

function PdfPage({
  doc,
  number,
  size,
  scale,
  rotation,
  label,
  scrollRoot,
}: {
  doc: PDFDocumentProxy;
  number: number;
  size: PageSize;
  scale: number;
  rotation: number;
  label: string;
  scrollRoot: HTMLElement | null;
}) {
  const holderRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [near, setNear] = useState(false);
  const [drawn, setDrawn] = useState(false);
  const turned = rotation % 180 !== 0;
  const width = (turned ? size.h : size.w) * scale;
  const height = (turned ? size.w : size.h) * scale;

  useEffect(() => {
    const holder = holderRef.current;
    if (!holder || near) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setNear(true);
      },
      { root: scrollRoot, rootMargin: "800px 0px" }
    );
    observer.observe(holder);
    return () => observer.disconnect();
  }, [near, scrollRoot]);

  useEffect(() => {
    if (!near) return;
    let cancelled = false;
    let task: RenderTask | null = null;
    (async () => {
      try {
        const page = await doc.getPage(number);
        if (cancelled) return;
        const viewport = page.getViewport({ scale: scale * PX_PER_PT, rotation: (page.rotate + rotation) % 360 });
        const area = viewport.width * viewport.height;
        const ratio = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(MAX_CANVAS_PIXELS / Math.max(area, 1)));
        const canvas = canvasRef.current;
        if (!canvas) return;
        canvas.width = Math.max(1, Math.floor(viewport.width * ratio));
        canvas.height = Math.max(1, Math.floor(viewport.height * ratio));
        task = page.render({
          canvas,
          viewport,
          transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0],
        });
        await task.promise;
        if (!cancelled) setDrawn(true);
      } catch (err) {
        if (!isCancelled(err) && !cancelled) setDrawn(false);
      }
    })();
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [near, doc, number, scale, rotation]);

  return (
    <div
      ref={holderRef}
      className="relative shrink-0 bg-white shadow-[var(--shadow-card)]"
      style={{ width, height }}
    >
      <canvas ref={canvasRef} role="img" aria-label={label} className="block h-full w-full" />
      {!drawn ? (
        <div className="absolute inset-0 flex items-center justify-center">
          <Loader2 size={16} className="animate-spin text-[var(--color-muted-foreground)]" />
        </div>
      ) : null}
    </div>
  );
}

/** Rasterises each page to a PNG object URL, for printing where the PDF itself cannot be embedded. */
export async function pdfPageImages(blob: Blob): Promise<string[]> {
  const { doc, close } = await openPdf(blob);
  try {
    const urls: string[] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      // 2x the 96 dpi size prints at ~190 dpi without huge canvases.
      const viewport = page.getViewport({ scale: PX_PER_PT * 2 });
      const canvas = document.createElement("canvas");
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      await page.render({ canvas, viewport }).promise;
      const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
      if (png) urls.push(URL.createObjectURL(png));
      canvas.width = canvas.height = 0;
    }
    return urls;
  } finally {
    close();
  }
}
