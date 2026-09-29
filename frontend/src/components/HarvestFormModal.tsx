import React, { useEffect, useMemo, useState } from 'react';
import { addDoc, collection, doc, updateDoc } from 'firebase/firestore';
import { Wheat, X, Save, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { db } from '../lib/firebase';
import { useAuth } from '../contexts/AuthContext';
import { logAudit } from '../lib/audit';
import { Client, Harvest, HarvestUnit, ServiceAnalysis } from '../types';
import { HARVEST_CROPS, HARVEST_UNITS, analysisDate, harvestYieldScHa, seasonOf } from '../lib/harvest';
import { parseDecimalBR, todayLocalDateString, formatDate } from '../lib/utils';

// Lançamento da COLHEITA REAL de um talhão/área. Quem lança no dia a dia é o
// consultor (que acompanha a lavoura); gerente e administrador também podem.
// Os clientes não entram no sistema, por isso não lançam direto.

export interface HarvestPrefill {
  clientId?: string;
  propertyName?: string;
  analysisId?: string;
  crop?: string;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  clients: Client[];
  analyses: ServiceAnalysis[];
  editing?: Harvest | null;
  prefill?: HarvestPrefill | null;
}

// "3.200" (ponto de milhar, sem vírgula) é 3200 sacas, não 3,2.
const parseQty = (v: string) => /^[1-9]\d{0,2}(\.\d{3})+$/.test((v || '').trim()) ? Number(v.trim().replace(/\./g, '')) : parseDecimalBR(v);

const empty = () => ({
  clientId: '', propertyName: '', plot: '', crop: 'Soja', season: '', harvestDate: todayLocalDateString(),
  quantity: '', unit: 'sc' as HarvestUnit, areaHa: '', analysisId: '', notes: '',
});

export default function HarvestFormModal({ isOpen, onClose, clients, analyses, editing, prefill }: Props) {
  const { user } = useAuth();
  const [form, setForm] = useState(empty());
  const [saving, setSaving] = useState(false);
  const set = (patch: Partial<ReturnType<typeof empty>>) => setForm(prev => ({ ...prev, ...patch }));

  useEffect(() => {
    if (!isOpen) return;
    if (editing) {
      setForm({
        clientId: editing.clientId, propertyName: editing.propertyName, plot: editing.plot || '', crop: editing.crop || 'Soja',
        season: editing.season || '', harvestDate: editing.harvestDate, quantity: String(editing.quantity).replace('.', ','),
        unit: editing.unit, areaHa: String(editing.areaHa).replace('.', ','), analysisId: editing.analysisId || '', notes: editing.notes || '',
      });
    } else {
      const f = empty();
      if (prefill?.clientId) f.clientId = prefill.clientId;
      if (prefill?.propertyName) f.propertyName = prefill.propertyName;
      if (prefill?.analysisId) f.analysisId = prefill.analysisId;
      if (prefill?.crop && HARVEST_CROPS.includes(prefill.crop)) f.crop = prefill.crop;
      const prop = clients.find(c => c.id === f.clientId)?.properties?.find(p => p.name === f.propertyName);
      if (prop?.areaHectares) f.areaHa = String(prop.areaHectares).replace('.', ',');
      setForm(f);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, editing?.id]);

  const client = clients.find(c => c.id === form.clientId);
  const soilAnalyses = useMemo(
    () => analyses.filter(a => a.type === 'soil' && a.clientId === form.clientId),
    [analyses, form.clientId],
  );
  const quantity = parseQty(form.quantity);
  const areaHa = parseQty(form.areaHa);
  const yieldScHa = harvestYieldScHa({ quantity, unit: form.unit, areaHa });
  const season = form.season || seasonOf(form.harvestDate);

  if (!isOpen) return null;

  const pickProperty = (name: string) => {
    const prop = client?.properties?.find(p => p.name === name);
    set({ propertyName: name, ...(prop?.areaHectares && !form.areaHa ? { areaHa: String(prop.areaHectares).replace('.', ',') } : {}) });
  };

  const handleSave = async () => {
    if (!user) return;
    if (!client) { toast.error('Escolha o cliente.'); return; }
    if (!form.propertyName.trim()) { toast.error('Informe a propriedade.'); return; }
    if (!form.harvestDate) { toast.error('Informe a data da colheita.'); return; }
    if (!(quantity > 0)) { toast.error('Informe a quantidade colhida.'); return; }
    if (!(areaHa > 0)) { toast.error('Informe a área colhida em hectares.'); return; }
    setSaving(true);
    try {
      const data = {
        clientId: client.id,
        clientName: client.name,
        propertyName: form.propertyName.trim(),
        plot: form.plot.trim(),
        crop: form.crop,
        season,
        harvestDate: form.harvestDate,
        quantity,
        unit: form.unit,
        areaHa,
        analysisId: form.analysisId || '',
        notes: form.notes.trim(),
        updatedAt: new Date().toISOString(),
      };
      const label = `${data.crop} · ${data.propertyName}${data.plot ? ' / ' + data.plot : ''}`;
      if (editing) {
        await updateDoc(doc(db, 'harvests', editing.id), data);
        logAudit({ userId: user.uid, userName: user.displayName || user.email || 'Usuário', action: 'updated', collection: 'harvests', recordId: editing.id, recordName: label, details: `Colheita editada: ${quantity} ${form.unit} em ${areaHa} ha.` });
        toast.success('Colheita atualizada.');
      } else {
        const ref = await addDoc(collection(db, 'harvests'), {
          ...data,
          createdBy: user.uid,
          createdByName: user.displayName || user.email || '',
          createdAt: new Date().toISOString(),
        });
        logAudit({ userId: user.uid, userName: user.displayName || user.email || 'Usuário', action: 'created', collection: 'harvests', recordId: ref.id, recordName: label, details: `Colheita lançada: ${quantity} ${form.unit} em ${areaHa} ha (${yieldScHa ?? '—'} sc/ha).` });
        toast.success('Colheita lançada.', { description: yieldScHa ? `Produtividade real: ${yieldScHa.toLocaleString('pt-BR')} sc/ha` : undefined });
      }
      onClose();
    } catch (err: any) {
      console.error('Erro ao salvar colheita:', err);
      toast.error('Não foi possível salvar a colheita.', { description: err?.message });
    } finally {
      setSaving(false);
    }
  };

  const input = 'w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-sm focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 outline-none';
  const label = 'text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1';

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm" data-harvest-form onClick={onClose}>
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl max-h-[92vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center"><Wheat className="w-5 h-5" /></div>
            <div>
              <h2 className="font-bold text-slate-800">{editing ? 'Editar colheita' : 'Lançar colheita real'}</h2>
              <p className="text-xs text-slate-500">Quantidade efetivamente colhida no talhão/área — é o que o Relatório de Eficiência usa.</p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600" aria-label="Fechar"><X className="w-5 h-5" /></button>
        </div>

        <div className="p-6 overflow-y-auto grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className={label}>Cliente</label>
            <select value={form.clientId} onChange={e => set({ clientId: e.target.value, propertyName: '', analysisId: '' })} className={input}>
              <option value="">Selecione o cliente...</option>
              {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className={label}>Propriedade</label>
            {client?.properties?.length ? (
              <select value={form.propertyName} onChange={e => pickProperty(e.target.value)} className={input}>
                <option value="">Selecione a propriedade...</option>
                {client.properties.map((p, i) => <option key={i} value={p.name}>{p.name}{p.areaHectares ? ` (${p.areaHectares} ha)` : ''}</option>)}
                {form.propertyName && !client.properties.some(p => p.name === form.propertyName) && <option value={form.propertyName}>{form.propertyName}</option>}
              </select>
            ) : (
              <input value={form.propertyName} onChange={e => set({ propertyName: e.target.value })} placeholder="Nome da propriedade" className={input} />
            )}
          </div>
          <div>
            <label className={label}>Talhão / área (opcional)</label>
            <input value={form.plot} onChange={e => set({ plot: e.target.value })} placeholder="Ex.: Talhão 3, Gleba Norte" className={input} />
          </div>
          <div>
            <label className={label}>Cultura</label>
            <select value={form.crop} onChange={e => set({ crop: e.target.value })} className={input}>
              {HARVEST_CROPS.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className={label}>Data da colheita</label>
            <input type="date" value={form.harvestDate} onChange={e => set({ harvestDate: e.target.value })} className={input} />
          </div>
          <div>
            <label className={label}>Safra</label>
            <input value={form.season} onChange={e => set({ season: e.target.value })} placeholder={seasonOf(form.harvestDate) || 'Ex.: 2025/2026'} className={input} />
          </div>
          <div>
            <label className={label}>Quantidade colhida</label>
            <input inputMode="decimal" value={form.quantity} onChange={e => set({ quantity: e.target.value })} placeholder="Ex.: 3.200" className={input} />
          </div>
          <div>
            <label className={label}>Unidade</label>
            <select value={form.unit} onChange={e => set({ unit: e.target.value as HarvestUnit })} className={input}>
              {HARVEST_UNITS.map(u => <option key={u.value} value={u.value}>{u.label}</option>)}
            </select>
          </div>
          <div>
            <label className={label}>Área colhida (ha)</label>
            <input inputMode="decimal" value={form.areaHa} onChange={e => set({ areaHa: e.target.value })} placeholder="Ex.: 50" className={input} />
          </div>
          <div>
            <label className={label}>Análise de solo da área (opcional)</label>
            <select value={form.analysisId} onChange={e => set({ analysisId: e.target.value })} className={input} disabled={!client}>
              <option value="">Vincular automaticamente (mesma propriedade)</option>
              {soilAnalyses.map(a => <option key={a.id} value={a.id}>{a.propertyName || 'Propriedade'} — {formatDate(analysisDate(a)) || 'sem data'}</option>)}
            </select>
          </div>
          <div className="sm:col-span-2">
            <label className={label}>Observações (opcional)</label>
            <input value={form.notes} onChange={e => set({ notes: e.target.value })} placeholder="Ex.: estiagem em janeiro, replantio parcial..." className={input} />
          </div>
          <div className="sm:col-span-2 rounded-2xl bg-emerald-50 border border-emerald-100 px-4 py-3 flex items-center justify-between">
            <span className="text-xs font-bold text-emerald-800 uppercase tracking-wider">Produtividade real</span>
            <span className="text-lg font-extrabold text-emerald-700">{yieldScHa != null ? `${yieldScHa.toLocaleString('pt-BR')} sc/ha` : '—'}</span>
          </div>
        </div>

        <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-2">
          <button onClick={onClose} className="px-5 py-2.5 rounded-xl text-sm font-bold text-slate-500 hover:bg-slate-50">Cancelar</button>
          <button onClick={handleSave} disabled={saving} className="px-5 py-2.5 rounded-xl text-sm font-bold bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-60 flex items-center gap-2">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} {editing ? 'Salvar alterações' : 'Lançar colheita'}
          </button>
        </div>
      </div>
    </div>
  );
}
