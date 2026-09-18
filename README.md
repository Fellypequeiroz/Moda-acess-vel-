# Painel da Vitrine — automação de produtos do Mercado Livre

Resposta curta para a pergunta *"dá para integrar minha conta do Mercado Livre para cadastrar os produtos automaticamente?"*:

> **Cadastrar os produtos automaticamente: SIM.** A ferramenta busca no Mercado Livre, lê nome, preço, preço antigo e foto, e joga direto na vitrine. Você não escreve mais produto à mão no HTML.
>
> **Gerar o link de afiliado automaticamente: NÃO do jeito oficial.** O Mercado Livre **não tem API pública de afiliado** — não existe um jeito oficial de o site pedir "me dá o link desse produto" e receber a resposta. Isso está documentado só no painel deles e é uma reclamação antiga e pública dos afiliados. Existem dois caminhos que funcionam (explicados abaixo), sendo um deles 100% dentro das regras.

---

## Como usar (o jeito fácil)

```bash
node tools/painel.js
```

Depois abra: **http://localhost:3456/painel**

Não precisa instalar nada: é Node puro, sem `npm install`.
Precisa ter o Node instalado (versão 18 ou mais nova) — [nodejs.org](https://nodejs.org).

Para testar sem internet, com produtos de exemplo:

```bash
node tools/painel.js --demo
```

No modo demonstração **nada é gravado** no seu catálogo — serve só para você ver como funciona.

---

## Os 3 passos no painel

### 1. Descobrir produtos
Escreva o que você quer vender (ex: `vestido midi feminino`) e clique em Buscar. Ou clique em **🔥 Mais vendidos do ML** para pegar os campeões de venda.

A ferramenta traz nome, preço, preço antigo, desconto e foto de cada produto. Você marca os que quer e clica em **Adicionar selecionados à vitrine**. Pronto: já aparecem no site.

### 2. Links de afiliado

Aqui é onde o Mercado Livre complica. Dois caminhos:

**✅ Caminho A — em lote pelo painel do ML (recomendado, sempre funciona)**
1. Clique em *Exportar lista de URLs*.
2. Abra [afiliados.mercadolivre.com.br](https://afiliados.mercadolivre.com.br/) → **Ferramentas → Gerador de links**.
3. Cole **todas as URLs de uma vez** (o gerador aceita várias linhas) e clique em Gerar.
4. Copie os links gerados e cole no campo *Importar*.

A ferramenta casa cada link com o produto certo. É chato de ler, mas são ~2 minutos para a vitrine inteira de uma vez.

**⚙️ Caminho B — a ferramenta monta o link sozinha**
Todo link de afiliado do ML carrega seus parâmetros `matt_word` e `matt_tool`. Gere **um** link no painel, cole no campo *Aprender* e a ferramenta passa a montar todos os outros sozinha, sem abrir o painel.

> ⚠️ Isso usa um formato que o Mercado Livre **não documenta**. Funciona na prática, mas confirme com uma venda de teste antes de depender só dele. O Caminho A é o garantido.

Você também pode usar a extensão oficial de afiliados do Mercado Livre no Chrome, que gera o link direto na página do produto.

### 3. Catálogo
Vê, revisa e remove o que quiser. Tudo que você mexe aqui aparece na vitrine na hora.

---

## Linha de comando (para quem gosta de terminal)

```bash
node tools/descobrir.js termo                  # usa os termos salvos no config.json
node tools/descobrir.js virais                 # mais vendidos do ML
node tools/descobrir.js buscar "vestido midi"  # busca livre
node tools/descobrir.js adicionar links.txt    # cadastra a partir de URLs

# acrescente --adicionar para gravar na vitrine
node tools/descobrir.js buscar "bolsa feminina" --adicionar --limite 20

node tools/descobrir.js aprender "https://mercadolivre.com/sec/xxxx"
node tools/descobrir.js listar
node tools/descobrir.js remover MLB1234567890
node tools/descobrir.js regerar
```

---

## O que mudou no projeto

O `index.html` tinha **2,9 MB** porque os 14 produtos e as fotos (em base64) estavam escritos dentro dele. Agora:

| Antes | Depois |
|---|---|
| `index.html` com 2,9 MB | `index.html` com **23 KB** (−99,2%) |
| produtos escritos à mão no HTML | produtos vêm do `produtos.js`, gerado sozinho |
| fotos em base64 dentro do HTML | fotos em arquivos, na pasta `imagens/` |

**O visual do site não foi alterado** — mesmo CSS, mesmo layout, mesmas cores. Só mudou de onde os dados vêm.

Os 14 produtos antigos (Shein) **não foram apagados**: eles continuam no catálogo e as fotos foram salvas em `imagens/legado/`. Conforme você for adicionando produtos do Mercado Livre, é só remover os antigos pelo painel (aba *Catálogo*).

---

## Arquivos

```
index.html                    a vitrine (não precisa mais editar)
produtos.js                   catálogo — o site lê este arquivo
produtos.json                 o mesmo catálogo, em JSON
config.json                   seus termos de busca e parâmetros de afiliado
imagens/legado/               fotos dos produtos antigos

tools/
  painel.js                   painel no navegador      ← comece por aqui
  painel.html                 interface do painel
  descobrir.js                linha de comando
  testar.js                   testa o extrator (node tools/testar.js)
  atualizar-html.js           migração do HTML (já rodou, não precisa de novo)
  extrair-legado.js           extraiu os produtos antigos do HTML (já rodou)
  lib/mercadolivre.js         tudo que fala com o Mercado Livre
  lib/vitrine.js              regras da vitrine (categorias, selos, arquivos)
```

---

## Se algo der errado

**"Não consegui ler os produtos da página de busca"**
O Mercado Livre mudou o layout da página, ou bloqueou as buscas seguidas. Espere alguns minutos e tente de novo. Se continuar, me avise: o extrator tem 3 estratégias de leitura diferentes e dá para ajustar.

**Nenhum produto apareceu com filtros**
Tire o "só com desconto" — muita coisa boa não tem desconto cadastrado.

**O link de afiliado não está contando**
Confira se o link que está no site é o `mercadolivre.com/sec/...` que você gerou no painel. Encurtadores de terceiros podem quebrar a atribuição da comissão.

**Quero conferir se o extrator está funcionando**
```bash
node tools/testar.js
```
São 51 testes que rodam sem internet, com páginas de exemplo do Mercado Livre.

---

## O que não dá para automatizar (e por quê)

| O que | Dá? | Por quê |
|---|---|---|
| Buscar produtos e pegar nome/preço/foto | ✅ Sim | As páginas públicas do ML têm esses dados |
| Cadastrar na vitrine | ✅ Sim | A ferramenta monta o `produtos.js` |
| Atualizar preço dos produtos já cadastrados | ✅ Sim | Rodando a busca de novo, ele atualiza |
| Gerar o link de afiliado | ⚠️ Com ressalvas | Não há API oficial; ver os 2 caminhos acima |
| Consultar suas comissões/vendas | ❌ Não | O painel do ML não expõe isso |
| Descobrir produtos por busca na API oficial | ❌ Não | O endpoint `/sites/MLB/search` está bloqueado (403) desde o fim de 2025 — por isso a ferramenta lê as páginas do site |

Segurança: a ferramenta **nunca pede sua senha** e **não guarda seus cookies de sessão**. Ela só lê páginas públicas.
