# Backup do código-fonte (Git + GitHub)

## O que já está pronto

- O **Git** foi instalado neste computador e a pasta `agrogestao-pro` virou um repositório Git.
- Cada "commit" é uma foto do código naquele momento — dá para voltar a qualquer versão anterior.
- O arquivo `.gitignore` impede que entrem no histórico:
  - senhas e chaves: `.env.local`, `service-account.json`, `firebase-applet-config.json`;
  - arquivos gerados: `node_modules`, `dist`, `release`;
  - backups do banco de dados.

Hoje o histórico existe **só neste PC**. Se o computador quebrar, perde-se tudo. Por isso vale enviar para o GitHub (gratuito).

## Como enviar para o GitHub (passo a passo)

> Use um repositório **PRIVADO**. O código não tem senhas, mas é o sistema da empresa.

1. Crie uma conta em https://github.com (se ainda não tiver).
2. Clique no **+** (canto superior direito) → **New repository**.
3. Nome: `agrogestao-pro`. Marque **Private**. **Não** marque "Add a README". Clique em **Create repository**.
4. O GitHub mostra um endereço parecido com `https://github.com/SEU-USUARIO/agrogestao-pro.git`. Copie.
5. Abra a pasta `agrogestao-pro`, clique na barra de endereço, digite `cmd` e aperte **Enter**.
6. Digite os comandos abaixo (um por vez, trocando o endereço pelo seu):
   ```
   git remote add origin https://github.com/SEU-USUARIO/agrogestao-pro.git
   git push -u origin main
   ```
7. Na primeira vez abre uma janela do GitHub pedindo login — entre com sua conta e autorize.

## Depois de alterações no sistema

Para guardar uma nova versão e enviar para o GitHub:

```
git add -A
git commit -m "Descreva aqui o que mudou"
git push
```

## Antes de enviar, confira que nenhuma chave vai junto

```
git ls-files | findstr /i "env service-account"
```

O único resultado aceitável é `.env.example` (modelo sem senhas).
