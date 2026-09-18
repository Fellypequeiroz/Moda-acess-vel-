#!/usr/bin/env node
/**
 * gerar-preview.js
 * ===========================================================================
 * Cria UM único arquivo (preview-vitrine.html) com tudo dentro: HTML, CSS,
 * produtos e fotos. Serve para abrir a vitrine com dois cliques, sem servidor,
 * sem internet e sem depender da pré-visualização do Arena.
 *
 * Uso:  node tools/gerar-preview.js              (leve, recomendado)
 *       node tools/gerar-preview.js --original   (fotos em tamanho cheio)
 *
 * As fotos são reduzidas para 360px (dá e sobra para a tela) e guardadas em
 * cache, então o arquivo fica leve e abre rápido até no celular.
 * Se o computador não tiver o ImageMagick instalado, ele usa as fotos como
 * estão — o arquivo fica maior, mas continua funcionando.
 *
 * Importante: este arquivo é só para OLHAR. O site de verdade continua sendo
 * o index.html + produtos.js + imagens/.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const vitrine = require('./lib/vitrine');

const ROOT = vitrine.ROOT;
const SAIDA = path.join(ROOT, 'preview-vitrine.html');
const CACHE = path.join(ROOT, '.cache-preview');

const args = process.argv.slice(2);
const ORIGINAIS = args.includes('--original');
const LARGURA = 360;
const QUALIDADE = 65;

const MIMES = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml',
};

/* ------------------------------------------------------------------ */
/* Ferramenta de compressão                                             */
/* ------------------------------------------------------------------ */

let comandoImagem = null;
function acharImageMagick() {
  if (comandoImagem !== null) return comandoImagem;
  for (const cmd of ['magick', 'convert']) {
    const r = spawnSync(cmd, ['-version'], { encoding: 'utf8' });
    if (r.status === 0) { comandoImagem = cmd; return cmd; }
  }
  comandoImagem = false;
  return false;
}

function resumo(txt) {
  return crypto.createHash('md5').update(txt).digest('hex').slice(0, 10);
}

/** Reduz a foto e guarda em cache. Devolve o caminho do arquivo leve. */
function comprimir(origemAbsoluta) {
  const stat = fs.statSync(origemAbsoluta);
  const assinatura = resumo(origemAbsoluta + ':' + stat.mtimeMs + ':' + LARGURA + 'x' + QUALIDADE);
  const destino = path.join(CACHE, assinatura + '.jpg');

  if (fs.existsSync(destino)) return destino;

  const cmd = acharImageMagick();
  if (!cmd) return origemAbsoluta;

  fs.mkdirSync(CACHE, { recursive: true });
  const r = spawnSync(cmd, [
    origemAbsoluta, '-resize', `${LARGURA}x`, '-quality', String(QUALIDADE), '-strip', destino,
  ], { encoding: 'utf8' });

  return r.status === 0 && fs.existsSync(destino) ? destino : origemAbsoluta;
}

/** Baixa a foto que está na internet (produtos do Mercado Livre). */
async function baixarFoto(url) {
  const destino = path.join(CACHE, 'remoto-' + resumo(url) + '.img');
  if (fs.existsSync(destino)) return destino;

  fs.mkdirSync(CACHE, { recursive: true });
  const controle = new AbortController();
  const timer = setTimeout(() => controle.abort(), 15000);
  try {
    const r = await fetch(url, {
      signal: controle.signal,
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });
    clearTimeout(timer);
    if (!r.ok) return null;
    fs.writeFileSync(destino, Buffer.from(await r.arrayBuffer()));
    return destino;
  } catch {
    clearTimeout(timer);
    return null;
  }
}

function paraBase64(caminho) {
  const ext = path.extname(caminho).toLowerCase();
  return `data:${MIMES[ext] || 'image/jpeg'};base64,${fs.readFileSync(caminho).toString('base64')}`;
}

/* ------------------------------------------------------------------ */
/* Geração                                                             */
/* ------------------------------------------------------------------ */

async function gerar() {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const catalogo = vitrine.lerCatalogo();
  const config = vitrine.lerConfig();

  console.log(`• ${catalogo.produtos.length} produtos no catálogo`);

  if (!ORIGINAIS && !acharImageMagick()) {
    console.log('  ⚠ ImageMagick não encontrado — as fotos vão no tamanho original.');
    console.log('    (não é problema, o arquivo só fica maior)');
  }

  let somaAntes = 0;
  let somaDepois = 0;
  let embutidas = 0;
  let semFoto = 0;

  const produtos = [];
  for (const p of catalogo.produtos) {
    let imagem = p.image || '';

    if (!imagem) {
      semFoto++;
    } else if (/^data:/i.test(imagem)) {
      embutidas++; // já está dentro
    } else if (/^https?:/i.test(imagem)) {
      // foto na internet (produtos do Mercado Livre)
      const baixada = await baixarFoto(imagem);
      if (baixada) {
        const leve = ORIGINAIS ? baixada : comprimir(baixada);
        somaAntes += fs.statSync(baixada).size;
        somaDepois += fs.statSync(leve).size;
        imagem = paraBase64(leve);
        embutidas++;
      } else {
        console.log(`  ⚠ não consegui baixar a foto de "${String(p.name).slice(0, 35)}" (vai ficar sem foto offline)`);
      }
    } else {
      // foto local (pasta imagens/)
      const absoluta = path.join(ROOT, imagem);
      if (fs.existsSync(absoluta)) {
        const leve = ORIGINAIS ? absoluta : comprimir(absoluta);
        somaAntes += fs.statSync(absoluta).size;
        somaDepois += fs.statSync(leve).size;
        imagem = paraBase64(leve);
        embutidas++;
      } else {
        console.log(`  ⚠ foto não encontrada: ${imagem}`);
      }
    }

    produtos.push({ ...p, image: imagem });
  }

  console.log(`• ${embutidas} foto(s) embutidas${semFoto ? `, ${semFoto} produto(s) sem foto` : ''}`);
  if (somaAntes && somaDepois && !ORIGINAIS) {
    console.log(`• fotos: ${(somaAntes / 1024 / 1024).toFixed(2)} MB → ${(somaDepois / 1024 / 1024).toFixed(2)} MB`);
  }

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

  const tagExterna = /<script\s+src="produtos\.js"><\/script>/;
  if (!tagExterna.test(html)) {
    console.error('✖ Não achei <script src="produtos.js"></script> no index.html.');
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

  const kb = fs.statSync(SAIDA).size / 1024;
  const tamanho = kb > 1024 ? (kb / 1024).toFixed(2) + ' MB' : kb.toFixed(0) + ' KB';

  console.log('');
  console.log(`✔ preview-vitrine.html criado (${tamanho})`);
  console.log('');
  console.log('  Abra com dois cliques. Funciona offline e sem servidor.');
  console.log('  Para atualizar depois de mexer nos produtos, rode este comando de novo.');
  console.log('');
}

gerar().catch((e) => {
  console.error('\n✖ Não deu para gerar o preview: ' + e.message + '\n');
  process.exit(1);
});
