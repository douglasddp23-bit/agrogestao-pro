import React, { useState, useEffect, useRef } from 'react';
import { runExclusive } from '../lib/submitGuard';
import { 
  ClipboardList, 
  Plus, 
  Search, 
  Filter, 
  Download, 
  FileText, 
  FileSpreadsheet, 
  Trash2, 
  Eye, 
  Calendar, 
  MapPin, 
  CloudUpload, 
  X, 
  PlusCircle, 
  MinusCircle, 
  CheckCircle2, 
  Activity, 
  Tablet, 
  Laptop,
  ArrowRight,
  ArrowLeft,
  ChevronRight,
  User,
  ExternalLink,
  Tag,
  Mic,
  MicOff,
  Sparkles,
  BookmarkPlus
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { collection, onSnapshot, addDoc, doc, deleteDoc, updateDoc, setDoc, query, orderBy } from 'firebase/firestore';
import { saveFile, uploadErrorMessage } from '../lib/fileStore';
import StoredImage from '../components/StoredImage';
import { db, storage } from '../lib/firebase';
import { useAuth } from '../contexts/AuthContext';
import { toast } from 'sonner';
import { exportToExcel } from '../lib/exportExcel';
import { triggerNewAppointmentNotification } from '../lib/notifications';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import SkeletonList from '../components/SkeletonList';
import ConfirmationModal from '../components/ConfirmationModal';
import AuditTrail from '../components/AuditTrail';
import { formatDateTime, formatDate, todayLocalDateString } from '../lib/utils';
import { FieldVisit, FieldVisitCrop, FieldVisitPhoto, Client, ServiceAnalysis, UserRole } from '../types';
import { PERMISSIONS } from '../lib/permissions';
import { logAudit } from '../lib/audit';
import { useOfflineCache } from '../hooks/useOfflineCache';
import { useLocation, useNavigate } from 'react-router-dom';
import { Database, CalendarCheck } from 'lucide-react';

// Simple Leaflet wrapper to prevent server-side crash or build issues
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';

// Fix generic Leaflet icon issue
import L from 'leaflet';
// @ts-ignore
import iconMarker from 'leaflet/dist/images/marker-icon.png';
// @ts-ignore
import iconRetina from 'leaflet/dist/images/marker-icon-2x.png';
// @ts-ignore
import iconShadow from 'leaflet/dist/images/marker-shadow.png';
import { PageTitle, PAGE_HEADER_CLASS } from '../components/layout/PageHeader';
import { ClipboardList as PageIcon } from 'lucide-react';
import { getPdfBranding, drawBrandBanner, drawBrandFooter } from '../lib/pdfBranding';

let DefaultIcon = L.icon({
    iconUrl: iconMarker,
    iconRetinaUrl: iconRetina,
    shadowUrl: iconShadow,
    iconSize: [25, 41],
    iconAnchor: [12, 41],
    popupAnchor: [1, -34],
    tooltipAnchor: [16, -28],
    shadowSize: [41, 41]
});
L.Marker.prototype.options.icon = DefaultIcon;

const syncBadge = {
  synced: { label: 'Sincronizado', color: 'bg-emerald-100 text-emerald-800 border-emerald-200' },
  pending_sync: { label: 'Aguardando Sync', color: 'bg-amber-100 text-amber-800 border-amber-200' },
  draft: { label: 'Rascunho', color: 'bg-slate-100 text-slate-800 border-slate-200' },
};

export default function FieldVisits() {
  const { user } = useAuth();
  const [rawVisits, setRawVisits] = useState<FieldVisit[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [analyses, setAnalyses] = useState<ServiceAnalysis[]>([]);
  const [loading, setLoading] = useState(true);

  const { data: visits, isUsingCache } = useOfflineCache('field_visits', rawVisits, loading);

  // Filters
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedTechnician, setSelectedTechnician] = useState('');
  const [selectedClientFilter, setSelectedClientFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [selectedCrop, setSelectedCrop] = useState('');

  // Modals & Forms
  const [isNewModalOpen, setIsNewModalOpen] = useState(false);
  const [selectedVisit, setSelectedVisit] = useState<FieldVisit | null>(null);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState<string | null>(null);

  // Form Multi-Step State
  const [currentStep, setCurrentStep] = useState(1);
  const [saving, setSaving] = useState(false);
  const [extraObservation, setExtraObservation] = useState('');
  const [isAddingObservation, setIsAddingObservation] = useState(false);

  const handleAddExtraObservation = async () => {
    if (!selectedVisit || !extraObservation.trim()) return;
    setIsAddingObservation(true);
    try {
      const now = new Date().toLocaleDateString('pt-BR');
      const author = user?.displayName || user?.email || 'Usuário';
      const updatedNotes = selectedVisit.generalObservations 
        ? `${selectedVisit.generalObservations}\n\n[${now} - ${author}]: ${extraObservation.trim()}`
        : `[${now} - ${author}]: ${extraObservation.trim()}`;
      
      await updateDoc(doc(db, 'field_visits', selectedVisit.id), {
        generalObservations: updatedNotes,
        updatedAt: new Date().toISOString()
      });

      await logAudit({
        userId: user?.uid || 'anonymous',
        userName: author,
        action: 'updated',
        collection: 'field_visits',
        recordId: selectedVisit.id,
        recordName: `Visita - ${selectedVisit.clientName} (${selectedVisit.propertyName})`,
        details: `Adicionada observação de campo`,
        previousValues: { generalObservations: selectedVisit.generalObservations },
        newValues: { generalObservations: updatedNotes }
      });

      setSelectedVisit(prev => prev ? { ...prev, generalObservations: updatedNotes } : null);
      setExtraObservation('');
      toast.success('Observação registrada com sucesso!');
    } catch (err: any) {
      console.error(err);
      toast.error('Erro ao adicionar observação: ' + err.message);
    } finally {
      setIsAddingObservation(false);
    }
  };

  // Form fields
  const [clientId, setClientId] = useState('');
  const [propertyName, setPropertyName] = useState('');
  const [technicianName, setTechnicianName] = useState(user?.displayName || '');
  const [visitDate, setVisitDate] = useState(todayLocalDateString());
  const [objective, setObjective] = useState('');
  const [generalObservations, setGeneralObservations] = useState('');
  const [recommendations, setRecommendations] = useState('');
  const [nextVisitDate, setNextVisitDate] = useState('');
  const [linkedServiceId, setLinkedServiceId] = useState('');
  // Agendamento que originou esta visita (Agenda → "Registrar Visita")
  const [linkedAppointmentId, setLinkedAppointmentId] = useState('');
  const location = useLocation();
  const navigate = useNavigate();

  // Dynamic Crops
  const [crops, setCrops] = useState<FieldVisitCrop[]>([
    { name: '', stage: '', estimatedArea: 0, observations: '' }
  ]);

  // Upload Photo Previews & Files
  const [photoFiles, setPhotoFiles] = useState<{ file: File; caption: string; preview: string }[]>([]);

  // Speech to Text Dictation State
  const [isRecordingDictation, setIsRecordingDictation] = useState(false);
  const [dictationTarget, setDictationTarget] = useState<'recommendations' | 'generalObservations' | null>(null);
  const recognitionRef = useRef<any>(null);

  // Quick Prescription Templates
  const QUICK_PRESCRIPTIONS = [
    {
      title: 'Controle de Lagarta e Percevejo',
      text: 'Aplicação foliar de inseticida fisiológico associado a piretróide/neonicotinoide. Volume de calda: 120 L/ha com pontas de indução de ar. Adicionar adjuvante siliconado a 0,05%.'
    },
    {
      title: 'Manejo Preventivo de Ferrugem / Mancha',
      text: 'Pulverização preventiva com fungicida sistêmico (triazol + estrobirulina) acrescido de multissítio (mancozebe/clorotalonil 1,5 kg/ha). Monitorar intervalos de 14 a 18 dias.'
    },
    {
      title: 'Adubação de Cobertura Nitrogenada',
      text: 'Aplicação a lanço de 150 kg/ha de Nitrato de Amônio / Ureia protegida no estágio V4-V6 em solo com umidade favorável. Evitar aplicação sob sol intenso e solo seco.'
    },
    {
      title: 'Dessecação Pré-Plantio (Plantio Direto)',
      text: 'Dessecação com Glifosato (3,0 L/ha) + 2,4-D amina (1,0 L/ha) com antecedência mínima de 10 dias da semeadura. Respeitar intervalo de segurança.'
    },
    {
      title: 'Correção de Solo (Calagem & Gesso)',
      text: 'Realizar calagem com calcário dolomítico (PRNT 85%) na dose de 2,5 t/ha e gessagem a 1,2 t/ha para neutralização de alumínio e fornecimento de Ca e S em profundidade.'
    }
  ];

  const handleStartDictation = (field: 'recommendations' | 'generalObservations') => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      toast.error('Reconhecimento de voz não suportado neste navegador. Utilize o Google Chrome.');
      return;
    }

    if (isRecordingDictation) {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
      setIsRecordingDictation(false);
      setDictationTarget(null);
      return;
    }

    try {
      const recognition = new SpeechRecognition();
      recognition.lang = 'pt-BR';
      recognition.continuous = true;
      recognition.interimResults = true;

      recognition.onstart = () => {
        setIsRecordingDictation(true);
        setDictationTarget(field);
        toast.info('Ditado por voz iniciado! Fale seu laudo técnico...', { duration: 3000 });
      };

      recognition.onresult = (event: any) => {
        let transcript = '';
        for (let i = event.resultIndex; i < event.results.length; ++i) {
          if (event.results[i].isFinal) {
            transcript += event.results[i][0].transcript + ' ';
          }
        }
        if (transcript) {
          if (field === 'recommendations') {
            setRecommendations(prev => (prev ? prev + ' ' + transcript.trim() : transcript.trim()));
          } else {
            setGeneralObservations(prev => (prev ? prev + ' ' + transcript.trim() : transcript.trim()));
          }
        }
      };

      recognition.onerror = (event: any) => {
        console.error('Speech recognition error:', event.error);
        setIsRecordingDictation(false);
        setDictationTarget(null);
        if (event.error !== 'no-speech') {
          toast.error(`Erro no microfone: ${event.error}`);
        }
      };

      recognition.onend = () => {
        setIsRecordingDictation(false);
        setDictationTarget(null);
      };

      recognitionRef.current = recognition;
      recognition.start();
    } catch (err) {
      console.error(err);
      toast.error('Não foi possível inicializar o microfone.');
    }
  };

  const applyPrescription = (text: string) => {
    setRecommendations(prev => prev ? `${prev}\n\n• ${text}` : text);
    toast.success('Modelo de prescrição adicionado com sucesso!');
  };

  // Load database
  useEffect(() => {
    const qVisits = query(collection(db, 'field_visits'), orderBy('visitDate', 'desc'));
    const unsubscribeVisits = onSnapshot(qVisits, (snapshot) => {
      setRawVisits(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as FieldVisit)));
      setLoading(false);
    }, (error) => {
      console.error(error);
      toast.error('Erro ao carregar visitas de campo.');
      setLoading(false);
    });

    const unsubscribeClients = onSnapshot(collection(db, 'clients'), (snapshot) => {
      setClients(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Client)));
    });

    const unsubscribeAnalyses = onSnapshot(collection(db, 'analyses'), (snapshot) => {
      setAnalyses(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as ServiceAnalysis)));
    });

    return () => {
      unsubscribeVisits();
      unsubscribeClients();
      unsubscribeAnalyses();
    };
  }, []);

  // Update Technician Name on User load
  useEffect(() => {
    if (user && !technicianName) {
      setTechnicianName(user.displayName);
    }
  }, [user]);

  // Handle Dynamic Crop rows
  const handleAddCrop = () => {
    setCrops([...crops, { name: '', stage: '', estimatedArea: 0, observations: '' }]);
  };

  const handleRemoveCrop = (index: number) => {
    if (crops.length > 1) {
      setCrops(crops.filter((_, i) => i !== index));
    }
  };

  const handleCropChange = (index: number, field: keyof FieldVisitCrop, value: any) => {
    const updated = [...crops];
    updated[index] = { ...updated[index], [field]: value };
    setCrops(updated);
  };

  // Photo uploads
  const handlePhotoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const filesArray = Array.from(e.target.files);
      const newPhotos = filesArray.map((file: any) => ({
        file: file as File,
        caption: '',
        preview: URL.createObjectURL(file as File)
      }));
      setPhotoFiles([...photoFiles, ...newPhotos]);
    }
  };

  const handleRemovePhoto = (index: number) => {
    URL.revokeObjectURL(photoFiles[index].preview);
    setPhotoFiles(photoFiles.filter((_, i) => i !== index));
  };

  const handlePhotoCaptionChange = (index: number, caption: string) => {
    const updated = [...photoFiles];
    updated[index].caption = caption;
    setPhotoFiles(updated);
  };

  // Submit visit Form (Step 5/Save)
  const handleSaveVisit = async () => {
    if (!clientId) {
      toast.error('Selecione o Produtor/Cliente.');
      return;
    }
    const client = clients.find(c => c.id === clientId);
    if (!client) return;

    setSaving(true);
    try {
      // 1. Prepare base visit item
      const visitId = doc(collection(db, 'field_visits')).id;
      const uploadedPhotosList: FieldVisitPhoto[] = [];

      // 2. Upload photos to Firebase Storage
      for (let i = 0; i < photoFiles.length; i++) {
        const item = photoFiles[i];
        const timestamp = Date.now();
        const filename = `${timestamp}_${item.file.name.replace(/[^a-zA-Z0-9.]/g, '_')}`;
        // Firestore gratuito (até 2 MB por foto) — ver lib/fileStore.ts
const { url: downloadUrl } = await saveFile(item.file, filename);

        uploadedPhotosList.push({
          id: `${timestamp}_${i}`,
          url: downloadUrl,
          caption: item.caption,
          takenAt: new Date().toISOString(),
          syncStatus: 'uploaded'
        });
      }

      // 3. Build document object
      const visitData: Partial<FieldVisit> = {
        id: visitId,
        clientId,
        clientName: client.name,
        propertyName,
        technicianId: user?.uid || '',
        technicianName: technicianName || user?.displayName || 'Técnico',
        createdBy: user?.uid || '',
        createdByName: user?.displayName || user?.email || 'Usuário',
        visitDate,
        objective,
        generalObservations,
        crops: crops.filter(c => (c.name || '').trim() !== ''),
        photos: uploadedPhotosList,
        recommendations,
        nextVisitDate: nextVisitDate || undefined,
        linkedServiceId: linkedServiceId || undefined,
        linkedAppointmentId: linkedAppointmentId || undefined,
        syncStatus: 'synced',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        createdByDevice: 'web'
      };

      // If client property has GPS coords, let's copy them as fallback
      const propInfo = (client.properties || []).find(p => p.name === propertyName);
      if (propInfo?.latitude && propInfo?.longitude) {
        visitData.latitude = propInfo.latitude;
        visitData.longitude = propInfo.longitude;
        visitData.accuracyMeters = 5;
      }

      // visitId foi pré-gerado acima (doc(collection(db,'field_visits')).id) pra já ter
      // um ID estável pro caminho das fotos no Storage. Por isso o registro tem que ser
      // CRIADO nesse mesmo ID com setDoc — updateDoc falha (o doc ainda não existe) e
      // addDoc criava um ID novo e diferente, deixando o "id" salvo nos dados
      // desalinhado do ID real do documento (quebrando exclusão e edição depois).
      await setDoc(doc(db, 'field_visits', visitId), { ...visitData, id: visitId });

      await logAudit({
        userId: user?.uid || 'anonymous',
        userName: user?.displayName || user?.email || 'Usuário',
        action: 'created',
        collection: 'field_visits',
        recordId: visitId,
        recordName: `Visita - ${client.name} (${propertyName})`,
        details: `Nova visita de campo cadastrada para ${visitDate}`,
        newValues: visitData
      });

      // Trigger automatic operational notification (in-app and backend-orchestrated e-mail)
      triggerNewAppointmentNotification({
        clientId: visitData.clientId || '',
        clientName: visitData.clientName || 'Cliente',
        propertyName: visitData.propertyName || 'Propriedade',
        technicianId: visitData.technicianId || '',
        technicianName: visitData.technicianName || '',
        visitDate: visitData.visitDate || '',
        objective: visitData.objective || ''
      }).catch(err => console.warn('Falha silenciosa ao acionar notificações:', err));

      // Visita feita a partir de um agendamento: o agendamento vira "Concluído"
      // (a Agenda mostra "Ver Visita" lendo o linkedAppointmentId da visita).
      if (linkedAppointmentId) {
        try {
          await updateDoc(doc(db, 'appointments', linkedAppointmentId), { status: 'completed' });
        } catch (apErr) {
          console.warn('Visita salva, mas não foi possível concluir o agendamento:', apErr);
        }
      }

      toast.success(linkedAppointmentId ? 'Visita registrada e agendamento concluído!' : 'Visita de campo registrada com sucesso!');
      setIsNewModalOpen(false);
      resetForm();
    } catch (e: any) {
      console.error(e);
      toast.error('Erro ao salvar visita: ' + e.message);
    } finally {
      setSaving(false);
    }
  };

  const resetForm = () => {
    setClientId('');
    setPropertyName('');
    setObjective('');
    setGeneralObservations('');
    setRecommendations('');
    setNextVisitDate('');
    setLinkedServiceId('');
    setLinkedAppointmentId('');
    setCrops([{ name: '', stage: '', estimatedArea: 0, observations: '' }]);
    photoFiles.forEach(p => URL.revokeObjectURL(p.preview));
    setPhotoFiles([]);
    setCurrentStep(1);
  };

  // Chegando da Agenda: "Registrar Visita" abre o formulário já preenchido com
  // o cliente, a data e o objetivo do agendamento; "Ver Visita" abre a ficha.
  useEffect(() => {
    const st: any = location.state;
    if (!st) return;
    if (st.fromAppointment && clients.length > 0) {
      const ap = st.fromAppointment;
      resetForm();
      setClientId(ap.clientId || '');
      const props = clients.find(c => c.id === ap.clientId)?.properties || [];
      if (props.length === 1) setPropertyName(props[0].name);
      setVisitDate(ap.date || todayLocalDateString());
      setObjective([ap.serviceType, ap.notes].filter(Boolean).join(' — '));
      setLinkedAppointmentId(ap.id);
      setIsNewModalOpen(true);
      navigate(location.pathname, { replace: true, state: null });
    } else if (st.openVisitId && visits.length > 0) {
      const v = visits.find(x => x.id === st.openVisitId);
      if (v) {
        setSelectedVisit(v);
        navigate(location.pathname, { replace: true, state: null });
      }
    }
  }, [location.state, clients, visits]);

  // Delete action
  const handleDeleteVisit = async (id: string) => {
    const visitToDelete = visits.find(v => v.id === id);
    // Remove da tela imediatamente, sem esperar o listener do Firestore reconciliar.
    setRawVisits(prev => prev.filter(v => v.id !== id));
    try {
      await deleteDoc(doc(db, 'field_visits', id));

      if (visitToDelete) {
        await logAudit({
          userId: user?.uid || 'anonymous',
          userName: user?.displayName || user?.email || 'Usuário',
          action: 'deleted',
          collection: 'field_visits',
          recordId: id,
          recordName: `Visita - ${visitToDelete.clientName} (${visitToDelete.propertyName})`,
          details: `Visita técnica excluída`,
          previousValues: visitToDelete
        });
      }

      toast.success('Visita técnica excluída com sucesso.');
      setIsDeleteModalOpen(null);
      if (selectedVisit && selectedVisit.id === id) {
        setSelectedVisit(null);
      }
    } catch (e: any) {
      console.error(e);
      toast.error('Erro ao excluir visita.');
      // Reverte a remoção otimista se o servidor recusou.
      if (visitToDelete) {
        setRawVisits(prev => prev.some(v => v.id === visitToDelete.id) ? prev : [...prev, visitToDelete]);
      }
    }
  };

  // Export metadata to CSV/Excel
  const handleExportCSV = () => {
    const dataToExport = visits.map(v => ({
      ID: v.id,
      Produtor: v.clientName,
      Propriedade: v.propertyName,
      'Data da Visita': formatDate(v.visitDate),
      Objetivo: v.objective,
      Técnico: v.technicianName,
      Culturas: (v.crops || []).map(c => `${c.name} (${c.stage})`).join(', '),
      Recomendações: v.recommendations,
      Dispositivo: v.createdByDevice || 'indefinido'
    }));
    exportToExcel(dataToExport, 'Visitas_de_Campo_AgroGestao');
    toast.success('Excel exportado com sucesso.');
  };

  const handleDownloadVisitsConsolidated = () => {
    if (filteredVisits.length === 0) {
      toast.error("Nenhuma visita para relatar.");
      return;
    }
    const doc = new jsPDF();
    doc.setFillColor(16, 185, 129); // emerald-500
    doc.rect(0, 0, 210, 35, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(20);
    doc.setFont("Helvetica", "bold");
    doc.text(getPdfBranding().companyName, 15, 15);
    doc.setFontSize(10);
    doc.setFont("Helvetica", "normal");
    doc.text(`Relatório Geral Consolidado de Visitas Técnicas (${filteredVisits.length} registradas)`, 15, 27);

    const rows = filteredVisits.map(v => [
      v.visitDate ? formatDate(v.visitDate) : 'N/D',
      v.clientName || 'N/D',
      v.propertyName || 'N/D',
      v.objective || 'N/D',
      v.crops && Array.isArray(v.crops) ? (v.crops || []).map(c => `${c.name} (${c.stage})`).join('\n') : 'N/A',
      v.technicianName || 'N/D'
    ]);

    autoTable(doc, {
      startY: 45,
      head: [['Data Visita', 'Produtor / Cliente', 'Propriedade', 'Objetivo / Atividade', 'Culturas Monitoradas', 'Consultor Técnico']],
      body: rows,
      headStyles: { fillColor: [16, 185, 129] },
      styles: { fontSize: 8.5 }
    });

    doc.save("Visitas_Tecnicas_Consolidado_AgroGestao.pdf");
    toast.success("PDF de visitas técnicas exportado!");
  };

  // Generate complete visit PDF Report
  const handleGeneratePDF = (visit: FieldVisit) => {
    // Só dados reais da visita. (Antes o relatório imprimia uma tabela de clima
    // fixa — "27,4 °C", "62 %" — e fotos simuladas com "sanidade: Excelente"
    // quando não havia fotos, como se fossem dados coletados.)
    try {
      const doc = new jsPDF();
      drawBrandBanner(doc, { height: 32, subtitle: 'Relatório Técnico & Diário de Visita de Campo' });
      doc.setTextColor(100, 116, 139);
      doc.setFontSize(8);
      doc.text(`Emitido em: ${new Date().toLocaleDateString('pt-BR')}  ·  ID: ${visit.id}`, 195, 38, { align: 'right' });

      doc.setTextColor(51, 65, 85);
      doc.setFontSize(11);
      doc.setFont('Helvetica', 'bold');
      doc.text('INFORMAÇÕES DA VISITA', 15, 46);
      const gps = typeof visit.latitude === 'number' && typeof visit.longitude === 'number'
        ? `${visit.latitude.toFixed(6)}, ${visit.longitude.toFixed(6)}${visit.accuracyMeters ? ` (±${Math.round(visit.accuracyMeters)} m)` : ''}`
        : 'Não registrado';
      autoTable(doc, {
        startY: 50,
        body: [
          ['Produtor / Cliente:', visit.clientName || '—', 'Data da Visita:', formatDate(visit.visitDate) || '—'],
          ['Propriedade:', visit.propertyName || '—', 'Técnico Responsável:', visit.technicianName || '—'],
          ['Objetivo Principal:', visit.objective || '—', 'Coordenadas GPS:', gps],
          ...(visit.nextVisitDate ? [['Próxima Visita:', formatDate(visit.nextVisitDate), '', '']] : []),
        ],
        theme: 'plain',
        styles: { cellPadding: 2, fontSize: 8.5 },
        columnStyles: { 0: { fontStyle: 'bold', cellWidth: 40 }, 1: { cellWidth: 60 }, 2: { fontStyle: 'bold', cellWidth: 40 }, 3: { cellWidth: 50 } },
      });

      let y = (doc as any).lastAutoTable.finalY + 8;
      const crops = visit.crops || [];
      if (crops.length) {
        doc.setFontSize(11); doc.setFont('Helvetica', 'bold');
        doc.text('CULTURAS INSPECIONADAS & DIAGNÓSTICO', 15, y);
        autoTable(doc, {
          startY: y + 4,
          head: [['Cultura', 'Estágio Fenológico', 'Área Estimada', 'Observações']],
          body: crops.map(c => [c.name || '—', c.stage || '—', c.estimatedArea ? `${c.estimatedArea} ha` : '—', c.observations || '—']),
          headStyles: { fillColor: [6, 95, 70] },
          styles: { fontSize: 8 },
        });
        y = (doc as any).lastAutoTable.finalY + 10;
      }

      const block = (title: string, body: string) => {
        if (y > 255) { doc.addPage(); y = 20; }
        doc.setFontSize(11); doc.setFont('Helvetica', 'bold'); doc.setTextColor(51, 65, 85);
        doc.text(title, 15, y);
        doc.setFont('Helvetica', 'normal'); doc.setFontSize(9);
        const lines = doc.splitTextToSize(body, 180);
        doc.text(lines, 15, y + 5);
        y += 10 + lines.length * 4;
      };
      block('RECOMENDAÇÕES TÉCNICAS', visit.recommendations || 'Nenhuma recomendação registrada.');
      block('OBSERVAÇÕES GERAIS', visit.generalObservations || 'Nenhuma observação registrada.');

      // Fotos reais (com a imagem quando estiver disponível no registro)
      const photos = (visit.photos || []).slice(0, 6);
      if (photos.length) {
        doc.addPage();
        doc.setFontSize(13); doc.setFont('Helvetica', 'bold'); doc.setTextColor(51, 65, 85);
        doc.text('ANEXO FOTOGRÁFICO', 15, 20);
        photos.forEach((photo, index) => {
          const x = 15 + (index % 2) * 92;
          const py = 28 + Math.floor(index / 2) * 84;
          doc.setDrawColor(203, 213, 225); doc.setFillColor(248, 250, 252);
          doc.rect(x, py, 86, 62, 'FD');
          const src = photo.url || photo.localUri || '';
          if (/^data:image\/(png|jpe?g)/i.test(src)) {
            try { doc.addImage(src, /png/i.test(src.slice(0, 20)) ? 'PNG' : 'JPEG', x + 1, py + 1, 84, 60); } catch { /* imagem inválida: fica o quadro */ }
          }
          doc.setFontSize(8); doc.setTextColor(30, 41, 59); doc.setFont('Helvetica', 'bold');
          doc.text(doc.splitTextToSize(`Foto ${index + 1}: ${photo.caption || 'Sem legenda'}`, 84)[0], x + 1, py + 67);
          doc.setFont('Helvetica', 'normal'); doc.setTextColor(100, 116, 139);
          if (photo.takenAt) doc.text(`Registrada em: ${formatDateTime(photo.takenAt)}`, x + 1, py + 71);
        });
      }

      // Assinaturas
      const pageCount = (doc as any).internal.getNumberOfPages();
      doc.setPage(pageCount);
      const pageHeight = doc.internal.pageSize.height;
      doc.setDrawColor(100, 116, 139);
      doc.line(30, pageHeight - 38, 90, pageHeight - 38);
      doc.line(120, pageHeight - 38, 180, pageHeight - 38);
      doc.setFontSize(8.5); doc.setTextColor(71, 85, 105);
      doc.text('Assinatura do Produtor Rural', 60, pageHeight - 33, { align: 'center' });
      doc.setFont('Helvetica', 'bold');
      doc.text(visit.technicianName || 'Responsável Técnico', 150, pageHeight - 33, { align: 'center' });
      doc.setFont('Helvetica', 'normal');
      doc.text('Responsável Técnico', 150, pageHeight - 29, { align: 'center' });
      drawBrandFooter(doc);

      doc.save(`Relatorio_Visita_${(visit.clientName || 'Cliente').replace(/\s+/g, '_')}_${visit.visitDate || ''}.pdf`);
      toast.success('Relatório PDF exportado com sucesso!');
    } catch (err) {
      console.error('Erro ao gerar PDF da visita:', err);
      toast.error('Não foi possível gerar o PDF desta visita.');
    }
  };


  // Filter Logic
  const filteredVisits = visits.filter(v => {
    // Consultant permission: see own visits or if admin created / assigned
    if ((user?.effectiveRole ?? user?.role) === 'consultant' || ((user?.effectiveRole ?? user?.role) as string) === 'staff') {
      const isOwnerOrAssigned = !v.createdBy || v.createdBy === user.uid || v.technicianId === user.uid || v.technicianName === user.displayName;
      if (!isOwnerOrAssigned) return false;
    }

    const matchesSearch = (v.clientName || '').toLowerCase().includes(searchTerm.toLowerCase()) || 
                          (v.propertyName || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
                          (v.objective || '').toLowerCase().includes(searchTerm.toLowerCase());
    
    const matchesTech = selectedTechnician === '' || v.technicianName === selectedTechnician;
    const matchesClient = selectedClientFilter === '' || v.clientId === selectedClientFilter;
    const matchesStatus = statusFilter === '' || v.syncStatus === statusFilter;
    const matchesCrop = selectedCrop === '' || (v.crops || []).some(c => (c.name || '').toLowerCase().includes(selectedCrop.toLowerCase()));

    return matchesSearch && matchesTech && matchesClient && matchesStatus && matchesCrop;
  });

  // Unique list of technicians for filter options
  const techniciansList = Array.from(new Set(visits.map(v => v.technicianName).filter(Boolean)));
  const cropsList = Array.from(new Set(visits.flatMap(v => (v.crops || []).map(c => c.name)).filter(Boolean)));

  // Selected client's properties helper
  const availableProperties = clients.find(c => c.id === clientId)?.properties || [];

  return (
    <div className="space-y-6">
      {/* Top Banner & Header */}
      <div className={PAGE_HEADER_CLASS} data-page-header>
        <PageTitle icon={PageIcon} title="Visitas de Campo" subtitle="Registro das visitas técnicas, culturas, fotos e recomendações" />

        <div className="flex flex-wrap gap-2 w-full sm:w-auto">
          <button
            onClick={handleExportCSV}
            className="flex-1 sm:flex-initial flex items-center justify-center gap-2 px-4 py-2.5 glass text-slate-700 hover:bg-slate-50 text-sm font-bold rounded-xl"
          >
            <FileSpreadsheet className="w-4 h-4 text-emerald-600" /> Excel
          </button>

          <button
            onClick={handleDownloadVisitsConsolidated}
            className="flex-1 sm:flex-initial flex items-center justify-center gap-2 px-4 py-2.5 glass text-slate-700 hover:bg-slate-50 text-sm font-bold rounded-xl"
            title="Exportar PDF de Visitas"
          >
            <FileText className="w-4 h-4 text-emerald-600" /> PDF Geral
          </button>
          
          <button
            onClick={() => setIsNewModalOpen(true)}
            className="flex-1 sm:flex-initial flex items-center justify-center gap-2 px-5 py-2.5 bg-emerald-600 text-white hover:bg-emerald-700 text-sm font-bold rounded-xl transition-all shadow-md shadow-emerald-100 active:scale-95"
          >
            <Plus className="w-5 h-5" /> Nova Visita
          </button>
        </div>
      </div>

      {/* Offline Cache Notice Banner */}
      {isUsingCache && (
        <div className="bg-amber-50 border border-amber-200/80 p-3.5 rounded-2xl flex items-center justify-between text-amber-900 text-xs font-semibold shadow-xs">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 bg-amber-100/80 rounded-xl text-amber-700">
              <Database className="w-4 h-4" />
            </div>
            <span>
              Exibindo <strong>{visits.length} registros recentes</strong> recuperados do cache local <strong>IndexedDB</strong> (Sem conexão Firebase).
            </span>
          </div>
          <span className="text-[10px] uppercase tracking-wider bg-amber-200/60 px-2 py-0.5 rounded-full font-extrabold text-amber-800">
            Modo Offline
          </span>
        </div>
      )}

      {/* Filters Bar */}
      <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col md:flex-row gap-4 items-end">
        <div className="flex-1 space-y-1.5 w-full">
          <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider ml-1">Buscar por Produtor / Local</label>
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input 
              type="text"
              placeholder="Pesquise por cliente, propriedade, objetivo..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full glass-input pl-10"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 w-full md:w-auto md:min-w-[500px]">
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Técnico</label>
            <select
              value={selectedTechnician}
              onChange={(e) => setSelectedTechnician(e.target.value)}
              className="w-full glass-input text-xs h-10 py-1"
            >
              <option value="">Todos</option>
              {techniciansList.map(t => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Cultura</label>
            <select
              value={selectedCrop}
              onChange={(e) => setSelectedCrop(e.target.value)}
              className="w-full glass-input text-xs h-10 py-1"
            >
              <option value="">Todas</option>
              {cropsList.map(c => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Status Sync</label>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="w-full glass-input text-xs h-10 py-1"
            >
              <option value="">Todos</option>
              <option value="synced">Sincronizado</option>
              <option value="pending_sync">Aguardando Sync</option>
              <option value="draft">Rascunho</option>
            </select>
          </div>

          <div className="space-y-1.5">
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Produtor</label>
            <select
              value={selectedClientFilter}
              onChange={(e) => setSelectedClientFilter(e.target.value)}
              className="w-full glass-input text-xs h-10 py-1"
            >
              <option value="">Todos os Clientes</option>
              {clients.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Main Grid List */}
      {loading ? (
        <SkeletonList variant="cards" count={6} />
      ) : filteredVisits.length === 0 ? (
        <div className="bg-white p-12 text-center rounded-2xl border border-slate-200">
          <ClipboardList className="w-12 h-12 text-slate-300 mx-auto mb-4" />
          <h3 className="text-base font-bold text-slate-700">Nenhuma visita de campo encontrada</h3>
          <p className="text-xs text-slate-500 max-w-sm mx-auto mt-1">Insira uma visita manual usando o botão "Nova Visita" ou conecte o app móvel.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredVisits.map((visit) => {
            const status = syncBadge[visit.syncStatus] || syncBadge.draft;
            const bannerPhoto = visit.photos?.[0]?.url || 'https://images.unsplash.com/photo-1595974482597-4b8da8879bc5?auto=format&fit=crop&q=80&w=600';

            return (
              <motion.div
                key={visit.id}
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex flex-col hover:shadow-md transition-shadow group cursor-pointer"
                onClick={() => setSelectedVisit(visit)}
              >
                {/* Banner Capa */}
                <div className="h-44 w-full relative overflow-hidden bg-slate-100">
                  <img 
                    src={bannerPhoto} 
                    alt="Visita Técnica" 
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                    referrerPolicy="no-referrer"
                  />
                  
                  {/* Sync status badge */}
                  <span className={`absolute top-3 left-3 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider rounded-lg border shadow-sm ${status.color}`}>
                    {status.label}
                  </span>

                  {/* Device indicator badge */}
                  <span className="absolute top-3 right-3 bg-white/90 backdrop-blur-sm shadow-sm border border-slate-200 text-slate-700 px-2 py-1 rounded-lg text-[10px] flex items-center gap-1.5 font-bold uppercase tracking-wider">
                    {visit.createdByDevice === 'mobile' ? (
                      <>
                        <Tablet className="w-3.5 h-3.5 text-emerald-600" /> Mobile
                      </>
                    ) : (
                      <>
                        <Laptop className="w-3.5 h-3.5 text-slate-600" /> Web
                      </>
                    )}
                  </span>
                </div>

                {/* Content */}
                <div className="p-5 flex-1 flex flex-col justify-between">
                  <div>
                    <div className="flex items-center gap-2 text-xs text-slate-400 mb-1.5 font-bold font-mono">
                      <Calendar className="w-3.5 h-3.5 text-emerald-600" /> {formatDate(visit.visitDate)}
                    </div>
                    
                    <h3 className="font-display font-bold text-slate-800 text-lg leading-tight line-clamp-1">
                      {visit.propertyName}
                    </h3>
                    <p className="text-xs text-slate-500 font-semibold mb-3">Produtor: {visit.clientName}</p>

                    <p className="text-xs text-slate-600 line-clamp-2 italic mb-4">"{visit.objective}"</p>

                    {/* Crop Badges */}
                    <div className="flex flex-wrap gap-1.5 mb-4">
                      {(visit.crops || []).map((c, i) => (
                        <span key={i} className="px-2 py-0.5 bg-emerald-50 text-emerald-700 border border-emerald-100 rounded-md text-[10px] font-bold uppercase">
                          {c.name} ({c.stage})
                        </span>
                      ))}
                    </div>
                  </div>

                  <div className="pt-3 border-t border-slate-100 flex items-center justify-between">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <div className="w-6 h-6 rounded-full bg-slate-100 flex items-center justify-center text-slate-600 text-[10px] font-bold uppercase shrink-0">
                        {visit.technicianName?.[0]}
                      </div>
                      <span className="text-xs text-slate-500 font-medium truncate">Téc: {visit.technicianName}</span>
                    </div>

                    <div className="flex gap-1 shrink-0">
                      <button 
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedVisit(visit);
                        }}
                        className="p-1.5 hover:bg-slate-50 rounded-lg text-slate-500 hover:text-emerald-600 transition-all"
                        title="Ver detalhes"
                      >
                        <Eye className="w-4 h-4" />
                      </button>
                      
                      {PERMISSIONS.canDeleteVisit(((user?.effectiveRole ?? user?.role) as UserRole) || 'consultant', visit.syncStatus === 'synced' ? 'realizada' : 'agendada') && (
                        <button 
                          onClick={(e) => {
                            e.stopPropagation();
                            setIsDeleteModalOpen(visit.id);
                          }}
                          className="p-1.5 hover:bg-rose-50 rounded-lg text-slate-400 hover:text-rose-600 transition-all"
                          title="Excluir visita"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
      )}

      {/* View Detailed Modal */}
      <AnimatePresence>
        {selectedVisit && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-slate-900/80 backdrop-blur-md overflow-y-auto">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 15 }}
              className="bg-white rounded-3xl w-full max-w-4xl p-6 md:p-8 space-y-6 max-h-[90vh] overflow-y-auto relative text-slate-800"
            >
              {/* Close pin */}
              <button 
                onClick={() => setSelectedVisit(null)}
                className="absolute top-6 right-6 p-2 bg-slate-100 hover:bg-slate-200 rounded-full text-slate-500 transition-colors z-25"
              >
                <X className="w-5 h-5" />
              </button>

              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-100 pb-5">
                <div>
                  <div className="flex items-center gap-2 text-xs font-bold text-slate-400 uppercase font-mono mb-1">
                    <Calendar className="w-3.5 h-3.5 text-emerald-600" /> {formatDate(selectedVisit.visitDate)}
                    <span>•</span>
                    Técnico: {selectedVisit.technicianName}
                  </div>
                  <h2 className="text-2xl font-display font-bold text-slate-800 leading-none">{selectedVisit.propertyName}</h2>
                  <p className="text-sm text-slate-500 mt-1">Produtor: {selectedVisit.clientName}</p>
                </div>

                <div className="flex flex-wrap gap-2 md:mt-0">
                  <button
                    onClick={() => handleGeneratePDF(selectedVisit)}
                    className="flex items-center justify-center gap-2 px-4 py-2 bg-emerald-600 text-white hover:bg-emerald-700 text-xs font-bold rounded-xl transition-all shadow-md shadow-emerald-100"
                  >
                    <FileText className="w-4 h-4" /> Relatório PDF
                  </button>

                  {selectedVisit.linkedAppointmentId && (
                    <button
                      onClick={() => { setSelectedVisit(null); navigate('/scheduling'); }}
                      className="px-3 py-1.5 text-xs font-bold rounded-xl border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 flex items-center gap-1.5"
                      title="Esta visita foi registrada a partir de um agendamento"
                    >
                      <CalendarCheck className="w-3.5 h-3.5" /> Veio da Agenda
                    </button>
                  )}
                  <span className={`px-3 py-1.5 text-xs font-bold uppercase rounded-xl border flex items-center gap-1.5 ${syncBadge[selectedVisit.syncStatus]?.color}`}>
                    <Activity className="w-3.5 h-3.5" /> {syncBadge[selectedVisit.syncStatus]?.label}
                  </span>
                </div>
              </div>

              {/* Details grid layout */}
              <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
                
                {/* Information Columns */}
                <div className="md:col-span-7 space-y-6">
                  
                  {/* Objective */}
                  <div className="space-y-1.5">
                    <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Objetivo Técnico da Visita</h4>
                    <p className="text-sm text-slate-700 bg-slate-50 p-4 rounded-xl border border-slate-200 leading-relaxed italic font-medium">"{selectedVisit.objective}"</p>
                  </div>

                  {/* Crops being targeted */}
                  <div className="space-y-2">
                    <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Culturas Inspecionadas</h4>
                    <div className="space-y-3">
                      {(selectedVisit.crops || []).map((c, i) => (
                        <div key={i} className="p-4 border border-slate-200 rounded-xl space-y-2 bg-slate-50/50">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-bold text-emerald-800 bg-emerald-50 px-3 py-1 rounded-lg uppercase tracking-wider">{c.name}</span>
                            <span className="text-xs font-bold text-slate-500">Estágio: {c.stage}</span>
                          </div>
                          <div className="grid grid-cols-2 gap-4 text-xs">
                            <div>
                              <span className="text-[10px] font-bold uppercase block text-slate-400">Área Estimada</span>
                              <span className="font-semibold text-slate-700">{c.estimatedArea} Hectares</span>
                            </div>
                            <div>
                              <span className="text-[10px] font-bold uppercase block text-slate-400">Observações Locais</span>
                              <span className="text-slate-600">{c.observations || 'Nenhuma'}</span>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Recommendations */}
                  <div className="space-y-1.5">
                    <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Recomendações e Parecer Técnico</h4>
                    <p className="text-sm text-slate-700 bg-slate-50/30 p-4 rounded-xl border border-slate-100 whitespace-pre-line leading-relaxed">{selectedVisit.recommendations || 'Sem recomendações descritas.'}</p>
                  </div>

                  {/* General Observations */}
                  <div className="space-y-1.5">
                    <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Observações do Técnico</h4>
                    <p className="text-sm text-slate-600 leading-relaxed whitespace-pre-line bg-slate-50 p-4 rounded-xl border border-slate-150">{selectedVisit.generalObservations || 'Sem observações.'}</p>
                  </div>

                  {/* Key Planning Dates */}
                  <div className="grid grid-cols-2 gap-4 bg-slate-50 p-4 rounded-xl border border-slate-200">
                    <div>
                      <span className="text-[10px] font-bold text-slate-400 uppercase block">Origem do Cadastro</span>
                      <span className="text-xs font-bold text-slate-700 uppercase flex items-center gap-1.5 mt-1">
                        {selectedVisit.createdByDevice === 'mobile' ? 'Aplicativo Mobile' : 'Portal Web Executivo'}
                      </span>
                    </div>
                    {selectedVisit.nextVisitDate && (
                      <div>
                        <span className="text-[10px] font-bold text-slate-400 uppercase block">Proposta Próxima Visita</span>
                        <span className="text-xs font-bold text-emerald-700 flex items-center gap-1.5 mt-1">
                          <Calendar className="w-3.5 h-3.5" /> {formatDate(selectedVisit.nextVisitDate)}
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Imagery & Geo-Location */}
                <div className="md:col-span-5 space-y-6">
                  
                  {/* Photo attachments */}
                  <div className="space-y-2">
                    <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Galeria de Fotos ({selectedVisit.photos?.length || 0})</h4>
                    {selectedVisit.photos && selectedVisit.photos.length > 0 ? (
                      <div className="grid grid-cols-2 gap-3">
                        {selectedVisit.photos.map((photo, i) => (
                          <div key={photo.id || i} className="bg-slate-50 border border-slate-200 rounded-xl overflow-hidden shadow-sm">
                            <StoredImage 
                              src={photo.url} 
                              alt={photo.caption || 'Foto Técnica'} 
                              className="w-full h-28 object-cover hover:scale-105 transition-transform"
                              referrerPolicy="no-referrer"
                            />
                            {photo.caption && (
                              <p className="p-2 text-[10px] text-slate-500 leading-tight border-t border-slate-100 truncate">{photo.caption}</p>
                            )}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="border border-dashed border-slate-200 text-slate-400 p-8 rounded-xl text-center text-xs">
                        Sem fotos registradas para esta visita.
                      </div>
                    )}
                  </div>

                  {/* Leaflet GPS Map Container */}
                  <div className="space-y-2 font-sans">
                    <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Localização GPS da Visita</h4>
                    {selectedVisit.latitude && selectedVisit.longitude ? (
                      <div className="rounded-2xl border border-slate-200 overflow-hidden relative shadow-inner z-0">
                        <MapContainer 
                          center={[selectedVisit.latitude, selectedVisit.longitude]} 
                          zoom={13} 
                          scrollWheelZoom={false}
                          style={{ height: '240px', width: '100%', outline: 'none' }}
                        >
                          <TileLayer
                            attribution='&copy; <a href="https://openstreetmap.org">OpenStreetMap</a>'
                            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                          />
                          <Marker position={[selectedVisit.latitude, selectedVisit.longitude]}>
                            <Popup>
                              Ponto registrado no GPS <br /> Precisão aproximada: {selectedVisit.accuracyMeters || 5}m
                            </Popup>
                          </Marker>
                        </MapContainer>
                        <div className="p-2.5 bg-slate-50 border-t border-slate-200 flex items-center justify-between text-[10px] text-slate-500">
                          <span>Lat: {selectedVisit.latitude.toFixed(6)} / Lng: {selectedVisit.longitude.toFixed(6)}</span>
                          <span className="font-bold text-emerald-700">Garantia GPS ✓</span>
                        </div>
                      </div>
                    ) : (
                      <div className="border border-dashed border-slate-200 text-slate-400 p-8 rounded-xl text-center text-xs space-y-1">
                        <MapPin className="w-6 h-6 mx-auto opacity-30" />
                        <p>Visita sem coordenadas de posicionamento de campo.</p>
                      </div>
                    )}
                  </div>

                  {/* Add Extra Observation Form for Consultant / Managers */}
                  <div className="p-4 bg-emerald-50/50 rounded-2xl border border-emerald-100 space-y-3">
                    <h4 className="text-xs font-bold text-emerald-900 uppercase tracking-wide flex items-center gap-2">
                      <PlusCircle className="w-4 h-4 text-emerald-600" /> Adicionar Observação de Campo
                    </h4>
                    <textarea 
                      rows={3}
                      value={extraObservation}
                      onChange={(e) => setExtraObservation(e.target.value)}
                      placeholder="Escreva novas observações técnicas ou atualizações sobre a cultura..."
                      className="w-full text-xs p-3 bg-white rounded-xl border border-emerald-200 focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                    />
                    <button
                      type="button"
                      disabled={isAddingObservation || !extraObservation.trim()}
                      onClick={() => runExclusive('FieldVisits.handleAddExtraObservation', () => handleAddExtraObservation())}
                      className="w-full py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-xl text-xs font-bold transition-all shadow-xs"
                    >
                      {isAddingObservation ? 'Salvando...' : 'Salvar Observação'}
                    </button>
                  </div>

                </div>
              </div>

              {/* Audit Trail for Admin */}
              {(user?.effectiveRole ?? user?.role) === 'admin' && (
                <div className="pt-4 border-t border-slate-100">
                  <AuditTrail collectionName="field_visits" recordId={selectedVisit.id} />
                </div>
              )}
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Write New / Manual Visit Multi-Step Wizard Modal */}
      <AnimatePresence>
        {isNewModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/80 backdrop-blur-md overflow-y-auto">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 15 }}
              className="bg-white rounded-3xl w-full max-w-2xl p-6 md:p-8 space-y-6 max-h-[92vh] overflow-y-auto relative text-slate-800"
            >
              {/* Header Title */}
              <div className="flex items-center justify-between border-b border-slate-100 pb-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-emerald-50 text-emerald-600 rounded-lg flex items-center justify-center">
                    <ClipboardList className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-xl font-display font-bold text-slate-800">Novo Registro de Visita</h3>
                    <p className="text-xs text-slate-500">Passo {currentStep} de 5 — Progresso: {Math.round((currentStep / 5) * 100)}%</p>
                  </div>
                </div>
                <button 
                  onClick={() => {
                    setIsNewModalOpen(false);
                    resetForm();
                  }}
                  className="p-1.5 hover:bg-slate-100 rounded-full text-slate-400"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Steps Progress Visual Bullet-line */}
              <div className="flex items-center gap-2 px-1">
                {[1, 2, 3, 4, 5].map(step => (
                  <div 
                    key={step} 
                    className={`flex-1 h-1.5 rounded-full transition-all duration-300 ${
                      step === currentStep 
                        ? 'bg-emerald-600' 
                        : step < currentStep 
                        ? 'bg-emerald-300' 
                        : 'bg-slate-200'
                    }`} 
                  />
                ))}
              </div>

              {/* Wizard screens switch */}
              <div className="py-2">
                
                {/* STEP 1 — Identificação */}
                {currentStep === 1 && (
                  <div className="space-y-4 animate-fadeIn">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="space-y-1.5">
                        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider ml-1">Produtor / Cliente</label>
                        <select
                          value={clientId}
                          onChange={(e) => {
                            setClientId(e.target.value);
                            setPropertyName('');
                          }}
                          className="w-full glass-input"
                          required
                        >
                          <option value="">Selecione o Produtor</option>
                          {clients.map(c => (
                            <option key={c.id} value={c.id}>{c.name}</option>
                          ))}
                        </select>
                      </div>

                      <div className="space-y-1.5">
                        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider ml-1">Propriedade Rural</label>
                        <select
                          value={propertyName}
                          onChange={(e) => setPropertyName(e.target.value)}
                          className="w-full glass-input"
                          disabled={!clientId}
                        >
                          <option value="">Selecione a Propriedade</option>
                          {availableProperties.map((p, idx) => (
                            <option key={idx} value={p.name}>{p.name}{p.areaHectares ? ` (${p.areaHectares} ha)` : ''}</option>
                          ))}
                        </select>
                        {!clientId && <p className="text-[10px] text-slate-400">Selecione o Produtor primeiro</p>}
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="space-y-1.5">
                        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider ml-1">Data da Inspeção</label>
                        <input 
                          type="date"
                          value={visitDate}
                          onChange={(e) => setVisitDate(e.target.value)}
                          className="w-full glass-input"
                        />
                      </div>

                      <div className="space-y-1.5">
                        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider ml-1">Técnico Agrônomo</label>
                        <input 
                          type="text"
                          value={technicianName}
                          onChange={(e) => setTechnicianName(e.target.value)}
                          className="w-full glass-input"
                          placeholder="Nome do técnico"
                        />
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider ml-1">Objetivo Técnico da Visita</label>
                      <input 
                        type="text"
                        value={objective}
                        onChange={(e) => setObjective(e.target.value)}
                        className="w-full glass-input"
                        placeholder="Ex: Análise de maturação da soja, controle de pragas, calibração de pulverizador..."
                        required
                      />
                    </div>
                  </div>
                )}

                {/* STEP 2 — Culturas */}
                {currentStep === 2 && (
                  <div className="space-y-4 animate-fadeIn">
                    <div className="flex justify-between items-center mb-2">
                      <h4 className="text-xs font-bold text-slate-500 uppercase">Culturas Monitoradas</h4>
                      <button
                        type="button"
                        onClick={handleAddCrop}
                        className="text-xs text-emerald-600 hover:text-emerald-700 font-bold flex items-center gap-1 bg-emerald-50 px-2 py-1 rounded-lg border border-emerald-100"
                      >
                        <PlusCircle className="w-3.5 h-3.5" /> Adicionar Linha
                      </button>
                    </div>

                    <div className="space-y-4 max-h-72 overflow-y-auto pr-1">
                      {crops.map((crop, idx) => (
                        <div key={idx} className="p-4 border border-slate-200 rounded-2xl bg-slate-50 relative space-y-3">
                          {crops.length > 1 && (
                            <button
                              type="button"
                              onClick={() => handleRemoveCrop(idx)}
                              className="absolute top-3 right-3 text-slate-400 hover:text-rose-500 transition-colors"
                            >
                              <MinusCircle className="w-4 h-4" />
                            </button>
                          )}

                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                            <div className="space-y-1">
                              <label className="text-[10px] font-bold text-slate-400 uppercase">Nome Cultura</label>
                              <input 
                                type="text"
                                value={crop.name}
                                onChange={(e) => handleCropChange(idx, 'name', e.target.value)}
                                className="w-full glass-input text-xs"
                                placeholder="Ex: Milho, Café, Soja..."
                              />
                            </div>
                            <div className="space-y-1">
                              <label className="text-[10px] font-bold text-slate-400 uppercase">Estágio Fenológico</label>
                              <input 
                                type="text"
                                value={crop.stage}
                                onChange={(e) => handleCropChange(idx, 'stage', e.target.value)}
                                className="w-full glass-input text-xs"
                                placeholder="Ex: R1, V4, Crescimento..."
                              />
                            </div>
                            <div className="space-y-1">
                              <label className="text-[10px] font-bold text-slate-400 uppercase">Área Estimada (ha)</label>
                              <input 
                                type="number"
                                value={crop.estimatedArea || ''}
                                onChange={(e) => handleCropChange(idx, 'estimatedArea', parseFloat(e.target.value) || 0)}
                                className="w-full glass-input text-xs"
                                placeholder="Hectares"
                              />
                            </div>
                          </div>

                          <div className="space-y-1">
                            <label className="text-[10px] font-bold text-slate-400 uppercase">Observações da Cultura</label>
                            <input 
                              type="text"
                              value={crop.observations}
                              onChange={(e) => handleCropChange(idx, 'observations', e.target.value)}
                              className="w-full glass-input text-xs"
                              placeholder="Ex: Amarelecimento de folhas basais, pouca infestação de percevejo..."
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* STEP 3 — Observações & Recomendações */}
                {currentStep === 3 && (
                  <div className="space-y-4 animate-fadeIn">
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider ml-1">
                          Diagnóstico e Recomendações Técnicas *
                        </label>
                        <button
                          type="button"
                          onClick={() => handleStartDictation('recommendations')}
                          className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase transition-all shadow-xs ${
                            isRecordingDictation && dictationTarget === 'recommendations'
                              ? 'bg-rose-500 text-white animate-pulse'
                              : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200'
                          }`}
                          title="Ditar recomendação técnica usando microfone"
                        >
                          {isRecordingDictation && dictationTarget === 'recommendations' ? (
                            <>
                              <MicOff className="w-3 h-3" /> Gravando...
                            </>
                          ) : (
                            <>
                              <Mic className="w-3 h-3 text-emerald-600" /> Ditar por Voz
                            </>
                          )}
                        </button>
                      </div>

                      {/* Modelos de Prescrição Rápida */}
                      <div className="p-3 bg-emerald-50/60 border border-emerald-100 rounded-2xl space-y-2">
                        <div className="flex items-center gap-1.5 text-[10px] font-bold text-emerald-800 uppercase tracking-wider">
                          <BookmarkPlus className="w-3.5 h-3.5 text-emerald-600" />
                          <span>Modelos de Prescrição Rápida (1 Clique)</span>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {QUICK_PRESCRIPTIONS.map((qp, qidx) => (
                            <button
                              key={qidx}
                              type="button"
                              onClick={() => applyPrescription(qp.text)}
                              className="px-2 py-1 bg-white hover:bg-emerald-100 border border-emerald-200 text-emerald-900 rounded-lg text-[10px] font-medium transition-colors shadow-2xs text-left"
                            >
                              + {qp.title}
                            </button>
                          ))}
                        </div>
                      </div>

                      <textarea
                        rows={4}
                        value={recommendations}
                        onChange={(e) => setRecommendations(e.target.value)}
                        className="w-full glass-input py-3"
                        placeholder="Quais as soluções ou ações recomendadas para o produtor? Ex: Aplicar fungicida foliar X na dosagem Y, regular taxa de vazão do pivô..."
                        required
                      />
                    </div>

                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider ml-1">Observações Gerais</label>
                        <button
                          type="button"
                          onClick={() => handleStartDictation('generalObservations')}
                          className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase transition-all shadow-xs ${
                            isRecordingDictation && dictationTarget === 'generalObservations'
                              ? 'bg-rose-500 text-white animate-pulse'
                              : 'bg-slate-100 text-slate-700 hover:bg-slate-200 border border-slate-200'
                          }`}
                        >
                          {isRecordingDictation && dictationTarget === 'generalObservations' ? (
                            <>
                              <MicOff className="w-3 h-3" /> Gravando...
                            </>
                          ) : (
                            <>
                              <Mic className="w-3 h-3 text-slate-600" /> Ditar por Voz
                            </>
                          )}
                        </button>
                      </div>
                      <textarea
                        rows={3}
                        value={generalObservations}
                        onChange={(e) => setGeneralObservations(e.target.value)}
                        className="w-full glass-input py-3"
                        placeholder="Clima no dia, condições gerais da propriedade, histórico da fazenda que possa ser relevante..."
                      />
                    </div>
                  </div>
                )}

                {/* STEP 4 — Upload de fotos */}
                {currentStep === 4 && (
                  <div className="space-y-4 animate-fadeIn">
                    <div className="border-2 border-dashed border-slate-200 hover:border-emerald-400 rounded-3xl p-6 text-center cursor-pointer transition-colors relative bg-slate-50/50">
                      <input 
                        type="file"
                        accept="image/*"
                        multiple
                        onChange={handlePhotoSelect}
                        className="absolute inset-0 opacity-0 cursor-pointer"
                      />
                      <CloudUpload className="w-10 h-10 text-slate-400 mx-auto mb-2" />
                      <p className="text-xs font-bold text-slate-600">Arraste fotos ou clique para selecionar</p>
                      <p className="text-[10px] text-slate-400 mt-1">Imagens JPG, PNG ou WEBP do monitoramento de campo</p>
                    </div>

                    {photoFiles.length > 0 && (
                      <div className="space-y-3 max-h-60 overflow-y-auto pr-1 mt-4">
                        <h5 className="text-[10px] font-bold text-slate-400 uppercase">Lista de Anexos ({photoFiles.length})</h5>
                        {photoFiles.map((pf, idx) => (
                          <div key={idx} className="flex gap-4 p-3 bg-slate-50 border border-slate-200 rounded-2xl items-center relative">
                            <img src={pf.preview} alt="Preview" className="w-16 h-16 object-cover rounded-xl border" />
                            <div className="flex-1 min-w-0 space-y-1">
                              <p className="text-xs font-mono text-slate-400 truncate">{pf.file.name}</p>
                              <input 
                                type="text"
                                placeholder="Legenda da imagem..."
                                value={pf.caption}
                                onChange={(e) => handlePhotoCaptionChange(idx, e.target.value)}
                                className="w-full glass-input text-xs h-8 py-1 px-2.5"
                              />
                            </div>
                            <button
                              type="button"
                              onClick={() => handleRemovePhoto(idx)}
                              className="text-slate-400 hover:text-rose-500 shrink-0 p-1.5"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* STEP 5 — Vinculação */}
                {currentStep === 5 && (
                  <div className="space-y-4 animate-fadeIn">
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider ml-1">Análise / Serviço Vinculado (Opcional)</label>
                      <select
                        value={linkedServiceId}
                        onChange={(e) => setLinkedServiceId(e.target.value)}
                        className="w-full glass-input"
                      >
                        <option value="">Nenhum Serviço Relacionado</option>
                        {analyses.filter(a => a.clientId === clientId).map(a => (
                          <option key={a.id} value={a.id}>{a.propertyName || 'Propriedade'} - {(a.type || '').toUpperCase()} ({a.status})</option>
                        ))}
                      </select>
                      <p className="text-[10px] text-slate-400">Vincula o relatório desta visita técnica a um fluxo de análise de solo, irrigação etc.</p>
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider ml-1">Agendar Próxima Visita de Retorno (Planejado)</label>
                      <input 
                        type="date"
                        value={nextVisitDate}
                        onChange={(e) => setNextVisitDate(e.target.value)}
                        className="w-full glass-input"
                      />
                    </div>

                    <div className="p-4 bg-emerald-50 border border-emerald-150 rounded-2xl flex gap-3.5 mt-2">
                      <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
                      <div>
                        <h5 className="text-xs font-bold text-emerald-800 uppercase">Tudo certo!</h5>
                        <p className="text-xs text-emerald-700 leading-relaxed mt-0.5">As informações estão preenchidas. Ao clicar em "Concluir e Salvar", o documento será gerado e os anexos salvos em segurança.</p>
                      </div>
                    </div>
                  </div>
                )}

              </div>

              {/* Wizard Nav Actions */}
              <div className="flex gap-3 justify-between border-t border-slate-100 pt-5">
                <button
                  type="button"
                  onClick={() => setCurrentStep(prev => prev - 1)}
                  disabled={currentStep === 1 || saving}
                  className="px-4 py-2.5 glass text-slate-500 rounded-xl font-bold text-xs uppercase hover:bg-slate-50 disabled:opacity-50 transition-all flex items-center gap-1.5"
                >
                  <ArrowLeft className="w-4 h-4" /> Voltar
                </button>

                {currentStep < 5 ? (
                  <button
                    type="button"
                    onClick={() => setCurrentStep(prev => prev + 1)}
                    className="px-5 py-2.5 bg-emerald-600 text-white rounded-xl font-bold text-xs uppercase hover:bg-emerald-700 transition-all flex items-center gap-1.5 shadow-md active:scale-95"
                  >
                    Próximo <ArrowRight className="w-4 h-4" />
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => runExclusive('FieldVisits.handleSaveVisit', () => handleSaveVisit())}
                    disabled={saving}
                    className="px-6 py-2.5 bg-emerald-600 text-white rounded-xl font-bold text-xs uppercase hover:bg-emerald-700 transition-all flex items-center gap-1.5 shadow-md shadow-emerald-200 active:scale-95 disabled:opacity-70"
                  >
                    {saving ? 'Gravando...' : 'Concluir e Salvar'} <CheckCircle2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Delete Confirmation Modal */}
      <ConfirmationModal 
        isOpen={isDeleteModalOpen !== null}
        onClose={() => setIsDeleteModalOpen(null)}
        onConfirm={() => isDeleteModalOpen && handleDeleteVisit(isDeleteModalOpen)}
        title="Excluir Visita?"
        description="Esta ação removerá permanentemente o relatório da visita e suas fotos. Não é possível reverter."
        confirmLabel="Sim, Excluir"
        cancelLabel="Cancelar"
      />
    </div>
  );
}
