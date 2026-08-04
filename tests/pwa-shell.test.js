import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Percorre o grafo de importações a partir de src/app.js — estáticas e
// dinâmicas — para descobrir de quais arquivos o aplicativo realmente depende.
// Uma lista escrita à mão no teste só repete a lista escrita à mão no sw.js:
// as duas erram juntas quando um módulo novo entra e ninguém lembra do cache.
function collectModuleGraph(entry) {
  const found = new Set();
  const queue = [path.resolve(root, entry)];

  while (queue.length) {
    const file = queue.pop();
    const relative = path.relative(root, file);
    if (found.has(relative) || !fs.existsSync(file)) continue;
    found.add(relative);
    if (!/\.m?js$/.test(file)) continue;

    const source = fs.readFileSync(file, "utf8");
    const specifiers = [
      ...source.matchAll(/(?:^|[^.\w])(?:import|export)\s[^;]*?from\s*["']([^"']+)["']/gs),
      ...source.matchAll(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/g),
      ...source.matchAll(/new URL\(\s*["'](\.[^"']+)["']\s*,\s*import\.meta\.url/g),
    ].map((match) => match[1]);

    for (const specifier of specifiers) {
      if (!specifier.startsWith(".")) continue; // nada de externo neste projeto
      queue.push(path.resolve(path.dirname(file), specifier));
    }
  }
  return [...found];
}

test("todo módulo alcançável a partir do app entra no shell offline", () => {
  const worker = fs.readFileSync(path.join(root, "sw.js"), "utf8");
  const modules = collectModuleGraph("src/app.js")
    .filter((file) => /\.m?js$/.test(file));

  assert.ok(modules.length >= 15, "o grafo de importações não foi percorrido");
  for (const module of modules) {
    assert.ok(
      worker.includes(`./${module.split(path.sep).join("/")}`),
      `${module} é carregado pelo app mas não está no APP_SHELL — ficaria de fora offline`,
    );
  }
});

test("o shell não promete arquivos que não existem no repositório", () => {
  // `cache.addAll` é atômico: um único recurso ausente derruba a instalação
  // inteira e o aplicativo simplesmente não funciona offline, sem aviso.
  const worker = fs.readFileSync(path.join(root, "sw.js"), "utf8");
  // Duas formas no sw.js: caminhos completos em APP_SHELL e nomes soltos de
  // amostra, montados depois com o prefixo da pasta do piano.
  const listed = [
    ...[...worker.matchAll(/"\.\/([^"]+)"/g)].map((match) => match[1]),
    ...[...worker.matchAll(/"([^"/]+\.mp3)"/g)]
      .map((match) => `assets/audio/piano/acoustic-grand/${match[1]}`),
  ]
    .map((entry) => decodeURIComponent(entry))
    .filter((entry) => entry && !entry.endsWith("/"));

  assert.ok(listed.length >= 50, "a leitura do APP_SHELL falhou");
  for (const entry of listed) {
    assert.ok(
      fs.existsSync(path.join(root, entry)),
      `${entry} está no APP_SHELL mas não existe no repositório`,
    );
  }
});

test("o cache do shell é versionado", () => {
  // A versão precisa existir e mudar a cada shell novo; o valor exato é
  // irrelevante e prendê-lo aqui só obriga a editar o teste junto.
  const worker = fs.readFileSync(path.join(root, "sw.js"), "utf8");
  assert.match(worker, /const CACHE_NAME = "partitura-viva-v\d+-\d+"/);
});

test("todas as amostras do piano ficam disponíveis na primeira instalação offline", () => {
  const worker = fs.readFileSync(path.join(root, "sw.js"), "utf8");
  const sampleDirectory = path.join(root, "assets/audio/piano/acoustic-grand");
  const samples = fs.readdirSync(sampleDirectory)
    .filter((name) => name.endsWith(".mp3"))
    .sort();

  assert.equal(samples.length, 30);
  for (const sample of samples) {
    // Sustenidos precisam aparecer codificados; "#" cru viraria fragmento da URL.
    assert.match(worker, new RegExp(sample.replace("#", "%23").replaceAll(".", "\\.")));
  }
});

test("o shell não carrega mais o leitor OpenSheetMusicDisplay", () => {
  // A pauta é desenhada pelo renderizador SVG próprio; o OSMD saiu do projeto.
  for (const file of ["sw.js", "index.html"]) {
    assert.doesNotMatch(
      fs.readFileSync(path.join(root, file), "utf8"),
      /opensheetmusicdisplay/i,
    );
  }
  assert.equal(fs.existsSync(path.join(root, "vendor/osmd")), false);
});

test("todo elemento que o app procura existe no HTML", () => {
  // `byId` devolve null silenciosamente e o app só quebra quando o usuário
  // chega naquela tela. Conferir o contrato inteiro de uma vez vale mais que
  // listar à mão os ids que alguém lembrou de citar.
  const app = fs.readFileSync(path.join(root, "src/app.js"), "utf8");
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const ids = [...new Set([...app.matchAll(/byId\("([^"]+)"\)/g)].map((m) => m[1]))];

  assert.ok(ids.length >= 50, "a leitura dos ids usados pelo app falhou");
  const missing = ids.filter((id) => !html.includes(`id="${id}"`));
  assert.deepEqual(missing, [], "o app procura elementos que o HTML não define");
});

test("o repertório é uma pasta retrátil que não esconde a primeira importação", () => {
  const app = fs.readFileSync(path.join(root, "src/app.js"), "utf8");
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");

  assert.match(html, /<details id="repertoirePanel"[^>]*class="[^"]*library-folder/);
  assert.match(html, /id="repertoireCount"/);
  assert.match(html, /id="pieceGrid"[\s\S]*data-view-target="importView"[\s\S]*<\/details>/);
  assert.match(app, /panel\.open = total === 0/);
  assert.match(app, /repertoirePanel"\)\.open = true/);
});

test("a importação só oferece os formatos que o app sabe abrir", () => {
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  assert.match(html, /accept="[^"]*\.musicxml/);
  assert.match(html, /accept="[^"]*\.mxl/);
  // PDF é só compatibilidade com peças já salvas; não há upload novo.
  assert.doesNotMatch(html, /accept="[^"]*\.pdf/);
});

test("o gesto na pauta não é engolido pela rolagem do navegador", () => {
  // Único ponto do CSS com consequência funcional: sem `touch-action: none`, o
  // navegador assume o arrasto e o gesto de mover a pauta e marcar A–B morre no
  // toque. As medidas de layout ficam fora do teste de propósito — prender
  // pixels aqui obriga a editar o teste a cada ajuste visual, sem proteger nada.
  const css = fs.readFileSync(path.join(root, "styles.css"), "utf8");
  assert.match(
    css,
    /\.document-stage svg\[data-score-key\]\s*\{[^}]*touch-action:\s*none/s,
  );
});

test("a audição é controlada de dentro da tela de estudo", () => {
  const app = fs.readFileSync(path.join(root, "src/app.js"), "utf8");
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  // Os controles de audição vivem na tela de estudo e o gesto na pauta está
  // ligado — o que antes era conferido por trechos literais de código.
  assert.match(html, /id="playbackControls"/);
  assert.match(app, /playbackControls"\)\.hidden = false/);
  assert.match(app, /addEventListener\("pointerdown", beginScoreGesture\)/);
});

test("o metrônomo fica junto das ações principais e acompanha o andamento", () => {
  const app = fs.readFileSync(path.join(root, "src/app.js"), "utf8");
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");

  assert.match(
    html,
    /id="practicePrimaryActions"[\s\S]*id="startPracticeButton"[\s\S]*id="metronomeButton"/,
  );
  assert.match(html, /id="metronomeButton"[^>]*aria-pressed="false"/);
  assert.match(app, /metronomeEngine\.setTempo\(bpm\)/);
  assert.match(app, /metronomeEngine\.start\([\s\S]*beatsPerBar: currentBeatsPerBar\(\)/);
});

test("os modos e ações usam nomes que explicam o resultado", () => {
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");

  assert.match(html, />Aguardar notas</);
  assert.match(html, />Avaliar ritmo</);
  assert.match(html, />♫ Ouvir partitura</);
  assert.match(html, />↻ Repetir trecho</);
  assert.doesNotMatch(html, />Professor</);
  assert.doesNotMatch(html, />Tempo</);
  assert.doesNotMatch(html, />Marcar A</);
  assert.doesNotMatch(html, />Marcar B</);
});

test("estudo solicita tela cheia e o PWA prioriza modo imersivo", () => {
  const app = fs.readFileSync(path.join(root, "src/app.js"), "utf8");
  const manifest = JSON.parse(
    fs.readFileSync(path.join(root, "manifest.webmanifest"), "utf8"),
  );

  assert.match(app, /requestFullscreen/);
  assert.match(app, /navigationUI: "hide"/);
  assert.match(app, /screen\.orientation\?\.lock\?\.\("landscape"\)/);
  assert.deepEqual(manifest.display_override, ["fullscreen", "standalone"]);
  assert.equal(manifest.orientation, "landscape");
});

test("microfone é preparado ao abrir o estudo e informa seu estado", () => {
  const app = fs.readFileSync(path.join(root, "src/app.js"), "utf8");
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");

  assert.match(app, /showView\("practiceView"\);[\s\S]*?preparePracticeInput\(\)/);
  assert.match(app, /state\.currentView !== "practiceView"/);
  assert.match(html, /id="inputStatus"/);
  assert.match(html, /Microfone em espera/);
});

test("falhas acústicas orientam o aluno em vez de deixar a pauta parada", () => {
  const app = fs.readFileSync(path.join(root, "src/app.js"), "utf8");

  assert.match(app, /SOM MUITO BAIXO/);
  assert.match(app, /ATAQUE SUAVE/);
  assert.match(app, /SOLTE A TECLA/);
});

test("reconhecimento neural oficial é automático, seguro e mantém redundância acústica", () => {
  const app = fs.readFileSync(path.join(root, "src/app.js"), "utf8");
  const neural = fs.readFileSync(
    path.join(root, "src/core/neural-piano-shadow-engine.js"),
    "utf8",
  );
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");

  assert.match(app, /neuralUiState\.advanceEnabled[\s\S]*state\.practiceActive/);
  assert.match(app, /void startOfficialNeuralRecognition\(\)/);
  assert.match(app, /await setNeuralEnabled\(true\)/);
  assert.match(app, /evaluateNeuralFollowResult\(result,\s*latestExpected,\s*gateOptions\)/);
  assert.match(app, /registerFollowChord\(state\.follow,\s*latestExpected\)/);
  // Os dois motores compartilham a lista de cordas ainda soando, e o neural só
  // julga o áudio posterior ao instante em que o cursor armou a nota.
  assert.match(app, /ignoreMidis:\s*pianoRecognition\.ringingMidis\(/);
  assert.match(app, /neuralShadowEngine\.setExpected\(expected,\s*timestamp\)/);
  assert.doesNotMatch(neural, /registerFollow|forceFollowAdvance|handleFollowResult/);
  assert.doesNotMatch(
    html,
    /Reconhecimento neural|id="neuralDiagnostics"|id="exportNeuralDiagnosticsButton"/,
  );
});

test("teclado de apoio pode ser recolhido e mantém a preferência", () => {
  const app = fs.readFileSync(path.join(root, "src/app.js"), "utf8");
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const css = fs.readFileSync(path.join(root, "styles.css"), "utf8");

  assert.match(html, /id="keyboardVisibilityButton"/);
  assert.match(app, /partitura-viva-keyboard-visible/);
  assert.match(app, /localStorage\.setItem\(KEYBOARD_PREF_KEY,\s*String\(expanded\)\)/);
  assert.match(css, /\.practice-workspace\.keyboard-hidden/);
  assert.match(css, /\.piano-panel\.is-collapsed[\s\S]*\.piano-keyboard/);
});

test("o aviso de girar o aparelho não é apagado pelo `hidden` global", () => {
  // `[hidden] { display: none !important }` vence a media query de retrato. Com
  // o atributo no HTML, o aviso nunca aparecia e o aluno via apenas a tela de
  // estudo borrada, sem saber que faltava girar o aparelho.
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const css = fs.readFileSync(path.join(root, "styles.css"), "utf8");

  assert.doesNotMatch(html, /id="rotateOverlay"[^>]*\shidden/);
  assert.match(css, /\.rotate-overlay\s*\{[^}]*display:\s*none/);
  assert.match(css, /orientation:\s*portrait/);
});

test("a importação recusa partituras sem notas e respeita o compasso do arquivo", () => {
  const app = fs.readFileSync(path.join(root, "src/app.js"), "utf8");
  // Uma peça sem ataques abriria uma tela de estudo permanentemente vazia.
  assert.match(app, /Esta partitura não contém notas para estudar/);
  // O cartão do repertório precisa dizer a mesma fórmula que a tela de estudo
  // usa — e ela vem do arquivo, não do seletor padrão em 4\/4.
  assert.match(app, /timeSignature: parsed\?\.timeSignature \|\| byId\("pieceTimeSignature"\)\.value/);
});

test("o service worker nunca responde com `undefined` quando está offline", () => {
  // `caches.match` resolve para `undefined` quando não encontra nada, e
  // devolver isso ao `respondWith` vira erro de rede cru em vez da casca salva.
  const worker = fs.readFileSync(path.join(root, "sw.js"), "utf8");
  assert.match(worker, /function offlineResponse\(\)/);
  assert.doesNotMatch(worker, /\.catch\(\(\) => caches\.match\("\.\/index\.html"\)\)/);
  assert.match(worker, /offlineResponse\(\)\)?,?\s*\n?\s*\);?/);
});
