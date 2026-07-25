# Imagem do microsserviço de OMR para rodar no Hugging Face Spaces (SDK: Docker).
FROM python:3.10-slim

# Dependências de sistema do OpenCV (usado pelo oemer).
RUN apt-get update && apt-get install -y --no-install-recommends \
        libgl1 \
        libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

# O Hugging Face Spaces roda o container como o usuário 1000.
RUN useradd -m -u 1000 user
USER user
ENV HOME=/home/user \
    PATH=/home/user/.local/bin:$PATH

WORKDIR /home/user/app

COPY --chown=user requirements.txt .
RUN pip install --no-cache-dir --user -r requirements.txt

COPY --chown=user server.py .

# Porta padrão do Hugging Face Spaces (ver app_port no README).
EXPOSE 7860
CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "7860"]
