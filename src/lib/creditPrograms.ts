// Linhas de crédito rural usadas na "Proposta de Crédito" (assistente em 3 etapas).
//
// Fonte das linhas Pronaf: "Resumo das linhas de crédito rural do Pronaf — Safra
// 2026/2027" (MDA). Pronamp e demais produtores: Res. CMN de jun/2026 (MAPA).
// Pesquisado em 29/09/2026. As condições mudam a cada Plano Safra (julho) e cada
// banco confirma na contratação. Onde a fonte não deixa o número claro, fica
// "Consultar o banco" em vez de arriscar um valor.
//
// Muitas linhas têm juros diferentes conforme o que se financia (ex.: Mais
// Alimentos: 1,5% a 7,5%). Nesses casos o programa tem "faixas": o técnico
// escolhe a faixa e as condições dela substituem as do programa.
//
// Pronaf B (e Mulher/Jovem nas condições do B) ficou de fora: a empresa não
// trabalha com essa linha (pedido do dono, 29/09/2026).

export const SAFRA_REFERENCIA = 'Plano Safra 2026/2027';

export interface CreditFaixa {
  id: string;
  nome: string;        // o que se financia nesta faixa
  juros: string;
  limite?: string;
  prazo?: string;
  carencia?: string;
}

export interface CreditProgram {
  id: string;
  nome: string;
  grupo: 'Pronaf' | 'Pronamp' | 'Demais produtores';
  finalidade: 'Investimento' | 'Custeio' | 'Custeio e investimento';
  publico: string;
  juros: string;
  limite: string;
  prazo: string;
  carencia: string;
  bonus?: string;
  faixas?: CreditFaixa[];
  documentos: string[];
}

export interface CreditConditions {
  juros: string; limite: string; prazo: string; carencia: string; bonus?: string;
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
const DOC_PROJETO = 'Projeto técnico (elaborado pela empresa)';
const DOC_PLANO_CUSTEIO = 'Orçamento/plano de custeio da lavoura ou criação';
const DOCS_PRONAF_INVEST = [DOC_CAF, ...DOCS_BASE, ...DOCS_IMOVEL, ...DOCS_ORCAMENTO, DOC_PROJETO];
const RENDA_V = 'Agricultor familiar com CAF e renda bruta familiar anual de até R$ 500.000,00';

export const CREDIT_PROGRAMS: CreditProgram[] = [
  // ------------------------------------------------------------------ PRONAF
  {
    id: 'pronaf-a',
    nome: 'Pronaf A e A/C',
    grupo: 'Pronaf',
    finalidade: 'Custeio e investimento',
    publico: 'Beneficiários da reforma agrária, do crédito fundiário e do Terra da Gente, povos indígenas e comunidades quilombolas',
    juros: '0,5% ao ano', limite: 'R$ 55.000,00', prazo: 'Até 10 anos', carencia: 'Até 3 anos',
    bonus: '40% de bônus de adimplência (investimento)',
    faixas: [
      { id: 'invest', nome: 'Investimento na atividade produtiva', juros: '0,5% ao ano', limite: 'R$ 55.000,00', prazo: '10 anos', carencia: '3 anos' },
      { id: 'custeio', nome: 'Custeio agrícola, pecuário e de agroindústria (A/C)', juros: '1,5% ao ano', limite: 'R$ 22.000,00', prazo: '1 a 2 anos', carencia: '—' },
    ],
    documentos: [DOC_CAF + ' — Grupo A ou A/C', 'Declaração/relação de beneficiário do INCRA ou do crédito fundiário', ...DOCS_BASE, ...DOCS_ORCAMENTO],
  },
  {
    id: 'pronaf-custeio',
    nome: 'Pronaf Custeio',
    grupo: 'Pronaf',
    finalidade: 'Custeio',
    publico: RENDA_V,
    juros: '1% a 7,5% ao ano, conforme o produto', limite: 'R$ 250.000,00 por ano agrícola', prazo: '11 meses a 3 anos', carencia: '—',
    faixas: [
      { id: 'faixa1', nome: 'Faixa I — alimentos básicos (arroz, feijão, mandioca, trigo, hortaliças, frutas, leite, apicultura, aves de postura, peixes, ovinos/caprinos, milho até R$ 20 mil)', juros: '2% ao ano' },
      { id: 'faixa2', nome: 'Faixa II — demais produtos ou criações (ex.: milho acima de R$ 20 mil, café)', juros: '5,5% ao ano' },
      { id: 'faixa3', nome: 'Faixa III — sociobiodiversidade, orgânicos e agroecológicos (ou em transição)', juros: '1% ao ano' },
      { id: 'faixa4', nome: 'Faixa IV — soja, algodão e bovinocultura de corte', juros: '7,5% ao ano' },
    ],
    documentos: [DOC_CAF, ...DOCS_BASE, ...DOCS_IMOVEL, DOC_PLANO_CUSTEIO],
  },
  {
    id: 'pronaf-mais-alimentos',
    nome: 'Pronaf Mais Alimentos',
    grupo: 'Pronaf',
    finalidade: 'Investimento',
    publico: RENDA_V,
    juros: '1,5% a 7,5% ao ano, conforme o item', limite: 'R$ 250.000,00', prazo: 'Até 10 anos', carencia: 'Até 3 anos',
    faixas: [
      { id: 'estrutura', nome: 'Cultivo protegido, armazenagem, ordenhadeira e tanque de resfriamento, pesca/aquicultura, aves de postura, caprinos/ovinos, conectividade', juros: '2% ao ano', limite: 'R$ 250.000,00', prazo: '10 anos', carencia: '3 anos' },
      { id: 'genetica-leite', nome: 'Sêmen, óvulos e embriões — pecuária de leite', juros: '2% ao ano', limite: 'R$ 250.000,00', prazo: '8 anos', carencia: '3 anos' },
      { id: 'tratores', nome: 'Tratores, colheitadeiras e implementos agrícolas', juros: '5% ao ano', limite: 'R$ 250.000,00', prazo: '7 anos', carencia: '1 ano' },
      { id: 'maquinas-150', nome: 'Renda menor que R$ 150 mil — máquinas, equipamentos e implementos (inclusive irrigação e conectividade)', juros: '1,5% ao ano', limite: 'R$ 120.000,00', prazo: '10 anos', carencia: '3 anos' },
      { id: 'tratores-150', nome: 'Renda menor que R$ 150 mil — colheitadeiras, tratores e implementos', juros: '1,5% ao ano', limite: 'R$ 120.000,00', prazo: '7 anos', carencia: '1 ano' },
      { id: 'caminhonetes', nome: 'Caminhonetes e motocicletas', juros: '7,5% ao ano', limite: 'R$ 250.000,00', prazo: '5 anos', carencia: '—' },
      { id: 'pecuaria-corte', nome: 'Matrizes, reprodutores, animais de serviço, sêmen e embriões — pecuária de corte', juros: '7,5% ao ano', limite: 'R$ 250.000,00', prazo: '8 anos', carencia: '3 anos' },
      { id: 'demais', nome: 'Demais produtos e investimentos', juros: '7,5% ao ano', limite: 'R$ 250.000,00 (suinocultura, avicultura, aquicultura, carcinicultura e fruticultura: R$ 450.000,00)', prazo: '10 anos', carencia: '3 anos' },
      { id: 'regularizacao', nome: 'Regularização fundiária do imóvel rural', juros: '7,5% ao ano', limite: 'R$ 40.000,00', prazo: '10 anos', carencia: '3 anos' },
      { id: 'moradia-150', nome: 'Moradia rural — renda até R$ 150 mil', juros: '5% ao ano', limite: 'R$ 100.000,00', prazo: '10 anos', carencia: '3 anos' },
      { id: 'moradia', nome: 'Moradia rural — renda acima de R$ 150 mil', juros: '7,5% ao ano', limite: 'R$ 150.000,00', prazo: '10 anos', carencia: '3 anos' },
    ],
    documentos: DOCS_PRONAF_INVEST,
  },
  {
    id: 'pronaf-mulher',
    nome: 'Pronaf Mulher',
    grupo: 'Pronaf',
    finalidade: 'Investimento',
    publico: 'Mulher agricultora, com renda bruta familiar anual de até R$ 500.000,00',
    juros: '1,5% a 7,5% ao ano, conforme o item', limite: 'R$ 250.000,00', prazo: 'Até 10 anos', carencia: 'Até 3 anos',
    faixas: [
      { id: 'estrutura', nome: 'Cultivo protegido, armazenagem, ordenhadeira e tanque de resfriamento, aquicultura, aves de postura, caprinos/ovinos, conectividade', juros: '2% ao ano', limite: 'R$ 250.000,00', prazo: '10 anos', carencia: '3 anos' },
      { id: 'tratores', nome: 'Colheitadeiras, tratores e implementos agrícolas', juros: '5% ao ano', limite: 'R$ 250.000,00', prazo: '7 anos', carencia: '1 ano' },
      { id: 'maquinas-150', nome: 'Renda menor que R$ 150 mil — máquinas, equipamentos e implementos (inclusive irrigação)', juros: '1,5% ao ano', limite: 'R$ 120.000,00', prazo: '10 anos', carencia: '3 anos' },
      { id: 'demais-150', nome: 'Renda menor que R$ 150 mil — demais finalidades', juros: '2% ao ano', limite: 'R$ 100.000,00', prazo: '10 anos', carencia: '3 anos' },
      { id: 'demais', nome: 'Demais produtos e investimentos (renda até R$ 500 mil)', juros: '7,5% ao ano', limite: 'R$ 250.000,00 (suinocultura, avicultura, aquicultura e fruticultura: R$ 450.000,00)', prazo: '10 anos', carencia: '3 anos' },
      { id: 'moradia-150', nome: 'Moradia rural — renda até R$ 150 mil', juros: '5% ao ano', limite: 'R$ 100.000,00', prazo: '10 anos', carencia: '3 anos' },
    ],
    documentos: DOCS_PRONAF_INVEST,
  },
  {
    id: 'pronaf-jovem',
    nome: 'Pronaf Jovem',
    grupo: 'Pronaf',
    finalidade: 'Investimento',
    publico: 'Jovem de 16 a 29 anos que cumpra os requisitos do MCR 10-10 (mesmas finalidades do Mais Alimentos)',
    juros: '2% ao ano', limite: 'R$ 50.000,00 (conforme capacidade de pagamento)', prazo: '10 anos', carencia: '3 anos',
    documentos: [...DOCS_PRONAF_INVEST, 'Comprovante de curso/formação exigido pelo MCR 10-10 (ou orientação técnica)'],
  },
  {
    id: 'pronaf-agroecologia',
    nome: 'Pronaf Agroecologia',
    grupo: 'Pronaf',
    finalidade: 'Investimento',
    publico: RENDA_V + ', com produção orgânica certificada ou projeto sem adubo químico de alta solubilidade, agrotóxico (exceto biológicos) e transgênicos',
    juros: '2% ao ano', limite: 'R$ 250.000,00 ou R$ 450.000,00', prazo: '5 a 10 anos', carencia: '1 a 3 anos',
    documentos: [...DOCS_PRONAF_INVEST, 'Certificado orgânico ou plano de transição agroecológica'],
  },
  {
    id: 'pronaf-bioeconomia',
    nome: 'Pronaf Bioeconomia',
    grupo: 'Pronaf',
    finalidade: 'Investimento',
    publico: RENDA_V,
    juros: '2% a 7,5% ao ano, conforme o item', limite: 'R$ 250.000,00', prazo: 'Até 16 anos', carencia: 'Até 8 anos',
    faixas: [
      { id: 'geral', nome: 'Energia renovável, sociobiodiversidade, regularização ambiental, viveiros, turismo rural, bioinsumos, conservação de solo e água, irrigação', juros: '2% ao ano', limite: 'R$ 250.000,00', prazo: '10 anos', carencia: '5 anos' },
      { id: 'saf', nome: 'Sistemas agroflorestais', juros: '2% ao ano', prazo: 'Até 16 anos', carencia: 'Até 8 anos' },
      { id: 'silvicultura', nome: 'Silvicultura', juros: '7,5% ao ano', prazo: 'Até 16 anos', carencia: 'Até 8 anos' },
    ],
    documentos: DOCS_PRONAF_INVEST,
  },
  {
    id: 'pronaf-floresta',
    nome: 'Pronaf Floresta',
    grupo: 'Pronaf',
    finalidade: 'Investimento',
    publico: RENDA_V,
    juros: '2% ao ano', limite: 'R$ 45.000,00 a R$ 110.000,00', prazo: '12 a 20 anos', carencia: '8 a 12 anos',
    faixas: [
      { id: 'saf', nome: 'Sistemas agroflorestais', juros: '2% ao ano', limite: 'R$ 110.000,00', prazo: '20 anos', carencia: '12 anos' },
      { id: 'recuperacao', nome: 'Extrativismo sustentável, recomposição de APP e reserva legal, recuperação de áreas degradadas, frutíferas nativas', juros: '2% ao ano', limite: 'R$ 45.000,00', prazo: '12 anos', carencia: '8 anos' },
      { id: 'maquinas-150', nome: 'Renda menor que R$ 150 mil — máquinas e equipamentos da linha', juros: '2% ao ano', limite: 'R$ 60.000,00', prazo: '12 anos', carencia: '8 anos' },
    ],
    documentos: DOCS_PRONAF_INVEST,
  },
  {
    id: 'pronaf-semiarido',
    nome: 'Pronaf Adaptação Climática e Semiárido',
    grupo: 'Pronaf',
    finalidade: 'Investimento',
    publico: RENDA_V,
    juros: '2% ao ano', limite: 'R$ 45.000,00 a R$ 60.000,00', prazo: '10 anos', carencia: '3 a 5 anos',
    faixas: [
      { id: 'maquinas-150', nome: 'Renda até R$ 150 mil — máquinas, equipamentos e sistema de irrigação', juros: '2% ao ano', limite: 'R$ 60.000,00', prazo: '10 anos', carencia: '3 a 5 anos' },
      { id: 'convivencia', nome: 'Projetos de convivência com o Semiárido (infraestrutura produtiva)', juros: '2% ao ano', limite: 'R$ 45.000,00', prazo: '10 anos', carencia: '3 a 5 anos' },
    ],
    documentos: DOCS_PRONAF_INVEST,
  },
  {
    id: 'pronaf-produtivo-orientado',
    nome: 'Pronaf Produtivo Orientado',
    grupo: 'Pronaf',
    finalidade: 'Investimento',
    publico: RENDA_V + ', em município da área do FNE, FNO ou FCO',
    juros: '2% ao ano', limite: 'Mínimo R$ 25.000,00 / máximo R$ 60.000,00', prazo: '10 anos', carencia: '3 anos',
    bonus: 'R$ 4.500,00 a R$ 6.000,00 para assistência técnica',
    documentos: DOCS_PRONAF_INVEST,
  },
  {
    id: 'pronaf-agroindustria',
    nome: 'Pronaf Agroindústria',
    grupo: 'Pronaf',
    finalidade: 'Investimento',
    publico: RENDA_V + ' (pessoa física ou empreendimento familiar rural)',
    juros: '7,5% ao ano', limite: 'Pessoa física R$ 210.000,00; empreendimento familiar R$ 450.000,00',
    prazo: '10 anos (caminhonetes: 5 anos)', carencia: '3 anos (caminhonetes: 1 ano)',
    documentos: [...DOCS_PRONAF_INVEST, 'Licenças sanitária e ambiental da agroindústria, quando exigidas'],
  },
  {
    id: 'pronaf-industrializacao',
    nome: 'Pronaf Industrialização',
    grupo: 'Pronaf',
    finalidade: 'Custeio',
    publico: RENDA_V + ' (pessoa física ou empreendimento familiar rural)',
    juros: '7,5% ao ano', limite: 'Pessoa física R$ 75.000,00; empreendimento familiar R$ 250.000,00', prazo: '1 ano', carencia: '—',
    documentos: [DOC_CAF, ...DOCS_BASE, ...DOCS_IMOVEL, 'Plano de custeio do beneficiamento/industrialização'],
  },
  // ----------------------------------------------------------------- PRONAMP
  {
    id: 'pronamp-custeio',
    nome: 'Pronamp — Custeio',
    grupo: 'Pronamp',
    finalidade: 'Custeio',
    publico: 'Médio produtor rural com renda bruta anual de até R$ 3.500.000,00 (mín. 80% da renda vinda da atividade rural)',
    juros: '9% ao ano (prefixado)', limite: 'R$ 1.500.000,00 por ano agrícola', prazo: 'Conforme o ciclo da cultura/criação', carencia: 'Pagamento após a colheita/venda',
    documentos: [...DOCS_BASE, ...DOCS_IMOVEL, 'Comprovação de renda bruta agropecuária (IR, notas de venda ou declaração)', DOC_PLANO_CUSTEIO],
  },
  {
    id: 'pronamp-investimento',
    nome: 'Pronamp — Investimento',
    grupo: 'Pronamp',
    finalidade: 'Investimento',
    publico: 'Médio produtor rural com renda bruta anual de até R$ 3.500.000,00 (mín. 80% da renda vinda da atividade rural)',
    juros: '9% ao ano (prefixado)', limite: 'Consultar o banco', prazo: 'Até 8 anos', carencia: 'Até 3 anos',
    documentos: [...DOCS_BASE, ...DOCS_IMOVEL, 'Comprovação de renda bruta agropecuária (IR, notas de venda ou declaração)', ...DOCS_ORCAMENTO, DOC_PROJETO],
  },
  // ------------------------------------------------------- DEMAIS PRODUTORES
  {
    id: 'custeio-demais',
    nome: 'Custeio Rural (demais produtores)',
    grupo: 'Demais produtores',
    finalidade: 'Custeio',
    publico: 'Produtor rural fora do Pronaf e do Pronamp (recursos controlados)',
    juros: '12,5% ao ano', limite: 'Consultar o banco', prazo: 'Conforme o ciclo da cultura/criação', carencia: 'Pagamento após a colheita/venda',
    documentos: [...DOCS_BASE, ...DOCS_IMOVEL, 'Comprovação de renda (IR ou notas de venda)', DOC_PLANO_CUSTEIO],
  },
  {
    id: 'investimento-demais',
    nome: 'Investimento Rural (demais produtores)',
    grupo: 'Demais produtores',
    finalidade: 'Investimento',
    publico: 'Produtor rural fora do Pronaf e do Pronamp',
    juros: '8% a 12,5% ao ano, conforme a linha', limite: 'Conforme a linha', prazo: 'Conforme a linha', carencia: 'Conforme a linha',
    faixas: [
      { id: 'pca-12mil', nome: 'PCA — armazéns de até 12 mil toneladas', juros: '8% ao ano' },
      { id: 'renovagro-ambiental', nome: 'RenovAgro Ambiental / recuperação de pastagens', juros: '8,5% ao ano', prazo: 'Até 12 anos' },
      { id: 'renovagro', nome: 'RenovAgro e PCA (demais)', juros: '9,5% ao ano', prazo: 'Até 12 anos' },
      { id: 'inovagro', nome: 'Inovagro', juros: '11,5% ao ano', limite: 'R$ 4.000.000,00 (individual)', prazo: 'Até 10 anos' },
      { id: 'proirriga', nome: 'Proirriga (irrigação)', juros: '11,5% ao ano', limite: 'R$ 3.500.000,00 (individual)', prazo: 'Até 8 anos' },
      { id: 'moderfrota-pronamp', nome: 'Moderfrota (médio produtor)', juros: '11,5% ao ano' },
      { id: 'investimento-empresarial', nome: 'Investimento empresarial (recursos controlados)', juros: '11,5% ao ano' },
      { id: 'moderfrota', nome: 'Moderfrota (demais)', juros: '12,5% ao ano' },
    ],
    documentos: [...DOCS_BASE, ...DOCS_IMOVEL, 'Comprovação de renda (IR ou notas de venda)', ...DOCS_ORCAMENTO, DOC_PROJETO, 'Licença/outorga ambiental, quando exigida (ex.: irrigação)'],
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

// Ids usados numa versão anterior do catálogo (mesmo dia) → ids atuais.
const LEGACY_IDS: Record<string, string> = {
  'pronaf-v-custeio': 'pronaf-custeio',
  'pronaf-v-investimento': 'pronaf-mais-alimentos',
};

export function findCreditProgram(id?: string): CreditProgram | undefined {
  if (!id) return undefined;
  const real = LEGACY_IDS[id] || id;
  return CREDIT_PROGRAMS.find(p => p.id === real);
}

export function findFaixa(program?: CreditProgram, faixaId?: string): CreditFaixa | undefined {
  return program?.faixas?.find(f => f.id === faixaId);
}

/** Condições efetivas: as da faixa escolhida (quando houver) por cima das do programa. */
export function creditConditions(program: CreditProgram, faixaId?: string): CreditConditions {
  const f = findFaixa(program, faixaId);
  return {
    juros: f?.juros || program.juros,
    limite: f?.limite || program.limite,
    prazo: f?.prazo || program.prazo,
    carencia: f?.carencia || program.carencia,
    bonus: program.bonus,
  };
}
