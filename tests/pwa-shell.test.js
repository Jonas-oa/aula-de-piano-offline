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

test("estudo solicita tela cheia e o PWA prioriza modo imersivo", () => {
  const app = fs.readFileSync(path.join(root, "src/app.js"), "utf8");
  const manifest = JSON.parse(
    fs.readFileSync(path.join(root, "manifest.webmanifest"), "utf8"),
  );

  assert.match(app, /requestFullscreen/);
  assert.match(app, /navigationUI: "hide"/);
  assert.match(app, /screen\.orientation\?\.lock\?\.\("landscape"\)/);
  assert.deepEqual(manifest.display_override, ["fullscreen", "standalone"]);
});
