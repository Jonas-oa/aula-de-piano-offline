# Partitura Viva

Aplicativo web offline para estudar peças completas com a partitura aberta e receber retorno sobre o tempo da execução.

## O novo foco

- repertório formado por arquivos importados pelo próprio aluno;
- leitura de PDF com troca de página e zoom;
- MusicXML opcional para fornecer ataques, pausas e alturas estruturadas;
- avaliação do tempo pelo microfone, diretamente no navegador;
- microfone solicitado e calibrado automaticamente ao abrir uma partitura;
- entrada Web MIDI para captar notas e acordes com maior precisão;
- modo de estudo exclusivo em paisagem, com tela cheia e teclado visual;
- 24 exercícios rítmicos originais para duas mãos, sem fases ou bloqueios;
- armazenamento local com IndexedDB e proteção de tela durante a prática;
- funcionamento como PWA depois do primeiro carregamento.

## Limites importantes

Todo PDF importado é preparado imediatamente como uma peça de estudo: páginas, visualização, andamento e grade rítmica ficam disponíveis. Um PDF descreve páginas, não eventos musicais; para verificar exatamente as notas, pausas e durações escritas, importe também o MusicXML correspondente.

O microfone detecta ataques acústicos para avaliar o ritmo. Em acordes de piano, a identificação exata de todas as alturas é mais confiável usando um piano digital conectado por MIDI.

O projeto não distribui partituras protegidas. O usuário deve importar arquivos que adquiriu legalmente ou que estejam em domínio público.

## Executar localmente

```bash
npm run serve
```

Abra `http://localhost:8080`. Microfone e MIDI exigem contexto seguro; `localhost` é aceito pelos navegadores modernos.

## Testes

```bash
npm test
```

## Formatos

- `.pdf`: partitura visual e avaliação pela grade de tempo;
- `.xml` / `.musicxml`: partitura estruturada e eventos exatos;
- Web MIDI: entrada do instrumento, sem necessidade de importar um arquivo MIDI.

PDF.js, OpenSheetMusicDisplay e seus componentes são mantidos no próprio projeto para que a leitura continue disponível offline.
