# Backup e restauração do banco de dados

## Como o backup funciona

- O próprio AgroGestão faz uma **cópia completa do banco de dados** (todas as coleções e subcoleções do Firestore) **uma vez por dia**.
- Ele confere de hora em hora se a última cópia tem mais de 24 horas, e também 1 minuto depois que o aplicativo é aberto. Ou seja: basta o aplicativo ficar aberto em algum momento do dia **neste computador** (o que tem o arquivo `service-account.json`).
- As cópias ficam em: `Documentos\AgroGestao-Backups` (ex.: `C:\Users\dougl\Documents\AgroGestao-Backups`).
  - Para usar outra pasta (ex.: um pendrive ou uma pasta do Google Drive/OneDrive), coloque no `.env.local`: `BACKUP_DIR="D:\Backups\AgroGestao"`.
- São guardadas as **30 cópias mais recentes** (as mais antigas são apagadas sozinhas). Para mudar: `BACKUP_KEEP=60` no `.env.local`.
- Nome dos arquivos: `firestore-backup-AAAA-MM-DD_HH-MM.ndjson.gz` (compactado).
- Em **Meu Perfil** (conta de Administrador) aparece o cartão **"Backup do Banco de Dados"**: mostra o último backup e tem o botão **"Fazer backup agora"**.

> **Importante:** os arquivos de backup contêm todos os dados dos clientes e também os dados de login (senhas criptografadas e segredos da verificação em duas etapas). Guarde-os com o mesmo cuidado que o `service-account.json`. Uma boa prática é copiar de vez em quando a pasta de backups para um HD externo ou pendrive guardado em outro lugar.

### Por que não usamos o backup "oficial" do Google?

A exportação automática oficial (Cloud Functions agendada + Cloud Storage) **exige o plano pago Blaze** do Firebase, e este projeto usa o plano gratuito. O backup do AgroGestão usa só a chave de administrador que já existe neste PC e **não tem custo**. Cada backup conta como 1 leitura por documento na cota gratuita do Firestore (50 mil leituras por dia).

---

## Como restaurar um backup

Faça isso só se algo foi apagado ou estragado por engano. A restauração **grava por cima** dos documentos atuais com a versão do backup. Documentos criados **depois** do backup **não são apagados**.

### Passo 1 — Abrir o terminal na pasta do sistema
1. Abra a pasta `agrogestao-pro` no Explorador de Arquivos.
2. Clique na barra de endereço, digite `cmd` e aperte **Enter**. Abre uma janela preta.

### Passo 2 — Ver o que tem no backup (não grava nada)
Digite (troque pelo nome do arquivo que você quer usar):

```
node scripts\restaurar-backup.mjs "%USERPROFILE%\Documents\AgroGestao-Backups\firestore-backup-2026-09-28_10-00.ndjson.gz"
```

Aparece a data do backup e quantos documentos existem em cada coleção (clientes, contratos, etc.).

### Passo 3 — Restaurar
- **Tudo:**
  ```
  node scripts\restaurar-backup.mjs "CAMINHO\DO\ARQUIVO.ndjson.gz" --restaurar
  ```
- **Só algumas coleções** (recomendado — ex.: só clientes e contratos):
  ```
  node scripts\restaurar-backup.mjs "CAMINHO\DO\ARQUIVO.ndjson.gz" --restaurar --colecao clients --colecao contracts
  ```

O script mostra quantos documentos serão gravados e pede para você digitar **RESTAURAR** e apertar Enter. Qualquer outra coisa cancela sem gravar nada.

---

## Verificação em duas etapas — emergência

Se o Administrador perder o celular **e** os códigos de recuperação, é possível desligar a verificação em duas etapas da conta (a senha continua a mesma). Neste computador, na pasta `agrogestao-pro`, abra o `cmd` (como no Passo 1) e digite:

```
node scripts\desativar-2fa.mjs email@da.conta
```

Depois entre normalmente com e-mail e senha, e ative de novo em **Meu Perfil**.
