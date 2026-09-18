#!/usr/bin/env node
/**
 * descobrir.js — linha de comando
 * ===========================================================================
 * Acha produtos no Mercado Livre, cadastra na vitrine e gera os arquivos.
 *
 *   node tools/descobrir.js virais                  (mais vendidos do ML)
 *   node tools/descobrir.js termo                   (usa os termos do config.json)
 *   node tools/descobrir.js buscar "vestido midi"   (busca livre)
 *   node tools/descobrir.js adicionar links.txt     (cadastra a partir de URLs)
 *   node tools/descobrir.js aprender "https://mercadolivre.com/sec/xxxx"
 *   node tools/descobrir.js regerar                 (recria produtos.json/js)
 *   node tools/descobrir.js listar                  (mostra o catálogo atual)
 *   node tools/descobrir.js remover MLB1234567890
 *
 * Para adicionar sem perguntar, acrescente  --adicionar
 * Para ver o que achou sem gravar nada, não acrescente nada.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const ml = require('./lib/mercadolivre');
const vitrine = require('./lib/vitrine');

/* ---------------- argumentos ---------------- */

const args = process.argv.slice(2);
const comando = args[0] || 'ajuda';
const sinalizadores = new Set(args.filter((a) => a.startsWith('--')).map((a) => a.replace(/^--(no-)?/, '')));
const comValor = (nome, padrao) => {
  const i = args.indexOf('--' + nome);
  return i !== -1 && args[i + 1] ? args[i + 1] : padrao;
};
const tem = (nome) => args.includes('--' + nome);
const livres = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')));
const textoLivre = livres.slice(1).join(' ').trim();

const LIMITE = parseInt(comValor('limite', '0'), 10) || 0;

/* ---------------- cores ---------------- */

const cor = {
  fraco: (s) => `\x1b[2m${s}\x1b[0m`,
  ok: (s) => `\x1b[32m${s}\x1b[0m`,
  aviso: (s) => `\x1b[33m${s}\x1b[0m`,
  erro: (s) => `\x1b[31m${s}\x1b[0m`,
  forte: (s) => `\x1b[1m${s}\x1b[0m`,
};

const moeda = (v) =>
  v == null ? '—' : v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/* ---------------- apresentação ---------------- */

function mostrarTabela(produtos) {
  if (!produtos.length) {
    console.log(cor.aviso('  (nenhum produto)'));
    return;
  }
  produtos.forEach((p, i) => {
    const n = String(i + 1).padStart(3);
    const preco = moeda(p.price).padStart(12);
    const antigo = p.oldPrice ? cor.fraco(' de ' + moeda(p.oldPrice)) : '';
    const off = p.discount ? ' ' + cor.ok(`-${p.discount}%`) : '';
    const frete = p.freeShipping ? ' 🚚' : '';
    const cat = p.category ? cor.fraco(`[${p.category}]`) : '';
    console.log(`${cor.fraco(n)} ${preco}${antigo}${off}${frete} ${p.name.slice(0, 62)} ${cat}`);
  });
}

/* ---------------- comandos ---------------- */

async function comandoVirais() {
  const cfg = vitrine.lerConfig();
  const limite = LIMITE || 30;
  console.log(cor.forte('\n🔥 Mais vendidos do Mercado Livre\n'));

  const { produtos } = await ml.maisVendidos({ limite });
  if (!produtos.length) {
    console.log(cor.aviso('Não achei produtos na página de mais vendidos.'));
    return [];
  }

  const prontos = produtos.map((p) => ({ ...p, category: vitrine.categorizar(p.name, cfg) }));
  mostrarTabela(prontos);
  return prontos;
}

async function comandoBuscar() {
  const cfg = vitrine.lerConfig();
  if (!textoLivre) {
    console.log(cor.erro('Diga o que buscar. Ex: node tools/descobrir.js buscar "vestido midi"'));
    process.exit(1);
  }
  const limite = LIMITE || cfg.busca.limitePorTermo;
  console.log(cor.forte(`\n🔎 Buscando "${textoLivre}"\n`));

  const { produtos } = await ml.buscar(textoLivre, {
    limite,
    freteGratis: tem('sem-frete') ? false : cfg.busca.soFreteGratis,
    desconto: tem('todos') ? false : cfg.busca.soComDesconto,
  });

  if (!produtos.length) {
    console.log(cor.aviso('Nenhum produto passou nos filtros. Tente --todos'));
    return [];
  }

  const prontos = produtos.map((p) => ({ ...p, category: vitrine.categorizar(p.name, cfg) }));
  mostrarTabela(prontos);
  return prontos;
}

async function comandoTermo() {
  const cfg = vitrine.lerConfig();
  const todos = [];
  const vistos = new Set();

  console.log(cor.forte(`\n🔎 Rodando os ${cfg.busca.termos.length} termos do config.json\n`));

  for (const termo of cfg.busca.termos) {
    process.stdout.write(cor.fraco(`  ${termo} ... `));
    try {
      const { produtos } = await ml.buscar(termo, {
        limite: LIMITE || cfg.busca.limitePorTermo,
        freteGratis: cfg.busca.soFreteGratis,
        desconto: cfg.busca.soComDesconto,
      });
      let novos = 0;
      for (const p of produtos) {
        const chave = p.id || p.permalink;
        if (vistos.has(chave)) continue;
        vistos.add(chave);
        todos.push({ ...p, category: vitrine.categorizar(p.name, cfg) });
        novos++;
      }
      console.log(cor.ok(`${novos} novos`));
    } catch (e) {
      console.log(cor.erro('falhou: ' + e.message));
    }
  }

  console.log('');
  mostrarTabela(todos);
  return todos;
}

async function comandoAdicionar() {
  const cfg = vitrine.lerConfig();
  const arquivo = textoLivre;
  if (!arquivo || !fs.existsSync(arquivo)) {
    console.log(cor.erro('Informe um arquivo com uma URL por linha.'));
    console.log(cor.fraco('  Ex: node tools/descobrir.js adicionar links.txt'));
    process.exit(1);
  }

  const linhas = fs.readFileSync(arquivo, 'utf8')
    .split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));

  console.log(cor.forte(`\n📥 Lendo ${linhas.length} link(s) de ${arquivo}\n`));
  return await lerEuAdicionar(linhas, cfg, 'arquivo');
}

/** Lê cada URL (curta ou de produto), pega os dados e devolve itens. */
async function lerEuAdicionar(linhas, cfg, origem) {
  const itens = [];

  for (let i = 0; i < linhas.length; i++) {
    const linha = linhas[i];
    process.stdout.write(cor.fraco(`  [${i + 1}/${linhas.length}] ${linha.slice(0, 70)} ... `));

    try {
      let urlProduto = linha;
      let linkPronto = null;

      // Link curto de afiliado? Descobre para onde ele vai.
      if (ml.ehLinkCurto(linha)) {
        const r = await ml.resolverLinkCurto(linha);
        linkPronto = linha;
        if (r.id) {
          urlProduto = r.urlFinal;
        } else {
          console.log(cor.aviso('link curto sem MLB identificado'));
          continue;
        }
        if (r.parametros.matt_word) {
          cfg.afiliado = { ...cfg.afiliado, ...r.parametros };
          vitrine.salvarConfig(cfg);
        }
      }

      const dados = await ml.lerProduto(urlProduto);
      const link = linkPronto || ml.montarLinkAfiliado(
        cfg.afiliado.montarLinkAutomatico ? (dados.linkDeAnuncio || dados.permalink) : (dados.linkDeAnuncio || dados.permalink),
        cfg.afiliado.montarLinkAutomatico ? cfg.afiliado : {}
      );

      const item = vitrine.paraItemDaVitrine(dados, { linkAfiliado: link, config: cfg });
      itens.push(item);
      console.log(cor.ok(`${moeda(item.price)} ${item.name.slice(0, 45)}`));
    } catch (e) {
      console.log(cor.erro('erro: ' + e.message));
    }

    if (i < linhas.length - 1) await new Promise((r) => setTimeout(r, 900)); // educado com o servidor
  }

  return itens;
}

function comandoAprender() {
  const alvo = textoLivre;
  if (!alvo || !ml.ehLinkCurto(alvo)) {
    console.log(cor.erro('Cole um link de afiliado gerado no painel.'));
    console.log(cor.fraco('  Ex: node tools/descobrir.js aprender "https://mercadolivre.com/sec/1a2b3c4d"'));
    process.exit(1);
  }

  console.log(cor.forte('\n🎓 Aprendendo sua atribuição de afiliado\n'));
  ml.resolverLinkCurto(alvo)
    .then((r) => {
      if (!r.parametros || !Object.keys(r.parametros).length) {
        console.log(cor.aviso('Não achei parâmetros de afiliado nesse link.'));
        console.log(cor.fraco('  Destino final: ' + r.urlFinal));
        console.log('  Sem problema: use o modo em lote (node tools/links.js).');
        return;
      }
      const cfg = vitrine.lerConfig();
      cfg.afiliado = { ...cfg.afiliado, ...r.parametros, montarLinkAutomatico: true };
      vitrine.salvarConfig(cfg);
      console.log(cor.ok('  Aprendido:'));
      for (const [k, v] of Object.entries(r.parametros)) console.log(`    ${k} = ${v}`);
      console.log('');
      console.log(cor.ok('  ✔ Salvo no config.json — os próximos links saem prontos.'));
    })
    .catch((e) => console.log(cor.erro('  Erro: ' + e.message)));
}

function comandoRegerar() {
  const cfg = vitrine.lerConfig();
  const cat = vitrine.lerCatalogo();
  const p = vitrine.salvarCatalogo(cat, cfg);
  console.log(cor.ok(`✔ produtos.json e produtos.js regerados (${p.produtos.length} produtos)`));
}

function comandoListar() {
  const cat = vitrine.lerCatalogo();
  console.log(cor.forte(`\n📦 Catálogo: ${cat.produtos.length} produtos`));
  console.log(cor.fraco(`   atualizado em: ${cat.atualizadoEm || 'nunca'}\n`));
  mostrarTabela(cat.produtos);
}

function comandoRemover() {
  const id = textoLivre;
  if (!id) {
    console.log(cor.erro('Diga o ID. Ex: node tools/descobrir.js remover MLB1234567890'));
    process.exit(1);
  }
  const cfg = vitrine.lerConfig();
  const cat = vitrine.lerCatalogo();
  const antes = cat.produtos.length;
  cat.produtos = cat.produtos.filter((p) => p.id !== id);
  if (cat.produtos.length === antes) {
    console.log(cor.aviso(`Não achei produto com id ${id}.`));
    return;
  }
  vitrine.salvarCatalogo(cat, cfg);
  console.log(cor.ok(`✔ Removido. Agora o catálogo tem ${cat.produtos.length} produtos.`));
}

/** Grava os itens no catálogo, se a pessoa pediu --adicionar. */
function talvezGravar(itens) {
  if (!itens.length) return;

  if (!tem('adicionar')) {
    console.log('');
    console.log(cor.fraco('  Nada foi gravado. Para cadastrar estes produtos na vitrine, repita o'));
    console.log(cor.fraco('  comando acrescentando  --adicionar'));
    return;
  }

  const cfg = vitrine.lerConfig();
  const cat = vitrine.lerCatalogo();
  const { catalogo, adicionados, atualizados } = vitrine.mesclar(cat, itens);
  const payload = vitrine.salvarCatalogo(catalogo, cfg);

  console.log('');
  console.log(cor.ok(`✔ ${adicionados} produto(s) novo(s), ${atualizados} atualizado(s)`));
  console.log(cor.ok(`✔ A vitrine agora tem ${payload.produtos.length} produtos`));
  console.log(cor.fraco('  Abra o index.html ou rode: node tools/painel.js'));
}

function ajuda() {
  console.log(`
${cor.forte('Descoberta de produtos — Mercado Livre')}

  ${cor.forte('node tools/descobrir.js termo')}
      Usa os termos de busca do config.json (o jeito mais rápido).

  ${cor.forte('node tools/descobrir.js virais')}
      Pega a página "Mais vendidos" do Mercado Livre.

  ${cor.forte('node tools/descobrir.js buscar "vestido midi"')}
      Busca livre.

  ${cor.forte('node tools/descobrir.js adicionar links.txt')}
      Cadastra a partir de um arquivo com uma URL por linha
      (aceita link de produto OU link curto de afiliado).

  Opções:  --adicionar   grava na vitrine
           --limite 20   quantos produtos por busca
           --todos       não filtra só descontos/frete grátis
           --sem-frete   não exige frete grátis

  ${cor.forte('Outros comandos')}
    aprender "https://mercadolivre.com/sec/xxxx"   ensina sua tag de afiliado
    listar                                          mostra o catálogo
    remover MLB1234567890                           tira um produto
    regerar                                         recria produtos.json/js

  ${cor.fraco('Prefere interface gráfica?  node tools/painel.js')}
`);
}

/* ---------------- roteador ---------------- */

(async () => {
  try {
    switch (comando) {
      case 'virais':    talvezGravar(await comandoVirais()); break;
      case 'buscar':    talvezGravar(await comandoBuscar()); break;
      case 'termo':     talvezGravar(await comandoTermo()); break;
      case 'adicionar': talvezGravar(await comandoAdicionar()); break;
      case 'aprender':  comandoAprender(); break;
      case 'listar':    comandoListar(); break;
      case 'remover':   comandoRemover(); break;
      case 'regerar':   comandoRegerar(); break;
      default:          ajuda();
    }
  } catch (e) {
    console.log(cor.erro('\n✖ ' + e.message));
    console.log(cor.fraco('\n  Dicas:'));
    console.log(cor.fraco('   • confira se você está com internet'));
    console.log(cor.fraco('   • o Mercado Livre pode ter mudado o layout da página'));
    console.log(cor.fraco('   • tente de novo em alguns minutos'));
    process.exit(1);
  }
})();
