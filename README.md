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
- reconhecimento neural Basic Pitch oficial no modo **Aguardar notas**: é
  ativado automaticamente nos aparelhos com aceleração por GPU, analisa as 88
  teclas e só avança com presença, novo ataque e dominância da nota esperada
  confirmados;
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

O reconhecimento neural usa o modelo Basic Pitch e TensorFlow.js localmente. Ao
pressionar **Iniciar** em **Aguardar notas** com microfone, o modelo é ativado
automaticamente. Ele precisa de cerca de dois segundos de áudio para a primeira
janela e então compara a probabilidade das 88 teclas com a nota esperada. Nenhum
áudio é enviado ou armazenado.

Cada inferência analisa todo o áudio desde o instante em que o cursor armou a
nota, e não um pedaço fixo no fim do buffer. Com a janela fixa, a maior parte do
que o aluno tocava caía no vão entre duas inferências e o ataque nunca era
visto. Em troca, o ataque da nota anterior passa a aparecer na mesma janela; as
alturas que o motor acústico já aceitou e ainda podem estar soando são
excluídas da comparação de dominância, exatamente como ele já faz.

O modelo exige aceleração por GPU. Sem ela, o TensorFlow.js calcularia no mesmo
thread que lê o microfone e o aplicativo perderia áudio de verdade — o motor
acústico, que deveria ser a redundância, ficaria surdo durante cada inferência.
Nesses aparelhos o neural é recusado de propósito e o acústico trabalha sozinho.

O motor acústico permanece ativo em paralelo: responde durante o aquecimento e
assume sozinho caso o aparelho não suporte a captura neural ou o modelo falhe.
O neural só recebe autoridade para avançar quando presença, ataque e dominância
da nota esperada ultrapassam os limiares seguros. Resultados calculados para uma
nota anterior e inferências ambíguas são descartados para impedir avanço duplo
ou falso.

O sinal do microfone é reamostrado para 22,05 kHz com um filtro passa-baixas
antes de decimar. Sem ele, tudo acima de 11 kHz voltaria dobrado para dentro da
banda que o modelo usa, como um agudo que o piano não tocou.

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
npm run check:neural:audio
npm run test:e2e
```

`npm test` cobre a lógica; nos testes do módulo neural as saídas do modelo são
fabricadas, então eles verificam o portão de decisão, não o reconhecimento.
`check:neural` confere que o pacote vendorizado do Basic Pitch corresponde a um
build novo. `check:neural:audio` é o único que executa o modelo: ele sintetiza
trechos com as amostras do Salamander e mede o que o Basic Pitch reconhece. Fica
fora do `npm test` porque cada inferência custa alguns segundos na CPU.
`test:e2e` usa Playwright para simular a tela de estudo em um celular
horizontal. No GitHub, `npm test` e `check:neural` rodam automaticamente antes
da mesclagem.

### O que o modelo entrega, medido

Números de `npm run check:neural:audio`, sobre piano sintetizado com as amostras
reais do projeto. Vale como limite superior: é timbre de piano verdadeiro, mas
sem sala, ruído nem resposta de microfone.

| Trecho | Reconhecidas | Presença / ataque da nota esperada |
| --- | --- | --- |
| Escala em Dó2 | 5 de 5 | 0,74–0,83 / 0,68–0,90 |
| Escala em Dó5 | 5 de 5 | 0,88–0,92 / 0,91–0,96 |
| Melodia ligada, 450 ms por nota | 5 de 5 | 0,87–0,89 / 0,96–0,98 |
| Sol4 e Sol5 juntos | 1 de 1 | Sol5 a 0,60 / 0,79 |
| Acordes de quatro vozes | 0 de 3 | uma voz interna a 0,23–0,51 |

Duas conclusões que só o áudio real podia dar:

- **o neural cobre os dois pontos cegos declarados do motor acústico.** No grave
  em torno de Dó2, onde a resolução do quadro acústico não separa semitons, o
  modelo acerta as cinco notas; e ele distingue o Sol5 dobrado sobre o harmônico
  do Sol4, exatamente o caso que a seção anterior descreve como indetectável
  pelo microfone sozinho;
- **acorde cheio não avança.** Com quatro vozes o modelo entrega ataque forte
  para todas, mas a probabilidade de presença de uma voz interna cai para a
  faixa de 0,23 a 0,51, abaixo do limiar de 0,55 exigido de toda nota esperada.
  Uma voz fraca recusa o acorde inteiro. Em trecho de acorde, portanto, quem
  trabalha é o motor acústico — o neural não contribui.

## Formatos

- `.xml` / `.musicxml`: MusicXML aberto, com partitura estruturada e eventos exatos;
- `.mxl`: MusicXML compactado; o arquivo interno é localizado e descompactado no aparelho;
- `.pdf`: somente compatibilidade com peças já armazenadas por versões anteriores;
- Web MIDI: entrada do instrumento, sem necessidade de importar um arquivo MIDI.

PDF.js e seus componentes são mantidos no próprio projeto para que a leitura continue disponível offline.

As amostras de piano são derivadas do Salamander Grand Piano V3, de Alexander
Holm, sob licença CC BY 3.0. A atribuição completa está em
`assets/audio/piano/acoustic-grand/LICENSE.md`.
