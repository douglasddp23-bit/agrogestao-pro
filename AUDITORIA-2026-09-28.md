# Auditoria de funcionalidade e visual — 28/09/2026

Testes feitos no aplicativo de verdade, com um banco de TESTE local (emulador do Firebase) contendo, em cada coleção, um registro completo e um incompleto. Nenhum dado real foi usado.

## Legenda
✅ funcionando · 🔧 corrigido nesta auditoria · ⚠️ pendente de decisão

## Todas as páginas
- 🔧 Cabeçalho padronizado com o componente `PageHeader` (src/components/layout/PageHeader.tsx): título = nome do menu, mesmo tamanho, mesmo ícone do menu em quadrado verde, subtítulo de uma linha, botões à direita.
- 🔧 Modo escuro seguia a configuração do Windows (e não o botão de tema do sistema): com o Windows em modo escuro, textos ficavam quase brancos sobre fundo claro. Agora segue só o botão de tema.
- ✅ 25 abas × 4 cargos abertas e clicadas (sub-abas, filtros, "Novo...", fichas de detalhe) sem quebra nem erro.

## Por página
| Página | Testado | Resultado |
|---|---|---|
| Dashboard | abrir, cliques, metas mensais | 🔧 metas agora ficam no banco (iguais em todos os PCs) |
| Clientes | cadastro simplificado e completo, busca, ficha, edição | ✅ |
| Análises Técnicas | criar serviço, editar resultados | ✅ |
| Visitas de Campo | nova visita (5 etapas) | ✅ · 🔧 lista não "ressuscita" visitas apagadas (cache local) |
| Agendamentos | novo agendamento | ✅ (aviso de e-mail não enviado: SMTP não configurado) · ⚠️ check-in GPS não verificável no navegador de teste |
| Perícia Judicial | criar, editar, dossiê | 🔧 salvamento falhava ao criar a pasta do dossiê · 🔧 laudo sem cliente ia para o dossiê de um cliente qualquer |
| Avaliação de Imóveis | criar, editar, dossiê | 🔧 mesmos dois problemas da Perícia |
| Irrigação | projeto completo (5 etapas) | ✅ |
| Topografia | registrar serviço | ✅ |
| Regularização | novo protocolo | ✅ |
| Crédito Rural | proposta Pronaf (CPF de cliente cadastrado) | ✅ |
| Pragas e Doenças | registrar foco | ✅ |
| Raio-X Ambiental | criar e editar diagnóstico | ✅ |
| Contratos | novo contrato (3 etapas) | ✅ |
| Financeiro | novo lançamento (3 etapas) | ✅ |
| Estoque | novo insumo | ✅ |
| Relatórios | abrir e sub-abas | ✅ |
| Documentos | dossiê de cliente completo e simplificado | 🔧 busca com baixo contraste; título gigante trocado pelo cabeçalho padrão |
| Veículos | novo veículo | ✅ |
| Mensagens | escrever/enviar | ✅ · 🔧 ganhou cabeçalho (não tinha) |
| Ponto Eletrônico (RH) | abrir, sub-abas | 🔧 cargos apareciam em inglês ("Manager", "Hr") |
| Usuários | registrar colaborador | ✅ |
| Auditoria Global | abrir, filtros | ✅ |
| Mapa de Propriedades | cliente → propriedade → ponto no mapa | ✅ ponto no lugar certo (Almenara/MG) · ⚠️ não há onde marcar a localização |
| Meu Perfil | abrir, cartões | ✅ |

## Dois computadores (sincronização)
Testado com dois servidores simultâneos no mesmo banco:
- 🔧 Senha trocada num PC: a temporária continuava valendo no outro (cache de memória do servidor). Corrigido e testado.
- 🔧 Usuário bloqueado num PC: continuava entrando no outro. Corrigido e testado.
- 🔧 Verificação diária de prazos rodava nos dois PCs (avisos e e-mail em dobro): agora só o primeiro do dia executa.
- 🔧 Metas mensais do Dashboard: atualizam no outro PC na hora.
- ✅ Dados (clientes, serviços etc.) são lidos em tempo real do banco — sem risco de divergência.
- Preferências que ficam só no PC (aceitável): ordem/visibilidade dos cartões do Dashboard, tour de boas-vindas, cache de notícias, notificações gerais marcadas como lidas.

## Pendentes de decisão
1. Localização da propriedade: o cadastro de cliente não tem campo de latitude/longitude nem botão de GPS; só é possível importar o contorno (KML/Shapefile) no Mapa.
2. Agendamento × Visita: não há vínculo entre o agendamento e a visita registrada.
3. Padronização de botões: tamanhos e estilos diferem entre páginas (ex.: "Nova Proposta de Crédito" maior que os demais; uns em MAIÚSCULAS, outros não).
4. Espaçamento externo das páginas varia levemente (algumas com margem interna extra).
5. Notificações gerais marcadas como lidas não sincronizam entre PCs.
6. Nome da empresa longo aparece cortado no topo do menu ("AgroGestão ...").
