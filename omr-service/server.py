# Microsserviço de OMR (PDF → MusicXML) para o app "Partitura Viva".
#
# Implementa exatamente o contrato que o app já espera (src/core/omr-service.js):
#   POST /v1/jobs            -> recebe o PDF (campo "score"), devolve {id, status}
#   GET  /v1/jobs/{id}       -> {status: queued|processing|completed|failed, ...}
#   GET  /v1/jobs/{id}/result-> devolve o MusicXML como texto
#
# O reconhecimento usa o oemer (https://github.com/BreezeWhite/oemer): um motor de
# OMR em Python, sem dependências pesadas de Java, que sobe bem no Hugging Face
# Spaces gratuito. A primeira conversão baixa os modelos (~alguns minutos).

import os
import shutil
import tempfile
import threading
import subprocess
import uuid
from pathlib import Path

import fitz  # PyMuPDF
from fastapi import FastAPI, File, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, PlainTextResponse

app = FastAPI(title="OMR PDF → MusicXML")

# O app roda no navegador (localhost, GitHub Pages, etc.); libera qualquer origem.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

JOBS = {}
JOBS_LOCK = threading.Lock()
WORK_DIR = Path(tempfile.gettempdir()) / "omr-jobs"
WORK_DIR.mkdir(parents=True, exist_ok=True)

RENDER_DPI = 300
OEMER_TIMEOUT = 8 * 60  # segundos


def _update(job_id, **fields):
    with JOBS_LOCK:
        if job_id in JOBS:
            JOBS[job_id].update(fields)


def process(job_id, pdf_path):
    """Roda em uma thread: rasteriza a 1ª página e reconhece com o oemer."""
    job_dir = WORK_DIR / job_id
    try:
        _update(job_id, status="processing", message="Renderizando a primeira página…")
        doc = fitz.open(pdf_path)
        if doc.page_count == 0:
            raise RuntimeError("PDF sem páginas.")
        page = doc.load_page(0)
        zoom = RENDER_DPI / 72.0
        pix = page.get_pixmap(matrix=fitz.Matrix(zoom, zoom), alpha=False)
        img_path = job_dir / "page.png"
        pix.save(str(img_path))
        multipage = doc.page_count > 1
        doc.close()

        _update(
            job_id,
            message="Reconhecendo pautas, notas e ritmos… (pode levar alguns minutos)",
        )
        # oemer grava "<imagem>.musicxml" ao lado da imagem de entrada.
        result = subprocess.run(
            ["oemer", str(img_path)],
            cwd=str(job_dir),
            capture_output=True,
            text=True,
            timeout=OEMER_TIMEOUT,
        )

        candidates = sorted(job_dir.glob("*.musicxml")) + sorted(job_dir.glob("*.xml"))
        if not candidates:
            detail = (result.stderr or result.stdout or "").strip()[-500:]
            raise RuntimeError(detail or "O reconhecedor não gerou MusicXML.")

        xml = candidates[0].read_text(encoding="utf-8")
        warnings = []
        if multipage:
            warnings.append("Apenas a primeira página foi convertida nesta versão.")
        _update(job_id, status="completed", message="Concluído.", xml=xml, warnings=warnings)
    except subprocess.TimeoutExpired:
        _update(
            job_id,
            status="failed",
            error={"message": "A conversão demorou demais e foi interrompida."},
        )
    except Exception as exc:  # noqa: BLE001 — qualquer falha vira status failed
        _update(job_id, status="failed", error={"message": str(exc) or "Falha na conversão."})
    finally:
        try:
            os.remove(pdf_path)
        except OSError:
            pass


@app.get("/")
def root():
    return {"service": "omr-pdf-to-musicxml", "status": "ok"}


@app.post("/v1/jobs")
async def create_job(score: UploadFile = File(...)):
    job_id = uuid.uuid4().hex
    job_dir = WORK_DIR / job_id
    job_dir.mkdir(parents=True, exist_ok=True)
    pdf_path = job_dir / "input.pdf"
    with open(pdf_path, "wb") as fh:
        shutil.copyfileobj(score.file, fh)

    with JOBS_LOCK:
        JOBS[job_id] = {"id": job_id, "status": "queued", "message": "Na fila…"}
    threading.Thread(target=process, args=(job_id, str(pdf_path)), daemon=True).start()
    return {"id": job_id, "status": "queued"}


@app.get("/v1/jobs/{job_id}")
def get_job(job_id: str):
    with JOBS_LOCK:
        job = JOBS.get(job_id)
        if not job:
            return JSONResponse(
                status_code=404, content={"error": {"message": "Trabalho não encontrado."}}
            )
        return {key: value for key, value in job.items() if key != "xml"}


@app.get("/v1/jobs/{job_id}/result")
def get_result(job_id: str):
    with JOBS_LOCK:
        job = JOBS.get(job_id)
    if not job:
        return JSONResponse(
            status_code=404, content={"error": {"message": "Trabalho não encontrado."}}
        )
    if job.get("status") != "completed" or "xml" not in job:
        return JSONResponse(
            status_code=409, content={"error": {"message": "O resultado ainda não está pronto."}}
        )
    return PlainTextResponse(job["xml"], media_type="application/xml")
