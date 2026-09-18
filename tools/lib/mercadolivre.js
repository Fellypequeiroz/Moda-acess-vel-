/**
 * lib/mercadolivre.js
 * ===========================================================================
 * Tudo que fala com o Mercado Livre.
 *
 * NÃO existe API oficial de afiliado no Mercado Livre (confirmado na doc de
 * developers e em reclamações públicas). Então este arquivo faz o que dá:
 *
 *   1. LÊ as páginas públicas do ML (mais vendidos / busca) para descobrir
 *      produtos — usando várias estratégias de leitura, porque o HTML muda.
 *   2. LÊ a página do produto para pegar nome, preço, preço antigo, imagem.
 *   3. MONTA o link de afiliado — de duas formas:
 *      a) automática: acrescentando matt_word + matt_tool (os parâmetros que o
 *         próprio programa de afiliados usa) — você ensina a ferramenta colando
 *         UM link seu gerado no painel;
 *      b) em lote: a ferramenta cospe as URLs e você cola no "Gerador de links"
 *         do painel de afiliados, que aceita várias URLs de uma vez.
 *
 * Zero dependências: só usa o fetch nativo do Node 18+.
 */
'use strict';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

const CABECALHOS = {
  'User-Agent': UA,
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
  'Cache-Control': 'no-cache',
};

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------------------ */
/* 1. Baixar páginas                                                   */
/* ------------------------------------------------------------------ */

/**
 * Baixa uma URL e devolve { status, html, urlFinal }.
 * Segue redirecionamentos (importante para links curtos mercadolivre.com/sec/).
 */
async function baixar(url, { timeout = 25000, tentativas = 2 } = {}) {
  let ultimoErro;

  for (let t = 1; t <= tentativas; t++) {
    const controle = new AbortController();
    const timer = setTimeout(() => controle.abort(), timeout);

    try {
      const resp = await fetch(url, {
        headers: CABECALHOS,
        redirect: 'follow',
        signal: controle.signal,
      });
      clearTimeout(timer);

      const html = await resp.text();
      return { status: resp.status, html, urlFinal: resp.url || url };

    } catch (e) {
      clearTimeout(timer);
      ultimoErro = e;
      if (t < tentativas) await dormir(1200 * t); // espera e tenta de novo
    }
  }

  throw new Error(`Falha ao baixar ${url}: ${ultimoErro && ultimoErro.message}`);
}

/* ------------------------------------------------------------------ */
/* 2. Utilidades de texto                                              */
/* ------------------------------------------------------------------ */

const ENTIDADES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú',
  atilde: 'ã', otilde: 'õ', ccedil: 'ç', acirc: 'â', ecirc: 'ê',
  ocirc: 'ô', agrave: 'à', ordf: 'º', ordm: 'ª', hellip: '…',
  ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’', deg: '°',
  Aacute: 'Á', Eacute: 'É', Ccedil: 'Ç', Atilde: 'Ã', Otilde: 'Õ',
};

function decodificarEntidades(txt) {
  return String(txt)
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, nome) => ENTIDADES[nome] ?? m);
}

/** Tira as tags HTML e normaliza espaços. */
function soTexto(html) {
  return decodificarEntidades(String(html).replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * "R$ 1.234,56" -> 1234.56   |   "1.234" -> 1234   |   "9990" -> 9990
 * O ML às vezes manda "R$ 25789" querendo dizer 257,89 (centavos colados).
 * Essa ambiguidade é tratada em numeroDoPreco().
 */
function numeroBR(txt) {
  if (txt == null) return null;
  const s = String(txt).replace(/[^\d.,]/g, '');
  if (!s) return null;
  // 1.234,56  ou  1234,56
  if (s.includes(',')) return parseFloat(s.replace(/\./g, '').replace(',', '.')) || null;
  // 1.234  -> separador de milhar
  if (/^\d{1,3}(\.\d{3})+$/.test(s)) return parseFloat(s.replace(/\./g, '')) || null;
  return parseFloat(s) || null;
}

/* ------------------------------------------------------------------ */
/* 3. Identificar produto pela URL                                     */
/* ------------------------------------------------------------------ */

/**
 * Devolve o MLB da URL.
 *  produto.mercadolivre.com.br/MLB-1234567890-...  -> 1234567890  (anúncio)
 *  www.mercadolivre.com.br/qualquer-coisa/p/MLB123 -> 123  (catálogo)
 * Também devolve o tipo, porque são coisas diferentes:
 *  'anuncio'   = página de um vendedor específico  (o gerador de link prefere esta)
 *  'catalogo'  = página "quem vende mais barato"   (/p/MLB...)
 */
function identificarProduto(url) {
  if (!url) return null;
  const u = String(url);

  let m = u.match(/\/p\/MLB(\d{6,})/i);
  if (m) return { id: 'MLB' + m[1], tipo: 'catalogo' };

  m = u.match(/MLB-?(\d{6,})/i);
  if (m) return { id: 'MLB' + m[1], tipo: 'anuncio' };

  return null;
}

/** Tira parâmetros de tracking, mantendo a URL limpa e canônica. */
function urlLimpa(url) {
  try {
    const u = new URL(url);
    const lixo = [
      'matt_word', 'matt_tool', 'matt_source', 'matt_campaign', 'matt_ad_id',
      'matt_medium', 'matt_content', 'matt_term', 'forceInApp', 'quantity',
      'c_id', 'c_uid', 'c_label', 'c_element_id', 'c_element_order',
      'c_campaign', 'c_content_origin', 'c_global_position', 'c_tracking_id',
      'deal_print_id', 'fbclid', 'gclid', 'utm_source', 'utm_medium',
      'utm_campaign', 'utm_content', 'utm_term', 'ref', 'tracking_id',
    ];
    lixo.forEach((p) => u.searchParams.delete(p));
    u.hash = '';
    return u.toString();
  } catch {
    return url;
  }
}

/** URL curta de afiliado? (mercadolivre.com/sec/..., meli.la/..., /social/...) */
function ehLinkCurto(url) {
  return /(mercadolivre\.com(\.br)?\/sec\/|meli\.la\/|mercadolivre\.com\.br\/social\/)/i.test(url);
}

/* ------------------------------------------------------------------ */
/* 4. Imagens                                                          */
/* ------------------------------------------------------------------ */

/**
 * O CDN do ML aceita vários tamanhos trocando a letra antes da extensão:
 *   -V.jpg (minúscula)  -N.jpg  -I.jpg (500px)  -O.jpg (original)
 * Páginas de lista costumam entregar -V ou -I. Aqui a gente promove para -O.
 */
function melhorarImagem(url, tamanho = 'O') {
  if (!url) return url;
  if (!/http2\.mlstatic\.com|mlstatic\.com/i.test(url)) return url;
  const semQuery = url.split('?')[0];
  const convertida = semQuery.replace(/-[A-Z]\.(jpg|jpeg|png|webp)$/i, `-${tamanho}.jpg`);
  return convertida === semQuery ? url : convertida;
}

/** Confere se a imagem melhorada existe; se não, devolve a original. */
async function imagemQueExiste(url) {
  const melhor = melhorarImagem(url);
  if (melhor === url) return url;
  try {
    const r = await fetch(melhor, { method: 'HEAD', headers: { 'User-Agent': UA } });
    return r.ok ? melhor : url;
  } catch {
    return url;
  }
}

/* ------------------------------------------------------------------ */
/* 5. Ler o "estado" que o ML embute na página (__PRELOADED_STATE__)   */
/* ------------------------------------------------------------------ */

/** Recorta um objeto/array balanceado a partir de um índice de abertura. */
function recortarBalanceado(html, inicio) {
  const abre = html[inicio];
  const fecha = abre === '{' ? '}' : ']';
  let nivel = 0;
  let dentroDeString = false;
  let aspas = '';
  let escape = false;

  for (let i = inicio; i < html.length; i++) {
    const c = html[i];

    if (escape) { escape = false; continue; }
    if (c === '\\') { escape = true; continue; }

    if (dentroDeString) {
      if (c === aspas) dentroDeString = false;
      continue;
    }
    if (c === '"' || c === "'") { dentroDeString = true; aspas = c; continue; }

    if (c === abre) nivel++;
    else if (c === fecha) {
      nivel--;
      if (nivel === 0) return html.slice(inicio, i + 1);
    }
  }
  return null;
}

/**
 * Tenta achar o objeto de estado interno da página.
 * Aparece como:  window.__PRELOADED_STATE__ = {...}
 *           ou:  window.__PRELOADED_STATE__ = JSON.parse("...")
 */
function extrairEstado(html) {
  const chaves = ['__PRELOADED_STATE__', '__PRELOADED_STATE__ = JSON.parse'];
  for (const chave of chaves) {
    const pos = html.indexOf(chave);
    if (pos === -1) continue;

    // Caso JSON.parse("...")
    const jsonParse = html.slice(pos, pos + 200).match(/JSON\.parse\(\s*(['"])/);
    if (jsonParse) {
      const abre = html.indexOf(jsonParse[1], pos);
      const bruto = recortarBalanceado(html, abre);
      if (bruto) {
        try {
          return JSON.parse(JSON.parse(bruto));
        } catch { /* tenta a próxima */ }
      }
    }

    // Caso objeto literal
    const idx = html.indexOf('{', pos);
    if (idx === -1) continue;
    const bruto = recortarBalanceado(html, idx);
    if (!bruto) continue;

    try {
      return JSON.parse(bruto);
    } catch {
      try {
        // objetos com chaves sem aspas ou undefined
        return new Function('return (' + bruto + ')')();
      } catch { /* segue */ }
    }
  }
  return null;
}

/** Varre o estado interno e coleta todo objeto que "parece produto". */
function coletarProdutosDoEstado(obj, achados = [], vistos = new Set(), profundidade = 0) {
  if (!obj || profundidade > 12 || typeof obj !== 'object') return achados;

  if (Array.isArray(obj)) {
    for (const item of obj) coletarProdutosDoEstado(item, achados, vistos, profundidade + 1);
    return achados;
  }

  const temTitulo = typeof obj.title === 'string' && obj.title.length > 3;
  const temId = typeof obj.id === 'string' && /^MLB-?\d+$/i.test(obj.id);
  const temLink = typeof obj.permalink === 'string' && obj.permalink.includes('mercadolivre');

  if (temTitulo && (temId || temLink)) {
    const chave = obj.id || obj.permalink;
    if (!vistos.has(chave)) {
      vistos.add(chave);
      achados.push(obj);
    }
    return achados; // não desce mais, já é produto
  }

  for (const valor of Object.values(obj)) {
    if (valor && typeof valor === 'object') {
      coletarProdutosDoEstado(valor, achados, vistos, profundidade + 1);
    }
  }
  return achados;
}

/* ------------------------------------------------------------------ */
/* 6. Leitura do HTML quando não há estado interno                     */
/* ------------------------------------------------------------------ */

/** Divide o HTML em blocos de card, tentando os invólucros conhecidos. */
function dividirEmCards(html) {
  const marcadores = [
    'ui-search-layout__item',
    'poly-card',
    'ui-search-result__wrapper',
    'ui-search-result ',
    'andes-card',
  ];

  for (const marcador of marcadores) {
    // Corta antes de cada ocorrência do marcador
    const escapado = marcador.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const partes = html.split(new RegExp(`(?=<[a-z]+[^>]*class="[^"]*${escapado})`, 'i'));
    const uteis = partes.filter((p) => /MLB-?\d{6,}/i.test(p) && /(andes-money-amount|price-tag|poly-price)/i.test(p));
    if (uteis.length >= 3) return uteis;
  }
  return null;
}

/** Extrai um produto de um bloco de card HTML. */
function lerCard(bloco) {
  // --- link do produto ---
  let permalink = null;
  const links = bloco.match(/href="([^"]*mercadolivre\.com[^"]*)"/gi) || [];
  for (const l of links) {
    const url = decodificarEntidades(l.replace(/^href="/i, '').replace(/"$/, '')).replace(/&amp;/g, '&');
    const info = identificarProduto(url);
    if (info && !/\/jms\/|\/noindex|\/gz\/|click1|\/lp\//i.test(url)) { permalink = url; break; }
  }

  // --- imagem ---
  let imagem = null;
  const imgs = bloco.match(/https:\/\/http2\.mlstatic\.com\/[^"'\s]+\.(?:jpg|jpeg|png|webp)/gi) || [];
  if (imgs.length) {
    // prefere a maior que aparecer
    imagem = imgs.sort((a, b) => b.length - a.length)[0];
  }

  // --- título ---
  let titulo = null;
  const mTitulo =
    bloco.match(/class="[^"]*(?:poly-component__title|ui-search-item__title|poly-component__title-wrapper)[^"]*"[^>]*>([\s\S]{3,300}?)<\/(?:a|h2|h3|span)>/i) ||
    bloco.match(/<h[23][^>]*>([\s\S]{3,300}?)<\/h[23]>/i);
  if (mTitulo) titulo = soTexto(mTitulo[1]);

  // --- preços ---
  // Monta a lista de preços em ordem, com a posição no HTML e o "contexto"
  // anterior (para saber se é preço antigo riscado ou preço atual).
  //
  // Formato novo: andes-money-amount__fraction / __cents
  // Formato antigo: price-tag-fraction / price-tag-cents
  const pedacos = [];
  const rePreco = /class="[^"]*(?:andes-money-amount__fraction|price-tag-fraction)[^"]*"[^>]*>([\d.]+)</gi;
  let mp;
  while ((mp = rePreco.exec(bloco))) {
    const antes = bloco.slice(Math.max(0, mp.index - 320), mp.index);
    const centavosM = bloco.slice(mp.index, mp.index + 260)
      .match(/class="[^"]*(?:andes-money-amount__cents|price-tag-cents)[^"]*"[^>]*>(\d{1,2})</i);

    pedacos.push({
      pos: mp.index,
      inteiro: mp[1],
      centavos: centavosM ? centavosM[1] : null,
      // veio dentro de <s>, <del> ou de um container "--previous"?
      riscado: /<(?:s|del|strike)\b[^>]*>$/i.test(antes.slice(-60)) ||
               /(?:--previous|__previous|price-tag--previous)[^>]*$/.test(antes.slice(-160)) ||
               /--previous[^<]*<[^>]*$/i.test(antes.slice(-200)),
    });
  }

  function valorDe(p) {
    const inteiro = p.inteiro.replace(/\./g, '');
    return p.centavos ? parseFloat(`${inteiro}.${p.centavos}`) : parseFloat(inteiro);
  }

  const comValor = pedacos.map((p) => ({ ...p, valor: valorDe(p) })).filter((p) => p.valor != null);

  let preco = null;
  let precoAntigo = null;

  const atuais = comValor.filter((p) => !p.riscado);
  const antigos = comValor.filter((p) => p.riscado);

  if (atuais.length) preco = atuais[0].valor;
  if (antigos.length) precoAntigo = antigos[0].valor;

  // Sem marcação confiável: usa ordem + bom senso (antigo tem que ser MAIOR)
  if (preco == null && comValor.length) preco = comValor[0].valor;
  if (precoAntigo == null && comValor.length >= 2) {
    const segundo = comValor[1].valor;
    if (segundo > preco) precoAntigo = segundo;
    else if (comValor[0].valor > comValor[1].valor) {
      precoAntigo = comValor[0].valor;
      preco = comValor[1].valor;
    }
  }

  // Sanidade final: preço antigo só faz sentido se for maior que o atual
  if (precoAntigo != null && preco != null && precoAntigo <= preco) precoAntigo = null;

  // --- extras ---
  const texto = soTexto(bloco);
  const textoOriginal = bloco;
  const freteGratis = /shipping|frete\s*gratis|poly-component__shipping/i.test(textoOriginal) &&
                       /gr[áa]tis/i.test(textoOriginal.slice(0, 4000));
  const mVendidos = texto.match(/([\d.]+)\s*(?:mil\s*)?vendidos/i);
  const desconto = texto.match(/(\d{1,2})%\s*OFF/i);

  if (!permalink || !titulo) return null;

  return {
    id: (identificarProduto(permalink) || {}).id || null,
    tipoUrl: (identificarProduto(permalink) || {}).tipo || null,
    name: titulo,
    price: preco,
    oldPrice: precoAntigo != null && preco != null && precoAntigo > preco ? precoAntigo : null,
    discount: desconto ? parseInt(desconto[1], 10) : null,
    image: imagem,
    permalink: urlLimpa(permalink),
    freeShipping: freteGratis,
    sold: mVendidos ? mVendidos[0] : null,
    raw: null,
  };
}

/* ------------------------------------------------------------------ */
/* 7. Buscar / listar produtos                                         */
/* ------------------------------------------------------------------ */

/**
 * Junta tudo que foi achado pelo estado interno com o que foi achado no HTML.
 */
function normalizarDoEstado(obj) {
  const permalink =
    obj.permalink ||
    (obj.id ? `https://www.mercadolivre.com.br/p/${obj.id}` : null) ||
    obj.url ||
    null;

  const imagem =
    obj.thumbnail || obj.image || obj.pictures?.[0]?.url ||
    obj.pictures?.[0]?.secure_url || obj.picture || null;

  const preco = typeof obj.price === 'number' ? obj.price : numeroBR(obj.price);
  const antigo = typeof obj.original_price === 'number'
    ? obj.original_price
    : numeroBR(obj.original_price ?? obj.originalPrice);

  return {
    id: obj.id || (identificarProduto(permalink) || {}).id || null,
    tipoUrl: (identificarProduto(permalink || '') || {}).tipo || null,
    name: soTexto(obj.title || ''),
    price: preco,
    oldPrice: antigo && preco && antigo > preco ? antigo : null,
    discount: antigo && preco && antigo > preco ? Math.round((1 - preco / antigo) * 100) : null,
    image: melhorarImagem(imagem),
    permalink: permalink ? urlLimpa(permalink) : null,
    freeShipping: Boolean(obj.shipping?.free_shipping ?? obj.freeShipping),
    sold: obj.sold_quantity ? `${obj.sold_quantity} vendidos` : (obj.sold || null),
    vendedor: obj.seller?.nickname || obj.official_store_name || null,
    raw: null,
  };
}

/** Lê uma página de listagem (busca ou mais vendidos) e devolve os produtos. */
function lerListagem(html) {
  const encontrados = [];

  // 1ª tentativa: estado interno da página (melhor qualidade)
  const estado = extrairEstado(html);
  if (estado) {
    const doEstado = coletarProdutosDoEstado(estado);
    for (const p of doEstado) {
      const n = normalizarDoEstado(p);
      if (n.name && (n.permalink || n.id)) encontrados.push(n);
    }
  }

  // 2ª tentativa: ler os cards do HTML
  if (encontrados.length === 0) {
    const cards = dividirEmCards(html);
    if (cards) {
      for (const c of cards) {
        const p = lerCard(c);
        if (p && p.name) encontrados.push(p);
      }
    }
  }

  // 3ª tentativa: varrer todos os links de produto da página
  if (encontrados.length === 0) {
    const vistos = new Set();
    const re = /<a[^>]+href="([^"]*mercadolivre\.com[^"]*(?:\/p\/MLB|MLB-)\d+[^"]*)"[^>]*>([\s\S]{0,400}?)<\/a>/gi;
    let m;
    while ((m = re.exec(html))) {
      const link = decodificarEntidades(m[1]).replace(/&amp;/g, '&');
      const info = identificarProduto(link);
      if (!info || vistos.has(info.id)) continue;
      const nome = soTexto(m[2]);
      if (nome.length < 8) continue;
      vistos.add(info.id);
      encontrados.push({
        id: info.id,
        tipoUrl: info.tipo,
        name: nome,
        price: null,
        oldPrice: null,
        discount: null,
        image: null,
        permalink: urlLimpa(link),
        freeShipping: false,
        sold: null,
        raw: null,
      });
    }
  }

  // limpa duplicados e resultados ruins
  const porId = new Map();
  for (const p of encontrados) {
    const chave = p.id || p.permalink;
    if (!chave) continue;
    const atual = porId.get(chave);
    // fica com a versão que tem preço
    if (!atual || (atual.price == null && p.price != null)) porId.set(chave, p);
  }

  return [...porId.values()].filter((p) => p.name && p.name.length > 5);
}

const BASE = 'https://www.mercadolivre.com.br';

/** Busca por palavra-chave na página pública de listagem. */
async function buscar(termo, { limite = 24, freteGratis = false, desconto = false } = {}) {
  const slug = String(termo).trim().replace(/\s+/g, '-');
  const url = `${BASE}/lista/${encodeURIComponent(slug)}`;
  const { html, urlFinal, status } = await baixar(url);

  if (status >= 400) throw new Error(`ML respondeu ${status} para a busca "${termo}"`);

  let lista = lerListagem(html);
  if (lista.length === 0) {
    throw new Error(
      'Não consegui ler os produtos da página de busca. ' +
      'O Mercado Livre pode ter mudado o layout. Rode com --salvar-html para investigar.'
    );
  }

  if (desconto) lista = lista.filter((p) => p.oldPrice);
  if (freteGratis) lista = lista.filter((p) => p.freeShipping);

  // ordena: com desconto primeiro, depois mais "quentes"
  lista.sort((a, b) => (b.discount || 0) - (a.discount || 0));

  return { urlFinal, produtos: lista.slice(0, limite) };
}

/** Lê a página "Mais Vendidos" (a melhor fonte de "produto viral"). */
async function maisVendidos({ categoria = null, limite = 30 } = {}) {
  const url = categoria ? `${BASE}/mais-vendidos/${categoria}` : `${BASE}/mais-vendidos`;
  const { html, urlFinal, status } = await baixar(url);
  if (status >= 400) throw new Error(`ML respondeu ${status} em ${url}`);

  const produtos = lerListagem(html);
  return { urlFinal, produtos: produtos.slice(0, limite) };
}

/** Lista as categorias disponíveis na página de mais vendidos. */
async function categoriasMaisVendidos() {
  const { html } = await baixar(`${BASE}/mais-vendidos`);
  const cats = [];
  const re = /href="[^"]*\/mais-vendidos\/(MLB\d+)"[^>]*>[\s\S]{0,200}?([A-Za-zÀ-ÿ][^<]{2,40})</gi;
  let m;
  const vistos = new Set();
  while ((m = re.exec(html))) {
    if (vistos.has(m[1])) continue;
    vistos.add(m[1]);
    const nome = soTexto(m[2]);
    if (nome && nome.length > 2) cats.push({ id: m[1], nome });
  }
  return cats;
}

/* ------------------------------------------------------------------ */
/* 8. Ler a página de UM produto                                       */
/* ------------------------------------------------------------------ */

/**
 * Lê a página do produto: nome, preço, preço antigo, imagem.
 * Separado do download para poder ser testado com HTML de exemplo.
 */
async function lerProdutoDoHtml(html, urlFinal, { resolverImagem = true } = {}) {
  const dados = {
    id: (identificarProduto(urlFinal) || identificarProduto(url) || {}).id || null,
    name: null,
    price: null,
    oldPrice: null,
    image: null,
    permalink: urlLimpa(urlFinal),
    linkDeAnuncio: null,
    freeShipping: false,
    sold: null,
    raw: null,
  };

  // --- 1) JSON-LD (padrão do Google, bem estável) ---
  const blocosLd = [...html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)];
  for (const b of blocosLd) {
    try {
      const dados_ = JSON.parse(b[1].trim());
      const arr = Array.isArray(dados_) ? dados_ : [dados_];
      for (const item of arr) {
        const tipo = item['@type'];
        if (tipo === 'Product' || (Array.isArray(tipo) && tipo.includes('Product'))) {
          dados.name = dados.name || soTexto(item.name || '');
          const oferta = Array.isArray(item.offers) ? item.offers[0] : item.offers;
          if (oferta) {
            dados.price = dados.price ?? numeroBR(oferta.price ?? oferta.lowPrice);
          }
          const img = item.image;
          dados.image = dados.image ||
            (Array.isArray(img) ? img[0] : (typeof img === 'string' ? img : img?.url)) || null;
        }
      }
    } catch { /* ignora bloco inválido */ }
  }

  // --- 2) meta tags ---
  const meta = (nome) => {
    const m = html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${nome}["'][^>]+content=["']([^"']+)["']`, 'i')) ||
              html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${nome}["']`, 'i'));
    return m ? decodificarEntidades(m[1]) : null;
  };

  dados.name = dados.name || meta('og:title') || meta('twitter:title');
  dados.price = dados.price ?? numeroBR(meta('product:price:amount'));
  dados.image = dados.image || meta('og:image');

  // --- 3) estado interno ---
  if (!dados.price || !dados.oldPrice) {
    const estado = extrairEstado(html);
    if (estado) {
      const achados = coletarProdutosDoEstado(estado);
      if (achados.length) {
        const melhor = achados.find((a) => a.price) || achados[0];
        const n = normalizarDoEstado(melhor);
        dados.name = dados.name || n.name;
        dados.price = dados.price ?? n.price;
        dados.oldPrice = n.oldPrice;
        dados.image = dados.image || n.image;
        dados.freeShipping = n.freeShipping;
        dados.sold = n.sold;
        if (!dados.id && n.id) dados.id = n.id;
      }
    }
  }

  // --- 4) o link do anúncio (o gerador de afiliados prefere este formato) ---
  const mAnuncio = html.match(/https:\/\/produto\.mercadolivre\.com\.br\/MLB-\d{6,}[^"'\s<>\\]*/i);
  if (mAnuncio) dados.linkDeAnuncio = urlLimpa(decodificarEntidades(mAnuncio[0]));

  // --- 5) parcelas / frete no texto ---
  if (/Frete\s+gr[áa]tis/i.test(html)) dados.freeShipping = true;

  if (dados.image && resolverImagem) dados.image = await imagemQueExiste(dados.image);
  else if (dados.image) dados.image = melhorarImagem(dados.image);

  if (!dados.name) {
    throw new Error(`Não consegui ler o nome do produto em ${urlFinal}`);
  }

  return dados;
}

/** Baixa e lê a página de um produto. */
async function lerProduto(url, opcoes = {}) {
  const { html, urlFinal, status } = await baixar(url);
  if (status >= 400) throw new Error(`ML respondeu ${status} para ${url}`);
  return lerProdutoDoHtml(html, urlFinal, opcoes);
}

/* ------------------------------------------------------------------ */
/* 9. Link de afiliado                                                 */
/* ------------------------------------------------------------------ */

const PARAMETROS_AFILIADO = ['matt_word', 'matt_tool', 'matt_source', 'matt_campaign', 'matt_medium'];

/**
 * Aprende a sua atribuição de afiliado a partir de UM link seu.
 * Cole um link gerado no painel e a ferramenta descobre matt_word + matt_tool,
 * que são os parâmetros usados para identificar você.
 */
function aprenderParametros(texto) {
  const achado = {};
  for (const p of PARAMETROS_AFILIADO) {
    const m = String(texto).match(new RegExp(`${p}=([\\w.\\-:%]+)`, 'i'));
    if (m) achado[p] = decodeURIComponent(m[1]);
  }
  return achado;
}

/**
 * Monta o link de afiliado acrescentando os parâmetros.
 * Se você não tiver os parâmetros, devolve a URL limpa (aí o link é gerado
 * em lote no painel do ML).
 */
function montarLinkAfiliado(url, parametros = {}) {
  const limpa = urlLimpa(url);
  const usados = PARAMETROS_AFILIADO.filter((p) => parametros[p]);
  if (usados.length === 0) return limpa;

  try {
    const u = new URL(limpa);
    for (const p of usados) u.searchParams.set(p, parametros[p]);
    return u.toString();
  } catch {
    return limpa;
  }
}

/** Descobre para onde um link curto (mercadolivre.com/sec/...) aponta. */
async function resolverLinkCurto(url) {
  const { urlFinal, html } = await baixar(url);
  const info = identificarProduto(urlFinal);

  // Se o destino ainda não tem MLB, procura dentro da página
  let nome = null;
  const m = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i);
  if (m) nome = decodificarEntidades(m[1]);

  return {
    urlFinal,
    id: info ? info.id : null,
    tipo: info ? info.tipo : null,
    nome,
    parametros: aprenderParametros(urlFinal) ,
  };
}

module.exports = {
  // rede
  baixar,
  // texto
  decodificarEntidades,
  soTexto,
  numeroBR,
  // url
  identificarProduto,
  urlLimpa,
  ehLinkCurto,
  // imagem
  melhorarImagem,
  imagemQueExiste,
  // leitura
  extrairEstado,
  coletarProdutosDoEstado,
  lerListagem,
  dividirEmCards,
  lerCard,
  lerProduto,
  lerProdutoDoHtml,
  // descoberta
  buscar,
  maisVendidos,
  categoriasMaisVendidos,
  // afiliado
  PARAMETROS_AFILIADO,
  aprenderParametros,
  montarLinkAfiliado,
  resolverLinkCurto,
};
