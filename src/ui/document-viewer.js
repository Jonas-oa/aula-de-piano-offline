import { storedAssetToBlob } from "../core/library-store.js";

export class DocumentViewer {
  constructor(container, { onPageChange } = {}) {
    this.container = container;
    this.onPageChange = onPageChange || (() => {});
    this.pdf = null;
    this.pdfDocument = null;
    this.page = 1;
    this.zoom = 1;
    this.osmd = null;
    this.renderToken = 0;
  }

  async showPdf(asset) {
    this.clear();
    this.container.className = "document-stage pdf-stage";
    this.pdf = asset;
    const pdfjs = await loadPdfJs();
    const bytes = asset.bytes instanceof ArrayBuffer ? asset.bytes.slice(0) : asset.bytes;
    this.pdfDocument = await pdfjs.getDocument({ data: bytes }).promise;
    this.page = 1;
    await this.renderPdfPage();
  }

  async showMusicXml(xmlText) {
    this.clear();
    this.container.className = "document-stage musicxml-stage";
    const namespace = window.opensheetmusicdisplay;
    if (!namespace?.OpenSheetMusicDisplay) {
      throw new Error("O leitor de MusicXML não foi carregado.");
    }
    this.osmd = new namespace.OpenSheetMusicDisplay(this.container, {
      autoResize: true,
      backend: "svg",
      drawTitle: true,
      followCursor: true,
      drawingParameters: "compacttight",
    });
    await this.osmd.load(xmlText);
    this.osmd.Zoom = 0.82;
    this.osmd.render();
    this.onPageChange({ page: 1, pages: 1, type: "musicxml" });
  }

  showRhythm(render) {
    this.clear();
    this.container.className = "document-stage rhythm-stage";
    render(this.container);
    this.onPageChange({ page: 1, pages: 1, type: "rhythm" });
  }

  async nextPage() {
    if (!this.pdfDocument || this.page >= this.pdfDocument.numPages) return;
    this.page += 1;
    await this.renderPdfPage();
  }

  async previousPage() {
    if (!this.pdfDocument || this.page <= 1) return;
    this.page -= 1;
    await this.renderPdfPage();
  }

  async zoomBy(delta) {
    if (this.pdfDocument) {
      this.zoom = Math.max(0.65, Math.min(2.25, this.zoom + delta));
      await this.renderPdfPage();
      return;
    }
    if (this.osmd) {
      this.osmd.Zoom = Math.max(0.4, Math.min(1.8, this.osmd.Zoom + delta));
      this.osmd.render();
    }
  }

  async resize() {
    if (this.pdfDocument) await this.renderPdfPage();
  }

  async renderPdfPage() {
    const token = ++this.renderToken;
    const page = await this.pdfDocument.getPage(this.page);
    if (token !== this.renderToken) return;
    const baseViewport = page.getViewport({ scale: 1 });
    const availableWidth = Math.max(280, this.container.clientWidth - 28);
    const fitScale = availableWidth / baseViewport.width;
    const viewport = page.getViewport({ scale: fitScale * this.zoom });
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d", { alpha: false });
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(viewport.width * ratio);
    canvas.height = Math.floor(viewport.height * ratio);
    canvas.style.width = `${viewport.width}px`;
    canvas.style.height = `${viewport.height}px`;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    this.container.replaceChildren(canvas);
    await page.render({ canvasContext: context, viewport }).promise;
    this.onPageChange({
      page: this.page,
      pages: this.pdfDocument.numPages,
      type: "pdf",
    });
  }

  clear() {
    this.renderToken += 1;
    this.pdfDocument?.destroy?.();
    this.pdfDocument = null;
    this.pdf = null;
    this.osmd = null;
    this.container.replaceChildren();
  }
}

export function assetUrl(asset) {
  return URL.createObjectURL(storedAssetToBlob(asset));
}

export async function inspectPdfAsset(asset) {
  const pdfjs = await loadPdfJs();
  const bytes = asset.bytes instanceof ArrayBuffer ? asset.bytes.slice(0) : asset.bytes;
  const loadingTask = pdfjs.getDocument({ data: bytes });
  const document = await loadingTask.promise;
  try {
    const firstPage = await document.getPage(1);
    const viewport = firstPage.getViewport({ scale: 1 });
    const metadata = await document.getMetadata().catch(() => ({ info: {} }));
    return {
      pageCount: document.numPages,
      pageWidth: Math.round(viewport.width),
      pageHeight: Math.round(viewport.height),
      title: metadata?.info?.Title || "",
      author: metadata?.info?.Author || "",
    };
  } finally {
    await loadingTask.destroy();
  }
}

async function loadPdfJs() {
  const pdfjs = await import("../../vendor/pdfjs/pdf.min.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "../../vendor/pdfjs/pdf.worker.min.mjs",
    import.meta.url,
  ).href;
  return pdfjs;
}
