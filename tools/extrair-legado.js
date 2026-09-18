#!/usr/bin/env node
/**
 * extrair-legado.js
 * ---------------------------------------------------------------------------
 * Lê os produtos que hoje estão escritos NA MÃO dentro do index.html,
 * tira as imagens em base64 de dentro do HTML (é isso que deixava o arquivo
 * com 2,9 MB) e salva tudo em arquivos separados:
 *
 *   imagens/legado/*.jpg   -> imagens de verdade
 *   produtos.json          -> catálogo (o que o site passa a ler)
 *
 * Uso:  node tools/extrair-legado.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const HTML = path.join(ROOT, 'index.html');
const DIR_IMG = path.join(ROOT, 'imagens', 'legado');
const OUT_JSON = path.join(ROOT, 'produtos.json');

function slug(txt) {
  return String(txt)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 45);
}

function main() {
  const html = fs.readFileSync(HTML, 'utf8');

  // Pega o bloco:  const products = [ ... ];
  const m = html.match(/const\s+products\s*=\s*(\[[\s\S]*?\n\s*\])\s*;/);
  if (!m) {
    console.error('✖ Não encontrei o bloco "const products = [...]" no index.html.');
    console.error('  Nada foi alterado.');
    process.exit(1);
  }

  let antigos;
  try {
    antigos = new Function('return ' + m[1])();
  } catch (e) {
    console.error('✖ Não consegui interpretar a lista de produtos:', e.message);
    process.exit(1);
  }

  console.log(`• ${antigos.length} produtos encontrados no index.html`);

  fs.mkdirSync(DIR_IMG, { recursive: true });

  const novos = antigos.map((p, i) => {
    let imagem = p.image || '';
    const n = String(i + 1).padStart(2, '0');

    if (imagem.startsWith('data:image/')) {
      // data:image/jpeg;base64,XXXX
      const [cabecalho, dados] = imagem.split(',');
      const tipo = (cabecalho.match(/data:image\/([a-z0-9+]+)/i) || [, 'jpeg'])[1].toLowerCase();
      const ext = tipo === 'jpeg' ? 'jpg' : tipo;
      const nome = `${n}-${slug(p.name)}.${ext}`;
      const destino = path.join(DIR_IMG, nome);

      fs.writeFileSync(destino, Buffer.from(dados, 'base64'));
      const kb = (fs.statSync(destino).size / 1024).toFixed(0);
      console.log(`  ↳ imagens/legado/${nome}  (${kb} KB)`);
      imagem = `imagens/legado/${nome}`;
    }

    return {
      id: null,
      name: p.name,
      category: p.category,
      price: p.price,
      oldPrice: p.oldPrice ?? null,
      image: imagem,
      link: p.link,
      badge: p.badge || null,
      store: 'Shein',
    };
  });

  const payload = {
    atualizadoEm: new Date().toISOString(),
    fonte: 'extraido do index.html em ' + new Date().toLocaleString('pt-BR'),
    produtos: novos,
  };

  fs.writeFileSync(OUT_JSON, JSON.stringify(payload, null, 2) + '\n', 'utf8');

  const tamHtml = (fs.statSync(HTML).size / 1024 / 1024).toFixed(2);
  console.log(`\n✔ produtos.json criado com ${novos.length} produtos.`);
  console.log(`✔ ${fs.readdirSync(DIR_IMG).length} imagens salvas em imagens/legado/`);
  console.log(`\n  index.html ainda tem ${tamHtml} MB porque as imagens continuam dentro dele.`);
  console.log('  Depois de rodar o atualizar-html.js ele fica leve.');
}

main();
