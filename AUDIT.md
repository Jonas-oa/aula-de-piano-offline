# Auditoria das versões 0.1.0 a 0.3.4

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
- Partitura: barra de compasso corrigida e campo opcional `beatsPerBar` criado.
- Microfone: passa a ignorar os sons emitidos pelo próprio app.
- Nota sustentada após um acerto não conta mais como tentativa errada.
- Metrônomo: o andamento é atualizado ao trocar de música.
- MIDI: teclados conectados após a ativação são reconhecidos automaticamente.
- Service worker: cache renovado e fallback offline válido.

## Fase 2 — polifonia (versão 0.3.0)

- Eventos podem conter múltiplas notas simultâneas com a notação
  `NOTA[:duração][@dedo]` unida por `+`.
- Os campos `pitch`, `duration` e `finger` permanecem como voz superior para
  compatibilidade; `pitches` contém o evento completo.
- Renderizador com pauta dupla, acordes, linhas suplementares e dedilhado.
- O exercício avança quando todas as notas pendentes são tocadas.
- A demonstração toca acordes completos.

## Melodias completas — versão 0.3.1

- Ode à Alegria: tema AABA completo, com 16 compassos.
- Amazing Grace: verso completo em 3/4 com anacruse.
- Für Elise: seção A ampliada para mais de 80 eventos.
- Ode à Alegria — duas mãos: tema completo com linha de baixo.
- A pauta dupla passa a ser definida por `clef: "grand"`.

## Partitura rolante e timbre — versão 0.3.2

- A partitura completa é mantida no SVG e acompanha o avanço do exercício.
- Notas concluídas ficam verdes e a nota-alvo permanece dourada.
- Uma linha-guia fixa indica a região de leitura.
- O sintetizador passou a usar ataque de martelo, harmônicos, filtro e decaimento.

## Correções estruturais — versão 0.3.3

- Duração individual das notas de acordes durante a demonstração.
- Janela de recorte fixa com `score-viewport` e faixa interna `score-track`.
- Für Elise tratada como compasso 3/8.
- Testes semânticos e workflow de auditoria automatizada.
- Cache renovado para `aula-piano-v8-auditoria-033`.

## Correção da regressão visual e do sustain — versão 0.3.4

### Falha reproduzida

Em telas móveis horizontais, após a primeira sequência de deslocamentos, as notas
passavam para a esquerda da clave e a região à direita da pauta ficava vazia. O
som também apresentava corte excessivamente seco, perceptível no teclado virtual
e na demonstração.

### Causa da partitura desaparecer

A faixa de notas estava sendo movimentada com `translateX(...px)` pela propriedade
CSS. O valor calculado representava unidades internas do `viewBox` SVG, mas o
navegador interpretava esse mesmo número como pixels físicos da tela. Em telas
ampliadas, a escala entre pixels e unidades SVG era diferente, deslocando a faixa
para uma posição incorreta.

### Correção aplicada à rolagem

- O deslocamento passou a usar o atributo SVG `transform="translate(x 0)"`.
- Os valores agora são aplicados diretamente nas unidades do `viewBox`.
- A animação suave é feita por `requestAnimationFrame`, com interpolação de 280 ms.
- Uma animação anterior é cancelada quando uma nova nota é atingida.
- A posição é registrada em `data-translate-x`, evitando saltos entre atualizações.
- A função testável `scoreTranslateXForIndex()` confirma que, por exemplo, a nota
  de índice 10 recebe deslocamento de `-750`, colocando-a exatamente em `x = 310`,
  na linha-guia.

### Correção aplicada ao sustain

- A reprodução automática deixou de depender do instante em que o botão recebe
  o estado `disabled`, evitando que a primeira nota perdesse sua duração correta.
- A posição dentro de acordes agora avança pela quantidade real de notas do
  evento, sem depender de intervalos de tempo entre chamadas.
- Todas as notas recebem uma cauda audível proporcional, com duração mínima de
  0,72 segundo antes da liberação interna do sintetizador.
- Notas longas continuam respeitando sua proporção; o baixo sustentado permanece
  mais longo que a melodia.
- O ajuste também beneficia o teclado virtual, evitando notas excessivamente
  secas.

### Testes de regressão adicionados

- Cálculo da posição da faixa nos índices 0, 1, 2, 10 e 40.
- Confirmação de que a implementação usa o atributo SVG `transform`.
- Bloqueio contra o retorno de `style.transform = translateX(...px)`.
- Verificação de sustain mínimo, extensão de notas curtas e preservação de notas
  longas.
- Verificação da duração independente entre baixo e melodia.
- Verificação do cache offline `aula-piano-v9-scroll-sustain-034`.

### Resultado da auditoria automatizada

- Workflow: **Auditoria automatizada**.
- Execução: `29650383582`.
- Run number: `9`.
- Ambiente: Ubuntu 24.04.
- Node.js configurado no workflow: versão 24.
- Job **Testes Node.js**: concluído com sucesso.
- Etapa **Executar testes automatizados**: concluída com sucesso.
- Resultado final: **success**.
- A pull request temporária nº 2 foi fechada sem mesclar.
- A branch temporária foi reposicionada para o mesmo commit da `main`, sem manter
  alterações funcionais paralelas.

### Limitações que permanecem

- O reconhecimento pelo microfone continua monofônico.
- O pedal físico de sustain de um teclado MIDI ainda não é processado.
- O timbre continua sendo sintetizado, sem amostras gravadas de piano acústico.
- A validação visual final deve ser repetida no aparelho que apresentou o erro,
  após a atualização do cache da PWA.
- Microfone, Web MIDI e áudio precisam de testes em diferentes aparelhos reais.

## Conclusão

A versão 0.3.4 corrige a causa específica do desaparecimento da partitura em telas
escaladas e acrescenta sustain perceptível sem remover a duração independente das
notas. A suíte automatizada foi executada após as alterações e terminou com
sucesso. A principal validação restante é o teste visual e auditivo no dispositivo
Android em que a regressão foi observada.
