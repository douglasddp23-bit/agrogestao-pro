// Camada de abstração FISCAL (NFS-e / NF-e).
//
// O sistema NÃO fala direto com uma prefeitura ou SEFAZ específica: fala com
// esta interface. O provedor real (empresa que transmite as notas) é plugado
// depois, criando uma classe que implementa FiscalService e registrando-a em
// getFiscalService() — nada mais no sistema precisa mudar.
//
// Configuração SÓ por variáveis de ambiente (arquivo de chaves .env.local, fora
// do Git e fora do instalador):
//   FISCAL_PROVIDER=        nome do provedor (vazio = emissão desligada; "simulado" = testes)
//   FISCAL_API_URL=         endereço da API do provedor
//   FISCAL_API_KEY=         chave/token do provedor (nunca no código nem nas telas)
//   FISCAL_ENVIRONMENT=     homologacao | producao
// Certificado digital (se o provedor exigir): FISCAL_CERT_PATH (arquivo .pfx na
// pasta protegida de chaves) e FISCAL_CERT_PASSWORD — nunca no banco.

export type FiscalDocKind = 'NFSE' | 'NFE';
export type ProviderStatus = 'issued' | 'processing' | 'rejected' | 'cancelled' | 'not_found';

export interface FiscalParty {
  nome: string;
  documento: string;            // CPF/CNPJ só números
  inscricaoMunicipal?: string;
  inscricaoEstadual?: string;
  email?: string;
  endereco: { logradouro: string; numero: string; bairro: string; municipio: string; codigoMunicipioIbge?: string; uf: string; cep: string };
}

export interface FiscalItem {
  descricao: string;
  quantidade: number;
  valorUnitario: number;
  desconto: number;
  valorTotal: number;
  codigoServico?: string;       // NFS-e
  aliquota?: string;            // NFS-e (texto como o contador informou)
  ncm?: string;                 // NF-e
  cfop?: string;                // NF-e
  unidade?: string;
}

export interface FiscalEmissionRequest {
  /** Chave única desta emissão — o provedor usa para não emitir duas vezes. */
  referencia: string;
  tipo: FiscalDocKind;
  ambiente: string;
  serie?: string;
  emitente: FiscalParty & { regimeTributario?: string };
  tomador: FiscalParty;
  itens: FiscalItem[];
  valorTotal: number;
  naturezaOperacao?: string;
  municipioIncidencia?: string;
  retencoes?: string;
  observacoes?: string;
}

export interface FiscalProviderResult {
  status: ProviderStatus;
  /** Mensagem amigável (vai para o usuário comum). */
  message: string;
  /** Detalhe técnico completo (só Gerente/Administrador vê). */
  technical?: string;
  number?: string;
  series?: string;
  verificationCode?: string;
  protocol?: string;
  issuedAt?: string;
  link?: string;
  providerRef?: string;
  xml?: string;
  pdf?: Buffer;
}

export interface FiscalService {
  readonly name: string;
  readonly environment: string;
  isConfigured(): boolean;
  emitirNfse(req: FiscalEmissionRequest): Promise<FiscalProviderResult>;
  emitirNfe(req: FiscalEmissionRequest): Promise<FiscalProviderResult>;
  /** Consulta pela referência da emissão (ou pelo id do provedor). */
  consultar(referencia: string, providerRef?: string): Promise<FiscalProviderResult>;
  cancelar(referencia: string, providerRef: string | undefined, motivo: string): Promise<FiscalProviderResult>;
  baixarXml(referencia: string, providerRef?: string): Promise<string | null>;
  baixarPdf(referencia: string, providerRef?: string): Promise<Buffer | null>;
}

export class FiscalError extends Error {
  constructor(public code: 'not_configured' | 'provider_error', message: string, public technical?: string) {
    super(message);
  }
}

// ─── Nenhum provedor configurado: emissão desligada ─────────────────────────
class NotConfiguredFiscalService implements FiscalService {
  readonly name = 'nenhum';
  readonly environment = process.env.FISCAL_ENVIRONMENT || '';
  isConfigured() { return false; }
  private fail(): never {
    throw new FiscalError('not_configured', 'Nenhum provedor fiscal configurado. A emissão de notas fica disponível depois que o provedor for contratado e configurado.');
  }
  emitirNfse(): Promise<FiscalProviderResult> { return this.fail(); }
  emitirNfe(): Promise<FiscalProviderResult> { return this.fail(); }
  consultar(): Promise<FiscalProviderResult> { return this.fail(); }
  cancelar(): Promise<FiscalProviderResult> { return this.fail(); }
  async baixarXml() { return null; }
  async baixarPdf() { return null; }
}

// ─── Provedor SIMULADO (só testes; nunca em produção) ────────────────────────
// Resultado controlado por FISCAL_SIMULADO_RESULTADO (autorizar | rejeitar |
// processando) ou, para testes pontuais, pela marca [SIMULAR:REJEITAR] /
// [SIMULAR:PROCESSANDO] nas observações do faturamento. Os documentos gerados
// dizem "SEM VALOR FISCAL".
interface SimRecord { result: FiscalProviderResult; tipo: FiscalDocKind; req?: FiscalEmissionRequest; consults: number }

function tinyPdf(lines: string[]): Buffer {
  const esc = (s: string) => s.replace(/[\\()]/g, (c) => '\\' + c).replace(/[^\x20-\x7E]/g, '?');
  const content = ['BT', '/F1 12 Tf', '50 780 Td', '16 TL', ...lines.map((l) => `(${esc(l)}) '`), 'ET'].join('\n');
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objs.forEach((o, i) => { offsets.push(Buffer.byteLength(out)); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('');
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

class SimulatedFiscalService implements FiscalService {
  readonly name = 'simulado';
  readonly environment = process.env.FISCAL_ENVIRONMENT || 'homologacao';
  private store = new Map<string, SimRecord>();
  private seq = 1000;
  isConfigured() { return true; }

  private outcome(req: FiscalEmissionRequest): 'autorizar' | 'rejeitar' | 'processando' {
    const obs = (req.observacoes || '').toUpperCase();
    if (obs.includes('[SIMULAR:REJEITAR]')) return 'rejeitar';
    if (obs.includes('[SIMULAR:PROCESSANDO]')) return 'processando';
    const env = String(process.env.FISCAL_SIMULADO_RESULTADO || 'autorizar').toLowerCase();
    return env === 'rejeitar' || env === 'processando' ? env : 'autorizar';
  }

  private authorize(req: FiscalEmissionRequest, tipo: FiscalDocKind): FiscalProviderResult {
    const number = String(++this.seq);
    const now = new Date().toISOString();
    const code = `SIM${Buffer.from(req.referencia).toString('hex').slice(0, 12).toUpperCase()}`;
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<${tipo === 'NFSE' ? 'NFSe' : 'NFe'} ambiente="${req.ambiente}" simulado="true">\n` +
      `  <Numero>${number}</Numero><Serie>${req.serie || '1'}</Serie><CodigoVerificacao>${code}</CodigoVerificacao>\n` +
      `  <Referencia>${req.referencia}</Referencia><DataEmissao>${now}</DataEmissao>\n` +
      `  <Prestador><Documento>${req.emitente.documento}</Documento></Prestador>\n` +
      `  <Tomador><Documento>${req.tomador.documento}</Documento></Tomador>\n` +
      `  <ValorTotal>${req.valorTotal.toFixed(2)}</ValorTotal>\n  <Observacao>DOCUMENTO SIMULADO - SEM VALOR FISCAL</Observacao>\n</${tipo === 'NFSE' ? 'NFSe' : 'NFe'}>\n`;
    const pdf = tinyPdf([
      `${tipo === 'NFSE' ? 'NFS-e' : 'NF-e'} SIMULADA - SEM VALOR FISCAL`, '',
      `Numero: ${number}   Serie: ${req.serie || '1'}`, `Codigo de verificacao: ${code}`,
      `Emitente: ${req.emitente.nome} (${req.emitente.documento})`, `Tomador: ${req.tomador.nome} (${req.tomador.documento})`,
      `Valor total: R$ ${req.valorTotal.toFixed(2)}`, `Referencia: ${req.referencia}`, `Emissao: ${now}`,
    ]);
    return {
      status: 'issued', message: `${tipo === 'NFSE' ? 'NFS-e' : 'NF-e'} autorizada (ambiente de teste — sem valor fiscal).`,
      technical: `SIMULADO: autorizado, protocolo SIM-${number}.`, number, series: req.serie || '1', verificationCode: code,
      protocol: `SIM-${number}`, issuedAt: now, providerRef: `sim-${req.referencia}`, xml, pdf,
    };
  }

  private async emit(req: FiscalEmissionRequest, tipo: FiscalDocKind): Promise<FiscalProviderResult> {
    if (this.environment === 'producao') {
      throw new FiscalError('provider_error', 'O provedor simulado não pode ser usado em produção.', 'FISCAL_PROVIDER=simulado com FISCAL_ENVIRONMENT=producao');
    }
    const prev = this.store.get(req.referencia);
    if (prev && (prev.result.status === 'issued' || prev.result.status === 'processing')) return prev.result; // idempotente
    const o = this.outcome(req);
    let result: FiscalProviderResult;
    if (o === 'rejeitar') {
      result = { status: 'rejected', message: 'O provedor recusou o documento: dados do tomador ou da tributação não conferem.',
        technical: 'E160 - SIMULADO: Codigo do servico nao permitido para o municipio / inscricao do tomador invalida.', providerRef: `sim-${req.referencia}` };
    } else if (o === 'processando') {
      result = { status: 'processing', message: 'Documento recebido pelo provedor e em processamento.', technical: 'SIMULADO: lote em fila.', providerRef: `sim-${req.referencia}` };
    } else {
      result = this.authorize(req, tipo);
    }
    this.store.set(req.referencia, { result, tipo, req, consults: 0 });
    return result;
  }

  emitirNfse(req: FiscalEmissionRequest) { return this.emit(req, 'NFSE'); }
  emitirNfe(req: FiscalEmissionRequest) { return this.emit(req, 'NFE'); }

  async consultar(referencia: string): Promise<FiscalProviderResult> {
    const rec = this.store.get(referencia);
    if (!rec) return { status: 'not_found', message: 'O provedor não tem registro desta emissão.' };
    rec.consults++;
    // Em processamento: na 1ª consulta o provedor já terminou e autorizou
    if (rec.result.status === 'processing' && rec.req) rec.result = this.authorize(rec.req, rec.tipo);
    return rec.result;
  }

  async cancelar(referencia: string, _ref: string | undefined, motivo: string): Promise<FiscalProviderResult> {
    const rec = this.store.get(referencia);
    if (!rec || rec.result.status !== 'issued') {
      return { status: 'rejected', message: 'O provedor não encontrou nota autorizada para cancelar.', technical: 'SIMULADO: cancelamento recusado.' };
    }
    rec.result = { ...rec.result, status: 'cancelled', message: 'Cancelamento homologado (ambiente de teste).', technical: `SIMULADO: cancelado. Motivo: ${motivo}` };
    return rec.result;
  }

  async baixarXml(referencia: string) { return this.store.get(referencia)?.result.xml || null; }
  async baixarPdf(referencia: string) { return this.store.get(referencia)?.result.pdf || null; }
}

// ─── Escolha do provedor ─────────────────────────────────────────────────────
let instance: FiscalService | null = null;

/**
 * Provedor ativo, conforme FISCAL_PROVIDER. Para plugar um provedor real:
 * implemente FiscalService (ex.: class MeuProvedorFiscalService) usando
 * FISCAL_API_URL / FISCAL_API_KEY e acrescente um "case" aqui.
 */
export function getFiscalService(): FiscalService {
  if (instance) return instance;
  const provider = String(process.env.FISCAL_PROVIDER || '').trim().toLowerCase();
  switch (provider) {
    case 'simulado':
      instance = new SimulatedFiscalService();
      break;
    // case 'meu-provedor': instance = new MeuProvedorFiscalService(process.env.FISCAL_API_URL!, process.env.FISCAL_API_KEY!); break;
    default:
      instance = new NotConfiguredFiscalService();
  }
  return instance;
}
