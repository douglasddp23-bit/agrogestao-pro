import path from 'path';
import dotenv from 'dotenv';

// Fora do AI Studio (rodando local ou empacotado no Electron) ninguém injeta
// as variáveis de ambiente automaticamente — carregamos do .env.local aqui.
// Usamos process.cwd() (não __dirname) porque, depois de empacotado pelo
// esbuild/electron, este arquivo pode rodar de dentro de dist/, mas o
// processo é sempre iniciado com cwd apontando para a raiz do app.
dotenv.config({ path: path.join(process.cwd(), '.env.local') });
dotenv.config({ path: path.join(process.cwd(), '.env') });

import express from 'express';
import { createServer as createViteServer } from 'vite';
import admin from 'firebase-admin';
import fs from 'fs';
import authRoutes from './backend/routes/authRoutes';
import { refreshUserClaim } from './backend/controllers/authController';
import { GoogleGenAI } from '@google/genai';
import { requireAuth } from './backend/middlewares/authMiddleware';
import { sendNewAppointmentEmail, sendExpiringContractsDigestEmail, sendAlertEmail } from './backend/services/mailService';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import cron from 'node-cron';
import { runBackupIfDue } from './backend/services/backupService';

// Helper to get Gemini SDK instance dynamically on-demand with correct key
function getGeminiClient(): GoogleGenAI | null {
  const ai_key = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY;
  if (
    !ai_key ||
    ai_key === 'MY_GEMINI_API_KEY' ||
    ai_key === 'undefined' ||
    ai_key.includes('PLACEHOLDER') ||
    ai_key.trim() === ''
  ) {
    return null;
  }
  return new GoogleGenAI({
    apiKey: ai_key,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      }
    }
  });
}

function getOfflineChatResponse(userQuery: string, res: express.Response) {
  const q = (userQuery || "").toLowerCase();
  let responseMessage = "";

  if (q.includes("solo") || q.includes("terra") || q.includes("fertil") || q.includes("acidez") || q.includes("calcario")) {
    responseMessage = `### Análise Técnica Nutricional e Correção de Solo (Modo Consultivo)

Baseado no contexto relatado de solo e preparo da terra do produtor, seguem as principais recomendações agronômicas recomendadas:
1. **Calagem e Neutralização do Alumínio**: Recomenda-se a amostragem de solo de 0-20 cm e 20-40 cm. Se a saturação por bases (V%) for inferior a 60% para grandes culturas, aplicar calcário dolomítico para suprir cálcio e magnésio.
2. **Equilíbrio NPK**: Focar na adubação de fundação fosfatada (superfosfato simples ou MAP) de acordo com a produtividade esperada, evitando estresses hídricos iniciais.
3. **Pós-análise e Gessagem**: Caso a saturação por alumínio exceda os níveis tolerados em profundidade, a gessagem agrícola melhorará o sistema radicular para buscar água em maiores profundidades.

*Este é um panorama teórico baseado no histórico de práticas sustentáveis do Cerrado.*`;
  } else if (q.includes("praga") || q.includes("doença") || q.includes("lagarta") || q.includes("percevejo") || q.includes("ferrugem") || q.includes("defensivo")) {
    responseMessage = `### Monitoramento Fitossanitário e Manejo Integrado de Pragas (MIP)

Observando as preocupações fitossanitárias levantadas na lavoura, as melhores práticas de salvaguarda operacional são:
1. **Manejo Integrado de Pragas (MIP)**: Monitorar semanalmente a lavoura (pano-de-batida para soja e milho). Entrar com controle químico ou biológico apenas se atingir o Nível de Controle técnico estabelecido.
2. **Refúgio Agronômico**: Utilizar áreas de refúgio estruturado com sementes não-Bt nas proporções corretas para evitar a quebra de resistência de tecnologias biotecnológicas.
3. **Intervalo de Segurança (Carência)**: Atentar rigorosamente ao bico do pulverizador e às condições de vento superiores a 10 km/h para evitar derivas e contaminações.`;
  } else if (q.includes("financeiro") || q.includes("caixa") || q.includes("receita") || q.includes("lucro") || q.includes("gasto")) {
    responseMessage = `### Diagnóstico de Saúde Financeira e Fluxo de Caixa

Com base em um diagnóstico fiscal simplificado da carteira do produtor:
1. **Gestão de Custos de Insumos**: A compra planejada de defensivos e sementes nas janelas de pré-safra pode reduzir o custo total em até 15%.
2. **Preparo para Volatilidade**: Recomenda-se realizar operações de *hedging* ou venda futura de lotes de grãos in Chicago (CBOT) para fixar a margem mínima de lucro necessária à operação produtiva.
3. **Equilíbrio de Ativos**: Manter reservas para perdas climáticas sazonais assegura estabilidade da operação, evitando contrair juros rotativos de alta taxa.`;
  } else {
    responseMessage = `### Parecer Agronômico Consolidado — AgroGestão Pro

Olá! Como seu assistente corporativo de agronegócios **AgroGestor AI**, analisei as dores relatadas em seus talhões e indicadores gerais de fazenda:
- **Planejamento de Safras**: Mantenha o escalonamento do plantio atualizado para evitar gargalos na frota agrícola de colhedoras.
- **Eficiência Hídrica**: Verifique o tensionamento hídrico dos pivôs de irrigação apenas em horários de pico  energético reduzido para otimizar os custos com energia elétrica de campo.
- **Rastreabilidade Cadastral**: A correta validação do CAR e do Georreferenciamento elimina impedimentos na tomada de crédito bancário agrícola subsidiado Plano Safra.

Estou de prontidão para ajudar com laudos avançados ou estratégias táticas de fertilização!`;
  }

  return res.json({ text: responseMessage });
}


// Initialize Firebase Admin safely
const configPath = path.join(process.cwd(), 'firebase-applet-config.json');
const envProjectId = process.env.FIREBASE_PROJECT_ID;
const envDatabaseId = process.env.FIREBASE_DATABASE_ID;

if (admin.apps.length === 0) {
  // Aceita tanto FIREBASE_PROJECT_ID (override de servidor) quanto
  // VITE_FIREBASE_PROJECT_ID (o mesmo valor que o front-end usa, preenchido
  // no .env.local) — sem isso, fora do AI Studio o servidor não sabia qual
  // projeto usar e caía num nome fixo errado ("agrogestao-pro").
  let projectId = envProjectId || process.env.VITE_FIREBASE_PROJECT_ID;
  let databaseId = envDatabaseId || process.env.VITE_FIREBASE_DATABASE_ID;

  if (!projectId && fs.existsSync(configPath)) {
    try {
      const firebaseConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      projectId = firebaseConfig.projectId;
      databaseId = databaseId || firebaseConfig.firestoreDatabaseId;
    } catch (err) {
      console.warn('[Firebase Admin Config Load Warning]', err);
    }
  }

  // Se existir um service-account.json na raiz do projeto (gerado no
  // Firebase Console → Configurações → Contas de serviço), usamos ele pra
  // dar credenciais de verdade ao Admin SDK. Sem isso, o Admin SDK roda
  // "sem login" — o que faz toda leitura/escrita no Firestore falhar
  // silenciosamente fora de um ambiente Google (como o computador do
  // usuário), e o app cai num REST de fallback que as regras de segurança
  // corretamente bloqueiam por não vir autenticado.
  const serviceAccountPath = path.join(process.cwd(), 'service-account.json');
  let credential: admin.credential.Credential | undefined;
  if (fs.existsSync(serviceAccountPath)) {
    try {
      const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf-8'));
      credential = admin.credential.cert(serviceAccount);
      projectId = projectId || serviceAccount.project_id;
    } catch (err) {
      console.warn('[Firebase Admin] Não foi possível ler service-account.json, seguindo sem credenciais completas:', err);
    }
  }

  // Fallback project ID to guarantee Firebase Admin app is initialized
  projectId = projectId || 'agrogestao-pro';

  try {
    admin.initializeApp({
      projectId: projectId,
      ...(credential ? { credential } : {}),
    });
    if (databaseId) {
      try {
        admin.firestore().settings({ databaseId });
      } catch (settingsErr) {
        // ignore if settings already applied
      }
    }
    console.log(
      `[Firebase Admin] Inicializado com sucesso. Projeto: ${projectId}` +
      (credential ? ' (com credenciais completas via service-account.json)' : ' (modo limitado, sem service-account.json)')
    );
  } catch (initErr: any) {
    console.warn('[Firebase Admin Initialization Warning]', initErr.message || initErr);
  }
}

async function startServer() {
  const app = express();
  // O app de computador (Electron) já define AGROGESTAO_PORT; padrão 3000.
  const PORT = Number(process.env.AGROGESTAO_PORT) || 3000;

  // Set trust proxy to true (or 1) to accurately identify client IP behind reverse proxy
  app.set('trust proxy', 1);

  // Corporate security middlewares layout
  // CSP (Content Security Policy): segunda linha de defesa contra XSS — mesmo que
  // algum texto malicioso escape, o navegador só executa scripts do próprio app e
  // do login Google/Firebase. Só em produção (o modo de desenvolvimento do Vite
  // injeta scripts próprios).
  const isProdServer = process.env.NODE_ENV === 'production';
  app.use(helmet({
    contentSecurityPolicy: isProdServer ? {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", 'https://apis.google.com', 'https://www.gstatic.com', 'https://*.firebaseapp.com'],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'data:', 'https://fonts.gstatic.com'],
        imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
        connectSrc: [
          "'self'", 'https:', 'wss:', 'data:', 'blob:',
          // Só nos testes automáticos com o Firebase Emulator (banco de teste local)
          ...(process.env.FIRESTORE_EMULATOR_HOST || process.env.FIREBASE_AUTH_EMULATOR_HOST
            ? ['http://127.0.0.1:9099', 'http://127.0.0.1:8080', 'ws://127.0.0.1:8080']
            : []),
        ],
        frameSrc: ["'self'", 'blob:', 'https://*.firebaseapp.com', 'https://accounts.google.com', 'https://apis.google.com'],
        workerSrc: ["'self'", 'blob:'],
        childSrc: ["'self'", 'blob:'],
        mediaSrc: ["'self'", 'blob:', 'data:'],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'self'"],
      },
    } : false,
    crossOriginEmbedderPolicy: false,
    // Pop-up de login do Google precisa conversar com a janela do app
    crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
  }));
  // SEGURANÇA: antes "origin: true" aceitava pedidos de QUALQUER site aberto no
  // navegador. Agora só a origem do próprio app (e APP_URL, se o sistema for
  // publicado na internet). Autenticação é por token no cabeçalho (sem cookies),
  // então não há CSRF — mas mesmo assim não há razão para liberar outros sites.
  const allowedOrigins = [
    `http://localhost:${PORT}`,
    `http://127.0.0.1:${PORT}`,
    ...(process.env.APP_URL && /^https?:\/\//.test(process.env.APP_URL) ? [process.env.APP_URL.replace(/\/+$/, '')] : []),
  ];
  app.use(cors({
    origin: (origin, callback) => {
      // Sem "Origin" = chamada do próprio app (mesma origem) ou do Electron
      if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
      return callback(null, false);
    },
    credentials: false
  }));
  app.use(express.json({ limit: '200kb' }));

  // Limites por usuário (ou IP) contra abuso de rotas que custam dinheiro (IA)
  // ou que falam com o mundo externo (e-mail/WhatsApp em nome da empresa).
  const perUserKey = (req: any) => {
    const auth = String(req.headers.authorization || '');
    return auth ? auth.slice(-24) : String(req.ip);
  };
  const aiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, max: 40, standardHeaders: true, legacyHeaders: false, validate: false,
    keyGenerator: perUserKey,
    message: { error: 'Muitas consultas à IA em pouco tempo. Aguarde alguns minutos.' },
  });
  const outboundLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false, validate: false,
    keyGenerator: perUserKey,
    message: { error: 'Limite de envios por hora atingido. Tente novamente mais tarde.' },
  });
  app.use('/api/ai', aiLimiter);
  app.use('/api/alerts', outboundLimiter);

  // In-memory storage as requested
  let dados: any[] = [];
  
  // Simulated PostGIS Database Tables
  let db_tables = {
    users: [] as any[],
    propriedades: [] as any[],
    desmatamento: [] as any[],
    embargos: [] as any[],
    car: [
      { id: 1, codigo_car: 'MT-5103403-E5E6.7A9E.8F8D.4B8C.A9E8.F8D4.B8CA', geom: { type: 'Polygon', coordinates: [[[-55.5, -12.5], [-55.4, -12.5], [-55.4, -12.6], [-55.5, -12.6], [-55.5, -12.5]]] } },
      { id: 2, codigo_car: 'MG-3101705-1234.5678.90AB.CDEF.1234.5678.90AB', geom: { type: 'Polygon', coordinates: [[[-44.5, -18.2], [-44.2, -18.2], [-44.2, -18.0], [-44.5, -18.0], [-44.5, -18.2]]] } }
    ] as any[],
    sigef: [] as any[],
    analises: [] as any[]
  };

  // Modular Enterprise Security & Admin Routes
  app.use('/api', authRoutes);

  // Secure Server-Side Gemini endpoint
  app.post('/api/ai/news', requireAuth, async (req, res) => {
    try {
      const prompt = req.body.query || "Gere 4 manchetes curtas e impactantes sobre o mercado agrícola brasileiro hoje (soja, milho, gado, clima). Retorne apenas um JSON array de objetos com keys 'title' e 'source'. Ex: [{'title': 'Preço da soja sobe em Chicago', 'source': 'Reuters'}]. Seja profissional e focado em inteligência de mercado.";

      const aiInstance = getGeminiClient();
      if (!aiInstance) {
        // Sem chave válida ou registrada. Carregar e retornar o painel de feed agrícola do AgroGestão Pro
        const fallbackNews = [
          { "title": "Preço da soja consolida estabilidade frente à alta demanda global em Chicago", "source": "Cepea/Esalq" },
          { "title": "Clima favorável acelera a colheita da safrinha de milho no Centro-Oeste brasileiro", "source": "Inmet" },
          { "title": "Boi gordo mantém tendência de alta impulsionado pelas exportações recordes para Ásia", "source": "Reuters Brasil" },
          { "title": "BNDES anuncia novas linhas de crédito subsidiado para agricultura sustentável", "source": "Valor Econômico" }
        ];
        return res.json({ text: JSON.stringify(fallbackNews) });
      }

      const result = await aiInstance.models.generateContent({
        model: "gemini-2.0-flash",
        contents: prompt,
        config: {
          responseMimeType: "application/json"
        }
      });

      res.json({ text: result.text });
    } catch (error: any) {
      const isQuota = (error && error.status === 429) || (error.message && String(error.message).includes('429')) || (error.message && String(error.message).includes('Quota'));
      if (isQuota) {
        console.log('Aviso: Limite de cota (429) do Gemini atingido ao obter notícias. Retornando feed offline da AgroGestão.');
      } else {
        console.log('Aviso: Erro de conexão com o Gemini ao obter notícias. Retornando feed offline da AgroGestão.');
      }
      const fallbackNews = [
        { "title": "Preço da soja consolida estabilidade frente à alta demanda global em Chicago", "source": "Cepea/Esalq" },
        { "title": "Clima favorável aceita a colheita da safrinha de milho no Centro-Oeste brasileiro", "source": "Inmet" },
        { "title": "Boi gordo mantém tendência de alta impulsionado pelas exportações recordes para Ásia", "source": "Reuters Brasil" },
        { "title": "BNDES anuncia novas linhas de crédito subsidiado para agricultura sustentável", "source": "Valor Econômico" }
      ];
      res.json({ text: JSON.stringify(fallbackNews) });
    }
  });

  // Secure Server-Side Gemini endpoint to generate custom contract draft (minuta)
  app.post('/api/ai/generate-minuta', requireAuth, async (req, res) => {
    const { clientName, value, startDate, endDate, category, standardClauses, customGuidelines } = req.body;
    
    try {
      const aiInstance = getGeminiClient();
      if (!aiInstance) {
        const offlineMinuta = `### MINUTA DE CONTRATO PRESTACIONAL (GERADO EM MODO OFFLINE)
        
**CONTRATANTE:** ${clientName || '[Nome do Cliente]'}
**VALOR DO CONTRATO:** R$ ${(value || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
**VIGÊNCIA:** De ${startDate || '[Data de Início]'} a ${endDate || '[Data de Fim]'}
**CATEGORIA:** ${category || 'Prestação de Serviços Agrícolas'}

#### CLÁUSULAS CONVENCIONAIS:
1. **Do Objeto:** O presente instrumento tem por objeto a prestação de serviços de assessoramento agronômico especializado, focado em ${category || 'gestão de safras e talhões'}.
2. **Do Pagamento:** O valor total contratual é de R$ ${(value || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}, a ser pago em parcelas acordadas entre as partes.
3. **Direitos e Deveres:** O CONTRATADO obriga-se a prestar assistência técnica e relatórios periódicos, ao passo que o CONTRATANTE compromete-se a fornecer livre acesso à propriedade e insumos básicos.
4. **Resolução de Conflitos:** Fica eleito o foro da comarca da sede do contratante para dirimir eventuais dúvidas ou controvérsias judiciais decorrentes do presente termo.

*Nota do Sistema: Configure a chave de API Gemini (Settings > Secrets) para obter a geração com IA avançada.*`;
        return res.json({ text: offlineMinuta });
      }

      const systemInstruction = `Você é o AgroGestor AI, um assistente jurídico-agronômico sênior integrado ao AgroGestão Pro.
Sua missão é gerar minutas de contrato personalizadas e profissionais, claras e juridicamente estruturadas em português do Brasil para o mercado de agronegócios.
A minuta deve ter formato de contrato formal brasileiro (com qualificações de Contratante e Contratado, cláusulas numeradas, foro, local e data).
Seja preciso, adote um tom formal e profissional. Use formatação Markdown limpa e amigável.`;

      const prompt = `Gere uma minuta detalhada e formal de contrato de agronegócios baseada nos seguintes dados fornecidos:

DADOS DO CONTRATO:
- Nome do Cliente (Contratante): ${clientName || 'Cliente Indefinido'}
- Categoria / Objeto do Serviço: ${category || 'Prestação de Serviços Agrícolas em Geral'}
- Valor Total do Contrato: R$ ${(value || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
- Período de Vigência: ${startDate || 'não especificado'} até ${endDate || 'não especificado'}

CLÁUSULAS PADRÃO COMO BASE:
${standardClauses || '1. Prestação de Serviços Agronômicos sob demanda.\n2. Pagamento do valor acordado nas datas previstas.'}

DIRETRIZES PERSONALIZADAS DO USUÁRIO (REQUISITOS ADICIONAIS):
"${customGuidelines || 'Nenhum requisito adicional fornecido.'}"

Por favor, seja direto, utilize formatação Markdown elegante. Vá diretamente à minuta do contrato pois ela será copiada/inserida diretamente na seção de termos do contrato.`;

      const result = await aiInstance.models.generateContent({
        model: "gemini-3.5-flash",
        contents: prompt,
        config: {
          systemInstruction: systemInstruction,
        }
      });

      res.json({ text: result.text });
    } catch (error: any) {
      console.error('Erro ao gerar minuta por IA:', error);
      const offlineMinuta = `### MINUTA DE CONTRATO PRESTACIONAL (FALHA DE CONEXÃO COM IA)
        
**CONTRATANTE:** ${clientName || '[Nome do Cliente]'}
**VALOR DO CONTRATO:** R$ ${(value || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
**VIGÊNCIA:** De ${startDate || '[Data de Início]'} a ${endDate || '[Data de Fim]'}
**CATEGORIA:** ${category || 'Prestação de Serviços Agrícolas'}

#### CLÁUSULAS CONVENCIONAIS:
1. **Do Objeto:** O presente instrumento tem por objeto a prestação de serviços de assessoramento agronômico especializado, focado em ${category || 'gestão de safras e talhões'}.
2. **Do Pagamento:** O valor total contratual é de R$ ${(value || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}, a ser pago em parcelas acordadas entre as partes.

*Nota do Sistema: Ocorreu um erro temporário ao conectar-se ao Gemini. Exibindo minuta offline.*`;
      res.json({ text: offlineMinuta });
    }
  });

  // Secure Server-Side Gemini endpoint for Reports Consulting Chatbot
  app.post('/api/ai/reports-chat', requireAuth, async (req, res) => {
    try {
      const { query: userQuery, contextString } = req.body;
      if (!userQuery) {
        return res.status(400).json({ error: 'A pergunta (query) é obrigatória.' });
      }

      const aiInstance = getGeminiClient();
      if (!aiInstance) {
        return getOfflineChatResponse(userQuery, res);
      }

      const systemInstruction = `Você é o AgroGestor AI, um assistente virtual e consultor agronômico sênior integrado ao AgroGestão Pro.
Sua missão é ajudar agrônomos, consultores e produtores rurais a analisarem dados de suas fazendas, sugerindo práticas agrícolas modernas, controle de pragas, calibração de irrigação e estratégias financeiras baseadas nos dados fornecidos do sistema.
Seja preciso, profissional, empático e de alta confiabilidade técnica. Use formatação markdown limpa.`;

      const prompt = `Instruções Adicionais: Utilize os dados do sistema fornecidos abaixo como contexto para responder a pergunta do usuário. Se a pergunta for geral sobre agronomia, sinta-se à vontade para expandir com seu conhecimento especialista.

DADOS DE CONTEXTO DO SISTEMA:
${contextString || 'Nenhum dado cadastrado atualmente.'}

PERGUNTA DO USUÁRIO:
"${userQuery}"`;

      const result = await aiInstance.models.generateContent({
        model: "gemini-2.0-flash",
        contents: prompt,
        config: {
          systemInstruction: systemInstruction,
        }
      });

      res.json({ text: result.text });
    } catch (error: any) {
      const isQuota = (error && error.status === 429) || (error.message && String(error.message).includes('429')) || (error.message && String(error.message).includes('Quota'));
      if (isQuota) {
        console.log('Aviso: Limite de cota (429) do Gemini atingido no chatbot consultivo. Utilizando motor agronômico offline.');
      } else {
        console.log('Aviso: Erro de conexão com o Gemini no chatbot consultivo. Utilizando motor agronômico offline.');
      }
      getOfflineChatResponse(req.body.query || "", res);
    }
  });

  const SERVER_SOIL_ELEMENTS = [
    // Acidez e pH
    { id: 'ph', label: 'pH (CaCl₂)', unit: '-' },
    { id: 'ph_h2o', label: 'pH (H₂O)', unit: '-' },
    { id: 'al', label: 'Alumínio (Al³⁺)', unit: 'cmolc/dm³' },
    { id: 'hal', label: 'Acidez Potencial (H+Al)', unit: 'cmolc/dm³' },

    // Macronutrientes
    { id: 'p', label: 'Fósforo (P)', unit: 'mg/dm³' },
    { id: 'k', label: 'Potássio (K)', unit: 'cmolc/dm³' },
    { id: 'ca', label: 'Cálcio (Ca)', unit: 'cmolc/dm³' },
    { id: 'mg', label: 'Magnésio (Mg)', unit: 'cmolc/dm³' },
    { id: 's', label: 'Enxofre (S)', unit: 'mg/dm³' },

    // Índices calculados de fertilidade
    { id: 'sb', label: 'Soma de Bases (SB)', unit: 'cmolc/dm³' },
    { id: 'ctc_efetiva', label: 'CTC Efetiva (t)', unit: 'cmolc/dm³' },
    { id: 'ctc_ph7', label: 'CTC a pH 7,0 (T)', unit: 'cmolc/dm³' },
    { id: 'v_percent', label: 'Saturação por Bases (V%)', unit: '%' },
    { id: 'm_percent', label: 'Saturação por Alumínio (m%)', unit: '%' },
    { id: 'p_rem', label: 'Fósforo Remanescente (P-rem)', unit: 'mg/L' },

    // Matéria orgânica
    { id: 'mo', label: 'Matéria Orgânica (M.O.)', unit: 'g/dm³' },

    // Micronutrientes
    { id: 'b', label: 'Boro (B)', unit: 'mg/dm³' },
    { id: 'cu', label: 'Cobre (Cu)', unit: 'mg/dm³' },
    { id: 'fe', label: 'Ferro (Fe)', unit: 'mg/dm³' },
    { id: 'mn', label: 'Manganês (Mn)', unit: 'mg/dm³' },
    { id: 'zn', label: 'Zinco (Zn)', unit: 'mg/dm³' },

    // Análise física (granulometria)
    { id: 'argila', label: 'Argila', unit: '%' },
    { id: 'silte', label: 'Silte', unit: '%' },
    { id: 'areia', label: 'Areia', unit: '%' },
  ];

  const SERVER_WATER_ELEMENTS = [
    { id: 'ph', label: 'pH', unit: '-' },
    { id: 'ce', label: 'Condutividade Elétrica (CE)', unit: 'dS/m' },
    { id: 'sdt', label: 'Sólidos Dissolvidos Totais (SDT)', unit: 'mg/L' },
    { id: 'dureza_total', label: 'Dureza Total', unit: 'mg/L CaCO₃' },

    // Cátions
    { id: 'ca', label: 'Cálcio (Ca²⁺)', unit: 'mmolc/L' },
    { id: 'mg', label: 'Magnésio (Mg²⁺)', unit: 'mmolc/L' },
    { id: 'na', label: 'Sódio (Na⁺)', unit: 'mmolc/L' },
    { id: 'k', label: 'Potássio (K⁺)', unit: 'mmolc/L' },

    // Ânions
    { id: 'hco3', label: 'Bicarbonato (HCO₃⁻)', unit: 'mmolc/L' },
    { id: 'co3', label: 'Carbonato (CO₃²⁻)', unit: 'mmolc/L' },
    { id: 'cl', label: 'Cloreto (Cl⁻)', unit: 'mmolc/L' },
    { id: 'so4', label: 'Sulfato (SO₄²⁻)', unit: 'mmolc/L' },

    // Índices de classificação (calculados ou inseridos)
    { id: 'ras', label: 'Razão de Adsorção de Sódio (RAS)', unit: '(mmol/L)^0.5' },
    { id: 'classe_salinidade', label: 'Classe de Salinidade (C1-C4)', unit: '-' },
    { id: 'classe_sodicidade', label: 'Classe de Sodicidade (S1-S4)', unit: '-' },

    // Elementos de risco
    { id: 'boro', label: 'Boro (B)', unit: 'mg/L' },
    { id: 'ferro', label: 'Ferro Total (Fe)', unit: 'mg/L' },
  ];

  const SERVER_FOLIAR_ELEMENTS = [
    // Macronutrientes (g/kg)
    { id: 'n', label: 'Nitrogênio (N)', unit: 'g/kg' },
    { id: 'p', label: 'Fósforo (P)', unit: 'g/kg' },
    { id: 'k', label: 'Potássio (K)', unit: 'g/kg' },
    { id: 'ca', label: 'Cálcio (Ca)', unit: 'g/kg' },
    { id: 'mg', label: 'Magnésio (Mg)', unit: 'g/kg' },
    { id: 's', label: 'Enxofre (S)', unit: 'g/kg' },

    // Micronutrientes (mg/kg)
    { id: 'b', label: 'Boro (B)', unit: 'mg/kg' },
    { id: 'cu', label: 'Cobre (Cu)', unit: 'mg/kg' },
    { id: 'fe', label: 'Ferro (Fe)', unit: 'mg/kg' },
    { id: 'mn', label: 'Manganês (Mn)', unit: 'mg/kg' },
    { id: 'mo', label: 'Molibdênio (Mo)', unit: 'mg/kg' },
    { id: 'zn', label: 'Zinco (Zn)', unit: 'mg/kg' },
    { id: 'co', label: 'Cobalto (Co)', unit: 'mg/kg' },
  ];

  function getOfflineSoilAnalysis(results: any) {
    const p = parseFloat(results.p || '0');
    const k = parseFloat(results.k || '0');
    const ca = parseFloat(results.ca || '0');
    const mg = parseFloat(results.mg || '0');
    const al = parseFloat(results.al || '0');
    const ph = parseFloat(results.ph || '0');
    const mo = parseFloat(results.mo || '0');

    let recommendation = `### Parecer Técnico de Análise de Solo (AgroGestão AI - Local)

Baseando-se nos índices de fertilidade e acidez declarados na amostra enviada:

#### 1. Correção da Acidez (Calagem)
`;
    if (ph > 0 && ph < 5.5) {
      recommendation += `- **Diagnóstico**: Acidez elevada detectada (pH em CaCl2 de ${ph}). Risco latente de toxidez de Alumínio ativo (Al: ${al} cmolc/dm³), o que limita severamente o desenvolvimento radicular.\n`;
      recommendation += `- **Recomendação**: Aplicar Calcário dolomítico para elevar a saturação por bases (V%) da CTC para 65-70%. Isto fornecerá Cálcio e Magnésio indispensáveis (Ca: ${ca} cmolc/dm³, Mg: ${mg} cmolc/dm³).\n`;
    } else if (ph >= 5.5 && ph <= 6.5) {
      recommendation += `- **Diagnóstico**: Acidez ativa adequada (pH em CaCl2 de ${ph}). Concentração de Alumínio em níveis controlados.\n`;
      recommendation += `- **Recomendação**: Manutenção dos níveis atuais de bases. Sem recomendação imediata de calagem rústica de correção, apenas reaplicação de manutenção se necessário.\n`;
    } else if (ph > 6.5) {
      recommendation += `- **Diagnóstico**: Solo alcalinizado ou com pH elevado (${ph}).\n`;
      recommendation += `- **Recomendação**: Evitar aplicações desnecessárias de calcário para prevenir carência de micronutrientes aniônicos ou indução de cloroses e indisponibilidade de fósforo.\n`;
    } else {
      recommendation += `- pH não especificado. Atente de forma genérica para elevar V% se estiver abaixo de 60% nas próximas amostras.\n`;
    }

    recommendation += `\n#### 2. Adubação Ideal (N-P-K)
`;
    let adubacaoCount = 0;
    if (p > 0 && p < 10) {
      recommendation += `- **Fósforo (P: ${p} mg/dm³ - Baixo)**: Demanda forte de adubação fosfatada rica de fundação. Sugere-se Fosfato Monoamônico (MAP) ou Superfosfato Simples (fornece P, Ca e S) para estimular pegamento radicular.\n`;
      adubacaoCount++;
    } else if (p >= 10 && p < 22) {
      recommendation += `- **Fósforo (P: ${p} mg/dm³ - Moderado)**: Aplicar adubação de manutenção/devolução focada em reposição do estande de plantas e exportação da safra.\n`;
      adubacaoCount++;
    }

    if (k > 0 && k < 0.15) {
      recommendation += `- **Potássio (K: ${k} cmolc/dm³ - Baixo)**: Alto risco de escassez nutritiva. Aplicar Cloreto de Potássio (KCl) parcelado em cobertura para diminuir o risco de lixiviação em solos arenosos.\n`;
      adubacaoCount++;
    } else if (k >= 0.15 && k < 0.3) {
      recommendation += `- **Potássio (K: ${k} cmolc/dm³ - Médio)**: Nutrição satisfatória. Realizar reposição habitual de manutenção para equilibrar a exportação foliar.\n`;
      adubacaoCount++;
    }

    if (adubacaoCount === 0) {
      recommendation += `- Macronutrientes P e K estão em níveis satisfatórios. Recomenda-se adubação padrão de manutenção de acordo com a produtividade esperada.\n`;
    }

    if (mo > 0 && mo < 15) {
      recommendation += `\n#### 3. Matéria Orgânica e Solo
- **M.O. Crítica (${mo} g/dm³)**: Matéria orgânica baixa. Promover adubação verde ou plantio de braquiária na entressafra para restauração biológica e preservação física da umidade.`;
    } else {
      recommendation += `\n#### 3. Conservação do Solo
- Nível de Carbono listado satisfatório (${mo || '-'} g/dm³). Manter práticas conservacionistas de rotação de culturas para incentivar microbiologia ativa.`;
    }

    return { text: recommendation };
  }

  app.post('/api/ai/analyze-soil', requireAuth, async (req, res) => {
    try {
      const { results, type } = req.body;
      if (!results || Object.keys(results).length === 0) {
        return res.status(400).json({ error: 'Os resultados da análise são obrigatórios.' });
      }

      const aiInstance = getGeminiClient();
      if (!aiInstance) {
        return res.json(getOfflineSoilAnalysis(results));
      }

      const resultsText = Object.entries(results)
        .map(([key, value]) => {
          const matchedEl = SERVER_SOIL_ELEMENTS.find(e => e.id === key) || 
                            SERVER_WATER_ELEMENTS.find(e => e.id === key) || 
                            SERVER_FOLIAR_ELEMENTS.find(e => e.id === key);
          const label = matchedEl ? matchedEl.label : key;
          const unit = matchedEl ? matchedEl.unit : '';
          return `- ${label}: ${value} ${unit}`;
        })
        .join('\n');

      const systemInstruction = `Você é o AgroGestor AI, um consultor agronômico sênior altamente qualificado em nutrição vegetal e ciência do solo brasileira.
Sua missão é dar laudos e recomendações precisas em português do Brasil para técnicos de campo e agrônomos, focando em calagem e adubação ideal. Seus pareceres serão salvos diretamente na seção de observações/descrições da análise técnico-operacional.`;

      const prompt = `Por favor, analise tecnicamente os seguintes resultados de análise de solo do tipo "${type || 'soil'}" fornecidos pelo laboratório de campo:

${resultsText}

Gere um parecer agronômico profissional, claro, objective e estruturado em português do Brasil focado em dar as melhores recomendações de:
1. **Calagem (necessidade de gesso/calcário ou neutralização de acidez/alumínio)** com base nos parâmetros inseridos (pH, Ca, Mg, Al, H+Al) se aplicável.
2. **Adubação ideal** com base nos macronutrientes do solo (P, K, etc).
3. **Manejo ou melhorias gerais do solo** (relação Ca:Mg, matéria orgânica M.O.).

Por favor, seja direto e use formatação Markdown limpa e amigável. Não adicione cabeçalhos corporativos vazios nem intros gentis como "Aqui está sua análise...". Vá direto ao parecer pois o texto será inserido em um campo de notas do sistema.`;

      const result = await aiInstance.models.generateContent({
        model: "gemini-2.0-flash",
        contents: prompt,
        config: {
          systemInstruction: systemInstruction,
        }
      });

      res.json({ text: result.text });
    } catch (error: any) {
      const isQuota = (error && error.status === 429) || (error.message && String(error.message).includes('429')) || (error.message && String(error.message).includes('Quota'));
      if (isQuota) {
        console.log('Aviso: Limite de cota (429) do Gemini atingido ao gerar laudo de solo. Retornando análise agronômica offline.');
      } else {
        console.log('Aviso: Erro de conexão com o Gemini no servidor ao gerar laudo de solo. Retornando análise agronômica offline.');
      }
      res.json(getOfflineSoilAnalysis(req.body.results || {}));
    }
  });

  // Secure Server-Side Gemini endpoint for Pest & Disease Agronomic Diagnosis
  // (Removida /api/ai/diagnose-pest: só a página Pragas e Doenças usava; página retirada em 29/09/2026.)

  // (Removidas: /api/delete-user duplicada — a oficial fica em backend/routes com checagem de cargo —
  //  e /api/buscar-car + /api/db-status, que não eram usadas e respondiam sem login.)
  // API: Envio de Alertas Técnicos de Campo via WhatsApp (Evolution API real ou Fallback dry-run)
  app.post('/api/alerts/send-whatsapp', requireAuth, async (req, res) => {
    const { phone, message } = req.body;

    const cleanPhone = String(phone || '').replace(/\D/g, '');
    // Validação: telefone BR (10 a 13 dígitos, com ou sem 55) e mensagem de tamanho razoável
    if (cleanPhone.length < 10 || cleanPhone.length > 13) {
      return res.status(400).json({ error: 'Telefone inválido.' });
    }
    if (typeof message !== 'string' || !message.trim() || message.length > 2000) {
      return res.status(400).json({ error: 'Mensagem vazia ou longa demais (máx. 2000 caracteres).' });
    }
    const apiUrl = process.env.EVOLUTION_API_URL;
    const apiKey = process.env.EVOLUTION_API_KEY;
    const instance = process.env.EVOLUTION_INSTANCE || 'main';

    if (!apiUrl || !apiKey) {
      console.log(`[DRY-RUN WHATSAPP] (Evolution API não configurada) destino ***${cleanPhone.slice(-4)}, ${String(message).length} caracteres.`);
      return res.json({ 
        success: true, 
        simulated: true, 
        message: 'Alerta WhatsApp emulado com sucesso (configure as variáveis do Evolution API no backend para disparo real).' 
      });
    }

    try {
      const targetUrl = `${apiUrl.replace(/\/+$/, '')}/message/sendText/${instance}`;
      
      const payload = {
        number: cleanPhone,
        options: {
          delay: 1000,
          presence: 'composing',
          linkPreview: false
        },
        textMessage: {
          text: message
        }
      };

      const response = await fetch(targetUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': apiKey
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Status ${response.status} - ${errText}`);
      }

      const resData = await response.json();
      console.log(`[WhatsApp] Mensagem enviada para ***${cleanPhone.slice(-4)} via Evolution API.`);
      return res.json({ 
        success: true, 
        message: 'Alerta de WhatsApp enviado com sucesso via Evolution API.', 
        data: resData 
      });
    } catch (error: any) {
      console.error('❌ Falha ao processar envio do WhatsApp via Evolution API:', error.message || error);
      return res.status(500).json({ 
        error: 'Falha ao enviar mensagem de WhatsApp pelo provedor Evolution API.',
        details: error.message 
      });
    }
  });

  // API: Disparo de Emails Agronômicos Automatizados (SMTP real ou Fallback dry-run)
  app.post('/api/alerts/send-email', requireAuth, async (req, res) => {
    const { to, subject, body } = req.body;
    
    if (!to || !subject || !body) {
      return res.status(400).json({ error: 'Parâmetros (to, subject, body) são obrigatórios.' });
    }
    // Um único destinatário com e-mail válido (impede usar o servidor para disparo em massa)
    if (typeof to !== 'string' || !/^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(to.trim()) || to.length > 200) {
      return res.status(400).json({ error: 'E-mail de destino inválido.' });
    }
    if (typeof subject !== 'string' || subject.length > 200 || typeof body !== 'string' || body.length > 5000) {
      return res.status(400).json({ error: 'Assunto ou mensagem longos demais.' });
    }

    try {
      const emailSent = await sendAlertEmail(to, subject, body);
      if (emailSent) {
        const isSimulated = !process.env.SMTP_USER || !process.env.SMTP_PASS;
        return res.json({ 
          success: true, 
          simulated: isSimulated, 
          message: isSimulated 
            ? 'Envio de e-mail emulado no console (parâmetros SMTP_USER ou SMTP_PASS ausentes).' 
            : 'E-mail de alerta agronômico enviado com sucesso via SMTP real.' 
        });
      } else {
        return res.status(500).json({ error: 'Não foi possível disparar o e-mail.' });
      }
    } catch (error: any) {
      console.error('❌ Falha no endpoint de disparo de e-mail de alerta:', error);
      return res.status(500).json({ error: error.message || 'Erro interno no servidor SMTP.' });
    }
  });

  // API: Trigger Notification (Email and Firestore)
  app.all('/api/notifications/trigger', requireAuth, async (req, res) => {
    try {
      const { type, visit, contract } = req.body || req.query || {};
      const envAdminEmail = (process.env.ADMIN_EMAIL || '').replace(/['"]/g, '').toLowerCase().trim();
      const targetAdminEmail = envAdminEmail || 'admin@agrogestao.com.br';

      if (type === 'new_appointment') {
        if (!visit) {
          return res.status(400).json({ error: 'Dados da visita não fornecidos.' });
        }
        await sendNewAppointmentEmail(targetAdminEmail, visit);
        return res.json({ success: true, message: 'E-mail de novo agendamento disparado com sucesso.' });
      }

      if (type === 'contract_expiring') {
        if (!contract) {
          return res.status(400).json({ error: 'Dados do contrato não fornecidos.' });
        }
        const contractsList = [contract];
        await sendExpiringContractsDigestEmail(targetAdminEmail, contractsList);
        return res.json({ success: true, message: 'E-mail de contrato expirando disparado com sucesso.' });
      }

      return res.status(400).json({ error: 'Tipo de notificação inválido ou parâmetros ausentes.' });
    } catch (error: any) {
      console.error('Erro ao processar trigger de notificação:', error);
      res.status(500).json({ error: error.message || 'Erro interno.' });
    }
  });

  // Shared Background Service: Check for Expiring Contracts, Licenses, Vehicles, Clients & Regularizations
  async function runDailyExpiringChecks(): Promise<any> {
    console.log('[BACKGROUND SERVICE] Iniciando verificação diária de prazos de contratos e licenças...');
    const resultSummary: any = {
      success: true,
      timestamp: new Date().toISOString(),
      contractsChecked: 0,
      contractsExpiringCount: 0,
      expiringContracts: [],
      leavesChecked: 0,
      leavesExpiringCount: 0,
      expiringLeaves: [],
      vehiclesChecked: 0,
      vehiclesExpiringCount: 0,
      expiringVehicles: [],
      clientsChecked: 0,
      clientsExpiringCount: 0,
      expiringClients: [],
      regularizationsChecked: 0,
      regularizationsExpiringCount: 0,
      expiringRegularizations: [],
      generalLicensesChecked: 0,
      generalLicensesExpiringCount: 0,
      expiringGeneralLicenses: [],
    };

    try {
      if (admin.apps.length === 0) {
        admin.initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID || 'agrogestao-pro' });
      }
      const db = admin.firestore();
      const today = new Date();

      const helperCheckAndNotify = async (
        title: string,
        message: string,
        link: string,
        type: 'info' | 'success' | 'alert' | 'warning'
      ) => {
        try {
          const recentNotifQuery = await db.collection('notifications')
            .where('title', '==', title)
            .limit(5)
            .get();
          
          let alreadyExists = false;
          recentNotifQuery.forEach(doc => {
            const data = doc.data();
            if (data.createdAt) {
              const diffTime = Date.now() - new Date(data.createdAt).getTime();
              const diffDays = diffTime / (1000 * 60 * 60 * 24);
              if (diffDays < 7) {
                alreadyExists = true;
              }
            }
          });

          if (!alreadyExists) {
            await db.collection('notifications').add({
              userId: 'all',
              title,
              message,
              type,
              read: false,
              createdAt: new Date().toISOString(),
              link
            });
            console.log(`[BACKGROUND SERVICE] Notificação gerada: "${title}"`);
          }
        } catch (err) {
          console.error(`[BACKGROUND SERVICE] Erro ao criar notificação "${title}":`, err);
        }
      };

      // Avisos só para quem precisa (valores financeiros não vão para "todos")
      const localDay = (v: any) => { const s = String(v || ''); const d = new Date(s.length === 10 ? s + 'T12:00:00' : s); return isNaN(d.getTime()) ? null : d; };
      const todayNoon = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 12);
      const daysUntil = (d: Date) => Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12).getTime() - todayNoon.getTime()) / 864e5);
      let managerIds: string[] = [];
      try {
        const mgr = await db.collection('users').where('role', 'in', ['admin', 'manager']).get();
        managerIds = mgr.docs.filter(d => !d.data().blocked).map(d => d.id);
      } catch { /* sem gestores cadastrados */ }
      const notifyUser = async (userId: string, title: string, message: string, link: string, type: string) => {
        if (!userId) return;
        try {
          const prev = await db.collection('notifications').where('userId', '==', userId).where('title', '==', title).limit(5).get();
          if (prev.docs.some(d => Date.now() - new Date(d.data().createdAt || 0).getTime() < 3 * 864e5)) return;
          await db.collection('notifications').add({ userId, title, message, type, read: false, createdAt: new Date().toISOString(), link });
        } catch (err) { console.error('[BACKGROUND SERVICE] Erro ao notificar usuário:', err); }
      };
      const notifyManagers = (title: string, message: string, link: string, type: string) =>
        Promise.all(managerIds.map(id => notifyUser(id, title, message, link, type)));

      // 1. VERIFICAR CONTRATOS (contracts)
      try {
        const contractsSnap = await db.collection('contracts').get();
        resultSummary.contractsChecked = contractsSnap.size;
        
        contractsSnap.forEach(doc => {
          const data = doc.data();
          if (data.endDate && (data.status === 'active' || data.status === 'em_elaboracao' || data.status === 'draft')) {
            const endDate = new Date(data.endDate);
            const diffTime = endDate.getTime() - today.getTime();
            const daysRemaining = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
            
            if (daysRemaining >= 0 && daysRemaining <= 30) {
              const formattedDate = endDate.toLocaleDateString('pt-BR');
              const item = {
                id: doc.id,
                clientName: data.clientName || 'Cliente não identificado',
                title: [data.contractNumber, data.category].filter(Boolean).join(' — ') || 'Contrato',
                endDate: data.endDate,
                daysRemaining,
                value: data.totalValue || data.value || 0
              };
              resultSummary.expiringContracts.push(item);
              resultSummary.contractsExpiringCount++;

              notifyManagers(
                `⚠️ Contrato Vencendo: ${data.contractNumber || data.clientName || 'Cliente'}`,
                `O contrato ${data.contractNumber || ''} (${data.category || 'serviços'}) vence em ${daysRemaining} dias (${formattedDate}).`,
                'contracts',
                'alert'
              );
            }
          }
        });

        if (resultSummary.expiringContracts.length > 0) {
          const envAdminEmail = (process.env.ADMIN_EMAIL || '').replace(/['"]/g, '').toLowerCase().trim();
          const targetAdminEmail = envAdminEmail || 'admin@agrogestao.com.br';
          await sendExpiringContractsDigestEmail(targetAdminEmail, resultSummary.expiringContracts);
          console.log(`[BACKGROUND SERVICE] Digest de e-mail enviado para ${targetAdminEmail} contendo ${resultSummary.expiringContracts.length} contratos expirando.`);
        }
      } catch (e: any) {
        console.warn('[BACKGROUND SERVICE] Erro ou coleção inexistente para contracts:', e.message);
      }

      // 2. VERIFICAR LICENÇAS / LEAVES (leaves) - Licenças de Funcionários
      try {
        const leavesSnap = await db.collection('leaves').get();
        resultSummary.leavesChecked = leavesSnap.size;
        
        leavesSnap.forEach(doc => {
          const data = doc.data();
          if (data.endDate && data.status === 'approved') {
            const endDate = new Date(data.endDate);
            const diffTime = endDate.getTime() - today.getTime();
            const daysRemaining = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
            
            if (daysRemaining >= 0 && daysRemaining <= 5) {
              const formattedDate = endDate.toLocaleDateString('pt-BR');
              const item = {
                id: doc.id,
                userName: data.userName || 'Funcionário',
                type: data.type || 'Afastamento',
                endDate: data.endDate,
                daysRemaining
              };
              resultSummary.expiringLeaves.push(item);
              resultSummary.leavesExpiringCount++;

              helperCheckAndNotify(
                `📅 Licença Terminando: ${data.userName || 'Funcionário'}`,
                `A licença (${data.type || 'Afastamento'}) expira em ${daysRemaining} dias (${formattedDate}).`,
                'hr',
                'info'
              );
            }
          }
        });
      } catch (e: any) {
        console.warn('[BACKGROUND SERVICE] Erro ou coleção inexistente para leaves:', e.message);
      }

      // 3. VERIFICAR VEÍCULOS (vehicles) - Seguros, IPVA, CRLV
      try {
        const vehiclesSnap = await db.collection('vehicles').get();
        resultSummary.vehiclesChecked = vehiclesSnap.size;
        
        vehiclesSnap.forEach(doc => {
          const data = doc.data();
          const checkExpiry = (fieldValue: string, label: string) => {
            if (fieldValue) {
              const expiryDate = new Date(fieldValue);
              const diffTime = expiryDate.getTime() - today.getTime();
              const daysRemaining = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
              if (daysRemaining >= 0 && daysRemaining <= 30) {
                const formattedDate = expiryDate.toLocaleDateString('pt-BR');
                const item = {
                  id: doc.id,
                  brand: data.brand || '',
                  model: data.model || '',
                  plate: data.plate || '',
                  field: label,
                  expiryDate: fieldValue,
                  daysRemaining
                };
                resultSummary.expiringVehicles.push(item);
                resultSummary.vehiclesExpiringCount++;

                helperCheckAndNotify(
                  `🚘 Veículo: Expirando ${label}`,
                  `O ${label} do veículo ${data.brand || ''} ${data.model || ''} (${data.plate || 'S/Placa'}) vence em ${daysRemaining} dias (${formattedDate}).`,
                  'vehicles',
                  'warning'
                );
              }
            }
          };

          checkExpiry(data.insuranceExpiry, 'Seguro');
          checkExpiry(data.ipvaExpiry, 'IPVA');
          checkExpiry(data.crlvExpiry, 'CRLV');
        });
      } catch (e: any) {
        console.warn('[BACKGROUND SERVICE] Erro ou coleção inexistente para vehicles:', e.message);
      }

      // 4. VERIFICAR CADASTRO DE PRODUTORES (clients) - registrationExpiredAt
      try {
        const clientsSnap = await db.collection('clients').get();
        resultSummary.clientsChecked = clientsSnap.size;
        
        clientsSnap.forEach(doc => {
          const data = doc.data();
          if (data.registrationExpiredAt) {
            const expDate = new Date(data.registrationExpiredAt);
            const diffTime = expDate.getTime() - today.getTime();
            const daysRemaining = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
            if (daysRemaining >= 0 && daysRemaining <= 30) {
              const formattedDate = expDate.toLocaleDateString('pt-BR');
              const item = {
                id: doc.id,
                name: data.name || 'Produtor',
                registrationExpiredAt: data.registrationExpiredAt,
                daysRemaining
              };
              resultSummary.expiringClients.push(item);
              resultSummary.clientsExpiringCount++;

              helperCheckAndNotify(
                `👥 Cadastro Expirando: ${data.name || 'Produtor'}`,
                `O cadastro rural do produtor ${data.name} expira em ${daysRemaining} dias (${formattedDate}).`,
                'clients',
                'warning'
              );
            }
          }
        });
      } catch (e: any) {
        console.warn('[BACKGROUND SERVICE] Erro ou coleção inexistente para clients:', e.message);
      }

      // 5. VERIFICAR REGULARIZAÇÕES (regularization_services) - scheduledDate
      try {
        const servicesSnap = await db.collection('regularization_services').get();
        resultSummary.regularizationsChecked = servicesSnap.size;
        
        servicesSnap.forEach(doc => {
          const data = doc.data();
          const prazo = data.deadline || data.scheduledDate;
          if (prazo && data.status !== 'Concluido') {
            const scheduledDate = new Date(String(prazo).length === 10 ? prazo + 'T12:00:00' : prazo);
            const daysRemaining = daysUntil(scheduledDate);
            if (daysRemaining >= 0 && daysRemaining <= 15) {
              const formattedDate = scheduledDate.toLocaleDateString('pt-BR');
              const item = {
                id: doc.id,
                clientName: data.clientName || 'Cliente',
                propertyName: data.propertyName || 'Propriedade',
                scheduledDate: data.scheduledDate,
                daysRemaining
              };
              resultSummary.expiringRegularizations.push(item);
              resultSummary.regularizationsExpiringCount++;

              helperCheckAndNotify(
                `⚠️ Prazo de Regularização: ${data.internalProtocol || data.clientName || 'Cliente'}`,
                `${data.deadline ? 'O prazo legal' : 'A data prevista'} do protocolo ${data.internalProtocol || ''} (${data.clientName}${data.organ ? ' — ' + data.organ : ''}) é ${formattedDate} (${daysRemaining} dias restantes).`,
                'analysis_documentation',
                'warning'
              );
            }
          }
        });
      } catch (e: any) {
        console.warn('[BACKGROUND SERVICE] Erro ou coleção inexistente para regularization_services:', e.message);
      }

      // 6. VERIFICAR LICENÇAS AMBIENTAIS GERAIS (licenses / environmental_licenses)
      const generalLicenseCollections = ['licenses', 'environmental_licenses'];
      for (const coll of generalLicenseCollections) {
        try {
          const snap = await db.collection(coll).get();
          resultSummary.generalLicensesChecked += snap.size;
          
          snap.forEach(doc => {
            const data = doc.data();
            const expDateVal = data.endDate || data.expiryDate || data.validityDate;
            if (expDateVal) {
              const expDate = new Date(expDateVal);
              const diffTime = expDate.getTime() - today.getTime();
              const daysRemaining = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
              if (daysRemaining >= 0 && daysRemaining <= 30) {
                const formattedDate = expDate.toLocaleDateString('pt-BR');
                const item = {
                  id: doc.id,
                  collection: coll,
                  name: data.name || data.title || 'Licença de Uso',
                  clientName: data.clientName || 'Imóvel',
                  expiryDate: expDateVal,
                  daysRemaining
                };
                resultSummary.expiringGeneralLicenses.push(item);
                resultSummary.generalLicensesExpiringCount++;

                helperCheckAndNotify(
                  `🌱 Licença Ambiental Expirando: ${data.clientName || 'Imóvel'}`,
                  `A licença "${data.name || data.title || 'Licença de Uso'}" vence em ${daysRemaining} dias (${formattedDate}).`,
                  'analysis_documentation',
                  'alert'
                );
              }
            }
          });
        } catch (e: any) {
          // Ignorar silencioso
        }
      }

      // 7. LAUDOS PERICIAIS com prazo de entrega em até 10 dias (ou vencido)
      try {
        const snap = await db.collection('judicial_expertises').get();
        for (const doc of snap.docs) {
          const e = doc.data();
          const d = localDay(e.laudoDeadline);
          if (!d || e.status !== 'ativo' || e.laudoStatus === 'entregue') continue;
          const n = daysUntil(d);
          if (n > 10) continue;
          const title = n < 0 ? `⚖️ Laudo pericial ATRASADO: ${e.processNumber || ''}` : `⚖️ Prazo de laudo pericial: ${e.processNumber || ''}`;
          const msg = n < 0 ? `O prazo do laudo (${d.toLocaleDateString('pt-BR')}) venceu há ${-n} dia(s).` : `O laudo deve ser entregue em ${n} dia(s) (${d.toLocaleDateString('pt-BR')}).`;
          await notifyManagers(title, msg, 'judicial-expertise', 'alert');
          if (e.createdBy && !managerIds.includes(e.createdBy)) await notifyUser(e.createdBy, title, msg, 'judicial-expertise', 'alert');
        }
      } catch (e: any) { console.warn('[BACKGROUND SERVICE] judicial_expertises:', e.message); }

      // 8. PARCELAS DE CONTRATO vencendo em até 5 dias ou vencidas
      try {
        const snap = await db.collection('contracts').where('status', 'in', ['active', 'ativo', 'approved']).get();
        for (const doc of snap.docs) {
          const c = doc.data();
          for (const p of (c.installments || [])) {
            if (!p || p.status === 'paid') continue;
            const d = localDay(p.dueDate); if (!d) continue;
            const n = daysUntil(d); if (n > 5) continue;
            const valor = Number(p.value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
            await notifyManagers(
              n < 0 ? `💰 Parcela vencida: ${c.contractNumber || c.clientName}` : `💰 Parcela a vencer: ${c.contractNumber || c.clientName}`,
              `Parcela ${p.installmentNumber || ''} de ${c.clientName || 'cliente'} (${valor}) ${n < 0 ? `venceu em ${d.toLocaleDateString('pt-BR')}` : `vence em ${d.toLocaleDateString('pt-BR')}`}.`,
              'contracts', n < 0 ? 'alert' : 'warning');
          }
        }
      } catch (e: any) { console.warn('[BACKGROUND SERVICE] parcelas:', e.message); }

      // 9. LANÇAMENTOS FINANCEIROS pendentes com vencimento passado
      try {
        const snap = await db.collection('financials').where('status', '==', 'pending').get();
        const vencidos = snap.docs.map(d => d.data()).filter(f => { const d = localDay(f.dueDate); return d && daysUntil(d) < 0; });
        if (vencidos.length) {
          const total = vencidos.reduce((s, f) => s + (Number(f.value) || 0), 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
          await notifyManagers(`📉 ${vencidos.length} lançamento(s) vencido(s)`, `Há ${vencidos.length} lançamento(s) pendente(s) com vencimento passado, somando ${total}.`, 'financial', 'alert');
        }
      } catch (e: any) { console.warn('[BACKGROUND SERVICE] financials:', e.message); }

      // 10. AGENDA DE AMANHÃ: lembrete para o técnico designado
      try {
        const amanha = new Date(today.getTime() + 864e5);
        const ymd = `${amanha.getFullYear()}-${String(amanha.getMonth() + 1).padStart(2, '0')}-${String(amanha.getDate()).padStart(2, '0')}`;
        const snap = await db.collection('appointments').where('date', '==', ymd).get();
        for (const doc of snap.docs) {
          const a = doc.data();
          if (a.status === 'cancelled' || a.status === 'completed') continue;
          await notifyUser(a.technicianId, `📅 Amanhã: ${a.serviceType || 'visita'} — ${a.clientName || ''}`, `Você tem ${a.serviceType || 'um atendimento'} com ${a.clientName || 'cliente'} amanhã às ${a.time || '--:--'}.`, 'scheduling', 'info');
        }
      } catch (e: any) { console.warn('[BACKGROUND SERVICE] agenda:', e.message); }

      // Verificar delegações vencidas e desativar automaticamente
      await checkExpiredDelegations();

      console.log('[BACKGROUND SERVICE] Verificação diária de prazos concluída com sucesso.');
    } catch (error: any) {
      console.error('[BACKGROUND SERVICE] Erro crítico no serviço de background:', error);
      resultSummary.success = false;
      resultSummary.error = error.message;
    }

    return resultSummary;
  }

  // Verificar delegações vencidas e desativar automaticamente
  async function checkExpiredDelegations() {
    const today = new Date().toISOString().split('T')[0];
    const db = admin.firestore();
    try {
      const snap = await db.collection('delegations')
        .where('active', '==', true)
        .get();

      const batch = db.batch();
      let count = 0;
      snap.docs.forEach(doc => {
        const d = doc.data();
        if (d.endDate && d.endDate < today) {
          batch.update(doc.ref, {
            active: false,
            revokedAt: new Date().toISOString(),
            revokedBy: 'sistema_automatico'
          });
          count++;
        }
      });
      if (count > 0) {
        await batch.commit();
        // Tira o cargo delegado do token de quem estava substituindo (senão continuaria valendo)
        for (const d of snap.docs) {
          const x = d.data();
          if (x.endDate && x.endDate < today && x.delegateUserId) {
            await refreshUserClaim(x.delegateUserId).catch(() => {});
          }
        }
        console.log(`[Delegações] ${count} delegação(ões) expirada(s) desativada(s).`);
      }
    } catch (e: any) {
      console.warn('[Delegações] Erro ao verificar expirações:', e.message);
    }
  }


  // Com o sistema aberto em mais de um computador, a verificação automática
  // de prazos rodaria em todos — avisos e e-mail-resumo em dobro. O primeiro
  // PC do dia "reserva" a execução no banco (system_jobs/daily_checks); os
  // outros pulam. (O botão "Verificar Alertas" continua rodando na hora.)
  async function claimDailyRun(job: string): Promise<boolean> {
    const todayBR = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
    try {
      const ref = admin.firestore().collection('system_jobs').doc(job);
      return await admin.firestore().runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (snap.exists && snap.data()?.lastRunDate === todayBR) return false;
        tx.set(ref, { lastRunDate: todayBR, lastRunAt: new Date().toISOString() }, { merge: true });
        return true;
      });
    } catch {
      return true; // sem acesso ao banco para reservar: roda mesmo assim
    }
  }

  const runDailyChecksOnce = async (origem: string) => {
    try {
      if (!(await claimDailyRun('daily_checks'))) {
        console.log(`[BACKGROUND SERVICE] Verificação de prazos de hoje já feita (${origem}) — outro computador ou abertura anterior.`);
        return;
      }
      await runDailyExpiringChecks();
    } catch (err) {
      console.error(`[BACKGROUND SERVICE] Falha na verificação diária de prazos (${origem}):`, err);
    }
  };

  // Agendar tarefa diária às 00:00 (Meia-noite) para verificação de prazos rurais e licenças
  cron.schedule('0 0 * * *', () => { runDailyChecksOnce('meia-noite'); });

  // Backup diário do banco (ver backend/services/backupService.ts). O PC pode
  // estar desligado num horário fixo, então a cada hora conferimos se o último
  // backup tem mais de 24 h — e também 1 minuto depois de abrir o app.
  cron.schedule('7 * * * *', () => { runBackupIfDue(); });
  setTimeout(() => { runBackupIfDue(); }, 60_000);

  // Na inicialização (se ainda não rodou hoje em nenhum computador)
  setTimeout(() => { runDailyChecksOnce('inicialização'); }, 5000);

  // API: Check for Expiring Contracts & Licenses in Firestore (Dynamic operational check)
  app.all('/api/notifications/check', requireAuth, async (req, res) => {
    try {
      const summary = await runDailyExpiringChecks();
      res.json({
        success: true,
        ...summary,
        message: 'Varredura de contratos, licenças, veículos, clientes e regularizações ambientais concluída com sucesso.'
      });
    } catch (error: any) {
      console.error('Erro ao processar checagem manual de prazos:', error);
      res.status(500).json({ error: error.message || 'Erro interno do servidor.' });
    }
  });

  // (Removidas as rotas de "simulação PostGIS" /api/propriedades, /api/analises e /api/dados:
  //  não eram usadas pelo app e aceitavam dados de qualquer um, sem login.)
  // Health check
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok' });
  });

  // Qualquer outra rota /api inexistente: 404 em JSON (antes caía na página do app)
  app.use('/api', (req, res) => {
    res.status(404).json({ error: 'Rota não encontrada.' });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    // Production serving
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  // No app de computador (Electron define AGROGESTAO_PORT) o servidor só atende
  // o próprio PC; em hospedagem na nuvem continua aceitando conexões externas.
  const HOST = process.env.AGROGESTAO_HOST || (process.env.AGROGESTAO_PORT ? '127.0.0.1' : '0.0.0.0');
  app.listen(PORT, HOST, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
