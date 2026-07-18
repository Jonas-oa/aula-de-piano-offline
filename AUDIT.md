# Auditoria das versões 0.1.0 a 0.2.1

Data: 17 de julho de 2026

## Verificações concluídas

- Sintaxe dos módulos JavaScript principais.
- Integridade do catálogo e IDs únicos.
- Validade das notas, durações, BPM e dificuldades.
- Ligações entre aulas e músicas.
- Conversão de notas para MIDI e retorno para nomes de notas.
- Detector YIN com sinal sintético de 440 Hz.
- Existência de todos os arquivos essenciais da PWA.
- Manifesto com caminhos relativos para GitHub Pages.
- Recursos declarados no cache offline.
- Smoke test de interface em DOM simulado:
  - 8 aulas renderizadas;
  - 35 itens no catálogo;
  - 37 teclas virtuais;
  - pauta SVG renderizada;
  - toque na tecla-alvo avançando da nota 1 para a nota 2.

## Resultado

- 10/10 testes automatizados aprovados.
- Smoke test funcional aprovado.
- Layout do Modo Foco validado em viewport horizontal de 1536 × 691 px.

## Pendente para validação em dispositivo real

- Calibração do microfone em piano acústico e digital.
- Testes de ruído, reverberação e distância do aparelho.
- Permissão e funcionamento do microfone em Android, iOS e desktop.
- Conexão Web MIDI nos navegadores compatíveis.
- Revisão musical das transcrições didáticas antes de publicação comercial.

## Modo Foco — versão 0.2.0

- Cabeçalho e navegação inferior são retraídos durante a prática.
- Partitura e teclado ocupam toda a área útil da tela.
- Controles secundários permanecem disponíveis em painel retrátil.
- O modo fecha ao voltar, trocar de seção ou pressionar Escape.
- Cache offline atualizado para incluir o novo módulo.

## Ajuste da partitura — versão 0.2.1

- Partitura ampliada no Modo Foco, com enquadramento sem margens vazias.
- Barra de progresso sobreposta à área livre superior da pauta.
- Teclado reduzido proporcionalmente para priorizar a leitura musical.
- Controles compactados automaticamente em telas horizontais baixas.

## Correções — versão 0.2.2

- Dedilhado: removido o ciclo automático 1-5 (musicalmente incorreto). Agora o
  catálogo aceita dedilhado explícito (`NOTA[:duração][@dedo]`) e gera dedilhado
  automático apenas para peças que cabem numa posição fixa de cinco dedos.
  Escalas de Dó e Sol receberam o dedilhado padrão (123-12345). Peças sem
  dedilhado confiável não exibem sugestão.
- Partitura: barra de compasso corrigida (faltava `x2`, desenhava uma diagonal).
  Novo campo opcional `beatsPerBar` (3 para peças ternárias; 0 desativa as
  barras em Para Elisa, que tem anacruse).
- Microfone: passa a ignorar os sons emitidos pelo próprio app (demonstração,
  teclado virtual e metrônomo), evitando avanço automático do exercício.
- Nota sustentada após um acerto não conta mais como tentativa errada: uma nova
  tentativa exige silêncio ou mudança de nota (detecção de novo ataque simples).
- Metrônomo: ao trocar de música, o andamento é atualizado para o BPM da nova
  peça.
- MIDI: teclados conectados após a ativação são reconhecidos automaticamente
  (`onstatechange`).
- Service worker: cache renovado (v4) e resposta de fallback válida quando o
  recurso não está no cache e a rede falha.
- Fontes `src/app.js` e `src/data/catalog.js` deixaram de ser distribuídos
  minificados no repositório.
