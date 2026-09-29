import React, { useState, useEffect, useMemo } from 'react';
import {
  Droplet,
  ArrowRight,
  ArrowLeft,
  FileText,
  Download,
  Calculator,
  Zap,
  Sprout,
  CloudRain,
  ShieldCheck,
  BookOpen,
  User,
  CheckCircle2,
  Trash2,
  Plus,
  X,
  Search,
  Wallet,
  Clock,
  LandPlot,
  Edit3,
  ChevronRight,
  Save,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';
import { cn, formatDate, handleFirestoreError, OperationType, todayLocalDateString } from '../lib/utils';
import { collection, onSnapshot, query, orderBy, addDoc, serverTimestamp, deleteDoc, doc, updateDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { Client } from '../types';
import { useAuth } from '../contexts/AuthContext';
import { runExclusive } from '../lib/submitGuard';
import { buildServiceReportPDF } from '../lib/pdfBranding';

import ConfirmationModal from '../components/ConfirmationModal';
import { PageTitle, PAGE_HEADER_CLASS } from '../components/layout/PageHeader';
import { Droplet as PageIcon } from 'lucide-react';
import ServiceKpiCards, { formatBRL, isThisMonth, toDateAny } from '../components/service/ServiceKpiCards';
import {
  PricingFields, ResponsibleFields, WizardSteps, computePricing, emptyPricing, registryLabel, responsibleFromProfile,
  ServicePricing, ResponsibleTech,
} from '../components/service/ServiceFormParts';
import { useInitialSearch } from '../hooks/useInitialSearch';

// ─── Cálculos (mesmas fórmulas de antes; só saíram do componente para poderem
//     ser usadas também no PDF de projetos já salvos) ──────────────────────────
type Hydraulic = { length: number; diameter: number; flow: number; cFactor: number };
type Pump = { staticHead: number; servicePressure: number; efficiency: number };
type Demand = { eto: number; kc: number; area: number };
type Soil = { cc: number; pmp: number; ds: number; z: number; f: number; ia: number };

const emptyHydraulic = (): Hydraulic => ({ length: 0, diameter: 0, flow: 0, cFactor: 140 });
const emptyPump = (): Pump => ({ staticHead: 0, servicePressure: 0, efficiency: 75 });
const emptyDemand = (): Demand => ({ eto: 0, kc: 0, area: 0 });
const emptySoil = (): Soil => ({ cc: 0, pmp: 0, ds: 0, z: 0, f: 0.5, ia: 0 });

function computeIrrigation(h: Hydraulic, p: Pump, d: Demand, s: Soil, appEfficiency: number) {
  // Hazen-Williams: hf = 10.65 * L * (Q/C)^1.852 / D^4.87
  let headLoss = 0;
  if (h.length && h.diameter && h.flow) {
    const qS = h.flow / 3600;
    const dM = h.diameter / 1000;
    headLoss = Number(((10.65 * h.length * Math.pow(qS / h.cFactor, 1.852)) / Math.pow(dM, 4.87)).toFixed(2));
  }
  // v = Q / A
  let velocity = 0;
  if (h.flow && h.diameter) {
    velocity = Number(((h.flow / 3600) / (Math.PI * Math.pow(h.diameter / 2000, 2))).toFixed(2));
  }
  const totalHead = Number((p.staticHead + p.servicePressure + headLoss).toFixed(2));
  let pumpPower = 0;
  if (h.flow && totalHead) {
    const qLps = (h.flow * 1000) / 3600;
    pumpPower = Number(((qLps * totalHead) / (75 * (p.efficiency / 100))).toFixed(2));
  }
  const netDemand = Number((d.eto * d.kc).toFixed(2));
  // Lâmina bruta = ETc / Ea
  const grossDemand = netDemand && appEfficiency ? Number((netDemand / (appEfficiency / 100)).toFixed(2)) : 0;
  const netWaterDay = Number((netDemand * d.area * 10).toFixed(2));
  const totalWaterDay = Number((grossDemand * d.area * 10).toFixed(2));
  // Turno de rega (opcional): CRA = (CC − PMP)/10 · Ds · Z; IRN = CRA · f; TR = IRN / ETc; LB = TR·ETc / Ea; Ti = LB / Ia
  let schedule: null | { cra: number; irnMax: number; trMax: number; tr: number; irn: number; lb: number; ti: number; warning: boolean } = null;
  if (s.cc && s.ds && s.z && s.f && s.cc > s.pmp && netDemand && appEfficiency) {
    const cra = ((s.cc - s.pmp) / 10) * s.ds * s.z;
    const irnMax = cra * s.f;
    const trMax = irnMax / netDemand;
    const tr = Math.max(1, Math.floor(trMax));
    const irn = tr * netDemand;
    const lb = irn / (appEfficiency / 100);
    const ti = s.ia ? lb / s.ia : 0;
    schedule = {
      cra: Number(cra.toFixed(2)), irnMax: Number(irnMax.toFixed(2)), trMax: Number(trMax.toFixed(2)), tr,
      irn: Number(irn.toFixed(2)), lb: Number(lb.toFixed(2)), ti: Number(ti.toFixed(2)), warning: trMax < 1,
    };
  }
  return { headLoss, velocity, totalHead, pumpPower, netDemand, grossDemand, appEfficiency, netWaterDay, totalWaterDay, schedule };
}

// ─── Situação ────────────────────────────────────────────────────────────────
const STATUSES = ['Em Andamento', 'Concluído', 'Cancelado'] as const;
const statusOf = (p: any): string => (p.status === 'Finalizado' ? 'Concluído' : p.status || 'Em Andamento');
const STATUS_STYLE: Record<string, string> = {
  'Em Andamento': 'bg-amber-100 text-amber-700',
  'Concluído': 'bg-emerald-100 text-emerald-700',
  'Cancelado': 'bg-slate-200 text-slate-600',
};
const systemLabel = (t?: string | null) => (t === 'drip' ? 'Gotejamento' : t === 'sprinkler' ? 'Aspersão' : 'Não definido');

const STEPS = ['Cliente', 'Tubulação e Bomba', 'Demanda e Sistema', 'Valor do Serviço', 'Responsável e PDF'];

const REFERENCES = [
  'BERNARDO, S.; MANTOVANI, E. C.; SILVA, D. D.; SOARES, A. A. Manual de Irrigação. 9. ed. Viçosa: Ed. UFV, 2019.',
  'ALLEN, R. G.; PEREIRA, L. S.; RAES, D.; SMITH, M. Crop evapotranspiration: Guidelines for computing water requirements. FAO Irrigation and Drainage Paper 56. Rome, 1998.',
  'HAZEN, A.; WILLIAMS, G. S. Hydraulic Tables. New York: John Wiley & Sons, 1920.',
  'ASSOCIAÇÃO BRASILEIRA DE NORMAS TÉCNICAS. NBR 14197: Equipamentos de irrigação — aspersão convencional — critérios para o projeto.',
];

// ─── PDF do projeto (mesmo padrão do Crédito Rural: logo, cliente, dados, responsável) ─
async function generateIrrigationPDF(project: any, client?: Client) {
  const h: Hydraulic = { ...emptyHydraulic(), ...(project.inputs?.hydraulic || {}) };
  const p: Pump = { ...emptyPump(), ...(project.inputs?.pump || {}) };
  const d: Demand = { ...emptyDemand(), ...(project.inputs?.demand || {}) };
  const s: Soil = { ...emptySoil(), ...(project.inputs?.soil || {}) };
  const ea = project.results?.appEfficiency || project.appEfficiency || 0;
  const r = computeIrrigation(h, p, d, s, ea);
  const qS = h.flow / 3600;
  const qLps = (h.flow * 1000) / 3600;
  const pricing = computePricing(project.pricing, d.area);
  const resp: Partial<ResponsibleTech> = project.responsibleTech || { name: project.responsible };

  const memoria = [
    '1) Perda de carga — Hazen-Williams: hf = 10,65 · L · (Q/C)^1,852 · D^-4,87',
    `   Q = ${h.flow} m³/h = ${qS.toFixed(6)} m³/s;  D = ${h.diameter} mm = ${(h.diameter / 1000).toFixed(4)} m`,
    `   hf = 10,65 · ${h.length} · (${qS.toFixed(6)} / ${h.cFactor})^1,852 · ${(h.diameter / 1000).toFixed(4)}^-4,87 = ${r.headLoss} mca`,
    `   Velocidade: v = Q / A = ${r.velocity} m/s${r.velocity > 2 ? '  (ACIMA de 2,0 m/s — rever diâmetro)' : ''}`,
    '2) Altura manométrica e potência',
    `   HMT = ${p.staticHead} + ${p.servicePressure} + ${r.headLoss} = ${r.totalHead} mca`,
    `   P (cv) = Q(L/s) · HMT / (75 · rendimento) = (${qLps.toFixed(2)} · ${r.totalHead}) / (75 · ${p.efficiency / 100}) = ${r.pumpPower} cv`,
    '3) Necessidade hídrica (FAO-56)',
    `   ETc = ETo · Kc = ${d.eto} · ${d.kc} = ${r.netDemand} mm/dia`,
    ea
      ? `   Lâmina bruta = ETc / Ea = ${r.netDemand} / ${ea / 100} = ${r.grossDemand} mm/dia`
      : '   Eficiência de aplicação não informada — lâmina bruta não calculada.',
    `   Volume a captar = ${ea ? r.grossDemand : r.netDemand} · ${d.area} · 10 = ${ea ? r.totalWaterDay : r.netWaterDay} m³/dia`,
    ...(r.schedule ? [
      '4) Turno de rega',
      `   CRA = (${s.cc} - ${s.pmp})/10 · ${s.ds} · ${s.z} = ${r.schedule.cra} mm;  IRN = CRA · ${s.f} = ${r.schedule.irnMax} mm`,
      `   TR = IRN / ETc = ${r.schedule.trMax} -> TR adotado ${r.schedule.tr} dia(s);  lâmina bruta por irrigação = ${r.schedule.lb} mm` +
        (r.schedule.ti ? `;  tempo de irrigação = ${r.schedule.ti} h` : ''),
      ...(r.schedule.warning ? ['   ATENÇÃO: o solo não armazena 1 dia de consumo — irrigar mais de uma vez ao dia.'] : []),
    ] : []),
  ].join('\n');

  const pdf = await buildServiceReportPDF({
    documentTitle: 'Projeto de Irrigação — Memorial Técnico',
    serviceName: `Sistema: ${systemLabel(project.type)} · Situação: ${statusOf(project)}`,
    client: {
      name: project.clientName,
      cpf: client?.cpf,
      property: project.propertyName,
      city: client?.address?.city ? `${client.address.city}${client.address.state ? '/' + client.address.state : ''}` : undefined,
    },
    sections: [
      {
        title: 'Dados Técnicos do Projeto',
        rows: [
          ['Sistema de irrigação', systemLabel(project.type)],
          ['Área irrigada', `${d.area} ha`],
          ['Tubulação: comprimento / diâmetro', `${h.length} m / ${h.diameter} mm (C = ${h.cFactor})`],
          ['Vazão do trecho', `${h.flow} m³/h`],
          ['Desnível / pressão de serviço', `${p.staticHead} m / ${p.servicePressure} mca`],
          ['Rendimento da bomba', `${p.efficiency} %`],
          ['ETo / Kc', `${d.eto} mm/dia / ${d.kc}`],
          ['Eficiência de aplicação (Ea)', ea ? `${ea} %` : '—'],
          ['Data prevista de execução', project.scheduledDate ? formatDate(project.scheduledDate) : '—'],
        ],
      },
      {
        title: 'Resultados',
        rows: [
          ['Perda de carga (hf)', `${r.headLoss} mca`],
          ['Velocidade na tubulação', `${r.velocity} m/s`],
          ['Altura manométrica total (HMT)', `${r.totalHead} mca`],
          ['Potência mínima da bomba', `${r.pumpPower} cv`],
          ['Lâmina líquida (ETc)', `${r.netDemand} mm/dia`],
          ['Lâmina bruta', ea ? `${r.grossDemand} mm/dia` : '—'],
          ['Volume diário a captar', `${ea ? r.totalWaterDay : r.netWaterDay} m³/dia`],
          ...(r.schedule ? [
            ['Turno de rega adotado', `${r.schedule.tr} dia(s)`] as [string, string],
            ['Lâmina bruta por irrigação', `${r.schedule.lb} mm`] as [string, string],
            ...(r.schedule.ti ? [['Tempo de irrigação', `${r.schedule.ti} h`] as [string, string]] : []),
          ] : []),
        ],
      },
      { title: 'Memória de Cálculo', text: memoria },
      { title: 'Valor do Serviço', rows: pricing.rows },
      {
        title: 'Justificativa Técnica e Planejamento',
        text: [
          project.technicalJustification || (project.type === 'drip'
            ? 'O gotejamento foi selecionado visando a máxima eficiência no uso da água e energia, com aplicação direta na zona radicular.'
            : project.type === 'sprinkler'
              ? 'A aspersão foi escolhida pela versatilidade na cobertura de grandes áreas e adaptação a diferentes topografias.'
              : ''),
          project.planningNotes || 'Implantar conforme diâmetros e potências aqui descritos. Recomenda-se ventosas nos pontos altos e válvulas de descarga nos pontos baixos da rede.',
        ].filter(Boolean).join('\n\n'),
      },
      { title: 'Referências', text: REFERENCES.join('\n') },
    ],
    responsible: resp.name || project.responsible || 'Responsável Técnico',
    certification: registryLabel(resp),
  });
  pdf.save(`Projeto_Irrigacao_${(project.clientName || 'Cliente').replace(/\s+/g, '_')}.pdf`);
}

// ─── Página ──────────────────────────────────────────────────────────────────
export default function Irrigation() {
  const { user } = useAuth();
  const role = (user?.effectiveRole ?? user?.role) as string;
  const readOnly = role === 'staff' || role === 'consultant';
  const isAdmin = role === 'admin';

  const [clients, setClients] = useState<Client[]>([]);
  const [projects, setProjects] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  useInitialSearch(setSearchTerm); // termo vindo da Busca Global
  const [statusFilter, setStatusFilter] = useState('all');
  const [viewing, setViewing] = useState<any | null>(null);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState<string | null>(null);

  // Formulário (janela em etapas)
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [step, setStep] = useState(0);
  const [isSaving, setIsSaving] = useState(false);
  const [selectedClientId, setSelectedClientId] = useState('');
  const [propertyName, setPropertyName] = useState('');
  const [scheduledDate, setScheduledDate] = useState(todayLocalDateString());
  const [irrigationType, setIrrigationType] = useState<'drip' | 'sprinkler' | null>(null);
  const [technicalJustification, setTechnicalJustification] = useState('');
  const [planningNotes, setPlanningNotes] = useState('');
  const [hydraulic, setHydraulic] = useState<Hydraulic>(emptyHydraulic());
  const [pump, setPump] = useState<Pump>(emptyPump());
  const [demand, setDemand] = useState<Demand>(emptyDemand());
  const [soil, setSoil] = useState<Soil>(emptySoil());
  const [appEfficiency, setAppEfficiency] = useState(0);
  const [pricing, setPricing] = useState<ServicePricing>(emptyPricing());
  const [responsibleTech, setResponsibleTech] = useState<ResponsibleTech>(responsibleFromProfile(user));

  useEffect(() => {
    const unsubClients = onSnapshot(query(collection(db, 'clients'), orderBy('name', 'asc')), (snap) => {
      setClients(snap.docs.map(d => ({ id: d.id, ...d.data() } as Client)));
    }, (error) => handleFirestoreError(error, OperationType.LIST, 'clients'));
    const unsubProjects = onSnapshot(query(collection(db, 'irrigation_projects'), orderBy('createdAt', 'desc')), (snap) => {
      setProjects(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      setLoading(false);
    }, (error) => { setLoading(false); handleFirestoreError(error, OperationType.LIST, 'irrigation_projects'); });
    return () => { unsubClients(); unsubProjects(); };
  }, []);

  const calc = useMemo(
    () => computeIrrigation(hydraulic, pump, demand, soil, appEfficiency),
    [hydraulic, pump, demand, soil, appEfficiency]
  );
  const { headLoss, velocity, totalHead, pumpPower, netDemand, grossDemand, netWaterDay, totalWaterDay, schedule } = calc;
  const priceCalc = computePricing(pricing, demand.area);

  const selectedClient = clients.find(c => c.id === selectedClientId);
  const clientProperties = (selectedClient?.properties || []).map(p => p.name).filter(Boolean);

  const handleClientChange = (clientId: string) => {
    setSelectedClientId(clientId);
    const props = (clients.find(c => c.id === clientId)?.properties || []).map(p => p.name).filter(Boolean);
    setPropertyName(props.length === 1 ? props[0] : '');
    if (props.length === 1) suggestArea(clientId, props[0]);
  };

  // Área da fazenda cadastrada já vem como sugestão da área do projeto
  const suggestArea = (clientId: string, name: string) => {
    const prop = (clients.find(c => c.id === clientId)?.properties || []).find(p => p.name === name);
    if (prop?.areaHectares && !demand.area) setDemand(prev => ({ ...prev, area: Number(prop.areaHectares) || 0 }));
  };

  const selectIrrigationType = (type: 'drip' | 'sprinkler') => {
    setIrrigationType(type);
    if (!appEfficiency || irrigationType !== type) setAppEfficiency(type === 'drip' ? 90 : 80);
  };

  const resetForm = () => {
    setEditingId(null); setStep(0);
    setSelectedClientId(''); setPropertyName(''); setScheduledDate(todayLocalDateString());
    setIrrigationType(null); setTechnicalJustification(''); setPlanningNotes('');
    setHydraulic(emptyHydraulic()); setPump(emptyPump()); setDemand(emptyDemand()); setSoil(emptySoil());
    setAppEfficiency(0); setPricing(emptyPricing()); setResponsibleTech(responsibleFromProfile(user));
  };

  const openNew = () => { resetForm(); setIsFormOpen(true); };

  const openEdit = (p: any) => {
    resetForm();
    setEditingId(p.id);
    setSelectedClientId(p.clientId || '');
    setPropertyName(p.propertyName || '');
    setScheduledDate(p.scheduledDate || todayLocalDateString());
    setIrrigationType(p.type || null);
    setTechnicalJustification(p.technicalJustification || '');
    setPlanningNotes(p.planningNotes || '');
    setHydraulic({ ...emptyHydraulic(), ...(p.inputs?.hydraulic || {}) });
    setPump({ ...emptyPump(), ...(p.inputs?.pump || {}) });
    setDemand({ ...emptyDemand(), ...(p.inputs?.demand || {}) });
    setSoil({ ...emptySoil(), ...(p.inputs?.soil || {}) });
    setAppEfficiency(p.results?.appEfficiency || 0);
    setPricing({ ...emptyPricing(), ...(p.pricing || {}) });
    setResponsibleTech(p.responsibleTech || { ...responsibleFromProfile(user), name: p.responsible || user?.displayName || '' });
    setViewing(null);
    setIsFormOpen(true);
  };

  const validateStep = (i: number): string | null => {
    if (i === 0) {
      if (!selectedClientId) return 'Selecione o cliente.';
      if (!propertyName.trim()) return 'Informe a propriedade/fazenda.';
    }
    if (i === 2) {
      if (!demand.area) return 'Informe a área do projeto (ha).';
      if (!irrigationType) return 'Escolha o sistema de irrigação (gotejamento ou aspersão).';
    }
    if (i === 4) {
      if (!responsibleTech.name.trim()) return 'Informe o nome do responsável técnico.';
    }
    return null;
  };

  const goNext = () => {
    const err = validateStep(step);
    if (err) { toast.error(err); return; }
    setStep(s => Math.min(s + 1, STEPS.length - 1));
  };

  const buildPayload = () => ({
    clientId: selectedClientId,
    clientName: selectedClient?.name || 'Cliente Desconhecido',
    propertyName: propertyName.trim(),
    type: irrigationType,
    responsible: responsibleTech.name.trim(),
    responsibleTech: { ...responsibleTech, name: responsibleTech.name.trim(), registryNumber: responsibleTech.registryNumber.trim() },
    technicalJustification,
    scheduledDate,
    planningNotes,
    pricing,
    value: priceCalc.total,
    results: { headLoss, totalHead, pumpPower, netDemand, grossDemand, appEfficiency, netWaterDay, totalWaterDay, schedule, velocity },
    inputs: { hydraulic, pump, demand, soil },
  });

  const handleSave = async () => {
    for (let i = 0; i < STEPS.length; i++) {
      const err = validateStep(i);
      if (err) { setStep(i); toast.error(err); return; }
    }
    setIsSaving(true);
    try {
      const payload = buildPayload();
      let saved: any;
      if (editingId) {
        await updateDoc(doc(db, 'irrigation_projects', editingId), { ...payload, updatedAt: serverTimestamp() });
        const old = projects.find(p => p.id === editingId) || {};
        saved = { ...old, ...payload, id: editingId };
        toast.success('Projeto de irrigação atualizado!');
      } else {
        const ref = await addDoc(collection(db, 'irrigation_projects'), {
          ...payload,
          status: 'Em Andamento',
          paymentStatus: 'pendente',
          createdAt: serverTimestamp(),
          createdBy: user?.uid,
        });
        saved = { ...payload, id: ref.id, status: 'Em Andamento', paymentStatus: 'pendente' };
        toast.success('Projeto de irrigação criado!');
        // Aviso na agenda — isolado: se falhar, o projeto já está salvo.
        try {
          if (user) {
            await addDoc(collection(db, 'notifications'), {
              userId: user.uid,
              title: 'Projeto de Irrigação Agendado',
              message: `O projeto para ${payload.clientName} foi integrado à agenda para o dia ${scheduledDate.split('-').reverse().join('/')}.`,
              type: 'success',
              read: false,
              createdAt: new Date().toISOString(),
              link: 'scheduling',
            });
          }
        } catch (notifError) {
          console.warn('Falha ao criar notificação (projeto já salvo):', notifError);
        }
      }
      setIsFormOpen(false);
      resetForm();
      try { await generateIrrigationPDF(saved, clients.find(c => c.id === saved.clientId)); }
      catch (e) { console.error(e); toast.error('Projeto salvo, mas o PDF não pôde ser gerado.'); }
    } catch (error) {
      handleFirestoreError(error, editingId ? OperationType.UPDATE : OperationType.CREATE, 'irrigation_projects');
    } finally {
      setIsSaving(false);
    }
  };

  const updateProject = async (p: any, patch: Record<string, any>, msg: string) => {
    try {
      await updateDoc(doc(db, 'irrigation_projects', p.id), { ...patch, updatedAt: serverTimestamp() });
      setViewing((v: any) => (v && v.id === p.id ? { ...v, ...patch } : v));
      toast.success(msg);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, 'irrigation_projects');
    }
  };

  const handleDeleteProject = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'irrigation_projects', id));
      setIsDeleteModalOpen(null);
      setViewing(null);
      toast.success('Projeto excluído com sucesso.');
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, 'irrigation_projects');
    }
  };

  const downloadPDF = async (p: any) => {
    try { await generateIrrigationPDF(p, clients.find(c => c.id === p.clientId)); }
    catch (e) { console.error(e); toast.error('Não foi possível gerar o PDF.'); }
  };

  const canEditProject = (p: any) => !readOnly && (['admin', 'manager', 'hr'].includes(role) || p.createdBy === user?.uid);

  // ─── Mini painel ──────────────────────────────────────────────────────────
  const active = projects.filter(p => statusOf(p) === 'Em Andamento');
  const done = projects.filter(p => statusOf(p) === 'Concluído');
  const toReceive = projects.filter(p => statusOf(p) !== 'Cancelado' && p.paymentStatus !== 'pago');
  const areaActive = active.reduce((s, p) => s + (Number(p.inputs?.demand?.area) || 0), 0);
  const kpis = [
    { label: 'Projetos em Andamento', value: active.length, hint: `${areaActive.toLocaleString('pt-BR')} ha em projeto`, icon: Droplet, tone: 'emerald' as const },
    { label: 'Valor a Receber', value: formatBRL(toReceive.reduce((s, p) => s + (Number(p.value) || 0), 0)), hint: `${toReceive.filter(p => Number(p.value) > 0).length} projeto(s) com cobrança pendente`, icon: Wallet, tone: 'slate' as const },
    { label: 'Projetos Concluídos', value: done.length, hint: `${done.filter(p => isThisMonth(p.updatedAt || p.createdAt)).length} neste mês`, icon: CheckCircle2, tone: 'emerald' as const },
    { label: 'Volume Projetado', value: `${Math.round(active.reduce((s, p) => s + (Number(p.results?.totalWaterDay) || Number(p.results?.netWaterDay) || 0), 0)).toLocaleString('pt-BR')} m³/dia`, hint: 'Água a captar nos projetos em andamento', icon: CloudRain, tone: 'amber' as const },
  ];

  const filtered = projects.filter(p => {
    const t = searchTerm.toLowerCase();
    const matches = (p.clientName || '').toLowerCase().includes(t) || (p.propertyName || '').toLowerCase().includes(t) || (p.responsible || '').toLowerCase().includes(t);
    return matches && (statusFilter === 'all' || statusOf(p) === statusFilter);
  });

  // ─── Etapas do formulário ─────────────────────────────────────────────────
  const numInput = (label: string, value: number, onChange: (v: number) => void, ph: string) => (
    <div className="space-y-1">
      <label className="text-[10px] font-bold text-slate-500 uppercase">{label}</label>
      <input type="number" step="any" value={value || ''} onChange={(e) => onChange(Number(e.target.value))} className="w-full glass-input" placeholder={ph} />
    </div>
  );
  const resultBox = (label: string, value: React.ReactNode, strong = false) => (
    <div className={cn('p-3 rounded-2xl border', strong ? 'bg-emerald-600 border-emerald-600 text-white' : 'bg-slate-50 border-slate-100')}>
      <div className={cn('text-[9px] font-bold uppercase', strong ? 'text-emerald-100' : 'text-slate-500')}>{label}</div>
      <div className={cn('text-lg font-mono font-bold', strong ? 'text-white' : 'text-slate-800')}>{value}</div>
    </div>
  );

  const renderStep = () => {
    switch (step) {
      case 0:
        return (
          <div className="space-y-5">
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-slate-500 uppercase">Cliente</label>
              <select value={selectedClientId} onChange={(e) => handleClientChange(e.target.value)} className="w-full glass-input bg-white/60">
                <option value="">Selecione o cliente...</option>
                {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            {selectedClientId && (
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-slate-500 uppercase">Propriedade / Fazenda</label>
                {clientProperties.length > 0 ? (
                  <select value={clientProperties.includes(propertyName) ? propertyName : ''} onChange={(e) => { setPropertyName(e.target.value); suggestArea(selectedClientId, e.target.value); }} className="w-full glass-input bg-white/60">
                    <option value="">Escolha a fazenda...</option>
                    {clientProperties.map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                ) : (
                  <input type="text" value={propertyName} onChange={(e) => setPropertyName(e.target.value)} className="w-full glass-input" placeholder="Este cliente não tem fazenda cadastrada — digite o nome" />
                )}
                {clientProperties.length > 0 && (
                  <p className="text-[10px] text-emerald-600 font-bold">
                    {clientProperties.length === 1 ? 'Fazenda puxada automaticamente do cadastro do cliente.' : `${clientProperties.length} fazendas cadastradas para este cliente.`}
                  </p>
                )}
              </div>
            )}
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-slate-500 uppercase">Data prevista de execução</label>
              <input type="date" value={scheduledDate} onChange={(e) => setScheduledDate(e.target.value)} className="w-full glass-input" />
            </div>
          </div>
        );
      case 1:
        return (
          <div className="space-y-5">
            <h4 className="text-xs font-bold text-slate-700 flex items-center gap-2"><Calculator className="w-4 h-4 text-emerald-600" /> Tubulação (perda de carga — Hazen-Williams)</h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {numInput('Comprimento do trecho (m)', hydraulic.length, v => setHydraulic({ ...hydraulic, length: v }), 'Ex: 250')}
              {numInput('Diâmetro interno (mm)', hydraulic.diameter, v => setHydraulic({ ...hydraulic, diameter: v }), 'Ex: 50')}
              {numInput('Vazão do trecho (m³/h)', hydraulic.flow, v => setHydraulic({ ...hydraulic, flow: v }), 'Ex: 12.5')}
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-slate-500 uppercase">Material da tubulação</label>
                <select value={hydraulic.cFactor} onChange={(e) => setHydraulic({ ...hydraulic, cFactor: Number(e.target.value) })} className="w-full glass-input bg-white/60">
                  <option value={150}>PVC ou PE (C=150)</option>
                  <option value={140}>PVC Antigo ou PE (C=140)</option>
                  <option value={130}>Aço Novo (C=130)</option>
                  <option value={100}>Ferro Fundido (C=100)</option>
                </select>
              </div>
            </div>
            <h4 className="text-xs font-bold text-slate-700 flex items-center gap-2 pt-2"><Zap className="w-4 h-4 text-emerald-600" /> Motobomba</h4>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {numInput('Altura geométrica (m)', pump.staticHead, v => setPump({ ...pump, staticHead: v }), 'Ex: 15')}
              {numInput('Pressão de serviço (mca)', pump.servicePressure, v => setPump({ ...pump, servicePressure: v }), 'Ex: 20')}
              {numInput('Rendimento da bomba (%)', pump.efficiency, v => setPump({ ...pump, efficiency: v }), 'Ex: 75')}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {resultBox('Perda de carga', `${headLoss} mca`)}
              {resultBox('Velocidade', <span className={velocity > 2 ? 'text-rose-600' : ''}>{velocity} m/s</span>)}
              {resultBox('HMT', `${totalHead} mca`)}
              {resultBox('Potência', `${pumpPower} cv`, true)}
            </div>
            {velocity > 2 && (
              <div className="p-3 bg-rose-50 border border-rose-100 rounded-2xl text-[11px] text-rose-700 flex gap-2">
                <Zap className="w-4 h-4 shrink-0" /> Velocidade acima de 2,0 m/s: considere aumentar o diâmetro para evitar desgaste e golpe de aríete.
              </div>
            )}
            <div className="font-mono text-[10px] text-slate-500 bg-slate-50 p-3 rounded-xl border border-slate-100 space-y-1">
              <div>hf = 10,65 · {hydraulic.length} · ({(hydraulic.flow / 3600).toFixed(6)} / {hydraulic.cFactor})^1,852 · {(hydraulic.diameter / 1000).toFixed(4)}^-4,87 = {headLoss} mca</div>
              <div>HMT = {pump.staticHead} + {pump.servicePressure} + {headLoss} = {totalHead} mca</div>
              <div>P = ({(hydraulic.flow * 1000 / 3600).toFixed(2)} · {totalHead}) / (75 · {pump.efficiency / 100}) = {pumpPower} cv</div>
            </div>
          </div>
        );
      case 2:
        return (
          <div className="space-y-5">
            <h4 className="text-xs font-bold text-slate-700 flex items-center gap-2"><Droplet className="w-4 h-4 text-emerald-600" /> Necessidade hídrica (FAO-56)</h4>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {numInput('ETo (mm/dia)', demand.eto, v => setDemand({ ...demand, eto: v }), 'Ex: 6.2')}
              {numInput('Kc (coef. da cultura)', demand.kc, v => setDemand({ ...demand, kc: v }), 'Ex: 0.85')}
              {numInput('Área do projeto (ha)', demand.area, v => setDemand({ ...demand, area: v }), 'Ex: 10')}
            </div>
            <h4 className="text-xs font-bold text-slate-700 flex items-center gap-2 pt-1"><Sprout className="w-4 h-4 text-emerald-600" /> Sistema de irrigação</h4>
            <div className="grid grid-cols-2 gap-3">
              {([['drip', 'Gotejamento', 'Alta eficiência (90–95%)', Droplet], ['sprinkler', 'Aspersão', 'Versatilidade (75–85%)', CloudRain]] as const).map(([id, label, desc, Icon]) => (
                <button key={id} type="button" onClick={() => selectIrrigationType(id)}
                  className={cn('p-4 rounded-2xl border-2 flex items-center gap-3 text-left transition-all', irrigationType === id ? 'bg-emerald-50 border-emerald-500' : 'bg-white/50 border-slate-100 hover:border-emerald-200')}>
                  <div className={cn('p-2 rounded-xl', irrigationType === id ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-400')}><Icon className="w-5 h-5" /></div>
                  <div><div className="font-bold text-sm text-slate-700">{label}</div><div className="text-[10px] text-slate-400 font-bold uppercase">{desc}</div></div>
                </button>
              ))}
            </div>
            {irrigationType && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-500 uppercase">Eficiência de aplicação — Ea (%)</label>
                  <input type="number" min={40} max={100} value={appEfficiency || ''} onChange={(e) => setAppEfficiency(Math.min(100, Math.max(0, Number(e.target.value))))} className="w-full glass-input" />
                  <p className="text-[10px] text-slate-400">Valor típico já preenchido; ajuste conforme o equipamento.</p>
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-500 uppercase">Justificativa técnica do sistema</label>
                  <textarea rows={2} value={technicalJustification} onChange={(e) => setTechnicalJustification(e.target.value)} className="w-full glass-input text-xs" placeholder="Por que este sistema para esta área/cultura..." />
                </div>
              </div>
            )}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {resultBox('Lâmina líquida (ETc)', `${netDemand} mm/dia`)}
              {resultBox('Lâmina bruta', appEfficiency ? `${grossDemand} mm/dia` : '—')}
              {resultBox('Vol. líquido', `${netWaterDay} m³/dia`)}
              {resultBox('Vol. a captar', `${appEfficiency ? totalWaterDay : netWaterDay} m³/dia`, true)}
            </div>
            <details className="p-4 bg-white/40 border border-slate-100 rounded-2xl" open={!!soil.cc}>
              <summary className="text-[10px] font-bold text-slate-500 uppercase cursor-pointer">Turno de rega e tempo de irrigação (opcional — dados do solo)</summary>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mt-4">
                {([
                  ['cc', 'Capacidade de campo (% peso)', 'Ex: 28'],
                  ['pmp', 'Ponto de murcha (% peso)', 'Ex: 14'],
                  ['ds', 'Densidade do solo (g/cm³)', 'Ex: 1.3'],
                  ['z', 'Profundidade das raízes (cm)', 'Ex: 40'],
                  ['f', 'Fator de disponibilidade (0 a 1)', 'Ex: 0.5'],
                  ['ia', 'Intensidade de aplicação (mm/h)', 'Ex: 8'],
                ] as const).map(([key, label, ph]) => (
                  <React.Fragment key={key}>{numInput(label, soil[key], v => setSoil({ ...soil, [key]: v }), ph)}</React.Fragment>
                ))}
              </div>
              {schedule ? (
                <div className="mt-4 font-mono text-[10px] text-slate-600 bg-white/80 p-3 rounded-lg space-y-1">
                  <div>1. CRA = ({soil.cc} − {soil.pmp})/10 × {soil.ds} × {soil.z} = {schedule.cra} mm</div>
                  <div>2. IRN máx = CRA × f = {schedule.cra} × {soil.f} = {schedule.irnMax} mm</div>
                  <div>3. TR máx = IRN / ETc = {schedule.irnMax} / {netDemand} = {schedule.trMax} dias → TR adotado = {schedule.tr} dia(s)</div>
                  <div>4. Lâmina bruta por irrigação = {schedule.tr} × {netDemand} / {appEfficiency / 100} = {schedule.lb} mm</div>
                  {schedule.ti > 0 && <div>5. Tempo de irrigação = {schedule.lb} / {soil.ia} = {schedule.ti} h</div>}
                  {schedule.warning && <div className="text-rose-600 font-bold">Atenção: o solo não armazena a água de 1 dia inteiro — dividir a irrigação em mais de uma vez por dia.</div>}
                </div>
              ) : (
                <p className="text-[10px] text-slate-400 italic mt-3">Preencha CC, PMP, densidade, profundidade e fator f (e escolha o sistema) para calcular o turno de rega.</p>
              )}
            </details>
          </div>
        );
      case 3:
        return (
          <div className="space-y-4">
            <p className="text-xs text-slate-500">Monte o preço do serviço. A memória de cálculo abaixo vai para o PDF.</p>
            <PricingFields value={pricing} onChange={setPricing} areaHa={demand.area} areaLabel="área irrigada" />
          </div>
        );
      case 4:
        return (
          <div className="space-y-5">
            <ResponsibleFields value={responsibleTech} onChange={setResponsibleTech} />
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-slate-500 uppercase">Observações de planejamento (vão para o PDF)</label>
              <textarea rows={3} value={planningNotes} onChange={(e) => setPlanningNotes(e.target.value)} className="w-full glass-input text-xs" placeholder="Recomendações de instalação, etapas, ampliações futuras..." />
            </div>
            <div className="p-4 bg-slate-50 border border-slate-100 rounded-2xl text-xs space-y-1.5">
              <div className="text-[10px] font-bold text-slate-500 uppercase mb-1">Resumo do projeto</div>
              <div className="flex justify-between"><span className="text-slate-500">Cliente / fazenda</span><span className="font-bold text-slate-700 text-right">{selectedClient?.name || '—'} · {propertyName || '—'}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Sistema / área</span><span className="font-bold text-slate-700">{systemLabel(irrigationType)} · {demand.area} ha</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Potência / volume</span><span className="font-bold text-slate-700">{pumpPower} cv · {appEfficiency ? totalWaterDay : netWaterDay} m³/dia</span></div>
              <div className="flex justify-between pt-1 border-t border-slate-200"><span className="text-slate-500">Valor do serviço</span><span className="font-extrabold text-emerald-700">{formatBRL(priceCalc.total)}</span></div>
            </div>
          </div>
        );
      default:
        return null;
    }
  };

  // ─── Tela ─────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-6 h-full overflow-y-auto pr-2 pb-10 custom-scrollbar">
      <header className={PAGE_HEADER_CLASS} data-page-header>
        <PageTitle icon={PageIcon} title="Irrigação" subtitle="Projetos e cálculos de engenharia hídrica com memorial técnico" />
        <div className="flex items-center gap-3">
          {readOnly ? (
            <button disabled className="px-5 py-2.5 rounded-2xl font-bold flex items-center gap-2 bg-slate-300 text-slate-500 cursor-not-allowed text-xs">
              <Plus className="w-4 h-4" /> Apenas Leitura
            </button>
          ) : (
            <button onClick={openNew} className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white rounded-2xl text-xs font-bold uppercase tracking-wider flex items-center gap-2 shadow-lg shadow-emerald-600/20 transition-all">
              <Plus className="w-4 h-4" /> Novo Projeto
            </button>
          )}
        </div>
      </header>

      <ServiceKpiCards items={kpis} />

      <div className="glass-card p-4 rounded-3xl border border-white/40 flex flex-col md:flex-row gap-3 items-center justify-between">
        <div className="relative w-full md:w-80">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input type="text" placeholder="Buscar por cliente, fazenda ou responsável..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="w-full glass-input pl-10 text-xs" />
        </div>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="glass-input text-xs font-bold bg-white/60 w-full md:w-56">
          <option value="all">Todas as situações</option>
          {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
          {[1, 2, 3].map(i => <div key={i} className="glass-card h-56 rounded-3xl animate-pulse bg-slate-100/50" />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="glass-card p-12 rounded-3xl text-center flex flex-col items-center gap-3 text-slate-400">
          <Droplet className="w-12 h-12 opacity-20" />
          <p className="text-xs font-bold uppercase tracking-widest">Nenhum projeto de irrigação encontrado</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
          {filtered.map(p => {
            const st = statusOf(p);
            const area = Number(p.inputs?.demand?.area) || 0;
            return (
              <motion.div key={p.id} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="glass-card p-6 rounded-3xl flex flex-col gap-4 hover:border-emerald-500/40 transition-all group" data-irrigation-card>
                <div className="flex justify-between items-start gap-3">
                  <div className="min-w-0">
                    <h3 className="font-display font-bold text-slate-800 truncate">{p.clientName}</h3>
                    <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest flex items-center gap-1.5 mt-1 truncate">
                      <LandPlot className="w-3 h-3 shrink-0" /> {p.propertyName || 'Propriedade não informada'}
                    </p>
                  </div>
                  <span className={cn('px-2.5 py-1 rounded-full text-[9px] font-black uppercase tracking-widest whitespace-nowrap', STATUS_STYLE[st])}>{st}</span>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div className="bg-slate-50 p-2.5 rounded-xl border border-slate-100"><div className="text-[8px] font-bold text-slate-400 uppercase">Sistema</div><div className="text-[11px] font-bold text-slate-700 truncate">{systemLabel(p.type)}</div></div>
                  <div className="bg-slate-50 p-2.5 rounded-xl border border-slate-100"><div className="text-[8px] font-bold text-slate-400 uppercase">Área</div><div className="text-[11px] font-bold text-slate-700">{area ? `${area} ha` : '—'}</div></div>
                  <div className="bg-slate-50 p-2.5 rounded-xl border border-slate-100"><div className="text-[8px] font-bold text-slate-400 uppercase">Potência</div><div className="text-[11px] font-bold text-slate-700">{p.results?.pumpPower ?? '—'} cv</div></div>
                </div>
                <div className="flex justify-between items-center text-sm">
                  <span className="text-slate-400 font-medium">Valor do serviço</span>
                  <span className="font-bold text-slate-800 flex items-center gap-2">
                    {Number(p.value) > 0 ? formatBRL(p.value) : '—'}
                    {Number(p.value) > 0 && (
                      <span className={cn('px-1.5 py-0.5 rounded text-[8px] font-black uppercase', p.paymentStatus === 'pago' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700')}>
                        {p.paymentStatus === 'pago' ? 'Pago' : 'A receber'}
                      </span>
                    )}
                  </span>
                </div>
                <div className="mt-auto pt-4 border-t border-slate-100 flex items-center justify-between gap-2">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest truncate flex items-center gap-1.5">
                    <User className="w-3 h-3 shrink-0" /> {p.responsibleTech?.name || p.responsible || '—'}
                  </span>
                  <div className="flex items-center gap-1 shrink-0">
                    <button onClick={() => downloadPDF(p)} title="Relatório em PDF" className="p-2 rounded-xl text-slate-400 hover:bg-emerald-50 hover:text-emerald-600 transition-all"><Download className="w-4 h-4" /></button>
                    {canEditProject(p) && (
                      <button onClick={() => openEdit(p)} title="Editar projeto" className="p-2 rounded-xl text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition-all"><Edit3 className="w-4 h-4" /></button>
                    )}
                    <button onClick={() => setViewing(p)} className="text-emerald-600 hover:text-emerald-700 font-bold text-[10px] uppercase tracking-widest flex items-center gap-1 pl-1">
                      Ver Detalhes <ChevronRight className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
      )}

      {/* ─── Janela: novo / editar projeto ─── */}
      <AnimatePresence>
        {isFormOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm" data-irrigation-form>
            <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white dark:bg-slate-900 w-full max-w-3xl rounded-[2rem] shadow-2xl flex flex-col max-h-[92vh] overflow-hidden">
              <div className="p-6 border-b border-slate-100 space-y-4">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div className="w-11 h-11 bg-emerald-100 rounded-2xl flex items-center justify-center text-emerald-600"><Droplet className="w-5 h-5" /></div>
                    <div>
                      <h3 className="text-lg font-display font-bold text-slate-800">{editingId ? 'Editar Projeto de Irrigação' : 'Novo Projeto de Irrigação'}</h3>
                      <p className="text-[11px] text-slate-500">Etapa {step + 1} de {STEPS.length} · {STEPS[step]}</p>
                    </div>
                  </div>
                  <button onClick={() => { setIsFormOpen(false); resetForm(); }} className="p-2 hover:bg-slate-100 rounded-xl" title="Fechar"><X className="w-5 h-5 text-slate-400" /></button>
                </div>
                <WizardSteps steps={STEPS} current={step} onGo={(i) => { if (i <= step) setStep(i); }} />
              </div>
              <div className="p-6 overflow-y-auto flex-1">{renderStep()}</div>
              <div className="p-5 border-t border-slate-100 flex justify-between gap-3 bg-slate-50/60">
                <button onClick={() => (step === 0 ? (setIsFormOpen(false), resetForm()) : setStep(s => s - 1))}
                  className="px-5 py-2.5 border border-slate-200 rounded-2xl text-xs font-bold text-slate-500 hover:bg-white flex items-center gap-2">
                  <ArrowLeft className="w-4 h-4" /> {step === 0 ? 'Cancelar' : 'Voltar'}
                </button>
                {step < STEPS.length - 1 ? (
                  <button onClick={goNext} className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-2xl text-xs font-bold flex items-center gap-2 shadow-lg shadow-emerald-600/20">
                    Avançar <ArrowRight className="w-4 h-4" />
                  </button>
                ) : (
                  <button onClick={() => runExclusive('Irrigation.save', handleSave)} disabled={isSaving}
                    className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-2xl text-xs font-bold flex items-center gap-2 shadow-lg shadow-emerald-600/20 disabled:opacity-50">
                    <Save className="w-4 h-4" /> {isSaving ? 'Salvando...' : editingId ? 'Salvar e Gerar PDF' : 'Criar Projeto e Gerar PDF'}
                  </button>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ─── Janela: detalhes ─── */}
      <AnimatePresence>
        {viewing && (() => {
          const p = viewing;
          const st = statusOf(p);
          const pc = computePricing(p.pricing, Number(p.inputs?.demand?.area) || 0);
          const r = p.results || {};
          return (
            <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm" data-irrigation-details>
              <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
                className="bg-white dark:bg-slate-900 w-full max-w-2xl rounded-[2rem] shadow-2xl p-7 flex flex-col gap-5 max-h-[92vh] overflow-y-auto">
                <div className="flex justify-between items-start gap-4">
                  <div>
                    <h3 className="text-2xl font-display font-bold text-slate-800">{p.clientName}</h3>
                    <p className="text-sm text-slate-500">{p.propertyName} · {systemLabel(p.type)}</p>
                  </div>
                  <button onClick={() => setViewing(null)} className="p-2 hover:bg-slate-100 rounded-xl"><X className="w-5 h-5 text-slate-400" /></button>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {resultBox('Área', `${p.inputs?.demand?.area ?? '—'} ha`)}
                  {resultBox('Potência', `${r.pumpPower ?? '—'} cv`)}
                  {resultBox('HMT', `${r.totalHead ?? '—'} mca`)}
                  {resultBox('Vol. a captar', `${r.totalWaterDay || r.netWaterDay || 0} m³/dia`)}
                </div>
                <div className="p-4 bg-emerald-50/70 border border-emerald-100 rounded-2xl text-xs space-y-1">
                  <div className="text-[10px] font-bold text-emerald-700 uppercase mb-1">Valor do serviço</div>
                  {p.pricing ? pc.rows.map(([k, v], i) => (
                    <div key={k + i} className={cn('flex justify-between gap-4', i === pc.rows.length - 1 ? 'pt-1 border-t border-emerald-200 font-extrabold text-emerald-800' : 'text-slate-600')}><span>{k}</span><span className="font-mono">{v}</span></div>
                  )) : <div className="text-slate-500">Projeto antigo, sem preço cadastrado. Use “Editar” para incluir.</div>}
                </div>
                <div className="text-xs text-slate-600 flex items-center gap-2">
                  <User className="w-4 h-4 text-emerald-600" />
                  <span className="font-bold">{p.responsibleTech?.name || p.responsible || '—'}</span>
                  {registryLabel(p.responsibleTech) && <span className="text-slate-400">· {registryLabel(p.responsibleTech)}</span>}
                  {p.scheduledDate && <span className="ml-auto flex items-center gap-1 text-slate-400"><Clock className="w-3.5 h-3.5" /> {formatDate(p.scheduledDate)}</span>}
                </div>
                {canEditProject(p) && (
                  <div className="space-y-3">
                    <div>
                      <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5">Situação do projeto</div>
                      <div className="flex gap-2">
                        {STATUSES.map(s => (
                          <button key={s} onClick={() => updateProject(p, { status: s }, `Situação: ${s}`)}
                            className={cn('flex-1 py-2 rounded-xl text-[10px] font-bold uppercase tracking-wider transition-all', st === s ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200')}>{s}</button>
                        ))}
                      </div>
                    </div>
                    {Number(p.value) > 0 && (
                      <div>
                        <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5">Pagamento</div>
                        <div className="flex gap-2">
                          {(['pendente', 'pago'] as const).map(s => (
                            <button key={s} onClick={() => updateProject(p, { paymentStatus: s }, s === 'pago' ? 'Marcado como pago.' : 'Marcado como a receber.')}
                              className={cn('flex-1 py-2 rounded-xl text-[10px] font-bold uppercase tracking-wider transition-all', (p.paymentStatus || 'pendente') === s ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200')}>{s === 'pago' ? 'Pago' : 'A receber'}</button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
                <div className="flex flex-wrap gap-2 pt-2 border-t border-slate-100">
                  <button onClick={() => downloadPDF(p)} className="flex-1 py-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-2xl text-xs font-bold uppercase tracking-widest flex items-center justify-center gap-2"><FileText className="w-4 h-4" /> Relatório em PDF</button>
                  {canEditProject(p) && <button onClick={() => openEdit(p)} className="flex-1 py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-2xl text-xs font-bold uppercase tracking-widest flex items-center justify-center gap-2"><Edit3 className="w-4 h-4" /> Editar</button>}
                  {isAdmin && <button onClick={() => setIsDeleteModalOpen(p.id)} className="py-3 px-4 bg-rose-50 hover:bg-rose-100 text-rose-600 rounded-2xl text-xs font-bold uppercase tracking-widest flex items-center justify-center gap-2" title="Excluir projeto"><Trash2 className="w-4 h-4" /></button>}
                </div>
              </motion.div>
            </div>
          );
        })()}
      </AnimatePresence>

      <ConfirmationModal
        isOpen={!!isDeleteModalOpen}
        onClose={() => setIsDeleteModalOpen(null)}
        onConfirm={() => isDeleteModalOpen && handleDeleteProject(isDeleteModalOpen)}
        title="Excluir Projeto de Irrigação?"
        description="Esta ação não pode ser desfeita. O projeto de irrigação e todos os cálculos associados serão removidos permanentemente."
        confirmLabel="Confirmar Exclusão"
      />
    </div>
  );
}
