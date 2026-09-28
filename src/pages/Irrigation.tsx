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
  UserCheck,
  User,
  CheckCircle2,
  Info,
  Printer,
  Trash2
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';
import { cn, formatDateTime, formatDate, handleFirestoreError, OperationType, todayLocalDateString } from '../lib/utils';
import { collection, onSnapshot, query, orderBy, addDoc, serverTimestamp, limit, deleteDoc, doc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { Client } from '../types';
import { useAuth } from '../contexts/AuthContext';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

import ConfirmationModal from '../components/ConfirmationModal';
import { PageTitle, PAGE_HEADER_CLASS } from '../components/layout/PageHeader';
import { Droplet as PageIcon } from 'lucide-react';

interface CalculationStep {
  id: number;
  title: string;
  description: string;
  icon: any;
}

const STEPS: CalculationStep[] = [
  { id: 1, title: 'Campos / Canais', description: 'Dimensionamento de tubulações, redes de campos e perda de carga', icon: Calculator },
  { id: 2, title: 'Motobombas / Bombas', description: 'Cálculo de potência e altura manométrica de bombas', icon: Zap },
  { id: 3, title: 'Necessidades', description: 'Demanda hídrica da cultura (ETc) e necessidades do solo', icon: Droplet },
  { id: 4, title: 'Sistemas / Culturas', description: 'Escolha tecnológica de gotejadores ou aspersores', icon: Sprout },
  { id: 5, title: 'Planejamento', description: 'Planejamento final, cronograma de irrigações e cronogramas', icon: FileText },
];

export default function Irrigation() {
  const { user } = useAuth();
  const [currentStep, setCurrentStep] = useState(1);
  const [irrigationType, setIrrigationType] = useState<'drip' | 'sprinkler' | null>(null);
  const [responsible, setResponsible] = useState('');
  const [clients, setClients] = useState<Client[]>([]);
  const [selectedClientId, setSelectedClientId] = useState('');
  const [propertyName, setPropertyName] = useState('');
  const [availableProperties, setAvailableProperties] = useState<string[]>([]);
  const [showPropertySelect, setShowPropertySelect] = useState(false);
  const [technicalJustification, setTechnicalJustification] = useState('');
  const [planningNotes, setPlanningNotes] = useState('');
  const [scheduledDate, setScheduledDate] = useState(todayLocalDateString());
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [projects, setProjects] = useState<any[]>([]);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState<string | null>(null);

  // Hydraulic Data
  const [hydraulic, setHydraulic] = useState({
    length: 0,
    diameter: 0,
    flow: 0,
    cFactor: 140
  });

  // Pump Data
  const [pump, setPump] = useState({
    staticHead: 0,
    servicePressure: 0,
    efficiency: 75
  });

  // Demand Data
  const [demand, setDemand] = useState({
    eto: 0,
    kc: 0,
    area: 0
  });

  useEffect(() => {
    if (user && !responsible) {
      setResponsible(user.displayName || '');
    }
  }, [user]);

  useEffect(() => {
    const q = query(collection(db, 'clients'), orderBy('name', 'asc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setClients(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Client)));
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'clients');
    });

    const qProjects = query(collection(db, 'irrigation_projects'), orderBy('createdAt', 'desc'), limit(5));
    const unsubscribeProjects = onSnapshot(qProjects, (snapshot) => {
      setProjects(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    });

    return () => {
      unsubscribe();
      unsubscribeProjects();
    };
  }, []);

  // Calculations
  const headLoss = useMemo(() => {
    if (!hydraulic.length || !hydraulic.diameter || !hydraulic.flow) return 0;
    // Hazen-Williams: hf = (10.65 * L * (Q/C)^1.852) / D^4.87
    const qS = hydraulic.flow / 3600;
    const dM = hydraulic.diameter / 1000;
    const hf = (10.65 * hydraulic.length * Math.pow(qS / hydraulic.cFactor, 1.852)) / Math.pow(dM, 4.87);
    return Number(hf.toFixed(2));
  }, [hydraulic]);

  const velocity = useMemo(() => {
    if (!hydraulic.flow || !hydraulic.diameter) return 0;
    // v = Q / A -> v = (Q/3600) / (pi * (D/2000)^2)
    const qS = hydraulic.flow / 3600;
    const area = Math.PI * Math.pow(hydraulic.diameter / 2000, 2);
    return Number((qS / area).toFixed(2));
  }, [hydraulic.flow, hydraulic.diameter]);

  const totalHead = useMemo(() => {
    return Number((pump.staticHead + pump.servicePressure + headLoss).toFixed(2));
  }, [pump, headLoss]);

  const pumpPower = useMemo(() => {
    if (!hydraulic.flow || !totalHead) return 0;
    const qLps = (hydraulic.flow * 1000) / 3600;
    const power = (qLps * totalHead) / (75 * (pump.efficiency / 100));
    return Number(power.toFixed(2));
  }, [hydraulic.flow, totalHead, pump.efficiency]);

  const netDemand = useMemo(() => {
    return Number((demand.eto * demand.kc).toFixed(2));
  }, [demand]);

  const totalWaterDay = useMemo(() => {
    return Number((netDemand * demand.area * 10).toFixed(2));
  }, [netDemand, demand.area]);

  const nextStep = () => setCurrentStep(prev => Math.min(prev + 1, 5));
  const prevStep = () => setCurrentStep(prev => Math.max(prev - 1, 1));

  const handleClientChange = (clientId: string) => {
    setSelectedClientId(clientId);
    const selectedClient = clients.find(c => c.id === clientId);
    
    if (selectedClient) {
      const properties = selectedClient.properties?.map(p => p.name) || [];
      setAvailableProperties(properties);
      
      if (properties.length === 1) {
        setPropertyName(properties[0]);
        setShowPropertySelect(false);
      } else if (properties.length > 1) {
        setPropertyName('');
        setShowPropertySelect(true);
      } else {
        setPropertyName('');
        setShowPropertySelect(false);
      }
    } else {
      setAvailableProperties([]);
      setShowPropertySelect(false);
      setPropertyName('');
    }
  };

  const generatePDF = () => {
    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();
    const client = clients.find(c => c.id === selectedClientId);

    doc.setFillColor(16, 185, 129);
    doc.rect(0, 0, pageWidth, 40, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(24);
    doc.setFont('helvetica', 'bold');
    doc.text('AGROGESTÃO', 20, 25);
    doc.setFontSize(10);
    doc.setFont('helvetica', 'italic');
    doc.text('Soluções Hídricas e Projetos de Irrigação', 20, 32);

    doc.setTextColor(30, 41, 59);
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text('MEMORIAL DESCRITIVO DE IRRIGAÇÃO', 20, 55);
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text(`Data: ${formatDate(new Date())}`, pageWidth - 20, 55, { align: 'right' });

    doc.setDrawColor(226, 232, 240);
    doc.line(20, 60, pageWidth - 20, 60);

    doc.setFont('helvetica', 'bold');
    doc.text('CLIENTE:', 20, 70);
    doc.setFont('helvetica', 'normal');
    doc.text(client?.name || 'Não selecionado', 45, 70);

    doc.setFont('helvetica', 'bold');
    doc.text('PROPRIEDADE:', 20, 76);
    doc.setFont('helvetica', 'normal');
    doc.text(propertyName || 'Não informado', 55, 76);

    doc.setFont('helvetica', 'bold');
    doc.text('TÉCNICO:', 20, 82);
    doc.setFont('helvetica', 'normal');
    doc.text(responsible || user?.displayName || 'N/A', 45, 82);

    doc.setFont('helvetica', 'bold');
    doc.text('SISTEMA:', 20, 88);
    doc.setFont('helvetica', 'normal');
    doc.text(irrigationType === 'drip' ? 'Gotejamento' : irrigationType === 'sprinkler' ? 'Aspersão' : 'Não definido', 45, 88);

    doc.setFont('helvetica', 'bold');
    doc.text('1. DIMENSIONAMENTO HIDRÁULICO', 20, 100);
    doc.setFontSize(9);
    doc.setFont('helvetica', 'italic');
    doc.text('Critério de Hazen-Williams para perda de carga em condutos forçados.', 20, 105);

    autoTable(doc, {
      startY: 110,
      head: [['Parâmetro de Entrada', 'Valor', 'Unidade']],
      body: [
        ['Comprimento da Tubulação (L)', hydraulic.length, 'm'],
        ['Diâmetro Interno (D)', hydraulic.diameter, 'mm'],
        ['Vazão do Trecho (Q)', hydraulic.flow, 'm³/h'],
        ['Material (Coeficiente C)', hydraulic.cFactor, '-'],
      ],
      headStyles: { fillColor: [16, 185, 129] },
      margin: { left: 20, right: 20 }
    });

    const hfStepY = (doc as any).lastAutoTable?.finalY + 10;
    doc.setFont('helvetica', 'bold');
    doc.text('Passo a Passo do Cálculo (Memória de Cálculo):', 20, hfStepY);
    doc.setFont('helvetica', 'normal');
    const qS = hydraulic.flow / 3600;
    const dM = hydraulic.diameter / 1000;
    const formulaText = [
      `1. Conversão de Unidades:`,
      `   Q = ${hydraulic.flow} m³/h -> ${qS.toFixed(6)} m³/s`,
      `   D = ${hydraulic.diameter} mm -> ${dM.toFixed(4)} m`,
      `2. Aplicação da Equação de Hazen-Williams:`,
      `   hf = 10.65 * L * (Q/C)^1.852 * D^-4.87`,
      `   hf = 10.65 * ${hydraulic.length} * (${qS.toFixed(6)} / ${hydraulic.cFactor})^1.852 * ${dM.toFixed(4)}^-4.87`,
      `3. Resultado Final:`,
      `   Perda de Carga (hf) = ${headLoss} mca`
    ];
    doc.text(formulaText, 25, hfStepY + 7);

    // New Page for Pump
    doc.addPage();
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.text('2. DIMENSIONAMENTO DO CONJUNTO MOTOBOMBA', 20, 20);
    
    autoTable(doc, {
      startY: 25,
      head: [['Parâmetro de Entrada', 'Valor', 'Unidade']],
      body: [
        ['Altura Geométrica / Desnível', pump.staticHead, 'm'],
        ['Pressão Requerida (Serviço)', pump.servicePressure, 'mca'],
        ['Perda de Carga Total (hf)', headLoss, 'mca'],
        ['Rendimento Estimado', pump.efficiency, '%'],
      ],
      headStyles: { fillColor: [59, 130, 246] },
      margin: { left: 20, right: 20 }
    });

    const pumpStepY = (doc as any).lastAutoTable?.finalY + 10;
    doc.setFont('helvetica', 'bold');
    doc.text('Memória de Cálculo - Potência Requerida:', 20, pumpStepY);
    doc.setFont('helvetica', 'normal');
    const qLps = (hydraulic.flow * 1000) / 3600;
    const pumpFormulaText = [
      `1. Cálculo da Altura Manométrica Total (HMT):`,
      `   HMT = Alt. Geométrica + Pressão Serviço + Perda Carga`,
      `   HMT = ${pump.staticHead} + ${pump.servicePressure} + ${headLoss} = ${totalHead} mca`,
      `2. Vazão em Litros por Segundo:`,
      `   Q = (${hydraulic.flow} * 1000) / 3600 = ${qLps.toFixed(2)} L/s`,
      `3. Cálculo da Potência (P):`,
      `   P(cv) = (Q[L/s] * HMT[m]) / (75 * Rendimento)`,
      `   P(cv) = (${qLps.toFixed(2)} * ${totalHead}) / (75 * ${pump.efficiency/100})`,
      `4. Resultado Final:`,
      `   Potência Mínima Calculada = ${pumpPower} cv`
    ];
    doc.text(pumpFormulaText, 25, pumpStepY + 7);

    // New Page for Demand
    doc.addPage();
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.text('3. DEMANDA HÍDRICA E TIPO DE SISTEMA', 20, 20);

    autoTable(doc, {
      startY: 25,
      head: [['Parâmetro de Demanda', 'Valor', 'Unidade']],
      body: [
        ['Evapotranspiração de Referência (ETo)', demand.eto, 'mm/dia'],
        ['Coeficiente da Cultura (Kc)', demand.kc, '-'],
        ['Área Total do Talhão', demand.area, 'ha'],
      ],
      headStyles: { fillColor: [249, 115, 22] },
      margin: { left: 20, right: 20 }
    });

    const demandStepY = (doc as any).lastAutoTable?.finalY + 10;
    doc.setFont('helvetica', 'bold');
    doc.text('Cálculo da Necessidade Hídrica:', 20, demandStepY);
    doc.setFont('helvetica', 'normal');
    const demandFormulaText = [
      `1. Lâmina Líquida (ETc):`,
      `   ETc = ETo * Kc = ${demand.eto} * ${demand.kc} = ${netDemand} mm/dia`,
      `2. Volume de Água Diário:`,
      `   Vol = ETc * Área * 10 (m³/ha)`,
      `   Vol = ${netDemand} * ${demand.area} * 10 = ${totalWaterDay} m³/dia`
    ];
    doc.text(demandFormulaText, 25, demandStepY + 7);

    const justificationY = demandStepY + 50;
    doc.setFont('helvetica', 'bold');
    doc.text('JUSTIFICATIVA TÉCNICA DO SISTEMA ESCOLHIDO:', 20, justificationY);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    const justificationText = technicalJustification || 
      (irrigationType === 'drip' 
        ? "O sistema de gotejamento foi selecionado visando a máxima eficiência no uso da água e energia, reduzindo perdas por evaporação e garantindo a aplicação direta na zona radicular da cultura, ideal para cultivos intensivos e regiões com escassez hídrica."
        : "O sistema de aspersão foi escolhido pela sua versatilidade na cobertura de grandes áreas e adaptabilidade a diferentes topografias, permitindo o controle do microclima e facilitando a mecanização agrícola em culturas de cobertura total.");
    const splitJustification = doc.splitTextToSize(justificationText, pageWidth - 40);
    doc.text(splitJustification, 20, justificationY + 7);

    // References and Planning
    doc.addPage();
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.text('4. PLANEJAMENTO E REFERÊNCIAS', 20, 20);

    doc.setFontSize(10);
    doc.text('PLANEJAMENTO FINAL E CONSIDERAÇÕES:', 20, 35);
    doc.setFont('helvetica', 'normal');
    const planningText = planningNotes || "O projeto dimensionado deve ser implantado seguindo rigorosamente as especificações de diâmetros e potências aqui descritas. Recomenda-se a instalação de ventosas nos pontos altos e válvulas de descarga nos pontos baixos da rede para manutenção da integridade hidráulica do sistema.";
    const splitPlanning = doc.splitTextToSize(planningText, pageWidth - 40);
    doc.text(splitPlanning, 20, 42);

    doc.setFont('helvetica', 'bold');
    doc.text('REFERÊNCIAS BIBLIOGRÁFICAS:', 20, 70);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    const refs = [
      'BERNARDO, S.; MANTOVANI, E. C.; SILVA, D. D.; SOARES, A. A. Manual de Irrigação. 9. ed. Viçosa: Ed. UFV, 2019.',
      'ALLEN, R. G.; PEREIRA, L. S.; RAES, D.; SMITH, M. Crop evapotranspiration: Guidelines for computing water requirements. FAO Irrigation and Drainage Paper 56. Rome, 1998.',
      'HAZEN, A.; WILLIAMS, G. S. Hydraulic Tables. New York: John Wiley & Sons, 1920.',
      'ASSOCIAÇÃO BRASILEIRA DE NORMAS TÉCNICAS. NBR 14197:2020: Equipamentos de irrigação aspersão convencional — Critérios para o projeto.',
      'ASAE - American Society of Agricultural Engineers. Standards of Irrigation and Drainage.'
    ];
    doc.text(refs, 20, 77);

    const bottomY = doc.internal.pageSize.getHeight() - 40;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setDrawColor(200, 200, 200);
    doc.line(60, bottomY - 10, pageWidth - 60, bottomY - 10);
    doc.text(responsible || user?.displayName || 'TECNICO RESPONSAVEL', pageWidth / 2, bottomY - 5, { align: 'center' });
    doc.setFont('helvetica', 'normal');
    doc.text('ASSINATURA DO RESPONSÁVEL TÉCNICO', pageWidth / 2, bottomY, { align: 'center' });

    doc.setTextColor(150, 150, 150);
    doc.setFontSize(8);
    doc.text(`Relatório Técnico Gerado por AgroGestão Connect - ${formatDateTime(new Date())}`, pageWidth / 2, bottomY + 15, { align: 'center' });

    doc.save(`Projeto_Irrigacao_${client?.name?.replace(/\s+/g, '_') || 'Cliente'}.pdf`);
  };

  const handleSave = async () => {
    if (!selectedClientId) {
      toast.error('Por favor, selecione um cliente primeiro.');
      return;
    }
    
    setIsSaving(true);
    try {
      const client = clients.find(c => c.id === selectedClientId);
      const serviceId = await addDoc(collection(db, 'irrigation_projects'), {
        clientId: selectedClientId,
        clientName: client?.name || 'Cliente Desconhecido',
        propertyName,
        type: irrigationType,
        responsible,
        technicalJustification,
        scheduledDate,
        planningNotes,
        results: {
          headLoss,
          totalHead,
          pumpPower,
          netDemand,
          totalWaterDay,
          velocity
        },
        inputs: {
          hydraulic,
          pump,
          demand
        },
        createdAt: serverTimestamp(),
        createdBy: user?.uid,
        status: 'Finalizado'
      });

      // Automatically integrate with Agenda by creating a notification.
      // Isolado do try principal: se essa notificação falhar, o projeto já
      // foi salvo — não pode aparecer como erro e fazer duplicar o cadastro.
      try {
        if (user) {
          await addDoc(collection(db, 'notifications'), {
            userId: user.uid,
            title: 'Projeto de Irrigação Agendado',
            message: `O projeto para ${client?.name} foi integrado à agenda para o dia ${scheduledDate.split('-').reverse().join('/')}.`,
            type: 'success',
            read: false,
            createdAt: new Date().toISOString(),
            link: '/agenda'
          });
        }
      } catch (notifError) {
        console.warn('Falha ao criar notificação de agenda (projeto já foi salvo normalmente):', notifError);
      }

      setSaveSuccess(true);
      toast.success('Projeto de irrigação salvo com sucesso!');
      setTimeout(() => setSaveSuccess(false), 3000);
      generatePDF();
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'irrigation_projects');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteProject = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'irrigation_projects', id));
      setIsDeleteModalOpen(null);
      toast.success('Projeto excluído com sucesso.');
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, 'irrigation_projects');
    }
  };

  const renderStepContent = () => {
    switch (currentStep) {
      case 1:
        return (
          <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <label className="text-[10px] font-bold text-slate-500 uppercase">Comprimento do Trecho (m)</label>
                <input 
                  type="number" 
                  value={hydraulic.length || ''}
                  onChange={(e) => setHydraulic({...hydraulic, length: Number(e.target.value)})}
                  className="w-full glass-input" 
                  placeholder="Ex: 250" 
                />
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-bold text-slate-500 uppercase">Diâmetro Interno (mm)</label>
                <input 
                  type="number" 
                  value={hydraulic.diameter || ''}
                  onChange={(e) => setHydraulic({...hydraulic, diameter: Number(e.target.value)})}
                  className="w-full glass-input" 
                  placeholder="Ex: 50" 
                />
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-bold text-slate-500 uppercase">Vazão do Trecho (m³/h)</label>
                <input 
                  type="number" 
                  value={hydraulic.flow || ''}
                  onChange={(e) => setHydraulic({...hydraulic, flow: Number(e.target.value)})}
                  className="w-full glass-input" 
                  placeholder="Ex: 12.5" 
                />
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-bold text-slate-500 uppercase">Material da Tubulação</label>
                <select 
                  value={hydraulic.cFactor}
                  onChange={(e) => setHydraulic({...hydraulic, cFactor: Number(e.target.value)})}
                  className="w-full glass-input bg-white/50"
                >
                  <option value={150}>PVC ou PE (C=150)</option>
                  <option value={140}>PVC Antigo ou PE (C=140)</option>
                  <option value={130}>Aço Novo (C=130)</option>
                  <option value={100}>Ferro Fundido (C=100)</option>
                </select>
              </div>
            </div>

            <div className="p-4 bg-emerald-50 border border-emerald-100 rounded-2xl">
               <div className="flex justify-between items-center mb-2">
                  <h4 className="text-[10px] font-bold text-emerald-600 uppercase">Perda de Carga Calculada (hf)</h4>
                  <Info className="w-4 h-4 text-emerald-300" />
               </div>
               <div className="text-2xl font-mono font-bold text-emerald-800">{headLoss} <span className="text-sm font-normal">mca</span></div>
            </div>

            <div className="p-4 bg-white/40 border border-slate-100 rounded-2xl">
              <h5 className="flex items-center gap-2 text-[9px] font-bold text-slate-500 uppercase mb-3">
                <BookOpen className="w-3.5 h-3.5" /> Referência Técnica (Hazen-Williams)
              </h5>
              <div className="font-mono text-[10px] text-slate-600 bg-white/80 p-3 rounded-lg overflow-x-auto whitespace-nowrap mb-2">
                hf = 10.65 * L * (Q/C)^1.852 * D^-4.87
              </div>
              <div className="mt-3 p-3 bg-slate-50 rounded-xl border border-slate-100">
                <div className="text-[10px] font-bold text-slate-400 uppercase mb-2">Passo a Passo do Cálculo:</div>
                <div className="font-mono text-[9px] text-slate-500 space-y-1">
                  <div>1. Q = {hydraulic.flow} m³/h {'->'} {(hydraulic.flow/3600).toFixed(6)} m³/s</div>
                  <div>2. D = {hydraulic.diameter} mm {'->'} {(hydraulic.diameter/1000).toFixed(4)} m</div>
                  <div>3. hf = 10.65 * {hydraulic.length} * ({(hydraulic.flow/3600).toFixed(6)} / {hydraulic.cFactor})^1.852 * {(hydraulic.diameter/1000).toFixed(4)}^-4.87</div>
                  <div className="pt-1 border-t border-slate-200 text-emerald-600 font-bold">Res: {headLoss} mca</div>
                </div>
              </div>
              <p className="text-[10px] text-slate-400 italic mt-3">
                Cálculo baseado em fluidez linear para tubulações plásticas e metálicas. Conforme manual de irrigação (Bernardo, 2019).
              </p>
            </div>
          </motion.div>
        );
      case 2:
        return (
          <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="space-y-6">
             <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <label className="text-[10px] font-bold text-slate-500 uppercase">Altura Geométrica (m)</label>
                <input 
                  type="number" 
                  value={pump.staticHead || ''}
                  onChange={(e) => setPump({...pump, staticHead: Number(e.target.value)})}
                  className="w-full glass-input" 
                  placeholder="Ex: 15" 
                />
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-bold text-slate-500 uppercase">Pressão de Serviço Requerida (mca)</label>
                <input 
                  type="number" 
                  value={pump.servicePressure || ''}
                  onChange={(e) => setPump({...pump, servicePressure: Number(e.target.value)})}
                  className="w-full glass-input" 
                  placeholder="Ex: 20" 
                />
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-bold text-slate-500 uppercase">Rendimento da Bomba (%)</label>
                <input 
                  type="number" 
                  value={pump.efficiency || ''}
                  onChange={(e) => setPump({...pump, efficiency: Number(e.target.value)})}
                  className="w-full glass-input" 
                  placeholder="Ex: 75" 
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="p-4 bg-slate-50 border border-slate-100 rounded-2xl">
                 <h4 className="text-[10px] font-bold text-slate-500 uppercase mb-1">HMT (mca)</h4>
                 <div className="text-xl font-mono font-bold text-slate-800">{totalHead}</div>
              </div>
              <div className="p-4 bg-slate-50 border border-slate-100 rounded-2xl">
                 <h4 className="text-[10px] font-bold text-slate-600 uppercase mb-1">Potência (cv)</h4>
                 <div className="text-xl font-mono font-bold text-slate-800">{pumpPower}</div>
              </div>
            </div>

            <div className="p-4 bg-white/40 border border-slate-100 rounded-2xl">
              <h5 className="flex items-center gap-2 text-[9px] font-bold text-slate-500 uppercase mb-3">
                <BookOpen className="w-3.5 h-3.5" /> Referência para Dimensionamento Final
              </h5>
              <div className="font-mono text-[10px] text-slate-600 bg-white/80 p-3 rounded-lg overflow-x-auto whitespace-nowrap mb-2">
                P(cv) = (Q * HMT) / (75 * Rendimento)
              </div>
              <div className="mt-3 p-3 bg-slate-50 rounded-xl border border-slate-100">
                <div className="text-[10px] font-bold text-slate-400 uppercase mb-2">Passo a Passo do Cálculo:</div>
                <div className="font-mono text-[9px] text-slate-500 space-y-1">
                  <div>1. HMT = {pump.staticHead} + {pump.servicePressure} + {headLoss} = {totalHead} mca</div>
                  <div>2. Q = {(hydraulic.flow * 1000 / 3600).toFixed(2)} L/s</div>
                  <div>3. P = ({(hydraulic.flow * 1000 / 3600).toFixed(2)} * {totalHead}) / (75 * {pump.efficiency/100})</div>
                  <div className="pt-1 border-t border-slate-200 text-slate-600 font-bold">Res: {pumpPower} cv</div>
                </div>
              </div>
              <p className="text-[10px] text-slate-400 italic mt-3">
                Dimensionamento de potência útil requerida. Fórmula prática para estimativa de grupos motobomba (NBR 14197).
              </p>
            </div>
          </motion.div>
        );
      case 3:
        return (
          <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="space-y-6">
             <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <label className="text-[10px] font-bold text-slate-500 uppercase">ETo (Ref: Estação Climática) mm/dia</label>
                <input 
                  type="number" 
                  value={demand.eto || ''}
                  onChange={(e) => setDemand({...demand, eto: Number(e.target.value)})}
                  className="w-full glass-input" 
                  placeholder="Ex: 6.2" 
                />
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-bold text-slate-500 uppercase">Kc (Coeficiente da Cultura)</label>
                <input 
                  type="number" 
                  value={demand.kc || ''}
                  onChange={(e) => setDemand({...demand, kc: Number(e.target.value)})}
                  className="w-full glass-input" 
                  placeholder="Ex: 0.85" 
                />
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-bold text-slate-500 uppercase">Área do Projeto (Hectares)</label>
                <input 
                  type="number" 
                  value={demand.area || ''}
                  onChange={(e) => setDemand({...demand, area: Number(e.target.value)})}
                  className="w-full glass-input" 
                  placeholder="Ex: 10" 
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="p-4 bg-amber-50 border border-amber-100 rounded-2xl">
                 <h4 className="text-[10px] font-bold text-amber-600 uppercase mb-1">Lâmina Líquida (ETc)</h4>
                 <div className="text-xl font-mono font-bold text-amber-800">{netDemand} <span className="text-[10px] font-normal">mm/dia</span></div>
              </div>
              <div className="p-4 bg-amber-600 text-white rounded-2xl shadow-lg shadow-amber-100">
                 <h4 className="text-[10px] font-bold text-amber-100 uppercase mb-1">Volume Diário</h4>
                 <div className="text-xl font-mono font-bold">{totalWaterDay} <span className="text-[10px] font-normal">m³/dia</span></div>
              </div>
            </div>

            <div className="p-4 bg-white/40 border border-slate-100 rounded-2xl">
              <h5 className="flex items-center gap-2 text-[9px] font-bold text-slate-500 uppercase mb-3">
                <BookOpen className="w-3.5 h-3.5" /> Referência FAO-56
              </h5>
              <div className="font-mono text-[10px] text-slate-600 bg-white/80 p-3 rounded-lg overflow-x-auto whitespace-nowrap mb-2">
                ETc = ETo * Kc (Lâmina Bruta = ETc / Eficiência)
              </div>
              <div className="mt-3 p-3 bg-slate-50 rounded-xl border border-slate-100">
                <div className="text-[10px] font-bold text-slate-400 uppercase mb-2">Passo a Passo do Cálculo:</div>
                <div className="font-mono text-[9px] text-slate-500 space-y-1">
                  <div>1. ETc = {demand.eto} * {demand.kc} = {netDemand} mm/dia</div>
                  <div>2. Vol = {netDemand} * {demand.area} * 10 = {totalWaterDay} m³/dia</div>
                  <div className="pt-1 border-t border-slate-200 text-amber-600 font-bold">Res: {totalWaterDay} m³/dia</div>
                </div>
              </div>
              <p className="text-[10px] text-slate-400 italic mt-3">
                Necessidade hídrica teórica. Conforme Crop Evapotranspiração (FAO Paper 56).
              </p>
            </div>
          </motion.div>
        );
      case 4:
        return (
          <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="space-y-6 text-center">
             <h4 className="font-display font-medium text-slate-600">Selecione o método de aplicação:</h4>
             <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <button 
                  onClick={() => setIrrigationType('drip')}
                  className={cn(
                    "p-8 rounded-3xl border-2 transition-all flex flex-col items-center gap-4",
                    irrigationType === 'drip' ? "bg-emerald-50 border-emerald-500" : "bg-white/40 border-white/60 hover:border-emerald-200"
                  )}
                >
                   <div className={cn("p-4 rounded-2xl", irrigationType === 'drip' ? "bg-emerald-600 text-white" : "bg-slate-100 text-slate-400")}>
                      <Droplet className="w-10 h-10" />
                   </div>
                   <div>
                      <div className="font-bold text-slate-700">Gotejamento</div>
                      <div className="text-[10px] text-slate-400 font-bold uppercase mt-1">Alta Eficiência (90-95%)</div>
                   </div>
                </button>
                <button 
                  onClick={() => setIrrigationType('sprinkler')}
                  className={cn(
                    "p-8 rounded-3xl border-2 transition-all flex flex-col items-center gap-4",
                    irrigationType === 'sprinkler' ? "bg-slate-50 border-emerald-500" : "bg-white/40 border-white/60 hover:border-slate-200"
                  )}
                >
                   <div className={cn("p-4 rounded-2xl", irrigationType === 'sprinkler' ? "bg-emerald-600 text-white" : "bg-slate-100 text-slate-400")}>
                      <CloudRain className="w-10 h-10" />
                   </div>
                   <div>
                      <div className="font-bold text-slate-700">Aspersão</div>
                      <div className="text-[10px] text-slate-400 font-bold uppercase mt-1">Versatilidade (75-85%)</div>
                   </div>
                </button>
             </div>
             {irrigationType && (
               <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
                 <div className="p-4 bg-emerald-50 rounded-2xl text-emerald-700 text-[10px] flex items-center justify-center gap-2">
                   <ShieldCheck className="w-4 h-4" />
                   Método selecionado afetará o cálculo da lâmina bruta final no memorial técnico.
                 </div>
                 <div className="text-left space-y-2">
                   <label className="text-[10px] font-bold text-slate-500 uppercase px-1">Justificativa Técnica da Escolha</label>
                   <textarea 
                     rows={3}
                     value={technicalJustification}
                     onChange={(e) => setTechnicalJustification(e.target.value)}
                     placeholder="Descreva o porquê da escolha deste sistema para este talhão/cultura..."
                     className="w-full glass-input text-xs"
                   />
                 </div>
               </motion.div>
             )}
          </motion.div>
        );
      case 5:
        return (
          <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="space-y-6">
             <div className="glass-card p-6 bg-emerald-600 text-white dashboard-stat-card shadow-emerald-200">
                <div className="flex justify-between items-start">
                   <div>
                      <h3 className="font-display font-bold text-lg">Projeto Pronto para Emissão</h3>
                      <p className="text-emerald-100 text-xs mt-1">O memorial contempla todos os passos de dimensionamento hidráulico e operacional.</p>
                   </div>
                   <ShieldCheck className="w-8 h-8 opacity-40" />
                </div>
                <button 
                  onClick={generatePDF}
                  className="mt-6 w-full py-3 bg-white text-emerald-700 rounded-xl font-bold flex items-center justify-center gap-2 hover:bg-emerald-50 transition-colors shadow-lg"
                >
                   <Printer className="w-4 h-4" /> Visualizar e Exportar PDF
                </button>
             </div>

             <div className="space-y-4">
                <div className="flex items-center gap-2 text-slate-400">
                   <FileText className="w-4 h-4" />
                   <h4 className="text-[10px] font-bold uppercase tracking-widest">Observações de Planejamento</h4>
                </div>
                <textarea 
                  rows={4}
                  value={planningNotes}
                  onChange={(e) => setPlanningNotes(e.target.value)}
                  placeholder="Adicione notas específicas sobre a execução do projeto, recomendações de instalação ou futuras ampliações..."
                  className="w-full glass-input text-xs"
                />
             </div>

             <div className="pt-6 border-t border-white/20">
                <div className="space-y-1.5">
                   <div className="flex items-center gap-2 mb-2">
                      <UserCheck className="w-4 h-4 text-emerald-500" />
                      <label className="text-[10px] font-bold text-slate-400 uppercase">Responsável Técnico (Gerado Automaticamente)</label>
                   </div>
                   <input 
                     readOnly
                     value={responsible}
                     className="w-full glass-input font-bold text-slate-400 bg-slate-50 cursor-not-allowed" 
                   />
                </div>
             </div>
          </motion.div>
        );
      default:
        return null;
    }
  };

  return (
    <div className="flex flex-col gap-6 h-full overflow-y-auto pr-2 pb-10 custom-scrollbar">
      <header className={PAGE_HEADER_CLASS} data-page-header>
        <PageTitle icon={PageIcon} title="Irrigação" subtitle="Projetos e cálculos de engenharia hídrica com memorial técnico" />

        <div className="flex items-center gap-4">
           {showPropertySelect && (
              <div className="text-right hidden sm:block animate-in fade-in slide-in-from-right-2">
                 <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Selecionar Propriedade</div>
                 <select 
                   value={propertyName}
                   onChange={(e) => setPropertyName(e.target.value)}
                   className="text-xs font-bold text-slate-600 bg-transparent border-b border-emerald-500/40 focus:border-emerald-500 outline-none text-right appearance-none"
                 >
                    <option value="">Escolha...</option>
                    {availableProperties.map(p => <option key={p} value={p}>{p}</option>)}
                 </select>
              </div>
           )}
           {!showPropertySelect && (
              <div className="text-right hidden sm:block">
                 <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Local do Projeto</div>
                 <input 
                   type="text"
                   placeholder="Nome da Propriedade"
                   value={propertyName}
                   onChange={(e) => setPropertyName(e.target.value)}
                   className="text-xs font-bold text-emerald-600 bg-transparent border-b border-emerald-500/20 focus:border-emerald-500 outline-none text-right"
                 />
              </div>
           )}
           <div className="text-right hidden xl:block ml-4">
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Execução Agendada</div>
              <input 
                type="date"
                value={scheduledDate}
                onChange={(e) => setScheduledDate(e.target.value)}
                className="text-xs font-bold text-slate-600 bg-transparent border-b border-emerald-500/20 focus:border-emerald-500 outline-none text-right"
              />
           </div>
           <div className="text-right hidden sm:block ml-4">
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Vincular Cliente</div>
              <div className="text-xs font-bold text-slate-600 italic">Necessário para emissão</div>
           </div>
           <div className="relative">
              <select 
                value={selectedClientId}
                onChange={(e) => handleClientChange(e.target.value)}
                className="pl-9 pr-4 py-2.5 glass-input text-xs font-bold w-64 bg-white/50 border-emerald-500/20"
              >
                <option value="">Selecione o Cliente...</option>
                {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-emerald-500" />
           </div>
        </div>
      </header>

      <div className="glass-card p-4 sm:p-6 mx-4 shadow-md bg-white/60 border-emerald-500/10">
        <div className="grid grid-cols-5 gap-1 sm:gap-2 md:flex md:items-center md:justify-between w-full max-w-4xl mx-auto md:px-4">
           {STEPS.map((step, idx) => (
             <React.Fragment key={step.id}>
               <button 
                 onClick={() => setCurrentStep(step.id)}
                 className={cn(
                   "flex flex-col items-center justify-start gap-2.5 transition-all relative z-10 w-full group",
                   currentStep >= step.id ? "text-emerald-700" : "text-slate-400"
                 )}
               >
                  <div className={cn(
                    "w-12 h-12 sm:w-16 sm:h-16 rounded-2xl flex items-center justify-center border-2 transition-all duration-300",
                    currentStep === step.id ? "bg-emerald-600 text-white border-emerald-600 shadow-xl shadow-emerald-500/25 scale-110" :
                    currentStep > step.id ? "bg-emerald-50 text-emerald-600 border-emerald-100" : "bg-white/80 border-slate-100 group-hover:border-emerald-200"
                  )}>
                     <step.icon className={cn("w-5 h-5 sm:w-7 sm:h-7", currentStep === step.id && "animate-pulse")} />
                  </div>
                  <span className={cn(
                    "text-[9px] sm:text-[11px] md:text-xs font-bold uppercase tracking-tight text-center leading-tight whitespace-normal max-w-[70px] sm:max-w-[100px] md:max-w-none transition-colors",
                    currentStep === step.id ? "text-emerald-800" : "text-slate-400"
                  )}>
                    {step.title}
                  </span>
               </button>
               {idx < STEPS.length - 1 && (
                 <div className="hidden md:block flex-1 px-2 lg:px-4 min-w-[10px]">
                    <div className={cn(
                      "h-[2px] w-full rounded-full transition-colors duration-500",
                      currentStep > step.id ? "bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.3)]" : "bg-slate-200"
                    )}></div>
                 </div>
               )}
             </React.Fragment>
           ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
         <div className="lg:col-span-2 glass-card p-8 min-h-[500px] flex flex-col">
            <div className="flex justify-between items-center mb-8 pb-6 border-b border-white/20">
               <div>
                  <h2 className="text-xl font-display font-bold text-slate-800">{STEPS[currentStep-1].title}</h2>
                  <p className="text-xs text-slate-400 mt-1">{STEPS[currentStep-1].description}</p>
               </div>
               <div className="px-3 py-1 bg-slate-100 rounded-full text-[10px] font-bold text-slate-400">DIMENSIONAMENTO {currentStep}/5</div>
            </div>

            <div className="flex-1">
               {renderStepContent()}
            </div>

            <div className="flex justify-between pt-10 border-t border-white/20 mt-10">
               <button 
                 onClick={prevStep}
                 disabled={currentStep === 1}
                 className="px-6 py-3 border border-slate-200 rounded-2xl text-sm font-bold text-slate-500 hover:bg-slate-50 transition-colors flex items-center gap-2 disabled:opacity-20"
               >
                 <ArrowLeft className="w-4 h-4" /> Voltar
               </button>
               <button 
                 onClick={currentStep === 5 ? (((user?.effectiveRole ?? user?.role) === 'staff' || (user?.effectiveRole ?? user?.role) === 'consultant') ? undefined : handleSave) : nextStep}
                 disabled={isSaving}
                 className={cn(
                   "px-8 py-3 rounded-2xl text-sm font-bold text-white transition-all flex items-center gap-2 shadow-lg",
                   currentStep === 5 ? (saveSuccess ? "bg-emerald-500 shadow-emerald-100" : "bg-emerald-600 shadow-emerald-100") : "bg-emerald-600 shadow-emerald-100",
                   isSaving && "opacity-50 cursor-not-allowed"
                 )}
               >
                 {currentStep === 5 
                   ? (saveSuccess 
                       ? <><CheckCircle2 className="w-4 h-4" /> Concluído!</> 
                       : (((user?.effectiveRole ?? user?.role) === 'staff' || (user?.effectiveRole ?? user?.role) === 'consultant') 
                           ? 'Apenas Leitura' 
                           : (isSaving ? 'Gerando...' : 'Concluir e Salvar'))) 
                   : 'Avançar'} <ArrowRight className="w-4 h-4" />
               </button>
            </div>
         </div>

         <div className="space-y-6">
            <div className="glass-card p-6 border-t-4 border-t-emerald-500">
               <h3 className="font-bold text-slate-700 flex items-center gap-2 mb-4">
                  <Calculator className="w-4 h-4 text-emerald-500" /> Resumo Dinâmico
               </h3>
               <div className="space-y-4">
                  <div className="flex justify-between items-center py-2 border-b border-dashed border-slate-100">
                     <span className="text-xs text-slate-400 font-medium">Velocidade Fluxo:</span>
                     <div className="flex items-center gap-2">
                        <span className={cn("text-xs font-bold", velocity > 2.0 ? "text-rose-500" : "text-slate-700")}>
                          {velocity} m/s
                        </span>
                        {velocity > 2.0 && <Zap className="w-3 h-3 text-rose-500 animate-pulse" />}
                     </div>
                  </div>
                  <div className="flex justify-between items-center py-2 border-b border-dashed border-slate-100">
                     <span className="text-xs text-slate-400 font-medium">Perda de Carga (hf):</span>
                     <span className="text-xs font-bold text-slate-700">{headLoss} mca</span>
                  </div>
                  <div className="flex justify-between items-center py-2 border-b border-dashed border-slate-100">
                     <span className="text-xs text-slate-400 font-medium">HMT Total:</span>
                     <span className="text-xs font-bold text-slate-700">{totalHead} mca</span>
                  </div>
                  <div className="flex justify-between items-center py-2 border-b border-dashed border-slate-100">
                     <span className="text-xs text-slate-400 font-medium">Potência Calculada:</span>
                     <span className="text-xs font-bold text-emerald-600">{pumpPower} cv</span>
                  </div>
               </div>
            </div>

            {velocity > 2.0 && (
              <motion.div 
                initial={{ opacity: 0, scale: 0.9 }} 
                animate={{ opacity: 1, scale: 1 }}
                className="p-4 bg-rose-50 border border-rose-100 rounded-2xl flex items-start gap-3"
              >
                 <Zap className="w-5 h-5 text-rose-500 shrink-0 mt-1" />
                 <div>
                    <div className="text-xs font-bold text-rose-700 uppercase">Alerta de Engenharia</div>
                    <p className="text-[10px] text-rose-600 mt-1">Velocidade do fluxo ({velocity} m/s) acima do limite recomendado (2.0 m/s). Considere aumentar o diâmetro da tubulação para evitar desgaste e golpes de aríete.</p>
                 </div>
              </motion.div>
            )}

            <div className="glass-card p-6">
               <h3 className="font-bold text-slate-700 flex items-center gap-2 mb-4">
                  <FileText className="w-4 h-4 text-emerald-500" /> Projetos Recentes
               </h3>
               <div className="space-y-3">
                  {projects.length === 0 ? (
                    <div className="text-[10px] text-slate-400 italic py-4 text-center">Nenhum projeto salvo.</div>
                  ) : (
                    projects.map(p => (
                      <div key={p.id} className="p-3 bg-white/50 border border-white/60 rounded-xl hover:border-emerald-200 transition-colors group relative">
                        <div className="text-[10px] font-bold text-slate-700 truncate pr-6">{p.propertyName || 'Sem Nome'}</div>
                        <div className="flex justify-between items-center mt-1">
                          <span className="text-[9px] text-slate-400">{p.clientName}</span>
                          <span className="text-[9px] font-bold text-emerald-600">{formatDate(typeof p.createdAt?.toDate === 'function' ? p.createdAt.toDate() : p.createdAt)}</span>
                        </div>
                        {!((user?.effectiveRole ?? user?.role) === 'staff' || (user?.effectiveRole ?? user?.role) === 'consultant') && (
                          <button 
                            onClick={(e) => {
                              e.stopPropagation();
                              setIsDeleteModalOpen(p.id);
                            }}
                            className="absolute right-2 top-2 p-1 text-slate-300 hover:text-rose-500 opacity-0 group-hover:opacity-100 transition-all focus:opacity-100"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    ))
                  )}
               </div>
            </div>

            <div className="glass-card p-6 bg-slate-800 text-white border-none shadow-xl shadow-slate-900/20">
               <h3 className="font-bold mb-3 flex items-center gap-2">
                  <BookOpen className="w-4 h-4 text-emerald-400" /> Nota de Engenharia
               </h3>
               <p className="text-[11px] text-slate-300 leading-relaxed mb-4">
                  Os cálculos utilizam coeficientes de rugosidade normatizados. Recomenda-se um fator de segurança de 15% na escolha final da motobomba comercial.
               </p>
               <div className="pt-4 border-t border-white/10 flex items-center gap-3">
                  <div className="w-8 h-8 rounded-xl bg-emerald-500/20 flex items-center justify-center font-bold text-emerald-400 text-xs">i</div>
                  <div className="text-[10px] text-slate-400 uppercase font-bold tracking-tight">Cálculo em Tempo Real</div>
               </div>
            </div>
         </div>
      </div>

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
