/**
 * lib/vitrine.js
 * ===========================================================================
 * Regras da vitrine: configuração, categorias, badges e geração dos arquivos
 * que o site lê (produtos.json e produtos.js).
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const ARQ_CONFIG = path.join(ROOT, 'config.json');
const ARQ_PRODUTOS = path.join(ROOT, 'produtos.json');
const ARQ_PRODUTOS_JS = path.join(ROOT, 'produtos.js');

/* ------------------------------------------------------------------ */
/* Configuração                                                        */
/* ------------------------------------------------------------------ */

const CONFIG_PADRAO = {
  afiliado: {
    // Preenchido automaticamente quando você cola um link do painel
    // no passo "Meus links" do painel.
    matt_word: '',
    matt_tool: '',
    // true  = a ferramenta monta o link sozinha com os parâmetros acima
    // false = você gera os links em lote no painel do ML (100% seguro)
    montarLinkAutomatico: false,
  },
  categorias: [
    { id: 'vestidos', nome: 'Vestidos', palavras: ['vestido', 'midi', 'chemise', 'saia vestido'] },
    { id: 'blusas', nome: 'Blusas & Tops', palavras: ['blusa', 'camisa', 'camiseta', 't-shirt', 'top', 'cropped', 'body', 'regata', 'jaqueta', 'casaco', 'cardigan', 'moletom', 'colete', 'polo'] },
    { id: 'calcas', nome: 'Calças', palavras: ['calca', 'calça', 'jeans', 'shorts', 'bermuda', 'legging', 'saia', 'macacao', 'macacão', 'conjunto'] },
    { id: 'acessorios', nome: 'Acessórios', palavras: ['bolsa', 'mochila', 'carteira', 'cinto', 'brinco', 'colar', 'anel', 'pulseira', 'oculos', 'óculos', 'relogio', 'relógio', 'chapeu', 'chapéu', 'bone', 'boné', 'lenco', 'lenço', 'sandalia', 'sandália', 'tenis', 'tênis', 'sapato', 'bota', 'meia', 'gorro', 'kit'] },
  ],
  busca: {
    // Termos usados pelo botão "Descobrir produtos virais"
    termos: [
      'vestido feminino',
      'blusa feminina',
      'calça jeans feminina',
      'bolsa feminina',
      'conjunto feminino',
      'sandália feminina',
    ],
    limitePorTermo: 12,
    soComDesconto: true,
    soFreteGratis: true,
  },
  site: {
    botaoLoja: 'Ver no Mercado Livre',
    // marca d'água do selo quando o produto não tem desconto
    selos: { freteGratis: 'Frete grátis', maisVendido: 'Mais vendido' },
  },
};

function lerConfig() {
  if (!fs.existsSync(ARQ_CONFIG)) {
    fs.writeFileSync(ARQ_CONFIG, JSON.stringify(CONFIG_PADRAO, null, 2) + '\n', 'utf8');
    return structuredClone(CONFIG_PADRAO);
  }
  try {
    const lido = JSON.parse(fs.readFileSync(ARQ_CONFIG, 'utf8'));
    return {
      ...CONFIG_PADRAO,
      ...lido,
      afiliado: { ...CONFIG_PADRAO.afiliado, ...(lido.afiliado || {}) },
      categorias: lido.categorias?.length ? lido.categorias : CONFIG_PADRAO.categorias,
      busca: { ...CONFIG_PADRAO.busca, ...(lido.busca || {}) },
      site: { ...CONFIG_PADRAO.site, ...(lido.site || {}) },
    };
  } catch (e) {
    throw new Error('config.json está com erro de formato: ' + e.message);
  }
}

function salvarConfig(cfg) {
  fs.writeFileSync(ARQ_CONFIG, JSON.stringify(cfg, null, 2) + '\n', 'utf8');
}

/* ------------------------------------------------------------------ */
/* Catálogo                                                            */
/* ------------------------------------------------------------------ */

function lerCatalogo() {
  if (!fs.existsSync(ARQ_PRODUTOS)) {
    return { atualizadoEm: null, produtos: [] };
  }
  try {
    const lido = JSON.parse(fs.readFileSync(ARQ_PRODUTOS, 'utf8'));
    if (Array.isArray(lido)) return { atualizadoEm: null, produtos: lido };
    return { atualizadoEm: lido.atualizadoEm || null, produtos: lido.produtos || [] };
  } catch (e) {
    throw new Error('produtos.json está com erro de formato: ' + e.message);
  }
}

/** Escreve produtos.json E produtos.js (o site lê o .js). */
function salvarCatalogo(catalogo, config) {
  const cfg = config || lerConfig();

  // Categorias que realmente aparecem nos produtos (para o menu do site)
  const usadas = [...new Set(catalogo.produtos.map((p) => p.category))]
    .filter(Boolean)
    .map((id) => {
      const encontrada = cfg.categorias.find((c) => c.id === id);
      return { id, nome: encontrada ? encontrada.nome : id.charAt(0).toUpperCase() + id.slice(1) };
    });

  const payload = {
    atualizadoEm: catalogo.atualizadoEm || new Date().toISOString(),
    categorias: usadas,
    produtos: catalogo.produtos,
  };

  fs.writeFileSync(ARQ_PRODUTOS, JSON.stringify(payload, null, 2) + '\n', 'utf8');
  fs.writeFileSync(
    ARQ_PRODUTOS_JS,
    '/* Gerado automaticamente. Não edite à mão. */\n' +
    '/* Use: node tools/painel.js  ou  node tools/descobrir.js */\n' +
    'window.PRODUTOS = ' + JSON.stringify(payload, null, 2) + ';\n',
    'utf8'
  );

  return payload;
}

/* ------------------------------------------------------------------ */
/* Categorizar e selar                                                 */
/* ------------------------------------------------------------------ */

/** Remove acentos e deixa minúsculo, para comparar palavras. */
function normalizar(txt) {
  return String(txt)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

/** Descobre a categoria do produto pelo nome. */
function categorizar(nome, config) {
  const cfg = config || lerConfig();
  const alvo = normalizar(nome);

  let melhor = null;
  let melhorPeso = 0;

  for (const cat of cfg.categorias) {
    for (const palavra of cat.palavras) {
      const p = normalizar(palavra);
      if (!p) continue;
      // palavra inteira vale mais que pedaço
      const inteira = new RegExp(`(^|[^a-z0-9])${p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`);
      const peso = inteira.test(alvo) ? p.length + 5 : (alvo.includes(p) ? p.length : 0);
      if (peso > melhorPeso) {
        melhorPeso = peso;
        melhor = cat.id;
      }
    }
  }

  return melhor || (cfg.categorias[0] ? cfg.categorias[0].id : 'outros');
}

/** Monta o selo do card (o "badge"). */
function gerarBadge(p, config) {
  const cfg = config || lerConfig();

  if (p.oldPrice && p.price && p.oldPrice > p.price) {
    const off = Math.round((1 - p.price / p.oldPrice) * 100);
    if (off >= 5) return `-${off}% OFF`;
  }
  if (p.sold && /^\d+\s*vendidos/i.test(p.sold)) {
    const n = parseInt(p.sold, 10);
    if (n >= 1000) return 'Mais vendido';
  }
  if (p.freeShipping) return cfg.site.selos.freteGratis;
  return null;
}

/* ------------------------------------------------------------------ */
/* Converter o que veio do ML em item da vitrine                       */
/* ------------------------------------------------------------------ */

/**
 * @param {object} p       produto lido do Mercado Livre
 * @param {object} opcoes  { linkAfiliado, categoria, config }
 */
function paraItemDaVitrine(p, { linkAfiliado, categoria, config } = {}) {
  const cfg = config || lerConfig();

  const linkOriginal = p.linkDeAnuncio || p.permalink;

  const item = {
    id: p.id || null,
    name: p.name,
    category: categoria || categorizar(p.name, cfg),
    price: p.price,
    oldPrice: p.oldPrice || null,
    image: p.image || null,
    link: linkAfiliado || linkOriginal,
    linkOriginal,
    badge: null,
    store: 'Mercado Livre',
    freeShipping: Boolean(p.freeShipping),
    sold: p.sold || null,
    adicionadoEm: new Date().toISOString(),
  };

  item.badge = gerarBadge({ ...item, oldPrice: p.oldPrice }, cfg);
  return item;
}

/** Junta produtos novos ao catálogo, sem duplicar. */
function mesclar(catalogo, novos) {
  const porId = new Map();
  const semId = [];

  for (const p of catalogo.produtos) {
    if (p.id) porId.set(p.id, p);
    else semId.push(p);
  }

  let adicionados = 0;
  let atualizados = 0;

  for (const novo of novos) {
    const chave = novo.id || novo.linkOriginal || novo.name;
    const existente = novo.id ? porId.get(novo.id) : semId.find((p) => p.linkOriginal === novo.linkOriginal);

    if (existente) {
      // mantém categoria/badge escolhidos à mão, atualiza preço e foto
      const juntado = {
        ...existente,
        price: novo.price ?? existente.price,
        oldPrice: novo.oldPrice ?? existente.oldPrice,
        image: novo.image || existente.image,
        sold: novo.sold || existente.sold,
        freeShipping: novo.freeShipping ?? existente.freeShipping,
        badge: gerarBadge({ ...existente, ...novo }),
      };
      if (novo.id) porId.set(novo.id, juntado);
      else Object.assign(existente, juntado);
      atualizados++;
    } else {
      if (novo.id) porId.set(novo.id, novo);
      else semId.push(novo);
      adicionados++;
    }
  }

  return {
    catalogo: {
      atualizadoEm: new Date().toISOString(),
      produtos: [...semId, ...porId.values()],
    },
    adicionados,
    atualizados,
  };
}

module.exports = {
  ROOT,
  ARQ_CONFIG,
  ARQ_PRODUTOS,
  ARQ_PRODUTOS_JS,
  CONFIG_PADRAO,
  lerConfig,
  salvarConfig,
  lerCatalogo,
  salvarCatalogo,
  categorizar,
  gerarBadge,
  paraItemDaVitrine,
  mesclar,
  normalizar,
};
