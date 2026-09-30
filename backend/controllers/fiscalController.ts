import { Request, Response } from 'express';
import admin from 'firebase-admin';
import { FiscalDocKind, FiscalEmissionRequest, FiscalError, FiscalProviderResult, getFiscalService } from '../services/fiscalService';

// Documento fiscal: só o SERVIDOR grava (as regras do banco bloqueiam as telas).
// Assim ninguém consegue marcar uma nota como "emitida" sem o provedor autorizar.

type Status = 'not_issued' | 'processing' | 'issued' | 'rejected' | 'cancelled';
const STATUS_LABEL: Record<Status, string> = { not_issued: 'Não emitido', processing: 'Em processamento', issued: 'Emitido', rejected: 'Rejeitado', cancelled: 'Cancelado' };

const db = () => admin.firestore();
const onlyDigits = (s: any) => String(s || '').replace(/\D/g, '');

export function isValidCpf(v: string): boolean {
  const c = onlyDigits(v);
  if (c.length !== 11 || /^(\d)\1+$/.test(c)) return false;
  let s = 0; for (let i = 0; i < 9; i++) s += Number(c[i]) * (10 - i);
  let d1 = (s * 10) % 11; if (d1 === 10) d1 = 0;
  if (d1 !== Number(c[9])) return false;
  s = 0; for (let i = 0; i < 10; i++) s += Number(c[i]) * (11 - i);
  let d2 = (s * 10) % 11; if (d2 === 10) d2 = 0;
  return d2 === Number(c[10]);
}
export function isValidCnpj(v: string): boolean {
  const c = onlyDigits(v);
  if (c.length !== 14 || /^(\d)\1+$/.test(c)) return false;
  const calc = (len: number) => {
    const w = len === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const s = w.reduce((acc, wi, i) => acc + Number(c[i]) * wi, 0);
    const r = s % 11; return r < 2 ? 0 : 11 - r;
  };
  return calc(12) === Number(c[12]) && calc(13) === Number(c[13]);
}

async function actorOf(req: Request) {
  const uid = String((req as any).user?.uid || '');
  let name = String((req as any).user?.name || (req as any).user?.email || '');
  try { const u = await db().collection('users').doc(uid).get(); name = u.data()?.displayName || name; } catch { /* sem perfil */ }
  return { uid, name: name || 'Usuário', role: String((req as any).user?.role || '') };
}

/** Guarda XML/PDF no próprio sistema (mesmo formato de lib/fileStore.ts: file_blobs + pedaços). */
async function saveBlob(name: string, mime: string, data: Buffer, createdBy: string, clientId: string): Promise<string> {
  const ref = db().collection('file_blobs').doc();
  const dataUrl = `data:${mime};base64,${data.toString('base64')}`;
  const CHUNK = 700_000;
  const parts: string[] = [];
  for (let i = 0; i < dataUrl.length; i += CHUNK) parts.push(dataUrl.slice(i, i + CHUNK));
  const batch = db().batch();
  batch.set(ref, { name, type: mime, size: data.length, chunks: parts.length, clientId: clientId || '', createdBy, createdAt: new Date().toISOString() });
  parts.forEach((p, i) => batch.set(ref.collection('chunks').doc(String(i)), { index: i, data: p }));
  await batch.commit();
  return `fsfile://${ref.id}`;
}

async function audit(actor: { uid: string; name: string }, action: string, docId: string, recordName: string, details: string, prev?: any, next?: any) {
  try {
    await db().collection('logs').add({
      userId: actor.uid, userName: actor.name, action, collection: 'fiscal_documents', recordId: docId, recordName, details,
      previousValues: prev || null, newValues: next || null, timestamp: new Date().toISOString(),
    });
  } catch (e: any) { console.warn('[Fiscal] auditoria:', e?.message || e); }
}

async function event(documentId: string, billingId: string, type: string, actor: { uid: string; name: string }, message: string, prev?: Status, next?: Status, technical?: string) {
  await db().collection('fiscal_events').add({
    documentId, billingId, type, message, technicalMessage: technical || '', previousStatus: prev || null, newStatus: next || null,
    userId: actor.uid, userName: actor.name, createdAt: new Date().toISOString(),
  });
}

/** Grava o retorno do provedor no documento, no faturamento, no histórico e na auditoria. */
async function applyResult(docId: string, billingId: string, result: FiscalProviderResult, actor: { uid: string; name: string }, eventType: string, extra: Record<string, any> = {}) {
  const docRef = db().collection('fiscal_documents').doc(docId);
  const snap = await docRef.get();
  const cur = snap.data() || {};
  const prev: Status = cur.status || 'processing';
  const next: Status = result.status === 'not_found' ? prev : (result.status as Status);
  const now = new Date().toISOString();
  const patch: Record<string, any> = {
    status: next, providerMessage: result.message || '', providerTechnical: (result.technical || '').slice(0, 5000), updatedAt: now, ...extra,
  };
  for (const k of ['number', 'series', 'verificationCode', 'protocol', 'issuedAt', 'link', 'providerRef'] as const) if (result[k]) patch[k] = result[k];
  // XML e PDF ficam guardados no sistema (não dependem de link externo)
  if (result.xml && !cur.xmlFileUrl) patch.xmlFileUrl = await saveBlob(`nota-${result.number || docId}.xml`, 'application/xml', Buffer.from(result.xml, 'utf8'), actor.uid, cur.clientId);
  if (result.pdf && !cur.pdfFileUrl) patch.pdfFileUrl = await saveBlob(`nota-${result.number || docId}.pdf`, 'application/pdf', result.pdf, actor.uid, cur.clientId);
  await docRef.set(patch, { merge: true });
  await db().collection('billings').doc(billingId).set({
    fiscal: { docType: cur.docType, status: next, documentId: docId, number: patch.number || cur.number || null, updatedAt: now },
  }, { merge: true });
  await event(docId, billingId, eventType, actor, result.message || STATUS_LABEL[next], prev, next, result.technical);
  await audit(actor, next === 'issued' ? 'fiscal_issued' : next === 'rejected' ? 'fiscal_rejected' : next === 'cancelled' ? 'fiscal_cancelled' : 'fiscal_' + eventType,
    docId, `${cur.docType || ''} ${patch.number || cur.number || ''} — ${cur.billingNumber || billingId}`.trim(),
    `${result.message || ''}${result.technical ? ` | Provedor: ${result.technical.slice(0, 300)}` : ''}`, { status: prev }, { status: next });
  return { ...cur, ...patch, id: docId };
}

function publicDoc(d: any, role: string) {
  // Mensagem técnica completa só para Gerente/Administrador
  if (role === 'admin' || role === 'manager') return d;
  const { providerTechnical, ...rest } = d; return rest;
}

// GET /api/fiscal/status
export async function fiscalStatus(_req: Request, res: Response) {
  const svc = getFiscalService();
  res.json({ configured: svc.isConfigured(), provider: svc.name, environment: svc.environment });
}

interface Validation { error?: string; field?: string; request?: FiscalEmissionRequest; docType?: FiscalDocKind }

/** Valida NA ORDEM: emitente → cliente → endereço → CPF/CNPJ → itens → valores → tributação → tipo. */
async function validateForEmission(billing: any, requestedType?: string): Promise<Validation> {
  const s = (await db().collection('fiscal_settings').doc('company').get()).data() || {};
  // 1. Emitente
  if (!s.razaoSocial || !isValidCnpj(s.cnpj || '')) return { error: 'Complete os dados do emitente (razão social e CNPJ válido) em Configuração Fiscal.', field: 'emitente' };
  if (!s.municipio || !/^[A-Za-z]{2}$/.test(s.uf || '') || onlyDigits(s.cep).length !== 8 || !s.endereco) return { error: 'Complete o endereço do emitente (logradouro, município, UF e CEP) em Configuração Fiscal.', field: 'emitente' };
  // 2. Cliente
  const cSnap = billing.clientId ? await db().collection('clients').doc(billing.clientId).get() : null;
  const client: any = cSnap?.exists ? cSnap.data() : null;
  if (!client || !client.name) return { error: 'Cliente do faturamento não encontrado no cadastro.', field: 'cliente' };
  // 3. Endereço do cliente
  const a = client.address || {};
  if (!a.street || !a.city || !a.state || onlyDigits(a.cep).length !== 8) return { error: `Complete o endereço do cliente ${client.name} (rua, cidade, UF e CEP) no cadastro de Clientes.`, field: 'endereco' };
  // 4. CPF/CNPJ
  const docNum = onlyDigits(client.cpf || billing.clientDoc);
  if (!(docNum.length === 11 ? isValidCpf(docNum) : isValidCnpj(docNum))) return { error: `CPF/CNPJ do cliente ${client.name} ausente ou inválido.`, field: 'documento' };
  // 5. Serviço/produto
  const items: any[] = Array.isArray(billing.items) ? billing.items : [];
  if (!items.length) return { error: 'O faturamento não tem itens.', field: 'itens' };
  // 8. Tipo de documento (pela natureza da operação)
  const op = billing.operationType;
  const docType: FiscalDocKind | null = op === 'service' ? 'NFSE' : op === 'product' ? 'NFE' : (requestedType === 'NFSE' || requestedType === 'NFE' ? requestedType : billing.fiscalDocType || null);
  if (!docType) return { error: 'Faturamento com serviço + produto: defina qual documento fiscal emitir (NFS-e ou NF-e).', field: 'tipo' };
  const relevant = items.filter(i => (docType === 'NFSE' ? i.kind !== 'product' : i.kind === 'product'));
  if (!relevant.length) return { error: docType === 'NFSE' ? 'Não há itens de serviço para a NFS-e.' : 'Não há itens de produto para a NF-e.', field: 'itens' };
  // 6. Valores
  const total = Math.round(relevant.reduce((sum, i) => sum + (Number(i.total) || 0), 0) * 100) / 100;
  if (!(total > 0)) return { error: 'O valor dos itens precisa ser maior que zero.', field: 'valores' };
  // 7. Tributação (configurável — nada presumido)
  const serviceTypes = s.serviceTypes || {};
  const fiscalItems = [];
  for (const i of relevant) {
    if (docType === 'NFSE') {
      const cfg = serviceTypes[i.serviceCategory || ''] || {};
      const codigoServico = cfg.fiscalCode || s.codigoServicoPadrao;
      const aliquota = cfg.aliquota || s.aliquotaPadrao;
      if (!codigoServico || !aliquota) return { error: `Informe o código do serviço e a alíquota (Configuração Fiscal) para "${String(i.description).slice(0, 60)}".`, field: 'tributacao' };
      if (!s.inscricaoMunicipal) return { error: 'Informe a inscrição municipal do emitente (obrigatória para NFS-e).', field: 'emitente' };
      fiscalItems.push({ descricao: i.description, quantidade: Number(i.quantity), valorUnitario: Number(i.unitPrice), desconto: Number(i.discount) || 0, valorTotal: Number(i.total), codigoServico, aliquota });
    } else {
      let ncm = ''; let unidade = i.unit || 'UN';
      if (i.productId) {
        const p = (await db().collection('inventory_items').doc(i.productId).get()).data() || {};
        ncm = p.ncm || ''; unidade = p.unit || unidade;
        if (p.cfop && !s.cfopPadrao) s.cfopPadrao = p.cfop;
      }
      if (!ncm) return { error: `Informe o NCM do produto "${String(i.description).slice(0, 60)}" (cadastro no Estoque).`, field: 'tributacao' };
      if (!s.cfopPadrao) return { error: 'Informe o CFOP padrão em Configuração Fiscal.', field: 'tributacao' };
      if (!s.inscricaoEstadual) return { error: 'Informe a inscrição estadual do emitente (obrigatória para NF-e).', field: 'emitente' };
      fiscalItems.push({ descricao: i.description, quantidade: Number(i.quantity), valorUnitario: Number(i.unitPrice), desconto: Number(i.discount) || 0, valorTotal: Number(i.total), ncm, cfop: s.cfopPadrao, unidade });
    }
  }
  const party = (x: any, doc: string, addr: any) => ({ nome: x, documento: doc, endereco: addr });
  return {
    docType,
    request: {
      referencia: '', tipo: docType, ambiente: s.ambiente || process.env.FISCAL_ENVIRONMENT || 'homologacao',
      serie: docType === 'NFSE' ? s.serieNfse : s.serieNfe,
      emitente: {
        ...party(s.razaoSocial, onlyDigits(s.cnpj), { logradouro: s.endereco, numero: s.numero || 'S/N', bairro: s.bairro || '', municipio: s.municipio, codigoMunicipioIbge: s.codigoMunicipioIbge || '', uf: String(s.uf).toUpperCase(), cep: onlyDigits(s.cep) }),
        inscricaoMunicipal: s.inscricaoMunicipal || '', inscricaoEstadual: s.inscricaoEstadual || '', regimeTributario: s.regimeTributario || '', email: s.email || '',
      },
      tomador: { ...party(client.name, docNum, { logradouro: a.street, numero: a.number || 'S/N', bairro: a.neighborhood || '', municipio: a.city, uf: String(a.state).toUpperCase(), cep: onlyDigits(a.cep) }), email: client.ownerEmail || '' },
      itens: fiscalItems, valorTotal: total, naturezaOperacao: s.naturezaOperacao || '', municipioIncidencia: s.municipioIncidencia || '',
      retencoes: s.retencoes || '', observacoes: `${billing.number}. ${billing.notes || ''}`.slice(0, 2000),
    },
  };
}

async function callEmit(svc: ReturnType<typeof getFiscalService>, request: FiscalEmissionRequest): Promise<FiscalProviderResult> {
  try {
    return request.tipo === 'NFSE' ? await svc.emitirNfse(request) : await svc.emitirNfe(request);
  } catch (e: any) {
    if (e instanceof FiscalError && e.code === 'not_configured') throw e;
    // Sem resposta clara: NÃO considera emitida nem rejeitada — fica em processamento para consultar
    return { status: 'processing', message: 'Sem resposta do provedor fiscal. A situação será confirmada na consulta.', technical: String(e?.technical || e?.message || e).slice(0, 2000) };
  }
}

// POST /api/fiscal/emit { billingId, docType? }
export async function emitFiscal(req: Request, res: Response) {
  const billingId = String(req.body?.billingId || '');
  if (!/^FAT-\d{4}-\d{4,6}$/.test(billingId)) return res.status(400).json({ error: 'Faturamento inválido.' });
  const actor = await actorOf(req);
  const svc = getFiscalService();
  try {
    const bRef = db().collection('billings').doc(billingId);
    const b: any = (await bRef.get()).data();
    if (!b) return res.status(404).json({ error: 'Faturamento não encontrado.' });
    if (b.status === 'draft') return res.status(400).json({ error: 'Confirme o faturamento antes de emitir o documento fiscal.' });
    if (b.status === 'cancelled') return res.status(400).json({ error: 'Faturamento cancelado: não é possível emitir documento fiscal.' });
    // Nunca emite de novo: já existe documento emitido ou em processamento
    if (b.fiscal && (b.fiscal.status === 'issued' || b.fiscal.status === 'processing')) {
      return res.status(409).json({ error: 'Este faturamento já possui documento fiscal.', code: 'already_has_document', documentId: b.fiscal.documentId });
    }
    if (b.fiscal?.status === 'rejected') {
      return res.status(409).json({ error: 'A última tentativa foi rejeitada: use "Tentar novamente" (consulta o provedor antes).', code: 'use_retry', documentId: b.fiscal.documentId });
    }
    const v = await validateForEmission(b, req.body?.docType);
    if (v.error) return res.status(422).json({ error: v.error, code: 'validation', field: v.field });
    if (!svc.isConfigured()) {
      return res.status(503).json({ error: 'Nenhum provedor fiscal configurado. A emissão fica disponível depois que o provedor for contratado e configurado.', code: 'not_configured' });
    }

    // Reserva a emissão numa transação (dois cliques / dois computadores ao mesmo tempo → só um passa)
    const docRef = db().collection('fiscal_documents').doc();
    const reserved = await db().runTransaction(async (tx) => {
      const cur: any = (await tx.get(bRef)).data();
      if (cur?.fiscal && ['issued', 'processing'].includes(cur.fiscal.status)) return false;
      const now = new Date().toISOString();
      tx.set(docRef, {
        billingId, billingNumber: b.number, clientId: b.clientId, clientName: b.clientName, docType: v.docType, status: 'processing',
        provider: svc.name, environment: v.request!.ambiente, amount: v.request!.valorTotal, series: v.request!.serie || '',
        sourceLabel: b.source?.label || '', sourceCollection: b.source?.collection || '', sourceId: b.source?.id || '',
        referencia: docRef.id, createdAt: now, updatedAt: now, createdBy: actor.uid,
      });
      tx.set(bRef, { fiscal: { docType: v.docType, status: 'processing', documentId: docRef.id, updatedAt: now } }, { merge: true });
      return true;
    });
    if (!reserved) return res.status(409).json({ error: 'Este faturamento já possui documento fiscal.', code: 'already_has_document', documentId: b.fiscal?.documentId });
    await event(docRef.id, billingId, 'emit_request', actor, `Emissão de ${v.docType === 'NFSE' ? 'NFS-e' : 'NF-e'} enviada ao provedor ${svc.name}.`, 'not_issued', 'processing');

    const result = await callEmit(svc, { ...v.request!, referencia: docRef.id });
    const type = result.status === 'issued' ? 'authorized' : result.status === 'rejected' ? 'rejected' : 'processing';
    const saved = await applyResult(docRef.id, billingId, result, actor, type);
    return res.json({ document: publicDoc(saved, actor.role) });
  } catch (e: any) {
    if (e instanceof FiscalError && e.code === 'not_configured') return res.status(503).json({ error: e.message, code: 'not_configured' });
    console.error('[Fiscal] emissão:', e?.message || e);
    return res.status(500).json({ error: 'Não foi possível emitir o documento fiscal.' });
  }
}

async function loadDoc(documentId: string) {
  if (!/^[A-Za-z0-9]{10,40}$/.test(documentId)) return null;
  const s = await db().collection('fiscal_documents').doc(documentId).get();
  return s.exists ? ({ id: s.id, ...s.data() } as any) : null;
}

// POST /api/fiscal/consult { documentId }
export async function consultFiscal(req: Request, res: Response) {
  const actor = await actorOf(req);
  try {
    const d = await loadDoc(String(req.body?.documentId || ''));
    if (!d) return res.status(404).json({ error: 'Documento fiscal não encontrado.' });
    const svc = getFiscalService();
    if (!svc.isConfigured()) return res.status(503).json({ error: 'Nenhum provedor fiscal configurado.', code: 'not_configured' });
    const r = await svc.consultar(d.referencia || d.id, d.providerRef);
    if (r.status === 'not_found') {
      await event(d.id, d.billingId, 'consulted', actor, 'Consulta: o provedor não tem registro desta emissão.', d.status, d.status, r.technical);
      return res.json({ document: publicDoc(d, actor.role) });
    }
    const saved = await applyResult(d.id, d.billingId, r, actor, 'consulted');
    return res.json({ document: publicDoc(saved, actor.role) });
  } catch (e: any) {
    console.error('[Fiscal] consulta:', e?.message || e);
    return res.status(500).json({ error: 'Não foi possível consultar a situação no provedor.' });
  }
}

// POST /api/fiscal/retry { documentId } — Em processamento ou Rejeitado: consulta ANTES para não duplicar
export async function retryFiscal(req: Request, res: Response) {
  const actor = await actorOf(req);
  try {
    const d = await loadDoc(String(req.body?.documentId || ''));
    if (!d) return res.status(404).json({ error: 'Documento fiscal não encontrado.' });
    if (!['processing', 'rejected'].includes(d.status)) return res.status(400).json({ error: `Documento ${STATUS_LABEL[d.status as Status] || d.status}: não há o que tentar de novo.` });
    const svc = getFiscalService();
    if (!svc.isConfigured()) return res.status(503).json({ error: 'Nenhum provedor fiscal configurado.', code: 'not_configured' });
    const before = await svc.consultar(d.referencia || d.id, d.providerRef);
    if (before.status === 'issued' || before.status === 'processing' || before.status === 'cancelled') {
      // Já estava autorizada (ou em fila) no provedor — só atualiza, não reenvia
      const saved = await applyResult(d.id, d.billingId, before, actor, 'consulted');
      return res.json({ document: publicDoc(saved, actor.role), consultedOnly: true });
    }
    const b: any = (await db().collection('billings').doc(d.billingId).get()).data();
    if (!b || b.status === 'cancelled') return res.status(400).json({ error: 'Faturamento cancelado ou inexistente.' });
    const v = await validateForEmission(b, d.docType);
    if (v.error) return res.status(422).json({ error: v.error, code: 'validation', field: v.field });
    // Nova referência para a nova tentativa (a rejeitada fica no histórico do provedor)
    const referencia = `${d.id}-r${Date.now().toString(36)}`;
    await db().collection('fiscal_documents').doc(d.id).set({ referencia, status: 'processing', updatedAt: new Date().toISOString() }, { merge: true });
    await event(d.id, d.billingId, 'retry', actor, 'Nova tentativa de emissão (o provedor foi consultado antes).', d.status, 'processing');
    const result = await callEmit(svc, { ...v.request!, referencia });
    const type = result.status === 'issued' ? 'authorized' : result.status === 'rejected' ? 'rejected' : 'processing';
    const saved = await applyResult(d.id, d.billingId, result, actor, type);
    return res.json({ document: publicDoc(saved, actor.role) });
  } catch (e: any) {
    console.error('[Fiscal] nova tentativa:', e?.message || e);
    return res.status(500).json({ error: 'Não foi possível tentar novamente.' });
  }
}

// POST /api/fiscal/cancel { documentId, reason } — a nota NUNCA é apagada
export async function cancelFiscal(req: Request, res: Response) {
  const actor = await actorOf(req);
  const reason = String(req.body?.reason || '').trim().slice(0, 1000);
  if (reason.length < 5) return res.status(400).json({ error: 'Informe o motivo do cancelamento (mínimo 5 caracteres).' });
  try {
    const d = await loadDoc(String(req.body?.documentId || ''));
    if (!d) return res.status(404).json({ error: 'Documento fiscal não encontrado.' });
    if (d.status !== 'issued') return res.status(400).json({ error: 'Só é possível cancelar documento emitido.' });
    const svc = getFiscalService();
    if (!svc.isConfigured()) return res.status(503).json({ error: 'Nenhum provedor fiscal configurado.', code: 'not_configured' });
    await event(d.id, d.billingId, 'cancel_request', actor, `Pedido de cancelamento. Motivo: ${reason}`, 'issued', 'issued');
    let r: FiscalProviderResult;
    try { r = await svc.cancelar(d.referencia || d.id, d.providerRef, reason); }
    catch (e: any) { r = { status: 'rejected', message: 'O provedor não confirmou o cancelamento. Consulte a situação e tente de novo.', technical: String(e?.message || e) }; }
    if (r.status !== 'cancelled') {
      // Cancelamento recusado: a nota continua EMITIDA
      await event(d.id, d.billingId, 'cancel_rejected', actor, r.message, 'issued', 'issued', r.technical);
      await audit(actor, 'fiscal_cancel_rejected', d.id, `${d.docType} ${d.number || ''} — ${d.billingNumber}`, r.message, { status: 'issued' }, { status: 'issued' });
      return res.status(422).json({ error: r.message, technical: actor.role === 'admin' || actor.role === 'manager' ? r.technical : undefined });
    }
    const now = new Date().toISOString();
    const saved = await applyResult(d.id, d.billingId, { ...r, status: 'cancelled' }, actor, 'cancelled', { cancelReason: reason, cancelledAt: now, cancelledBy: actor.uid });
    return res.json({ document: publicDoc(saved, actor.role) });
  } catch (e: any) {
    console.error('[Fiscal] cancelamento:', e?.message || e);
    return res.status(500).json({ error: 'Não foi possível cancelar o documento fiscal.' });
  }
}

