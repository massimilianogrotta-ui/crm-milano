// Sweep temporaneo: elenca OGNI stringa JSX renderizzata che non passa da t(),
// senza il filtro "marcatori ortografici portoghesi" — così troviamo anche i
// falsi negativi del guardiano esistente (parole come "Cancelar", "Salvar",
// "Novo Lead" che non hanno ç/ã/õ e sfuggono al regex attuale).
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import ts from "typescript";

const RAIZ = process.cwd();
const AREAS = ["app", "components"];
const PASTAS_IGNORADAS = new Set(["api", "node_modules"]);

const ATRIBUTOS_VISIVEIS = new Set([
  "placeholder", "title", "alt", "label", "description", "aria-label",
  "aria-description", "aria-placeholder", "aria-roledescription",
  "emptyMessage", "tooltip", "helperText",
]);

const TEM_PALAVRA = /\p{L}\p{L}/u;
const ENDERECO_DE_REDE = /^(https?:\/\/\S+|[^\s@]+@[^\s@]+\.[^\s@]+|[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?)$/i;

function ehPadraoDeData(texto) {
  const semLiterais = texto.replace(/'[^']*'/g, "");
  return semLiterais.trim().length > 0 && /^[EdMyHhmsaGQwWkKSzZXx\s,.:/-]+$/.test(semLiterais);
}
function soEnderecosDeRede(texto) {
  const linhas = texto.split(/[\n,;]/).map((l) => l.trim()).filter(Boolean);
  return linhas.length > 0 && linhas.every((l) => ENDERECO_DE_REDE.test(l));
}
function telas(dir, acc = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (PASTAS_IGNORADAS.has(e.name) || e.name.startsWith(".")) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) telas(p, acc);
    else if (e.name.endsWith(".tsx") && !e.name.endsWith(".test.tsx")) acc.push(p);
  }
  return acc;
}
function emPosicaoDeFilhoJsx(no) {
  for (let p = no.parent; p; p = p.parent) {
    if (ts.isJsxExpression(p)) {
      const pai = p.parent;
      return ts.isJsxElement(pai) || ts.isJsxFragment(pai) || ts.isJsxSelfClosingElement(pai);
    }
    if (ts.isJsxAttribute(p) || ts.isFunctionLike(p)) return false;
  }
  return false;
}
function ehOperandoDeComparacao(no) {
  const pai = no.parent;
  if (!pai || !ts.isBinaryExpression(pai)) return false;
  const op = pai.operatorToken.kind;
  return (
    op === ts.SyntaxKind.EqualsEqualsEqualsToken ||
    op === ts.SyntaxKind.ExclamationEqualsEqualsToken ||
    op === ts.SyntaxKind.EqualsEqualsToken ||
    op === ts.SyntaxKind.ExclamationEqualsToken
  );
}
function dentroDeChamadaDeTraducao(no) {
  for (let p = no.parent; p; p = p.parent) {
    if (ts.isCallExpression(p)) {
      const alvo = p.expression;
      const nome = ts.isIdentifier(alvo) ? alvo.text : ts.isPropertyAccessExpression(alvo) ? alvo.name.text : "";
      if (nome === "t" || nome === "traduzir") return true;
    }
  }
  return false;
}

const achados = [];
for (const area of AREAS) {
  for (const arq of telas(join(RAIZ, area))) {
    const rel = relative(RAIZ, arq);
    const fonte = ts.createSourceFile(arq, readFileSync(arq, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const local = (no) => `${rel.split(sep).join("/")}:${fonte.getLineAndCharacterOfPosition(no.getStart()).line + 1}`;
    const visita = (no) => {
      if (ts.isJsxText(no)) {
        const texto = no.text.replace(/\s+/g, " ").trim();
        if (texto && TEM_PALAVRA.test(texto) && !soEnderecosDeRede(texto)) {
          achados.push({ local: local(no), texto, origem: "texto na tela" });
        }
      }
      if (
        (ts.isStringLiteral(no) || ts.isNoSubstitutionTemplateLiteral(no)) &&
        !dentroDeChamadaDeTraducao(no) &&
        !ehOperandoDeComparacao(no) &&
        TEM_PALAVRA.test(no.text) &&
        !soEnderecosDeRede(no.text) &&
        !ehPadraoDeData(no.text) &&
        emPosicaoDeFilhoJsx(no)
      ) {
        achados.push({ local: local(no), texto: no.text, origem: "literal renderizado" });
      }
      if (ts.isJsxAttribute(no) && no.initializer) {
        const nome = no.name.getText(fonte);
        if (ATRIBUTOS_VISIVEIS.has(nome)) {
          const init = no.initializer;
          const lit = ts.isStringLiteral(init) ? init
            : ts.isJsxExpression(init) && init.expression && (ts.isStringLiteral(init.expression) || ts.isNoSubstitutionTemplateLiteral(init.expression)) ? init.expression
            : null;
          if (lit && TEM_PALAVRA.test(lit.text) && !soEnderecosDeRede(lit.text) && !dentroDeChamadaDeTraducao(lit)) {
            achados.push({ local: local(lit), texto: lit.text, origem: nome });
          }
        }
      }
      ts.forEachChild(no, visita);
    };
    visita(fonte);
  }
}
writeFileSync("/tmp/sweep-raw.json", JSON.stringify(achados, null, 2));
console.log("total achados:", achados.length);
