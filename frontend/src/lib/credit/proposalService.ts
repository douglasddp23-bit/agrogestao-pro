// Gravação e leitura da Proposta no Firestore.
// A proposta fica no documento do projeto de crédito (coleção "analyses",
// type "credit") — o mesmo que a página Crédito Rural já lista —, no campo
// `creditProposal`. Os campos de resumo do projeto (banco, linha, valor, cliente)
// são atualizados junto, para a lista e os painéis continuarem certos.

import { addDoc, collection, doc, getDoc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { logAudit } from '../audit';
import { Client } from '../../types';
import { CreditProposal, ProposalTotals } from './types';
import { CreditProgramConfig } from './programs';
import { loadBank } from './banks';

export interface SaveContext {
  user: { uid: string; displayName?: string | null; email?: string | null };
  program: CreditProgramConfig;
  totals: ProposalTotals;
}

/** ID legível e único da proposta, ex.: PROP-20260930-K7Q2. */
export function newProposalCode(date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `PROP-${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}-${rand}`;
}

/** Cliente pela lista já carregada na tela; se não estiver lá, busca no banco. */
export async function loadClient(clientId: string, loaded: Client[] = []): Promise<Client | null> {
  const found = loaded.find(c => c.id === clientId);
  if (found) return found;
  const snap = await getDoc(doc(db, 'clients', clientId));
  return snap.exists() ? ({ id: snap.id, ...snap.data() } as Client) : null;
}

function projectFields(proposal: CreditProposal, ctx: SaveContext) {
  const firstProperty = proposal.properties.find(p => p.name)?.name || '';
  return {
    clientId: proposal.clientId,
    clientName: proposal.clientName,
    propertyName: firstProperty,
    bank: loadBank(proposal.bankId)?.name || '',
    financingType: ctx.program.name,
    creditProgramId: ctx.program.id,
    proposalStatus: proposal.status,
    value: ctx.totals.total,
    financedValue: ctx.totals.financed,
    updatedAt: new Date().toISOString(),
  };
}

/** Cria o projeto + proposta. Retorna o id do documento e a proposta gravada. */
export async function createProposal(proposal: CreditProposal, ctx: SaveContext): Promise<{ id: string; proposal: CreditProposal }> {
  const now = new Date().toISOString();
  const saved: CreditProposal = { ...proposal, proposalId: proposal.proposalId || newProposalCode(), createdAt: now, updatedAt: now, createdBy: ctx.user.uid, updatedBy: ctx.user.uid };
  const ref = await addDoc(collection(db, 'analyses'), {
    ...projectFields(saved, ctx),
    type: 'credit',
    status: 'Pendente',
    description: `Proposta ${saved.proposalId} — ${ctx.program.name}`,
    cost: 0,
    category: 'Agricultura',
    scheduledDate: saved.proposalDate,
    responsibleTechnician: saved.preparer.name || ctx.user.displayName || '',
    createdAt: now,
    createdBy: ctx.user.uid,
    assignedTo: ctx.user.uid,
    creditProposal: saved,
  });
  logAudit({ userId: ctx.user.uid, userName: ctx.user.displayName || ctx.user.email || 'Usuário', action: 'created', collection: 'analyses', recordId: ref.id, recordName: `${saved.proposalId} · ${saved.clientName}`, details: `Proposta de crédito criada (${ctx.program.name}).` });
  return { id: ref.id, proposal: saved };
}

/** Atualiza a proposta de um projeto existente. */
export async function updateProposal(projectId: string, proposal: CreditProposal, ctx: SaveContext, previousStatus?: string): Promise<CreditProposal> {
  const saved: CreditProposal = { ...proposal, proposalId: proposal.proposalId || newProposalCode(), updatedAt: new Date().toISOString(), updatedBy: ctx.user.uid };
  await updateDoc(doc(db, 'analyses', projectId), { ...projectFields(saved, ctx), creditProposal: saved });
  logAudit({
    userId: ctx.user.uid, userName: ctx.user.displayName || ctx.user.email || 'Usuário', action: 'updated', collection: 'analyses', recordId: projectId,
    recordName: `${saved.proposalId} · ${saved.clientName}`,
    details: previousStatus && previousStatus !== saved.status ? `Proposta atualizada; status: ${previousStatus} → ${saved.status}.` : 'Proposta de crédito atualizada.',
  });
  return saved;
}

/**
 * Leva de volta ao cadastro do cliente os dados de imóvel preenchidos na proposta
 * (CAR, NIRF, CEI, SNCR, proprietário) e acrescenta imóveis digitados à mão —
 * assim ninguém precisa digitar de novo na próxima proposta. Só Gerente e
 * Administrador podem alterar o cadastro de clientes (regra do banco).
 */
export async function syncPropertiesToClient(client: Client, proposal: CreditProposal): Promise<boolean> {
  const props = [...(client.properties || [])];
  let changed = false;
  for (const p of proposal.properties) {
    if (!(p.name || '').trim()) continue;
    const patch = { car: p.car, nirf: p.nirf, cei: p.cei, sncr: p.sncr, ownerType: p.ownerType, ownerName: p.ownerName, ownerDoc: p.ownerDoc };
    if (p.sourceIndex != null && props[p.sourceIndex]) {
      const cur: any = props[p.sourceIndex];
      const merged: any = { ...cur };
      for (const [k, v] of Object.entries(patch)) if (v && cur[k] !== v) { merged[k] = v; changed = true; }
      if (!cur.areaHectares && p.areaHa) { merged.areaHectares = p.areaHa; changed = true; }
      props[p.sourceIndex] = merged;
    } else if (!props.some(x => (x.name || '').trim().toLowerCase() === p.name.trim().toLowerCase())) {
      props.push({ name: p.name.trim(), city: p.city, state: p.state, areaHectares: p.areaHa || undefined, ...patch } as any);
      changed = true;
    }
  }
  if (!changed) return false;
  // Firestore não aceita "undefined" dentro de listas.
  const clean = props.map(x => Object.fromEntries(Object.entries(x).filter(([, v]) => v !== undefined)));
  await updateDoc(doc(db, 'clients', client.id), { properties: clean });
  return true;
}
