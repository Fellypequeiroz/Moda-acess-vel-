#!/usr/bin/env node
/**
 * testar-render.js — confere que a vitrine realmente monta os cards.
 *
 * Não tem navegador aqui no ambiente, então este teste roda o script do site
 * contra um DOM falso e confere o HTML que ele gerou. Assim dá para saber se
 * os produtos, preços, selos e fotos chegam certos na tela.
 *
 * Uso:  node tools/testar-render.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const ALVO = process.argv[2] || 'preview-vitrine.html';
const arquivo = path.join(ROOT, ALVO);

let passou = 0;
let falhou = 0;

function verificar(desc, recebido, esperado) {
  const ok = JSON.stringify(recebido) === JSON.stringify(esperado);
  if (ok) {
    passou++;
    console.log(`  \x1b[32m✔\x1b[0m ${desc}`);
  } else {
    falhou++;
    console.log(`  \x1b[31m✖\x1b[0m ${desc}`);
    console.log(`      esperado: ${JSON.stringify(esperado)}`);
    console.log(`      recebido: ${JSON.stringify(recebido)}`);
  }
}

/* ---------------- DOM falso ---------------- */

function criarElemento(id) {
  const base = {
    id,
    _innerHTML: '',
    style: {},
    dataset: {},
    classList: { add() {}, remove() {}, toggle() {} },
    addEventListener() {},
    querySelectorAll() { return []; },
    querySelector() { return null; },
    scrollIntoView() {},
  };
  Object.defineProperty(base, 'innerHTML', {
    get() { return base._innerHTML; },
    set(v) { base._innerHTML = v; },
  });
  return base;
}

/* ---------------- execução ---------------- */

const html = fs.readFileSync(arquivo, 'utf8');

console.log(`\n\x1b[1mRodando o site: ${ALVO}\x1b[0m`);

// 1) os dados do catálogo
const blocoDados = html.match(/window\.PRODUTOS\s*=\s*(\{[\s\S]*?\});\s*<\/script>/);
verificar('o arquivo traz os dados do catálogo embutidos', Boolean(blocoDados), true);

if (!blocoDados) { console.log('\n\x1b[31mNão dá para continuar sem os dados.\x1b[0m\n'); process.exit(1); }

const dados = JSON.parse(blocoDados[1]);
console.log(`  \x1b[2m(${dados.produtos.length} produtos, ${dados.categorias.length} categorias)\x1b[0m`);

// 2) o script da vitrine
const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
verificar('o arquivo tem 2 blocos de script (dados + vitrine)', scripts.length, 2);

const elementos = {};
['productsGrid', 'filterBar', 'menuToggle', 'nav', 'produtos'].forEach((id) => {
  elementos[id] = criarElemento(id);
});

const falsoDocumento = {
  getElementById: (id) => elementos[id] || criarElemento(id),
  querySelectorAll: () => [],
  querySelector: () => null,
};

let erroDeExecucao = null;
try {
  new Function('window', 'document', scripts.join('\n'))({}, falsoDocumento);
} catch (e) {
  erroDeExecucao = e;
}

verificar('o script da vitrine roda sem erro', erroDeExecucao, null);
if (erroDeExecucao) {
  console.log(`      \x1b[31m${erroDeExecucao.message}\x1b[0m`);
  console.log(`\n  \x1b[31m${passou} passaram, ${falhou} falharam\x1b[0m\n`);
  process.exit(1);
}

/* ---------------- o que foi renderizado ---------------- */

const grade = elementos.productsGrid.innerHTML || '';
const filtros = elementos.filterBar.innerHTML || '';

console.log('\n\x1b[1mO que apareceu na tela\x1b[0m');

const cards = (grade.match(/<article class="product-card">/g) || []).length;
verificar('um card para cada produto', cards, dados.produtos.length);

verificar('todos os cards têm foto', (grade.match(/<img src="/g) || []).length, dados.produtos.length);
verificar('todos os cards têm botão de link',
  (grade.match(/class="product-btn"/g) || []).length, dados.produtos.length);

verificar('links abrem em aba nova',
  (grade.match(/target="_blank"/g) || []).length, dados.produtos.length);

verificar('links marcados como patrocinados (rel sponsored)',
  (grade.match(/rel="noopener noreferrer sponsored"/g) || []).length, dados.produtos.length);

const comAntigo = dados.produtos.filter((p) => p.oldPrice).length;
verificar('preço antigo só em quem tem', (grade.match(/class="old"/g) || []).length, comAntigo);

const comSelo = dados.produtos.filter((p) => p.badge).length;
verificar('selo só em quem tem', (grade.match(/product-badge/g) || []).length, comSelo);

verificar('preços formatados em real (R$)',
  (grade.match(/R\$\s?[\d.]/g) || []).length > 0, true);

verificar('barra de filtros montada com as categorias + Todos',
  (filtros.match(/filter-btn/g) || []).length, dados.categorias.length + 1);

// valores batendo com o catálogo
const primeiro = dados.produtos[0];
verificar('nome do 1º produto aparece no HTML', grade.includes(primeiro.name.slice(0, 25)), true);

const precoFormatado = Number(primeiro.price).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
verificar('preço do 1º produto formatado certo', grade.includes(precoFormatado), true);

// HTML escapado / sem quebra
verificar('nenhum "undefined" vazou para a tela', /undefined/.test(grade), false);
verificar('nenhuma URL relativa quebrada na grade', /src="imagens\//.test(grade), false);

console.log(`\n${'─'.repeat(52)}`);
console.log(`  \x1b[32m${passou} passaram\x1b[0m   ${falhou ? `\x1b[31m${falhou} falharam\x1b[0m` : '0 falharam'}`);
console.log(`${'─'.repeat(52)}\n`);

process.exit(falhou ? 1 : 0);
