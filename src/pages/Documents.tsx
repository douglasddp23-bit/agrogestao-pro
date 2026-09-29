import React, { useState, useEffect, useRef } from 'react';
import { 
  FileText, 
  Search, 
  ShieldCheck, 
  Lock, 
  Users, 
  ChevronRight,
  ArrowLeft,
  Upload,
  Download,
  Trash2,
  Info,
  Loader2,
  Folder,
  FolderOpen,
  FileCheck,
  ArrowRight,
  Sparkles,
  FolderSync
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import PageHeader from '../components/layout/PageHeader';
import { FileText as PageIcon } from 'lucide-react';
import { toast } from 'sonner';
import { collection, onSnapshot, query, orderBy, where, addDoc, serverTimestamp, deleteDoc, doc } from 'firebase/firestore';
import { saveFile, deleteStoredFile, handleFileLinkClick, uploadErrorMessage, FileTooLargeError, isTooLargeToSave } from '../lib/fileStore';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { db, auth } from '../lib/firebase';
import { Client, ClientDocument } from '../types';
import { cn, formatDateTime, formatDate, sortByDateDesc } from '../lib/utils';
import { useDossierLiveSync } from '../lib/dossierSyncObserver';
import { useLocation } from 'react-router-dom';

import ConfirmationModal from '../components/ConfirmationModal';
import { getPdfBranding } from '../lib/pdfBranding';
import { useInitialSearch } from '../hooks/useInitialSearch';

export default function Documents() {
  const location = useLocation();
  const [searchTerm, setSearchTerm] = useState('');
  useInitialSearch(setSearchTerm); // termo vindo da Busca Global
  const [clients, setClients] = useState<Client[]>([]);
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [documents, setDocuments] = useState<ClientDocument[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState<any | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Dynamic Service-Folder states
  const [analyses, setAnalyses] = useState<any[]>([]);
  const [topographyServices, setTopographyServices] = useState<any[]>([]);
  const [regularizationServices, setRegularizationServices] = useState<any[]>([]);
  const [irrigationProjects, setIrrigationProjects] = useState<any[]>([]);
  const [contracts, setContracts] = useState<any[]>([]);
  const [fieldVisits, setFieldVisits] = useState<any[]>([]);
  const [judicialExpertises, setJudicialExpertises] = useState<any[]>([]);
  const [ruralValuations, setRuralValuations] = useState<any[]>([]);
  const [currentFolder, setCurrentFolder] = useState<any | null>(null);
  const [isGeneratingPDF, setIsGeneratingPDF] = useState(false);

  // Live Dossier Synchronization Observer hook
  const { getServiceSyncInfo, recentSyncEvent } = useDossierLiveSync(selectedClient?.id);

  // Auto-open specific folder when routed with state (e.g., from Perícia or Avaliação)
  useEffect(() => {
    if (location.state?.serviceId && !currentFolder && selectedClient) {
      const folders = getFoldersList();
      const target = folders.find(f => f.id === location.state.serviceId);
      if (target) {
        setCurrentFolder(target);
      }
    }
  }, [location.state, judicialExpertises, ruralValuations, contracts, analyses, selectedClient]);

  useEffect(() => {
    const q = query(collection(db, 'clients'), orderBy('name', 'asc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const clientList = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Client));
      setClients(clientList);

      // Handle navigation state or query param to auto-select client
      const stateClientId = location.state?.clientId || new URLSearchParams(window.location.search).get('clientId');
      if (stateClientId) {
        const targetClient = clientList.find(c => c.id === stateClientId);
        if (targetClient) {
          setSelectedClient(targetClient);
        }
      }
    }, (error) => {
      console.error("Error loading clients:", error);
    });
    return unsubscribe;
  }, [location.state]);

  useEffect(() => {
    if (!selectedClient) {
      setDocuments([]);
      setAnalyses([]);
      setTopographyServices([]);
      setRegularizationServices([]);
      setIrrigationProjects([]);
      setContracts([]);
      setFieldVisits([]);
      setJudicialExpertises([]);
      setRuralValuations([]);
      setCurrentFolder(null);
      return;
    }

    // 1. Subscribe to client documents
    // Sem orderBy: clientId + uploadedAt exigiria índice composto inexistente (a lista não carregava).
    const qDocs = query(
      collection(db, 'documents'),
      where('clientId', '==', selectedClient.id)
    );
    const unsubscribeDocs = onSnapshot(qDocs, (snapshot) => {
      setDocuments(sortByDateDesc(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as ClientDocument)), 'uploadedAt'));
    }, (error) => {
      console.error("Error loading documents:", error);
      toast.error('Não foi possível carregar os documentos deste cliente.');
    });

    // 2. Subscribe to client's technical analyses / service orders
    const qAnalyses = query(
      collection(db, 'analyses'),
      where('clientId', '==', selectedClient.id)
    );
    const unsubscribeAnalyses = onSnapshot(qAnalyses, (snapshot) => {
      setAnalyses(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    }, (error) => {
      console.error("Error loading analyses:", error);
    });

    // 3. Subscribe to topography services
    const qTopography = query(
      collection(db, 'topography_services'),
      where('clientId', '==', selectedClient.id)
    );
    const unsubscribeTopography = onSnapshot(qTopography, (snapshot) => {
      setTopographyServices(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    }, (error) => {
      console.error("Error loading topography services:", error);
    });

    // 4. Subscribe to environmental regularization services
    const qRegularization = query(
      collection(db, 'regularization_services'),
      where('clientId', '==', selectedClient.id)
    );
    const unsubscribeRegularization = onSnapshot(qRegularization, (snapshot) => {
      setRegularizationServices(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    }, (error) => {
      console.error("Error loading regularization services:", error);
    });

    // 5. Subscribe to irrigation projects
    const qIrrigation = query(
      collection(db, 'irrigation_projects'),
      where('clientId', '==', selectedClient.id)
    );
    const unsubscribeIrrigation = onSnapshot(qIrrigation, (snapshot) => {
      setIrrigationProjects(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    }, (error) => {
      console.error("Error loading irrigation projects:", error);
    });

    // 6. Subscribe to contracts
    const qContracts = query(
      collection(db, 'contracts'),
      where('clientId', '==', selectedClient.id)
    );
    const unsubscribeContracts = onSnapshot(qContracts, (snapshot) => {
      setContracts(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    }, (error) => {
      console.error("Error loading contracts:", error);
    });

    // 7. Subscribe to field visits
    const qFieldVisits = query(
      collection(db, 'field_visits')
    );
    const unsubscribeFieldVisits = onSnapshot(qFieldVisits, (snapshot) => {
      const allVisits = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as any));
      const clientVisits = allVisits.filter(v => 
        v.clientId === selectedClient.id || 
        (selectedClient.name && v.clientName?.toLowerCase().includes((selectedClient.name || '').toLowerCase()))
      );
      setFieldVisits(clientVisits);
    }, (error) => {
      console.error("Error loading field visits:", error);
    });

    // 8. Subscribe to judicial expertises
    const qJudicial = query(
      collection(db, 'judicial_expertises')
    );
    const unsubscribeJudicial = onSnapshot(qJudicial, (snapshot) => {
      const allExp = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as any));
      const clientExp = allExp.filter(exp => 
        exp.clientId === selectedClient.id || 
        (selectedClient.name && (
          exp.requerente?.toLowerCase().includes((selectedClient.name || '').toLowerCase()) || 
          exp.requerido?.toLowerCase().includes((selectedClient.name || '').toLowerCase())
        ))
      );
      setJudicialExpertises(clientExp);
    }, (error) => {
      console.error("Error loading judicial expertises:", error);
    });

    // 9. Subscribe to rural valuations
    const qValuations = query(
      collection(db, 'rural_valuations')
    );
    const unsubscribeValuations = onSnapshot(qValuations, (snapshot) => {
      const allVals = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as any));
      const clientVals = allVals.filter(val => 
        val.clientId === selectedClient.id || 
        (selectedClient.name && val.clientName?.toLowerCase().includes((selectedClient.name || '').toLowerCase()))
      );
      setRuralValuations(clientVals);
    }, (error) => {
      console.error("Error loading rural valuations:", error);
    });

    return () => {
      unsubscribeDocs();
      unsubscribeAnalyses();
      unsubscribeTopography();
      unsubscribeRegularization();
      unsubscribeIrrigation();
      unsubscribeContracts();
      unsubscribeFieldVisits();
      unsubscribeJudicial();
      unsubscribeValuations();
    };
  }, [selectedClient]);

  const filteredClients = searchTerm.trim() === '' ? [] : clients.filter(c => 
    (c.name || '').toLowerCase().includes(searchTerm.toLowerCase()) || 
    (c.cpf && c.cpf.includes(searchTerm))
  );

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !selectedClient) return;

    if (isTooLargeToSave(file)) {
      toast.error(uploadErrorMessage(new FileTooLargeError(file.name, file.size)));
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    setIsUploading(true);
    try {
      // Guardado no próprio Firestore (gratuito, até 2 MB) — ver lib/fileStore.ts
      const { url: downloadUrl, storagePath: filePath } = await saveFile(file, file.name, { clientId: selectedClient.id });

      const docPayload: any = {
        clientId: selectedClient.id,
        name: file.name,
        type: file.type,
        category: currentFolder && currentFolder.id !== 'general' 
          ? (currentFolder.type === 'contract' ? 'Contrato' : 'Serviço') 
          : 'Geral',
        url: downloadUrl,
        storagePath: filePath,
        size: file.size,
        uploadedBy: auth.currentUser?.displayName || 'Sistema',
        uploadedAt: serverTimestamp()
      };

      if (currentFolder && currentFolder.id !== 'general') {
        docPayload.serviceId = currentFolder.id;
        docPayload.serviceName = currentFolder.name;
      }
      
      await addDoc(collection(db, 'documents'), docPayload);
      toast.success('Arquivo arquivado na pasta com sucesso.');
    } catch (error) {
      console.error('Error uploading file:', error);
      toast.error(uploadErrorMessage(error));
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const generateServicePDF = (folder: any, shouldSaveToDb: boolean = false) => {
    if (!selectedClient) return;
    
    setIsGeneratingPDF(true);
    const toastId = shouldSaveToDb ? toast.loading('Compilando e guardando documento oficial no dossiê...') : null;
    
    try {
      const doc = new jsPDF();
      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();
      
      if (folder.type === 'contract') {
        const contract = folder.data || {};
        // Primary layout banner
        doc.setFillColor(15, 23, 42); // slate 900
        doc.rect(0, 0, pageWidth, 45, 'F');

        doc.setFillColor(16, 185, 129); // emerald accent
        doc.rect(0, 45, pageWidth, 3, 'F');

        doc.setTextColor(255, 255, 255);
        doc.setFontSize(22);
        doc.setFont('helvetica', 'bold');
        doc.text(getPdfBranding().companyName, 15, 20);
        doc.setFontSize(10);
        doc.setFont('helvetica', 'normal');
        doc.text('CONTRATO DE PRESTAÇÃO DE SERVIÇOS AGRONÔMICOS', 15, 32);
        doc.text(`CONTRATO N°: ${contract.contractNumber || 'S/N'}`, pageWidth - 80, 32);

        // Body Qualified Parts
        doc.setTextColor(30, 41, 59);
        doc.setFontSize(12);
        doc.setFont('helvetica', 'bold');
        doc.text('CLÁUSULA 1 — QUALIFICAÇÃO DAS PARTES', 15, 65);
        
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9.5);
        const qualText = `De um lado, o PRESTADOR: AgroGestão Pro Consultoria Agronômica Ltda, com endereço sede na Av. Floresta, 1200. De outro lado, o CONTRATANTE: Sr(a). ${selectedClient.name}, qualificado no banco de dados e registros adicionais desta plataforma rural com CPF/CNPJ: ${selectedClient.cpf || 'N/A'}.`;
        const splitQual = doc.splitTextToSize(qualText, pageWidth - 30);
        doc.text(splitQual, 15, 71);

        // Purpose / Category
        doc.setFontSize(12);
        doc.setFont('helvetica', 'bold');
        doc.text('CLÁUSULA 2 — OBJETO DE PRESTAÇÃO', 15, 95);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9.5);
        const objTitle = `Ref: ${contract.category || 'Prestação de Serviços Rurais'}`;
        doc.text(objTitle, 15, 101);
        
        let clauseText = 'O presente contrato regula os serviços profissionais agronômicos gerais especificados no cronograma.';
        if (typeof contract.clauses === 'string') {
          clauseText = contract.clauses;
        } else if (Array.isArray(contract.clauses) && contract.clauses.length > 0) {
          clauseText = contract.clauses[0];
        } else if (contract.description) {
          clauseText = contract.description;
        }
        const splitClause = doc.splitTextToSize(clauseText, pageWidth - 30);
        doc.text(splitClause, 15, 107);

        // Values & installments
        doc.setFontSize(12);
        doc.setFont('helvetica', 'bold');
        doc.text('CLÁUSULA 3 — VALOR CONTRATUAL E FATURAMENTO', 15, 132);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9.5);
        const valText = `O valor global estabelecido para a plena execução do serviço contratado é de R$ ${Number(contract.totalValue || contract.value || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}, dividido em ${contract.installmentsCount || 1} parcela(s) com datas fixadas de acordo com as especificações físicas.`;
        const splitVal = doc.splitTextToSize(valText, pageWidth - 30);
        doc.text(splitVal, 15, 138);

        // Payments Schedule Table
        const paymentsBody = (contract.installments || []).map((inst: any) => [
          `Parcela ${inst.installmentNumber || 1}`,
          formatDate(inst.dueDate),
          `R$ ${Number(inst.value || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`,
          inst.status === 'paid' ? 'Pago' : 'Pendente'
        ]);

        if (paymentsBody.length > 0) {
          autoTable(doc, {
            startY: 152,
            head: [['Número Parcela', 'Data Faturamento', 'Valor Parcela', 'Status de Cobrança']],
            body: paymentsBody,
            headStyles: { fillColor: [15, 23, 42] },
            styles: { fontSize: 8.5 }
          });
        }

        // Signatures block
        const lastY = paymentsBody.length > 0 ? (doc as any).lastAutoTable.finalY + 25 : 185;
        doc.setDrawColor(148, 163, 184);
        doc.line(30, lastY, 90, lastY);
        doc.line(120, lastY, 180, lastY);

        doc.setFontSize(8);
        doc.text(`Representante ${getPdfBranding().companyName}`, 40, lastY + 5);
        doc.text(selectedClient.name, 135, lastY + 5);
        doc.text('PRESTADOR', 52, lastY + 9);
        doc.text('CONTRATANTE', 145, lastY + 9);
      } else if (folder.type === 'judicial_expertise') {
        const exp = folder.data || {};
        // Top Banner for Judicial Expertise
        doc.setFillColor(15, 23, 42); // slate 900
        doc.rect(0, 0, pageWidth, 42, 'F');
        doc.setFillColor(217, 119, 6); // amber-600 accent
        doc.rect(0, 42, pageWidth, 3, 'F');

        doc.setTextColor(255, 255, 255);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(18);
        doc.text('LAUDO PERICIAL JUDICIAL AGRONÔMICO', 15, 18);
        doc.setFontSize(10);
        doc.setFont('helvetica', 'normal');
        doc.text(`PODER JUDICIÁRIO • ${exp.comarca || 'Comarca'} • ${exp.vara || 'Vara Cível'}`, 15, 28);
        doc.text(`PROCESSO N°: ${exp.processNumber || 'S/N'}`, 15, 36);

        // Section 1: Process identification
        doc.setTextColor(30, 41, 59);
        doc.setFontSize(11);
        doc.setFont('helvetica', 'bold');
        doc.text('1. IDENTIFICAÇÃO PROCESSUAL E DAS PARTES', 15, 56);
        doc.setDrawColor(226, 232, 240);
        doc.line(15, 59, pageWidth - 15, 59);

        doc.setFontSize(9);
        doc.setFont('helvetica', 'bold');
        doc.text('REQUERENTE (AUTOR):', 15, 68);
        doc.setFont('helvetica', 'normal');
        doc.text(exp.requerente || selectedClient.name, 65, 68);

        doc.setFont('helvetica', 'bold');
        doc.text('REQUERIDO (RÉU):', 15, 75);
        doc.setFont('helvetica', 'normal');
        doc.text(exp.requerido || 'Não especificado', 65, 75);

        doc.setFont('helvetica', 'bold');
        doc.text('MATÉRIA / TIPO DA PERÍCIA:', 15, 82);
        doc.setFont('helvetica', 'normal');
        doc.text((exp.expertiseType || 'Perícia Judicial').toUpperCase().replace(/_/g, ' '), 65, 82);

        // Section 2: Property
        doc.setFontSize(11);
        doc.setFont('helvetica', 'bold');
        doc.text('2. CARACTERIZAÇÃO DO IMÓVEL OBJETO DA PERÍCIA', 15, 96);
        doc.line(15, 99, pageWidth - 15, 99);

        doc.setFontSize(9);
        doc.setFont('helvetica', 'bold');
        doc.text('DENOMINAÇÃO DO IMÓVEL:', 15, 108);
        doc.setFont('helvetica', 'normal');
        doc.text(exp.propertyName || 'Fazenda Objeto', 65, 108);

        doc.setFont('helvetica', 'bold');
        doc.text('MUNICÍPIO / UF:', 15, 115);
        doc.setFont('helvetica', 'normal');
        doc.text(`${exp.propertyCity || 'N/A'} - ${exp.propertyState || 'MG'}`, 65, 115);

        doc.setFont('helvetica', 'bold');
        doc.text('ÁREA TOTAL / MATRÍCULA / CAR:', 15, 122);
        doc.setFont('helvetica', 'normal');
        doc.text(`${exp.propertyArea || 0} ha | Matrícula: ${exp.registrationNumber || 'N/A'} | CAR: ${exp.car || 'N/A'}`, 65, 122);

        // Section 3: Methodology and technical notes
        doc.setFontSize(11);
        doc.setFont('helvetica', 'bold');
        doc.text('3. METODOLOGIA APLICADA E PARECER TÉCNICO', 15, 136);
        doc.line(15, 139, pageWidth - 15, 139);

        doc.setFontSize(9);
        doc.setFont('helvetica', 'bold');
        doc.text('NORMA TÉCNICA APLICADA:', 15, 147);
        doc.setFont('helvetica', 'normal');
        doc.text(exp.normaAplicada || 'ABNT NBR 14.653-3', 65, 147);

        doc.setFont('helvetica', 'bold');
        doc.text('MÉTODO DE AVALIAÇÃO:', 15, 154);
        doc.setFont('helvetica', 'normal');
        doc.text(exp.metodologia || 'Comparativo Direto de Dados de Mercado', 65, 154);

        const notesText = exp.laudoNotes || 'Vistoria técnica pericial realizada in loco no imóvel com levantamento de dados, documentação cartorial, caracterização agronômica do solo, benfeitorias e servidões correlatas.';
        const splitNotes = doc.splitTextToSize(notesText, pageWidth - 30);
        doc.text(splitNotes, 15, 164);

        // Section 4: Fees and closing
        let curY = 164 + (splitNotes.length * 4.5) + 10;
        doc.setFontSize(11);
        doc.setFont('helvetica', 'bold');
        doc.text('4. HONORÁRIOS PERICIAIS E ENCERRAMENTO', 15, curY);
        doc.line(15, curY + 3, pageWidth - 15, curY + 3);

        doc.setFontSize(9);
        doc.setFont('helvetica', 'normal');
        doc.text(`Honorários Propostos: R$ ${Number(exp.honorariosPropostos || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })} | Aprovados: R$ ${Number(exp.honorariosAprovados || exp.honorariosPropostos || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`, 15, curY + 11);
        doc.text(`Status do Laudo: ${(exp.laudoStatus || 'concluido').toUpperCase()} | Alvará Judicial: ${exp.alvaraNumber || 'Em Processamento'}`, 15, curY + 17);

        // Signature block
        const signY = curY + 38;
        doc.setDrawColor(148, 163, 184);
        doc.line(pageWidth / 2 - 40, signY, pageWidth / 2 + 40, signY);
        doc.setFontSize(9);
        doc.setFont('helvetica', 'bold');
        doc.text('Engenheiro Agrônomo - Perito Judicial Oficial', pageWidth / 2, signY + 5, { align: 'center' });
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8);
        doc.text(getPdfBranding().companyName, pageWidth / 2, signY + 10, { align: 'center' });
      } else if (folder.type === 'rural_valuation') {
        const val = folder.data || {};
        // Top Banner for Rural Valuation
        doc.setFillColor(6, 78, 59); // emerald 900
        doc.rect(0, 0, pageWidth, 42, 'F');
        doc.setFillColor(16, 185, 129); // emerald-500 accent
        doc.rect(0, 42, pageWidth, 3, 'F');

        doc.setTextColor(255, 255, 255);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(18);
        doc.text('LAUDO DE AVALIAÇÃO MERCADOLÓGICA RURAL', 15, 18);
        doc.setFontSize(10);
        doc.setFont('helvetica', 'normal');
        doc.text(`NORMA TÉCNICA ABNT NBR 14.653-3 • GRAU DE FUNDAMENTAÇÃO ${val.fundamentationDegree || 'II'}`, 15, 28);
        doc.text(`FINALIDADE: ${(val.purpose || 'Mercadológica').toUpperCase().replace(/_/g, ' ')}`, 15, 36);

        // 1. Client & Property
        doc.setTextColor(30, 41, 59);
        doc.setFontSize(11);
        doc.setFont('helvetica', 'bold');
        doc.text('1. DADOS DO PROPRIETÁRIO E DO IMÓVEL', 15, 56);
        doc.setDrawColor(226, 232, 240);
        doc.line(15, 59, pageWidth - 15, 59);

        doc.setFontSize(9);
        doc.setFont('helvetica', 'bold');
        doc.text('PROPRIETÁRIO / SOLICITANTE:', 15, 68);
        doc.setFont('helvetica', 'normal');
        doc.text(val.clientName || selectedClient.name, 70, 68);

        doc.setFont('helvetica', 'bold');
        doc.text('NOME DO IMÓVEL / MUNICÍPIO:', 15, 75);
        doc.setFont('helvetica', 'normal');
        doc.text(`${val.propertyName || 'Fazenda'} — ${val.propertyCity || 'N/A'}/${val.propertyState || 'MG'}`, 70, 75);

        doc.setFont('helvetica', 'bold');
        doc.text('REGISTROS / CAR / CCIR / ITR:', 15, 82);
        doc.setFont('helvetica', 'normal');
        doc.text(`Matrícula: ${val.registrationNumber || 'N/A'} | CAR: ${val.car || 'N/A'} | CCIR: ${val.ccir || 'N/A'}`, 70, 82);

        // 2. Land use distribution table
        doc.setFontSize(11);
        doc.setFont('helvetica', 'bold');
        doc.text('2. DISTRIBUIÇÃO DAS ÁREAS E USO DO SOLO', 15, 96);
        doc.line(15, 99, pageWidth - 15, 99);

        const areasTable = [
          ['Área Total do Imóvel', `${val.totalArea || 0} ha`, '100%'],
          ['Área Agrícola Cultivável', `${val.agriculturalArea || 0} ha`, `${val.totalArea ? Math.round(((val.agriculturalArea || 0) / val.totalArea) * 100) : 0}%`],
          ['Área de Pastagens', `${val.pastureArea || 0} ha`, `${val.totalArea ? Math.round(((val.pastureArea || 0) / val.totalArea) * 100) : 0}%`],
          ['Área de Preservação / Floresta / APP', `${(Number(val.forestArea || 0) + Number(val.appArea || 0))} ha`, `${val.totalArea ? Math.round((((Number(val.forestArea || 0) + Number(val.appArea || 0))) / val.totalArea) * 100) : 0}%`]
        ];

        autoTable(doc, {
          startY: 104,
          head: [['Discriminação do Uso', 'Área (Hectares)', 'Proporção (%)']],
          body: areasTable,
          headStyles: { fillColor: [6, 78, 59] },
          styles: { fontSize: 8.5 }
        });

        // 3. Technical characteristics and values
        const nextY = (doc as any).lastAutoTable.finalY + 12;
        doc.setFontSize(11);
        doc.setFont('helvetica', 'bold');
        doc.text('3. SÍNTESE DA VALORAÇÃO ECONÔMICA (NBR 14.653-3)', 15, nextY);
        doc.line(15, nextY + 3, pageWidth - 15, nextY + 3);

        doc.setFontSize(9);
        doc.setFont('helvetica', 'bold');
        doc.text('VALOR DA TERRA NUA (VTN/ha):', 15, nextY + 11);
        doc.setFont('helvetica', 'normal');
        doc.text(`R$ ${Number(val.landValuePerHa || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })} / hectare`, 75, nextY + 11);

        doc.setFont('helvetica', 'bold');
        doc.text('BENFEITORIAS E REPRODUÇÃO:', 15, nextY + 18);
        doc.setFont('helvetica', 'normal');
        doc.text(`R$ ${Number(val.improvementsValue || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`, 75, nextY + 18);

        doc.setFont('helvetica', 'bold');
        doc.text('VALOR TOTAL AVALIADO:', 15, nextY + 26);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(6, 78, 59);
        doc.setFontSize(12);
        doc.text(`R$ ${Number(val.totalValue || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`, 75, nextY + 26);

        // Signatures
        doc.setTextColor(30, 41, 59);
        const signValY = nextY + 52;
        doc.setDrawColor(148, 163, 184);
        doc.line(pageWidth / 2 - 40, signValY, pageWidth / 2 + 40, signValY);
        doc.setFontSize(9);
        doc.setFont('helvetica', 'bold');
        doc.text('Engenheiro Agrônomo Responsável Técnico', pageWidth / 2, signValY + 5, { align: 'center' });
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8);
        doc.text(getPdfBranding().companyName, pageWidth / 2, signValY + 10, { align: 'center' });
      } else if (folder.type === 'field_visit') {
        const visit = folder.data || {};
        // Top Banner for Field Visit
        doc.setFillColor(13, 148, 136); // teal 600
        doc.rect(0, 0, pageWidth, 42, 'F');
        doc.setFillColor(15, 23, 42); // slate 900 accent
        doc.rect(0, 42, pageWidth, 3, 'F');

        doc.setTextColor(255, 255, 255);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(18);
        doc.text('RELATÓRIO TÉCNICO DE VISTORIA AGRONÔMICA', 15, 18);
        doc.setFontSize(10);
        doc.setFont('helvetica', 'normal');
        doc.text(`DATA DA VISITA: ${visit.visitDate ? formatDate(visit.visitDate) : 'N/A'} • TÉCNICO: ${visit.technicianName || 'Consultor'}`, 15, 28);
        doc.text(`PROPRIEDADE: ${visit.propertyName || 'Fazenda'} • GPS: ${visit.latitude ? `${visit.latitude.toFixed(5)}, ${visit.longitude?.toFixed(5)}` : 'Registrado em Campo'}`, 15, 36);

        // 1. Identification
        doc.setTextColor(30, 41, 59);
        doc.setFontSize(11);
        doc.setFont('helvetica', 'bold');
        doc.text('1. DADOS DA VISITA DE CAMPO', 15, 56);
        doc.setDrawColor(226, 232, 240);
        doc.line(15, 59, pageWidth - 15, 59);

        doc.setFontSize(9);
        doc.setFont('helvetica', 'bold');
        doc.text('PRODUTOR RURAL:', 15, 68);
        doc.setFont('helvetica', 'normal');
        doc.text(visit.clientName || selectedClient.name, 60, 68);

        doc.setFont('helvetica', 'bold');
        doc.text('OBJETIVO DA VISTORIA:', 15, 75);
        doc.setFont('helvetica', 'normal');
        doc.text(visit.objective || 'Monitoramento de lavouras e inspeção fitossanitária', 60, 75);

        // 2. Crops Table
        if (visit.crops && visit.crops.length > 0) {
          doc.setFontSize(11);
          doc.setFont('helvetica', 'bold');
          doc.text('2. CULTURAS MONITORADAS E ESTÁGIOS', 15, 89);
          doc.line(15, 92, pageWidth - 15, 92);

          const cropsBody = visit.crops.map((c: any) => [
            c.name || 'Cultura',
            c.stage || 'Desenvolvimento',
            `${c.estimatedArea || 0} ha`,
            c.observations || 'Sem anormalidades'
          ]);

          autoTable(doc, {
            startY: 96,
            head: [['Cultura', 'Estágio Fenológico', 'Área Estimada', 'Observações Específicas']],
            body: cropsBody,
            headStyles: { fillColor: [13, 148, 136] },
            styles: { fontSize: 8.5 }
          });
        }

        // 3. Diagnosis & Recommendations
        const visitLastY = (visit.crops && visit.crops.length > 0 && (doc as any).lastAutoTable) ? (doc as any).lastAutoTable.finalY + 12 : 96;
        doc.setFontSize(11);
        doc.setFont('helvetica', 'bold');
        doc.text('3. DIAGNÓSTICO AGRONÔMICO E RECOMENDAÇÕES', 15, visitLastY);
        doc.line(15, visitLastY + 3, pageWidth - 15, visitLastY + 3);

        doc.setFontSize(9);
        doc.setFont('helvetica', 'bold');
        doc.text('OBSERVAÇÕES GERAIS DE CAMPO:', 15, visitLastY + 11);
        doc.setFont('helvetica', 'normal');
        const obsSplit = doc.splitTextToSize(visit.generalObservations || 'Inspeção técnica realizada sem intercorrências graves.', pageWidth - 30);
        doc.text(obsSplit, 15, visitLastY + 17);

        const recY = visitLastY + 17 + (obsSplit.length * 4.5) + 6;
        doc.setFont('helvetica', 'bold');
        doc.text('PRESCRIÇÕES TÉCNICAS E RECOMENDAÇÕES:', 15, recY);
        doc.setFont('helvetica', 'normal');
        const recSplit = doc.splitTextToSize(visit.recommendations || 'Manter manejo nutricional e rotação conforme planejamento agronômico.', pageWidth - 30);
        doc.text(recSplit, 15, recY + 6);

        // Signatures
        const signVisitY = recY + 6 + (recSplit.length * 4.5) + 20;
        doc.setDrawColor(148, 163, 184);
        doc.line(25, signVisitY, 85, signVisitY);
        doc.line(125, signVisitY, 185, signVisitY);
        doc.setFontSize(8);
        doc.setFont('helvetica', 'bold');
        doc.text(visit.technicianName || 'Engenheiro Agrônomo', 55, signVisitY + 5, { align: 'center' });
        doc.text(selectedClient.name, 155, signVisitY + 5, { align: 'center' });
        doc.setFont('helvetica', 'normal');
        doc.text('RESPONSÁVEL TÉCNICO', 55, signVisitY + 9, { align: 'center' });
        doc.text('PRODUTOR RURAL', 155, signVisitY + 9, { align: 'center' });
      } else {
        // Standard Emerald Header Panel for Topography, Regularization, Irrigation, Analysis
        doc.setFillColor(16, 185, 129); // emerald-500/600
        doc.rect(0, 0, pageWidth, 45, 'F');
        
        doc.setTextColor(255, 255, 255);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(24);
        doc.text(getPdfBranding().companyName.toUpperCase(), 20, 24);
        
        doc.setFont('helvetica', 'italic');
        doc.setFontSize(10);
        doc.text('Sistema Inteligente de Gestão e Consultoria Agrícola', 20, 32);
        
        // Secondary Dark Slate Title bar
        doc.setFillColor(30, 41, 59); // slate-800
        doc.rect(0, 45, pageWidth, 12, 'F');
        doc.setTextColor(255, 255, 255);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(9);
        doc.text('PRONTUÁRIO TÉCNICO DE SERVIÇO • EMISSÃO E PROTOCOLO', 20, 53);
        
        doc.setTextColor(30, 41, 59); // slate-800
        
        // 1. Client identification
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(13);
        doc.text('1. DADOS DE IDENTIFICAÇÃO DO PRODUTOR', 20, 75);
        doc.setDrawColor(226, 232, 240); // slate-200
        doc.line(20, 78, pageWidth - 20, 78);
        
        doc.setFontSize(10);
        doc.setFont('helvetica', 'bold');
        doc.text('PRODUTOR / CLIENTE:', 20, 86);
        doc.setFont('helvetica', 'normal');
        doc.text(selectedClient.name, 65, 86);
        
        doc.setFont('helvetica', 'bold');
        doc.text('CPF / CNPJ DO PRODUTOR:', 20, 93);
        doc.setFont('helvetica', 'normal');
        doc.text(selectedClient.cpf || 'N/A', 65, 93);
        
        doc.setFont('helvetica', 'bold');
        doc.text('TIPO DE INSCRIÇÃO:', 20, 100);
        doc.setFont('helvetica', 'normal');
        doc.text(selectedClient.clientType === 'rural_producer' ? 'Inscrição Estadual de Produtor Rural' : 'Produtor Especial', 65, 100);
        
        // 2. Service specifications
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(13);
        doc.text('2. ESPECIFICAÇÕES DO SERVIÇO CONTRATADO', 20, 115);
        doc.line(20, 118, pageWidth - 20, 118);
        
        doc.setFontSize(10);
        doc.setFont('helvetica', 'bold');
        doc.text('IDENTIFICAÇÃO:', 20, 126);
        doc.setFont('helvetica', 'normal');
        doc.text(folder.name, 65, 126);
        
        doc.setFont('helvetica', 'bold');
        doc.text('CATEGORIA TÉCNICA:', 20, 133);
        doc.setFont('helvetica', 'normal');
        doc.text(folder.type === 'analysis' ? 'Análise Técnica / Projeto' : (folder.type || '').toUpperCase(), 65, 133);
        
        doc.setFont('helvetica', 'bold');
        doc.text('DATA DE REGISTRO:', 20, 140);
        doc.setFont('helvetica', 'normal');
        doc.text(folder.date ? formatDate(folder.date) : 'N/A', 65, 140);
        
        doc.setFont('helvetica', 'bold');
        doc.text('SITUAÇÃO / STATUS:', 20, 147);
        doc.setFont('text', 'bold');
        doc.text(folder.status ? (folder.status || '').toUpperCase() : 'EXECUTANDO', 65, 147);
        
        doc.setFont('helvetica', 'bold');
        doc.text('PROPRIEDADE ASSOCIADA:', 20, 154);
        doc.setFont('helvetica', 'normal');
        doc.text(folder.data?.propertyName || 'Fazenda Sede', 65, 154);
        
        // 3. Descrição / Observações
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(13);
        doc.text('3. DESCRITIVO DETALHADO DO PARECER', 20, 170);
        doc.line(20, 173, pageWidth - 20, 173);
        
        doc.setFontSize(9.5);
        doc.setFont('helvetica', 'normal');
        const descText = folder.description || 'Não há observações ou pareceres secundários cadastrados para este respectivo serviço no painel inicial.';
        const descLines = doc.splitTextToSize(descText, pageWidth - 40);
        doc.text(descLines, 20, 181);
        
        let nextY = 181 + (descLines.length * 5) + 12;
        
        // 4. Finance details
        if (folder.data?.value) {
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(13);
          doc.text('4. VALORIZAÇÃO ECONÔMICA E DE INVESTIMENTOS', 20, nextY);
          doc.line(20, nextY + 3, pageWidth - 20, nextY + 3);
          
          doc.setFontSize(10);
          doc.setFont('helvetica', 'bold');
          doc.text('VALOR NOMINAL DO SERVIÇO:', 20, nextY + 11);
          doc.setFont('helvetica', 'normal');
          doc.text(`R$ ${Number(folder.data.value).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`, 75, nextY + 11);
          
          if (folder.data?.cost) {
            doc.setFont('helvetica', 'bold');
            doc.text('CUSTO ADMINISTRATIVO / OPERACIONAL:', 20, nextY + 18);
            doc.setFont('helvetica', 'normal');
            doc.text(`R$ ${Number(folder.data.cost).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`, 75, nextY + 18);
          }
          nextY += 28;
        }
        
        // 5. Specialty details (Credit)
        if (folder.type === 'analysis' && folder.data?.type === 'credit') {
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(13);
          doc.text('5. INFORMAÇÕES DE CRÉDITO RURAL', 20, nextY);
          doc.line(20, nextY + 3, pageWidth - 20, nextY + 3);
          
          doc.setFontSize(10);
          doc.setFont('helvetica', 'bold');
          doc.text('INSTITUIÇÃO BANCÁRIA:', 20, nextY + 11);
          doc.setFont('helvetica', 'normal');
          doc.text(folder.data?.bank || 'N/A', 75, nextY + 11);
          
          doc.setFont('helvetica', 'bold');
          doc.text('LINHA DE FINANCIAMENTO:', 20, nextY + 18);
          doc.setFont('helvetica', 'normal');
          doc.text(folder.data?.financingType || 'N/A', 75, nextY + 18);
          
          doc.setFont('helvetica', 'bold');
          doc.text('CATEGORIA DA CHAMADA:', 20, nextY + 25);
          doc.setFont('helvetica', 'normal');
          doc.text(folder.data?.category || 'N/A', 75, nextY + 25);
        }
      }
      
      // Footer slate
      doc.setFillColor(248, 250, 252); // slate-50
      doc.rect(0, pageHeight - 25, pageWidth, 25, 'F');
      
      doc.setDrawColor(226, 232, 240); // slate-200
      doc.line(0, pageHeight - 25, pageWidth, pageHeight - 25);
      
      doc.setFont('helvetica', 'italic');
      doc.setFontSize(7.5);
      doc.setTextColor(148, 163, 184); // slate-400
      doc.text('Este documento oficial foi autogerado pelo sistema eletrônico seguro AgroGestão PRO com auditoria integrada.', pageWidth / 2, pageHeight - 14, { align: 'center' });
      doc.text(`${getPdfBranding().companyName} — documento confidencial, tratado conforme a LGPD.`, pageWidth / 2, pageHeight - 9, { align: 'center' });
      
      const isContract = folder.type === 'contract';
      const isJudicial = folder.type === 'judicial_expertise';
      const isValuation = folder.type === 'rural_valuation';
      const isVisit = folder.type === 'field_visit';

      let fileName = `Relatorio_Oficial_${folder.name.replace(/[^a-zA-Z0-9]/g, '_')}.pdf`;
      let docCategory = 'Relatório';
      let docOfficialTitle = `Relatório Técnico Oficial - ${folder.name}.pdf`;

      if (isContract) {
        fileName = `Contrato_N_${(folder.data?.contractNumber || 'Sem_Numero').replace(/[^a-zA-Z0-9]/g, '_')}.pdf`;
        docCategory = 'Contrato';
        docOfficialTitle = `Minuta Contratual Oficial - N° ${folder.data?.contractNumber || 'S/N'}.pdf`;
      } else if (isJudicial) {
        fileName = `Laudo_Pericial_Proc_${(folder.data?.processNumber || 'Sem_Proc').replace(/[^a-zA-Z0-9]/g, '_')}.pdf`;
        docCategory = 'Perícia';
        docOfficialTitle = `Laudo Pericial Oficial - Proc. ${folder.data?.processNumber || 'S/N'}.pdf`;
      } else if (isValuation) {
        fileName = `Laudo_Avaliacao_Rural_${(folder.data?.propertyName || 'Imovel').replace(/[^a-zA-Z0-9]/g, '_')}.pdf`;
        docCategory = 'Avaliação';
        docOfficialTitle = `Laudo de Avaliação NBR 14.653 - ${folder.data?.propertyName || 'Imóvel'}.pdf`;
      } else if (isVisit) {
        fileName = `Vistoria_Campo_${(folder.data?.propertyName || 'Imovel').replace(/[^a-zA-Z0-9]/g, '_')}.pdf`;
        docCategory = 'Vistoria';
        docOfficialTitle = `Relatório de Vistoria de Campo - ${folder.data?.propertyName || 'Fazenda'}.pdf`;
      }
      
      if (shouldSaveToDb) {
        const pdfBlob = doc.output('blob');
        saveFile(pdfBlob, `${folder.type}_${folder.id}.pdf`, { clientId: selectedClient.id }).then(async ({ url: downloadUrl, storagePath: filePath }) => {

          await addDoc(collection(db, 'documents'), {
            clientId: selectedClient.id,
            serviceId: folder.id,
            serviceName: folder.name,
            name: docOfficialTitle,
            type: 'application/pdf',
            category: docCategory,
            url: downloadUrl,
            storagePath: filePath,
            size: pdfBlob.size,
            uploadedBy: auth.currentUser?.displayName || 'Sistema',
            uploadedAt: serverTimestamp()
          });
          
          toast.success(
            `${docCategory} oficial armazenado e sincronizado no dossiê com sucesso!`,
            { id: toastId! }
          );
        }).catch((err) => {
          console.error('Error saving PDF to Firestore:', err);
          toast.error(uploadErrorMessage(err), { id: toastId! });
        });
      } else {
        doc.save(fileName);
        toast.success('Documento exportado em PDF com sucesso.');
      }
      
    } catch (error) {
      console.error('PDF Generation Failure:', error);
      toast.error('Ocorreu um erro ao emitir o documento virtual.');
      if (toastId) toast.dismiss(toastId);
    } finally {
      setIsGeneratingPDF(false);
    }
  };

  const handleDeleteFile = async (document: ClientDocument & { storagePath?: string }) => {
    try {
      await deleteStoredFile(document.storagePath).catch(err => console.warn('Arquivo não encontrado, removendo o registro mesmo assim', err));
      await deleteDoc(doc(db, 'documents', document.id));
      toast.success('Arquivo removido com sucesso.');
    } catch (error) {
      console.error('Error deleting document:', error);
      toast.error('Erro ao excluir documento.');
    }
  };

  const formatSize = (bytes: number | string) => {
    // Pastas de laudo gravam o tamanho como texto ("0 KB"); registros antigos podem não ter.
    if (typeof bytes === 'string') return bytes;
    if (!bytes || !isFinite(bytes)) return '—';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  const getAnalysisLabel = (type: string) => {
    switch (type) {
      case 'soil': return 'Análise de Solo';
      case 'foliar': return 'Análise Foliar';
      case 'water': return 'Análise de Água';
      case 'credit': return 'Crédito Rural';
      case 'environmental_xray': return 'Raio-X Ambiental';
      default: return 'Análise Técnica';
    }
  };

  const getFoldersList = () => {
    const list = [
      {
        id: 'general',
        name: 'Documentos Gerais',
        description: 'Dossiê principal com arquivos e documentações de cadastro do produtor (RG, CPF, CAR, Escrituras).',
        type: 'general',
        status: 'Geral',
        date: '',
        color: 'bg-emerald-50 text-emerald-600',
        borderColor: 'border-emerald-100 hover:border-emerald-300',
        data: null
      },
      ...contracts.map(item => ({
        id: item.id,
        name: `Contrato: N° ${item.contractNumber || 'S/N'} - ${item.category || 'Prestação'}`,
        description: `Objeto: ${item.title || item.description || 'Consultoria Agrícola'} • R$ ${Number(item.totalValue || item.value || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`,
        type: 'contract',
        status: item.status === 'active' || item.status === 'ativo' ? 'Ativo' :
                item.status === 'completed' || item.status === 'concluido' ? 'Concluído' :
                item.status === 'cancelled' || item.status === 'cancelado' ? 'Cancelado' : 'Em Elaboração',
        date: item.startDate || item.createdAt || '',
        color: 'bg-slate-50 text-slate-600',
        borderColor: 'border-slate-100 hover:border-slate-300',
        data: item
      })),
      ...judicialExpertises.map(item => ({
        id: item.id,
        name: `Perícia Judicial: Proc. ${item.processNumber || 'S/N'} - ${item.comarca || 'Comarca'}`,
        description: `${item.requerente || 'Autor'} vs ${item.requerido || 'Réu'} • ${item.expertiseType ? item.expertiseType.replace(/_/g, ' ') : 'Perícia'} • ${item.propertyName || 'Imóvel'}`,
        type: 'judicial_expertise',
        status: item.laudoStatus === 'entregue' ? 'Concluído' : item.laudoStatus === 'concluido' ? 'Laudo Pronto' : 'Em Elaboração',
        date: item.visitaDate || item.createdAt || '',
        color: 'bg-amber-50 text-amber-700',
        borderColor: 'border-amber-100 hover:border-amber-300',
        data: item
      })),
      ...ruralValuations.map(item => ({
        id: item.id,
        name: `Avaliação NBR 14.653: ${item.propertyName || 'Imóvel Rural'} (${item.totalArea || 0} ha)`,
        description: `Finalidade: ${item.purpose || 'Mercadológica'} • Avaliação: R$ ${Number(item.totalValue || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`,
        type: 'rural_valuation',
        status: item.status === 'entregue' || item.status === 'concluido' ? 'Concluído' : 'Em Elaboração',
        date: item.reportDate || item.createdAt || '',
        color: 'bg-emerald-50 text-emerald-700',
        borderColor: 'border-emerald-100 hover:border-emerald-300',
        data: item
      })),
      ...fieldVisits.map(item => ({
        id: item.id,
        name: `Vistoria Técnica: ${item.propertyName || 'Fazenda'}`,
        description: `Técnico: ${item.technicianName || 'Agrônomo'} • ${item.objective || 'Vistoria de Campo e Culturas'}`,
        type: 'field_visit',
        status: 'Concluído',
        date: item.visitDate || item.createdAt || '',
        color: 'bg-slate-50 text-slate-700',
        borderColor: 'border-slate-100 hover:border-slate-300',
        data: item
      })),
      ...analyses.map(item => ({
        id: item.id,
        name: `${getAnalysisLabel(item.type)} - ${item.propertyName || 'Sem nome'}`,
        description: item.description || 'Análise/Serviço Técnico Cadastrado.',
        type: 'analysis',
        status: item.status || 'Pendente',
        date: item.scheduledDate || item.collectionDate || '',
        color: 'bg-amber-50 text-amber-600',
        borderColor: 'border-amber-100 hover:border-amber-300',
        data: item
      })),
      ...topographyServices.map(item => ({
        id: item.id,
        name: `Topografia: ${item.serviceType || 'Serviço'} - ${item.propertyName || 'Sem nome'}`,
        description: item.description || 'Serviço de Topografia.',
        type: 'topography',
        status: item.status || 'Pendente',
        date: item.scheduledDate || '',
        color: 'bg-slate-50 text-slate-600',
        borderColor: 'border-slate-100 hover:border-slate-300',
        data: item
      })),
      ...regularizationServices.map(item => ({
        id: item.id,
        name: `Regularização: ${item.serviceType || 'Processo'} - ${item.propertyName || 'Sem nome'}`,
        description: item.description || 'Processo de licenciamento / regularização.',
        type: 'regularization',
        status: item.status || 'Em Andamento',
        date: item.createdAt || '',
        color: 'bg-slate-50 text-slate-600',
        borderColor: 'border-slate-100 hover:border-slate-300',
        data: item
      })),
      ...irrigationProjects.map(item => ({
        id: item.id,
        name: `Irrigação: ${item.pumpName || 'Projeto'} - ${item.propertyName || 'Sem nome'}`,
        description: item.emitterType ? `Emissores: ${item.emitterType} • Área: ${item.areaSize}ha` : 'Projeto Hídrico.',
        type: 'irrigation',
        status: item.status || 'Concluído',
        date: item.createdAt || '',
        color: 'bg-slate-50 text-slate-600',
        borderColor: 'border-slate-100 hover:border-slate-300',
        data: item
      }))
    ];
    return list;
  };

  return (
    <div className="flex flex-col gap-6 h-full overflow-y-auto pr-2 pb-10">
      <input 
        type="file" 
        className="hidden" 
        ref={fileInputRef}
        onChange={handleFileUpload}
      />

      <PageHeader icon={PageIcon} title="Documentos" subtitle="Dossiê digital de cada cliente: laudos, contratos e arquivos" />

      {!selectedClient ? (
        <div className="flex flex-col items-center justify-center min-h-[55vh] py-8 px-4">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-center space-y-6 max-w-2xl w-full"
          >
            <div className="space-y-2">
              <h2 className="text-lg font-display font-bold text-slate-700">Buscar dossiê do cliente</h2>
              <p className="text-sm text-slate-500">Digite o nome ou o CPF do produtor para abrir as pastas de documentos.</p>
            </div>

            <div className="relative mt-12">
              <div className="absolute inset-y-0 left-6 flex items-center pointer-events-none">
                <Search className="w-6 h-6 text-slate-400" />
              </div>
              <input
                type="text"
                placeholder="Pesquisar por Nome Completo ou CPF..."
                value={searchTerm}
                onChange={(e) => {
                  setSearchTerm(e.target.value);
                }}
                className={cn(
                  "w-full pl-16 pr-6 py-5 text-base bg-white border border-slate-200 shadow-lg rounded-[28px] focus:ring-4 focus:ring-emerald-500/20 focus:border-emerald-400 outline-none transition-all placeholder:text-slate-400 font-medium",
                  filteredClients.length > 0 && "rounded-b-none"
                )}
              />
              
              <AnimatePresence>
                {filteredClients.length > 0 && (
                  <motion.div 
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    className="absolute top-full left-0 right-0 bg-white shadow-2xl rounded-b-[32px] overflow-hidden border-t border-slate-100 z-50 max-h-[300px] overflow-y-auto"
                  >
                    {filteredClients.map(client => (
                      <button
                        key={client.id}
                        onClick={() => setSelectedClient(client)}
                        className="w-full flex items-center justify-between p-5 hover:bg-emerald-50 transition-colors text-left border-b border-slate-50 last:border-0"
                      >
                        <div className="flex items-center gap-4">
                          <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center text-slate-400">
                            <Users className="w-5 h-5" />
                          </div>
                          <div>
                            <div className="font-bold text-slate-700">{client.name}</div>
                            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{client.cpf || 'Sem CPF'} • {client.propertyType || 'Produtor'}</div>
                          </div>
                        </div>
                        <ChevronRight className="w-5 h-5 text-slate-300" />
                      </button>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* LGPD Section */}
            <div className="mt-16 pt-12 border-t border-slate-100 grid grid-cols-1 md:grid-cols-3 gap-8">
              <div className="space-y-3 p-6 glass-card border-none bg-slate-50/50">
                <ShieldCheck className="w-8 h-8 text-slate-600" />
                <h3 className="font-bold text-slate-900 text-sm">LGPD Compliance</h3>
                <p className="text-[11px] text-slate-700 leading-relaxed font-medium">
                  Todos os dados são tratados conforme a Lei Geral de Proteção de Dados (13.709/18).
                </p>
              </div>
              <div className="space-y-3 p-6 glass-card border-none bg-emerald-50/50">
                <Lock className="w-8 h-8 text-emerald-600" />
                <h3 className="font-bold text-emerald-900 text-sm">Criptografia</h3>
                <p className="text-[11px] text-emerald-700 leading-relaxed font-medium">
                  Protocolos de segurança avançados e acesso restrito por níveis.
                </p>
              </div>
              <div className="space-y-3 p-6 glass-card border-none bg-slate-50/50">
                <Info className="w-8 h-8 text-slate-600" />
                <h3 className="font-bold text-slate-900 text-sm">Auditabilidade</h3>
                <p className="text-[11px] text-slate-700 leading-relaxed font-medium">
                  Cada acesso ou alteração em documentos é registrado em logs.
                </p>
              </div>
            </div>
          </motion.div>
        </div>
      ) : (
        <motion.div 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="space-y-8"
        >
          {/* Header */}
          <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 glass p-6 rounded-3xl border border-white/40 shadow-sm">
            <div className="flex items-center gap-4">
              <button 
                onClick={() => {
                  setSelectedClient(null);
                  setCurrentFolder(null);
                }}
                className="p-3 bg-white text-slate-400 rounded-2xl hover:bg-slate-50 transition-colors shadow-sm cursor-pointer"
              >
                <ArrowLeft className="w-5 h-5" />
              </button>
              <div>
                <dt className="text-xs text-emerald-600 font-extrabold uppercase tracking-widest flex items-center gap-1.5 mb-0.5">
                  📁 Dossiê Digital do Produtor
                </dt>
                <h2 className="text-2xl font-display font-bold text-slate-800">{selectedClient.name}</h2>
                <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-1">
                  CPF/CNPJ: {selectedClient.cpf || 'Não Cadastrado'} • {getFoldersList().length - 1} Serviços Ativos
                </p>
              </div>
            </div>
            
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-bold text-emerald-800 bg-emerald-50 px-3 py-1.5 rounded-xl border border-emerald-100">
                Dossiê Criptografado
              </span>
            </div>
          </header>

          {currentFolder === null ? (
            /* STAGE 1: Folders Explorer Grid */
            <div className="space-y-6">
              <div className="flex flex-col gap-1.5">
                <h3 className="text-lg font-display font-bold text-slate-800 flex items-center gap-2">
                  <Folder className="w-5 h-5 text-emerald-600" />
                  Pastas do Cliente
                </h3>
                <p className="text-xs text-slate-550">
                  Selecione uma pasta abaixo correspondente aos serviços cadastrados para anexar documentos ou guardar relatórios.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {getFoldersList().map(folder => {
                  // Count of documents in this specific folder
                  const fileCount = folder.id === 'general' 
                    ? documents.filter(d => !d.serviceId).length 
                    : documents.filter(d => d.serviceId === folder.id).length;
                  
                  const syncInfo = getServiceSyncInfo(folder.id);
                  const isRecentlySynced = syncInfo.isRecent || recentSyncEvent?.serviceId === folder.id;

                  return (
                    <button
                      key={folder.id}
                      onClick={() => setCurrentFolder(folder)}
                      className={cn(
                        "glass-card p-6 border text-left flex flex-col justify-between min-h-[220px] hover:shadow-xl hover:-translate-y-1 transition-all group duration-200 cursor-pointer overflow-hidden relative",
                        isRecentlySynced ? "ring-2 ring-emerald-500/50 shadow-emerald-100 bg-emerald-50/10" : "",
                        folder.borderColor
                      )}
                    >
                      <div className="flex items-start justify-between w-full gap-2">
                        <section className={cn("p-3.5 rounded-2xl w-fit transition-all duration-200 group-hover:scale-110 shrink-0", folder.color)}>
                          <Folder className="w-7 h-7" />
                        </section>

                        <div className="flex flex-col items-end gap-1.5">
                          {/* Live Dossier Synchronization Badge */}
                          {folder.id !== 'general' && (
                            isRecentlySynced ? (
                              <span className="inline-flex items-center gap-1 text-[8.5px] font-extrabold px-2 py-0.5 rounded-full bg-emerald-600 text-white shadow-sm shadow-emerald-200 uppercase tracking-wider animate-pulse">
                                <Sparkles className="w-2.5 h-2.5" /> Recém-Sincronizado
                              </span>
                            ) : syncInfo.status === 'syncing' ? (
                              <span className="inline-flex items-center gap-1 text-[8.5px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-200 uppercase tracking-wider">
                                <Loader2 className="w-2.5 h-2.5 animate-spin text-amber-600" /> Sincronizando
                              </span>
                            ) : fileCount > 0 ? (
                              <span className="inline-flex items-center gap-1 text-[8.5px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200/80 uppercase tracking-wider">
                                <ShieldCheck className="w-2.5 h-2.5 text-emerald-600" /> Dossiê Ativo
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-[8.5px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 border border-slate-200 uppercase tracking-wider">
                                <FolderSync className="w-2.5 h-2.5 text-slate-500" /> Sincronizado
                              </span>
                            )
                          )}

                          <span className={cn(
                            "text-[9px] font-extrabold px-2 py-0.5 rounded-full uppercase tracking-wider",
                            folder.status === 'Pendente' ? 'bg-amber-100 text-amber-800' :
                            folder.status === 'Em Andamento' ? 'bg-slate-100 text-slate-800' :
                            folder.status === 'Concluído' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-700'
                          )}>
                            {folder.status}
                          </span>
                        </div>
                      </div>

                      <div className="space-y-1.5 mt-3 z-10">
                        <h4 className="font-bold text-slate-800 group-hover:text-emerald-700 transition-colors text-sm truncate w-full" title={folder.name}>
                          {folder.name}
                        </h4>
                        <p className="text-[11px] text-slate-500 leading-relaxed font-semibold line-clamp-2 h-8">
                          {folder.description}
                        </p>
                      </div>

                      <div className="flex items-center justify-between w-full border-t border-slate-50 pt-3 mt-3">
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-1">
                          <FileText className="w-3 h-3 text-slate-400" />
                          {fileCount} {fileCount === 1 ? 'Arquivo' : 'Arquivos'}
                        </span>
                        <span className="text-[10px] font-bold text-emerald-600 group-hover:translate-x-1 duration-150 flex items-center gap-0.5 uppercase tracking-widest">
                          Abrir Pasta <ArrowRight className="w-3.5 h-3.5" />
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : (
            /* STAGE 2: Workspace Inside Folder View */
            <div className="space-y-6">
              {/* Folder Navigation Path */}
              <div className="flex items-center justify-between">
                <button
                  onClick={() => setCurrentFolder(null)}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-white text-slate-500 border border-slate-200 hover:bg-slate-55 hover:text-slate-700 rounded-xl text-xs font-bold transition-all shadow-sm cursor-pointer"
                >
                  <ArrowLeft className="w-4 h-4" /> Voltar para Pastas
                </button>

                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-1">
                  <span>Dossiê {selectedClient.name.slice(0, 15)}...</span>
                  <span>/</span>
                  <span className="text-emerald-600">{currentFolder.name}</span>
                </div>
              </div>

              {/* Folder Details Box */}
              <div className="p-6 bg-white border border-slate-100 rounded-3xl flex flex-col md:flex-row items-start md:items-center justify-between gap-4 shadow-sm">
                <div className="flex items-center gap-4">
                  <div className={cn("p-4 rounded-2xl", currentFolder.color)}>
                    <FolderOpen className="w-8 h-8" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="text-lg font-bold text-slate-800">
                        {currentFolder.name}
                      </h3>
                      {currentFolder.id !== 'general' && (
                        <span className="inline-flex items-center gap-1 text-[9px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-200 uppercase tracking-wider">
                          <ShieldCheck className="w-3 h-3 text-emerald-600" /> Dossiê Sincronizado
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-550 mt-1 font-medium">
                      {currentFolder.description}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-3 self-end md:self-auto">
                  <button 
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isUploading}
                    className="flex items-center gap-2 px-5 py-2.5 bg-emerald-600 text-white rounded-2xl text-xs font-bold shadow-lg shadow-emerald-200 disabled:opacity-50 cursor-pointer"
                  >
                    {isUploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                    {isUploading ? 'Armazenando...' : 'Inserir Documento nesta Pasta'}
                  </button>
                </div>
              </div>

              {/* Documents & Reports List */}
              <div className="glass-card p-8">
                <h3 className="font-bold text-slate-800 mb-6 flex items-center gap-2">
                  <FileText className="w-5 h-5 text-slate-400" /> Arquivos Integrados
                </h3>

                <div className="space-y-4">
                  {/* Virtual Report Item for Service Folders */}
                  {currentFolder.id !== 'general' && (
                    <div className={cn(
                      "flex flex-col md:flex-row md:items-center justify-between p-5 border rounded-2xl gap-4 shadow-sm relative overflow-hidden group",
                      currentFolder.type === 'contract'
                        ? "bg-gradient-to-r from-emerald-50 to-emerald-50 border-slate-100"
                        : "bg-gradient-to-r from-emerald-50 to-emerald-50 border-emerald-100"
                    )}>
                      <div className={cn(
                        "absolute top-0 right-0 w-24 h-24 rounded-full -mr-6 -mt-6 pointer-events-none",
                        currentFolder.type === 'contract' ? "bg-emerald-500/5" : "bg-emerald-500/5"
                      )} />
                      
                      <div className="flex items-center gap-4">
                        <div className={cn(
                          "w-12 h-12 bg-white rounded-xl flex items-center justify-center border shadow-sm",
                          currentFolder.type === 'contract' ? "border-slate-150 text-slate-600" : "border-emerald-100 text-emerald-600"
                        )}>
                          <FileCheck className="w-6 h-6 animate-pulse" />
                        </div>
                        <div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className={cn(
                              "text-sm font-bold",
                              currentFolder.type === 'contract' ? "text-slate-950" : "text-emerald-990"
                            )}>
                              {currentFolder.type === 'contract' ? 'Minuta Oficial de Contrato e Cláusulas.pdf' : 'Relatório Prontuário Oficial do Serviço.pdf'}
                            </span>
                            <span className={cn(
                              "text-[9px] font-extrabold px-2 py-0.5 rounded-full uppercase tracking-wider",
                              currentFolder.type === 'contract' ? "bg-slate-100 text-slate-800" : "bg-emerald-100 text-emerald-800"
                            )}>
                              Virtual & Auto-Gerado
                            </span>
                          </div>
                          <p className={cn(
                            "text-xs mt-1 max-w-xl font-medium",
                            currentFolder.type === 'contract' ? "text-slate-700/90" : "text-emerald-700/90"
                          )}>
                            {currentFolder.type === 'contract'
                              ? 'Compila eletronicamente a qualificação das partes, valores contratuais, plano de parcelas e assinaturas digitais.'
                              : 'Compila eletronicamente todos os dados cadastrais, financeiros e observações deste serviço com carimbo institucional.'}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 self-end md:self-auto z-10">
                        <button
                          onClick={() => generateServicePDF(currentFolder, false)}
                          disabled={isGeneratingPDF}
                          title={currentFolder.type === 'contract' ? "Fazer download da minuta de contrato" : "Fazer download imediato do prontuário PDF"}
                          className={cn(
                            "flex items-center gap-1.5 px-4 py-2 bg-white rounded-xl text-xs font-bold transition-all shadow-sm cursor-pointer border",
                            currentFolder.type === 'contract'
                              ? "text-slate-700 border-slate-200 hover:bg-slate-50"
                              : "text-emerald-700 border-emerald-200 hover:bg-emerald-50"
                          )}
                        >
                          <Download className="w-3.5 h-3.5" />
                          Baixar PDF
                        </button>
                        
                        {documents.some(d => d.serviceId === currentFolder.id && (d.category === 'Relatório' || d.category === 'Contrato')) ? (
                          <div className={cn(
                            "flex items-center gap-1 text-[11px] font-bold px-3 py-2 rounded-xl pointer-events-none border",
                            currentFolder.type === 'contract'
                              ? "text-slate-750 bg-slate-100 border-slate-200"
                              : "text-emerald-750 bg-emerald-100 border-emerald-200"
                          )}>
                            <ShieldCheck className="w-3.5 h-3.5" />
                            Guardado no Dossiê
                          </div>
                        ) : (
                          <button
                            onClick={() => generateServicePDF(currentFolder, true)}
                            disabled={isGeneratingPDF}
                            title={currentFolder.type === 'contract' ? "Sincronizar cópia oficial deste contrato com a pasta de documentos" : "Guardar e arquivar cópia oficial deste relatório na pasta de forma permanente"}
                            className={cn(
                              "flex items-center gap-1.5 px-4 py-2 text-white rounded-xl text-xs font-bold transition-all shadow-md cursor-pointer",
                              currentFolder.type === 'contract'
                                ? "bg-emerald-600 hover:bg-emerald-700 shadow-emerald-250"
                                : "bg-emerald-600 hover:bg-emerald-700 shadow-emerald-250"
                            )}
                          >
                            <Lock className="w-3.5 h-3.5" />
                            Guardar na Pasta
                          </button>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Filtered documents list */}
                  {documents
                    .filter(doc => currentFolder.id === 'general' ? !doc.serviceId : doc.serviceId === currentFolder.id)
                    .map(doc => (
                      <div key={doc.id} className="group flex items-center justify-between p-4 hover:bg-slate-50 rounded-2xl transition-all border border-slate-100 hover:border-slate-200 bg-white">
                        <div className="flex items-center gap-4">
                          <div className={cn(
                            "w-12 h-12 rounded-xl flex items-center justify-center border shadow-sm transition-colors text-slate-450",
                            (doc.category === 'Relatório' || doc.category === 'Contrato') ? "bg-emerald-50/50 border-emerald-100 text-emerald-600" : "bg-white border-slate-100"
                          )}>
                            <FileText className="w-6 h-6" />
                          </div>
                          <div>
                            <div className="text-sm font-bold text-slate-705 flex items-center gap-2">
                              {doc.name}
                              {(doc.category === 'Relatório' || doc.category === 'Contrato') && (
                                <span className={cn(
                                  "text-[8px] font-extrabold px-1.5 py-0.5 text-white rounded uppercase tracking-wider",
                                  doc.category === 'Contrato' ? "bg-emerald-600" : "bg-emerald-500"
                                )}>
                                  {doc.category === 'Contrato' ? 'CONTRATO' : 'OFICIAL'}
                                </span>
                              )}
                            </div>
                            <div className="text-[10px] font-bold text-slate-400 uppercase mt-1">
                              {(doc.type || '').split('/')[1]?.toUpperCase() || 'FILE'} • {formatSize(doc.size)} • {doc.uploadedAt ? formatDateTime(doc.uploadedAt) : 'Recent'}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                          <a 
                            href={doc.url} 
                            onClick={(e) => handleFileLinkClick(e, doc.url, doc.name)}
                            target="_blank" 
                            rel="noopener noreferrer"
                            className="p-2 hover:bg-white rounded-full text-slate-400 hover:text-emerald-600 transition-colors border border-transparent hover:border-slate-150 shadow-sm"
                          >
                            <Download className="w-4 h-4" />
                          </a>
                          <button 
                            onClick={() => setIsDeleteModalOpen(doc)}
                            className="p-2 hover:bg-white rounded-full text-slate-400 hover:text-rose-500 transition-colors border border-transparent hover:border-slate-150 shadow-sm cursor-pointer"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    ))}

                  {/* Empty state when there are no files */}
                  {documents.filter(doc => currentFolder.id === 'general' ? !doc.serviceId : doc.serviceId === currentFolder.id).length === 0 && (
                    <div className="text-center py-16 text-slate-400 border border-dashed border-slate-200 rounded-3xl bg-slate-50/10">
                      <FileText className="w-12 h-12 mx-auto mb-3 opacity-20" />
                      <p className="text-sm font-medium">Nenhum arquivo customizado inserido nesta pasta.</p>
                      <p className="text-[11px] text-slate-450 mt-1">Utilize o botão &quot;Inserir Documento&quot; acima para importar arquivos de coleta, licenças ou KML.</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </motion.div>
      )}

      <ConfirmationModal
        isOpen={!!isDeleteModalOpen}
        onClose={() => setIsDeleteModalOpen(null)}
        onConfirm={() => isDeleteModalOpen && handleDeleteFile(isDeleteModalOpen)}
        title="Excluir Documento?"
        description="Esta ação removerá o arquivo permanentemente da nuvem e não poderá ser desfeita."
        confirmLabel="Excluir Agora"
      />
    </div>
  );
}
