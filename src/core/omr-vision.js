// OMR online opcional ("traga sua chave"): rasteriza as páginas do PDF e pede
// a um modelo de visão para transcrever a partitura em MusicXML. A chave da API
// fica apenas no aparelho do aluno; nada é armazenado em servidor do app.
//
// Limitações: a precisão é imperfeita, sobretudo em piano denso (duas mãos,
// acordes). O resultado deve ser revisado. Requer conexão com a internet.

const OMR_PROMPT = [
  "Você é um sistema de OMR (reconhecimento óptico de partituras).",
  "Recebe as imagens das páginas de uma partitura e deve transcrevê-la em",
  "MusicXML 3.1 no formato score-partwise, o mais fiel possível: alturas,",
  "durações, pausas, compassos, armadura de clave e fórmula de compasso.",
  "Quando houver duas mãos, use as duas pautas (staff 1 e 2).",
  "Responda APENAS com o documento MusicXML válido, sem comentários e sem",
  "cercas de código.",
].join(" ");

// Extrai o MusicXML da resposta do modelo, tolerando cercas de código ou prosa.
// Função pura — testável sem navegador.
export function extractMusicXml(text) {
  if (!text || !text.trim()) {
    throw new Error("O serviço de OMR não retornou conteúdo.");
  }
  let body = text.trim();
  const fenced = body.match(/```(?:xml|musicxml)?\s*([\s\S]*?)```/i);
  if (fenced) body = fenced[1].trim();

  for (const root of ["score-partwise", "score-timewise"]) {
    const start = body.indexOf(`<${root}`);
    const closing = `</${root}>`;
    const end = body.lastIndexOf(closing);
    if (start !== -1 && end !== -1 && end > start) {
      const xml = body.slice(start, end + closing.length);
      const declaration = body.slice(0, start).includes("<?xml")
        ? '<?xml version="1.0" encoding="UTF-8"?>\n'
        : "";
      return declaration + xml;
    }
  }
  throw new Error("O serviço não retornou um MusicXML reconhecível.");
}

// Rasteriza as primeiras páginas do PDF em imagens PNG (base64) para envio.
export async function renderPdfToImages(asset, { maxPages = 4, maxWidth = 1600 } = {}) {
  const pdfjs = await import("../../vendor/pdfjs/pdf.min.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "../../vendor/pdfjs/pdf.worker.min.mjs",
    import.meta.url,
  ).href;

  const bytes = asset.bytes instanceof ArrayBuffer ? asset.bytes.slice(0) : asset.bytes;
  const document_ = await pdfjs.getDocument({ data: bytes }).promise;
  const totalPages = document_.numPages;
  const usedPages = Math.min(totalPages, maxPages);
  const images = [];

  for (let number = 1; number <= usedPages; number += 1) {
    const page = await document_.getPage(number);
    const unscaled = page.getViewport({ scale: 1 });
    const scale = Math.max(1, Math.min(2.5, maxWidth / unscaled.width));
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    const context = canvas.getContext("2d", { alpha: false });
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: context, viewport }).promise;
    const dataUrl = canvas.toDataURL("image/png");
    images.push({ mediaType: "image/png", base64: dataUrl.split(",")[1] });
  }

  document_.destroy?.();
  return { images, totalPages, usedPages };
}

// Envia as imagens ao modelo de visão e devolve o MusicXML transcrito.
export async function transcribeMusicXml({ apiKey, model = "claude-opus-4-8", images, hints = "" }) {
  if (!apiKey) throw new Error("Informe a chave da API para converter.");
  if (!images?.length) throw new Error("Nenhuma página para converter.");

  const content = images.map((image) => ({
    type: "image",
    source: { type: "base64", media_type: image.mediaType, data: image.base64 },
  }));
  content.push({ type: "text", text: hints ? `${OMR_PROMPT}\n\nContexto: ${hints}` : OMR_PROMPT });

  let response;
  try {
    response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({ model, max_tokens: 16000, messages: [{ role: "user", content }] }),
    });
  } catch (error) {
    throw new Error(`Não foi possível contatar o serviço de OMR: ${error?.message || error}`);
  }

  if (!response.ok) {
    let detail = String(response.status);
    try {
      const payload = await response.json();
      detail = payload?.error?.message || detail;
    } catch {
      // resposta sem corpo JSON
    }
    throw new Error(`Falha no serviço de OMR: ${detail}`);
  }

  const data = await response.json();
  const text = (data.content || [])
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n");
  return extractMusicXml(text);
}
