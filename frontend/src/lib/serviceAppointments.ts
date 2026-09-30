// Agendamentos AUTOMÁTICOS a partir dos serviços (pedido de 30/09/2026).
//
// Todo serviço com data marcada ou prazo HOJE ou no futuro ganha um item na aba
// Agendamentos. O id do agendamento é fixo por serviço/tipo de data
// (auto_<coleção>_<id>_<tipo>), então rodar esta rotina várias vezes — ou em dois
// computadores — nunca duplica nada. Ela roda:
//   • logo depois de salvar um serviço (Análises, Irrigação, Topografia,
//     Regularização, Crédito Rural, Perícia judicial);
//   • sempre que a aba Agendamentos é aberta (pega também serviços antigos e
//     mudanças de data/situação feitas em outro computador).
// Se a data mudar, o agendamento acompanha; se o serviço for concluído ou
// cancelado (ou a data sair), o agendamento é marcado como concluído/cancelado.

import { collection, doc, getDoc, getDocs, setDoc, updateDoc } from 'firebase/firestore';
import { db, auth } from './firebase';

type Kind = 'data' | 'prazo' | 'vistoria';

interface Planned {
  id: string;
  sourceCollection: string;
  sourceId: string;
  kind: Kind;
  date: string;               // AAAA-MM-DD
  serviceType: string;
  clientId: string;
  clientName: string;
  technicianId: string;
  technicianName: string;
  notes: string;
  finished: 'completed' | 'cancelled' | null;
}

const ANALYSIS_LABELS: Record<string, string> = {
  soil: 'Análise de Solo', water: 'Análise de Água', foliar: 'Análise Foliar', fertility: 'Análise de Fertilidade',
  credit: 'Crédito Rural', documentation: 'Documentação', topography: 'Topografia', irrigation: 'Irrigação',
  environmental_xray: 'Raio-X Ambiental',
};

const todayYMD = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** Aceita "2026-10-05" ou "2026-10-05T..." — devolve AAAA-MM-DD ou ''. */
const ymd = (v: unknown): string => {
  const s = typeof v === 'string' ? v.trim() : '';
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : '';
};

const brDate = (v: string) => v.split('-').reverse().join('/');

/** Situação do serviço → o que fazer com o agendamento. */
function finishedState(status: unknown): Planned['finished'] {
  const s = String(status || '').toLowerCase();
  if (/cancel/.test(s)) return 'cancelled';
  if (/conclu|finaliz|entregue|aprovado e pago|arquivad/.test(s)) return 'completed';
  return null;
}

/** Nome dos colaboradores por uid (para o técnico do agendamento). */
let userNames: Record<string, string> = {};

function technicianOf(d: any, fallbackName: string) {
  const uid = auth.currentUser?.uid || '';
  const technicianId = String(d.assignedTo || d.createdBy || uid || '');
  return {
    technicianId,
    technicianName: String(d.responsibleTechnician || d.technicalResponsible || d.responsible || d.responsibleTech?.name || userNames[technicianId] || d.createdByName || fallbackName || 'Técnico'),
  };
}

function plan(
  out: Planned[], sourceCollection: string, sourceId: string, kind: Kind, rawDate: unknown,
  serviceType: string, d: any, notes: string, fallbackName: string,
) {
  const date = ymd(rawDate);
  const clientName = String(d.clientName || d.requerido || d.autor || '').trim();
  out.push({
    id: `auto_${sourceCollection}_${sourceId}_${kind}`.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 128),
    sourceCollection, sourceId, kind, date,
    serviceType: serviceType.slice(0, 120),
    clientId: String(d.clientId || 'sem-cliente'),
    clientName: (clientName || 'Cliente não informado').slice(0, 200),
    ...technicianOf(d, fallbackName),
    notes,
    finished: finishedState(d.status),
  });
}

async function collectPlanned(fallbackName: string): Promise<Planned[]> {
  const out: Planned[] = [];
  const read = async (name: string) => {
    try { return (await getDocs(collection(db, name))).docs; } catch { return []; } // sem permissão: ignora
  };
  const [users, analyses, irrigation, topography, regularization, judicial] = await Promise.all([
    read('users'), read('analyses'), read('irrigation_projects'), read('topography_services'), read('regularization_services'), read('judicial_expertises'),
  ]);
  userNames = Object.fromEntries(users.map(u => [u.id, String(u.data().displayName || '')]));
  for (const s of analyses) {
    const d = s.data();
    const label = ANALYSIS_LABELS[d.type] || 'Serviço técnico';
    plan(out, 'analyses', s.id, 'data', d.scheduledDate, label, d, `Agendamento automático — ${label}${d.propertyName ? ` (${d.propertyName})` : ''}.`, fallbackName);
  }
  for (const s of irrigation) {
    const d = s.data();
    plan(out, 'irrigation_projects', s.id, 'data', d.scheduledDate, 'Projeto de Irrigação', d, `Agendamento automático — Projeto de Irrigação${d.propertyName ? ` (${d.propertyName})` : ''}.`, fallbackName);
  }
  for (const s of topography) {
    const d = s.data();
    const label = d.serviceLabel || 'Topografia';
    plan(out, 'topography_services', s.id, 'data', d.scheduledDate, label, d, `Agendamento automático — ${label}${d.propertyName ? ` (${d.propertyName})` : ''}.`, fallbackName);
  }
  for (const s of regularization) {
    const d = s.data();
    const proto = d.internalProtocol || s.id;
    plan(out, 'regularization_services', s.id, 'data', d.scheduledDate, 'Regularização Ambiental', d, `Agendamento automático — protocolo ${proto}${d.organ ? ` (${d.organ})` : ''}.`, fallbackName);
    plan(out, 'regularization_services', s.id, 'prazo', d.deadline, 'Prazo: Regularização Ambiental', d, `Prazo final do protocolo ${proto}${d.organ ? ` no ${d.organ}` : ''}.`, fallbackName);
  }
  for (const s of judicial) {
    const d = s.data();
    const proc = d.processNumber || d.numeroProcesso || '';
    plan(out, 'judicial_expertises', s.id, 'vistoria', d.visitaDate, 'Vistoria — Perícia Judicial', d, `Vistoria da perícia${proc ? ` (processo ${proc})` : ''}.`, fallbackName);
    // Prazo do laudo: some quando o laudo já foi entregue
    const laudoDone = /entregue|protocolad|conclu/i.test(String(d.laudoStatus || ''));
    plan(out, 'judicial_expertises', s.id, 'prazo', laudoDone ? '' : d.laudoDeadline, 'Prazo: entrega do laudo pericial', d, `Prazo de entrega do laudo${proc ? ` (processo ${proc})` : ''}.`, fallbackName);
  }
  return out;
}

let running: Promise<number> | null = null;

/**
 * Cria/atualiza os agendamentos automáticos. Devolve quantos foram criados ou
 * alterados. Nunca lança erro (é complementar ao salvamento do serviço).
 */
export function syncServiceAppointments(currentUserName = ''): Promise<number> {
  if (running) return running;
  running = (async () => {
    const uid = auth.currentUser?.uid;
    if (!uid) return 0;
    let changed = 0;
    const today = todayYMD();
    const planned = await collectPlanned(currentUserName).catch(() => [] as Planned[]);
    for (const p of planned) {
      try {
        const ref = doc(db, 'appointments', p.id);
        const snap = await getDoc(ref);
        const active = !!p.date && !p.finished;
        if (!snap.exists()) {
          // Só cria para data de HOJE em diante, com o serviço ainda em aberto
          if (!active || p.date < today || !p.technicianId) continue;
          await setDoc(ref, {
            clientId: p.clientId, clientName: p.clientName,
            technicianId: p.technicianId, technicianName: p.technicianName,
            serviceType: p.serviceType, date: p.date, time: p.kind === 'prazo' ? '08:00' : '08:00',
            status: 'scheduled', notes: p.notes,
            createdBy: uid, createdAt: new Date().toISOString(),
            notifiedEmail: false, notifiedWhatsapp: false,
            autoGenerated: true,
            source: { collection: p.sourceCollection, id: p.sourceId, kind: p.kind },
          });
          changed++;
          continue;
        }
        const cur: any = snap.data();
        if (!cur.autoGenerated || cur.status === 'completed' || cur.status === 'cancelled') continue;
        if (!active) {
          // Serviço concluído/cancelado ou sem data: fecha o agendamento
          await updateDoc(ref, { status: p.finished === 'completed' ? 'completed' : 'cancelled' });
          changed++;
        } else if (cur.date !== p.date || cur.clientName !== p.clientName || cur.serviceType !== p.serviceType || cur.technicianName !== p.technicianName) {
          // Data (ou cliente/técnico) mudou no serviço: o agendamento acompanha
          await updateDoc(ref, { date: p.date, clientId: p.clientId, clientName: p.clientName, serviceType: p.serviceType, notes: p.notes, technicianId: p.technicianId, technicianName: p.technicianName });
          changed++;
        }
      } catch {
        // sem permissão para alterar este agendamento (ex.: criado por outro técnico) — segue
      }
    }
    return changed;
  })().finally(() => { running = null; });
  return running;
}
