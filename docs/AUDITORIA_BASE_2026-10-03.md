# Auditoria técnica — AgroGestão Pro

Data: 03/10/2026 (Brasília). Repositório: douglasddp23-bit/agrogestao-pro. Branch: main.
Versão analisada: `046837bdde5263db078d8ca57cefb1ecd8aa1d8e`.

## Parecer

O sistema tem estrutura funcional ampla, separação de front-end/servidor, validações, controle por cargo e transações úteis no faturamento. Entretanto, há falhas que devem ser corrigidas antes de confiar nele para operação financeira e delegação de acesso. As prioridades são proteger credenciais e chaves administrativas, unificar as cobranças e garantir consistência nas operações simultâneas.

Foram registrados **29 pontos: 2 críticos, 10 de prioridade alta, 13 médios e 4 leves**. Os críticos incluem um defeito de autenticação e um risco da arquitetura de instalação. Prioridade alta indica risco de acesso indevido, perda/duplicação financeira ou inconsistência importante; média indica fluxo incompleto ou divergente; leve indica manutenção, desempenho ou clareza.

## Escopo e limites

Inventário de 145 arquivos versionados, incluindo 24 páginas, componentes e bibliotecas compartilhadas, autenticação, API, regras do Firestore, faturamento/fiscal, Electron, scripts e documentação de instalação/backup. Foi feita varredura do código e inspeção detalhada das áreas e funções citadas. Não se afirma prova formal de correção de cada linha nem que todo botão foi executado.

Não foram fornecidos credenciais, banco de teste, regras efetivamente publicadas, configuração de provedores ou instalador Windows em funcionamento. Portanto, os achados de código são confirmados pela implementação desta versão, e os cenários dependentes de configuração estão identificados. Não houve acesso aos dados reais, alteração do repositório remoto, tentativa de exploração em produção ou envio de mensagens. As verificações locais usaram somente a cópia de análise.

## Verificações executadas

| Verificação | Resultado | Alcance |
|---|---|---|
| Instalação npm ci, sem scripts de instalação | Passou | Dependências do lockfile instaladas; binário Electron não validado |
| npm run lint | Passou | TypeScript sem erros na configuração atual; não é auditoria de regra de negócio |
| Testes existentes | 16 passaram, 0 falharam | Cálculos de crédito e faturamento |
| npm run build | Passou | Front-end e bundle do servidor; aviso de chunks acima de 500 kB |
| Conversão monetária de origem | Defeito reproduzido | Texto 100.50 convertido em 10050 |
| Fluxos com Firebase/SMTP/WhatsApp/provedor fiscal reais | Não executados | Exigem ambiente isolado e configuração real |
| Instalador Windows e navegação Electron | Não executados | Build de bundle não comprova instalação operacional |

O comando npm test encontrou restrição do ambiente ao criar um pipe do tsx (EPERM). As mesmas duas suítes foram executadas com `node --import tsx --test frontend/src/lib/credit/credit.test.ts frontend/src/lib/billing/billing.test.ts`, passando integralmente. Esse primeiro erro é uma limitação do ambiente de análise, não um defeito demonstrado do projeto.

## Prioridades em uma tabela

| ID | Prioridade | Ponto |
|---|---|---|
| C01 | Crítica | Perfil editável pode interferir na senha usada pelo login |
| C02 | Crítica | Chave administrativa instalada no computador do colaborador |
| A01 | Alta | Bloqueio não é aplicado diretamente pelas regras do banco |
| A02 | Alta | TOTP próprio não cobre todas as formas de entrada |
| A03 | Alta | Uma análise pode gerar duas cobranças pelo mesmo serviço |
| A04 | Alta | Baixa de contrato não é atômica nem idempotente |
| A05 | Alta | Aprovar reembolso pode duplicar despesas e registrar pagamento inexistente |
| A06 | Alta | Cancelamento e atualização de atraso usam cópias antigas do faturamento |
| A07 | Alta | Retiradas simultâneas podem produzir estoque negativo |
| A08 | Alta | Nova tentativa fiscal pode transmitir duas vezes |
| A09 | Alta | Falhas em criação/troca de senha podem ser apresentadas como sucesso |
| A10 | Alta | Qualquer colaborador pode substituir documentos de outros clientes |
| M01 | Média | Viagem de consultor pode ser salva e depois retornar erro |
| M02 | Média | Dossiê pode indicar laudo disponível quando há somente pasta vazia |
| M03 | Média | Dossiês podem duplicar e troca de cliente conflita com a regra |
| M04 | Média | Agenda automática não acompanha todas as alterações de serviço |
| M05 | Média | Reagir à mensagem de outra pessoa é recusado pelo banco |
| M06 | Média | Emissão fiscal real ainda não está implementada |
| M07 | Média | Faturamento misto comporta somente um resumo de documento fiscal |
| M08 | Média | Irrigação aceita parâmetros que geram cálculo inválido ou incompleto |
| M09 | Média | PDF técnico atribui responsabilidade a quem exporta |
| M10 | Média | CPF/CNPJ e códigos de cliente não têm unicidade no banco |
| M11 | Média | Conversão de valor textual pode multiplicar uma cobrança por 100 |
| M12 | Média | Excluir cliente conserva serviços e histórico sem cadastro de origem |
| M13 | Média | Reserva diária pode suprimir nova tentativa após falha |
| L01 | Leve | Listagens inteiras e escutas multiplicam leituras e processamento |
| L02 | Leve | Testes existentes não protegem os fluxos de gestão |
| L03 | Leve | Configuração inválida ativa mocks em vez de diagnóstico claro |
| L04 | Leve | Assinatura remota tem código mantido, mas rota desativada |

## Achados e correções

### C01 — Perfil editável pode interferir na senha usada pelo login (Crítica)

**Evidência:** [firestore.rules:106](https://github.com/douglasddp23-bit/agrogestao-pro/blob/046837bdde5263db078d8ca57cefb1ecd8aa1d8e/firestore.rules#L106); [backend/controllers/authController.ts:1409](https://github.com/douglasddp23-bit/agrogestao-pro/blob/046837bdde5263db078d8ca57cefb1ecd8aa1d8e/backend/controllers/authController.ts#L1409).

**O que falha e impacto:** As regras de users usam listas de campos proibidos, mas não proíbem passwordHash. O próprio usuário pode acrescentar esse campo ao perfil; RH/Gerente também podem alterar campos não protegidos de outros perfis, inclusive de administrador. loginUser dá preferência a userData.passwordHash antes de consultar user_credentials. A combinação permite substituir a senha reconhecida pelo login de uma conta que o chamador consiga editar. Em uma conta de administrador sem TOTP ativo, isso cria uma via de tomada da conta por um colaborador com permissão de gestão. Com TOTP ativo, o segundo fator ainda é exigido nessa rota. Achado confirmado pela leitura das regras e do controlador; não foi executado contra contas reais.

**Como corrigir:** 1. Remover imediatamente a leitura de hash em users. 2. Aceitar credenciais apenas em user_credentials. 3. Usar uma lista explícita dos campos editáveis por perfil e impedir qualquer campo de credencial. 4. Revisar perfis existentes em busca de campos de senha e removê-los com procedimento administrativo controlado. 5. Publicar e testar as regras corrigidas.

**Como validar:** No emulador, Consultor não consegue inserir passwordHash no próprio perfil; RH/Gerente não conseguem inseri-lo em outro perfil; um hash legado em users não altera a senha reconhecida pelo servidor.

### C02 — Chave administrativa instalada no computador do colaborador (Crítica)

**Evidência:** [8-instalar-chaves-neste-pc.bat:25](https://github.com/douglasddp23-bit/agrogestao-pro/blob/046837bdde5263db078d8ca57cefb1ecd8aa1d8e/8-instalar-chaves-neste-pc.bat#L25); [backend/server.ts:135](https://github.com/douglasddp23-bit/agrogestao-pro/blob/046837bdde5263db078d8ca57cefb1ecd8aa1d8e/backend/server.ts#L135); [electron/main.cjs:33](https://github.com/douglasddp23-bit/agrogestao-pro/blob/046837bdde5263db078d8ca57cefb1ecd8aa1d8e/electron/main.cjs#L33).

**O que falha e impacto:** A arquitetura permite que cada instalação tenha service-account.json e um servidor com Admin SDK. Quem controla esse computador pode acessar a chave e executar operações com os privilégios da conta de serviço, fora das regras do Firestore e da hierarquia exibida nas telas. Restringir a pasta ao usuário do Windows protege contra outros usuários do PC, mas não contra o próprio colaborador. A gravidade depende das permissões IAM reais da chave, que não foram disponibilizadas. Não encontrei uma chave real nos arquivos versionados analisados; o problema é a distribuição proposta pela arquitetura.

**Como corrigir:** 1. Executar o servidor privilegiado em ambiente central controlado. 2. Manter a chave somente nele, com permissões mínimas. 3. Fazer o Electron chamar essa API com a identidade do colaborador. 4. Após migrar, revogar chaves que tenham sido distribuídas e verificar registros de acesso.

**Como validar:** Instalar em um PC de Consultor sem chave administrativa; login, serviços e sincronização funcionam, mas esse PC não possui material que permita usar Admin SDK em nome da empresa.

### A01 — Bloqueio não é aplicado diretamente pelas regras do banco (Alta)

**Evidência:** [firestore.rules:70](https://github.com/douglasddp23-bit/agrogestao-pro/blob/046837bdde5263db078d8ca57cefb1ecd8aa1d8e/firestore.rules#L70); [firestore.rules:29](https://github.com/douglasddp23-bit/agrogestao-pro/blob/046837bdde5263db078d8ca57cefb1ecd8aa1d8e/firestore.rules#L29); [backend/controllers/authController.ts:897](https://github.com/douglasddp23-bit/agrogestao-pro/blob/046837bdde5263db078d8ca57cefb1ecd8aa1d8e/backend/controllers/authController.ts#L897); [frontend/src/pages/Users.tsx:283](https://github.com/douglasddp23-bit/agrogestao-pro/blob/046837bdde5263db078d8ca57cefb1ecd8aa1d8e/frontend/src/pages/Users.tsx#L283).

**O que falha e impacto:** As regras confiam no cargo do token e na idade da sessão, sem consultar blocked ou uma versão de revogação. O servidor verifica revogação, mas acessos diretos ao Firestore usam outra proteção. Um ID token já emitido pode continuar utilizável até expirar, mesmo após revogar refresh tokens. Além disso, blockUser ignora falhas no Auth e no perfil e pode responder sucesso; a tela mostra sucesso antes de receber a resposta. Portanto o bloqueio imediato anunciado não é garantido.

**Como corrigir:** Adicionar estado de acesso/revogação protegido e verificá-lo nas regras; falhar explicitamente se o bloqueio não for concluído; mostrar sucesso somente depois da resposta; aplicar atualização consistente de cargo e revogação também em rebaixamentos e fim de delegação.

**Como validar:** Com dois clientes abertos, bloquear um usuário e tentar ler/escrever usando o token anterior: API e Firestore devem negar. Simular falha no Auth e exigir mensagem de erro na tela.

### A02 — TOTP próprio não cobre todas as formas de entrada (Alta)

**Evidência:** [frontend/src/contexts/AuthContext.tsx:418](https://github.com/douglasddp23-bit/agrogestao-pro/blob/046837bdde5263db078d8ca57cefb1ecd8aa1d8e/frontend/src/contexts/AuthContext.tsx#L418); [backend/controllers/authController.ts:1254](https://github.com/douglasddp23-bit/agrogestao-pro/blob/046837bdde5263db078d8ca57cefb1ecd8aa1d8e/backend/controllers/authController.ts#L1254); [backend/controllers/authController.ts:463](https://github.com/douglasddp23-bit/agrogestao-pro/blob/046837bdde5263db078d8ca57cefb1ecd8aa1d8e/backend/controllers/authController.ts#L463).

**O que falha e impacto:** O desafio TOTP é aplicado em loginUser. O login Google entra diretamente pelo Firebase e a sincronização de cargo não exige comprovação desse TOTP. Para uma conta com provedor Google habilitado/vinculado, o segundo fator próprio pode ser contornado por essa forma de entrada. twoFactorEnable também continua após falha em substituir a senha interna do Firebase, abrindo uma condição em que a senha nativa anterior pode continuar válida. Depende dos provedores habilitados no projeto real.

**Como corrigir:** Garantir segundo fator em todos os provedores, preferencialmente usando mecanismo MFA suportado pelo provedor de identidade; bloquear concessão de privilégios até MFA comprovado. A ativação precisa falhar se uma etapa de proteção falhar.

**Como validar:** Ativar MFA e tentar senha nativa, Google e token de sessão por todos os caminhos: nenhum deve conceder acesso novo sem cumprir o segundo fator definido.

### A03 — Uma análise pode gerar duas cobranças pelo mesmo serviço (Alta)

**Evidência:** [frontend/src/pages/Analysis.tsx:641](https://github.com/douglasddp23-bit/agrogestao-pro/blob/046837bdde5263db078d8ca57cefb1ecd8aa1d8e/frontend/src/pages/Analysis.tsx#L641); [frontend/src/lib/billing/service.ts:239](https://github.com/douglasddp23-bit/agrogestao-pro/blob/046837bdde5263db078d8ca57cefb1ecd8aa1d8e/frontend/src/lib/billing/service.ts#L239); [frontend/src/components/billing/BillServiceButton.tsx:27](https://github.com/douglasddp23-bit/agrogestao-pro/blob/046837bdde5263db078d8ca57cefb1ecd8aa1d8e/frontend/src/components/billing/BillServiceButton.tsx#L27).

**O que falha e impacto:** Concluir uma análise cria uma cobrança em financials com ID aleatório e linkedServiceId. Faturar a mesma análise cria outras contas a receber, com billingId, sem conciliar a cobrança anterior. O botão Faturar verifica somente billings. Conclusão e criação da cobrança também são operações separadas: se a segunda falha, a análise fica concluída sem cobrança e a condição de transição pode impedir nova tentativa automática.

**Como corrigir:** Escolher uma única origem para contas a receber. Fazer a conclusão e a criação/vinculação do faturamento com operação idempotente, usando chave do serviço. Migrar cobranças antigas antes de habilitar o novo fluxo e impedir dois faturamentos ativos da mesma origem no banco.

**Como validar:** Concluir e faturar uma análise de R$ 300: total a receber continua R$ 300. Repetir em dois computadores e interromper a rede entre etapas: não surgem duplicatas nem conclusão sem cobrança conciliada.

### A04 — Baixa de contrato não é atômica nem idempotente (Alta)

**Evidência:** [frontend/src/pages/Contracts.tsx:870](https://github.com/douglasddp23-bit/agrogestao-pro/blob/046837bdde5263db078d8ca57cefb1ecd8aa1d8e/frontend/src/pages/Contracts.tsx#L870).

**O que falha e impacto:** A parcela é marcada paga antes de addDoc em financials. Se a gravação financeira falha, o contrato mostra pago e o caixa não recebe o lançamento. Dois computadores podem gerar dois registros; a função não relê o estado em transação e não usa um ID financeiro fixo por parcela. A gravação do array inteiro também pode sobrescrever a baixa simultânea de outra parcela.

**Como corrigir:** Usar transação que lê o contrato atual, verifica a parcela e grava pagamento/financeiro com ID fixo por contrato e parcela; integrar esse pagamento ao livro único de recebimentos.

**Como validar:** Pagar a mesma parcela em dois clientes produz um único recebimento. Pagar duas parcelas distintas simultaneamente preserva ambas. Falha de gravação não deixa metade da operação concluída.

### A05 — Aprovar reembolso pode duplicar despesas e registrar pagamento inexistente (Alta)

**Evidência:** [frontend/src/pages/Financial.tsx:462](https://github.com/douglasddp23-bit/agrogestao-pro/blob/046837bdde5263db078d8ca57cefb1ecd8aa1d8e/frontend/src/pages/Financial.tsx#L462).

**O que falha e impacto:** A aprovação do pedido é gravada antes da despesa financeira, usando addDoc sem unicidade. Falha ou duas aprovações simultâneas podem deixar pedido aprovado sem despesa ou com duas despesas. O lançamento nasce paid e paymentDate de hoje, embora o ato executado seja aprovação; não existe nesse fluxo uma confirmação separada de transferência.

**Como corrigir:** Aprovar e criar uma conta a pagar em transação com ID fixo por pedido; separar aprovado, aguardando pagamento e pago; registrar a saída de caixa somente na confirmação do pagamento.

**Como validar:** Duas aprovações criam uma conta a pagar. Aprovação sem transferência não muda caixa recebido/pago. Erro em uma gravação não mantém a outra isolada.

### A06 — Cancelamento e atualização de atraso usam cópias antigas do faturamento (Alta)

**Evidência:** [frontend/src/lib/billing/service.ts:331](https://github.com/douglasddp23-bit/agrogestao-pro/blob/046837bdde5263db078d8ca57cefb1ecd8aa1d8e/frontend/src/lib/billing/service.ts#L331); [frontend/src/lib/billing/service.ts:351](https://github.com/douglasddp23-bit/agrogestao-pro/blob/046837bdde5263db078d8ca57cefb1ecd8aa1d8e/frontend/src/lib/billing/service.ts#L351).

**O que falha e impacto:** cancelBilling monta um batch usando as parcelas da tela. Se outro PC registra pagamento depois dessa leitura, o cancelamento pode sobrescrever a parcela paga como cancelada e mudar a conta financeira para cancelled, enquanto payments e paidTotal continuam indicando pagamento. refreshOverdueStatuses também atualiza status calculado sobre lista antiga e pode disputar com pagamento/cancelamento. As regras não validam essas transições contábeis.

**Como corrigir:** Reler o documento em transação para cancelar somente parcelas ainda pendentes; preservar parcelas pagas e verificar contas vinculadas. Recalcular atraso sobre estado atual ou derivá-lo na leitura, sem sobrescrever status concorrente.

**Como validar:** Abrir cancelamento em A, registrar pagamento em B, confirmar em A: pagamento, parcela e financeiro permanecem coerentes. Rodar atualização de atraso durante pagamento não retorna conta paga ao estado vencido.

### A07 — Retiradas simultâneas podem produzir estoque negativo (Alta)

**Evidência:** [frontend/src/pages/Inventory.tsx:264](https://github.com/douglasddp23-bit/agrogestao-pro/blob/046837bdde5263db078d8ca57cefb1ecd8aa1d8e/frontend/src/pages/Inventory.tsx#L264); [firestore.rules:550](https://github.com/douglasddp23-bit/agrogestao-pro/blob/046837bdde5263db078d8ca57cefb1ecd8aa1d8e/firestore.rules#L550).

**O que falha e impacto:** O saldo é validado na cópia da tela e a baixa usa increment em batch. Com saldo 10, dois clientes retirando 7 passam na validação e deixam saldo -4. As regras de inventory_items permitem a alteração de quantidade sem impor saldo não negativo nem vínculo obrigatório com movimentação.

**Como corrigir:** Ler saldo em transação e validar disponibilidade antes de gravar movimento e saldo; nas regras impedir valores negativos e alterações sem operação autorizada. Preservar trilha das movimentações.

**Como validar:** Saldo 10, duas retiradas simultâneas de 7: apenas uma é aceita, saldo final 3, um movimento de saída registrado.

### A08 — Nova tentativa fiscal pode transmitir duas vezes (Alta)

**Evidência:** [backend/controllers/fiscalController.ts:273](https://github.com/douglasddp23-bit/agrogestao-pro/blob/046837bdde5263db078d8ca57cefb1ecd8aa1d8e/backend/controllers/fiscalController.ts#L273); [backend/controllers/fiscalController.ts:292](https://github.com/douglasddp23-bit/agrogestao-pro/blob/046837bdde5263db078d8ca57cefb1ecd8aa1d8e/backend/controllers/fiscalController.ts#L292).

**O que falha e impacto:** retryFiscal consulta e depois gera uma referência nova por chamada, sem transação ou trava da tentativa. Duas chamadas podem consultar a mesma rejeição/ausência e emitir com referências distintas, derrotando a idempotência do provedor. applyResult também atualiza documento e resumo fiscal separadamente. Esse risco é relevante antes de implementar um provedor real; hoje só há simulador.

**Como corrigir:** Reservar a tentativa em transação com versão e identificador único estável; apenas uma chamada deve transmitir. Persistir intenção antes do envio, consultar por todas as referências conhecidas e reconciliar documento/resumo com atualização atômica.

**Como validar:** Duas chamadas de retry para o mesmo documento causam uma transmissão; timeout seguido de retry não autoriza duas notas; consulta atrasada não desfaz um estado fiscal mais recente.

### A09 — Falhas em criação/troca de senha podem ser apresentadas como sucesso (Alta)

**Evidência:** [backend/controllers/authController.ts:239](https://github.com/douglasddp23-bit/agrogestao-pro/blob/046837bdde5263db078d8ca57cefb1ecd8aa1d8e/backend/controllers/authController.ts#L239); [backend/controllers/authController.ts:703](https://github.com/douglasddp23-bit/agrogestao-pro/blob/046837bdde5263db078d8ca57cefb1ecd8aa1d8e/backend/controllers/authController.ts#L703); [backend/controllers/authController.ts:1457](https://github.com/douglasddp23-bit/agrogestao-pro/blob/046837bdde5263db078d8ca57cefb1ecd8aa1d8e/backend/controllers/authController.ts#L1457).

**O que falha e impacto:** setUserCredential pode devolver false; recordNewPassword não exige que o fallback tenha funcionado. createUser pode continuar mesmo após falha de gravar perfil, usando fallback REST sem identidade administrativa. updateUserPassword ignora falha do Auth e do perfil. Isso pode criar conta incompleta, credenciais divergentes ou resposta de senha alterada quando a gravação não ocorreu.

**Como corrigir:** Tornar obrigatória a confirmação de cada gravação; não retornar sucesso após fallback falho. Implementar compensação/retomada para criação parcial de conta e reconciliação entre Auth, credenciais e perfil. Remover fallback REST que depende de acesso recusado pelas próprias regras.

**Como validar:** Simular falha individual em Auth, user_credentials e users: a resposta identifica falha e a conta fica recuperável, sem senha antiga aceita indevidamente nem sucesso fictício.

### A10 — Qualquer colaborador pode substituir documentos de outros clientes (Alta)

**Evidência:** [firestore.rules:410](https://github.com/douglasddp23-bit/agrogestao-pro/blob/046837bdde5263db078d8ca57cefb1ecd8aa1d8e/firestore.rules#L410); [frontend/src/lib/audit.ts:17](https://github.com/douglasddp23-bit/agrogestao-pro/blob/046837bdde5263db078d8ca57cefb1ecd8aa1d8e/frontend/src/lib/audit.ts#L17).

**O que falha e impacto:** documents permite update para qualquer isStaff, exigindo formato e manutenção de clientId, sem conferir dono, técnico responsável ou campos permitidos. Um colaborador pode trocar URL, conteúdo descritivo e uploadedBy de laudo/documento de outro usuário. A auditoria é criada no cliente e suas falhas são ignoradas; portanto não garante comprovação de quem alterou o arquivo.

**Como corrigir:** Definir quem pode alterar cada documento e quais campos; preservar autor original e guardar versões, hash de conteúdo e evento no servidor para alterações de documentos técnicos. Fazer a trilha crítica parte da operação.

**Como validar:** Consultor A não substitui documento de B sem autorização. Substituição autorizada preserva versão anterior, autor e registro confiável da alteração.

### M01 — Viagem de consultor pode ser salva e depois retornar erro (Média)

**Evidência:** [frontend/src/pages/Vehicles.tsx:190](https://github.com/douglasddp23-bit/agrogestao-pro/blob/046837bdde5263db078d8ca57cefb1ecd8aa1d8e/frontend/src/pages/Vehicles.tsx#L190); [firestore.rules:571](https://github.com/douglasddp23-bit/agrogestao-pro/blob/046837bdde5263db078d8ca57cefb1ecd8aa1d8e/firestore.rules#L571).

**O que falha e impacto:** O consultor pode criar seu vehicle_trip, mas a função seguinte tenta alterar vehicles, cuja escrita é permitida somente à gestão. A viagem fica salva, o odômetro fica desatualizado e a tela mostra erro; repetir pode criar outra viagem. Mesmo para gestores, atualizações simultâneas podem regredir o odômetro.

**Como corrigir:** Registrar viagem e atualizar odômetro por uma operação autorizada no servidor/transação; validar monotonicidade e ID idempotente. Ajustar a tela ao nível de permissão.

**Como validar:** Consultor fecha viagem uma vez, recebe sucesso, odômetro correto e nenhum duplicado após repetir.

### M02 — Dossiê pode indicar laudo disponível quando há somente pasta vazia (Média)

**Evidência:** [frontend/src/lib/dossierSyncObserver.ts:71](https://github.com/douglasddp23-bit/agrogestao-pro/blob/046837bdde5263db078d8ca57cefb1ecd8aa1d8e/frontend/src/lib/dossierSyncObserver.ts#L71); [frontend/src/lib/documentSync.ts:108](https://github.com/douglasddp23-bit/agrogestao-pro/blob/046837bdde5263db078d8ca57cefb1ecd8aa1d8e/frontend/src/lib/documentSync.ts#L108); [frontend/src/lib/dossierSyncObserver.ts:256](https://github.com/douglasddp23-bit/agrogestao-pro/blob/046837bdde5263db078d8ca57cefb1ecd8aa1d8e/frontend/src/lib/dossierSyncObserver.ts#L256).

**O que falha e impacto:** A existência de qualquer registro em documents é tratada como hasOfficialPdf, inclusive a pasta criada com URL vazia. Os observadores também podem iniciar durante o carregamento do módulo antes do login: uma escuta negada termina, mas isInitialized continua true e não há reinicialização explícita. O resultado pode ser indicador incorreto ou sincronização que não começa após autenticar.

**Como corrigir:** Separar pasta, anexo e PDF publicado; calcular disponibilidade por URL/conteúdo válido. Iniciar e encerrar observadores conforme UID/cargo; em erro, limpar estado de inicialização e permitir nova escuta.

**Como validar:** Pasta vazia nunca aparece como laudo oficial disponível. Abrir app deslogado e depois entrar inicia sincronização normalmente.

### M03 — Dossiês podem duplicar e troca de cliente conflita com a regra (Média)

**Evidência:** [frontend/src/lib/documentSync.ts:120](https://github.com/douglasddp23-bit/agrogestao-pro/blob/046837bdde5263db078d8ca57cefb1ecd8aa1d8e/frontend/src/lib/documentSync.ts#L120); [frontend/src/lib/firebase.ts:261](https://github.com/douglasddp23-bit/agrogestao-pro/blob/046837bdde5263db078d8ca57cefb1ecd8aa1d8e/frontend/src/lib/firebase.ts#L261); [firestore.rules:414](https://github.com/douglasddp23-bit/agrogestao-pro/blob/046837bdde5263db078d8ca57cefb1ecd8aa1d8e/firestore.rules#L414).

**O que falha e impacto:** As rotinas consultam se existe pasta e depois usam addDoc: dois computadores podem criar duas pastas. Se o serviço muda de cliente, elas tentam atualizar clientId nos documentos, mas a regra mantém esse campo imutável. Há duas implementações de ensureFolder, aumentando divergências.

**Como corrigir:** Consolidar a rotina; usar ID determinístico e transação para pasta. Definir uma operação administrativa de transferência de dossiê com histórico, mantendo documentos e serviço alinhados.

**Como validar:** Duas sincronizações geram uma pasta. Transferir serviço para outro cliente move corretamente os vínculos, sem recusa escondida.

### M04 — Agenda automática não acompanha todas as alterações de serviço (Média)

**Evidência:** [frontend/src/lib/serviceAppointments.ts:167](https://github.com/douglasddp23-bit/agrogestao-pro/blob/046837bdde5263db078d8ca57cefb1ecd8aa1d8e/frontend/src/lib/serviceAppointments.ts#L167); [frontend/src/lib/serviceAppointments.ts:172](https://github.com/douglasddp23-bit/agrogestao-pro/blob/046837bdde5263db078d8ca57cefb1ecd8aa1d8e/frontend/src/lib/serviceAppointments.ts#L172).

**O que falha e impacto:** Agendamento automático já concluído/cancelado é sempre ignorado: reabrir serviço ou recolocar uma data não reabre a agenda. O teste de alteração compara nome do técnico, mas não technicianId: trocar por outro UID de mesmo nome deixa responsável antigo. Excluir serviço também não remove/cancela seu agendamento, porque a rotina percorre apenas origens ainda existentes. Erros de sincronização são ocultados.

**Como corrigir:** Definir transições de reabertura e exclusão; comparar UID e todos os campos relevantes; reconciliar também agendamentos órfãos; mostrar pendências de sincronização recuperáveis.

**Como validar:** Reabrir serviço reflete na agenda. Trocar técnico homônimo muda UID. Excluir origem cancela agenda vinculada conforme a política definida.

### M05 — Reagir à mensagem de outra pessoa é recusado pelo banco (Média)

**Evidência:** [frontend/src/components/ChannelChat.tsx:350](https://github.com/douglasddp23-bit/agrogestao-pro/blob/046837bdde5263db078d8ca57cefb1ecd8aa1d8e/frontend/src/components/ChannelChat.tsx#L350); [firestore.rules:649](https://github.com/douglasddp23-bit/agrogestao-pro/blob/046837bdde5263db078d8ca57cefb1ecd8aa1d8e/firestore.rules#L649).

**O que falha e impacto:** A tela oferece reação a mensagens, mas a regra permite update de channel_messages somente ao senderId. Reação em mensagem alheia é negada e o erro fica no console. O campo de reações inteiro também é substituído, podendo perder uma reação concorrente.

**Como corrigir:** Separar permissão de editar conteúdo da permissão de reagir; guardar reação por usuário ou usar operação atômica controlada. Mostrar falha de reação ao usuário.

**Como validar:** A reage à mensagem de B sem poder editar seu texto; duas reações simultâneas permanecem registradas.

### M06 — Emissão fiscal real ainda não está implementada (Média)

**Evidência:** [backend/services/fiscalService.ts:227](https://github.com/douglasddp23-bit/agrogestao-pro/blob/046837bdde5263db078d8ca57cefb1ecd8aa1d8e/backend/services/fiscalService.ts#L227).

**O que falha e impacto:** getFiscalService só escolhe simulado ou nenhum. Não existe adaptador que use FISCAL_API_URL/FISCAL_API_KEY para um provedor real. Preencher essas variáveis e outro nome de provedor não ativa emissão. É funcionalidade incompleta, não evidência de falha da prefeitura/SEFAZ.

**Como corrigir:** Escolher provedor e implementar o contrato completo de emissão, consulta, cancelamento, XML/PDF e reconciliação. Validar em homologação e apresentar estado de configuração explícito antes de liberar uso real.

**Como validar:** Uma operação em homologação recebe autorização verdadeira do provedor e conserva referência, protocolo, XML/PDF. Configuração inválida explica a indisponibilidade.

### M07 — Faturamento misto comporta somente um resumo de documento fiscal (Média)

**Evidência:** [backend/controllers/fiscalController.ts:204](https://github.com/douglasddp23-bit/agrogestao-pro/blob/046837bdde5263db078d8ca57cefb1ecd8aa1d8e/backend/controllers/fiscalController.ts#L204); [backend/controllers/fiscalController.ts:135](https://github.com/douglasddp23-bit/agrogestao-pro/blob/046837bdde5263db078d8ca57cefb1ecd8aa1d8e/backend/controllers/fiscalController.ts#L135); [frontend/src/components/billing/BillingForm.tsx:315](https://github.com/douglasddp23-bit/agrogestao-pro/blob/046837bdde5263db078d8ca57cefb1ecd8aa1d8e/frontend/src/components/billing/BillingForm.tsx#L315).

**O que falha e impacto:** O formulário permite itens de produto e serviço; emissão filtra uma dessas partes e depois bloqueia outra emissão porque há um único b.fiscal. A interface orienta faturar a outra parte separadamente, mas ela já consta nas parcelas do faturamento misto original: repetir a cobrança pode duplicar o financeiro. Não há associação estruturada por parte/itens.

**Como corrigir:** Ou impedir faturamento misto e separar documentos/cobranças antes da confirmação, ou suportar dois documentos fiscais vinculados a um único conjunto de parcelas com controle por item.

**Como validar:** R$ 100 em produto + R$ 200 em serviço: duas notas corretas quando necessárias, total a receber de R$ 300, nunca R$ 400/R$ 500.

### M08 — Irrigação aceita parâmetros que geram cálculo inválido ou incompleto (Média)

**Evidência:** [frontend/src/pages/Irrigation.tsx:62](https://github.com/douglasddp23-bit/agrogestao-pro/blob/046837bdde5263db078d8ca57cefb1ecd8aa1d8e/frontend/src/pages/Irrigation.tsx#L62); [frontend/src/pages/Irrigation.tsx:332](https://github.com/douglasddp23-bit/agrogestao-pro/blob/046837bdde5263db078d8ca57cefb1ecd8aa1d8e/frontend/src/pages/Irrigation.tsx#L332).

**O que falha e impacto:** A validação exige cliente, propriedade, área e sistema, mas não exige vazão/diâmetro/comprimento nem rendimento positivo da bomba. É possível salvar cálculo com dimensionamento zerado; rendimento zero pode gerar Infinity. A regra okService não valida os parâmetros hidráulicos internos. Isso afeta confiabilidade do relatório técnico.

**Como corrigir:** Validar limites de entradas obrigatórias, rendimentos, coeficientes e números finitos; impedir salvar/exportar projeto final sem dimensionamento completo. Permitir rascunho com indicação explícita de incompletude e testes de limites.

**Como validar:** Zero/negativo em diâmetro, rendimento ou coeficiente recebe erro. Nenhum projeto final contém NaN/Infinity ou bomba zero com demanda positiva.

### M09 — PDF técnico atribui responsabilidade a quem exporta (Média)

**Evidência:** [frontend/src/pages/JudicialExpertise.tsx:231](https://github.com/douglasddp23-bit/agrogestao-pro/blob/046837bdde5263db078d8ca57cefb1ecd8aa1d8e/frontend/src/pages/JudicialExpertise.tsx#L231); [frontend/src/pages/RuralPropertyValuation.tsx:292](https://github.com/douglasddp23-bit/agrogestao-pro/blob/046837bdde5263db078d8ca57cefb1ecd8aa1d8e/frontend/src/pages/RuralPropertyValuation.tsx#L292).

**O que falha e impacto:** Os PDFs de perícia e avaliação usam nome e registro profissional do usuário logado, com fallback CREA-MG 000.000/D. Se um gerente exporta trabalho de outro técnico, o responsável impresso pode mudar. O fallback pode sair em um documento apresentado como oficial.

**Como corrigir:** Usar responsável e registro gravados na versão do laudo; exigir campos reais para finalizar; distinguir autor/responsável de usuário que exportou e registrar a versão do conteúdo.

**Como validar:** Exportação pelo gerente preserva técnico A. Registro profissional ausente bloqueia documento final e permite apenas rascunho sinalizado.

### M10 — CPF/CNPJ e códigos de cliente não têm unicidade no banco (Média)

**Evidência:** [frontend/src/pages/Clients.tsx:411](https://github.com/douglasddp23-bit/agrogestao-pro/blob/046837bdde5263db078d8ca57cefb1ecd8aa1d8e/frontend/src/pages/Clients.tsx#L411); [frontend/src/pages/Clients.tsx:491](https://github.com/douglasddp23-bit/agrogestao-pro/blob/046837bdde5263db078d8ca57cefb1ecd8aa1d8e/frontend/src/pages/Clients.tsx#L491).

**O que falha e impacto:** A verificação de CPF/CNPJ usa a lista local. Dois clientes simultâneos podem salvar o mesmo documento, com IDs diferentes. O código comercial de seis dígitos usa Math.random sem reserva, podendo colidir. As regras não impõem índice de unicidade.

**Como corrigir:** Reservar documento normalizado em uma coleção de chaves únicas na mesma transação de cadastro. Gerar código com contador/ID único. Levantar e conciliar duplicados sem perder serviços vinculados.

**Como validar:** Dois cadastros simultâneos do mesmo CPF/CNPJ produzem um único cliente; códigos comerciais nunca colidem.

### M11 — Conversão de valor textual pode multiplicar uma cobrança por 100 (Média)

**Evidência:** [frontend/src/lib/billing/sources.ts:23](https://github.com/douglasddp23-bit/agrogestao-pro/blob/046837bdde5263db078d8ca57cefb1ecd8aa1d8e/frontend/src/lib/billing/sources.ts#L23).

**O que falha e impacto:** num remove todos os pontos antes de converter texto. Reproduzi localmente: valor numérico 100.5 retorna 100.5; texto brasileiro "100,50" retorna 100.5; texto "100.50" retorna 10050. Isso afeta dados antigos/importados em formato decimal com ponto; não ocorre para valores já gravados como number.

**Como corrigir:** Guardar dinheiro em formato numérico canônico, preferencialmente centavos; interpretar formatos de importação explicitamente e rejeitar ambiguidade. Revisar valores importados antes de faturar.

**Como validar:** 100.50 numérico e textual decimal produzem R$ 100,50; "1.234,56" brasileiro produz R$ 1.234,56; formato ambíguo exige escolha.

### M12 — Excluir cliente conserva serviços e histórico sem cadastro de origem (Média)

**Evidência:** [frontend/src/pages/Clients.tsx:3238](https://github.com/douglasddp23-bit/agrogestao-pro/blob/046837bdde5263db078d8ca57cefb1ecd8aa1d8e/frontend/src/pages/Clients.tsx#L3238); [frontend/src/lib/permissions.ts:170](https://github.com/douglasddp23-bit/agrogestao-pro/blob/046837bdde5263db078d8ca57cefb1ecd8aa1d8e/frontend/src/lib/permissions.ts#L170).

**O que falha e impacto:** A exclusão remove cliente e tenta remover documentos, mas não verifica contratos, faturamentos ou serviços vinculados. canDeleteClient ignora o argumento hasActiveServices. Além de deixar referências órfãs, uma emissão fiscal posterior falha porque procura o cadastro do cliente. Falha no apagamento do dossiê é registrada e o cliente é apagado mesmo assim.

**Como corrigir:** Preferir arquivamento/inativação do cliente com histórico; bloquear exclusão definitiva enquanto houver vínculos. Criar fluxo administrativo controlado de descarte e tratar falhas antes de confirmar conclusão.

**Como validar:** Cliente com faturamento/contrato ativo é arquivado ou tem exclusão negada. Relatórios históricos e cadastro necessário para consulta fiscal continuam disponíveis.

### M13 — Reserva diária pode suprimir nova tentativa após falha (Média)

**Evidência:** [backend/server.ts:1201](https://github.com/douglasddp23-bit/agrogestao-pro/blob/046837bdde5263db078d8ca57cefb1ecd8aa1d8e/backend/server.ts#L1201); [backend/server.ts:1216](https://github.com/douglasddp23-bit/agrogestao-pro/blob/046837bdde5263db078d8ca57cefb1ecd8aa1d8e/backend/server.ts#L1216); [backend/services/backupService.ts:106](https://github.com/douglasddp23-bit/agrogestao-pro/blob/046837bdde5263db078d8ca57cefb1ecd8aa1d8e/backend/services/backupService.ts#L106).

**O que falha e impacto:** A reserva diária registra lastRunDate antes do processamento; se falha depois, outro PC pula o dia. runDailyExpiringChecks pode devolver success:false sem lançar exceção e a reserva segue concluída. As rotinas dependem de algum app aberto; backup diário cobre somente Firestore, não contas do Firebase Auth nem configurações locais, o que limita recuperação completa. São riscos de disponibilidade e recuperação, não falhas observadas em produção.

**Como corrigir:** Separar reservado, em execução, concluído e falho; usar lease com prazo e retentativa, e registrar conclusão apenas ao terminar. Centralizar agendamento confiável e documentar/testar recuperação de Firestore, Auth e configurações separadamente.

**Como validar:** Falhar no meio da execução permite retomada no mesmo dia sem duplicar avisos. Recuperação em projeto de teste restaura dados e capacidade de login, com procedimento documentado.

### L01 — Listagens inteiras e escutas multiplicam leituras e processamento (Leve)

**Evidência:** [frontend/src/pages/Documents.tsx:122](https://github.com/douglasddp23-bit/agrogestao-pro/blob/046837bdde5263db078d8ca57cefb1ecd8aa1d8e/frontend/src/pages/Documents.tsx#L122); [frontend/src/lib/serviceAppointments.ts:91](https://github.com/douglasddp23-bit/agrogestao-pro/blob/046837bdde5263db078d8ca57cefb1ecd8aa1d8e/frontend/src/lib/serviceAppointments.ts#L91); [frontend/src/lib/dossierSyncObserver.ts:212](https://github.com/douglasddp23-bit/agrogestao-pro/blob/046837bdde5263db078d8ca57cefb1ecd8aa1d8e/frontend/src/lib/dossierSyncObserver.ts#L212).

**O que falha e impacto:** Várias telas escutam coleções inteiras. A sincronização da agenda lê todas as origens a cada chamada, e o observador de dossiê faz consultas adicionais por serviço. Com poucos registros funciona, mas cresce custo de leituras, tempo inicial e processamento em conexões rurais. O build também avisa sobre chunks acima de 500 kB; o aviso sozinho não é falha.

**Como corrigir:** Paginar listagens, filtrar por período/cliente/responsável, limitar histórico e consolidar escutas. Medir leituras, bytes e tempo com base de teste representativa antes de otimizar.

**Como validar:** Com milhares de registros, primeira página aparece sem baixar histórico inteiro; navegação mantém tempos e leituras dentro de metas definidas.

### L02 — Testes existentes não protegem os fluxos de gestão (Leve)

**Evidência:** [package.json:13](https://github.com/douglasddp23-bit/agrogestao-pro/blob/046837bdde5263db078d8ca57cefb1ecd8aa1d8e/package.json#L13); [tsconfig.json:2](https://github.com/douglasddp23-bit/agrogestao-pro/blob/046837bdde5263db078d8ca57cefb1ecd8aa1d8e/tsconfig.json#L2).

**O que falha e impacto:** Há duas suítes com 16 testes de cálculos de crédito/faturamento. Não há testes versionados de regras, autenticação, concorrência ou jornadas completas; TypeScript não está em strict e o script lint é somente tsc --noEmit. Isso explica por que verificações verdes coexistem com falhas funcionais. Não foi identificada configuração de CI versionada.

**Como corrigir:** Criar testes no emulador para permissões e operações financeiras concorrentes; testes de integração das rotas; jornadas de cliente-serviço-faturamento-pagamento. Rodar em CI e adotar strict gradualmente, priorizando módulos financeiros e Auth.

**Como validar:** As regressões C01/A01/A03–A08 são detectadas automaticamente antes de integrar alterações; CI roda checagem, testes e build.

### L03 — Configuração inválida ativa mocks em vez de diagnóstico claro (Leve)

**Evidência:** [frontend/src/lib/firebase.ts:21](https://github.com/douglasddp23-bit/agrogestao-pro/blob/046837bdde5263db078d8ca57cefb1ecd8aa1d8e/frontend/src/lib/firebase.ts#L21); [frontend/src/lib/firebase.ts:114](https://github.com/douglasddp23-bit/agrogestao-pro/blob/046837bdde5263db078d8ca57cefb1ecd8aa1d8e/frontend/src/lib/firebase.ts#L114).

**O que falha e impacto:** Sem configuração válida, o módulo intercepta fetch/XHR e fabrica respostas Firebase, usa chave fictícia e desliga a rede. O login hoje recusa entrada nessa condição, mas esses mocks dificultam diagnosticar instalação e deixam código de demonstração misturado ao produto.

**Como corrigir:** Remover mocks do caminho normal; validar configuração antes de inicializar serviços e mostrar tela de diagnóstico. Manter simulador explícito isolado em testes/demonstração.

**Como validar:** Configuração ausente informa exatamente quais campos faltam, sem respostas falsas nem carregamento indefinido.

### L04 — Assinatura remota tem código mantido, mas rota desativada (Leve)

**Evidência:** [frontend/src/App.tsx:36](https://github.com/douglasddp23-bit/agrogestao-pro/blob/046837bdde5263db078d8ca57cefb1ecd8aa1d8e/frontend/src/App.tsx#L36); [frontend/src/pages/RemoteSignature.tsx:32](https://github.com/douglasddp23-bit/agrogestao-pro/blob/046837bdde5263db078d8ca57cefb1ecd8aa1d8e/frontend/src/pages/RemoteSignature.tsx#L32).

**O que falha e impacto:** O caminho público /assinar está explicitamente desligado. A página RemoteSignature não representa uma capacidade disponível nessa versão. Manter código antigo junto do fluxo atual pode confundir manutenção e planejamento; a assinatura presencial continua sendo outra função.

**Como corrigir:** Registrar a capacidade como indisponível e isolar/remover código inativo. Para reativar, implementar acesso limitado a um único contrato com token temporário e validação no servidor, sem abrir leitura geral de contratos.

**Como validar:** Nenhuma tela promete link remoto funcional nesta versão. Uma futura ativação só libera o contrato autorizado e não expõe outros registros.

## Ordem prática para consertar

1. **Proteção de acesso:** C01, C02, A01, A02 e A09. Fechar caminho de credenciais em perfil; centralizar servidor privilegiado; garantir bloqueio e MFA em todos os caminhos; tornar falhas explícitas.
2. **Integridade financeira:** A03, A04, A05 e A06. Criar um livro único de cobranças e pagamentos; usar transações/IDs fixos; conciliar registros antigos antes de trocar o fluxo.
3. **Concorrência e documentos:** A07, A08, A10, M01–M05. Impedir estoque negativo, reservar tentativas fiscais e preservar documentos/autoria.
4. **Capacidades incompletas:** M06–M09. Implementar provedor fiscal e tratamento de operação mista; validar projetos e PDFs finais.
5. **Cadastros e recuperação:** M10–M13. Garantir unicidade, valores corretos, histórico de clientes e rotinas recuperáveis.
6. **Manutenção e prevenção:** L01–L04. Medir desempenho, colocar testes de regressão em CI e retirar código de simulação do caminho normal.

Antes de cada alteração de estrutura de dados, gerar backup e testar migração em cópia isolada. Após consertar, não apagar duplicatas financeiras automaticamente: conferir origem, parcelas, pagamentos e conciliação para distinguir duplicação de operações legítimas.

## Mapa dos módulos

| Área | Pontos relevantes / situação |
|---|---|
| Login, perfis, usuários e delegações | C01/C02/A01/A02/A09; permissões precisam ser verificadas no banco e no servidor |
| Clientes | M10/M12; cadastro amplo, sem unicidade transacional e com exclusão de vínculos |
| Análises | A03; conclusão e faturamento geram cobranças por caminhos distintos |
| Crédito Rural / Proposta | Cálculos existentes passaram; numeração, regras comerciais e aderência às planilhas originais não foram revalidadas nesta auditoria |
| Irrigação | M08; dimensionamento precisa validação de entrada e testes técnicos |
| Topografia / Regularização | M04 e validações comuns de serviços; não houve validação de levantamento geodésico nem integração com órgão externo |
| Perícia / Avaliação Rural | M02/M03/M09/A10; autoria e disponibilidade do laudo devem ser corrigidas |
| Contratos | A04/L04; baixa financeira precisa transação; link de assinatura remota está desligado |
| Faturamento / Financeiro | A03–A06/M07/M11; novo fluxo tem transações boas, mas não resolve todos os caminhos legados |
| Fiscal | A08/M06/M07; somente simulador disponível nesta versão |
| Agenda / Visitas | M04; reconciliação parcial; funcionamento GPS em dispositivo real não testado |
| Estoque / Veículos | A07/M01; concorrência e permissões incompatíveis em fechamento de viagem |
| RH / Perfil | Regras específicas para dados confidenciais já existem; faltam testes de cada cargo, aprovação e consistência entre perfis |
| Mensagens / Canais | M05; permissões de reação divergem da tela |
| Documentos / Dossiês | A10/M02/M03; permissões amplas, pasta confundida com laudo e risco de duplicação |
| Dashboard / Relatórios / Auditoria | Dependem da consistência financeira; trilha crítica ainda é produzida pelo cliente |
| Instalação / Backup / Rotinas | C02/M13; build passou, recuperação integral e instalação não foram comprovadas |

## O que já está bem encaminhado

- O resumo fiscal é gravado somente pelo servidor nas regras analisadas.
- Credenciais têm coleção própria sem leitura/escrita do cliente; falta eliminar a dependência de hash no perfil e impedir a inserção desse campo.
- Confirmação e pagamento do novo faturamento usam transação; IDs fixos das contas por parcela evitam duplicação dentro desse fluxo.
- Servidor verifica tokens e aplica limites, proteção de origem/host e cabeçalhos de segurança.
- Electron usa isolamento de contexto, sandbox e Node desabilitado no conteúdo da janela principal.
- Há validação de uploads e restrições de tipos; os novos arquivos ficam vinculados por referência.
- Build e checagem de tipos passaram nesta versão.

Essas proteções merecem ser preservadas durante os consertos. Elas não anulam os defeitos de integração e os caminhos alternativos descritos acima.

## Referência técnica externa usada

A documentação oficial [Firebase — Manage User Sessions](https://firebase.google.com/docs/auth/admin/manage-sessions) explica revogação de sessões, validade de ID tokens e necessidade de checagem de revogação no servidor/regras. Ela foi usada para avaliar A01. Os demais achados são baseados no código da versão indicada; não foi feita auditoria legal, contábil ou de conformidade com normas agronômicas, nem avaliação de vulnerabilidades atuais de todas as dependências.
