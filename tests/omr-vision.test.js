import test from "node:test";
import assert from "node:assert/strict";
import {
  configuredOmrServiceUrl,
  convertPdfWithOmrService,
} from "../src/core/omr-vision.js";

const XML = '<?xml version="1.0"?><score-partwise version="4.0"><part-list/><part id="P1"/></score-partwise>';
const PDF = {
  name: "fur-elise.pdf",
  type: "application/pdf",
  bytes: new TextEncoder().encode("%PDF-1.7 teste").buffer,
};

function json(payload, init = {}) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

test("lê e normaliza a URL configurada no meta", () => {
  const document_ = {
    querySelector: () => ({ getAttribute: () => " https://omr.example.test/// " }),
  };
  assert.equal(configuredOmrServiceUrl(document_), "https://omr.example.test");
});

test("envia PDF, acompanha o trabalho e baixa o MusicXML", async () => {
  const calls = [];
  const progress = [];
  const fetch_ = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).endsWith("/v1/jobs") && options.method === "POST") {
      assert.ok(options.body instanceof FormData);
      return json({ id: "job-1", status: "queued" }, { status: 202 });
    }
    if (String(url).endsWith("/v1/jobs/job-1")) {
      return json({
        id: "job-1",
        status: "completed",
        resultUrl: "/v1/jobs/job-1/result",
        metrics: { notes: 42 },
      });
    }
    if (String(url).endsWith("/v1/jobs/job-1/result")) {
      return new Response(XML, { status: 200, headers: { "content-type": "application/xml" } });
    }
    throw new Error(`URL inesperada: ${url}`);
  };

  const result = await convertPdfWithOmrService({
    asset: PDF,
    serviceUrl: "https://omr.example.test/",
    fetch_,
    pollIntervalMs: 0,
    onProgress: (event) => progress.push(event.status),
  });

  assert.equal(result.xml, XML);
  assert.equal(result.job.metrics.notes, 42);
  assert.deepEqual(progress, ["uploading", "completed"]);
  assert.equal(calls.length, 3);
});

test("propaga a mensagem segura de falha do trabalho", async () => {
  const fetch_ = async (url, options = {}) => {
    if (options.method === "POST") return json({ id: "job-2", status: "queued" }, { status: 202 });
    return json({ id: "job-2", status: "failed", error: { message: "Pautas não identificadas." } });
  };
  await assert.rejects(
    convertPdfWithOmrService({
      asset: PDF,
      serviceUrl: "https://omr.example.test",
      fetch_,
      pollIntervalMs: 0,
    }),
    /Pautas não identificadas/,
  );
});

test("recusa conversão sem servidor configurado", async () => {
  await assert.rejects(
    convertPdfWithOmrService({ asset: PDF, serviceUrl: "" }),
    /servidor de conversão ainda não está configurado/,
  );
});

test("recusa resposta concluída que não contém MusicXML", async () => {
  const fetch_ = async (url, options = {}) => {
    if (options.method === "POST") return json({ id: "job-3" }, { status: 202 });
    if (String(url).endsWith("/result")) return new Response("<html>erro</html>", { status: 200 });
    return json({ id: "job-3", status: "completed" });
  };
  await assert.rejects(
    convertPdfWithOmrService({
      asset: PDF,
      serviceUrl: "https://omr.example.test",
      fetch_,
      pollIntervalMs: 0,
    }),
    /não é MusicXML válido/,
  );
});
