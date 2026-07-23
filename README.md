# Aula de Piano — Tutor Offline

Protótipo funcional de um aplicativo educacional de piano que:

- escuta notas isoladas pelo microfone;
- aceita teclado MIDI quando o navegador oferece Web MIDI;
- possui teclado virtual para demonstração e testes;
- mostra pauta, dedilhado, nota-alvo e afinação;
- oferece **Modo Foco**, deixando apenas partitura e teclado na área principal;
- rola a partitura suavemente conforme o exercício avança;
- reproduz um timbre sintetizado mais próximo de piano;
- mantém a tela ligada enquanto a área de prática está aberta, quando o navegador permite;
- permite escolher qualquer exercício, sem fases ou bloqueios;
- inclui estudos originais de ritmo e coordenação para duas mãos;
- guarda o progresso apenas no dispositivo;
- funciona como PWA offline após o primeiro carregamento;
- pode ser publicado diretamente no GitHub Pages.

## Estado atual — versão 0.4.0

A partitura, o catálogo e a avaliação são **polifônicos**: eventos podem conter acordes e notas de duas mãos (notação `C3:4+E4:1`), a pauta dupla (claves de Sol e Fá) é desenhada quando a música usa `clef: "grand"`, e o exercício avança quando todas as notas do evento são tocadas — em qualquer ordem — via teclado MIDI ou teclado virtual.

O reconhecimento por **microfone continua monofônico**: identifica uma nota por vez, o que atende escalas e melodias; em acordes, aceita as notas arpejadas. O reconhecimento simultâneo por microfone exigirá um motor polifônico mais avançado.

A demonstração passou a respeitar a duração individual de cada nota do acorde. Assim, um baixo escrito com quatro tempos pode continuar soando enquanto a melodia avança em notas de um tempo. A correção é aplicada pelo módulo `src/core/playback-fixes.js` sem alterar a lógica de avaliação do aluno.

A partitura usa uma janela fixa e desloca somente a faixa interna das notas. Isso evita que o recorte acompanhe o movimento e mantém a nota atual próxima à linha-guia. A fórmula 3/8 de **Für Elise** também é considerada ao posicionar as barras de compasso.

O catálogo contém mais de 60 itens entre clássicos, hinos/gospel históricos, exercícios técnicos e 24 estudos rítmicos originais para duas mãos. Os estudos cobrem níveis iniciante, intermediário e avançado e incluem Jazz, Blues, Forró/Baião, Samba, Gospel, Bossa nova, Pop/Rock, Reggae, Funk/Soul, ritmos latinos e Valsa.

Não existem fases bloqueadas: o aluno pode abrir qualquer item pelo catálogo ou pela seleção livre da tela inicial. Os filtros permitem escolher estilo e dificuldade.

## Tela ligada durante a prática

A preferência **Manter a tela ligada durante a prática** vem ativada por padrão. O app solicita o Screen Wake Lock ao abrir um exercício, libera o recurso ao sair da prática e tenta readquiri-lo quando a página volta ao primeiro plano. A função exige HTTPS ou `localhost` e depende do suporte do navegador e das condições do dispositivo.

## Modo Foco

Na tela **Praticar**, o botão **Modo foco** retrai cabeçalho, navegação e cartões auxiliares. A partitura recebe prioridade de espaço e usa um enquadramento ampliado; o teclado permanece logo abaixo. O botão **Controles** abre temporariamente microfone, MIDI, metrônomo e demais opções.

## Executar localmente

```bash
npm test
npm run serve
```

Abra `http://localhost:8080`. O microfone funciona em `localhost` ou em HTTPS.

## Auditoria automatizada

O workflow `.github/workflows/ci.yml` executa `npm test` com Node.js 20 em atualizações da branch `main` e em pull requests. Os testes cobrem catálogo, MIDI, detector YIN, dedilhado, acordes, fórmulas de compasso, sustain individual, rolagem da pauta e recursos do cache offline.

## Publicar no GitHub Pages

1. No GitHub, abra **Settings → Pages**.
2. Em **Build and deployment**, selecione **Deploy from a branch**.
3. Escolha a branch `main` e a pasta `/ (root)`.
4. Aguarde a URL HTTPS do GitHub Pages.

Todos os caminhos são relativos, portanto o projeto funciona tanto em domínio próprio quanto em `usuario.github.io/nome-do-repositorio/`.

## Estrutura

```text
index.html
styles.css
manifest.webmanifest
sw.js
src/
  app.js
  core/audio-engine.js
  core/playback-fixes.js
  core/screen-wake-lock.js
  core/music.js
  data/catalog.js
  ui/score-renderer.js
  ui/focus-mode.js
assets/icons/
tests/
.github/workflows/ci.yml
```

## Próximas fases recomendadas

1. Renderização completa de MusicXML com ligaduras, pausas, dinâmica, vozes independentes e duas mãos.
2. Importador e curadoria em lote de repertório público com rastreabilidade de licença.
3. Avaliação rítmica real: início, duração, andamento e estabilidade de pulso.
4. Reconhecimento polifônico offline usando modelo WebAssembly/WebGPU, mantendo MIDI como modo de alta precisão.
5. Pedal de sustain e liberação real de notas para teclado MIDI.
6. Painel de professor, criação de aulas e exportação de relatórios.

## Referências dos estudos rítmicos

Os padrões do catálogo foram compostos para o projeto e licenciados em CC0-1.0. As referências educacionais e os critérios de adaptação estão documentados em [`RHYTHM_REFERENCES.md`](./RHYTHM_REFERENCES.md).

## Privacidade

O sinal do microfone é processado na memória do navegador. A versão atual não grava nem envia áudio.

## Licenças

- Código: MIT.
- Dados de arranjos didáticos do projeto: indicados como CC0-1.0 no catálogo.
- Obras e fontes externas: consultar `CATALOG_POLICY.md` e registrar a licença de cada item.
