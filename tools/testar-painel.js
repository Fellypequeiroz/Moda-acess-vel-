#!/usr/bin/env node
/**
 * testar-painel.js — confere que o painel desenha os dados certos.
 *
 * O painel é uma página que monta HTML por JavaScript. Se sobrar um escape
 * errado, a tela mostra "${p.name}" em vez do nome do produto — e isso não
 * aparece em teste de sintaxe. Aqui a gente roda o script de verdade contra um
 * DOM falso, com respostas de API simuladas, e confere o HTML gerado.
 *
 * Uso:  node tools/testar-painel.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ARQUIVO = path.join(__dirname, 'painel.html');
const html = fs.readFileSync(ARQUIVO, 'utf8');

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

function verificarContem(desc, texto, trecho) {
  const ok = String(texto).includes(trecho);
  if (ok) {
    passou++;
    console.log(`  \x1b[32m✔\x1b[0m ${desc}`);
  } else {
    falhou++;
    console.log(`  \x1b[31m✖\x1b[0m ${desc}`);
    console.log(`      não encontrei: ${JSON.stringify(String(trecho).slice(0, 70))}`);
  }
}

/* ---------------- DOM falso ---------------- */

const ouvintes = {};

function criarElemento(id) {
  const base = {
    id,
    _innerHTML: '',
    value: '',
    checked: false,
    textContent: '',
    style: {},
    dataset: {},
    classList: { add() {}, remove() {}, toggle() {} },
    addEventListener(ev, fn) {
      (ouvintes[id] = ouvintes[id] || {})[ev] = fn;
    },
    querySelectorAll() { return []; },
    querySelector() { return null; },
    closest() { return null; },
    scrollIntoView() {},
    select() {},
  };
  Object.defineProperty(base, 'innerHTML', {
    get() { return base._innerHTML; },
    set(v) { base._innerHTML = v; },
  });
  return base;
}

const elementos = {};
const nomes = [
  'contador', 'msgTopo', 'termo', 'limite', 'btnBuscar', 'btnVirais', 'btnTermos',
  'msgDescobrir', 'resultado', 'acoesResultado', 'btnAdicionar', 'btnMarcarTodos',
  'contadorSelecionados', 'chkDesconto', 'chkFrete', 'btnExportar', 'btnCopiarUrls',
  'textoUrls', 'linkExemplo', 'btnAprender', 'msgsLink', 'textoLinks', 'btnImportar',
  'msgImport', 'tabelaCatalogo', 'btnRegerar', 'mattWord', 'mattTool', 'chkAuto',
  'termos', 'cfgDesconto', 'cfgFrete', 'btnSalvarConfig', 'msgConfig',
];
nomes.forEach((n) => { elementos[n] = criarElemento(n); });

const documentoFalso = {
  getElementById: (id) => elementos[id] || criarElemento(id),
  querySelectorAll: () => [],
  querySelector: () => null,
};

/* ---------------- API simulada ---------------- */

const PRODUTO = {
  id: 'MLB20123995',
  name: 'Vestido Midi Floral Em Viscose Com Amarração',
  category: 'vestidos',
  price: 89.9,
  oldPrice: 149.9,
  image: 'data:image/jpeg;base64,AAAA',
  link: 'https://mercadolivre.com/sec/aaa111',
  store: 'Mercado Livre',
  badge: '-40% OFF',
};

const ESTADO = {
  demo: false,
  config: {
    afiliado: { matt_word: '', matt_tool: '', montarLinkAutomatico: false },
    categorias: [{ id: 'vestidos', nome: 'Vestidos', palavras: ['vestido'] }],
    busca: { termos: ['vestido feminino', 'blusa feminina'], soComDesconto: true, soFreteGratis: true },
  },
  produtos: [PRODUTO],
  total: 1,
  atualizadoEm: '2026-09-18T12:00:00.000Z',
};

const chamadas = [];

global.fetch = async (rota, opcoes) => {
  chamadas.push(rota);
  let dados = {};

  if (rota === '/api/estado') dados = ESTADO;
  else if (rota === '/api/descobrir') {
    dados = {
      produtos: [
        { ...PRODUTO, id: 'MLB1', name: 'Vestido Teste Um', price: 89.9, discount: 40 },
        { ...PRODUTO, id: 'MLB2', name: 'Vestido Teste Dois', price: 51, discount: null, oldPrice: null },
      ],
    };
  } else if (rota === '/api/adicionar') dados = { adicionados: 2, atualizados: 0, falhas: [], total: 3 };
  else if (rota === '/api/links/exportar') dados = { quantidade: 1, texto: 'https://produto.mercadolivre.com.br/MLB-1-x-_JM', arquivo: 'links-para-painel.txt' };
  else if (rota === '/api/detalhe') dados = { parametros: { matt_word: 'fellype', matt_tool: '123' } };

  return { ok: true, json: async () => dados };
};

/* ---------------- executa o painel ---------------- */

const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join('\n');

console.log('\n\x1b[1mPainel — rodando o script da página\x1b[0m');
verificar('achei o script do painel', script.length > 1000, true);

let erro = null;
try {
  new Function('document', 'fetch', 'navigator', 'alert', 'confirm', script)(
    documentoFalso, global.fetch, { clipboard: { writeText: async () => {} } }, () => {}, () => true
  );
} catch (e) {
  erro = e;
}
verificar('o script roda sem erro', erro, null);
if (erro) {
  console.log(`      \x1b[31m${erro.message}\x1b[0m`);
  console.log(`\n  \x1b[31m${passou} passaram, ${falhou} falharam\x1b[0m\n`);
  process.exit(1);
}

/* ---------------- depois do carregamento ---------------- */

setTimeout(async () => {
  console.log('\n\x1b[1mTela do catálogo\x1b[0m');

  const tabela = elementos.tabelaCatalogo.innerHTML;
  verificar('a tabela foi desenhada', tabela.length > 100, true);
  verificarContem('mostra o nome do produto', tabela, PRODUTO.name);
  verificarContem('mostra o preço formatado',
    tabela, (89.9).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));
  verificarContem('mostra o preço antigo riscado', tabela, (149.9).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));
  verificarContem('mostra a categoria', tabela, 'vestidos');
  verificarContem('mostra o link do produto', tabela, PRODUTO.link);
  verificar('NENHUM escape vazou para a tela (nada de "${")', tabela.includes('${'), false);
  verificar('nenhum "undefined" na tela', tabela.includes('undefined'), false);

  console.log('\n\x1b[1mContador e campos\x1b[0m');
  verificar('contador no topo', elementos.contador.textContent, '1 produto');
  verificar('termos salvos carregados no campo',
    elementos.termos.value, 'vestido feminino\nblusa feminina');
  verificar('caixa "só com desconto" reflete a config', elementos.chkDesconto.checked, true);

  console.log('\n\x1b[1mBusca: o que aparece na tela\x1b[0m');
  verificar('o botão Buscar tem ação ligada', typeof ouvintes.btnBuscar?.click === 'function', true);

  if (ouvintes.btnBuscar && ouvintes.btnBuscar.click) {
    elementos.termo.value = 'vestido';
    await ouvintes.btnBuscar.click();
    await new Promise((r) => setTimeout(r, 50));

    const grade = elementos.resultado.innerHTML;
    verificar('desenhou um card por produto', (grade.match(/class="item"/g) || []).length, 2);
    verificarContem('mostra o nome do 1º produto', grade, 'Vestido Teste Um');
    verificarContem('mostra o nome do 2º produto', grade, 'Vestido Teste Dois');
    verificarContem('mostra o selo de desconto', grade, '-40%');
    verificar('NENHUM escape vazou nos cards', grade.includes('${'), false);
    verificar('nenhum "undefined" nos cards', grade.includes('undefined'), false);
    verificar('a área de ações apareceu', elementos.acoesResultado.style.display, 'flex');
  }

  console.log(`\n${'─'.repeat(52)}`);
  console.log(`  \x1b[32m${passou} passaram\x1b[0m   ${falhou ? `\x1b[31m${falhou} falharam\x1b[0m` : '0 falharam'}`);
  console.log(`${'─'.repeat(52)}\n`);
  process.exit(falhou ? 1 : 0);
}, 100);
