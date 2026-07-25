---
title: OMR PDF to MusicXML
emoji: 🎼
colorFrom: indigo
colorTo: purple
sdk: docker
app_port: 7860
pinned: false
---

# Conversor PDF → MusicXML (OMR)

Microsserviço gratuito que converte partituras em PDF para MusicXML, para o app
**Partitura Viva**. Usa o [oemer](https://github.com/BreezeWhite/oemer) (OMR em
Python) e expõe o contrato que o app já espera.

## Endpoints

| Método | Rota | Descrição |
| --- | --- | --- |
| `POST` | `/v1/jobs` | Envia o PDF (campo `score`, multipart). Devolve `{id, status}`. |
| `GET` | `/v1/jobs/{id}` | Estado do trabalho: `queued` → `processing` → `completed`/`failed`. |
| `GET` | `/v1/jobs/{id}/result` | O MusicXML pronto (texto). |

## Publicar de graça no Hugging Face Spaces

1. Crie uma conta em <https://huggingface.co> (grátis).
2. **New Space** → escolha **Docker** como SDK, visibilidade **Public**
   (o tier grátis exige público).
3. Suba os três arquivos desta pasta para o Space: `Dockerfile`, `server.py`,
   `requirements.txt` e este `README.md` (o cabeçalho YAML acima é lido pelo Space).
   - Pela web: aba **Files** → **Add file** → **Upload files**.
   - Ou por git: `git clone` do Space e copie os arquivos de `omr-service/`.
4. Aguarde o **Building** virar **Running** (a primeira build baixa as dependências).
5. A URL pública fica em `https://SEU-USUARIO-NOME-DO-SPACE.hf.space`.

## Ligar ao app

No app, na tela de **importação**, cole essa URL no campo
**"Serviço Audiveris (recomendado) — URL"** e salve. A URL fica só no seu
aparelho (localStorage). Pronto: importe um PDF e use **"Converter em notas"**.

## Observações

- **Primeira conversão** baixa os modelos do oemer (~alguns minutos). As seguintes
  são mais rápidas.
- O Space grátis **hiberna** após inatividade; a primeira chamada do dia acorda o
  serviço (~30 s ou mais).
- Esta versão converte **a primeira página** do PDF. O app recebe um aviso quando o
  PDF tem mais páginas.
- Precisão de OMR é imperfeita, sobretudo em piano denso — revise o resultado.
