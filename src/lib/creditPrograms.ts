// Linhas de crédito rural usadas na "Proposta de Crédito" (assistente em 3 etapas).
//
// Valores de REFERÊNCIA do Plano Safra 2026/2027 (Res. CMN de jun/2026, MDA e
// MAPA), pesquisados em 29/09/2026. Servem para orientar o técnico e o cliente —
// cada banco confirma as condições na hora da contratação, e elas mudam a cada
// Plano Safra (julho). Onde a fonte oficial não deixa o número claro, o campo
// fica como "Consultar o banco" em vez de arriscar um valor.

export const SAFRA_REFERENCIA = 'Plano Safra 2026/2027';

export interface CreditProgram {
  id: string;
  nome: string;           // nome curto (vai para a lista e para o PDF)
  grupo: 'Pronaf' | 'Pronamp' | 'Demais produtores';
  finalidade: 'Investimento' | 'Custeio' | 'Custeio e investimento';
  publico: string;        // quem pode contratar (enquadramento)
  juros: string;
  limite: string;
  prazo: string;
  carencia: string;
  bonus?: string;
  documentos: string[];   // checklist entregue ao cliente no PDF
}

const DOCS_BASE = [
  'Documento de identidade e CPF do titular (e do cônjuge, se casado)',
  'Comprovante de residência atualizado',
  'Comprovante de estado civil (certidão de casamento/união estável, se houver)',
];
const DOCS_IMOVEL = [
  'Documento do imóvel (escritura/matrícula, CCIR e ITR) ou contrato de arrendamento/comodato',
  'Cadastro Ambiental Rural (CAR) do imóvel',
];
const DOC_CAF = 'CAF — Cadastro Nacional da Agricultura Familiar ativo (substituiu a DAP)';
const DOCS_ORCAMENTO = ['Orçamentos/propostas dos itens a financiar (em nome do cliente)'];

export const CREDIT_PROGRAMS: CreditProgram[] = [
  {
    id: 'pronaf-a',
    nome: 'Pronaf A',
    grupo: 'Pronaf',
    finalidade: 'Investimento',
    publico: 'Assentados da reforma agrária, beneficiários do crédito fundiário, povos indígenas e comunidades quilombolas',
    juros: '0,5% ao ano',
    limite: 'Até R$ 55.000,00 (+ até R$ 3.000,00 para assistência técnica)',
    prazo: 'Até 10 anos',
    carencia: 'Até 3 anos',
    bonus: '40% de bônus de adimplência (pagamento em dia)',
    documentos: [DOC_CAF + ' — Grupo A', 'Declaração/relação de beneficiário do INCRA ou do crédito fundiário', ...DOCS_BASE, ...DOCS_ORCAMENTO],
  },
  {
    id: 'pronaf-b',
    nome: 'Pronaf B (Microcrédito)',
    grupo: 'Pronaf',
    finalidade: 'Custeio e investimento',
    publico: 'Agricultor familiar com renda bruta familiar anual de até R$ 60.000,00',
    juros: '0,5% ao ano',
    limite: 'Consultar o banco (mulheres: linha extra de custeio de até R$ 8.000,00)',
    prazo: 'Até 3 anos (36 meses)',
    carencia: 'Até 1 ano',
    bonus: '25% a 40% de bônus de adimplência, conforme região e finalidade',
    documentos: [DOC_CAF + ' — Grupo B', ...DOCS_BASE, ...DOCS_IMOVEL.slice(1)],
  },
  {
    id: 'pronaf-v-custeio',
    nome: 'Pronaf V — Custeio',
    grupo: 'Pronaf',
    finalidade: 'Custeio',
    publico: 'Agricultor familiar (Grupo V) com renda bruta anual de até R$ 500.000,00',
    juros: '1% a 7,5% ao ano (alimentos básicos 2%; milho, café e frutas 5,5%; soja e bovinos de corte 7,5%; agroecológico/orgânico 1%)',
    limite: 'Até R$ 250.000,00 por ano agrícola',
    prazo: 'Conforme o ciclo da cultura/criação',
    carencia: 'Pagamento após a colheita/venda',
    documentos: [DOC_CAF, ...DOCS_BASE, ...DOCS_IMOVEL, 'Orçamento/plano de custeio da lavoura ou criação'],
  },
  {
    id: 'pronaf-v-investimento',
    nome: 'Pronaf V — Investimento (Mais Alimentos)',
    grupo: 'Pronaf',
    finalidade: 'Investimento',
    publico: 'Agricultor familiar (Grupo V) com renda bruta anual de até R$ 500.000,00',
    juros: 'Até 7,5% ao ano (linhas especiais de 1,5% a 2%: Mulher, Jovem, pequenas máquinas)',
    limite: 'Consultar o banco (até R$ 450.000,00 para suinocultura, avicultura e fruticultura)',
    prazo: 'Até 10 anos',
    carencia: 'Até 3 anos',
    documentos: [DOC_CAF, ...DOCS_BASE, ...DOCS_IMOVEL, ...DOCS_ORCAMENTO, 'Projeto técnico (elaborado pela empresa)'],
  },
  {
    id: 'pronamp-custeio',
    nome: 'Pronamp — Custeio',
    grupo: 'Pronamp',
    finalidade: 'Custeio',
    publico: 'Médio produtor rural com renda bruta anual de até R$ 3.500.000,00 (mín. 80% da renda vinda da atividade rural)',
    juros: '9% ao ano (prefixado)',
    limite: 'Até R$ 1.500.000,00 por ano agrícola',
    prazo: 'Conforme o ciclo da cultura/criação',
    carencia: 'Pagamento após a colheita/venda',
    documentos: [...DOCS_BASE, ...DOCS_IMOVEL, 'Comprovação de renda bruta agropecuária (IR, notas de venda ou declaração)', 'Orçamento/plano de custeio da lavoura ou criação'],
  },
  {
    id: 'pronamp-investimento',
    nome: 'Pronamp — Investimento',
    grupo: 'Pronamp',
    finalidade: 'Investimento',
    publico: 'Médio produtor rural com renda bruta anual de até R$ 3.500.000,00 (mín. 80% da renda vinda da atividade rural)',
    juros: '9% ao ano (prefixado)',
    limite: 'Consultar o banco',
    prazo: 'Até 8 anos',
    carencia: 'Até 3 anos',
    documentos: [...DOCS_BASE, ...DOCS_IMOVEL, 'Comprovação de renda bruta agropecuária (IR, notas de venda ou declaração)', ...DOCS_ORCAMENTO, 'Projeto técnico (elaborado pela empresa)'],
  },
  {
    id: 'custeio-demais',
    nome: 'Custeio Rural (demais produtores)',
    grupo: 'Demais produtores',
    finalidade: 'Custeio',
    publico: 'Produtor rural fora do Pronaf e do Pronamp (recursos controlados)',
    juros: '12,5% ao ano',
    limite: 'Consultar o banco',
    prazo: 'Conforme o ciclo da cultura/criação',
    carencia: 'Pagamento após a colheita/venda',
    documentos: [...DOCS_BASE, ...DOCS_IMOVEL, 'Comprovação de renda (IR ou notas de venda)', 'Orçamento/plano de custeio da lavoura ou criação'],
  },
  {
    id: 'investimento-demais',
    nome: 'Investimento Rural (demais produtores)',
    grupo: 'Demais produtores',
    finalidade: 'Investimento',
    publico: 'Produtor rural fora do Pronaf e do Pronamp',
    juros: '8% a 12,5% ao ano conforme a linha (PCA 8–9,5%; RenovAgro 8,5–9,5%; Inovagro/Proirriga 11,5%; Moderfrota 12,5%)',
    limite: 'Conforme a linha (ex.: Proirriga até R$ 3,5 milhões; Inovagro até R$ 4 milhões)',
    prazo: 'Conforme a linha (ex.: Proirriga até 8 anos; Inovagro até 10; RenovAgro até 12)',
    carencia: 'Conforme a linha',
    documentos: [...DOCS_BASE, ...DOCS_IMOVEL, 'Comprovação de renda (IR ou notas de venda)', ...DOCS_ORCAMENTO, 'Projeto técnico (elaborado pela empresa)', 'Licença/outorga ambiental, quando exigida (ex.: irrigação)'],
  },
];

export const BANCOS_FINANCIADORES = [
  'Banco do Nordeste (BNB)',
  'Banco do Brasil',
  'Caixa Econômica Federal',
  'Sicoob',
  'Sicredi',
  'Cresol',
  'Outro',
];

export function findCreditProgram(id?: string): CreditProgram | undefined {
  return CREDIT_PROGRAMS.find(p => p.id === id);
}
