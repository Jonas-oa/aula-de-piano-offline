# Partitura Viva

Aplicativo web offline para estudar peças completas com a partitura aberta e receber retorno sobre o tempo da execução.

## O novo foco

- repertório formado por arquivos importados pelo próprio aluno;
- importação de MusicXML para fornecer ataques, pausas e alturas estruturadas;
- compatibilidade de leitura com PDFs salvos em versões anteriores;
- reconhecimento de notas e acordes pelo microfone no modo professor com MusicXML;
- audição de partituras MusicXML com piano acústico, cursor sincronizado, andamento
  ajustável e seleção de trecho A–B com repetição opcional;
- avaliação do tempo pelo microfone em partituras PDF, diretamente no navegador;
- entrada Web MIDI para captar notas e acordes com maior precisão;
- 24 exercícios rítmicos originais para duas mãos, sem fases ou bloqueios;
- armazenamento local com IndexedDB e proteção de tela durante a prática;
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

Na opção **TOCAR**, o app sintetiza a execução com 30 amostras reais do
Salamander Grand Piano e transpõe apenas as notas intermediárias. As amostras
necessárias são carregadas sob demanda e ficam no cache para as próximas
reproduções offline. O banco completo ocupa cerca de 5,5 MB. Esta primeira
versão usa uma camada de intensidade, adequada para estudo; dinâmica e
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
```

## Formatos

- `.xml` / `.musicxml`: formato aceito na importação, com partitura estruturada e eventos exatos;
- `.pdf`: somente compatibilidade com peças já armazenadas por versões anteriores;
- Web MIDI: entrada do instrumento, sem necessidade de importar um arquivo MIDI.

PDF.js, OpenSheetMusicDisplay e seus componentes são mantidos no próprio projeto para que a leitura continue disponível offline.

As amostras de piano são derivadas do Salamander Grand Piano V3, de Alexander
Holm, sob licença CC BY 3.0. A atribuição completa está em
`assets/audio/piano/acoustic-grand/LICENSE.md`.
