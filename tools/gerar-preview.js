#!/usr/bin/env node
/**
 * gerar-preview.js
 * ===========================================================================
 * Cria UM único arquivo (preview-vitrine.html) com tudo dentro:
 * o HTML, o CSS, os produtos e as fotos.
 *
 * Serve para você abrir a vitrine com dois cliques, sem servidor, sem
 * internet e sem depender da pré-visualização do Arena.
 *
 * Uso:  node tools/gerar-preview.js
 *
 * Importante: este arquivo é só para OLHAR. O site de verdade continua sendo
 * o index.html + produtos.js + imagens/. Se você mudar os produtos, rode este
 * comando de novo para o preview ficar atualizado.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vitrine = require('./lib/vitrine');

const ROOT = vitrine.ROOT;
const SAIDA = path.join(ROOT, 'preview-vitrine.html');

const MIMES = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
};

/** Transforma o caminho de uma foto no próprio conteúdo dela (base64). */
function embutirImagem(caminhoRelativo) {
  if (!caminhoRelativo || /^(data:|https?:)/i.test(caminhoRelativo)) return caminhoRelativo;

  const absoluto = path.join(ROOT, caminhoRelativo);
  if (!fs.existsSync(absoluto)) {
    console.warn(`  ⚠ foto não encontrada: ${caminhoRelativo}`);
    return caminhoRelativo;
  }

  const ext = path.extname(absoluto).toLowerCase();
  const mime = MIMES[ext] || 'image/jpeg';
  return `data:${mime};base64,${fs.readFileSync(absoluto).toString('base64')}`;
}

function gerar() {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const catalogo = vitrine.lerCatalogo();
  const config = vitrine.lerConfig();

  console.log(`• ${catalogo.produtos.length} produtos no catálogo`);

  // 1) embute as fotos
  let comFotos = 0;
  const produtos = catalogo.produtos.map((p) => {
    if (p.image && !/^(data:|https?:)/i.test(p.image)) comFotos++;
    return { ...p, image: embutirImagem(p.image) };
  });
  console.log(`• ${comFotos} foto(s) embutidas no arquivo`);

  // 2) dados que o site espera
  const dados = {
    atualizadoEm: catalogo.atualizadoEm,
    categorias: catalogo.categorias?.length
      ? catalogo.categorias
      : [...new Set(produtos.map((p) => p.category))].map((id) => {
          const c = config.categorias.find((x) => x.id === id);
          return { id, nome: c ? c.nome : id };
        }),
    produtos,
  };

  // 3) troca o <script src="produtos.js"> pelos dados embutidos
  const tagExterna = /<script\s+src="produtos\.js"><\/script>/;
  if (!tagExterna.test(html)) {
    console.error('✖ Não achei <script src="produtos.js"></script> no index.html.');
    console.error('  O preview precisa do index.html no modo automático.');
    process.exit(1);
  }

  const aviso = `
    /* ============================================================
       ARQUIVO DE PRÉ-VISUALIZAÇÃO — só para olhar a vitrine
       Gerado por: node tools/gerar-preview.js
       Os produtos e as fotos estão embutidos aqui dentro.
       O site de verdade continua sendo: index.html + produtos.js + imagens/
       ============================================================ */`;

  const novo = html
    .replace('<title>', '<title>Pré-visualização — ')
    .replace(tagExterna, `<script>${aviso}\n    window.PRODUTOS = ${JSON.stringify(dados)};</script>`);

  fs.writeFileSync(SAIDA, novo, 'utf8');

  const mb = (fs.statSync(SAIDA).size / 1024 / 1024).toFixed(2);
  console.log('');
  console.log(`✔ preview-vitrine.html criado (${mb} MB)`);
  console.log('');
  console.log('  Abra com dois cliques. Funciona offline, sem servidor.');
  console.log('  É um arquivo de leitura: para o site de verdade, use o index.html.');
  console.log('');
}

gerar();
