# Como transformar o AgroGestão Pro num programa instalável no Windows

Este guia é pra você seguir no **seu computador** (não aqui no chat).
Fiz uns atalhos (arquivos `.bat`) que fazem o trabalho pesado sozinhos —
você só precisa dar duplo clique, na ordem certa. Não precisa saber
programar pra isso.

Importante entender: o app continua conversando com a internet (Firebase,
Gemini, e-mail, WhatsApp) normalmente. Só a "casca" (a janela) passa a ser
local. O computador que estiver com o programa aberto precisa estar com
internet pra tudo funcionar — igual já era antes.

## Passo 1 — Baixar e extrair a pasta

1. No chat, clique no arquivo `agrogestao-pro-desktop.zip` que te mandei
   e baixe ele (normalmente vai pra sua pasta **Downloads**).
2. Ache o arquivo baixado, clique com o **botão direito** nele e escolha
   **"Extrair tudo..."** (Extract All).
3. Escolha um lugar fácil de achar depois, tipo `Documentos`, e confirme.
   Isso vai criar uma pasta chamada `agrogestao-pro`.
4. Abra essa pasta. É dentro dela que você vai trabalhar daqui pra frente.

## Passo 2 — Instalar o Node.js (só na primeira vez)

O Node.js é o "motor" que faz o programa rodar. Se você não tem certeza
se já instalou:

1. Vá em https://nodejs.org e baixe a versão **LTS** (o botão da
   esquerda, recomendado).
2. Abra o instalador baixado e clique em "Next" até o fim, sem mudar
   nada — igual instalar qualquer programa.
3. Reinicie o computador depois de instalar (evita dor de cabeça).

## Passo 3 — Instalar as dependências do projeto

Dentro da pasta `agrogestao-pro`, dê **duplo clique** em:

```
1-instalar.bat
```

Vai abrir uma tela preta rodando uns comandos sozinha. Espere terminar
(pode demorar alguns minutos na primeira vez) e aperte qualquer tecla
quando pedir "Press any key to continue".

Se aparecer erro em vermelho, me manda um print ou copia o texto aqui que
eu te ajudo.

## Passo 4 — Configurar as credenciais (Firebase, etc.)

Dê duplo clique em:

```
2-configurar.bat
```

Isso vai abrir um arquivo chamado `.env.local` no Bloco de Notas.
Você vai preencher os valores reais ali (Firebase é o obrigatório; e-mail
e WhatsApp são opcionais). Pra achar os dados do Firebase:

1. Acesse https://console.firebase.google.com
2. Entre no projeto que o AI Studio criou pra esse app.
3. Vá em **Configurações do projeto** (a engrenagem) → **Seus apps** →
   **SDK de configuração**.
4. Copia cada valor (apiKey, authDomain, projectId, etc.) pro lugar
   certo no `.env.local`.

Depois de preencher, **salve o arquivo** (Ctrl+S) e feche o Bloco de
Notas.

Sem isso preenchido, o programa até abre, mas o login não funciona.
Quando chegar nessa parte, me chama aqui que eu te ajudo a achar cada
valor certinho.

## Passo 4.5 — Cadastrar o administrador principal (sem Google)

O sistema não usa mais login com Google. Você (dono do sistema) cadastra o
administrador de cada cliente com um script, antes de entregar o sistema
pronto pra ele. Isso só precisa ser feito **uma vez por instalação**.

1. No [Firebase Console](https://console.firebase.google.com), no projeto
   do cliente, clique na **engrenagem** (canto superior esquerdo) →
   **Configurações do projeto**.
2. Vá na aba **Contas de serviço** (Service accounts).
3. Clique em **"Gerar nova chave privada"** (Generate new private key) →
   confirme. Um arquivo `.json` vai ser baixado.
4. Renomeie esse arquivo baixado pra `service-account.json` e mova ele
   pra dentro da pasta `agrogestao-pro` (a mesma pasta onde estão os
   arquivos `.bat`).

   ⚠️ Esse arquivo dá acesso total ao projeto Firebase — nunca envie ele
   pra ninguém nem publique em lugar nenhum. Ele já está configurado pra
   nunca ser incluído se você um dia colocar esse projeto num Git.

5. Dê duplo clique em:

```
0-criar-administrador.bat
```

6. Vai abrir uma tela preta perguntando o **nome**, o **e-mail** e a
   **senha** do administrador. Digite os dados de acesso que você quer
   que o cliente use e aperte Enter em cada um.
7. Pronto — esse e-mail e senha já funcionam pra logar no sistema,
   direto na tela de login normal (e-mail/matrícula + senha).

Se o cliente quiser trocar a senha depois, é só ele entrar, ir em
**"Meu Perfil"** e clicar em **"Alterar Minha Senha"** (manda um e-mail
de redefinição pro e-mail dele).

## Passo 4.6 — Publicar as regras de segurança no Firebase (importante!)

O arquivo `firestore.rules` (dentro da pasta do projeto) define quem pode
ler e escrever cada informação no banco de dados. Corrigi um problema
sério nele (qualquer funcionário conseguia ler a senha de qualquer
colega), mas essa correção só vale de verdade depois de você **publicar**
esse arquivo no Firebase — ele não vai sozinho.

1. Volte no [Firebase Console](https://console.firebase.google.com), no
   mesmo projeto de antes (`indigo-processor-r5xj8`).
2. No menu da esquerda, clique em **Firestore Database** → aba **Regras**
   (Rules).
3. Abra o arquivo `firestore.rules` da pasta do projeto (Bloco de Notas
   serve), selecione tudo (Ctrl+A), copie (Ctrl+C).
4. Volte no Firebase, apague o conteúdo que está no editor de regras e
   cole o novo (Ctrl+V).
5. Clique em **Publicar** (Publish).

Se travar nessa parte, me chama que eu te guio passo a passo como fizemos
com o Firebase antes.

## Passo 5 — Testar (recomendado antes de gerar o instalador)

Dê duplo clique em:

```
3-testar.bat
```

Isso abre o AgroGestão Pro numa janela de programa de verdade, só pra
você conferir se ficou tudo certo. Ainda não é o instalador final — é só
um teste. Pode fechar a janela quando quiser.

## Passo 6 — Gerar o instalador de verdade

Quando estiver tudo funcionando no teste, dê duplo clique em:

```
4-gerar-instalador.bat
```

Isso demora alguns minutos. No final, abre automaticamente uma pasta
chamada `release`, com um arquivo tipo:

```
AgroGestão Pro Setup 0.0.0.exe
```

Dá duplo clique nesse `.exe` — ele instala o programa no seu Windows
igual qualquer outro programa (escolhe pasta, cria atalho na área de
trabalho). Depois disso é só abrir pelo ícone sempre que quiser usar.

## Se eu precisar mudar alguma coisa no sistema depois

Você (ou eu, aqui no chat) pode editar os arquivos dentro da pasta do
projeto (os arquivos `.tsx`, `.ts`, etc. dentro de `frontend/` e `backend/`).
Depois de qualquer mudança, o caminho é sempre o mesmo:

1. Salvar o arquivo editado.
2. Rodar `3-testar.bat` de novo pra ver se ficou como você queria.
3. Quando estiver satisfeito, rodar `4-gerar-instalador.bat` de novo —
   isso gera um instalador novo, atualizado, que você instala por cima
   do anterior.

Pra editar código com mais conforto (em vez do Bloco de Notas), vale
instalar o **VS Code** (https://code.visualstudio.com, gratuito) — é o
editor mais usado por quem está aprendendo a programar, e você abre a
pasta `agrogestao-pro` inteira nele.

Se você me mandar o que quer mudar (mesmo em texto simples, sem código),
eu edito os arquivos e te devolvo a pasta atualizada pra você repetir os
passos 5 e 6.

## Se algo der errado

Me manda a mensagem de erro que apareceu na tela preta (pode copiar e
colar o texto aqui, ou print) que eu te ajudo a resolver.
