# Auditoria das versões 0.1.0 a 0.3.3

Atualização mais recente: 18 de julho de 2026

## Verificações-base concluídas

- Sintaxe dos módulos JavaScript principais.
- Integridade do catálogo e IDs únicos.
- Validade das notas, durações, BPM e dificuldades.
- Ligações entre aulas e músicas.
- Conversão de notas para MIDI e retorno para nomes de notas.
- Detector YIN com sinal sintético de 440 Hz.
- Existência de todos os arquivos essenciais da PWA.
- Manifesto com caminhos relativos para GitHub Pages.
- Recursos declarados no cache offline.
- Smoke test histórico de interface em DOM simulado:
  - 8 aulas renderizadas;
  - 35 itens no catálogo;
  - 37 teclas virtuais;
  - pauta SVG renderizada;
  - toque na tecla-alvo avançando da nota 1 para a nota 2.

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
- Partitura: barra de compasso corrigida e campo opcional `beatsPerBar` criado.
- Microfone: passa a ignorar os sons emitidos pelo próprio app (demonstração,
  teclado virtual e metrônomo), evitando avanço automático do exercício.
- Nota sustentada após um acerto não conta mais como tentativa errada.
- Metrônomo: ao trocar de música, o andamento é atualizado para o BPM da nova
  peça.
- MIDI: teclados conectados após a ativação são reconhecidos automaticamente.
- Service worker: cache renovado e fallback offline válido.

## Fase 2 — polifonia (versão 0.3.0)

- Catálogo: eventos podem conter múltiplas notas simultâneas com a notação
  `NOTA[:duração][@dedo]` unida por `+` (ex.: `C3:4+E4:1@3`).
- Os campos `pitch`, `duration` e `finger` permanecem como voz superior para
  compatibilidade; `pitches` contém o evento completo.
- Renderizador: pauta dupla, acordes com haste compartilhada, segundas
  deslocadas, linhas suplementares e dedilhado por nota.
- Avaliação: o exercício avança quando todas as notas pendentes são tocadas, em
  qualquer ordem. O microfone aceita acordes arpejados; MIDI e teclado virtual
  aceitam acordes simultâneos.
- Demonstração toca acordes completos.

## Melodias completas — versão 0.3.1

- Ode à Alegria: tema AABA completo, com 16 compassos e dedilhado explícito.
- Amazing Grace: verso completo em 3/4 com anacruse (`pickupBeats`).
- Für Elise: seção A ampliada para mais de 80 eventos.
- Ode à Alegria — duas mãos: tema completo com linha de baixo.
- A pauta dupla passa a ser definida por `clef: "grand"`, evitando trocar a clave
  apenas por causa de notas graves da mão direita.

## Partitura rolante e timbre — versão 0.3.2

- A partitura completa é mantida no SVG e acompanha o avanço do exercício.
- Notas concluídas ficam verdes; a nota-alvo permanece dourada.
- Uma linha-guia fixa indica a região de leitura.
- O sintetizador passou a usar ataque de martelo, harmônicos, filtro e decaimento
  para produzir um som mais próximo de piano sem amostras externas.

## Correções e auditoria pós-atualização — versão 0.3.3

### Problemas corrigidos

1. **Sustain independente na demonstração**
   - O passo do evento continua controlando o próximo ataque da melodia.
   - Cada nota do acorde passa a usar sua própria duração audível.
   - Em `C3:4+E4:1`, o Dó grave permanece por quatro tempos enquanto o Mi usa um
     tempo.
   - A correção está isolada em `src/core/playback-fixes.js` e não interfere na
     avaliação do aluno.

2. **Rolagem SVG corrigida**
   - O recorte foi transferido para um grupo externo fixo (`score-viewport`).
   - Somente o grupo interno (`score-track`) recebe a transformação.
   - O movimento usa `translateX(...)` pela propriedade CSS, permitindo a
     transição suave declarada no renderizador.

3. **Compassos de Für Elise**
   - A peça é tratada como 3/8.
   - Como a unidade interna usa semínima igual a 1, cada compasso corresponde a
     1,5 unidades.
   - As barras deixaram de ficar completamente desativadas.

4. **Testes menos frágeis**
   - Foram removidas verificações dependentes do nome de variáveis ou da
     formatação exata de linhas do arquivo.
   - Os testes passaram a validar resultados semânticos: fórmula de compasso,
     duração individual, acordes, estrutura rolante e shell offline.

5. **Compatibilidade da suíte Node.js**
   - O Modo Foco não tenta acessar `document` quando os módulos são importados no
     ambiente de testes.

6. **PWA e rastreabilidade**
   - Cache renovado para `aula-piano-v8-auditoria-033`.
   - O novo módulo de reprodução foi incluído no app shell offline.
   - Versão do pacote atualizada para `0.3.3`.
   - Workflow `.github/workflows/ci.yml` criado para executar a auditoria em cada
     atualização relevante e em pull requests.

### Resultado da auditoria automatizada

- Workflow: **Auditoria automatizada**.
- Execução: `29648323608`.
- Ambiente: Ubuntu 24.04, suíte executada com Node.js configurado pelo workflow.
- Job **Testes Node.js**: concluído com sucesso.
- Etapa **Executar testes automatizados**: concluída com sucesso.
- Resultado final do workflow: **success**.
- A pull request temporária usada somente para a verificação foi fechada sem
  mesclar, e a branch de verificação foi reposicionada para o mesmo commit da
  `main`, sem deixar alteração funcional paralela.

### Limitações conhecidas após a auditoria

- O reconhecimento por microfone ainda é monofônico.
- A duração independente foi corrigida na demonstração, mas o pedal físico de
  sustain MIDI ainda não é processado.
- A precisão musical das transcrições precisa de revisão humana especializada.
- Microfone, Web MIDI, áudio e layout ainda devem ser testados em aparelhos
  Android, iOS, computadores e pianos reais.

## Conclusão

A versão 0.3.3 está consistente com a arquitetura atual, preserva a polifonia e
as melodias ampliadas e corrige os problemas técnicos identificados na revisão
anterior. A suíte automatizada foi executada após as alterações e terminou com
sucesso. As pendências restantes dependem principalmente de validação musical e
de testes em hardware real.
