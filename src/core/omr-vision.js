// Cliente do serviço OMR. O reconhecimento acontece fora do PWA, em um
// processo Audiveris isolado. O navegador envia o PDF uma única vez, acompanha
// o trabalho pela API e recebe MusicXML validado — sem chave de IA no aparelho.

const DEFAULT_TIMEOUT_MS = 12 * 60 * 1000;
const DEFAULT_POLL_INTERVAL_MS = 1500;

function trimSlash(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

export function configuredOmrServiceUrl(document_ = globalThis.document) {
  const configured = document_
    ?.querySelector?.('meta[name="partitura-viva-omr-url"]')
    ?.getAttribute?.("content");
  return trimSlash(configured);
}

function readableServiceError(payload, fallback) {
  return payload?.error?.message
    || payload?.message
    || payload?.error
    || fallback;
}

async function jsonResponse(response, fallback) {
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    // O proxy pode devolver uma página HTML em falhas de infraestrutura.
  }
  if (!response.ok) {
    throw new Error(readableServiceError(payload, fallback || `Falha HTTP ${response.status}.`));
  }
  return payload;
}

function pdfBlob(asset) {
  if (asset instanceof Blob) return asset;
  if (asset?.bytes) {
    return new Blob([asset.bytes], { type: asset.type || "application/pdf" });
  }
  throw new Error("O PDF não pôde ser preparado para conversão.");
}

function wait(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason || new DOMException("Operação cancelada.", "AbortError"));
      return;
    }
    const timeout = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timeout);
      reject(signal.reason || new DOMException("Operação cancelada.", "AbortError"));
    }, { once: true });
  });
}

export async function convertPdfWithOmrService({
  asset,
  fileName,
  serviceUrl = configuredOmrServiceUrl(),
  fetch_ = globalThis.fetch,
  signal,
  onProgress = () => {},
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}) {
  const baseUrl = trimSlash(serviceUrl);
  if (!baseUrl) {
    throw new Error("O servidor de conversão ainda não está configurado.");
  }
  if (typeof fetch_ !== "function") {
    throw new Error("Este navegador não oferece comunicação com o servidor de conversão.");
  }

  const form = new FormData();
  form.append("score", pdfBlob(asset), fileName || asset?.name || "partitura.pdf");
  onProgress({ status: "uploading", message: "Enviando o PDF com segurança…" });

  let createdResponse;
  try {
    createdResponse = await fetch_(`${baseUrl}/v1/jobs`, {
      method: "POST",
      body: form,
      signal,
      headers: { Accept: "application/json" },
    });
  } catch (error) {
    if (error?.name === "AbortError") throw error;
    throw new Error(`Não foi possível contatar o servidor de conversão: ${error?.message || error}`);
  }
  const created = await jsonResponse(createdResponse, "O servidor recusou o PDF.");
  if (!created?.id) throw new Error("O servidor não informou o identificador da conversão.");

  const startedAt = Date.now();
  let lastStatus = "";
  while (Date.now() - startedAt < timeoutMs) {
    const statusResponse = await fetch_(`${baseUrl}/v1/jobs/${encodeURIComponent(created.id)}`, {
      headers: { Accept: "application/json" },
      signal,
    });
    const job = await jsonResponse(statusResponse, "Não foi possível consultar a conversão.");
    if (job.status !== lastStatus || job.message) {
      onProgress(job);
      lastStatus = job.status;
    }

    if (job.status === "completed") {
      const resultUrl = job.resultUrl || `${baseUrl}/v1/jobs/${encodeURIComponent(created.id)}/result`;
      const response = await fetch_(new URL(resultUrl, `${baseUrl}/`).href, {
        headers: { Accept: "application/vnd.recordare.musicxml+xml, application/xml, text/xml" },
        signal,
      });
      if (!response.ok) {
        throw new Error(`O MusicXML reconhecido não pôde ser baixado (HTTP ${response.status}).`);
      }
      const xml = await response.text();
      if (!/<score-(?:partwise|timewise)\b/i.test(xml)) {
        throw new Error("O servidor concluiu o trabalho, mas o resultado não é MusicXML válido.");
      }
      return { xml, job };
    }

    if (job.status === "failed") {
      throw new Error(readableServiceError(job, "A partitura não pôde ser reconhecida."));
    }
    if (job.status === "cancelled") {
      throw new Error("A conversão foi cancelada.");
    }
    await wait(pollIntervalMs, signal);
  }
  throw new Error("A conversão ultrapassou o tempo máximo. Tente novamente mais tarde.");
}
