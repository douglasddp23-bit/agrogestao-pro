# Correções da auditoria — 04/10/2026 UTC

Esta branch corrige parte dos problemas descritos em [AUDITORIA_BASE_2026-10-03.md](AUDITORIA_BASE_2026-10-03.md). O relatório base descreve o commit anterior às alterações. Não representa o comportamento desta branch e não é uma certificação do sistema em produção.

## Alterações implementadas

- **C01:** o login real consulta somente `user_credentials`; perfis públicos não podem receber hashes, senhas ou segredos TOTP. O servidor continua sendo o único escritor de credenciais.
- **A01/A02:** falhas de bloqueio são apresentadas na tela; flags atuais de bloqueio/MFA são verificadas nas regras e no servidor. Login Google sem prova de MFA é encerrado. Ativação/desativação TOTP e flag de perfil são gravadas juntas; falha na troca de senha interna impede anúncio de ativação. Erro na leitura de credenciais não desativa silenciosamente a conferência TOTP.
- **A03:** concluir análise deixa de gerar cobrança automática. Faturamento passa a reservar a origem e a impedir confirmação se encontrar cobrança legada ativa para o serviço. Dados anteriores precisam de reconciliação.
- **A04/A05:** baixa de contrato e aprovação de despesa são transacionais com identificador financeiro permanente. Aprovação gera conta **a pagar**, sem anunciar pagamento; solicitante não aprova a própria despesa.
- **A06:** cancelamento usa parcelas e contas atuais em transação; pagamentos existentes são preservados. Atraso é calculado na leitura em vez de sobrescrever pagamentos com dados de listeners antigos.
- **A07:** movimentações consultam saldo atual na transação e recusam saída insuficiente. Regras proíbem saldo negativo.
- **A09:** operações de senha não ignoram falha no Firebase Auth; criação exige cargo, credencial e perfil persistidos e tenta remover conta parcial em caso de falha. Não existe transação entre Firebase Auth e Firestore; compensações ainda podem falhar e exigem intervenção.
- **A10 (parcial):** autoria e cliente dos documentos ficam preservados; atualizações são limitadas à gestão ou ao proprietário. Logs continuam sendo enviados por clientes e ainda não constituem auditoria independente.
- **M01:** viagem e odômetro são gravados juntos; motorista pode atualizar somente os campos limitados do veículo associado à própria viagem.
- **M02/M03:** observadores do dossiê iniciam após autenticação e encerram no logout; pasta sem arquivo não conta como PDF oficial. Novas pastas usam identificador determinístico. Transferência de cliente em perícia/avaliação é recusada antes de salvar, até existir procedimento administrativo.
- **M04:** agenda compara UID do técnico, acompanha reabertura e cancela agendamento automático quando a origem foi removida. Sincronização continua dependente do aplicativo aberto.
- **M05:** cada colaborador atualiza somente a própria lista de reações. Reações antigas continuam visíveis; migração do formato antigo pode ser necessária para remover reações legadas.
- **M07:** produtos e serviços mistos são recusados na gravação e na validação fiscal; devem ter faturamentos separados.
- **M08:** salvamento de irrigação exige entradas hidráulicas positivas, rendimentos válidos e altura/pressão não negativas. Não substitui revisão técnica das fórmulas e do projeto.
- **M09:** laudos identificam o autor cadastrado e seu registro profissional, sem CREA fictício do usuário exportador; autoria original é preservada ao editar.
- **M11:** conversão dos valores de origem preserva centavos com ponto decimal e aceita formato brasileiro com vírgula.
- **M12:** ação da tela de Clientes arquiva o cadastro e preserva serviços/documentos/cobranças. Demais telas ainda podem listar arquivados; padronização dos seletores e restauração ficam pendentes.
- **L02/L03:** testes de regressão, regras/concorrência no emulador e CI adicionados; remoção de interceptadores globais que fabricavam respostas Firebase. TypeScript permanece com a configuração anterior.

## Pendências que esta branch não resolve

1. **C02:** centralizar o servidor e retirar credenciais administrativas dos computadores dos colaboradores. Depois, rotacionar as chaves existentes e restringir IAM. Regras Firestore não limitam o Admin SDK.
2. **A08/M06:** implementar provedor fiscal real e idempotência/reserva transacional das novas tentativas. A emissão atual é simulação; não usar como comprovação fiscal válida. Faturamentos mistos legados precisam ser revisados antes da emissão.
3. **M10:** reservar CPF/CNPJ e código de cliente no banco; validação local ainda permite colisões entre computadores.
4. **M13:** corrigir lease/repetição dos jobs diários, backup completo do Auth e executar jobs fora do aplicativo.
5. **L01/L04:** paginação/limites de consultas e definição de um fluxo real para assinatura remota. Não foi ativada assinatura pública.
6. **Acesso delegado:** conferir expiração/revogação de delegações também no acesso direto ao Firestore. O middleware agora consulta o cargo e delegações atuais; as regras ainda usam o cargo do token.
7. Migração/reconciliação de dados existentes: hashes em perfis, contas antigas sem credencial privada, pastas e cobranças duplicadas, reações legadas e recebimentos/estornos. Nenhum dado de produção foi alterado automaticamente.

## Publicação e migração

1. Fazer backup de Firestore e Firebase Auth e conferir o projeto/database de destino. Homologar a branch com contas de administrador, gerente e consultor e com dados fictícios.
2. No servidor confiável, revisar perfis `users` contendo campos de credencial. Não copiar hashes públicos para `user_credentials`, pois podem ter sido alterados pela falha antiga. Remover campos sensíveis dos perfis e redefinir credenciais de contas sem hash privado confiável. Novas regras recusam atualização de perfis que ainda contenham esses campos.
3. Conferir contas que já possuem TOTP ativo em `user_credentials`: seu perfil deve ter `twoFactorEnabled: true`. A nova regra depende dessa flag protegida. Não apagar configuração TOTP nem criar claim `mfaVerified` manualmente para contornar verificação.
4. Publicar backend e aplicativo da mesma versão, depois as regras verificadas: `firebase deploy --only firestore:rules --project SEU_PROJECT_ID`. O `firebase.json` deste PR usa o database padrão; configurar explicitamente se a instalação usa database nomeado. Usuários com MFA devem entrar novamente com senha e código. Não há publicação automática de produção neste PR.
5. Revisar recebíveis legados por serviço antes de faturar novamente. Identificadores determinísticos e reservas evitam novos conflitos do fluxo corrigido; não saneiam o histórico anterior. Cancelamento preserva baixa e não executa estorno bancário.
6. Após disponibilização, conferir login, MFA, bloqueio de sessão já aberta, pagamento de contrato, aprovação/reembolso, retirada simultânea de estoque, viagem de consultor, laudos e dossiês em ambiente de homologação. Validar o instalador Electron Windows separadamente.

## Verificação

`npm run lint`, `npm test`, `npm run build` e testes no emulador Firestore. O emulador usa apenas o projeto fictício `demo-agrogestao`, sem acesso a dados reais:

```sh
npx --yes firebase-tools@13.35.1 emulators:exec --only firestore --project demo-agrogestao "npm run test:rules"
```

A suíte contém 20 testes de cálculo/integridade e 11 de regras e integração, incluindo duas baixas simultâneas da mesma parcela e duas aprovações simultâneas da mesma despesa. Passagem desses testes não comprova todos os fluxos da interface, autenticação real, jobs, emissão fiscal, integrações ou instalador.
