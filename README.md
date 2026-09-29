<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://ai.google.dev/static/site-assets/images/share-ais-513315318.png" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/5d10fa59-e7a5-41d0-9ba6-e1d463a0534a

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`

## Estrutura de pastas

```
frontend/      Telas (React + Vite + Tailwind)
  src/           páginas, componentes, contextos e bibliotecas das telas
  public/        arquivos estáticos (manifest)
  index.html     página inicial
  vite.config.ts configuração do Vite (lê o .env.local da raiz; gera em ../dist)
backend/       Servidor (Node + Express)
  server.ts      ponto de entrada: API, alertas diários, backup, IA
  controllers/   login, usuários, senhas, 2FA
  routes/        rotas /api
  middlewares/   verificação de login e cargo
  services/      e-mail, backup, TOTP
electron/      app de computador (sobe o servidor e abre as telas)
scripts/       utilitários (criar administrador, publicar regras, relatório PDF...)
firestore.rules  regras de segurança do banco
dist/          resultado do build (telas + dist/server.cjs) — gerado, não versionado
```

Um único `package.json` na raiz atende as duas partes (um só `npm install`).
`npm run build` gera as telas (`frontend/`) e o servidor (`backend/server.ts`) em `dist/`.
