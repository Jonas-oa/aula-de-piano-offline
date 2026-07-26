// Cliente do serviço de OMR (Audiveris) — converte PDF em MusicXML por HTTP.
// No Cloud Run usa uma requisição síncrona; servidores antigos continuam
// atendidos pelo fluxo assíncrono de jobs.
// O serviço é um programa separado (AGPLv3); o app só fala com ele pela API.

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function errorMessage(response, fallback) {
  try {
    const payload = await response.json();
    return payload?.error?.message || fallback;
  } catch {
    return `${fallback} (HTTP ${response.status})`;
  }
}

function statusLabel(job) {
  if (job.status === "queued") return "Na fila do serviço…";
  if (job.status === "processing") {
    return job.message || "Reconhecendo pautas, compassos, notas e ritmos… (pode levar alguns minutos)";
  }
  return job.message || "Processando…";
}

function serviceHeaders(accessKey) {
  const key = String(accessKey || "").trim();
  return key ? { "X-OMR-Key": key } : {};
}

function pdfForm(pdfBytes, filename) {
  const form = new FormData();
  form.append("score", new Blob([pdfBytes], { type: "application/pdf" }), filename);
  return form;
}

async function convertSynchronously({ base, accessKey, pdfBytes, filename, timeoutMs }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(`${base}/v1/convert`, {
      method: "POST",
      headers: serviceHeaders(accessKey),
      body: pdfForm(pdfBytes, filename),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function convertWithJobs({
  base,
  accessKey,
  pdfBytes,
  filename,
  onProgress,
  pollMs,
  timeoutMs,
}) {
  const headers = serviceHeaders(accessKey);
  const response = await fetch(`${base}/v1/jobs`, {
    method: "POST",
    headers,
    body: pdfForm(pdfBytes, filename),
  });
  if (!response.ok) throw new Error(await errorMessage(response, "Falha ao enviar o PDF."));

  let job = await response.json();
  const deadline = Date.now() + timeoutMs;
  while (!["completed", "failed"].includes(job.status)) {
    if (Date.now() > deadline) throw new Error("O serviço demorou demais para responder.");
    onProgress(statusLabel(job));
    await delay(pollMs);
    const poll = await fetch(`${base}/v1/jobs/${job.id}`, { headers });
    if (!poll.ok) throw new Error(await errorMessage(poll, "Falha ao consultar a conversão."));
    job = await poll.json();
  }

  if (job.status === "failed") {
    throw new Error(job.error?.message || "A conversão não pôde ser concluída.");
  }

  onProgress("Baixando o MusicXML…");
  const result = await fetch(`${base}/v1/jobs/${job.id}/result`, { headers });
  if (!result.ok) throw new Error(await errorMessage(result, "Falha ao obter o resultado."));
  const xml = await result.text();
  return { xml, warnings: job.warnings || [], metrics: job.metrics || null };
}

export async function convertViaService({
  baseUrl,
  accessKey = "",
  pdfBytes,
  filename = "partitura.pdf",
  onProgress = () => {},
  pollMs = 2500,
  timeoutMs = 12 * 60 * 1000,
}) {
  if (!baseUrl) throw new Error("Informe a URL do serviço de conversão.");
  const base = String(baseUrl).replace(/\/+$/, "");

  onProgress("Enviando e reconhecendo a partitura… (pode levar alguns minutos)");
  let response;
  try {
    response = await convertSynchronously({
      base,
      accessKey,
      pdfBytes,
      filename,
      timeoutMs,
    });
  } catch (error) {
    if (error?.name === "AbortError") throw new Error("O serviço demorou demais para responder.");
    throw new Error(`Não foi possível contatar o serviço de conversão: ${error?.message || error}`);
  }
  if ([404, 405].includes(response.status)) {
    onProgress("Servidor antigo detectado; usando a fila de conversão…");
    try {
      return await convertWithJobs({
        base,
        accessKey,
        pdfBytes,
        filename,
        onProgress,
        pollMs,
        timeoutMs,
      });
    } catch (error) {
      throw new Error(`Falha no serviço de conversão: ${error?.message || error}`);
    }
  }
  if (!response.ok) throw new Error(await errorMessage(response, "Falha ao converter o PDF."));
  const result = await response.json();
  if (!result?.xml) throw new Error("O serviço respondeu sem um MusicXML válido.");
  return {
    xml: result.xml,
    warnings: result.warnings || [],
    metrics: result.metrics || null,
  };
}
