#!/usr/bin/env node
/**
 * atualizar-html.js
 * ===========================================================================
 * Migra o index.html para o modo automático:
 *
 *   ANTES: os produtos estavam escritos à mão dentro do <script> do HTML
 *          (com as fotos em base64 — por isso o arquivo tinha 2,9 MB).
 *
 *   DEPOIS: o HTML passa a ler o arquivo produtos.js, que é gerado sozinho
 *           pela ferramenta. Você não edita mais HTML.
 *
 * Roda UMA vez. Se rodar de novo, ele só avisa que já foi feito.
 * O index.html original continua salvo no histórico do Git.
 *
 * Uso:  node tools/atualizar-html.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const ARQUIVO = path.join(ROOT, 'index.html');
const MARCADOR = '<!-- vitrine-automatica:v1 -->';

/* O HTML/CSS do seu site não é tocado. Só trocamos a parte de dados. */
const NOVO_SCRIPT = `${MARCADOR}
  <script src="produtos.js"></script>
  <script>
    // ============================================
    // CATÁLOGO  (não edite aqui — edite pelo painel)
    // ============================================
    // Os produtos vêm do arquivo produtos.js, que é gerado por:
    //
    //     node tools/painel.js        (painel no navegador)
    //     node tools/descobrir.js     (linha de comando)
    //
    // Assim você nunca mais precisa escrever produto à mão no HTML.

    const CATALOGO  = window.PRODUTOS || { produtos: [], categorias: [] };
    const products  = CATALOGO.produtos || [];
    const categorias = CATALOGO.categorias || [];

    // ============================================
    // Código da vitrine (não precisa mexer)
    // ============================================

    const grid      = document.getElementById('productsGrid');
    const filterBar = document.getElementById('filterBar');
    const catCards  = document.querySelectorAll('.cat-card');

    function formatPrice(value) {
      return Number(value).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    }

    function nomeDaCategoria(id) {
      const c = categorias.find(c => c.id === id);
      return c ? c.nome : id;
    }

    // Monta a barra de filtros a partir das categorias que EXISTEM no catálogo
    function montarFiltros() {
      if (!filterBar) return;
      const botoes = [{ id: 'todos', nome: 'Todos' }, ...categorias];

      filterBar.innerHTML = botoes
        .map((c, i) => \`<button class="filter-btn\${i === 0 ? ' active' : ''}" data-filter="\${c.id}">\${c.nome}</button>\`)
        .join('');

      filterBar.querySelectorAll('.filter-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          filterBar.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          renderProducts(btn.dataset.filter);
        });
      });

      // Esconde os cartões de categoria que não têm nenhum produto
      catCards.forEach(card => {
        const tem = categorias.some(c => c.id === card.dataset.filter);
        card.style.display = tem ? '' : 'none';
      });
    }

    function renderProducts(filter = 'todos') {
      const filtered = filter === 'todos'
        ? products
        : products.filter(p => p.category === filter);

      if (filtered.length === 0) {
        grid.innerHTML = \`
          <div class="empty-state">
            <h3>Nenhum produto nesta categoria</h3>
            <p>Em breve novas peças por aqui ✨</p>
          </div>
        \`;
        return;
      }

      grid.innerHTML = filtered.map(p => \`
        <article class="product-card">
          <div class="product-image">
            <img src="\${p.image}" alt="\${p.name}" loading="lazy">
            \${p.badge ? \`<span class="product-badge">\${p.badge}</span>\` : ''}
          </div>
          <div class="product-info">
            <span class="product-category">\${nomeDaCategoria(p.category)}</span>
            <h3 class="product-name">\${p.name}</h3>
            <div class="product-price">
              \${p.oldPrice ? \`<span class="old">\${formatPrice(p.oldPrice)}</span>\` : ''}
              \${formatPrice(p.price)}
            </div>
            \${p.freeShipping ? '<span class="product-shipping">Frete grátis</span>' : ''}
            <a href="\${p.link}" target="_blank" rel="noopener noreferrer sponsored" class="product-btn">
              Ver na \${p.store || 'Mercado Livre'}
            </a>
          </div>
        </article>
      \`).join('');
    }

    // Cartões de categoria
    catCards.forEach(card => {
      card.addEventListener('click', () => {
        const filtro = card.dataset.filter;
        const alvo = document.querySelector(\`.filter-btn[data-filter="\${filtro}"]\`);
        if (alvo) {
          filterBar.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
          alvo.classList.add('active');
        }
        renderProducts(filtro);
        document.getElementById('produtos').scrollIntoView({ behavior: 'smooth' });
      });
    });

    // Menu mobile
    const menuToggle = document.getElementById('menuToggle');
    const nav = document.getElementById('nav');
    menuToggle.addEventListener('click', () => {
      nav.classList.toggle('active');
    });
    nav.querySelectorAll('a').forEach(link => {
      link.addEventListener('click', () => nav.classList.remove('active'));
    });

    // Início
    montarFiltros();
    renderProducts();
  </script>`;

/* Trechos antigos que serão procurados para substituição */
const TROCAS_SIMPLES = [
  [
    'content="Vitrine elegante de moda acessível com as melhores seleções da Shein. Estilo sofisticado com preços que cabem no bolso."',
    'content="Vitrine de moda acessível com curadoria de peças do Mercado Livre. Estilo sofisticado com preços que cabem no bolso."',
  ],
  [
    '<p>Peças sofisticadas, tendências atuais e preços acessíveis. Descubra nossa curadoria especial da Shein.</p>',
    '<p>Peças sofisticadas, tendências atuais e preços acessíveis. Descubra nossa curadoria especial.</p>',
  ],
];

function migrar() {
  if (!fs.existsSync(ARQUIVO)) {
    console.error('✖ index.html não encontrado.');
    process.exit(1);
  }

  let html = fs.readFileSync(ARQUIVO, 'utf8');

  if (html.includes(MARCADOR)) {
    console.log('✔ O index.html já está no modo automático. Nada a fazer.');
    console.log('  Para atualizar os produtos use:  node tools/painel.js');
    return;
  }

  const tamanhoAntes = Buffer.byteLength(html, 'utf8');

  /* 1) Localiza o bloco antigo: da lista de produtos até o fim do script */
  const inicioLista = html.indexOf('const products = [');
  if (inicioLista === -1) {
    console.error('✖ Não encontrei "const products = [" no index.html.');
    console.error('  Talvez o arquivo já tenha sido alterado. Nada foi mudado.');
    process.exit(1);
  }

  const fimRender = html.indexOf('renderProducts();', inicioLista);
  if (fimRender === -1) {
    console.error('✖ Não encontrei "renderProducts();" no index.html. Nada foi mudado.');
    process.exit(1);
  }
  const fimBloco = fimRender + 'renderProducts();'.length;

  /* 2) Descobre onde o <script> que envolve esse bloco começa, para não
        deixar o bloco novo dentro de duas tags <script>. */
  const inicioScript = html.lastIndexOf('<script>', inicioLista);
  if (inicioScript === -1 || inicioScript > inicioLista) {
    console.error('✖ Não consegui identificar a tag <script>. Nada foi mudado.');
    process.exit(1);
  }

  html = html.slice(0, inicioScript) + NOVO_SCRIPT + html.slice(fimBloco);

  /* 3) A barra de filtros passa a ser montada pelo JS */
  const reFiltros = /<div class="filter-bar">[\s\S]*?<\/div>/;
  if (reFiltros.test(html)) {
    html = html.replace(reFiltros, '<div class="filter-bar" id="filterBar"></div>');
  } else {
    console.warn('⚠ Não achei a barra de filtros — ela será montada assim mesmo pelo JS.');
  }

  /* 4) Textos que citavam a loja antiga */
  let trocas = 0;
  for (const [de, para] of TROCAS_SIMPLES) {
    if (html.includes(de)) {
      html = html.replace(de, para);
      trocas++;
    }
  }

  fs.writeFileSync(ARQUIVO, html, 'utf8');

  const tamanhoDepois = Buffer.byteLength(html, 'utf8');
  const kb = (n) => (n / 1024).toFixed(0) + ' KB';

  console.log('');
  console.log('✔ index.html migrado para o modo automático');
  console.log(`  antes:  ${kb(tamanhoAntes)}`);
  console.log(`  depois: ${kb(tamanhoDepois)}`);
  console.log(`  redução: ${(100 - (tamanhoDepois / tamanhoAntes) * 100).toFixed(1)}%`);
  if (trocas) console.log(`  ${trocas} texto(s) atualizado(s)`);
  console.log('');
  console.log('  O HTML/CSS do seu site não foi alterado — só a parte dos dados.');
  console.log('  Agora os produtos vêm do produtos.js. Para cadastrar produtos:');
  console.log('      node tools/painel.js');
  console.log('');
}

migrar();
