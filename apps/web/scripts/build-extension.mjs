// Empacota a extensão do Chrome (apps/betting-extension) pra download no
// Evobo: todo .js passa pelo javascript-obfuscator (dificulta copiar o
// código — não impede de vez, nada impede num script que roda no navegador
// de quem instala) e sai um .zip em public/downloads/, junto de um .json com
// a versão que a página "Aposta automática" e o popup usam pra avisar de
// atualização. Roda antes do build do site (npm "prebuild"), então cada
// deploy da Vercel publica a extensão da mesma versão do código.
//
//   node scripts/build-extension.mjs              → public/downloads/…
//   OUT_DIR=/tmp/x node scripts/build-extension.mjs  → também deixa a pasta
//                                                   descompactada (testes)
import { lstatSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import JavaScriptObfuscator from "javascript-obfuscator";
import { zipSync, strToU8 } from "fflate";

const here = dirname(fileURLToPath(import.meta.url));
const SRC = join(here, "..", "..", "betting-extension");
const DEST = join(here, "..", "public", "downloads");
const ZIP_NAME = "evobo-extensao.zip";

// Só o que a extensão usa — nada de test/, README, dotfiles nem source maps
// (um .map desfaria a ofuscação), em qualquer nível.
const INCLUDE = (rel) => {
  const parts = rel.split("/");
  const name = parts.at(-1);
  return !parts.some((p) => p === "test" || p === "node_modules" || p.startsWith(".")) && !/^README/i.test(name) && !name.endsWith(".map");
};

// Sem renomear globais: os scripts conversam por window.BetanoPlan,
// window.BetanoSlip, EvoboSummary etc. (content scripts e popup carregam
// arquivos separados). Sem selfDefending/deadCode: podem quebrar ou pesar.
const OBFUSCATE = {
  compact: true,
  renameGlobals: false,
  identifierNamesGenerator: "hexadecimal",
  stringArray: true,
  stringArrayEncoding: ["base64"],
  stringArrayThreshold: 0.75,
  splitStrings: false,
  controlFlowFlattening: false,
  deadCodeInjection: false,
  selfDefending: false,
  target: "browser",
};

// lstat: não segue symlinks (um link pra fora da pasta, ou em loop).
function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    const st = lstatSync(full);
    return st.isDirectory() ? walk(full) : st.isFile() ? [full] : [];
  });
}

const manifest = JSON.parse(readFileSync(join(SRC, "manifest.json"), "utf8"));
const files = {};
for (const full of walk(SRC)) {
  const rel = relative(SRC, full).split("\\").join("/");
  if (!INCLUDE(rel)) continue;
  const raw = readFileSync(full);
  files[rel] = rel.endsWith(".js") ? strToU8(JavaScriptObfuscator.obfuscate(raw.toString("utf8"), OBFUSCATE).getObfuscatedCode()) : new Uint8Array(raw);
}

mkdirSync(DEST, { recursive: true });
// Tudo dentro de uma pasta "evobo-extensao/" — é ela que o usuário escolhe em
// "Carregar sem compactação".
const zipped = zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [`evobo-extensao/${k}`, v])), { level: 9 });
writeFileSync(join(DEST, ZIP_NAME), zipped);
writeFileSync(
  join(DEST, "evobo-extensao.json"),
  JSON.stringify({ version: manifest.version, file: `/downloads/${ZIP_NAME}`, builtAt: new Date().toISOString() }, null, 2),
);

if (process.env.OUT_DIR) {
  // Limpa antes: arquivo removido da extensão não pode sobrar na pasta de teste.
  rmSync(process.env.OUT_DIR, { recursive: true, force: true });
  for (const [rel, data] of Object.entries(files)) {
    const out = join(process.env.OUT_DIR, rel);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, data);
  }
}

console.log(`[extensão] v${manifest.version}: ${Object.keys(files).length} arquivos, ${(zipped.length / 1024).toFixed(0)} KB → public/downloads/${ZIP_NAME}`);
