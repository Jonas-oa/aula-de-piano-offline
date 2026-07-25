import assert from "node:assert/strict";
import test from "node:test";
import { convertViaService } from "../src/core/omr-service.js";

const XML = '<?xml version="1.0"?><score-partwise version="4.0"/>';
const PDF = new TextEncoder().encode("%PDF-1.7\nteste");

function jsonResponse(payload, init = {}) {
  return new Response(JSON.stringify(payload), {
    ...init,
    headers: { "content-type": "application/json", ...(init.headers || {}) },
  });
}

test("usa a conversão síncrona do Cloud Run e envia a chave", async (t) => {
  const calls = [];
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    return jsonResponse({
      xml: XML,
      warnings: ["Revise a armadura."],
      metrics: { notes: 8 },
    });
  };

  const result = await convertViaService({
    baseUrl: "https://omr.example/",
    accessKey: "segredo",
    pdfBytes: PDF,
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://omr.example/v1/convert");
  assert.equal(calls[0].options.headers["X-OMR-Key"], "segredo");
  assert.match(result.xml, /score-partwise/);
  assert.equal(result.metrics.notes, 8);
});

test("mantém compatibilidade com o fluxo de jobs antigo", async (t) => {
  const calls = [];
  const responses = [
    new Response("", { status: 404 }),
    jsonResponse({ id: "job-1", status: "completed", warnings: [], metrics: { notes: 3 } }, { status: 202 }),
    new Response(XML, { headers: { "content-type": "application/xml" } }),
  ];
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url, options });
    return responses.shift();
  };

  const result = await convertViaService({
    baseUrl: "https://omr.example",
    accessKey: "segredo",
    pdfBytes: PDF,
  });

  assert.deepEqual(calls.map((call) => call.url), [
    "https://omr.example/v1/convert",
    "https://omr.example/v1/jobs",
    "https://omr.example/v1/jobs/job-1/result",
  ]);
  assert.equal(calls[2].options.headers["X-OMR-Key"], "segredo");
  assert.match(result.xml, /score-partwise/);
});
