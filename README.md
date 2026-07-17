# Analisador de UI/UX & CRO de E-commerce

App **independente** que gera uma apresentação personalizada de UI/UX e CRO de um e-commerce, comparando **como está hoje** (com os prints reais da loja) × **como deveria ser** (recomendações), a partir de um checklist de boas práticas.

> Este app é **totalmente separado** do app de Criativos (Meta Ads). Ele tem seu próprio servidor, sua própria publicação e seu próprio endereço. Não compartilha login, banco de dados nem código com o outro app.

## O que ele faz

- Você envia os **prints reais** do e-commerce em cada seção (Página Inicial, Categorias, Página de Produto, Carrinho, Checkout, Rodapé, Geral, Reclame Aqui — 8 seções, 94 itens).
- A **IA (OpenAI)** analisa cada imagem contra o checklist e classifica cada item em *Feito / A ajustar / Não se aplica / Verificar*, com observação e recomendação.
- Você **revisa e edita** tudo (IA + revisão humana).
- Gera uma **apresentação em slides** (capa com score, resumo por seção, oportunidades e, por seção, imagem real × recomendações) e **exporta em PDF**.
- Dá para **salvar o projeto** em `.json` e reabrir depois.

## Rodar localmente

```bash
cd analisador-uiux
npm install
OPENAI_API_KEY=sk-xxxxx npm start
# abre em http://localhost:3000
```

## Variáveis de ambiente

| Variável | Obrigatória | Descrição |
|---|---|---|
| `OPENAI_API_KEY` | Sim (para IA) | Chave da OpenAI (crie em platform.openai.com). Sem ela, o app funciona só no modo manual. |
| `OPENAI_MODEL` | Não | Modelo com visão. Padrão: `gpt-4o`. |
| `APP_PASSWORD` | Não (recomendada) | Se definida, protege o app com uma senha única de acesso. Sem ela, o app fica aberto para quem tiver o link. |
| `PORT` | Não | Porta do servidor (padrão 3000). O provedor de hospedagem normalmente define automaticamente. |

## Publicar no Render (como serviço separado, sem afetar o outro app)

1. No painel do Render, **New → Web Service** e conecte este mesmo repositório do GitHub.
2. Em **Root Directory**, coloque: `analisador-uiux` (isso faz o Render usar só esta pasta — o app de Criativos, que fica na raiz, não é tocado).
3. **Build Command:** `npm install` · **Start Command:** `npm start`.
4. Em **Environment**, adicione as variáveis:
   - `OPENAI_API_KEY` = sua chave da OpenAI
   - `APP_PASSWORD` = uma senha de acesso (recomendado)
   - (opcional) `OPENAI_MODEL` = `gpt-4o`
5. Crie o serviço. Ele terá seu **próprio endereço** (ex.: `analisador-uiux.onrender.com`), independente do app de Criativos.

## Como usar

1. Abra o app (digite a senha, se você configurou `APP_PASSWORD`).
2. Preencha nome e URL da loja.
3. Em cada seção, **envie os prints** do e-commerce.
4. Clique em **Analisar com IA** (ou **Analisar tudo com IA**).
5. **Revise** os status, observações e recomendações.
6. **Gerar apresentação** → **Exportar PDF**.
7. Use **Salvar projeto** para guardar e **Abrir projeto** para continuar depois.

## Observações

- A análise é feita **apenas com base no que aparece nos prints**; itens não visuais (ex.: velocidade, CRM) são marcados como *Verificar*.
- As imagens **não ficam no servidor** — são usadas na análise e guardadas só no arquivo `.json` do projeto que você baixa.
- O "como deveria ser" traz **recomendações e boas práticas** ao lado do print real (não são geradas imagens falsas da loja).
