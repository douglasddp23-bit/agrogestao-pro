import React, { useEffect, useState } from 'react';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { FileCog, Save, Building2, Percent, Hash, PlugZap, Wrench, ShieldAlert, CheckCircle2, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { db } from '../lib/firebase';
import { useAuth } from '../contexts/AuthContext';
import { can } from '../lib/permissions';
import { cn } from '../lib/utils';
import { logAudit } from '../lib/audit';
import { runExclusive } from '../lib/submitGuard';
import { PageTitle, PAGE_HEADER_CLASS } from '../components/layout/PageHeader';
import { fiscalStatus, useFiscalSettings } from '../lib/billing/service';
import { SERVICE_CATEGORIES } from '../lib/billing/sources';
import { FISCAL_DOC_LABELS, FiscalSettings, ServiceFiscalConfig } from '../lib/billing/types';

// Configuração fiscal da empresa (só Administrador). Nenhuma regra tributária
// fica fixa no código: códigos, alíquotas, séries e retenções são informados
// aqui pelo escritório/contador. Senhas, certificado e chave do provedor NÃO
// ficam aqui — ficam só no arquivo de chaves do servidor (FISCAL_* no .env.local).

const EMPTY: FiscalSettings = {
  razaoSocial: '', nomeFantasia: '', cnpj: '', inscricaoMunicipal: '', inscricaoEstadual: '',
  endereco: '', numero: '', bairro: '', municipio: '', codigoMunicipioIbge: '', uf: '', cep: '', email: '', telefone: '',
  regimeTributario: '', ambiente: 'homologacao', serieNfse: '', serieNfe: '', proximoNumeroNfse: '', proximoNumeroNfe: '',
  naturezaOperacao: '', codigoServicoPadrao: '', aliquotaPadrao: '', retencoes: '', municipioIncidencia: '', cfopPadrao: '',
  provedorObservacoes: '', serviceTypes: {},
};

const label = 'text-[10px] font-bold text-slate-500 uppercase';

function Card({ icon: Icon, title, children, hint }: { icon: any; title: string; children: React.ReactNode; hint?: string }) {
  return (
    <div className="glass-card p-6 rounded-3xl border border-white/40 space-y-4">
      <div>
        <h3 className="font-display font-bold text-slate-800 flex items-center gap-2"><Icon className="w-4 h-4 text-emerald-600" /> {title}</h3>
        {hint && <p className="text-[11px] text-slate-500 mt-0.5">{hint}</p>}
      </div>
      {children}
    </div>
  );
}

export default function FiscalSettingsPage() {
  const { user } = useAuth();
  const role = (user?.effectiveRole ?? user?.role) as string | undefined;
  const isAdmin = can(role, 'fiscal.configurar');
  const stored = useFiscalSettings(can(role, 'fiscal.visualizar'));
  const [form, setForm] = useState<FiscalSettings>(EMPTY);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [provider, setProvider] = useState<{ configured: boolean; provider: string; environment: string } | null>(null);

  useEffect(() => {
    if (stored && !loaded) {
      (async () => {
        let next = { ...EMPTY, ...(stored as FiscalSettings) };
        // Primeira vez: aproveita nome da empresa já cadastrado em "Configurar Marca"
        if (!next.razaoSocial) {
          try { const b = await getDoc(doc(db, 'settings', 'branding')); if (b.exists()) next = { ...next, nomeFantasia: next.nomeFantasia || (b.data() as any).companyName || '' }; } catch { /* sem marca */ }
        }
        setForm(next); setLoaded(true);
      })();
    }
  }, [stored, loaded]);

  useEffect(() => { fiscalStatus().then(setProvider).catch(() => setProvider(null)); }, []);

  const set = (patch: Partial<FiscalSettings>) => setForm(f => ({ ...f, ...patch }));
  const setService = (id: string, patch: Partial<ServiceFiscalConfig>) => setForm(f => {
    const base: ServiceFiscalConfig = f.serviceTypes?.[id] || { label: SERVICE_CATEGORIES.find(c => c.id === id)?.label || id, category: id, fiscalCode: '', aliquota: '', kind: 'service', defaultDoc: 'NFSE' };
    return { ...f, serviceTypes: { ...(f.serviceTypes || {}), [id]: { ...base, ...patch } } };
  });

  const field = (k: keyof FiscalSettings, l: string, ph = '', max = 200) => (
    <div className="space-y-1">
      <label className={label}>{l}</label>
      <input value={(form[k] as string) || ''} onChange={e => set({ [k]: e.target.value } as any)} disabled={!isAdmin} maxLength={max} className="w-full glass-input disabled:opacity-70" placeholder={ph} data-fiscal-field={k} />
    </div>
  );

  const save = () => runExclusive('FiscalSettings.save', async () => {
    const digits = form.cnpj.replace(/\D/g, '');
    if (form.cnpj && digits.length !== 14) { toast.error('CNPJ deve ter 14 dígitos.'); return; }
    if (form.cep && form.cep.replace(/\D/g, '').length !== 8) { toast.error('CEP deve ter 8 dígitos.'); return; }
    if (form.uf && !/^[A-Za-z]{2}$/.test(form.uf)) { toast.error('UF deve ter 2 letras (ex.: MG).'); return; }
    setSaving(true);
    try {
      const payload = { ...form, uf: form.uf.toUpperCase(), updatedAt: new Date().toISOString(), updatedBy: user?.uid || '' };
      await setDoc(doc(db, 'fiscal_settings', 'company'), payload, { merge: true });
      await logAudit({ userId: user?.uid || '', userName: user?.displayName || user?.email || 'Administrador', action: 'updated', collection: 'fiscal_settings', recordId: 'company', recordName: 'Configuração fiscal da empresa', details: 'Configuração fiscal atualizada.' });
      toast.success('Configuração fiscal salva.');
    } catch (e: any) {
      toast.error(e?.code === 'permission-denied' ? 'Somente o Administrador altera a configuração fiscal.' : 'Não foi possível salvar.');
    } finally { setSaving(false); }
  });

  if (!can(role, 'fiscal.visualizar')) {
    return <div className="flex flex-col items-center justify-center h-full p-8 text-center bg-white rounded-3xl border border-slate-200"><h3 className="text-xl font-display font-bold text-rose-500">Acesso Restrito</h3><p className="text-sm text-slate-500 mt-2">Configuração fiscal: somente Administrador.</p></div>;
  }

  return (
    <div className="flex flex-col gap-6 h-full overflow-y-auto pr-2 pb-10 custom-scrollbar" data-fiscal-settings>
      <header className={PAGE_HEADER_CLASS} data-page-header>
        <PageTitle icon={FileCog} title="Configuração Fiscal" subtitle="Dados do emitente, tributação e numeração usados na emissão de NFS-e / NF-e" />
        {isAdmin ? (
          <button onClick={save} disabled={saving} className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-2xl text-xs font-bold uppercase tracking-wider flex items-center gap-2 shadow-lg shadow-emerald-600/20 disabled:opacity-50" data-fiscal-save>
            <Save className="w-4 h-4" /> {saving ? 'Salvando...' : 'Salvar'}
          </button>
        ) : <span className="text-[11px] font-bold text-slate-500 uppercase">Somente leitura — alteração exclusiva do Administrador</span>}
      </header>

      <div className="p-4 rounded-2xl bg-amber-50 border border-amber-200 text-xs text-amber-900 flex gap-2">
        <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" />
        <div>Os códigos de serviço, alíquotas, retenções e o regime tributário devem ser informados pelo seu <strong>contador</strong> — o sistema não presume nenhuma regra tributária. Senha, certificado digital e chave do provedor fiscal <strong>não</strong> são digitados aqui: ficam protegidos no arquivo de chaves do servidor.</div>
      </div>

      <Card icon={PlugZap} title="Provedor fiscal" hint="Empresa/serviço que transmite as notas à prefeitura (NFS-e) e à SEFAZ (NF-e). Ainda não contratado.">
        <div className={cn('p-3 rounded-2xl text-xs flex gap-2', provider?.configured ? 'bg-emerald-50 text-emerald-800' : 'bg-slate-50 text-slate-600')} data-fiscal-provider>
          {provider?.configured ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <AlertTriangle className="w-4 h-4 shrink-0" />}
          <span>{provider ? (provider.configured ? `Provedor configurado: ${provider.provider} · ambiente ${provider.environment || '—'}.` : 'Nenhum provedor configurado — a emissão fica bloqueada até configurar as variáveis FISCAL_* no arquivo de chaves do servidor.') : 'Não foi possível consultar o servidor.'}</span>
        </div>
        <div className="space-y-1">
          <label className={label}>Configurações específicas do provedor (sem senhas)</label>
          <textarea value={form.provedorObservacoes} onChange={e => set({ provedorObservacoes: e.target.value })} disabled={!isAdmin} rows={3} maxLength={5000} className="w-full glass-input disabled:opacity-70" placeholder="Ex.: código do município no provedor, padrão ABRASF, observações do contador" />
        </div>
      </Card>

      <Card icon={Building2} title="Dados do emitente (empresa)">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {field('razaoSocial', 'Razão social')}
          {field('nomeFantasia', 'Nome fantasia')}
          {field('cnpj', 'CNPJ', '00.000.000/0000-00', 20)}
          {field('inscricaoMunicipal', 'Inscrição municipal', '', 30)}
          {field('inscricaoEstadual', 'Inscrição estadual', 'Isento, se não houver', 30)}
          {field('email', 'E-mail fiscal')}
          {field('telefone', 'Telefone', '', 30)}
          {field('endereco', 'Endereço (logradouro)')}
          {field('numero', 'Número', '', 20)}
          {field('bairro', 'Bairro')}
          {field('municipio', 'Município')}
          {field('codigoMunicipioIbge', 'Código IBGE do município', '7 dígitos', 10)}
          {field('uf', 'UF', 'MG', 2)}
          {field('cep', 'CEP', '00000-000', 10)}
        </div>
      </Card>

      <Card icon={Percent} title="Tributação" hint="Tudo informado pelo contador — nada é calculado por regra fixa.">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {field('regimeTributario', 'Regime tributário', 'Ex.: Simples Nacional')}
          {field('naturezaOperacao', 'Natureza da operação', 'Ex.: Tributação no município')}
          {field('codigoServicoPadrao', 'Código do serviço padrão', 'Conforme lista do município', 30)}
          {field('aliquotaPadrao', 'Alíquota padrão (%)', 'Ex.: 2,00', 10)}
          {field('municipioIncidencia', 'Município de incidência')}
          {field('cfopPadrao', 'CFOP padrão (NF-e)', '', 10)}
        </div>
        <div className="space-y-1">
          <label className={label}>Retenções</label>
          <textarea value={form.retencoes} onChange={e => set({ retencoes: e.target.value })} disabled={!isAdmin} rows={2} maxLength={2000} className="w-full glass-input disabled:opacity-70" placeholder="Ex.: ISS retido pelo tomador quando..., IR, PIS/COFINS/CSLL (conforme orientação do contador)" />
        </div>
      </Card>

      <Card icon={Hash} title="Emissão e numeração">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="space-y-1">
            <label className={label}>Ambiente de emissão</label>
            <select value={form.ambiente} onChange={e => set({ ambiente: e.target.value as any })} disabled={!isAdmin} className="w-full glass-input text-xs disabled:opacity-70">
              <option value="homologacao">Homologação (testes, sem valor fiscal)</option>
              <option value="producao">Produção (notas reais)</option>
            </select>
          </div>
          {field('serieNfse', 'Série NFS-e', '', 10)}
          {field('proximoNumeroNfse', 'Próximo número NFS-e', '', 15)}
          {field('serieNfe', 'Série NF-e', '', 10)}
          {field('proximoNumeroNfe', 'Próximo número NF-e', '', 15)}
        </div>
      </Card>

      <Card icon={Wrench} title="Campos fiscais por tipo de serviço" hint="Usados automaticamente no faturamento quando o item é desse tipo de serviço.">
        <div className="rounded-2xl border border-slate-100 overflow-x-auto">
          <table className="w-full text-xs min-w-[640px]">
            <thead className="bg-slate-50 text-[10px] uppercase text-slate-500"><tr><th className="p-2 text-left">Serviço</th><th className="p-2 text-left">Código fiscal</th><th className="p-2 text-left">Alíquota (%)</th><th className="p-2 text-left">Tipo</th><th className="p-2 text-left">Documento padrão</th></tr></thead>
            <tbody>
              {SERVICE_CATEGORIES.map(c => {
                const cfg = form.serviceTypes?.[c.id];
                return (
                  <tr key={c.id} className="border-t border-slate-100" data-service-fiscal={c.id}>
                    <td className="p-2 font-bold text-slate-700">{c.label}</td>
                    <td className="p-2"><input value={cfg?.fiscalCode || ''} onChange={e => setService(c.id, { fiscalCode: e.target.value })} disabled={!isAdmin} maxLength={30} className="glass-input text-xs py-1 w-32" /></td>
                    <td className="p-2"><input value={cfg?.aliquota || ''} onChange={e => setService(c.id, { aliquota: e.target.value })} disabled={!isAdmin} maxLength={10} className="glass-input text-xs py-1 w-20" /></td>
                    <td className="p-2">
                      <select value={cfg?.kind || 'service'} onChange={e => setService(c.id, { kind: e.target.value as any })} disabled={!isAdmin} className="glass-input text-xs py-1">
                        <option value="service">Serviço</option><option value="product">Produto</option>
                      </select>
                    </td>
                    <td className="p-2">
                      <select value={cfg?.defaultDoc || 'NFSE'} onChange={e => setService(c.id, { defaultDoc: e.target.value as any })} disabled={!isAdmin} className="glass-input text-xs py-1">
                        {Object.entries(FISCAL_DOC_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                      </select>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
