import React, { useState, useEffect, useRef } from 'react';
import { runExclusive } from '../lib/submitGuard';
import { 
  BarChart3, 
  Download, 
  FileText, 
  FileSpreadsheet, 
  Bot, 
  Send, 
  ChevronRight, 
  User, 
  Users,
  Loader2, 
  Sparkles, 
  CheckCircle2, 
  Activity, 
  TrendingUp, 
  Info,
  Layers,
  Award,
  BookOpen,
  Calendar,
  DollarSign,
  Sprout,
  ClipboardCheck
} from 'lucide-react';
import { collection, onSnapshot, query, orderBy, where, getDocs } from 'firebase/firestore';
import { db, auth } from '../lib/firebase';
import { useAuth } from '../contexts/AuthContext';
import { toast } from 'sonner';
import { exportToExcel } from '../lib/exportExcel';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import SkeletonList from '../components/SkeletonList';
import EfficiencyReport from '../components/EfficiencyReport';
import { formatDate, formatCurrency } from '../lib/utils';
import { Client, FieldVisit, FinancialRecord, ServiceAnalysis, Contract } from '../types';
import { PageTitle, PAGE_HEADER_CLASS } from '../components/layout/PageHeader';
import { BarChart3 as PageIcon } from 'lucide-react';
import { getPdfBranding } from '../lib/pdfBranding';

export default function Reports() {
  const { user } = useAuth();
  const [activeReportTab, setActiveReportTab] = useState<'downloads' | 'efficiency'>('downloads');
  const [clients, setClients] = useState<Client[]>([]);
  const [visits, setVisits] = useState<FieldVisit[]>([]);
  const [financials, setFinancials] = useState<FinancialRecord[]>([]);
  const [analyses, setAnalyses] = useState<ServiceAnalysis[]>([]);
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [loading, setLoading] = useState(true);

  // Selector for Annual Executive Report
  const [selectedClientId, setSelectedClientId] = useState('');
  const [generatingExecutive, setGeneratingExecutive] = useState(false);

  // Chat AI State
  const [chatQuery, setChatQuery] = useState('');
  const [chatMessages, setChatMessages] = useState<{ sender: 'user' | 'ai'; text: string; timestamp: Date }[]>([
    { 
      sender: 'ai', 
      text: 'Olá! Sou o AgroGestor AI. Posso lhe ajudar a analisar dados de campo, projetar lucros e dar suporte no manejo de pragas e calibração de pulverização. O que deseja consultar hoje?', 
      timestamp: new Date() 
    }
  ]);
  const [loadingChat, setLoadingChat] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Load database entities
  useEffect(() => {
    const unsubClients = onSnapshot(collection(db, 'clients'), (sn) => {
      setClients(sn.docs.map(d => ({ id: d.id, ...d.data() } as Client)));
    });

    const unsubVisits = onSnapshot(collection(db, 'field_visits'), (sn) => {
      setVisits(sn.docs.map(d => ({ id: d.id, ...d.data() } as FieldVisit)));
    });

    const unsubFinance = onSnapshot(collection(db, 'financials'), (sn) => {
      setFinancials(sn.docs.map(d => ({ id: d.id, ...d.data() } as FinancialRecord)));
    });

    const unsubAnalyses = onSnapshot(collection(db, 'analyses'), (sn) => {
      setAnalyses(sn.docs.map(d => ({ id: d.id, ...d.data() } as ServiceAnalysis)));
    });

    const unsubContracts = onSnapshot(collection(db, 'contracts'), (sn) => {
      setContracts(sn.docs.map(d => ({ id: d.id, ...d.data() } as Contract)));
      setLoading(false);
    });

    return () => {
      unsubClients();
      unsubVisits();
      unsubFinance();
      unsubAnalyses();
      unsubContracts();
    };
  }, []);

  // Auto-scroll chat window
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [chatMessages, loadingChat]);

  // Section 1: Consolidation PDF/Excel Downloaders
  const handleDownloadVisitsConsolidated = () => {
    if (visits.length === 0) {
      toast.error("Nenhuma visita para relatar.");
      return;
    }
    const doc = new jsPDF();
    doc.setFillColor(16, 185, 129);
    doc.rect(0, 0, 210, 35, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(20);
    doc.setFont("Helvetica", "bold");
    doc.text(getPdfBranding().companyName, 15, 15);
    doc.setFontSize(10);
    doc.setFont("Helvetica", "normal");
    doc.text(`Relatório Geral Consolidado de Visitas Técnicas (${visits.length} registradas)`, 15, 27);

    const rows = visits.map(v => [
      formatDate(v.visitDate),
      v.clientName,
      v.propertyName,
      v.technicianName,
      v.objective,
      (v.crops || []).map(c => c.name).join(', ')
    ]);

    autoTable(doc, {
      startY: 45,
      head: [['Data', 'Cliente', 'Propriedade', 'Gestor Técnico', 'Objetivo Inspeção', 'Grãos/Cultura']],
      body: rows,
      headStyles: { fillColor: [16, 185, 129] },
      styles: { fontSize: 8.5 }
    });

    doc.save("Visitas_Consolidadas_AgroGestao.pdf");
    toast.success("PDF de visitas técnicas exportado!");
  };

  const handleDownloadFinancialConsolidated = () => {
    if (financials.length === 0) {
      toast.error("Nenhum lançamento financeiro para tabular.");
      return;
    }
    const data = financials.map(f => ({
      Data_Vencimento: formatDate(f.dueDate),
      Cliente: f.clientName,
      Descrição: f.description,
      Valor_R$: f.value,
      Método_Operacao: f.paymentMethod,
      Status: (f.status || '').toUpperCase(),
      Categoria: f.category,
      Liquidado_Em: f.paymentDate ? formatDate(f.paymentDate) : 'Em aberto'
    }));
    exportToExcel(data, "Livro_Caixa_Consolidado_AgroGestao", "Finanças");
    toast.success("Planilha de finanças consolidada exportada!");
  };

  const handleDownloadFinancialPDF = () => {
    if (financials.length === 0) {
      toast.error("Nenhum lançamento financeiro para tabular.");
      return;
    }
    const doc = new jsPDF();
    doc.setFillColor(16, 185, 129); // emerald 500
    doc.rect(0, 0, 210, 35, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(20);
    doc.setFont("Helvetica", "bold");
    doc.text(getPdfBranding().companyName, 15, 15);
    doc.setFontSize(10);
    doc.setFont("Helvetica", "normal");
    doc.text(`Relatório Geral Consolidado Financeiro e Balanços LCDPR (${financials.length} lançamentos)`, 15, 27);

    const rows = financials.map(f => [
      formatDate(f.dueDate),
      f.clientName,
      f.description,
      f.category,
      (f.paymentMethod || '').toUpperCase(),
      f.status === 'paid' ? 'PAGO' : 'PENDENTE',
      `R$ ${f.value.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
    ]);

    const totalRevenue = financials.reduce((sum, f) => sum + f.value, 0);

    autoTable(doc, {
      startY: 45,
      head: [['Vencimento', 'Cliente', 'Descrição', 'Categoria', 'Método', 'Status', 'Valor Praticado']],
      body: rows,
      headStyles: { fillColor: [16, 185, 129] },
      styles: { fontSize: 8.5 }
    });

    const finalY = (doc as any).lastAutoTable.finalY || 50;
    doc.setFontSize(10);
    doc.setFont("Helvetica", "bold");
    doc.setTextColor(30, 41, 59);
    doc.text(`Valor Consolidado Acumulado: R$ ${totalRevenue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`, 15, finalY + 10);

    doc.save("Financeiro_Consolidado_AgroGestao.pdf");
    toast.success("PDF de finanças consolidadas exportado!");
  };

  const handleDownloadAnalysesConsolidated = () => {
    if (analyses.length === 0) {
      toast.error("Nenhuma análise cadastrada.");
      return;
    }
    const doc = new jsPDF();
    doc.setFillColor(16, 185, 129);
    doc.rect(0, 0, 210, 35, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(20);
    doc.text(getPdfBranding().companyName, 15, 15);
    doc.setFontSize(10);
    doc.text(`Consolidado de Projetos e Laudos de Terras (${analyses.length} registros)`, 15, 27);

    const rows = analyses.map(a => [
      a.createdAt ? formatDate(a.createdAt) : 'N/D',
      a.clientName || 'N/D',
      a.propertyName || 'N/D',
      (a.type || '').toUpperCase(),
      (a.status || '').toUpperCase(),
      a.responsibleTechnician || 'N/D'
    ]);

    autoTable(doc, {
      startY: 45,
      head: [['Data Registro', 'Cliente', 'Fazenda', 'Tipo Análise', 'Status', 'Técnico Responsável']],
      body: rows,
      headStyles: { fillColor: [16, 185, 129] },
      styles: { fontSize: 8.5 }
    });

    doc.save("Analises_e_Projetos_AgroGestao.pdf");
    toast.success("PDF de projetos e análises exportado!");
  };

  const handleDownloadCropsConsolidated = () => {
    // Collect crop data from visits
    const cropStats: Record<string, { name: string; totalArea: number; properties: Set<string>; stages: Set<string>; visitCount: number; obs: string[] }> = {};
    
    visits.forEach(v => {
      if (v.crops && Array.isArray(v.crops)) {
        (v.crops || []).forEach(c => {
          const key = (c.name || '').trim().toLowerCase();
          if (!key) return;
          
          if (!cropStats[key]) {
            cropStats[key] = {
              name: c.name,
              totalArea: 0,
              properties: new Set<string>(),
              stages: new Set<string>(),
              visitCount: 0,
              obs: []
            };
          }
          
          cropStats[key].totalArea += Number(c.estimatedArea) || 0;
          if (v.propertyName) cropStats[key].properties.add(v.propertyName);
          if (c.stage) cropStats[key].stages.add(c.stage);
          cropStats[key].visitCount += 1;
          if (c.observations) cropStats[key].obs.push(c.observations);
        });
      }
    });

    const cropList = Object.values(cropStats);

    if (cropList.length === 0) {
      toast.error("Nenhum dado de safra/cultura encontrado nas visitas.");
      return;
    }

    const doc = new jsPDF();
    doc.setFillColor(16, 185, 129); // emerald 500
    doc.rect(0, 0, 210, 35, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(20);
    doc.setFont("Helvetica", "bold");
    doc.text(getPdfBranding().companyName, 15, 15);
    doc.setFontSize(10);
    doc.setFont("Helvetica", "normal");
    doc.text(`Relatório Geral Consolidado de Safra e Culturas Ativas (${cropList.length} culturas sob gestão)`, 15, 27);

    const rows = cropList.map(c => [
      c.name,
      `${c.totalArea.toLocaleString('pt-BR')} ha`,
      Array.from(c.stages).join(', ') || 'N/D',
      `${c.properties.size} Fazenda(s) (${c.visitCount} vistorias)`,
      c.obs.slice(0, 2).join('; ') || 'Sem anotações de estresse.'
    ]);

    autoTable(doc, {
      startY: 45,
      head: [['Cultura/Grão', 'Área Monitorada', 'Estágios Identificados', 'Propriedades & Visitas', 'Anotações Fitossanitárias']],
      body: rows,
      headStyles: { fillColor: [16, 185, 129] },
      styles: { fontSize: 8.5 }
    });

    const finalY = (doc as any).lastAutoTable.finalY || 50;
    doc.setFontSize(9);
    doc.setFont("Helvetica", "italic");
    doc.setTextColor(100, 116, 139);
    doc.text(`* Total de área consolidada de grãos monitorados: ${cropList.reduce((sum, c) => sum + c.totalArea, 0).toLocaleString('pt-BR')} Hectares`, 15, finalY + 10);

    doc.save("Relatorio_Consolidado_Safra_AgroGestao.pdf");
    toast.success("PDF consolidado de safra e culturas exportado!");
  };

  const handleDownloadSoilAnalysesPDF = () => {
    const soilAnalyses = analyses.filter(a => a.type === 'soil');
    if (soilAnalyses.length === 0) {
      toast.error("Nenhuma análise de solo cadastrada para exportar.");
      return;
    }
    const doc = new jsPDF();
    
    // Header banner
    doc.setFillColor(16, 185, 129); // emerald 500
    doc.rect(0, 0, 210, 35, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(20);
    doc.setFont("Helvetica", "bold");
    doc.text(getPdfBranding().companyName, 15, 15);
    doc.setFontSize(10);
    doc.setFont("Helvetica", "normal");
    doc.text(`Relatório Analítico de Solo e Nutrientes (${soilAnalyses.length} amostras sob controle)`, 15, 27);

    // Let's calculate some averages
    let phSum = 0, phCount = 0;
    let pSum = 0, pCount = 0;
    let kSum = 0, kCount = 0;
    let vSum = 0, vCount = 0;

    const rows = soilAnalyses.map(a => {
      const r = a.results || {};
      const phVal = r.ph !== undefined ? Number(r.ph) : (r.ph_h2o !== undefined ? Number(r.ph_h2o) : null);
      const pVal = r.p !== undefined ? Number(r.p) : null;
      const kVal = r.k !== undefined ? Number(r.k) : null;
      const vVal = r.v_percent !== undefined ? Number(r.v_percent) : null;

      if (phVal !== null && !isNaN(phVal)) { phSum += phVal; phCount++; }
      if (pVal !== null && !isNaN(pVal)) { pSum += pVal; pCount++; }
      if (kVal !== null && !isNaN(kVal)) { kSum += kVal; kCount++; }
      if (vVal !== null && !isNaN(vVal)) { vSum += vVal; vCount++; }

      return [
        a.createdAt ? formatDate(a.createdAt) : 'N/D',
        a.clientName || 'N/D',
        a.propertyName || 'N/D',
        (a.status || '').toUpperCase(),
        phVal !== null ? phVal.toFixed(1) : '-',
        pVal !== null ? `${pVal.toFixed(1)} mg/dm³` : '-',
        kVal !== null ? `${kVal.toFixed(2)} cmolc/dm³` : '-',
        vVal !== null ? `${vVal.toFixed(1)}%` : '-'
      ];
    });

    autoTable(doc, {
      startY: 45,
      head: [['Data Registro', 'Cliente', 'Fazenda', 'Status', 'pH', 'Fósforo (P)', 'Potássio (K)', 'Sat. Bases (V%)']],
      body: rows,
      headStyles: { fillColor: [16, 185, 129] },
      styles: { fontSize: 8 }
    });

    const finalY = (doc as any).lastAutoTable.finalY || 50;
    doc.setFontSize(10);
    doc.setFont("Helvetica", "bold");
    doc.setTextColor(30, 41, 59);
    doc.text("Médias Nutritivas Consolidadas das Amostras Registradas:", 15, finalY + 12);
    
    doc.setFontSize(9);
    doc.setFont("Helvetica", "normal");
    doc.setTextColor(71, 85, 105);
    const avgPhStr = phCount > 0 ? (phSum / phCount).toFixed(2) : 'Sem dados';
    const avgPStr = pCount > 0 ? `${(pSum / pCount).toFixed(2)} mg/dm³` : 'Sem dados';
    const avgKStr = kCount > 0 ? `${(kSum / kCount).toFixed(3)} cmolc/dm³` : 'Sem dados';
    const avgVStr = vCount > 0 ? `${(vSum / vCount).toFixed(1)}%` : 'Sem dados';
    
    doc.text(`• pH Médio: ${avgPhStr}`, 15, finalY + 20);
    doc.text(`• Fósforo Médio (P): ${avgPStr}`, 15, finalY + 26);
    doc.text(`• Potássio Médio (K): ${avgKStr}`, 15, finalY + 32);
    doc.text(`• Saturação por Bases Média (V%): ${avgVStr}`, 15, finalY + 38);

    doc.save("Resumo_Analises_Solo_AgroGestao.pdf");
    toast.success("PDF de resumo de análise de solo exportado!");
  };

  const handleDownloadClientsPDF = () => {
    if (clients.length === 0) {
      toast.error("Nenhum produtor rural cadastrado para exportar.");
      return;
    }
    const doc = new jsPDF();
    
    // Header banner
    doc.setFillColor(16, 185, 129); // emerald 500
    doc.rect(0, 0, 210, 35, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(20);
    doc.setFont("Helvetica", "bold");
    doc.text(getPdfBranding().companyName, 15, 15);
    doc.setFontSize(10);
    doc.setFont("Helvetica", "normal");
    doc.text(`Relatório Geral de Produtores e Cadastros Agrícolas (${clients.length} cadastrados)`, 15, 27);

    let totalArea = 0;
    const rows = clients.map(c => {
      const clientArea = c.properties?.reduce((sum, p) => sum + (p.areaHectares || 0), 0) || 0;
      totalArea += clientArea;
      
      const propertiesList = c.properties?.map(p => `${p.name} (${p.areaHectares || 0} ha)`).join(', ') || 'Nenhuma fazenda';

      return [
        c.name || 'N/D',
        c.email || 'Não informado',
        c.phone || 'Não informado',
        `${c.properties?.length || 0} fazenda(s)`,
        `${clientArea.toLocaleString('pt-BR')} ha`,
        propertiesList
      ];
    });

    autoTable(doc, {
      startY: 45,
      head: [['Nome do Produtor', 'E-mail', 'Telefone', 'Propriedades', 'Área Total', 'Fazendas & Áreas']],
      body: rows,
      headStyles: { fillColor: [16, 185, 129] },
      styles: { fontSize: 8 }
    });

    const finalY = (doc as any).lastAutoTable.finalY || 50;
    doc.setFontSize(10);
    doc.setFont("Helvetica", "bold");
    doc.setTextColor(30, 41, 59);
    doc.text("Indicadores de Cobertura Agrícola:", 15, finalY + 12);
    
    doc.setFontSize(9);
    doc.setFont("Helvetica", "normal");
    doc.setTextColor(71, 85, 105);
    doc.text(`• Total de Produtores sob Gestão: ${clients.length}`, 15, finalY + 20);
    doc.text(`• Área Total Administrada: ${totalArea.toLocaleString('pt-BR')} Hectares (ha)`, 15, finalY + 26);
    doc.text(`• Média de Área por Produtor: ${(totalArea / clients.length).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} Hectares`, 15, finalY + 32);

    doc.save("Cadastro_Clientes_AgroGestao.pdf");
    toast.success("PDF de dados de clientes exportado!");
  };

  const handleDownloadFinancialMetricsPDF = () => {
    if (financials.length === 0) {
      toast.error("Nenhum lançamento financeiro para processar métricas.");
      return;
    }
    const doc = new jsPDF();
    
    // Header banner
    doc.setFillColor(16, 185, 129); // emerald 500
    doc.rect(0, 0, 210, 35, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(20);
    doc.setFont("Helvetica", "bold");
    doc.text(getPdfBranding().companyName, 15, 15);
    doc.setFontSize(10);
    doc.setFont("Helvetica", "normal");
    doc.text(`Relatório Executivo de Métricas Financeiras e Fluxo de Caixa`, 15, 27);

    // Calculate metrics
    let totalValue = 0;
    let paidValue = 0;
    let pendingValue = 0;
    let overdueValue = 0;
    
    let paidCount = 0;
    let pendingCount = 0;
    let overdueCount = 0;

    const categoryStats: Record<string, { count: number; total: number }> = {};
    const methodStats: Record<string, { count: number; total: number }> = {};

    financials.forEach(f => {
      totalValue += f.value;
      if (f.status === 'paid') {
        paidValue += f.value;
        paidCount++;
      } else if (f.status === 'pending') {
        pendingValue += f.value;
        pendingCount++;
      } else if (f.status === 'overdue') {
        overdueValue += f.value;
        overdueCount++;
      }

      // Category breakdown
      const cat = f.category || 'Outro';
      if (!categoryStats[cat]) categoryStats[cat] = { count: 0, total: 0 };
      categoryStats[cat].count++;
      categoryStats[cat].total += f.value;

      // Method breakdown
      const meth = f.paymentMethod || 'Não informado';
      if (!methodStats[meth]) methodStats[meth] = { count: 0, total: 0 };
      methodStats[meth].count++;
      methodStats[meth].total += f.value;
    });

    // Write text metrics at start
    doc.setFontSize(12);
    doc.setFont("Helvetica", "bold");
    doc.setTextColor(30, 41, 59);
    doc.text("1. Resumo Consolidado de Saldos e Status", 15, 48);

    doc.setFontSize(9.5);
    doc.setFont("Helvetica", "normal");
    doc.setTextColor(71, 85, 105);
    
    doc.text(`• Valor Total Registrado: R$ ${totalValue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} (dos quais ${financials.length} lançamentos)`, 15, 55);
    doc.text(`• Saldo Recebido (Liquidado): R$ ${paidValue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} (${paidCount} lançamentos)`, 15, 61);
    doc.text(`• Saldo a Receber (Pendente): R$ ${pendingValue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} (${pendingCount} lançamentos)`, 15, 67);
    doc.text(`• Saldo Inadimplente (Atrasado): R$ ${overdueValue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} (${overdueCount} lançamentos)`, 15, 73);

    // Let's create a beautiful breakdown table for Category Breakdown
    const catRows = Object.entries(categoryStats).map(([catName, stats]) => {
      const translateCategory: Record<string, string> = {
        analysis: 'Análise de Solo/Água',
        irrigation: 'Projetos de Irrigação',
        topography: 'Levantamentos Topográficos',
        credit: 'Projetos de Crédito Rural',
        regularization: 'Regularização Ambiental',
        field_visit: 'Visitas Técnicas de Campo',
        contract: 'Contratos Globais',
        other: 'Outras Operações'
      };
      return [
        translateCategory[catName] || catName,
        `${stats.count} lançamentos`,
        `R$ ${stats.total.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`,
        `${((stats.total / totalValue) * 100).toFixed(1)}%`
      ];
    });

    doc.setFontSize(12);
    doc.setFont("Helvetica", "bold");
    doc.setTextColor(30, 41, 59);
    doc.text("2. Distribuição de Receitas por Categoria de Serviço", 15, 84);

    autoTable(doc, {
      startY: 89,
      head: [['Categoria de Serviço', 'Volume de Lançamentos', 'Soma Praticada (R$)', 'Proporção']],
      body: catRows,
      headStyles: { fillColor: [16, 185, 129] },
      styles: { fontSize: 8.5 }
    });

    // Let's create a list or table for Payment Methods below
    const finalY1 = (doc as any).lastAutoTable.finalY || 140;

    const methRows = Object.entries(methodStats).map(([methName, stats]) => {
      const translateMethod: Record<string, string> = {
        pix: 'PIX (Instantâneo)',
        boleto: 'Boleto Bancário',
        transferencia: 'Transferência / TED / DOC',
        dinheiro: 'Dinheiro Espécie',
        cheque: 'Cheque Emitido'
      };
      return [
        translateMethod[methName] || methName.toUpperCase(),
        `${stats.count} lançamentos`,
        `R$ ${stats.total.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`,
        `${((stats.total / totalValue) * 100).toFixed(1)}%`
      ];
    });

    doc.setFontSize(12);
    doc.setFont("Helvetica", "bold");
    doc.setTextColor(30, 41, 59);
    doc.text("3. Distribuição de Receitas por Meio de Pagamento", 15, finalY1 + 12);

    autoTable(doc, {
      startY: finalY1 + 17,
      head: [['Meio de Pagamento', 'Volume de Lançamentos', 'Soma Praticada (R$)', 'Proporção']],
      body: methRows,
      headStyles: { fillColor: [51, 65, 85] },
      styles: { fontSize: 8.5 }
    });

    doc.save("Metricas_Financeiras_AgroGestao.pdf");
    toast.success("PDF de métricas financeiras exportado!");
  };

  const handleDownloadClientsExcel = () => {
    if (clients.length === 0) {
      toast.error("Nenhum produtor rural cadastrado para exportar.");
      return;
    }

    const data = clients.map(c => {
      const clientArea = c.properties?.reduce((sum, p) => sum + (p.areaHectares || 0), 0) || 0;
      const propertiesList = c.properties?.map(p => `${p.name} (${p.areaHectares || 0} ha)`).join(', ') || 'Nenhuma fazenda';

      return {
        'Nome do Produtor': c.name || 'N/D',
        'CPF/CNPJ': c.cpf || 'Não informado',
        'E-mail': c.email || c.ownerEmail || 'Não informado',
        'Telefone': c.phone || 'Não informado',
        'Tipo de Produtor': c.clientType === 'pronaf' ? 'PRONAF' : 'Produtor Rural Geral',
        'Qtd de Propriedades': c.properties?.length || 0,
        'Área Total (Hectares)': clientArea,
        'Lista de Propriedades': propertiesList,
        'Cidade': c.address?.city || 'Não informada',
        'Estado': c.address?.state || 'Não informado',
        'Data de Cadastro': c.createdAt ? formatDate(c.createdAt) : 'N/D'
      };
    });

    exportToExcel(data, "Cadastro_Produtores_AgroGestao", "Produtores");
    toast.success("Dados de clientes exportados em formato XLSX com sucesso!");
  };

  const handleDownloadFinancialMetricsExcel = () => {
    if (financials.length === 0) {
      toast.error("Nenhum lançamento financeiro para exportar.");
      return;
    }

    const translateCategory: Record<string, string> = {
      analysis: 'Análise de Solo/Água',
      irrigation: 'Projetos de Irrigação',
      topography: 'Levantamentos Topográficos',
      credit: 'Projetos de Crédito Rural',
      regularization: 'Regularização Ambiental',
      field_visit: 'Visitas Técnicas de Campo',
      contract: 'Contratos Globais',
      other: 'Outras Operações'
    };

    const translateMethod: Record<string, string> = {
      pix: 'PIX (Instantâneo)',
      boleto: 'Boleto Bancário',
      transferencia: 'Transferência / TED / DOC',
      dinheiro: 'Dinheiro Espécie',
      cheque: 'Cheque Emitido'
    };

    const translateStatus: Record<string, string> = {
      paid: 'Liquidado / Pago',
      pending: 'Aberto / Pendente',
      overdue: 'Inadimplente / Atrasado'
    };

    const data = financials.map(f => ({
      'ID Lançamento': f.id,
      'Cliente': f.clientName || 'N/D',
      'Descrição': f.description || '',
      'Categoria': translateCategory[f.category] || f.category || 'Outro',
      'Valor (R$)': f.value || 0,
      'Status': translateStatus[f.status] || f.status,
      'Data de Vencimento': f.dueDate ? formatDate(f.dueDate) : 'N/D',
      'Data de Pagamento': f.paymentDate ? formatDate(f.paymentDate) : 'Pendente',
      'Meio de Pagamento': translateMethod[f.paymentMethod || ''] || f.paymentMethod || 'Não informado',
      'Competência (A-M)': f.competencia || '',
      'NFSe (Número)': f.nfse || '',
      'Observações': f.notes || '',
      'Criado Em': f.createdAt ? formatDate(f.createdAt) : ''
    }));

    exportToExcel(data, "Controle_Financeiro_Integrado_AgroGestao", "Lançamentos");
    toast.success("Relatório financeiro exportado em formato XLSX para contabilidade externa!");
  };

  // Section 2: Relatório Executivo Anual por Produtor (Rigorously 3+ pages)
  const handleGenerateAnnualExecutiveReport = async () => {
    if (!selectedClientId) {
      toast.error("Por favor, selecione um Cliente / Produtor.");
      return;
    }
    const client = clients.find(c => c.id === selectedClientId);
    if (!client) return;

    setGeneratingExecutive(true);
    try {
      // Collect specific records of selected client
      const clientVisits = visits.filter(v => v.clientId === selectedClientId);
      const clientFinances = financials.filter(f => f.clientId === selectedClientId);
      const clientAnalyses = analyses.filter(a => a.clientId === selectedClientId);
      const clientContracts = contracts.filter(c => c.clientId === selectedClientId);

      const doc = new jsPDF();
      
      // PAGE 1 — COVER & EXECUTIVE DESCRIPTION
      doc.setFillColor(31, 41, 55); // Dark Slate background
      doc.rect(0, 0, 210, 297, 'F');

      // Decorative top lines
      doc.setFillColor(16, 185, 129); // Emerald accent
      doc.rect(0, 0, 210, 15, 'F');

      // Header Brand
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(28);
      doc.setFont("Helvetica", "bold");
      doc.text(getPdfBranding().companyName.toUpperCase(), 20, 50);
      
      doc.setFontSize(11);
      doc.setFont("Helvetica", "normal");
      doc.text("GESTÃO AGRONÔMICA CORPORATIVA", 20, 58);

      // Report Main Title
      doc.setFontSize(24);
      doc.setFont("Helvetica", "bold");
      doc.setTextColor(16, 185, 129);
      doc.text("RELATÓRIO ANUAL", 20, 100);
      doc.text("EXECUTIVO", 20, 112);
      
      doc.setFontSize(14);
      doc.setTextColor(226, 232, 240);
      doc.text("Exercício Fiscal e Operacional", 20, 124);

      // Qualified Client Box
      doc.setFillColor(55, 65, 81);
      doc.rect(20, 140, 170, 55, 'F');
      doc.setDrawColor(75, 85, 99);
      doc.rect(20, 140, 170, 55, 'D');

      doc.setTextColor(255, 255, 255);
      doc.setFontSize(10);
      doc.setFont("Helvetica", "bold");
      doc.text("QUALIFICAÇÃO DO PRODUTOR RURAL", 26, 150);
      
      doc.setFont("Helvetica", "normal");
      doc.text(`Nome Produtor: ${client.name}`, 26, 160);
      doc.text(`Email do Cliente: ${client.email || 'Não cadastrado'}`, 26, 166);
      doc.text(`Total de Propriedades sob Gestão: ${client.properties?.length || 0} fazenda(s)`, 26, 172);
      doc.text(`Área Consolidada Total: ${client.properties?.reduce((sum, p) => sum + (p.areaHectares || 0), 0) || 0} Hectares`, 26, 178);

      // Summary text at bottom of Page 1
      doc.setFontSize(8);
      doc.setTextColor(156, 163, 175);
      doc.text("Este material consolida todas as vistorias físicas, análises físico-químicas de solo,", 20, 240);
      doc.text("balanço fiscal de faturamento, monitoramento de pragas e termos contratuais sob responsabilidade", 20, 246);
      doc.text(`do time de consultores seniores da ${getPdfBranding().companyName}.`, 20, 252);

      // PAGE 2 — OPERATIONAL INSPECTIONS & CROP TRACKING
      doc.addPage();
      doc.setFillColor(248, 250, 252); // soft off-white
      doc.rect(0, 0, 210, 297, 'F');

      doc.setFillColor(15, 23, 42); // slate 900
      doc.rect(0, 0, 210, 30, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(16);
      doc.setFont("Helvetica", "bold");
      doc.text(`Anuário Agro operacional — ${client.name}`, 15, 13);
      doc.setFontSize(9);
      doc.setFont("Helvetica", "normal");
      doc.text("Histórico Analítico de Visitas de Campo e Monitoramento de Solo (Pág 2)", 15, 22);

      // Field Visits Section Title
      doc.setTextColor(30, 41, 59);
      doc.setFontSize(12);
      doc.setFont("Helvetica", "bold");
      doc.text("1. INSPEÇÕES RURAIS E MONITORAMENTOS DE SAFRA", 15, 45);

      const visitsRows = clientVisits.map(v => [
        formatDate(v.visitDate),
        v.propertyName,
        v.technicianName,
        (v.crops || []).map(c => `${c.name} (${c.stage})`).join(', ') || 'Sem Grãos',
        v.objective
      ]);

      autoTable(doc, {
        startY: 50,
        head: [['Data Visita', 'Fazenda Inspeção', 'Responsável Técnico', 'Estágio Fenológico Safra', 'Parecer Objetivo']],
        body: visitsRows.length > 0 ? visitsRows : [['Sem visitas', 'Sem dados', '-', '-', '-']],
        headStyles: { fillColor: [30, 41, 59] },
        styles: { fontSize: 8 }
      });

      // Analyses Section Title
      const lastY1 = (doc as any).lastAutoTable.finalY + 15;
      doc.setFontSize(12);
      doc.setFont("Helvetica", "bold");
      doc.text("2. LAUDOS FÍSICO-QUÍMICOS E PROJETOS DE PRECISÃO", 15, lastY1);

      const analysesRows = clientAnalyses.map(a => [
        a.createdAt ? formatDate(a.createdAt) : '-',
        a.propertyName || '-',
        (a.type || '').toUpperCase(),
        (a.status || '').toUpperCase(),
        a.responsibleTechnician || '-'
      ]);

      autoTable(doc, {
        startY: lastY1 + 5,
        head: [['Data Solicitada', 'Propriedade', 'Tipo de Relatório', 'Status Atual', 'Responsável Técnico']],
        body: analysesRows.length > 0 ? analysesRows : [['Sem análises', '-', '-', '-', '-']],
        headStyles: { fillColor: [51, 65, 85] },
        styles: { fontSize: 8 }
      });

      // PAGE 3 — CONTROLLER ACCOUNT & CONTRACT LEGAL AGREEMENTS
      doc.addPage();
      doc.setFillColor(248, 250, 252);
      doc.rect(0, 0, 210, 297, 'F');

      doc.setFillColor(15, 23, 42); 
      doc.rect(0, 0, 210, 30, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(16);
      doc.setFont("Helvetica", "bold");
      doc.text(`Anuário Contratual & Fiscal — ${client.name}`, 15, 13);
      doc.setFontSize(9);
      doc.setFont("Helvetica", "normal");
      doc.text("Cronograma de Faturamento, Histórico de Receitas e Termos Jurídicos (Pág 3)", 15, 22);

      // Finances Section
      doc.setTextColor(30, 41, 59);
      doc.setFontSize(12);
      doc.setFont("Helvetica", "bold");
      doc.text("3. BALANÇO FINANCEIRO E FATURAMENTOS DE PRESTAÇÃO", 15, 45);

      const financesRows = clientFinances.map(f => [
        formatDate(f.dueDate),
        f.description,
        (f.category || '').toUpperCase(),
        (f.paymentMethod || '').toUpperCase(),
        (f.status || '').toUpperCase(),
        `${formatCurrency(f.value)}`
      ]);

      const totalInvoiced = clientFinances.reduce((sum, f) => sum + f.value, 0);

      autoTable(doc, {
        startY: 50,
        head: [['Data Vcto.', 'Descrição Lançamento', 'Categoria', 'Forma', 'Status', 'Valor Praticado']],
        body: financesRows.length > 0 ? financesRows : [['Sem finanças', '-', '-', '-', '-', '-']],
        headStyles: { fillColor: [30, 41, 59] },
        styles: { fontSize: 8 }
      });

      const lastFinanceY = (doc as any).lastAutoTable.finalY;
      doc.setFontSize(9.5);
      doc.setFont("Helvetica", "bold");
      doc.text(`Consolidado Faturamento Anual: R$ ${totalInvoiced.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`, 15, lastFinanceY + 7);

      // Contracts Section
      const lastY2 = lastFinanceY + 15;
      doc.setFontSize(12);
      doc.setFont("Helvetica", "bold");
      doc.text("4. INSTRUMENTOS CONTRATUAIS SOB VIGÊNCIA", 15, lastY2);

      const contractsRows = clientContracts.map(c => [
        c.contractNumber,
        c.category,
        `${formatDate(c.startDate)} a ${formatDate(c.endDate)}`,
        `${c.installmentsCount} Parcelas`,
        (c.status || '').toUpperCase(),
        `${formatCurrency(c.totalValue)}`
      ]);

      autoTable(doc, {
        startY: lastY2 + 5,
        head: [['Código CTR', 'Objeto de Prestação', 'Vigência Acordada', 'Parcelamento', 'Status do Instrumento', 'Valor Global']],
        body: contractsRows.length > 0 ? contractsRows : [['Sem termos vigentes', '-', '-', '-', '-', '-']],
        headStyles: { fillColor: [51, 65, 85] },
        styles: { fontSize: 8 }
      });

      // Signature & Validation at bottom of Page 3
      const lastSignatureY = (doc as any).lastAutoTable.finalY + 25;
      doc.setDrawColor(148, 163, 184);
      doc.line(30, lastSignatureY, 90, lastSignatureY);
      doc.line(120, lastSignatureY, 180, lastSignatureY);

      doc.setFontSize(7.5);
      doc.setFont("Helvetica", "normal");
      doc.text(`${getPdfBranding().companyName} — Diretoria Técnica`, 43, lastSignatureY + 5);
      doc.text("Assinatura do Produtor Contratante", 133, lastSignatureY + 5);

      // Save Report PDF
      doc.save(`Anuario_Executivo_AgroGestao_${client.name.replace(/\s+/g, '_')}.pdf`);
      toast.success(`Relatório executivo anual gerado! Pág: 3`);
    } catch (e: any) {
      console.error(e);
      toast.error("Ocorreu um erro no compilador de PDF.");
    } finally {
      setGeneratingExecutive(false);
    }
  };

  // Section 3: Smart AI Companion - Chat with Gemini
  const handleSendChatQuery = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!chatQuery.trim()) return;

    const userText = chatQuery;
    setChatMessages(prev => [...prev, { sender: 'user', text: userText, timestamp: new Date() }]);
    setChatQuery('');
    setLoadingChat(true);

    try {
      // 1. Compile all analytical statistics as prompt context representer
      const consolidatedContext = `
* ESTATÍSTICA GERAL DO AGROGESTÃO PRO *:
- Total de Clientes Cadastrados: ${clients.length} produtor(es).
- Total de Visitas de Campo Registradas: ${visits.length} vistorias físicas.
- Total de Projetos Contratuais Ativos: ${contracts.length} acordos jurídicos.
- Total de Faturamento Consolidado em Caixa: ${formatCurrency(financials.reduce((sum, f) => sum + f.value, 0))}.
- Lista de Grãos/Culturas sob Monitoramento: ${Array.from(new Set(visits.flatMap(v => (v.crops || []).map(c => c.name)))).join(', ') || 'Nenhum'}.

* ÚLTIMAS VISITAS REALIZADAS *:
${visits.slice(0, 3).map(v => `- Data: ${v.visitDate}, Cliente: ${v.clientName}, Local: ${v.propertyName}, Objetivo: ${v.objective}. Recomendações: ${v.recommendations || 'Simples vistoria'}`).join('\n')}

* ANÁLISES TÉCNICAS RECENTES *:
${analyses.slice(0, 3).map(a => `- Tipo: ${a.type}, Fazenda: ${a.propertyName || 'Terras'}, Status do Laudo: ${a.status}`).join('\n')}
      `;

      // 2. Fetch from secure server-side endpoint `/api/ai/reports-chat` with auth token
      let token = '';
      const currentUser = auth.currentUser;
      if (currentUser) {
        token = await currentUser.getIdToken();
      } else {
        const cachedSession = localStorage.getItem('virtual_user_session');
        if (cachedSession) {
          const parsed = JSON.parse(cachedSession);
          token = '';
        }
      }
      const response = await fetch('/api/ai/reports-chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          query: userText,
          contextString: consolidatedContext
        })
      });

      if (!response.ok) {
        throw new Error('Falha no processador de IA do servidor.');
      }

      const resData = await response.json();
      setChatMessages(prev => [...prev, { sender: 'ai', text: resData.text, timestamp: new Date() }]);
    } catch (err: any) {
      console.error(err);
      setChatMessages(prev => [...prev, { 
        sender: 'ai', 
        text: 'Desculpe, meu motor de processamento teve um erro temporário de comunicação fiscal de rede. Favor conferir a chave GEMINI_API_KEY.', 
        timestamp: new Date() 
      }]);
    } finally {
      setLoadingChat(false);
    }
  };

  // Safe manual markdown parser for UI rendering without libraries
  const parseResponseMarkdown = (text: string) => {
    return text.split('\n').map((line, idx) => {
      // Check for bullet list
      if (line.trim().startsWith('- ') || line.trim().startsWith('* ')) {
        return (
          <li key={idx} className="ml-4 list-disc pl-1 mb-1 text-slate-700">
            {line.trim().substring(2)}
          </li>
        );
      }
      // Check for strong bold tags
      const boldRegex = /\*\*(.*?)\*\*/g;
      if (boldRegex.test(line)) {
        // SEGURANÇA: antes usava dangerouslySetInnerHTML — se a resposta da IA trouxesse
        // HTML (ex.: nome de cliente com <img onerror=...>), o código rodava na tela.
        // Agora só o **negrito** vira <strong>; o resto é sempre texto.
        return (
          <p key={idx} className="mb-2 text-slate-700 leading-relaxed">
            {line.split(/\*\*(.*?)\*\*/g).map((part, i) => (i % 2 === 1 ? <strong key={i}>{part}</strong> : part))}
          </p>
        );
      }
      // General paragraph
      return <p key={idx} className="mb-2 text-slate-700 leading-relaxed text-xs">{line}</p>;
    });
  };

  return (
    <div className="space-y-6">
      
      {/* Banner Title with Tabs */}
      <div className={PAGE_HEADER_CLASS} data-page-header>
        <PageTitle icon={PageIcon} title="Relatórios" subtitle="Relatórios consolidados, eficiência da equipe e assistente de IA" />

        {/* Tab Switcher */}
        <div className="flex items-center gap-2 bg-slate-100 p-1.5 rounded-xl self-start md:self-auto">
          <button
            onClick={() => setActiveReportTab('downloads')}
            className={`px-4 py-2 rounded-lg text-xs font-bold transition-all flex items-center gap-2 cursor-pointer ${
              activeReportTab === 'downloads'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <FileText className="w-4 h-4 text-emerald-600" /> Relatórios & Central
          </button>
          <button
            onClick={() => setActiveReportTab('efficiency')}
            className={`px-4 py-2 rounded-lg text-xs font-bold transition-all flex items-center gap-2 cursor-pointer ${
              activeReportTab === 'efficiency'
                ? 'bg-slate-900 text-white shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <TrendingUp className="w-4 h-4 text-emerald-400" /> Relatório de Eficiência
          </button>
        </div>
      </div>

      {activeReportTab === 'efficiency' ? (
        <EfficiencyReport analyses={analyses} clients={clients} />
      ) : (
      /* Main Grid: Left column (Reports center) / Right column (Chatbot Gemini) */
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        
        {/* Reports Panel Downloader Section */}
        <div className="lg:col-span-6 space-y-6">
          
          {/* Section 1: Consolidation Excel / PDF */}
          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
            <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-2">
              <Download className="w-4 h-4 text-emerald-600" /> 1. Downloads de Relatórios Consolidados
            </h3>
            
            <div className="space-y-3.5">
              {/* Card 1 */}
              <div className="p-4 border border-slate-200 rounded-2xl flex items-center justify-between hover:bg-slate-50 transition-colors">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-emerald-50 text-emerald-600 rounded-lg flex items-center justify-center">
                    <FileText className="w-5 h-5" />
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-slate-800">Laudos Gerais de Visitas Técnicas</h4>
                    <p className="text-[10px] text-slate-400">Sumarização em PDF de todas as agendas físicas safra</p>
                  </div>
                </div>
                <button
                  onClick={handleDownloadVisitsConsolidated}
                  className="p-2 border border-slate-200 rounded-xl hover:bg-white text-emerald-600 transition-shadow block"
                >
                  <Download className="w-4 h-4" />
                </button>
              </div>

              {/* Card 2 */}
              <div className="p-4 border border-slate-200 rounded-2xl flex items-center justify-between hover:bg-slate-50 transition-colors">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-emerald-50 text-emerald-600 rounded-lg flex items-center justify-center">
                    <FileSpreadsheet className="w-5 h-5" />
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-slate-800">Fluxo de Caixa e Balanços LCDPR</h4>
                    <p className="text-[10px] text-slate-400">Exportação de fluxo financeiro em Planilha ou PDF</p>
                  </div>
                </div>
                <div className="flex gap-1.5">
                  <button
                    onClick={handleDownloadFinancialConsolidated}
                    className="p-2 border border-slate-200 rounded-xl hover:bg-white text-emerald-600 transition-shadow block cursor-pointer"
                    title="Exportar Planilha Excel"
                  >
                    <Download className="w-4 h-4" />
                  </button>
                  <button
                    onClick={handleDownloadFinancialPDF}
                    className="p-2 border border-slate-200 rounded-xl hover:bg-white text-emerald-600 transition-shadow block cursor-pointer"
                    title="Exportar PDF"
                  >
                    <FileText className="w-4 h-4 text-emerald-600" />
                  </button>
                </div>
              </div>

              {/* Card 3 */}
              <div className="p-4 border border-slate-200 rounded-2xl flex items-center justify-between hover:bg-slate-50 transition-colors">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-emerald-50 text-emerald-600 rounded-lg flex items-center justify-center">
                    <Layers className="w-5 h-5" />
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-slate-800">Monitoramento Solo e Laudos Projetos</h4>
                    <p className="text-[10px] text-slate-400">PDF agrupado das análises físicas em processamento</p>
                  </div>
                </div>
                <button
                  onClick={handleDownloadAnalysesConsolidated}
                  className="p-2 border border-slate-200 rounded-xl hover:bg-white text-emerald-600 transition-shadow block"
                >
                  <Download className="w-4 h-4" />
                </button>
              </div>

              {/* Card 4 */}
              <div className="p-4 border border-slate-200 rounded-2xl flex items-center justify-between hover:bg-slate-50 transition-colors">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-emerald-50 text-emerald-600 rounded-lg flex items-center justify-center">
                    <Sprout className="w-5 h-5" />
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-slate-800">Relatório de Safra e Culturas</h4>
                    <p className="text-[10px] text-slate-400">PDF consolidado de grãos, estágios e sanidade fitossanitária</p>
                  </div>
                </div>
                <button
                  onClick={handleDownloadCropsConsolidated}
                  className="p-2 border border-slate-200 rounded-xl hover:bg-white text-emerald-600 transition-shadow block"
                  title="Exportar PDF de Safra"
                >
                  <Download className="w-4 h-4" />
                </button>
              </div>

              {/* Card 5: Resumo de Análise de Solo */}
              <div className="p-4 border border-slate-200 rounded-2xl flex items-center justify-between hover:bg-slate-50 transition-colors">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-emerald-50 text-emerald-600 rounded-lg flex items-center justify-center">
                    <ClipboardCheck className="w-5 h-5" />
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-slate-800">Resumo de Análise de Solo</h4>
                    <p className="text-[10px] text-slate-400">PDF consolidado de nutrientes, pH e médias químicas do solo</p>
                  </div>
                </div>
                <button
                  onClick={handleDownloadSoilAnalysesPDF}
                  className="p-2 border border-slate-200 rounded-xl hover:bg-white text-emerald-600 transition-shadow block cursor-pointer"
                  title="Exportar PDF de Análise de Solo"
                >
                  <Download className="w-4 h-4" />
                </button>
              </div>

              {/* Card 6: Dados de Clientes / Produtores */}
              <div className="p-4 border border-slate-200 rounded-2xl flex items-center justify-between hover:bg-slate-50 transition-colors">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-emerald-50 text-emerald-600 rounded-lg flex items-center justify-center">
                    <Users className="w-5 h-5" />
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-slate-800">Dados de Clientes e Produtores</h4>
                    <p className="text-[10px] text-slate-400">PDF com listagem de produtores ou planilha Excel (XLSX)</p>
                  </div>
                </div>
                <div className="flex gap-1.5">
                  <button
                    onClick={handleDownloadClientsPDF}
                    className="p-2 border border-slate-200 rounded-xl hover:bg-white text-emerald-600 transition-shadow block cursor-pointer"
                    title="Exportar PDF de Clientes"
                  >
                    <Download className="w-4 h-4" />
                  </button>
                  <button
                    onClick={handleDownloadClientsExcel}
                    className="p-2 border border-slate-200 rounded-xl hover:bg-white text-slate-600 hover:border-slate-200 transition-shadow block cursor-pointer"
                    title="Exportar Planilha Excel (XLSX) de Clientes"
                  >
                    <FileSpreadsheet className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Card 7: Métricas Financeiras & Balanço */}
              <div className="p-4 border border-slate-200 rounded-2xl flex items-center justify-between hover:bg-slate-50 transition-colors">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-emerald-50 text-emerald-600 rounded-lg flex items-center justify-center">
                    <TrendingUp className="w-5 h-5" />
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-slate-800">Métricas Financeiras e Fluxo de Caixa</h4>
                    <p className="text-[10px] text-slate-400">PDF executivo ou planilha Excel (XLSX) para contabilidade externa</p>
                  </div>
                </div>
                <div className="flex gap-1.5">
                  <button
                    onClick={handleDownloadFinancialMetricsPDF}
                    className="p-2 border border-slate-200 rounded-xl hover:bg-white text-emerald-600 transition-shadow block cursor-pointer"
                    title="Exportar PDF de Métricas Financeiras"
                  >
                    <Download className="w-4 h-4" />
                  </button>
                  <button
                    onClick={handleDownloadFinancialMetricsExcel}
                    className="p-2 border border-slate-200 rounded-xl hover:bg-white text-slate-600 hover:border-slate-200 transition-shadow block cursor-pointer"
                    title="Exportar Planilha Excel (XLSX) de Finanças"
                  >
                    <FileSpreadsheet className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Section 2: Relatório Executivo Anual por Produtor (Rigorously 3+ pages) */}
          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
            <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-2">
              <Award className="w-4 h-4 text-emerald-600" /> 2. Relatório Executivo Anual (3 Páginas Completas)
            </h3>
            
            <p className="text-xs text-slate-400 leading-relaxed">
              Compile em tempo real todas as atividades do produtor (faturamentos vinculados, históricos de fotos analíticas, pragas controladas e laudos de solo) em um documento executivo formatado no padrão agronômico nacional.
            </p>

            <div className="space-y-3.5 pt-2">
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-slate-400 uppercase">Selecione o Produtor Rural Cliente</label>
                <select
                  value={selectedClientId}
                  onChange={(e) => setSelectedClientId(e.target.value)}
                  className="w-full glass-input text-xs"
                >
                  <option value="">Selecione o Cliente</option>
                  {clients.map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>

              <button
                onClick={() => runExclusive('Reports.handleGenerateAnnualExecutiveReport', () => handleGenerateAnnualExecutiveReport())}
                disabled={generatingExecutive || !selectedClientId}
                className="w-full flex items-center justify-center gap-2 px-5 py-3 text-xs bg-emerald-600 text-white hover:bg-emerald-700 transition-all rounded-xl font-bold uppercase tracking-wider shadow-md shadow-emerald-150 disabled:opacity-50"
              >
                {generatingExecutive ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" /> Gerando Dossiê...
                  </>
                ) : (
                  <>
                    <Bot className="w-4 h-4" /> Gerar Anuário Executivo de Produtor (PDF)
                  </>
                )}
              </button>
            </div>
          </div>

        </div>

        {/* Section 3: Smart AI Companion - Chat with Gemini */}
        <div className="lg:col-span-6 bg-white rounded-2xl border border-slate-200 shadow-sm flex flex-col h-[525px] overflow-hidden">
          
          {/* Header */}
          <div className="bg-slate-900 text-white p-4 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 bg-emerald-500 rounded-lg flex items-center justify-center text-slate-900 pl-0.5">
                <Bot className="w-5 h-5 text-slate-900" />
              </div>
              <div>
                <h4 className="text-sm font-bold font-display">AgroGestor AI</h4>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                  <span className="text-[9px] text-slate-450 uppercase tracking-widest font-bold">Assistente Conectado</span>
                </div>
              </div>
            </div>
            
            <Sparkles className="w-4 h-4 text-emerald-400" />
          </div>

          {/* Messages list */}
          <div className="flex-1 p-5 overflow-y-auto space-y-3.5 bg-slate-50/50" ref={scrollRef}>
            {chatMessages.map((msg, idx) => (
              <div 
                key={idx} 
                className={`flex gap-3 max-w-[85%] ${msg.sender === 'user' ? 'ml-auto flex-row-reverse' : 'mr-auto'}`}
              >
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-[10px] font-bold uppercase shrink-0 ${
                  msg.sender === 'user' ? 'bg-emerald-600 text-white' : 'bg-emerald-100 text-emerald-800'
                }`}>
                  {msg.sender === 'user' ? 'Eu' : 'AI'}
                </div>

                <div className={`p-3.5 rounded-2xl text-xs border ${
                  msg.sender === 'user' 
                    ? 'bg-emerald-600 text-white border-emerald-700 shadow-sm rounded-tr-none' 
                    : 'bg-white border-slate-200 text-slate-800 shadow-inner rounded-tl-none'
                }`}>
                  {msg.sender === 'user' ? (
                    <p className="leading-relaxed whitespace-pre-wrap">{msg.text}</p>
                  ) : (
                    <div className="space-y-1 select-text">
                      {parseResponseMarkdown(msg.text)}
                    </div>
                  )}
                </div>
              </div>
            ))}

            {loadingChat && (
              <div className="flex gap-3 mr-auto items-center animate-pulse">
                <div className="w-8 h-8 rounded-full bg-slate-200 flex items-center justify-center shrink-0">
                  <Loader2 className="w-4 h-4 animate-spin text-emerald-600" />
                </div>
                <div className="p-3 bg-white border border-slate-200 rounded-2xl rounded-tl-none text-xs text-slate-450">
                  Analisando fazendas, pragas e fluxos financeiros...
                </div>
              </div>
            )}
          </div>

          {/* Recommended chips questions */}
          <div className="px-4 py-2 border-t border-slate-150 flex gap-2 overflow-x-auto whitespace-nowrap scrollbar-none shrink-0 bg-slate-50/80">
            {[
              "Calibração de Pulverização (L/ha)?",
              "Como calcular Calagem (V%) e Gessagem?",
              "Manejo de Lagarta-do-Cartucho e Ferrugem?",
              "Resumo do Fluxo de Caixa e Inadimplência?",
              "Sintomas de deficiência de N, P e K?",
              "Quais normas da ABNT para avaliação rural?"
            ].map(chip => (
              <button
                type="button"
                key={chip}
                onClick={() => {
                  setChatQuery(chip);
                }}
                className="px-2.5 py-1 bg-white border border-slate-200 text-slate-600 rounded-lg text-[10px] font-bold uppercase hover:bg-emerald-50 hover:border-emerald-300 hover:text-emerald-700 transition-colors shrink-0 shadow-xs"
              >
                {chip}
              </button>
            ))}
          </div>

          {/* Input Sender footer */}
          <form 
            onSubmit={handleSendChatQuery} 
            className="p-3 bg-white border-t border-slate-150 flex gap-2 items-center shrink-0"
          >
            <input 
              type="text"
              value={chatQuery}
              onChange={(e) => setChatQuery(e.target.value)}
              placeholder="Pergunte ao AgroGestor AI sobre laudos, fazendas..."
              className="flex-1 glass-input text-xs"
              disabled={loadingChat}
            />
            <button
              type="submit"
              disabled={loadingChat || !chatQuery.trim()}
              className="p-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl transition-all disabled:opacity-40"
            >
              <Send className="w-4 h-4" />
            </button>
          </form>

        </div>

      </div>
      )}

    </div>
  );
}
