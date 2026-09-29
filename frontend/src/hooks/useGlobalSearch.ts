import { useState, useEffect, useRef } from 'react';
import { collection, getDocs, query, limit } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { canAccessNav, UserRole } from '../lib/permissions';
import { NAV_ITEMS } from '../constants/navigation';

export type SearchResult = {
  id: string;
  type: 'client' | 'service';
  title: string;
  subtitle: string;
  page: string;
  /** termo aplicado no campo de busca da página de destino */
  filter: string;
};

// Onde procurar: coleção → página de destino, rótulo e campos pesquisados.
// Só entram as coleções cujas páginas o cargo pode abrir (mesma regra do menu).
type Source = {
  col: string;
  page: string | ((d: any) => string);
  label: string | ((d: any) => string);
  type: SearchResult['type'];
  fields: (d: any) => (string | undefined | null)[];
  title: (d: any) => string;
  sub?: (d: any) => string;
  /** o que a página de destino deve filtrar (padrão: o título) */
  filter?: (d: any) => string;
};

const ANALYSIS_LABELS: Record<string, string> = {
  soil: 'Análise de Solo', water: 'Análise de Água', foliar: 'Análise Foliar', fertility: 'Análise de Fertilidade',
  topography: 'Topografia', irrigation: 'Irrigação', documentation: 'Regularização', credit: 'Crédito Rural',
  environmental_xray: 'Raio-X Ambiental',
};

const STATUS_PT: Record<string, string> = { pending: 'Pendente', completed: 'Concluído', in_progress: 'Em andamento', cancelled: 'Cancelado', scheduled: 'Agendado', confirmed: 'Confirmado', draft: 'Rascunho', active: 'Ativo', paid: 'Pago' };
const st = (s?: string) => (s ? STATUS_PT[s] || s : '');

const SOURCES: Source[] = [
  { col: 'clients', page: 'clients', label: 'Cliente', type: 'client', title: d => d.name,
    fields: d => [d.name, d.cpf, d.clientCode, d.phone, d.ownerEmail, d.address?.city, ...(d.properties || []).map((p: any) => p?.name)],
    sub: d => [d.address?.city, (d.properties || []).map((p: any) => p?.name).filter(Boolean).slice(0, 2).join(', ')].filter(Boolean).join(' · ') },
  { col: 'analyses', page: d => (d.type === 'credit' ? 'analysis_credit' : 'analysis'), label: d => ANALYSIS_LABELS[d.type] || 'Serviço', type: 'service',
    title: d => d.clientName || '—', fields: d => [d.clientName, d.propertyName, d.description, d.bank, d.financingType, ANALYSIS_LABELS[d.type]],
    sub: d => [d.propertyName, st(d.status)].filter(Boolean).join(' · ') },
  { col: 'field_visits', page: 'field_visits', label: 'Visita de Campo', type: 'service', title: d => d.clientName || '—',
    fields: d => [d.clientName, d.propertyName, d.objective, d.technicianName], sub: d => [d.visitDate?.split('-').reverse().join('/'), d.propertyName].filter(Boolean).join(' · ') },
  { col: 'appointments', page: 'scheduling', label: 'Agendamento', type: 'service', title: d => d.clientName || '—',
    fields: d => [d.clientName, d.serviceType, d.technicianName, d.notes], sub: d => [d.date?.split('-').reverse().join('/'), d.time, d.serviceType].filter(Boolean).join(' · ') },
  { col: 'judicial_expertises', page: 'judicial-expertise', label: 'Perícia Judicial', type: 'service', title: d => d.processNumber || d.clientName || '—',
    fields: d => [d.processNumber, d.clientName, d.requerente, d.requerido, d.comarca, d.propertyName], sub: d => [d.requerente, d.comarca].filter(Boolean).join(' · ') },
  { col: 'rural_valuations', page: 'rural_valuation', label: 'Avaliação de Imóvel', type: 'service', title: d => d.clientName || '—',
    fields: d => [d.clientName, d.propertyName, d.propertyCity], sub: d => [d.propertyName, d.propertyCity].filter(Boolean).join(' · ') },
  { col: 'irrigation_projects', page: 'analysis_irrigation', label: 'Projeto de Irrigação', type: 'service', title: d => d.clientName || '—',
    fields: d => [d.clientName, d.propertyName, d.responsible], sub: d => d.propertyName || '' },
  { col: 'topography_services', page: 'analysis_topography', label: 'Topografia', type: 'service', title: d => d.clientName || '—',
    fields: d => [d.clientName, d.propertyName, d.serviceLabel, d.technicalLicense], sub: d => [d.serviceLabel, d.propertyName].filter(Boolean).join(' · ') },
  { col: 'regularization_services', page: 'analysis_documentation', label: 'Regularização', type: 'service', title: d => d.internalProtocol || d.clientName || '—',
    fields: d => [d.internalProtocol, d.protocolNumber, d.clientName, d.propertyName, d.organ], sub: d => [d.clientName, d.propertyName].filter(Boolean).join(' · ') },
  { col: 'contracts', page: 'contracts', label: 'Contrato', type: 'service', title: d => d.contractNumber || d.clientName || '—',
    fields: d => [d.contractNumber, d.clientName, d.category], sub: d => [d.clientName, d.category].filter(Boolean).join(' · ') },
  { col: 'financials', page: 'financial', label: 'Lançamento Financeiro', type: 'service', title: d => d.description || d.clientName || '—',
    fields: d => [d.description, d.clientName, d.category], sub: d => [d.clientName, typeof d.value === 'number' ? d.value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : ''].filter(Boolean).join(' · ') },
  { col: 'vehicles', page: 'vehicles', label: 'Veículo', type: 'service', title: d => [d.plate, d.model].filter(Boolean).join(' — ') || '—', filter: d => d.plate || d.model || '',
    fields: d => [d.plate, d.model, d.brand] },
  { col: 'inventory_items', page: 'inventory', label: 'Insumo', type: 'service', title: d => d.name || '—',
    fields: d => [d.name, d.category, d.supplier, d.lotNumber] },
  { col: 'users', page: 'users', label: 'Colaborador', type: 'client', title: d => d.displayName || d.email || '—',
    fields: d => [d.displayName, d.email, d.registrationNumber], sub: d => d.email || '' },
];

// Mesma verificação do menu: a página é traduzida para a chave de permissão (NAV_ITEMS).
const canOpen = (role: string, page: string) => {
  const item = NAV_ITEMS.find(i => i.id === page || i.key === page);
  return canAccessNav(role as UserRole, item ? item.key : page);
};

const norm = (s: unknown) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const CACHE_MS = 2 * 60 * 1000;

export function useGlobalSearch(searchTerm: string, role?: UserRole | string | null) {
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const cache = useRef<{ at: number; role?: string; data: Record<string, any[]> } | null>(null);

  useEffect(() => {
    if (searchTerm.trim().length < 2) {
      setResults([]);
      return;
    }
    let cancelled = false;
    const handler = setTimeout(async () => {
      setLoading(true);
      try {
        const sources = SOURCES.filter(s => {
          const pages = typeof s.page === 'string' ? [s.page] : ['analysis', 'analysis_credit'];
          return role ? pages.some(p => canOpen(role, p)) : false;
        });
        // Carrega uma vez e reaproveita por 2 minutos (o escritório tem poucos milhares de registros)
        if (!cache.current || cache.current.role !== role || Date.now() - cache.current.at > CACHE_MS) {
          const data: Record<string, any[]> = {};
          await Promise.all(sources.map(async s => {
            try {
              const snap = await getDocs(query(collection(db, s.col), limit(1000)));
              data[s.col] = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            } catch {
              data[s.col] = []; // sem permissão para esta coleção: simplesmente não aparece
            }
          }));
          cache.current = { at: Date.now(), role: role || undefined, data };
        }
        const terms = norm(searchTerm).split(/\s+/).filter(Boolean);
        const out: SearchResult[] = [];
        for (const s of sources) {
          for (const d of cache.current.data[s.col] || []) {
            // CPF/placa/protocolo: compara também sem pontuação
            const labelTxt = typeof s.label === 'function' ? s.label(d) : s.label;
            const hay = [...s.fields(d), labelTxt].filter(Boolean).map(norm).join(' | ');
            const hayCompact = hay.replace(/[^a-z0-9|]/g, '');
            if (!terms.every(t => hay.includes(t) || hayCompact.includes(t.replace(/[^a-z0-9]/g, '')))) continue;
            if (s.col === 'analyses' && ['irrigation', 'topography', 'documentation'].includes(d.type)) continue;
            const label = labelTxt;
            const page = typeof s.page === 'function' ? s.page(d) : s.page;
            if (role && !canOpen(role, page)) continue;
            const sub = s.sub ? s.sub(d) : '';
            out.push({ id: `${s.col}:${d.id}`, type: s.type, title: s.title(d) || '—', subtitle: sub ? `${label} · ${sub}` : label, page, filter: (s.filter ? s.filter(d) : s.title(d)) || '' });
            if (out.length >= 40) break;
          }
          if (out.length >= 40) break;
        }
        if (!cancelled) setResults(out);
      } catch (err) {
        console.error('Search error:', err);
        if (!cancelled) setResults([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 300);

    return () => { cancelled = true; clearTimeout(handler); };
  }, [searchTerm, role]);

  return { results, loading };
}
