# Partitura Viva

Aplicativo web offline para estudar peças completas com a partitura aberta e receber retorno sobre o tempo da execução.

## O novo foco

- repertório formado por arquivos importados pelo próprio aluno;
- importação de MusicXML aberto ou compactado (`.xml`, `.musicxml` e `.mxl`)
  para fornecer ataques, pausas e alturas estruturadas;
- compatibilidade de leitura com PDFs salvos em versões anteriores;
- leitura de partituras de piano com as duas mãos, seja em uma parte com dois
  staves, seja em duas partes separadas, respeitando claves, armadura,
  compassos, pausas, ligaduras de valor, durações pontuadas e dedilhado;
- reconhecimento de notas e acordes pelo microfone no modo professor com MusicXML;
- microfone preparado automaticamente ao abrir o estudo, com indicador visível
  e análise bloqueada até o aluno pressionar **Iniciar**;
- audição de partituras MusicXML com piano acústico, cursor sincronizado, andamento
  ajustável e seleção de trecho A–B com repetição opcional, diretamente dentro
  da tela de estudo;
- avaliação do tempo pelo microfone em partituras PDF, diretamente no navegador;
- entrada Web MIDI para captar notas e acordes com maior precisão;
- 24 exercícios rítmicos originais para duas mãos, sem fases ou bloqueios;
- armazenamento local com IndexedDB e proteção de tela durante a prática;
- modo de estudo imersivo e horizontal, com partitura de espaçamento adaptativo
  para que ataques rápidos não sobreponham cabeças, hastes e acidentes;
- funcionamento como PWA depois do primeiro carregamento.

## Limites importantes

Enquanto o conversor não estiver pronto, a tela de importação aceita somente
MusicXML. Partituras PDF salvas em versões anteriores continuam disponíveis
para leitura e avaliação rítmica, mas o aplicativo não oferece novo upload nem
conversão de PDF.

Com MusicXML, o motor acústico usa o evento esperado para reconhecer notas
avulsas e acordes, incluindo notas ausentes e extras. Em PDF puro, onde as
alturas não são conhecidas, o microfone continua avaliando somente os ataques
rítmicos. MIDI permanece a opção de maior precisão em ambientes ruidosos.

Dois limites do microfone valem ser conhecidos, porque vêm da física e não de
uma escolha do aplicativo:

- **no grave, notas vizinhas não se separam.** Em torno de Dó2 dois semitons
  distam menos que a resolução do quadro de análise, então o motor confere se a
  nota esperada está presente, mas não acusa nota extra abaixo de mais ou menos
  Ré3 — acusar ali seria inventar erro;
- **uma nota dobrada na oitava pode passar despercebida.** Se a partitura pede
  Sol4 e Sol5 juntos, o harmônico natural do Sol4 já ocupa a região do Sol5, e
  a falta do agudo não é detectável. Nesses trechos, o MIDI dá a resposta certa.

Na opção **TOCAR**, o app sintetiza a execução com 30 amostras reais do
Salamander Grand Piano e transpõe apenas as notas intermediárias. As 30
amostras são armazenadas junto com o aplicativo na primeira instalação,
para que qualquer partitura possa ser ouvida sem conexão. O banco completo
ocupa cerca de 5,5 MB. Esta primeira versão usa uma camada de intensidade,
adequada para estudo; dinâmica e
articulação mais detalhadas poderão ser adicionadas em um motor posterior.

O projeto não distribui partituras protegidas. O usuário deve importar arquivos que adquiriu legalmente ou que estejam em domínio público.

## Executar localmente

```bash
npm run serve
```

Abra `http://localhost:8080`. Microfone e MIDI exigem contexto seguro; `localhost` é aceito pelos navegadores modernos.

## Testes

```bash
npm test
npm run test:e2e
```

O segundo comando usa Playwright para simular a tela de estudo em um celular
horizontal. No GitHub, os dois conjuntos rodam automaticamente antes da mesclagem.

## Formatos

- `.xml` / `.musicxml`: MusicXML aberto, com partitura estruturada e eventos exatos;
- `.mxl`: MusicXML compactado; o arquivo interno é localizado e descompactado no aparelho;
- `.pdf`: somente compatibilidade com peças já armazenadas por versões anteriores;
- Web MIDI: entrada do instrumento, sem necessidade de importar um arquivo MIDI.

PDF.js e seus componentes são mantidos no próprio projeto para que a leitura continue disponível offline.

As amostras de piano são derivadas do Salamander Grand Piano V3, de Alexander
Holm, sob licença CC BY 3.0. A atribuição completa está em
`assets/audio/piano/acoustic-grand/LICENSE.md`.
