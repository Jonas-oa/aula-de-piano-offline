# Partitura Viva

Aplicativo web offline para estudar peças completas com a partitura aberta e receber retorno sobre o tempo da execução.

## O novo foco

- repertório formado por arquivos importados pelo próprio aluno;
- importação de MusicXML aberto ou compactado (`.xml`, `.musicxml` e `.mxl`)
  para fornecer ataques, pausas e alturas estruturadas;
- compatibilidade de leitura com PDFs salvos em versões anteriores;
- leitura de partituras de piano com as duas mãos, seja em uma parte com dois
  staves, seja em duas partes separadas, respeitando claves, armadura,
  compassos, pausas, ligaduras de valor, durações pontuadas, dedilhado e barras
  de união de colcheias, semicolcheias e figuras menores;
- barras de união fiéis ao MusicXML quando o arquivo informa `beam`, com
  agrupamento automático por pulsação como reserva para arquivos incompletos;
- reconhecimento de notas e acordes pelo microfone em **Aguardar notas** com MusicXML;
- motor neural Basic Pitch opcional em modo de diagnóstico: analisa as 88
  teclas em paralelo, mostra probabilidades e latência, mas ainda não move o
  cursor nem substitui o motor acústico validado;
- estudo isolado por **duas mãos**, **mão direita** ou **mão esquerda**, quando a
  partitura traz claves, pautas ou partes identificáveis;
- seleção de trechos encaixada automaticamente nos limites dos compassos, com
  repetição opcional;
- microfone preparado automaticamente ao abrir o estudo, com indicador visível
  e análise bloqueada até o aluno pressionar **Iniciar**;
- audição de partituras MusicXML com piano acústico, cursor sincronizado, andamento
  ajustável por BPM ou porcentagem do original, retomada automática no mesmo
  ponto e seleção de trecho A–B com repetição opcional, diretamente dentro da
  tela de estudo;
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

O painel **Motor neural experimental** usa o modelo Basic Pitch e TensorFlow.js
localmente. Depois de ligado, ele precisa de cerca de dois segundos de áudio
para a primeira janela e passa a comparar a probabilidade das 88 teclas com a
nota esperada. Nenhum áudio é enviado ou armazenado. A exportação de diagnóstico
contém somente notas MIDI, probabilidades, latência e contagem de tensores. Esse
modo é deliberadamente observacional: os dados de aparelhos reais serão usados
para definir limiares antes que o modelo possa controlar a partitura.

O microfone abre sem controle automático de ganho, então o nível entregue varia
muito entre aparelhos. Os limiares do motor acompanham o que a sala e o aparelho
entregam, em vez de exigir um valor fixo, e o medidor de nível na tela de estudo
mostra a folga real. Se ele ficar quase vazio enquanto você toca, o aplicativo
avisa que precisa de mais sinal: aproxime o aparelho do instrumento.

Dois limites do microfone valem ser conhecidos, porque vêm da física e não de
uma escolha do aplicativo:

- **no grave, notas vizinhas não se separam.** Em torno de Dó2 dois semitons
  distam menos que a resolução do quadro de análise, então o motor confere se a
  nota esperada está presente, mas não acusa nota extra abaixo de mais ou menos
  Ré3 — acusar ali seria inventar erro;
- **uma nota dobrada na oitava pode passar despercebida.** Se a partitura pede
  Sol4 e Sol5 juntos, o harmônico natural do Sol4 já ocupa a região do Sol5, e
  a falta do agudo não é detectável. Nesses trechos, o MIDI dá a resposta certa;
- **a nota anterior continua soando.** Uma corda de piano vibra por segundos, e
  exigir silêncio antes de cada nota travaria qualquer melodia ligada. Por isso
  as alturas que o motor já aceitou não são cobradas como nota extra pelos
  segundos seguintes. Isso não cria acerto falso — nota extra só impede o
  avanço, nunca o provoca —, mas significa que repetir por engano a nota que
  acabou de soar, junto com a nota certa, não é acusado.

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
npm run check:neural
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
