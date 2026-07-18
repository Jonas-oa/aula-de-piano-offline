# Aula de Piano — Tutor Offline

Protótipo funcional de um aplicativo educacional de piano que:

- escuta notas isoladas pelo microfone;
- aceita teclado MIDI quando o navegador oferece Web MIDI;
- possui teclado virtual para demonstração e testes;
- mostra pauta, dedilhado, nota-alvo e afinação;
- oferece **Modo Foco**, deixando apenas partitura e teclado na área principal;
- progride por aulas com metas crescentes de precisão;
- guarda o progresso apenas no dispositivo;
- funciona como PWA offline após o primeiro carregamento;
- pode ser publicado diretamente no GitHub Pages.

## Estado desta primeira versão

O reconhecimento por microfone é **monofônico**: ele identifica uma nota por vez. Isso é adequado para exercícios iniciais, escalas e melodias de uma mão. Acordes e execução completa a duas mãos exigem um motor polifônico posterior ou um teclado MIDI, que fornece a entrada mais precisa.

O catálogo inicial contém mais de 30 trechos didáticos entre clássicos, hinos/gospel históricos e exercícios técnicos. As transcrições devem passar por revisão musical antes de uma publicação comercial.

## Modo Foco

Na tela **Praticar**, o botão **Modo foco** retrai cabeçalho, navegação e cartões auxiliares. A partitura recebe prioridade de espaço e usa um enquadramento ampliado; o teclado permanece logo abaixo. O botão **Controles** abre temporariamente microfone, MIDI, metrônomo e demais opções.

## Executar localmente

```bash
npm test
npm run serve
```

Abra `http://localhost:8080`. O microfone funciona em `localhost` ou em HTTPS.

## Publicar no GitHub Pages

1. Crie um repositório e envie todos os arquivos da pasta.
2. No GitHub, abra **Settings → Pages**.
3. Em **Build and deployment**, selecione **Deploy from a branch**.
4. Escolha a branch `main` e a pasta `/ (root)`.
5. Aguarde a URL HTTPS do GitHub Pages.

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
  core/music.js
  data/catalog.js
  ui/score-renderer.js
  ui/focus-mode.js
assets/icons/
tests/
```

## Próximas fases recomendadas

1. Renderização completa de MusicXML com claves de Sol e Fá, compassos, ligaduras, pausas, dinâmica e duas mãos.
2. Importador e curadoria em lote de repertório público com rastreabilidade de licença.
3. Avaliação rítmica real: início, duração, andamento e estabilidade de pulso.
4. Reconhecimento polifônico offline usando modelo WebAssembly/WebGPU, mantendo MIDI como modo de alta precisão.
5. Contas opcionais e sincronização apenas numa edição online; a edição offline continuará sem login.
6. Painel de professor, criação de aulas e exportação de relatórios.

## Privacidade

O sinal do microfone é processado na memória do navegador. A versão atual não grava nem envia áudio.

## Licenças

- Código: MIT.
- Dados de arranjos didáticos do projeto: indicados como CC0-1.0 no catálogo.
- Obras e fontes externas: consultar `CATALOG_POLICY.md` e registrar a licença de cada item.
