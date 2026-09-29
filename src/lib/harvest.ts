import { Harvest, HarvestUnit, ServiceAnalysis } from '../types';

// Colheita real → produtividade em sacas de 60 kg por hectare.
export const HARVEST_UNITS: { value: HarvestUnit; label: string; kg: number }[] = [
  { value: 'sc', label: 'Sacas (60 kg)', kg: 60 },
  { value: 'kg', label: 'Quilos (kg)', kg: 1 },
  { value: 't', label: 'Toneladas (t)', kg: 1000 },
  { value: 'arroba', label: 'Arrobas (15 kg)', kg: 15 },
];

export const HARVEST_CROPS = ['Soja', 'Milho', 'Feijão', 'Café', 'Algodão', 'Sorgo', 'Trigo', 'Arroz', 'Mandioca', 'Outra'];

/** Produtividade real em sc/ha (60 kg), ou null se faltar quantidade/área. */
export function harvestYieldScHa(h: Pick<Harvest, 'quantity' | 'unit' | 'areaHa'>): number | null {
  const kg = HARVEST_UNITS.find(u => u.value === h.unit)?.kg;
  const q = Number(h.quantity), a = Number(h.areaHa);
  if (!kg || !(q > 0) || !(a > 0)) return null;
  return Math.round(((q * kg) / 60 / a) * 10) / 10;
}

/** Safra agrícola de uma data (jul → jun): 2026-03-10 → "2025/2026". */
export function seasonOf(isoDate: string): string {
  const d = new Date((isoDate || '').slice(0, 10) + 'T00:00:00');
  if (isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  return d.getMonth() >= 6 ? `${y}/${y + 1}` : `${y - 1}/${y}`;
}

const norm = (s?: string) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();

/** Data de referência da análise (coleta agendada ou criação), AAAA-MM-DD. */
export function analysisDate(a: ServiceAnalysis): string {
  const raw: any = a.scheduledDate || (a as any).createdAt;
  if (!raw) return '';
  if (typeof raw === 'string') return raw.slice(0, 10);
  if (typeof raw?.toDate === 'function') return raw.toDate().toISOString().slice(0, 10);
  if (typeof raw?.seconds === 'number') return new Date(raw.seconds * 1000).toISOString().slice(0, 10);
  return '';
}

/**
 * Colheita que corresponde a uma análise de solo:
 *  1º a colheita vinculada explicitamente à análise;
 *  2º a primeira colheita do MESMO cliente e propriedade feita depois da análise
 *     (até 24 meses). Sem nenhuma → null (o relatório mostra "não informada").
 */
export function harvestForAnalysis(a: ServiceAnalysis, harvests: Harvest[]): Harvest | null {
  const linked = harvests.find(h => h.analysisId === a.id);
  if (linked) return linked;
  const aDate = analysisDate(a);
  const limit = aDate ? new Date(new Date(aDate + 'T00:00:00').getTime() + 730 * 86400000).toISOString().slice(0, 10) : '';
  const candidates = harvests
    .filter(h => !h.analysisId && h.clientId === a.clientId && norm(h.propertyName) === norm(a.propertyName))
    .filter(h => !aDate || (h.harvestDate >= aDate && h.harvestDate <= limit))
    .sort((x, y) => x.harvestDate.localeCompare(y.harvestDate));
  return candidates[0] || null;
}
