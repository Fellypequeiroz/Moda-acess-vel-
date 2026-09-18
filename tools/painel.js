#!/usr/bin/env node
/**
 * painel.js — painel local da vitrine
 * ===========================================================================
 * Sobe um site no seu computador para você cadastrar produtos sem mexer em
 * código nenhum.
 *
 *     node tools/painel.js
 *     http://localhost:3456/painel
 *
 * Opções:
 *     --porta 4000   usa outra porta
 *     --demo         usa dados de exemplo (para testar sem internet)
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const ml = require('./lib/mercadolivre');
const vitrine = require('./lib/vitrine');

const ROOT = vitrine.ROOT;

const args = process.argv.slice(2);
const arg = (nome, padrao) => {
  const i = args.indexOf('--' + nome);
  return i !== -1 && args[i + 1] ? args[i + 1] : padrao;
};
const PORTA = parseInt(arg('porta', '3456'), 10);
const DEMO = args.includes('--demo');

/* ------------------------------------------------------------------ */
/* Tipos de arquivo servidos                                            */
/* ------------------------------------------------------------------ */

const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function responderJson(res, dados, codigo = 200) {
  const corpo = JSON.stringify(dados);
  res.writeHead(codigo, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(corpo),
  });
  res.end(corpo);
}

function lerCorpo(req) {
  return new Promise((resolve, reject) => {
    let dados = '';
    req.on('data', (c) => {
      dados += c;
      if (dados.length > 5_000_000) reject(new Error('corpo grande demais'));
    });
    req.on('end', () => {
      if (!dados) return resolve({});
      try { resolve(JSON.parse(dados)); } catch { resolve({ texto: dados }); }
    });
    req.on('error', reject);
  });
}

/** Serve um arquivo de dentro da pasta do projeto (com proteção contra ..) */
function servirArquivo(res, caminhoRelativo) {
  const alvo = path.join(ROOT, caminhoRelativo);
  const normalizado = path.normalize(alvo);

  if (!normalizado.startsWith(ROOT)) {
    res.writeHead(403).end('Acesso negado');
    return;
  }
  if (!fs.existsSync(normalizado) || fs.statSync(normalizado).isDirectory()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Não encontrado: ' + caminhoRelativo);
    return;
  }

  const ext = path.extname(normalizado).toLowerCase();
  res.writeHead(200, {
    'Content-Type': TIPOS[ext] || 'application/octet-stream',
    'Cache-Control': 'no-store',
  });
  fs.createReadStream(normalizado).pipe(res);
}

/* ------------------------------------------------------------------ */
/* Modo demonstração (sem internet)                                     */
/* ------------------------------------------------------------------ */

function produtosDeExemplo() {
  const arqs = fs.readdirSync(path.join(__dirname, 'testes', 'fixtures'))
    .filter((f) => f.startsWith('listagem'));
  const todos = [];
  for (const a of arqs) {
    const html = fs.readFileSync(path.join(__dirname, 'testes', 'fixtures', a), 'utf8');
    todos.push(...ml.lerListagem(html));
  }
  return todos;
}

/* ------------------------------------------------------------------ */
/* API                                                                  */
/* ------------------------------------------------------------------ */

async function api(rota, corpo, res) {
  const cfg = vitrine.lerConfig();

  /* --- estado geral --- */
  if (rota === '/api/estado') {
    const cat = vitrine.lerCatalogo();
    return responderJson(res, {
      demo: DEMO,
      config: cfg,
      atualizadoEm: cat.atualizadoEm,
      produtos: cat.produtos,
      total: cat.produtos.length,
      categorias: cfg.categorias.map((c) => ({ id: c.id, nome: c.nome })),
      podeGerarLinkSozinho: Boolean(cfg.afiliado.matt_word && cfg.afiliado.matt_tool),
    });
  }

  /* --- descobrir produtos --- */
  if (rota === '/api/descobrir') {
    const { tipo = 'buscar', termo = '', limite = 24, soDesconto, soFreteGratis, categoria } = corpo;

    if (DEMO) {
      let lista = produtosDeExemplo();
      const unicos = new Map();
      lista.forEach((p) => unicos.set(p.id, p));
      lista = [...unicos.values()];
      if (termo) {
        const alvo = vitrine.normalizar(termo);
        lista = lista.filter((p) => vitrine.normalizar(p.name).includes(alvo.split(' ')[0]));
      }
      lista = lista.map((p) => ({ ...p, category: vitrine.categorizar(p.name, cfg) }));
      return responderJson(res, {
        produtos: lista.slice(0, limite),
        demo: true,
        aviso: 'Modo demonstração: estes produtos são de exemplo, não vieram do Mercado Livre.',
      });
    }

    try {
      let produtos = [];

      if (tipo === 'virais') {
        ({ produtos } = await ml.maisVendidos({ categoria, limite }));
      } else if (tipo === 'termos') {
        const vistos = new Set();
        for (const t of cfg.busca.termos) {
          const r = await ml.buscar(t, {
            limite: cfg.busca.limitePorTermo,
            freteGratis: soFreteGratis ?? cfg.busca.soFreteGratis,
            desconto: soDesconto ?? cfg.busca.soComDesconto,
          });
          for (const p of r.produtos) {
            const k = p.id || p.permalink;
            if (!vistos.has(k)) { vistos.add(k); produtos.push(p); }
          }
        }
      } else {
        if (!termo.trim()) throw new Error('Digite o que você quer buscar.');
        ({ produtos } = await ml.buscar(termo, {
          limite,
          freteGratis: soFreteGratis ?? cfg.busca.soFreteGratis,
          desconto: soDesconto ?? cfg.busca.soComDesconto,
        }));
      }

      produtos = produtos
        .map((p) => ({ ...p, category: vitrine.categorizar(p.name, cfg) }))
        .slice(0, limite);

      return responderJson(res, { produtos });
    } catch (e) {
      return responderJson(res, { erro: e.message }, 502);
    }
  }

  /* --- detalhes de um produto (para preencher preço/foto) --- */
  if (rota === '/api/detalhe') {
    if (DEMO) {
      // Deixa a pessoa ver como funciona o "Aprender" sem ir na internet
      if (corpo.url && ml.ehLinkCurto(corpo.url)) {
        return responderJson(res, {
          parametros: { matt_word: 'exemplo', matt_tool: '12345678' },
          demo: true,
          aviso: 'Demonstração: estes parâmetros são inventados.',
        });
      }
      const achado = produtosDeExemplo().find((p) => p.id === corpo.id);
      if (achado) return responderJson(res, achado);
      return responderJson(res, { erro: 'não achei no modo demo' }, 404);
    }
    try {
      const dados = await ml.lerProduto(corpo.url);
      return responderJson(res, dados);
    } catch (e) {
      return responderJson(res, { erro: e.message }, 502);
    }
  }

  /* --- cadastrar produtos escolhidos --- */
  if (rota === '/api/adicionar') {
    const escolhidos = corpo.produtos || [];
    if (!escolhidos.length) return responderJson(res, { erro: 'Nada selecionado.' }, 400);

    // No modo demonstração NADA é gravado, para não sujar a vitrine de verdade
    if (DEMO) {
      return responderJson(res, {
        adicionados: escolhidos.length,
        atualizados: 0,
        falhas: [],
        total: vitrine.lerCatalogo().produtos.length,
        demo: true,
        aviso: 'Demonstração: nada foi gravado. Rode "node tools/painel.js" sem --demo para valer.',
      });
    }

    const itens = [];
    const falhas = [];

    for (const p of escolhidos) {
      try {
        // Se veio só com preço da listagem, confirma na página do produto
        let dados = p;
        if (!p.price || !p.image || corpo.confirmar !== false) {
          try {
            const completo = await ml.lerProduto(p.permalink || p.linkDeAnuncio);
            dados = { ...p, ...completo, name: completo.name || p.name };
          } catch (e) {
            falhas.push({ nome: p.name, motivo: e.message });
          }
        }

        const urlBase = dados.linkDeAnuncio || dados.permalink || p.permalink;
        itens.push(vitrine.paraItemDaVitrine(dados, {
          categoria: p.category,
          config: cfg,
          linkAfiliado: ml.montarLinkAfiliado(
            urlBase,
            cfg.afiliado.montarLinkAutomatico ? cfg.afiliado : {}
          ),
        }));
      } catch (e) {
        falhas.push({ nome: p.name, motivo: e.message });
      }

      await new Promise((r) => setTimeout(r, 700));
    }

    const cat = vitrine.lerCatalogo();
    const { catalogo, adicionados, atualizados } = vitrine.mesclar(cat, itens);
    const payload = vitrine.salvarCatalogo(catalogo, cfg);

    return responderJson(res, {
      adicionados, atualizados, falhas,
      total: payload.produtos.length,
    });
  }

  /* --- remover produto --- */
  if (rota === '/api/remover') {
    const cat = vitrine.lerCatalogo();
    cat.produtos = cat.produtos.filter((p) => String(p.id) !== String(corpo.id) && p.name !== corpo.name);
    const payload = vitrine.salvarCatalogo(cat, cfg);
    return responderJson(res, { total: payload.produtos.length });
  }

  /* --- config --- */
  if (rota === '/api/config') {
    const novo = { ...cfg, ...corpo };
    if (corpo.afiliado) novo.afiliado = { ...cfg.afiliado, ...corpo.afiliado };
    if (corpo.busca) novo.busca = { ...cfg.busca, ...corpo.busca };
    vitrine.salvarConfig(novo);
    vitrine.salvarCatalogo(vitrine.lerCatalogo(), novo);
    return responderJson(res, { ok: true, config: novo });
  }

  /* --- gerar os links de afiliado em lote --- */
  if (rota === '/api/links/exportar') {
    const cat = vitrine.lerCatalogo();

    // Só produtos do Mercado Livre entram na lista (produtos de outra loja
    // ficam de fora, para não bagunçar nem perder links que já funcionam).
    const alvo = cat.produtos.filter((p) =>
      /mercadolivre\.com/i.test(p.linkOriginal || '') || /mercadolivre\.com/i.test(p.link || '')
    );

    if (!alvo.length) {
      return responderJson(res, {
        erro: 'Não há nenhum produto do Mercado Livre na vitrine ainda. ' +
              'Cadastre alguns em "1. Descobrir produtos".',
      }, 400);
    }

    // o gerador de links do ML prefere a URL do anúncio, não a de catálogo
    const urls = alvo.map((p) => p.linkOriginal || p.link).filter(Boolean);

    // Guarda a ORDEM usada, para a importação casar com segurança
    fs.writeFileSync(
      path.join(ROOT, 'links-para-painel.json'),
      JSON.stringify({ em: new Date().toISOString(), ids: alvo.map((p) => p.id), urls }, null, 2) + '\n',
      'utf8'
    );
    fs.writeFileSync(path.join(ROOT, 'links-para-painel.txt'), urls.join('\n') + '\n', 'utf8');

    return responderJson(res, {
      quantidade: urls.length,
      texto: urls.join('\n'),
      arquivo: 'links-para-painel.txt',
    });
  }

  /* --- importar os links gerados no painel --- */
  if (rota === '/api/links/importar') {
    const texto = String(corpo.texto || '');
    const links = texto.split('\n').map((l) => l.trim()).filter((l) => /^https?:\/\//i.test(l));

    if (!links.length) return responderJson(res, { erro: 'Não achei nenhum link no texto colado.' }, 400);

    const cat = vitrine.lerCatalogo();

    /* Forma segura: usar o arquivo de exportação, que guarda a ordem exata.
       Assim o link certo vai para o produto certo, mesmo que o catálogo
       tenha mudado no meio do caminho. */
    let idsDaExportacao = null;
    const arqExport = path.join(ROOT, 'links-para-painel.json');
    if (fs.existsSync(arqExport)) {
      try {
        const g = JSON.parse(fs.readFileSync(arqExport, 'utf8'));
        if (Array.isArray(g.ids) && g.ids.length === links.length) idsDaExportacao = g.ids;
      } catch { /* usa o plano B */ }
    }

    let casados = 0;

    if (idsDaExportacao) {
      const linkPorId = new Map(idsDaExportacao.map((id, i) => [String(id), links[i]]));
      cat.produtos = cat.produtos.map((p) =>
        linkPorId.has(String(p.id)) ? { ...p, link: linkPorId.get(String(p.id)) } : p
      );
      casados = idsDaExportacao.length;
    } else {
      // Plano B: casa pela ordem, mas só nos produtos do Mercado Livre
      const doML = cat.produtos.filter((p) => /mercadolivre\.com/i.test(p.linkOriginal || p.link || ''));

      if (doML.length !== links.length) {
        return responderJson(res, {
          erro: `Você colou ${links.length} link(s), mas existem ${doML.length} produto(s) do Mercado Livre na vitrine. ` +
                'Clique em "Exportar lista de URLs" de novo e cole os links na MESMA ordem.',
          esperado: doML.length,
          recebido: links.length,
        }, 400);
      }

      const linkPorId = new Map(doML.map((p, i) => [String(p.id || p.linkOriginal), links[i]]));
      cat.produtos = cat.produtos.map((p) => {
        const chave = String(p.id || p.linkOriginal);
        return linkPorId.has(chave) ? { ...p, link: linkPorId.get(chave) } : p;
      });
      casados = links.length;
    }

    // Aprende a atribuição a partir do primeiro link curto
    const curto = links.find((l) => ml.ehLinkCurto(l));
    if (curto) {
      try {
        const r = await ml.resolverLinkCurto(curto);
        if (r.parametros && Object.keys(r.parametros).length) {
          cfg.afiliado = { ...cfg.afiliado, ...r.parametros };
          vitrine.salvarConfig(cfg);
        }
      } catch { /* segue sem aprender */ }
    }

    const payload = vitrine.salvarCatalogo(cat, cfg);
    return responderJson(res, { casados, total: payload.produtos.length });
  }

  /* --- recriar arquivos --- */
  if (rota === '/api/regerar') {
    const payload = vitrine.salvarCatalogo(vitrine.lerCatalogo(), cfg);
    return responderJson(res, { total: payload.produtos.length });
  }

  return responderJson(res, { erro: 'rota desconhecida: ' + rota }, 404);
}

/* ------------------------------------------------------------------ */
/* Servidor                                                             */
/* ------------------------------------------------------------------ */

const servidor = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORTA}`);
  const rota = url.pathname;

  try {
    if (rota.startsWith('/api/')) {
      if (req.method !== 'POST' && rota !== '/api/estado') {
        return responderJson(res, { erro: 'use POST' }, 405);
      }
      const corpo = req.method === 'POST' ? await lerCorpo(req) : {};
      return await api(rota, corpo, res);
    }

    if (rota === '/' || rota === '/index.html') return servirArquivo(res, 'index.html');
    if (rota === '/painel' || rota === '/painel/') return servirArquivo(res, 'tools/painel.html');

    return servirArquivo(res, decodeURIComponent(rota.replace(/^\//, '')));
  } catch (e) {
    responderJson(res, { erro: e.message }, 500);
  }
});

servidor.listen(PORTA, '0.0.0.0', () => {
  const linha = '─'.repeat(58);
  console.log(`\n${linha}`);
  console.log('  🛍️   Painel da Vitrine — Mercado Livre');
  console.log(linha);
  console.log(`\n  Painel:  http://localhost:${PORTA}/painel`);
  console.log(`  Vitrine: http://localhost:${PORTA}/`);
  if (DEMO) {
    console.log('\n  \x1b[33m⚠ MODO DEMONSTRAÇÃO\x1b[0m — usa produtos de exemplo.');
    console.log('     Sem o --demo ele busca os produtos de verdade no Mercado Livre.');
  }
  console.log('\n  Para parar: Ctrl + C\n');
});
