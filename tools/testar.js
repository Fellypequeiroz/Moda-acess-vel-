#!/usr/bin/env node
/**
 * testar.js — checagem do extrator do Mercado Livre.
 *
 * Roda com HTML de exemplo (não depende de internet) e confere se a leitura
 * está correta. Uso:  node tools/testar.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const ml = require('./lib/mercadolivre');

const FIX = path.join(__dirname, 'testes', 'fixtures');
const ler = (n) => fs.readFileSync(path.join(FIX, n), 'utf8');

let passou = 0;
let falhou = 0;

function grupo(nome) {
  console.log(`\n\x1b[1m${nome}\x1b[0m`);
}

function verificar(descricao, recebido, esperado) {
  const ok = JSON.stringify(recebido) === JSON.stringify(esperado);
  if (ok) {
    passou++;
    console.log(`  \x1b[32m✔\x1b[0m ${descricao}`);
  } else {
    falhou++;
    console.log(`  \x1b[31m✖\x1b[0m ${descricao}`);
    console.log(`      esperado: ${JSON.stringify(esperado)}`);
    console.log(`      recebido: ${JSON.stringify(recebido)}`);
  }
}

/* ---------------------------------------------------------------- */
grupo('Preços em português');

verificar('"R$ 1.234,56" -> 1234.56', ml.numeroBR('R$ 1.234,56'), 1234.56);
verificar('"R$ 89,90" -> 89.9', ml.numeroBR('R$ 89,90'), 89.9);
verificar('"R$ 60" -> 60', ml.numeroBR('R$ 60'), 60);
verificar('"1.234" -> 1234', ml.numeroBR('1.234'), 1234);
verificar('"R$ 51" -> 51', ml.numeroBR('R$ 51'), 51);
verificar('"" -> null', ml.numeroBR(''), null);
verificar('null -> null', ml.numeroBR(null), null);

/* ---------------------------------------------------------------- */
grupo('Identificar produto pela URL');

verificar('URL de catálogo (/p/MLB...)',
  ml.identificarProduto('https://www.mercadolivre.com.br/vestido-x/p/MLB20123995'),
  { id: 'MLB20123995', tipo: 'catalogo' });

verificar('URL de anúncio (produto.mercadolivre...)',
  ml.identificarProduto('https://produto.mercadolivre.com.br/MLB-4823276441-vestido-y-_JM'),
  { id: 'MLB4823276441', tipo: 'anuncio' });

verificar('URL sem MLB -> null',
  ml.identificarProduto('https://www.mercadolivre.com.br/mais-vendidos'), null);

/* ---------------------------------------------------------------- */
grupo('Limpeza de URL');

verificar('remove matt_word e matt_tool',
  ml.urlLimpa('https://produto.mercadolivre.com.br/MLB-4823276441-x-_JM?matt_word=fellype&matt_tool=123&quantity=1'),
  'https://produto.mercadolivre.com.br/MLB-4823276441-x-_JM');

verificar('detecta link curto de afiliado',
  ml.ehLinkCurto('https://mercadolivre.com/sec/1a2b3c'), true);

verificar('detecta meli.la',
  ml.ehLinkCurto('https://meli.la/2abcdef'), true);

/* ---------------------------------------------------------------- */
grupo('Imagens do CDN do ML');

verificar('promove -V.jpg para -O.jpg',
  ml.melhorarImagem('https://http2.mlstatic.com/D_Q_NP_937904-MLA116552505887_082026-V.jpg'),
  'https://http2.mlstatic.com/D_Q_NP_937904-MLA116552505887_082026-O.jpg');

verificar('promove -I.webp para -O.jpg',
  ml.melhorarImagem('https://http2.mlstatic.com/D_Q_NP_634164-MLA115097345074_082026-I.webp'),
  'https://http2.mlstatic.com/D_Q_NP_634164-MLA115097345074_082026-O.jpg');

verificar('não mexe em imagem de outro site',
  ml.melhorarImagem('https://exemplo.com/foto.jpg'),
  'https://exemplo.com/foto.jpg');

/* ---------------------------------------------------------------- */
grupo('Leitura de listagem — estado interno (__PRELOADED_STATE__)');
{
  const html = ler('listagem-preloaded.html');
  const produtos = ml.lerListagem(html);

  verificar('achou os 3 produtos', produtos.length, 3);
  verificar('nome do 1º', produtos[0].name, 'Vestido Midi Floral Em Viscose Com Amarração');
  verificar('preço do 1º', produtos[0].price, 89.9);
  verificar('preço antigo do 1º', produtos[0].oldPrice, 149.9);
  verificar('desconto calculado do 1º', produtos[0].discount, 40);
  verificar('frete grátis do 1º', produtos[0].freeShipping, true);
  verificar('id do 1º', produtos[0].id, 'MLB20123995');
  verificar('imagem promovida para -O.jpg do 1º',
    produtos[0].image,
    'https://http2.mlstatic.com/D_Q_NP_937904-MLA116552505887_082026-O.jpg');
  verificar('preço com milhar do 2º', produtos[1].price, 1234.56);
  verificar('produto sem desconto tem oldPrice null', produtos[1].oldPrice, null);
  verificar('não pegou o objeto "não sou produto"',
    produtos.some((p) => p.name === 'não sou produto'), false);
}

/* ---------------------------------------------------------------- */
grupo('Leitura de listagem — HTML dos cards (sem estado interno)');
{
  const html = ler('listagem-cards.html');
  const produtos = ml.lerListagem(html);

  verificar('achou os 3 produtos', produtos.length, 3);
  verificar('nome do 1º', produtos[0].name, 'Vestido Midi Floral Em Viscose Com Amarração');
  verificar('preço atual do 1º = 89,90 (não confundiu com o riscado)', produtos[0].price, 89.9);
  verificar('preço antigo do 1º = 149,90', produtos[0].oldPrice, 149.9);
  verificar('preço com milhar do 2º = 1234,56', produtos[1].price, 1234.56);
  verificar('2º produto veio de URL de anúncio', produtos[1].tipoUrl, 'anuncio');
  verificar('preço do 3º = 51', produtos[2].price, 51);
  verificar('preço antigo do 3º = 114', produtos[2].oldPrice, 114);
}

/* ---------------------------------------------------------------- */
grupo('Link de afiliado');

verificar('aprende matt_word e matt_tool de um link do painel',
  ml.aprenderParametros('https://produto.mercadolivre.com.br/MLB-1-x-_JM?matt_word=fellype&matt_tool=78793736&matt_source=whatsapp'),
  { matt_word: 'fellype', matt_tool: '78793736', matt_source: 'whatsapp' });

verificar('não inventa parâmetro quando não existe',
  ml.aprenderParametros('https://produto.mercadolivre.com.br/MLB-1-x-_JM'),
  {});

verificar('monta o link com a atribuição',
  ml.montarLinkAfiliado('https://produto.mercadolivre.com.br/MLB-1-x-_JM?utm_source=zap', { matt_word: 'fellype', matt_tool: '78793736' }),
  'https://produto.mercadolivre.com.br/MLB-1-x-_JM?matt_word=fellype&matt_tool=78793736');

verificar('sem atribuição, devolve a URL limpa',
  ml.montarLinkAfiliado('https://produto.mercadolivre.com.br/MLB-1-x-_JM?matt_word=antigo', {}),
  'https://produto.mercadolivre.com.br/MLB-1-x-_JM');

/* ---------------------------------------------------------------- */
grupo('Texto / entidades HTML');

verificar('decodifica acentos',
  ml.soTexto('<span>Vestido &amp; Blusa &middot;</span>').includes('Vestido & Blusa'), true);

verificar('soTexto tira tags',
  ml.soTexto('<h3><a href="#">Calça Jeans</a></h3>'), 'Calça Jeans');

/* ---------------------------------------------------------------- */
async function testesDeProduto() {
  grupo('Leitura de página de produto — JSON-LD');
  {
    const html = ler('produto-jsonld.html');
    const p = await ml.lerProdutoDoHtml(
      html,
      'https://produto.mercadolivre.com.br/MLB-4823276441-vestido-longo-cetim-alca-fina-_JM',
      { resolverImagem: false }
    );

    verificar('nome', p.name, 'Vestido Longo Cetim Alça Fina');
    verificar('preço', p.price, 1234.56);
    verificar('id', p.id, 'MLB4823276441');
    verificar('achou o link do anúncio',
      p.linkDeAnuncio, 'https://produto.mercadolivre.com.br/MLB-4823276441-vestido-longo-cetim-alca-fina-_JM');
    verificar('frete grátis', p.freeShipping, true);
  }

  grupo('Leitura de página de produto — estado interno');
  {
    const html = ler('produto-preloaded.html');
    const p = await ml.lerProdutoDoHtml(
      html,
      'https://www.mercadolivre.com.br/vestido-midi-floral/p/MLB20123995',
      { resolverImagem: false }
    );

    verificar('nome', p.name, 'Vestido Midi Floral Em Viscose Com Amarração');
    verificar('preço', p.price, 89.9);
    verificar('preço antigo', p.oldPrice, 149.9);
    verificar('imagem promovida', p.image,
      'https://http2.mlstatic.com/D_Q_NP_937904-MLA116552505887_082026-O.jpg');
    verificar('id do catálogo', p.id, 'MLB20123995');
  }
}

testesDeProduto().then(() => {
  console.log(`\n${'─'.repeat(52)}`);
  console.log(`  \x1b[32m${passou} passaram\x1b[0m   ${falhou ? `\x1b[31m${falhou} falharam\x1b[0m` : '0 falharam'}`);
  console.log(`${'─'.repeat(52)}\n`);
  process.exit(falhou ? 1 : 0);
});
