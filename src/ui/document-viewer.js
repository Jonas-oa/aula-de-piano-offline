// Palco do documento. Cuida de dois modos:
//  - PDF: compatibilidade com peças salvas por versões anteriores (PDF.js);
//  - pauta estruturada: delega o desenho ao renderizador SVG próprio.
export class DocumentViewer {
  constructor(container, { onPageChange } = {}) {
    this.container = container;
    this.onPageChange = onPageChange || (() => {});
    this.pdfDocument = null;
    this.page = 1;
    this.scale = 1.25;
    this.renderToken = 0;
  }

  async showPdf(asset) {
    this.clear();
    this.container.className = "document-stage pdf-stage";
    const pdfjs = await import("../../vendor/pdfjs/pdf.min.mjs");
    pdfjs.GlobalWorkerOptions.workerSrc = new URL(
      "../../vendor/pdfjs/pdf.worker.min.mjs",
      import.meta.url,
    ).href;
    const bytes = asset.bytes instanceof ArrayBuffer ? asset.bytes.slice(0) : asset.bytes;
    this.pdfDocument = await pdfjs.getDocument({ data: bytes }).promise;
    this.page = 1;
    await this.renderPdfPage();
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
    if (!this.pdfDocument) return;
    this.scale = Math.max(0.7, Math.min(2.5, this.scale + delta));
    await this.renderPdfPage();
  }

  async renderPdfPage() {
    const token = ++this.renderToken;
    const page = await this.pdfDocument.getPage(this.page);
    if (token !== this.renderToken) return;
    const viewport = page.getViewport({ scale: this.scale });
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
    this.container.replaceChildren();
  }
}
