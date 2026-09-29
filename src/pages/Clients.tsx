import React, { useState, useEffect } from 'react';
import { runExclusive } from '../lib/submitGuard';
import { useConfirm } from '../hooks/useConfirm';
import { useSubmitGuard } from '../hooks/useSubmitGuard';
import { 
  Plus, 
  Search, 
  Trash2, 
  Edit2, 
  MapPin, 
  Mail,
  User,
  X,
  ChevronRight,
  ChevronLeft,
  Check,
  LandPlot,
  Building2,
  FileBadge,
  ClipboardList,
  DollarSign,
  FileText,
  Calendar,
  TrendingUp,
  RefreshCw,
  Upload,
  Download,
  Loader2,
  Paperclip,
  ShieldCheck,
  FolderOpen,
  MessageSquare,
  Send
} from 'lucide-react';
import { collection, addDoc, onSnapshot, query, deleteDoc, doc, updateDoc, serverTimestamp, where, setDoc, getDocs } from 'firebase/firestore';
import { saveFile, deleteStoredFile, handleFileLinkClick, uploadErrorMessage, FileTooLargeError, isTooLargeToSave } from '../lib/fileStore';
import { db, auth, hasValidConfig } from '../lib/firebase';
import { useAuth } from '../contexts/AuthContext';
import { Client, Property } from '../types';
import { logAudit } from '../lib/audit';
import { PERMISSIONS, UserRole } from '../lib/permissions';
import { createNotification } from '../lib/notifications';
import { motion, AnimatePresence } from 'motion/react';
import { PageTitle, PAGE_HEADER_CLASS } from '../components/layout/PageHeader';
import { Users as PageIcon } from 'lucide-react';
import { CalendarClock } from 'lucide-react';
import { handleFirestoreError, OperationType, cn, validateCPF, validateEmail, formatPhone, formatCPF, formatDate, todayLocalDateString } from '../lib/utils';
import { toast } from 'sonner';
import ConfirmationModal from '../components/ConfirmationModal';
import AuditTrail from '../components/AuditTrail';
import { useInitialSearch } from '../hooks/useInitialSearch';
import ExportExcelButton from '../components/service/ExportExcelButton';

type FormStep = 'personal' | 'address' | 'documents' | 'review';

// Documentos do dossiê do produtor: uma única fonte pra chave, rótulo e categoria
// (usado tanto na tela de upload quanto na contagem da revisão, pra não desalinhar).
const DOSSIE_DOC_ITEMS = [
  { key: 'rg', label: 'Identidade (RG)', req: false, category: 'RG / Identidade' },
  { key: 'cpfDoc', label: 'CPF', req: false, category: 'CPF' },
  { key: 'car', label: 'CAR (Cadastro Ambiental Rural)', req: false, category: 'CAR (Cadastro Ambiental Rural)' },
  { key: 'environmental', label: 'Regularização Ambiental', req: false, category: 'Regularização Ambiental' },
  { key: 'marriageCert', label: 'Certidão de Casamento', req: false, category: 'Certidão de Casamento' },
  { key: 'spouseDoc', label: 'Documentos do Cônjuge', req: false, category: 'Documento do Cônjuge' },
  { key: 'landDoc', label: 'Documento de Terra (Escritura, ITBI ou Posse)', req: false, category: 'Documento de Terra' },
];

function getClientCode(client: Client): string {
  if (client.clientCode) return client.clientCode;
  let hash = 0;
  for (let i = 0; i < client.id.length; i++) {
    hash = client.id.charCodeAt(i) + ((hash << 5) - hash);
  }
  const code = Math.abs(hash % 900000) + 100000;
  return code.toString();
}

export default function Clients() {
  const { user } = useAuth();
  const [confirmAction, confirmModal] = useConfirm();
  const [isSubmittingClient, guardSubmit] = useSubmitGuard();
  const [clients, setClients] = useState<Client[]>([]);
  
  // Registration type and dossier documents states
  const [regType, setRegType] = useState<'simplified' | 'complete'>('complete');
  const [tempFiles, setTempFiles] = useState<{ [key: string]: File | null }>({});
  const [isUploadingDoc, setIsUploadingDoc] = useState<string | null>(null);
  const [clientDocs, setClientDocs] = useState<any[]>([]);
  const [detailClientDocs, setDetailClientDocs] = useState<any[]>([]);
  const [clientVisits, setClientVisits] = useState<any[]>([]);

  // Active search and filtering states
  const [searchInput, setSearchInput] = useState('');
  const [confirmedSearchTerm, setConfirmedSearchTerm] = useState('');
  // Termo vindo da Busca Global: preenche o campo e já pesquisa
  useInitialSearch((term) => { setSearchInput(term); setConfirmedSearchTerm(term); });
  const [hasSearched, setHasSearched] = useState(false);
  const [sortBy, setSortBy] = useState<'name-asc' | 'name-desc' | 'created-desc' | 'created-asc'>('name-asc');
  const [filterGroup, setFilterGroup] = useState<'all' | 'pronaf' | 'rural_producer'>('all');
  const [filterCity, setFilterCity] = useState<string>('all');

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingClientId, setEditingClientId] = useState<string | null>(null);
  const [currentStep, setCurrentStep] = useState<FormStep>('personal');
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState<string | null>(null);
  
  const [formData, setFormData] = useState({
    name: '',
    cpf: '',
    ownerEmail: '',
    phone: '',
    address: {
      cep: '',
      street: '',
      number: '',
      noNumber: false,
      neighborhood: '',
      noNeighborhood: false,
      city: '',
      state: ''
    },
    properties: [] as Property[],
    clientType: 'rural_producer' as 'pronaf' | 'rural_producer'
  });

  const [errors, setErrors] = useState({
    cpf: false,
    email: false,
    phone: false
  });

  const [currentProperty, setCurrentProperty] = useState<Property>({
    name: '',
    cep: '',
    street: '',
    number: '',
    noNumber: false,
    neighborhood: '',
    noNeighborhood: false,
    city: '',
    state: ''
  });

  const [showAddPropertyForm, setShowAddPropertyForm] = useState(false);
  const [isRenewalModalOpen, setIsRenewalModalOpen] = useState(false);
  const [renewalClient, setRenewalClient] = useState<Client | null>(null);
  const [renewalData, setRenewalData] = useState({
    ownerEmail: '',
    phone: '',
    address: {
      cep: '',
      street: '',
      number: '',
      neighborhood: '',
      city: '',
      state: ''
    }
  });

  const [renewalErrors, setRenewalErrors] = useState({
    email: false,
    phone: false
  });

  const getRegistrationStatus = (expiredAtStr?: string) => {
    if (!expiredAtStr) return { status: 'regular', daysLeft: 365, label: 'Faltam 365 dias' };
    // "YYYY-MM-DD" puro vira meia-noite UTC se passado direto pro Date() — no Brasil
    // (UTC-3) isso volta pro dia anterior. Ancorando em T00:00:00 evita o vencimento
    // aparecer 1 dia adiantado (mesmo bug já corrigido em lib/utils.ts/parseDateInput).
    const expiredDate = /^\d{4}-\d{2}-\d{2}$/.test(expiredAtStr) ? new Date(expiredAtStr + 'T00:00:00') : new Date(expiredAtStr);
    const today = new Date();
    
    // Zera horas para comparação puramente de data
    expiredDate.setHours(0, 0, 0, 0);
    today.setHours(0, 0, 0, 0);
    
    const diffTime = expiredDate.getTime() - today.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    
    if (diffDays < 0) {
      return { 
        status: 'expired', 
        daysLeft: diffDays, 
        label: `Vencido há ${Math.abs(diffDays)} ${Math.abs(diffDays) === 1 ? 'dia' : 'dias'}` 
      };
    } else if (diffDays <= 30) {
      return { 
        status: 'warning', 
        daysLeft: diffDays, 
        label: `Vence em ${diffDays} ${diffDays === 1 ? 'dia' : 'dias'}` 
      };
    } else {
      return { 
        status: 'regular', 
        daysLeft: diffDays, 
        label: `Válido (${diffDays} dias restantes)` 
      };
    }
  };

  const openRenewalModal = (client: Client) => {
    setRenewalClient(client);
    setRenewalData({
      ownerEmail: client.ownerEmail || '',
      phone: client.phone || '',
      address: {
        cep: client.address?.cep || '',
        street: client.address?.street || '',
        number: client.address?.number || '',
        neighborhood: client.address?.neighborhood || '',
        city: client.address?.city || '',
        state: client.address?.state || ''
      }
    });
    setRenewalErrors({ email: false, phone: false });
    setIsRenewalModalOpen(true);
  };

  const [userServicesClientIds, setUserServicesClientIds] = useState<Set<string>>(new Set());
  const [clientsWithActiveServices, setClientsWithActiveServices] = useState<Set<string>>(new Set());

  useEffect(() => {
    const q = query(collection(db, 'clients'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setClients(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Client)));
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'clients');
    });
    return () => unsubscribe();
  }, []);

  // Track which clients have services created by current user and which have any active services
  useEffect(() => {
    const unsubscribes: (() => void)[] = [];
    const activeClients = new Set<string>();
    const userClients = new Set<string>();

    const unsubVisits = onSnapshot(query(collection(db, 'field_visits')), (snap) => {
      snap.docs.forEach(d => {
        const data = d.data();
        if (data.clientId) {
          activeClients.add(data.clientId);
          if (data.createdBy === user?.uid || data.technicianId === user?.uid || data.technicianName === user?.displayName) {
            userClients.add(data.clientId);
          }
        }
      });
      setUserServicesClientIds(new Set(userClients));
      setClientsWithActiveServices(new Set(activeClients));
    }, () => {});
    unsubscribes.push(unsubVisits);

    const unsubAnalyses = onSnapshot(query(collection(db, 'analyses')), (snap) => {
      snap.docs.forEach(d => {
        const data = d.data();
        if (data.clientId) {
          activeClients.add(data.clientId);
          if (data.createdBy === user?.uid || data.responsibleTechnician === user?.displayName) {
            userClients.add(data.clientId);
          }
        }
      });
      setUserServicesClientIds(new Set(userClients));
      setClientsWithActiveServices(new Set(activeClients));
    }, () => {});
    unsubscribes.push(unsubAnalyses);

    return () => {
      unsubscribes.forEach(unsub => unsub());
    };
  }, [user]);

  // Load documents for currently edited client inside the modal
  useEffect(() => {
    if (!editingClientId) {
      setClientDocs([]);
      return;
    }
    const q = query(
      collection(db, 'documents'), 
      where('clientId', '==', editingClientId)
    );
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setClientDocs(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    }, (error) => {
      console.error("Erro ao carregar documentos do cliente no modal:", error);
    });
    return () => unsubscribe();
  }, [editingClientId]);

  // Histórico de visitas de campo do cliente sendo editado — entra como parte
  // do dossiê, junto com os documentos, pra dar visão completa do produtor.
  useEffect(() => {
    if (!editingClientId) {
      setClientVisits([]);
      return;
    }
    const q = query(
      collection(db, 'field_visits'),
      where('clientId', '==', editingClientId)
    );
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const list = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as any));
      list.sort((a, b) => (b.visitDate || '').localeCompare(a.visitDate || ''));
      setClientVisits(list);
    }, (error) => {
      console.error("Erro ao carregar histórico de visitas do cliente:", error);
    });
    return () => unsubscribe();
  }, [editingClientId]);

  const handleCEPBlur = async () => {
    const cep = formData.address.cep.replace(/\D/g, '');
    if (cep.length !== 8) return;

    try {
      const response = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
      const data = await response.json();
      if (!data.erro) {
        setFormData({
          ...formData,
          address: {
            ...formData.address,
            street: data.logradouro,
            neighborhood: data.bairro,
            city: data.localidade,
            state: data.uf
          }
        });
      }
    } catch (error) {
      console.error("Erro ao buscar CEP:", error);
    }
  };

  const handlePropertyCEPBlur = async () => {
    const cep = currentProperty.cep.replace(/\D/g, '');
    if (cep.length !== 8) return;

    try {
      const response = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
      const data = await response.json();
      if (!data.erro) {
        setCurrentProperty(prev => ({
          ...prev,
          street: data.logradouro || '',
          neighborhood: data.bairro || '',
          city: data.localidade || '',
          state: data.uf || ''
        }));
      }
    } catch (error) {
      console.error("Erro ao buscar CEP da propriedade:", error);
    }
  };

  const addProperty = () => {
    if (!(currentProperty.street || '').trim()) {
      toast.error('O nome da rua, fazenda ou assentamento é obrigatório.');
      return;
    }
    setFormData({
      ...formData,
      properties: [...formData.properties, {
        ...currentProperty,
        name: currentProperty.street
      }]
    });
    setCurrentProperty({
      name: '',
      cep: '',
      street: '',
      number: '',
      noNumber: false,
      neighborhood: '',
      noNeighborhood: false,
      city: '',
      state: ''
    });
    setShowAddPropertyForm(false);
  };

  const removeProperty = (index: number) => {
    setFormData({
      ...formData,
      properties: formData.properties.filter((_, i) => i !== index)
    });
  };

  const handleAddClient = async () => {
    if (!user) {
      toast.error('Você precisa estar autenticado para realizar esta ação.');
      return;
    }

    if (!(formData.name || '').trim()) {
      toast.error('O nome do produtor é obrigatório.');
      return;
    }

    // CPF é obrigatório nos dois tipos de cadastro (evita produtor duplicado)
    if (!formData.cpf || !validateCPF(formData.cpf)) {
      toast.error('O CPF informado é inválido ou está incompleto.');
      setErrors(prev => ({ ...prev, cpf: true }));
      setCurrentStep('personal');
      return;
    }

    const cpfDigits = formData.cpf.replace(/\D/g, '');
    const duplicate = clients.find(c =>
      c.id !== editingClientId && (c.cpf || '').replace(/\D/g, '') === cpfDigits
    );
    if (duplicate) {
      toast.error(`Este CPF já está cadastrado para o produtor "${duplicate.name}".`);
      setErrors(prev => ({ ...prev, cpf: true }));
      setCurrentStep('personal');
      return;
    }

    if (!(formData.phone || '').trim()) {
      toast.error('O telefone/WhatsApp é obrigatório.');
      setErrors(prev => ({ ...prev, phone: true }));
      setCurrentStep('personal');
      return;
    }

    // Validation based on registration type
    if (regType === 'complete') {
      if (!(formData.ownerEmail || '').trim() || !validateEmail(formData.ownerEmail)) {
        toast.error('O e-mail informado é inválido.');
        setErrors(prev => ({ ...prev, email: true }));
        setCurrentStep('personal');
        return;
      }

      if (!formData.address.street.trim() || !formData.address.city.trim() || !formData.address.state.trim()) {
        toast.error('Por favor, preencha o endereço completo.');
        setCurrentStep('address');
        return;
      }
    } else {
      // Simplified validation
      if ((formData.ownerEmail || '').trim() && !validateEmail(formData.ownerEmail)) {
        toast.error('O e-mail informado é inválido.');
        setErrors(prev => ({ ...prev, email: true }));
        setCurrentStep('personal');
        return;
      }
    }

    try {
      let savedClientId = editingClientId;
      const todayISO = todayLocalDateString();
      const nextYearDate = new Date();
      nextYearDate.setFullYear(nextYearDate.getFullYear() + 1);
      const nextYearISO = nextYearDate.toISOString().split('T')[0];

      if (editingClientId) {
        const docRef = doc(db, 'clients', editingClientId);
        const updatePromise = updateDoc(docRef, {
          ...formData,
          registrationType: regType,
          nameLower: (formData.name || '').toLowerCase(),
          updatedAt: hasValidConfig ? serverTimestamp() : new Date()
        });

        if (hasValidConfig) {
          await updatePromise;
        }
        
        await logAudit({
          userId: user?.uid || 'unknown',
          userName: user?.displayName || user?.email || 'Usuário',
          action: 'updated',
          collection: 'clients',
          recordId: editingClientId,
          recordName: formData.name,
          details: `Cadastro do produtor ${formData.name} atualizado.`,
          newValues: { ...formData, registrationType: regType }
        }).catch(err => console.warn('Erro ao registrar log de auditoria:', err));

        toast.success('Cliente atualizado com sucesso.');
      } else {
        const docRef = doc(collection(db, 'clients'));
        savedClientId = docRef.id;

        const createPromise = setDoc(docRef, {
          ...formData,
          registrationType: regType,
          clientCode: Math.floor(100000 + Math.random() * 900000).toString(),
          nameLower: (formData.name || '').toLowerCase(),
          createdAt: hasValidConfig ? serverTimestamp() : new Date(),
          createdBy: user.uid,
          lastRegistrationUpdateAt: todayISO,
          registrationExpiredAt: nextYearISO
        });

        if (hasValidConfig) {
          await createPromise;
        }

        await logAudit({
          userId: user?.uid || 'unknown',
          userName: user?.displayName || user?.email || 'Usuário',
          action: 'created',
          collection: 'clients',
          recordId: savedClientId,
          recordName: formData.name,
          details: `Produtor ${formData.name} cadastrado no sistema com vigência de 1 ano.`,
          newValues: { ...formData, registrationType: regType, clientCode: savedClientId }
        }).catch(err => console.warn('Erro ao registrar log de auditoria:', err));

        toast.success('Cliente cadastrado com sucesso e vigência de 1 ano definida.');
      }

      // Automatically set active search so the user immediately sees the client in the list
      setConfirmedSearchTerm(formData.name);
      setHasSearched(true);

      // Now if we have any tempFiles selected in Simplified or Complete step, upload them!
      const fileKeys = Object.keys(tempFiles);
      if (fileKeys.length > 0 && savedClientId) {
        const uploadToastId = toast.loading('Enviando documentos para o dossiê do produtor...');
        try {
          const labelMap: { [key: string]: string } = {
            rg: 'RG / Identidade',
            cpfDoc: 'CPF',
            car: 'CAR (Cadastro Ambiental Rural)',
            environmental: 'Regularização Ambiental',
            marriageCert: 'Certidão de Casamento',
            spouseDoc: 'Documento do Cônjuge',
            landDoc: 'Documento de Terra'
          };

          for (const key of fileKeys) {
            const file = tempFiles[key];
            if (file) {
              let downloadUrl = '';
              let filePath = '';

              if (hasValidConfig) {
                filePath = `documents/${savedClientId}/${Date.now()}_${key}_${file.name}`;
                // Firestore gratuito (até 2 MB) — ver lib/fileStore.ts
                ({ url: downloadUrl, storagePath: filePath } = await saveFile(file, file.name, { clientId: savedClientId }));
              } else {
                downloadUrl = URL.createObjectURL(file);
                filePath = `mock_documents/${savedClientId}/${key}_${file.name}`;
              }

              const docPayload: any = {
                clientId: savedClientId,
                name: file.name,
                type: file.type,
                category: labelMap[key] || 'Geral',
                url: downloadUrl,
                storagePath: filePath,
                size: file.size,
                uploadedBy: user?.displayName || 'Sistema',
                uploadedAt: hasValidConfig ? serverTimestamp() : new Date()
              };

              // Delete previous in same category
              const existingList = editingClientId ? clientDocs : [];
              const existingDoc = existingList.find(d => d.category === labelMap[key]);
              if (existingDoc) {
                if (existingDoc.storagePath && hasValidConfig) {
                  await deleteStoredFile(existingDoc.storagePath).catch(err => console.warn('Arquivo antigo não encontrado', err));
                }
                const deletePromise = deleteDoc(doc(db, 'documents', existingDoc.id));
                if (hasValidConfig) {
                  await deletePromise;
                }
              }

              const docRef = doc(collection(db, 'documents'));
              const addDocPromise = setDoc(docRef, docPayload);
              if (hasValidConfig) {
                await addDocPromise;
              }
            }
          }
          toast.success('Todos os documentos foram salvos no dossiê!', { id: uploadToastId });
        } catch (uploadErr) {
          console.error("Erro ao subir arquivos temporários:", uploadErr);
          toast.error(`O cliente foi salvo, mas alguns arquivos não: ${uploadErrorMessage(uploadErr)}`, { id: uploadToastId });
        }
      }

      resetForm();
    } catch (error: any) {
      console.error("Erro ao salvar cliente:", error);
      toast.error(`Não foi possível salvar os dados do cliente: ${error.message || error}`);
      
      // Silent audit log of the failure
      await logAudit({
        userId: user?.uid || 'unknown',
        userName: user?.displayName || user?.email || 'Usuário',
        action: 'rejected',
        collection: 'clients',
        recordId: editingClientId || 'new_client_error',
        recordName: formData.name,
        details: `Falha na gravação do cliente no Firestore: ${error.message || String(error)}`,
        newValues: { ...formData, registrationType: regType, error: error.message || String(error) }
      }).catch(err => console.warn('Erro ao registrar log de auditoria da falha:', err));

      // Trigger system notification with technical details
      await createNotification(
        user?.uid || 'all',
        'Falha Técnica: Gravação no Firestore',
        `A gravação do cliente "${formData.name}" falhou. Detalhe técnico: ${error.message || String(error)}`,
        'alert',
        'clients'
      ).catch(err => console.warn('Erro ao criar notificação de falha:', err));
    }
  };

  const handleRenewalSubmit = async () => {
    if (!renewalClient) return;

    try {
      const todayISO = todayLocalDateString();
      const nextYearDate = new Date();
      nextYearDate.setFullYear(nextYearDate.getFullYear() + 1);
      const nextYearISO = nextYearDate.toISOString().split('T')[0];

      const updatePromise = updateDoc(doc(db, 'clients', renewalClient.id), {
        ownerEmail: renewalData.ownerEmail,
        phone: renewalData.phone,
        address: renewalData.address,
        lastRegistrationUpdateAt: todayISO,
        registrationExpiredAt: nextYearISO,
        updatedAt: hasValidConfig ? serverTimestamp() : new Date()
      });

      if (hasValidConfig) {
        await updatePromise;
      }

      toast.success('Cadastro do produtor atualizado e validade renovada por mais 1 ano!');
      
      // Se detalhe do cliente estiver aberto, atualizar estado local para refletir na UI instantaneamente
      if (selectedClientDetail?.id === renewalClient.id) {
        setSelectedClientDetail({
          ...selectedClientDetail,
          ownerEmail: renewalData.ownerEmail,
          phone: renewalData.phone,
          address: renewalData.address,
          lastRegistrationUpdateAt: todayISO,
          registrationExpiredAt: nextYearISO
        });
      }

      setIsRenewalModalOpen(false);
      setRenewalClient(null);
    } catch (error: any) {
      console.error("Erro ao renovar cliente:", error);
      toast.error(`Não foi possível renovar o cadastro do cliente: ${error.message || error}`);
      
      // Silent audit log of the failure
      await logAudit({
        userId: user?.uid || 'unknown',
        userName: user?.displayName || user?.email || 'Usuário',
        action: 'rejected',
        collection: 'clients',
        recordId: renewalClient?.id || 'renewal_error',
        recordName: renewalClient?.name || 'Cliente',
        details: `Falha na renovação cadastral do cliente no Firestore: ${error.message || String(error)}`,
        newValues: { ...renewalData, error: error.message || String(error) }
      }).catch(err => console.warn('Erro ao registrar log de auditoria da falha:', err));

      // Trigger system notification with technical details
      await createNotification(
        user?.uid || 'all',
        'Falha Técnica: Renovação no Firestore',
        `A renovação do cliente "${renewalClient?.name || 'Cliente'}" falhou. Detalhe técnico: ${error.message || String(error)}`,
        'alert',
        'clients'
      ).catch(err => console.warn('Erro ao criar notificação de falha:', err));
    }
  };

  const handleRenewalCEPBlur = async () => {
    const cep = renewalData.address.cep.replace(/\D/g, '');
    if (cep.length !== 8) return;

    try {
      const response = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
      const data = await response.json();
      if (!data.erro) {
        setRenewalData({
          ...renewalData,
          address: {
            ...renewalData.address,
            street: data.logradouro,
            neighborhood: data.bairro,
            city: data.localidade,
            state: data.uf
          }
        });
      }
    } catch (error) {
      console.error("Erro ao buscar CEP na renovação:", error);
    }
  };

  const handleEditClick = (client: Client) => {
    setFormData({
      name: client.name,
      cpf: client.cpf,
      ownerEmail: client.ownerEmail || '',
      phone: client.phone || '',
      address: {
        cep: client.address?.cep || '',
        street: client.address?.street || '',
        number: client.address?.number || '',
        noNumber: (client.address as any)?.noNumber || false,
        neighborhood: client.address?.neighborhood || '',
        noNeighborhood: (client.address as any)?.noNeighborhood || false,
        city: client.address?.city || '',
        state: client.address?.state || ''
      },
      properties: [...(client.properties || [])],
      clientType: client.clientType
    });
    setRegType(client.registrationType || (client.cpf ? 'complete' : 'simplified'));
    setEditingClientId(client.id);
    setIsModalOpen(true);
    setCurrentStep('personal');
    setShowAddPropertyForm(false);
    setCurrentProperty({
      name: '', cep: '', street: '', number: '', noNumber: false,
      neighborhood: '', noNeighborhood: false, city: '', state: ''
    });
  };

  const [selectedClientDetail, setSelectedClientDetail] = useState<Client | null>(null);

  // Load documents for the currently viewed client in detail view
  useEffect(() => {
    if (!selectedClientDetail) {
      setDetailClientDocs([]);
      return;
    }
    const q = query(
      collection(db, 'documents'),
      where('clientId', '==', selectedClientDetail.id)
    );
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setDetailClientDocs(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    }, (error) => {
      console.error("Erro ao carregar documentos do produtor:", error);
    });
    return () => unsubscribe();
  }, [selectedClientDetail]);

  // Property Timeline State
  interface TimelineEvent {
    id: string;
    type: 'visit' | 'contract' | 'financial' | 'analysis' | 'message' | 'appointment';
    title: string;
    subtitle: string;
    date: string;
    status?: string;
    metadata?: string;
    color: string;
  }

  const [activeDetailsTab, setActiveDetailsTab] = useState<'profile' | 'timeline' | 'services_projects' | 'whatsapp'>('profile');
  const [timelineEvents, setTimelineEvents] = useState<TimelineEvent[]>([]);
  const [clientAnalyses, setClientAnalyses] = useState<any[]>([]);
  const [timelineLoading, setTimelineLoading] = useState(false);
  const [showAddService, setShowAddService] = useState(false);

  // WhatsApp Evolution API state
  const [detailClientVisits, setDetailClientVisits] = useState<any[]>([]);
  const [detailClientContracts, setDetailClientContracts] = useState<any[]>([]);
  const [whatsappPhone, setWhatsappPhone] = useState('');
  const [whatsappMessage, setWhatsappMessage] = useState('');
  const [whatsappTemplate, setWhatsappTemplate] = useState<'custom' | 'visit' | 'contract'>('custom');
  const [selectedVisitId, setSelectedVisitId] = useState('');
  const [selectedContractId, setSelectedContractId] = useState('');
  const [isSendingWhatsapp, setIsSendingWhatsapp] = useState(false);

  useEffect(() => {
    if (!selectedClientDetail) {
      setTimelineEvents([]);
      setClientAnalyses([]);
      setActiveDetailsTab('profile');
      setDetailClientVisits([]);
      setDetailClientContracts([]);
      setWhatsappPhone('');
      setWhatsappMessage('');
      setWhatsappTemplate('custom');
      setSelectedVisitId('');
      setSelectedContractId('');
      return;
    }

    setWhatsappPhone(selectedClientDetail.phone || '');
    setWhatsappMessage(`Olá, *${selectedClientDetail.name}*! Gostaríamos de entrar em contato para alinhar os próximos passos da sua consultoria agronômica. Como está o andamento na fazenda?`);
    setWhatsappTemplate('custom');
    setSelectedVisitId('');
    setSelectedContractId('');

    setTimelineLoading(true);
    const unsubscribes: (() => void)[] = [];

    // Local lists to safely merge
    let dbVisits: any[] = [];
    let dbAppts: any[] = [];
    let dbConts: any[] = [];
    let dbFins: any[] = [];
    let dbMsgs: any[] = [];
    let dbAnalyses: any[] = [];

    const publishMergedEvents = () => {
      const compiled: TimelineEvent[] = [];

      const isConsultant = (user?.effectiveRole ?? user?.role) === 'consultant' || ((user?.effectiveRole ?? user?.role) as string) === 'staff';

      dbVisits.forEach(v => {
        compiled.push({
          id: v.id,
          type: 'visit',
          title: 'Visita Técnica de Inspeção',
          subtitle: v.objective || 'Visita agropecuária de campo',
          date: v.visitDate || v.createdAt,
          status: v.syncStatus === 'synced' ? 'Sincronizado' : 'Pendente Sync',
          metadata: `Técnico: ${v.technicianName} • ${v.crops?.map((c: any) => c.name).join(', ') || 'Sem culturas mapeadas'}`,
          color: 'bg-emerald-500 text-emerald-600 border-emerald-200'
        });
      });

      dbConts.forEach(c => {
        compiled.push({
          id: c.id,
          type: 'contract',
          title: `Contrato: ${c.title || 'Consultoria Agrícola'}`,
          subtitle: c.description || 'Contrato de faturamento regularizado',
          date: c.startDate || c.createdAt,
          status: c.status === 'active' ? 'Ativo' : c.status === 'completed' ? 'Finalizado' : 'Suspenso',
          metadata: isConsultant
            ? `Vigência: de ${formatDate(c.startDate)} a ${c.endDate ? formatDate(c.endDate) : 'Indeterminado'}`
            : `Valor: R$ ${(c.value || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })} • Vigência: de ${formatDate(c.startDate)} a ${c.endDate ? formatDate(c.endDate) : 'Indeterminado'}`,
          color: 'bg-emerald-500 text-slate-600 border-slate-200'
        });
      });

      if (!isConsultant) {
        dbFins.forEach(f => {
          const catLabels: Record<string, string> = { analysis: 'Análise de Solo', field_visit: 'Visita Técnica', contract: 'Mensalidade', other: 'Eventual' };
          const statLabels: Record<string, string> = { paid: 'Pago', pending: 'Pendente', overdue: 'Atrasado', cancelled: 'Cancelado' };
          compiled.push({
            id: f.id,
            type: 'financial',
            title: `Lancto. Financeiro: ${catLabels[f.category] || 'Serviços'}`,
            subtitle: f.description || 'Gestão AgroGestão',
            date: f.dueDate || f.createdAt,
            status: statLabels[f.status] || f.status,
            metadata: `Valor: R$ ${(f.amount || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })} • Vencimento: ${formatDate(f.dueDate)}`,
            color: 'bg-amber-500 text-amber-600 border-amber-200'
          });
        });
      }

      dbMsgs.forEach(m => {
        compiled.push({
          id: m.id,
          type: 'message',
          title: `E-mail Interno: ${m.subject || '(Sem Assunto)'}`,
          subtitle: m.content || '',
          date: m.createdAt || new Date().toISOString(),
          status: 'Enviado',
          metadata: `De: ${m.senderName || m.senderEmail || 'Colaborador'} • Projeto associado: ${m.projectName || 'Geral'}`,
          color: 'bg-emerald-500 text-slate-600 border-slate-200'
        });
      });

      // Agendamentos do cliente (Agenda) — com a visita que foi registrada a partir dele
      const statusAg: Record<string, string> = { scheduled: 'Agendado', confirmed: 'Confirmado', completed: 'Concluído', cancelled: 'Cancelado' };
      dbAppts.forEach(ap => {
        const temVisita = dbVisits.some((v: any) => v.linkedAppointmentId === ap.id);
        compiled.push({
          id: 'ap-' + ap.id,
          type: 'appointment',
          title: `Agendamento: ${ap.serviceType || 'Visita'}`,
          subtitle: ap.notes || `Com ${ap.technicianName || 'técnico'}`,
          date: ap.date ? `${ap.date}T${ap.time || '08:00'}:00` : (ap.createdAt || new Date().toISOString()),
          status: statusAg[ap.status] || ap.status || 'Agendado',
          metadata: `${formatDate(ap.date)} às ${ap.time || '--:--'} • Técnico: ${ap.technicianName || 'Não definido'}${temVisita ? ' • Visita registrada' : ''}`,
          color: 'bg-slate-500 text-slate-600 border-slate-200'
        });
      });

      dbAnalyses.forEach(a => {
        const typeLabels: Record<string, string> = {
          soil: 'Análise de Solo',
          water: 'Análise de Água',
          foliar: 'Análise Foliar',
          topography: 'Projeto de Topografia',
          irrigation: 'Projeto de Irrigação',
          documentation: 'Regularização Ambiental',
          credit: 'Projeto de Crédito Rural',
          environmental_xray: 'Raio-X Ambiental'
        };
        compiled.push({
          id: a.id,
          type: 'analysis',
          title: `Serviço/Projeto: ${typeLabels[a.type] || 'Análise Técnica'}`,
          subtitle: a.description || 'Laudo/projeto agronômico',
          date: a.createdAt || new Date().toISOString(),
          status: a.status || 'Pendente',
          metadata: isConsultant
            ? `Responsável: ${a.responsibleTechnician || 'Não Atribuído'}`
            : `Responsável: ${a.responsibleTechnician || 'Não Atribuído'} ${a.value ? `• Valor: R$ ${(a.value).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` : ''}`,
          color: 'bg-amber-500 text-amber-600 border-amber-200'
        });
      });

      // Sort Chronologically descending
      compiled.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
      setTimelineEvents(compiled);
      setClientAnalyses(dbAnalyses);
      setDetailClientVisits(dbVisits);
      setDetailClientContracts(dbConts);
      setTimelineLoading(false);
    };

    // 0. Agendamentos deste cliente (Agenda)
    unsubscribes.push(onSnapshot(query(collection(db, 'appointments'), where('clientId', '==', selectedClientDetail.id)), (snap) => {
      dbAppts = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      publishMergedEvents();
    }, (error) => console.error(error)));

    // 1. Visitas
    const unsubVisits = onSnapshot(query(collection(db, 'field_visits')), (snap) => {
      dbVisits = snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter((v: any) => v.clientId === selectedClientDetail.id);
      publishMergedEvents();
    }, (error) => console.error(error));
    unsubscribes.push(unsubVisits);

    // Contratos e financeiro: só Gerente/Administrador lêem (firestore.rules);
    // para os demais cargos esses blocos simplesmente não aparecem na ficha.
    const activeRoleForTimeline = (user?.effectiveRole ?? user?.role) as string;
    const canSeeFinance = ['admin', 'manager'].includes(activeRoleForTimeline);

    // 2. Contratos
    if (canSeeFinance) {
      const unsubConts = onSnapshot(query(collection(db, 'contracts'), where('clientId', '==', selectedClientDetail.id)), (snap) => {
        dbConts = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        publishMergedEvents();
      }, (error) => console.error(error));
      unsubscribes.push(unsubConts);
    }

    // 5. Financeiro
    if (canSeeFinance) {
      const unsubFins = onSnapshot(query(collection(db, 'financials'), where('clientId', '==', selectedClientDetail.id)), (snap) => {
        dbFins = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        publishMergedEvents();
      }, (error) => console.error(error));
      unsubscribes.push(unsubFins);
    }

    // 6. Mensagens de E-mail Interno — cada um vê só as que enviou/recebeu sobre o cliente
    // (antes lia a caixa de e-mail de TODOS os funcionários e filtrava no navegador).
    const msgBuckets: Record<string, any[]> = { sent: [], received: [] };
    (['sent', 'received'] as const).forEach(kind => {
      const qMsg = query(
        collection(db, 'messages'),
        where('clientId', '==', selectedClientDetail.id),
        where(kind === 'sent' ? 'senderId' : 'recipientId', '==', user?.uid || '')
      );
      unsubscribes.push(onSnapshot(qMsg, (snap) => {
        msgBuckets[kind] = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        const merged = new Map<string, any>();
        [...msgBuckets.sent, ...msgBuckets.received].forEach(m => merged.set(m.id, m));
        dbMsgs = Array.from(merged.values());
        publishMergedEvents();
      }, (error) => console.error(error)));
    });

    // 7. Projetos e Análises (CRM)
    const unsubAnalyses = onSnapshot(query(collection(db, 'analyses')), (snap) => {
      dbAnalyses = snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter((a: any) => a.clientId === selectedClientDetail.id);
      publishMergedEvents();
    }, (error) => console.error(error));
    unsubscribes.push(unsubAnalyses);

    return () => {
      unsubscribes.forEach(unsub => unsub());
    };
  }, [selectedClientDetail]);

  const handleSelectVisitTemplate = (visitId: string) => {
    setSelectedVisitId(visitId);
    if (!selectedClientDetail) return;
    const visit = detailClientVisits.find(v => v.id === visitId);
    if (visit) {
      const visitDateStr = visit.visitDate ? formatDate(visit.visitDate) : '(Data não definida)';
      const msg = `Olá, *${selectedClientDetail.name}*!\n\nLembramos que temos uma *Visita Técnica de Inspeção* agendada para o seu imóvel.\n\n` +
        `📅 *Data:* ${visitDateStr}\n` +
        `👨‍🌾 *Técnico Responsável:* ${visit.technicianName || 'Nosso Engenheiro Agrônomo'}\n` +
        `🎯 *Objetivo:* ${visit.objective || 'Inspeção regular das lavouras'}\n\n` +
        `Por favor, confirme se está tudo certo para nos receber. Até breve!`;
      setWhatsappMessage(msg);
    }
  };

  const handleSelectContractTemplate = (contractId: string) => {
    setSelectedContractId(contractId);
    if (!selectedClientDetail) return;
    const contract = detailClientContracts.find(c => c.id === contractId);
    if (contract) {
      const startStr = contract.startDate ? formatDate(contract.startDate) : '(Data de Início)';
      const endStr = contract.endDate ? formatDate(contract.endDate) : 'Prazo Indeterminado';
      const msg = `Olá, *${selectedClientDetail.name}*!\n\nEncaminhamos o resumo/detalhes do seu contrato ativo conosco:\n\n` +
        `📄 *Contrato:* ${contract.contractNumber || 'Consultoria Técnica Regular'}\n` +
        `💼 *Objeto:* ${contract.category || contract.object || 'Assistência Técnica de Campo'}\n` +
        `💰 *Valor Total:* R$ ${(contract.totalValue || contract.value || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}\n` +
        `📅 *Vigência:* de ${startStr} a ${endStr}\n\n` +
        `Caso queira receber a via digital completa ou possua alguma dúvida, fale com o seu gestor de contas. Obrigado pela parceria!`;
      setWhatsappMessage(msg);
    }
  };

  const handleTemplateTypeChange = (type: 'custom' | 'visit' | 'contract') => {
    setWhatsappTemplate(type);
    setSelectedVisitId('');
    setSelectedContractId('');
    if (!selectedClientDetail) return;
    if (type === 'custom') {
      setWhatsappMessage(`Olá, *${selectedClientDetail.name}*! Gostaríamos de entrar em contato para alinhar os próximos passos da sua consultoria agronômica. Como está o andamento na fazenda?`);
    } else {
      setWhatsappMessage('');
    }
  };

  const handleSendWhatsapp = async () => {
    if (!selectedClientDetail) return;
    if (!whatsappPhone.trim()) {
      toast.error('O número de telefone/WhatsApp é obrigatório.');
      return;
    }
    if (!whatsappMessage.trim()) {
      toast.error('A mensagem não pode estar vazia.');
      return;
    }

    setIsSendingWhatsapp(true);
    try {
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

      // O "+55" é só um rótulo fixo mostrado do lado do campo — o valor
      // digitado nunca vinha com o código do país. Sem isso, quando a
      // integração real do WhatsApp (Evolution API) estiver configurada, a
      // mensagem sairia pro número errado (ou falharia).
      const digitsOnly = whatsappPhone.replace(/\D/g, '');
      const fullPhone = digitsOnly.startsWith('55') ? digitsOnly : `55${digitsOnly}`;

      const response = await fetch('/api/alerts/send-whatsapp', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          phone: fullPhone,
          message: whatsappMessage
        })
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Erro no servidor ao enviar mensagem por WhatsApp.');
      }

      toast.success(data.message || 'Notificação enviada com sucesso via Evolution API!');
      
      // Register global audit log
      await logAudit({
        userId: user?.uid || 'unknown',
        userName: user?.displayName || user?.email || 'Usuário',
        action: 'status_changed',
        collection: 'clients',
        recordId: selectedClientDetail.id,
        recordName: selectedClientDetail.name,
        details: `Notificação WhatsApp enviada via Evolution API para ${selectedClientDetail.name} (${whatsappPhone}). Mensagem: "${whatsappMessage.substring(0, 80)}..."`,
        newValues: { phone: whatsappPhone, message: whatsappMessage, simulated: !!data.simulated }
      });

    } catch (err: any) {
      console.error(err);
      toast.error(err.message || 'Erro de comunicação ao enviar WhatsApp.');
    } finally {
      setIsSendingWhatsapp(false);
    }
  };

  const resetForm = () => {
    setFormData({
      name: '',
      cpf: '',
      ownerEmail: '',
      phone: '',
      address: {
        cep: '',
        street: '',
        number: '',
        noNumber: false,
        neighborhood: '',
        noNeighborhood: false,
        city: '',
        state: ''
      },
      properties: [],
      clientType: 'rural_producer'
    });
    setErrors({
      cpf: false,
      email: false,
      phone: false
    });
    setRegType('complete');
    setTempFiles({});
    setEditingClientId(null);
    setCurrentStep('personal');
    setIsModalOpen(false);
    setShowAddPropertyForm(false);
    setCurrentProperty({
      name: '', cep: '', street: '', number: '', noNumber: false,
      neighborhood: '', noNeighborhood: false, city: '', state: ''
    });
  };

  const filteredClients = React.useMemo(() => {
    if (!hasSearched) return [];

    let result = clients.filter(c => {
      // Consultant visibility check: see only clients linked to services created by him or created by him / legacy
      if ((user?.effectiveRole ?? user?.role) === 'consultant' || ((user?.effectiveRole ?? user?.role) as string) === 'staff') {
        const isLinkedToUser = userServicesClientIds.has(c.id) || !c.createdBy || c.createdBy === user?.uid;
        if (!isLinkedToUser) return false;
      }

      const termLower = confirmedSearchTerm.toLowerCase();
      const cleanSearch = confirmedSearchTerm.replace(/\D/g, '');
      const cleanCPF = (c.cpf || '').replace(/\D/g, '');
      
      const matchesSearch = confirmedSearchTerm === '' || (
        (c.name || '').toLowerCase().includes(termLower) || 
        (c.address?.city || '').toLowerCase().includes(termLower) ||
        (cleanSearch !== '' && cleanCPF.includes(cleanSearch))
      );

      if (!matchesSearch) return false;

      if (filterGroup !== 'all' && c.clientType !== filterGroup) {
        return false;
      }

      if (filterCity !== 'all' && (c.address?.city || '').toLowerCase() !== filterCity.toLowerCase()) {
        return false;
      }

      return true;
    });

    // Sort By
    result = [...result].sort((a, b) => {
      if (sortBy === 'name-asc') {
        return a.name.localeCompare(b.name);
      } else if (sortBy === 'name-desc') {
        return b.name.localeCompare(a.name);
      } else if (sortBy === 'created-desc') {
        const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return dateB - dateA;
      } else if (sortBy === 'created-asc') {
        const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return dateA - dateB;
      }
      return 0;
    });

    return result;
  }, [clients, confirmedSearchTerm, hasSearched, filterGroup, filterCity, sortBy, user, userServicesClientIds]);

  const steps = React.useMemo(() => {
    if (regType === 'simplified') {
      return [
        { id: 'personal', label: 'Dados do Produtor', icon: User },
        { id: 'review', label: 'Revisão', icon: FileBadge }
      ];
    } else {
      return [
        { id: 'personal', label: 'Dados Pessoais', icon: User },
        { id: 'address', label: 'Endereço e Propriedades', icon: MapPin },
        { id: 'documents', label: 'Documentos do Dossiê', icon: FolderOpen },
        { id: 'review', label: 'Revisão', icon: FileBadge }
      ];
    }
  }, [regType]);

  const expiredClientsCount = clients.filter(c => {
    const statusObj = getRegistrationStatus(c.registrationExpiredAt);
    return statusObj.status === 'expired';
  }).length;

  return (
    <div className="flex flex-col gap-6 h-full">
      {confirmModal}
      <header className={PAGE_HEADER_CLASS} data-page-header>
        <PageTitle icon={PageIcon} title="Clientes" subtitle="Cadastro de produtores, propriedades e histórico de atendimento" />
        <div className="flex items-center gap-3">
          <ExportExcelButton fileName="Clientes" getRows={() => (confirmedSearchTerm ? filteredClients : clients).map((c: any) => ({
    'Nome': c.name || '', 'CPF/CNPJ': c.cpf || '', 'Código': c.clientCode || '', 'Tipo': c.clientType === 'pronaf' ? 'Pronaf' : 'Produtor Rural',
    'Telefone': c.phone || '', 'E-mail': c.ownerEmail || '', 'Cidade': c.address?.city || '', 'UF': c.address?.state || '',
    'Propriedades': (c.properties || []).map((p: any) => p?.name + (p?.areaHectares ? ` (${p.areaHectares} ha)` : '')).filter(Boolean).join('; '),
    'Cadastro': (c.createdAt ? String(c.createdAt).split('T')[0].split('-').reverse().join('/') : ''),
  }))} />
        {PERMISSIONS.canCreateClient(((user?.effectiveRole ?? user?.role) as UserRole) || 'consultant') && (
          <button 
            onClick={() => setIsModalOpen(true)}
            className="bg-emerald-600 text-white px-4 py-2 rounded-xl text-sm font-bold flex items-center gap-2 hover:bg-emerald-700 transition-colors shadow-lg shadow-emerald-200"
          >
            <Plus className="w-4 h-4" /> Novo Cliente
          </button>
        )}
        </div>
      </header>

      {/* Card de Busca e Filtros */}
      <div className="bg-white/40 glass p-6 rounded-[2rem] border border-white/40 shadow-sm flex flex-col gap-4">
        <form onSubmit={(e) => {
          e.preventDefault();
          setConfirmedSearchTerm(searchInput);
          setHasSearched(true);
        }} className="flex flex-col md:flex-row items-stretch gap-4">
          
          {/* Campo de Busca */}
          <div className="relative flex-1">
            <input 
              id="client-search"
              type="text" 
              placeholder="Digite o nome ou CPF para pesquisar..." 
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="pl-11 pr-4 py-3 h-12 bg-white/80 rounded-xl border border-slate-200 w-full text-sm placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 text-slate-800 shadow-inner"
            />
            <label htmlFor="client-search" className="sr-only">Buscar Clientes</label>
            <Search className="w-5 h-5 absolute left-4 top-3.5 text-slate-400" />
          </div>

          {/* Botão Pesquisar */}
          <button
            type="submit"
            className="px-6 h-12 bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white text-sm font-bold rounded-xl transition-all shadow-md hover:shadow-emerald-200/50 flex items-center justify-center gap-2 cursor-pointer"
          >
            <Search className="w-4 h-4" />
            Pesquisar
          </button>
        </form>

        {/* Filtros para Reorganizar: Organizar por, Grupo, Cidades */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2 border-t border-slate-100">
          
          {/* Organizar Por */}
          <div className="space-y-1">
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Organizar Por</label>
            <select
              value={sortBy}
              onChange={(e: any) => setSortBy(e.target.value)}
              className="w-full h-10 px-3 bg-white/70 border border-slate-200 rounded-lg text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-emerald-500/20 text-slate-700"
            >
              <option value="name-asc">Nome (A - Z)</option>
              <option value="name-desc">Nome (Z - A)</option>
              <option value="created-desc">Mais Recentes</option>
              <option value="created-asc">Mais Antigos</option>
            </select>
          </div>

          {/* Grupo */}
          <div className="space-y-1">
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Grupo (Tipo)</label>
            <select
              value={filterGroup}
              onChange={(e: any) => setFilterGroup(e.target.value)}
              className="w-full h-10 px-3 bg-white/70 border border-slate-200 rounded-lg text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-emerald-500/20 text-slate-700"
            >
              <option value="all">Todos os Grupos</option>
              <option value="pronaf">Pronaf</option>
              <option value="rural_producer">Produtor Rural</option>
            </select>
          </div>

          {/* Cidades */}
          <div className="space-y-1">
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Cidades</label>
            <select
              value={filterCity}
              onChange={(e) => setFilterCity(e.target.value)}
              className="w-full h-10 px-3 bg-white/70 border border-slate-200 rounded-lg text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-emerald-500/20 text-slate-700"
            >
              <option value="all">Todas as Cidades</option>
              {Array.from(new Set(clients.map(c => c.address?.city).filter(Boolean))).sort().map(city => (
                <option key={city} value={city}>{city}</option>
              ))}
            </select>
          </div>

        </div>
      </div>

      {hasSearched && (
        <div className="flex justify-between items-center px-1">
          <span className="text-xs text-slate-500 font-medium">
            Encontrado{filteredClients.length === 1 ? '' : 's'} <strong className="text-emerald-700">{filteredClients.length}</strong> {filteredClients.length === 1 ? 'resultado' : 'resultados'} para "<strong className="text-slate-700">{confirmedSearchTerm || 'Todos'}</strong>"
          </span>
          <button
            onClick={() => {
              setSearchInput('');
              setConfirmedSearchTerm('');
              setHasSearched(false);
              setFilterGroup('all');
              setFilterCity('all');
            }}
            className="text-xs font-bold text-rose-600 hover:text-rose-700 flex items-center gap-1 transition-colors cursor-pointer"
          >
            <X className="w-3.5 h-3.5" /> Limpar Busca
          </button>
        </div>
      )}

      {!hasSearched ? (
        <div className="flex flex-col items-center justify-center py-20 px-4 bg-white/40 glass rounded-[2rem] border border-white/50 text-center shadow-sm">
          <div className="w-16 h-16 rounded-full bg-emerald-500/10 flex items-center justify-center text-emerald-600 mb-4 animate-pulse">
            <Search className="w-8 h-8" />
          </div>
          <h3 className="text-lg font-display font-bold text-slate-800">Busca Ativa de Produtores</h3>
          <p className="text-xs text-slate-500 max-w-sm mt-1">
            Digite o nome ou CPF do produtor no campo acima e clique em <strong>Pesquisar</strong> para visualizar os clientes e gerenciar cadastros.
          </p>
        </div>
      ) : filteredClients.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 px-4 bg-white/40 glass rounded-[2rem] border border-white/50 text-center shadow-sm">
          <div className="w-16 h-16 rounded-full bg-slate-100 flex items-center justify-center text-slate-400 mb-4">
            <Search className="w-8 h-8" />
          </div>
          <h3 className="text-lg font-display font-bold text-slate-700">Nenhum produtor encontrado</h3>
          <p className="text-xs text-slate-400 max-w-sm mt-1">
            Não encontramos nenhum registro correspondente com os termos e filtros aplicados.
          </p>
          <button 
            onClick={() => {
              setSearchInput('');
              setConfirmedSearchTerm('');
              setHasSearched(false);
              setFilterGroup('all');
              setFilterCity('all');
            }}
            className="mt-4 px-4 py-2 bg-slate-200 hover:bg-slate-300 active:scale-95 text-slate-700 text-xs font-bold uppercase tracking-wider rounded-xl transition-all cursor-pointer"
          >
            Limpar Filtros e Tentar Novamente
          </button>
        </div>
      ) : (
        <>
          {expiredClientsCount > 0 && (
            <div className="bg-rose-50 border border-rose-100 p-4 rounded-2xl flex items-center justify-between shadow-sm animate-fade-in">
              <div className="flex items-center gap-3">
                <span className="w-8 h-8 rounded-full bg-rose-100 text-rose-600 flex items-center justify-center font-bold">!</span>
                <div>
                  <p className="text-xs font-bold text-rose-800">
                    Atenção: {expiredClientsCount} {expiredClientsCount === 1 ? 'cadastro de produtor está' : 'cadastros de produtores estão'} vencidos ou pendentes de recadastramento
                  </p>
                  <p className="text-[10px] text-rose-600 leading-tight">
                    Mais de 1 ano se passou desde a última verificação. Clique no ícone de atualização lateral (ou no perfil detalhado) para atualizar dados de contato e renovar a vigência por 12 meses.
                  </p>
                </div>
              </div>
            </div>
          )}

          <div className="flex-1 overflow-y-auto glass-card">
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 bg-white/80 backdrop-blur-md z-10 text-slate-400 border-b border-b-slate-100">
                <tr>
                  <th className="p-4 font-bold uppercase text-[10px]">Produtor</th>
                  <th className="p-4 font-bold uppercase text-[10px]">Código</th>
                  <th className="p-4 font-bold uppercase text-[10px]">CPF</th>
                  <th className="p-4 font-bold uppercase text-[10px]">Cidade</th>
                  <th className="p-4 font-bold uppercase text-[10px]">Tipo</th>
                  <th className="p-4 font-bold uppercase text-[10px] text-right">Ações</th>
                </tr>
              </thead>
          <tbody className="divide-y divide-white/10">
            {filteredClients.map((client) => (
              <motion.tr 
                layout 
                key={client.id} 
                onClick={() => setSelectedClientDetail(client)}
                className="hover:bg-white/40 border-b border-b-white/10 transition-colors group cursor-pointer"
              >
                <td className="p-4">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-emerald-50 flex items-center justify-center text-emerald-600 font-bold">
                      {client.name[0]}
                    </div>
                    <span className="font-bold text-slate-700">{client.name}</span>
                  </div>
                </td>
                <td className="p-4">
                  <span className="px-1.5 py-0.5 bg-emerald-50 text-emerald-700 font-mono text-[10px] font-bold rounded border border-emerald-100">
                    #{getClientCode(client)}
                  </span>
                </td>
                <td className="p-4">
                  <div className="text-slate-600 font-mono text-xs">{client.cpf}</div>
                </td>
                <td className="p-4">
                  <div className="text-slate-600 font-medium">{client.address?.city || 'Não Informada'}</div>
                </td>
                <td className="p-4">
                  <span className={cn(
                    "px-2 py-0.5 rounded-lg text-[9px] font-bold uppercase",
                    client.clientType === 'pronaf' ? "bg-slate-100 text-slate-700" : "bg-emerald-100 text-emerald-700"
                  )}>
                    {client.clientType === 'pronaf' ? 'Pronaf' : 'Produtor Rural'}
                  </span>
                </td>
                <td className="p-4 text-right">
                  <div className="flex justify-end gap-2">
                    <button 
                      onClick={(e) => { e.stopPropagation(); setSelectedClientDetail(client); }}
                      className="p-1.5 hover:bg-white rounded-lg text-slate-400 hover:text-slate-600 transition-colors border border-transparent hover:border-slate-100 shadow-sm animate-fade-in"
                      title="Ver Detalhes"
                    >
                      <ChevronRight className="w-4 h-4" />
                    </button>
                    <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      {PERMISSIONS.canEditClient(((user?.effectiveRole ?? user?.role) as UserRole) || 'consultant') && (
                        <button 
                          onClick={(e) => { e.stopPropagation(); openRenewalModal(client); }}
                          className="p-1.5 hover:bg-white rounded-lg text-slate-400 hover:text-slate-500 transition-colors border border-transparent hover:border-slate-100 shadow-sm"
                          title="Atualizar Contato e Renovar de Validade"
                        >
                          <RefreshCw className="w-4 h-4" />
                        </button>
                      )}
                      {PERMISSIONS.canEditClient(((user?.effectiveRole ?? user?.role) as UserRole) || 'consultant') && (
                        <button 
                          onClick={(e) => { e.stopPropagation(); handleEditClick(client); }}
                          className="p-1.5 hover:bg-white rounded-lg text-slate-400 hover:text-emerald-600 transition-colors border border-transparent hover:border-slate-100 shadow-sm"
                          title="Editar Cadastro"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                      )}
                      {PERMISSIONS.canDeleteClient(((user?.effectiveRole ?? user?.role) as UserRole) || 'consultant', clientsWithActiveServices.has(client.id)) && (
                        <button 
                          onClick={(e) => { e.stopPropagation(); setIsDeleteModalOpen(client.id); }}
                          className="p-1.5 hover:bg-white rounded-lg text-slate-400 hover:text-rose-500 transition-colors border border-transparent hover:border-slate-100 shadow-sm"
                          title="Excluir Produtor"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>
                </td>
              </motion.tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )}

      <AnimatePresence>
        {selectedClientDetail && (
          <div className="fixed inset-0 z-[100] flex items-center justify-end p-6 bg-slate-900/40 backdrop-blur-sm">
            <motion.div 
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              className="glass-card w-full max-w-xl h-full p-0 flex flex-col shadow-2xl overflow-hidden"
            >
              <div className="bg-emerald-600 p-8 text-white relative">
                <button 
                  onClick={() => setSelectedClientDetail(null)}
                  className="absolute top-4 right-4 p-2 hover:bg-white/10 rounded-full transition-all"
                >
                  <X className="w-6 h-6" />
                </button>
                <div className="flex items-center gap-6">
                  <div className="w-20 h-20 rounded-3xl bg-white/20 backdrop-blur-md flex items-center justify-center text-4xl font-display font-bold">
                    {selectedClientDetail.name[0]}
                  </div>
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="text-2xl font-display font-bold">{selectedClientDetail.name}</h3>
                      <span className="px-1.5 py-0.5 bg-white/20 text-emerald-150 font-mono text-[11px] font-black rounded border border-white/20">
                        #{getClientCode(selectedClientDetail)}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 mt-1">
                      <span className="text-emerald-100 font-medium text-sm">
                        {selectedClientDetail.clientType === 'pronaf' ? 'Agricultor Familiar (Pronaf)' : 'Produtor Rural Especializado'}
                      </span>
                      <span className="bg-emerald-700/50 text-emerald-100 text-[9px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-xl border border-emerald-500/30">
                        Portal: Em breve
                      </span>
                    </div>
                  </div>
                </div>

                 {/* Subnavigation Tabs inside Drawer */}
                <div className="flex border-t border-white/10 mt-6 -mx-8 px-8 bg-black/10 text-xs overflow-x-auto whitespace-nowrap scrollbar-none">
                  <button 
                    onClick={() => setActiveDetailsTab('profile')}
                    className={`flex-1 px-4 py-3 font-bold uppercase tracking-wider text-center border-b-2 transition-all shrink-0 ${
                      activeDetailsTab === 'profile' 
                        ? 'border-white text-white' 
                        : 'border-transparent text-emerald-100 hover:text-white'
                    }`}
                  >
                    Perfil Geral
                  </button>
                  <button 
                    onClick={() => setActiveDetailsTab('timeline')}
                    className={`flex-1 px-4 py-3 font-bold uppercase tracking-wider text-center border-b-2 transition-all shrink-0 ${
                      activeDetailsTab === 'timeline' 
                        ? 'border-white text-white' 
                        : 'border-transparent text-emerald-100 hover:text-white'
                    }`}
                  >
                    Histórico
                  </button>
                  <button 
                    onClick={() => setActiveDetailsTab('services_projects')}
                    className={`flex-1 px-4 py-3 font-bold uppercase tracking-wider text-center border-b-2 transition-all shrink-0 ${
                      activeDetailsTab === 'services_projects' 
                        ? 'border-white text-white' 
                        : 'border-transparent text-emerald-100 hover:text-white'
                    }`}
                  >
                    Projetos
                  </button>
                  <button 
                    onClick={() => setActiveDetailsTab('whatsapp')}
                    className={`flex-1 px-4 py-3 font-bold uppercase tracking-wider text-center border-b-2 transition-all shrink-0 ${
                      activeDetailsTab === 'whatsapp' 
                        ? 'border-white text-white' 
                        : 'border-transparent text-emerald-100 hover:text-white'
                    }`}
                  >
                    WhatsApp (Evolution)
                  </button>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-8 space-y-8">
                {activeDetailsTab === 'profile' ? (
                  <>
                    {/* Statistics Highlights */}
                    <div className="grid grid-cols-2 gap-4">
                      <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100">
                        <p className="text-[10px] font-black uppercase text-slate-400 mb-1">Total de Endereços</p>
                        <p className="text-xl font-display font-bold text-slate-800">
                          {(selectedClientDetail.properties || []).length + 1} <span className="text-xs font-medium text-slate-400">Locais</span>
                        </p>
                      </div>
                      <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100">
                        <p className="text-[10px] font-black uppercase text-slate-400 mb-1">Propriedades</p>
                        <p className="text-xl font-display font-bold text-slate-800">
                          {(selectedClientDetail.properties || []).length} <span className="text-xs font-medium text-slate-400">Unid.</span>
                        </p>
                      </div>
                    </div>

                    {/* Vigência do Cadastro */}
                    {(() => {
                      const statusObj = getRegistrationStatus(selectedClientDetail.registrationExpiredAt);
                      return (
                        <div className={cn(
                          "p-5 rounded-2xl border flex flex-col md:flex-row md:items-center justify-between gap-4 transition-all",
                          statusObj.status === 'expired' ? "bg-rose-50 border-rose-200" :
                          statusObj.status === 'warning' ? "bg-amber-50 border-amber-200" :
                          "bg-emerald-50 border-emerald-100"
                        )}>
                          <div>
                            <p className="text-[9px] font-black uppercase text-slate-400 leading-none">Vigência do Cadastro de Produtor</p>
                            <h4 className={cn(
                              "text-sm font-bold mt-1",
                              statusObj.status === 'expired' ? "text-rose-800" :
                              statusObj.status === 'warning' ? "text-amber-800" :
                              "text-emerald-800"
                            )}>
                              {statusObj.status === 'expired' ? 'Cadastro Expirado (Necessita Recadastro)' :
                               statusObj.status === 'warning' ? 'Cadastro Expirando em Breve' : 'Situação Regular / Vigência Ativa'}
                            </h4>
                            <p className="text-[11px] text-slate-500 mt-1">
                              Última Atualização: <span className="font-mono font-bold">{selectedClientDetail.lastRegistrationUpdateAt ? formatDate(selectedClientDetail.lastRegistrationUpdateAt) : 'Não Registrada'}</span> • Vence em: <span className="font-mono font-bold">{selectedClientDetail.registrationExpiredAt ? formatDate(selectedClientDetail.registrationExpiredAt) : 'Não Atribuído'}</span>
                            </p>
                          </div>
                          
                          <button 
                            onClick={() => openRenewalModal(selectedClientDetail)}
                            className={cn(
                              "px-4 py-2 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-all shadow-sm shrink-0",
                              statusObj.status === 'expired' ? "bg-rose-600 text-white hover:bg-rose-700" :
                              statusObj.status === 'warning' ? "bg-amber-600 text-white hover:bg-amber-700" :
                              "bg-emerald-600 text-white hover:bg-emerald-700"
                            )}
                          >
                            <RefreshCw className="w-3.5 h-3.5" /> Revisar e Renovar
                          </button>
                        </div>
                      );
                    })()}

                    {/* Details Sections */}
                    <div className="space-y-6">
                      <section>
                        <h4 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                           <User className="w-4 h-4 text-emerald-600" /> Contato e Identificação
                        </h4>
                        <div className="grid grid-cols-2 gap-y-4">
                          <div>
                            <p className="text-[10px] font-bold text-slate-400 uppercase">CPF</p>
                            <p className="text-sm font-bold text-slate-700">{formatCPF(selectedClientDetail.cpf)}</p>
                          </div>
                          <div>
                            <p className="text-[10px] font-bold text-slate-400 uppercase">WhatsApp / Tel</p>
                            <p className="text-sm font-bold text-slate-700">{formatPhone(selectedClientDetail.phone)}</p>
                          </div>
                          <div className="col-span-2">
                            <p className="text-[10px] font-bold text-slate-400 uppercase">E-mail</p>
                            <p className="text-sm font-bold text-slate-700">{selectedClientDetail.ownerEmail}</p>
                          </div>
                        </div>
                      </section>

                      <section>
                        <h4 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                           <MapPin className="w-4 h-4 text-emerald-600" /> Endereço Principal
                        </h4>
                        <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100">
                          {/* Endereço é opcional (cadastro simplificado): sem ele a ficha quebrava */}
                          {selectedClientDetail.address ? (
                            <>
                              <p className="text-sm font-bold text-slate-700">{selectedClientDetail.address.street}, {selectedClientDetail.address.number}</p>
                              <p className="text-xs text-slate-500">{selectedClientDetail.address.neighborhood} — {selectedClientDetail.address.city}/{selectedClientDetail.address.state}</p>
                              <p className="text-[10px] font-bold text-slate-400 uppercase mt-2">CEP: {selectedClientDetail.address.cep}</p>
                            </>
                          ) : (
                            <p className="text-sm text-slate-400">Endereço não informado</p>
                          )}
                        </div>
                      </section>

                      <section>
                        <h4 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                           <LandPlot className="w-4 h-4 text-emerald-600" /> Detalhes das Propriedades
                        </h4>
                        <div className="space-y-3">
                          {(selectedClientDetail.properties || []).map((prop, idx) => (
                            <div key={idx} className="flex justify-between items-center p-4 bg-white border border-slate-100 rounded-2xl hover:border-emerald-200 transition-all">
                              <div>
                                <p className="text-sm font-bold text-slate-800">{prop.name}</p>
                                <p className="text-[10px] font-medium text-slate-500 leading-tight">
                                  {prop.number ? `Nº ${prop.number}` : 'S/N'} • {prop.neighborhood || 'Sem bairro'} • {prop.city}/{prop.state}
                                </p>
                                {prop.cep && <p className="text-[9px] text-slate-400">CEP: {prop.cep}</p>}
                              </div>
                              <button className="text-[10px] font-black text-emerald-600 hover:bg-emerald-50 px-3 py-1.5 rounded-lg transition-all">MAPA</button>
                            </div>
                          ))}
                        </div>
                      </section>
                    </div>
                  </>
                ) : activeDetailsTab === 'timeline' ? (
                  <div className="space-y-6">
                    <h4 className="text-xs font-black text-slate-400 uppercase tracking-widest flex items-center gap-2 mb-2">
                      <TrendingUp className="w-4 h-4 text-slate-500" /> Registro Geral de Operação
                    </h4>

                    {timelineLoading ? (
                      <div className="py-12 text-center text-slate-400 text-xs">
                        Sincronizando feed de eventos...
                      </div>
                    ) : timelineEvents.length === 0 ? (
                      <div className="py-12 bg-slate-50 rounded-2xl border text-center p-6">
                        <Calendar className="w-10 h-10 text-slate-300 mx-auto mb-2" />
                        <h5 className="font-bold text-slate-700 text-xs">Nenhum evento histórico protocolado</h5>
                        <p className="text-[11px] text-slate-400 mt-1">Este cliente não possui faturamentos, visitas de campo, agendamentos ou serviços registrados.</p>
                      </div>
                    ) : (
                      <div className="relative border-l-2 border-slate-150 ml-4 pl-6 space-y-6">
                        {timelineEvents.map((evt) => {
                          const IconComp = 
                            evt.type === 'visit' ? ClipboardList :
                            evt.type === 'contract' ? FileText :
                            evt.type === 'message' ? Mail :
                            evt.type === 'appointment' ? CalendarClock : DollarSign;

                          const themeColorClass = 
                            evt.type === 'visit' ? 'bg-emerald-500 text-white shadow-emerald-50' :
                            evt.type === 'contract' ? 'bg-emerald-500 text-white shadow-emerald-50' :
                            evt.type === 'message' ? 'bg-emerald-500 text-white shadow-emerald-50' :
                            evt.type === 'appointment' ? 'bg-slate-700 text-white shadow-slate-100' : 'bg-amber-500 text-white shadow-amber-50';

                          const pillColor = 
                            evt.type === 'visit' ? 'bg-emerald-50 text-emerald-700 border border-emerald-100' :
                            evt.type === 'contract' ? 'bg-slate-50 text-slate-700 border border-slate-100' :
                            evt.type === 'message' ? 'bg-slate-50 text-slate-700 border border-slate-100' :
                            evt.type === 'appointment' ? 'bg-slate-100 text-slate-700 border border-slate-200' : 'bg-amber-50 text-amber-700 border border-amber-100';

                          return (
                            <div key={evt.id} className="relative text-left">
                              {/* Dot and line attachment */}
                              <div className={`absolute -left-[32px] top-1.5 w-5 h-5 rounded-full border-2 border-white flex items-center justify-center text-[9px] shadow-sm ${themeColorClass}`}>
                                <IconComp className="w-2.5 h-2.5" />
                              </div>

                              <div className="bg-white border rounded-2xl p-4 shadow-2xs hover:shadow-xs transition-shadow">
                                <div className="flex justify-between items-start gap-2">
                                  <div>
                                    <span className="text-[9px] font-bold text-slate-400 block font-mono">{formatDate(evt.date)}</span>
                                    <h5 className="font-bold text-slate-800 text-xs mt-0.5">{evt.title}</h5>
                                    <p className="text-[10px] text-slate-500 font-medium italic mt-0.5">{evt.subtitle}</p>
                                  </div>
                                  <span className={`px-2 py-0.5 rounded-md text-[8px] font-bold uppercase tracking-tight ${pillColor}`}>
                                    {evt.status}
                                  </span>
                                </div>
                                {evt.metadata && (
                                  <div className="text-[10px] text-slate-500 mt-2 bg-slate-50 p-2 rounded-lg font-mono">
                                    {evt.metadata}
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                ) : activeDetailsTab === 'services_projects' ? (
                  <div className="space-y-6 text-left">
                    <div className="flex items-center justify-between">
                      <h4 className="text-xs font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                        <FolderOpen className="w-4 h-4 text-emerald-600" /> Serviços & Projetos Ativos
                      </h4>
                      <button
                        onClick={() => setShowAddService(!showAddService)}
                        className="text-[10px] font-bold text-emerald-600 bg-emerald-50 hover:bg-emerald-100 px-3 py-1.5 rounded-lg transition-all flex items-center gap-1"
                      >
                        <Plus className="w-3.5 h-3.5" /> {showAddService ? 'Cancelar' : 'Novo Serviço'}
                      </button>
                    </div>

                    {showAddService ? (
                      <motion.form 
                        initial={{ opacity: 0, y: -10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="bg-slate-50 border border-slate-200 rounded-2xl p-5 space-y-4 text-left"
                        onSubmit={(e) => {
                          e.preventDefault();
                          const target = e.currentTarget;
                          runExclusive('Clients.addService', async () => {
                          const formData = new FormData(target);
                          const type = formData.get('type') as string;
                          const value = parseFloat(formData.get('value') as string) || 0;
                          const tech = formData.get('tech') as string;
                          const desc = formData.get('desc') as string;

                          if (!tech || !desc) {
                            toast.error('Preencha o técnico responsável e a descrição.');
                            return;
                          }

                          try {
                            const newService = {
                              clientId: selectedClientDetail.id,
                              clientName: selectedClientDetail.name,
                              type,
                              status: 'Em Andamento',
                              value,
                              responsibleTechnician: tech,
                              description: desc,
                              createdAt: new Date().toISOString(),
                              updatedAt: new Date().toISOString()
                            };

                            const addPromise1 = addDoc(collection(db, 'analyses'), newService);
                            if (hasValidConfig) {
                              await addPromise1;
                            }

                            // Send automatic Notification to this user about new service
                            const addPromise2 = addDoc(collection(db, 'notifications'), {
                              userId: user?.uid || '',
                              title: 'Novo Serviço Registrado',
                              message: `O serviço de ${
                                type === 'soil' ? 'Análise de Solo' : 
                                type === 'water' ? 'Análise de Água' :
                                type === 'foliar' ? 'Análise Foliar' :
                                type === 'topography' ? 'Projeto de Topografia' :
                                type === 'irrigation' ? 'Projeto de Irrigação' :
                                type === 'documentation' ? 'Regularização Ambiental' :
                                type === 'credit' ? 'Projeto de Crédito Rural' : 'Serviço'
                              } foi registrado para ${selectedClientDetail.name}.`,
                              type: 'success',
                              read: false,
                              createdAt: new Date()
                            });
                            if (hasValidConfig) {
                              await addPromise2;
                            }

                            toast.success('Serviço/Projeto registrado com sucesso!');
                            setShowAddService(false);
                          } catch (err) {
                            console.error(err);
                            toast.error('Erro ao registrar serviço.');
                          }
                          });
                        }}
                      >
                        <h5 className="text-[11px] font-bold text-slate-700 uppercase tracking-wider">Novo Registro de Serviço</h5>
                        
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label className="block text-[9px] font-black text-slate-400 uppercase mb-1">Tipo de Serviço</label>
                            <select name="type" className="w-full text-xs p-2.5 bg-white border border-slate-200 rounded-xl focus:border-emerald-500 focus:outline-none">
                              <option value="soil">Análise de Solo</option>
                              <option value="water">Análise de Água</option>
                              <option value="foliar">Análise Foliar</option>
                              <option value="topography">Projeto de Topografia</option>
                              <option value="irrigation">Projeto de Irrigação</option>
                              <option value="documentation">Regularização Ambiental</option>
                              <option value="credit">Projeto de Crédito Rural</option>
                            </select>
                          </div>
                          <div>
                            <label className="block text-[9px] font-black text-slate-400 uppercase mb-1">Valor do Serviço (R$)</label>
                            <input type="number" step="0.01" name="value" placeholder="1500.00" className="w-full text-xs p-2.5 bg-white border border-slate-200 rounded-xl focus:border-emerald-500 focus:outline-none" />
                          </div>
                        </div>

                        <div>
                          <label className="block text-[9px] font-black text-slate-400 uppercase mb-1">Responsável Técnico</label>
                          <input type="text" name="tech" placeholder="Nome do Engenheiro/Técnico" required className="w-full text-xs p-2.5 bg-white border border-slate-200 rounded-xl focus:border-emerald-500 focus:outline-none" />
                        </div>

                        <div>
                          <label className="block text-[9px] font-black text-slate-400 uppercase mb-1">Descrição / Escopo do Projeto</label>
                          <textarea name="desc" rows={3} placeholder="Descreva os detalhes e objetivos do serviço técnico..." required className="w-full text-xs p-2.5 bg-white border border-slate-200 rounded-xl focus:border-emerald-500 focus:outline-none resize-none"></textarea>
                        </div>

                        <button type="submit" className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition-all shadow-md shadow-emerald-100">
                          Salvar Serviço no CRM
                        </button>
                      </motion.form>
                    ) : null}

                    {clientAnalyses.length === 0 ? (
                      <div className="py-12 bg-slate-50 rounded-2xl border text-center p-6">
                        <FolderOpen className="w-10 h-10 text-slate-300 mx-auto mb-2" />
                        <h5 className="font-bold text-slate-700 text-xs">Nenhum projeto cadastrado</h5>
                        <p className="text-[11px] text-slate-400 mt-1">Este produtor rural não possui análises de solo, projetos de irrigação ou crédito rural em andamento.</p>
                      </div>
                    ) : (
                      <div className="space-y-4">
                        {clientAnalyses.map((a) => {
                          const typeLabels: Record<string, string> = {
                            soil: 'Análise de Solo',
                            water: 'Análise de Água',
                            foliar: 'Análise Foliar',
                            topography: 'Projeto de Topografia',
                            irrigation: 'Projeto de Irrigação',
                            documentation: 'Regularização Ambiental',
                            credit: 'Projeto de Crédito Rural',
                            environmental_xray: 'Raio-X Ambiental'
                          };
                          
                          const typeColors: Record<string, string> = {
                            soil: 'bg-amber-50 text-amber-700 border-amber-100',
                            water: 'bg-slate-50 text-slate-700 border-slate-100',
                            foliar: 'bg-emerald-50 text-emerald-700 border-emerald-100',
                            topography: 'bg-slate-50 text-slate-700 border-slate-100',
                            irrigation: 'bg-slate-50 text-slate-700 border-slate-100',
                            documentation: 'bg-slate-50 text-slate-700 border-slate-100',
                            credit: 'bg-rose-50 text-rose-700 border-rose-100',
                            environmental_xray: 'bg-slate-50 text-slate-700 border-slate-100'
                          };

                          return (
                            <div key={a.id} className="bg-white border border-slate-100 rounded-2xl p-5 hover:border-emerald-200 transition-all shadow-2xs">
                              <div className="flex justify-between items-start gap-2 mb-3">
                                <div>
                                  <span className={`px-2 py-0.5 rounded-md text-[8px] font-bold uppercase tracking-tight ${typeColors[a.type] || 'bg-slate-50 border border-slate-100'}`}>
                                    {typeLabels[a.type] || 'Análise'}
                                  </span>
                                  <h5 className="font-bold text-slate-800 text-xs mt-1.5">
                                    {typeLabels[a.type]}
                                  </h5>
                                  <p className="text-[10px] text-slate-400 mt-0.5">
                                    Criado em: <span className="font-mono font-bold">{formatDate(a.createdAt)}</span>
                                  </p>
                                </div>
                                <span className={cn(
                                  "px-2.5 py-1 rounded-xl text-[9px] font-bold uppercase tracking-wider border",
                                  a.status === 'Concluído' ? "bg-emerald-50 border-emerald-200 text-emerald-700" :
                                  a.status === 'Pendente' ? "bg-amber-50 border-amber-200 text-amber-700" :
                                  "bg-slate-50 border-slate-200 text-slate-700"
                                )}>
                                  {a.status || 'Em Progresso'}
                                </span>
                              </div>

                              <p className="text-[11px] text-slate-600 leading-relaxed bg-slate-50 p-3 rounded-xl border border-slate-100 mb-3 font-medium">
                                {a.description || 'Sem detalhes fornecidos.'}
                              </p>

                              <div className="flex justify-between items-center text-[10px] text-slate-500 font-semibold border-t border-slate-50 pt-3">
                                <div>
                                  Técnico: <span className="text-slate-700 font-bold">{a.responsibleTechnician || 'Não designado'}</span>
                                </div>
                                {a.value ? (
                                  <div className="text-emerald-600 font-bold font-mono">
                                    R$ {a.value.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                                  </div>
                                ) : (
                                  <div className="text-slate-400 italic">R$ 0,00</div>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="space-y-6 text-left pb-10">
                    <div className="flex items-center gap-2">
                      <MessageSquare className="w-5 h-5 text-emerald-600" />
                      <h4 className="text-sm font-bold text-slate-800">Evolution API WhatsApp</h4>
                    </div>

                    <p className="text-xs text-slate-500 leading-relaxed bg-emerald-50/50 p-3.5 rounded-2xl border border-emerald-100">
                      Dispare notificações automáticas de lembretes de visitas ou contratos usando a integração com a **Evolution API**. Configure as credenciais no seu arquivo `.env` para sincronizar os disparos reais.
                    </p>

                    <div className="space-y-4">
                      {/* Seleção de Template */}
                      <div>
                        <label className="text-[10px] font-bold text-slate-400 uppercase block mb-1.5 ml-1">Tipo de Notificação / Template</label>
                        <div className="grid grid-cols-3 gap-2">
                          <button
                            type="button"
                            onClick={() => handleTemplateTypeChange('custom')}
                            className={cn(
                              "px-3 py-2 text-xs font-bold rounded-xl border transition-all text-center cursor-pointer",
                              whatsappTemplate === 'custom'
                                ? "bg-emerald-600 border-emerald-600 text-white shadow-sm"
                                : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
                            )}
                          >
                            Mensagem Livre
                          </button>
                          <button
                            type="button"
                            onClick={() => handleTemplateTypeChange('visit')}
                            className={cn(
                              "px-3 py-2 text-xs font-bold rounded-xl border transition-all text-center cursor-pointer",
                              whatsappTemplate === 'visit'
                                ? "bg-emerald-600 border-emerald-600 text-white shadow-sm"
                                : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
                            )}
                          >
                            Lembrete de Visita
                          </button>
                          <button
                            type="button"
                            onClick={() => handleTemplateTypeChange('contract')}
                            className={cn(
                              "px-3 py-2 text-xs font-bold rounded-xl border transition-all text-center cursor-pointer",
                              whatsappTemplate === 'contract'
                                ? "bg-emerald-600 border-emerald-600 text-white shadow-sm"
                                : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
                            )}
                          >
                            Dados do Contrato
                          </button>
                        </div>
                      </div>

                      {/* Dependent dropdowns based on Template selection */}
                      {whatsappTemplate === 'visit' && (
                        <div className="space-y-2 animate-in fade-in slide-in-from-top-1 duration-200">
                          <label className="text-[10px] font-bold text-slate-400 uppercase block ml-1">Selecione a Visita Técnica Relacionada</label>
                          {detailClientVisits.length === 0 ? (
                            <p className="text-xs text-rose-600 font-semibold bg-rose-50 border border-rose-100 rounded-xl p-3">
                              Nenhuma visita técnica de campo registrada para este cliente.
                            </p>
                          ) : (
                            <select
                              value={selectedVisitId}
                              onChange={(e) => handleSelectVisitTemplate(e.target.value)}
                              className="glass-input text-xs w-full py-2 px-3 bg-white border border-slate-200 rounded-xl"
                            >
                              <option value="">-- Selecione uma visita do histórico --</option>
                              {detailClientVisits.map(visit => (
                                <option key={visit.id} value={visit.id}>
                                  {visit.visitDate ? formatDate(visit.visitDate) : '(Data S/N)'} - Técnico: {visit.technicianName || 'N/D'} ({visit.objective?.substring(0, 30) || 'Sem objetivo'})
                                </option>
                              ))}
                            </select>
                          )}
                        </div>
                      )}

                      {whatsappTemplate === 'contract' && (
                        <div className="space-y-2 animate-in fade-in slide-in-from-top-1 duration-200">
                          <label className="text-[10px] font-bold text-slate-400 uppercase block ml-1">Selecione o Contrato Alvo</label>
                          {detailClientContracts.length === 0 ? (
                            <p className="text-xs text-rose-600 font-semibold bg-rose-50 border border-rose-100 rounded-xl p-3">
                              Nenhum contrato assinado ou ativo para este cliente.
                            </p>
                          ) : (
                            <select
                              value={selectedContractId}
                              onChange={(e) => handleSelectContractTemplate(e.target.value)}
                              className="glass-input text-xs w-full py-2 px-3 bg-white border border-slate-200 rounded-xl"
                            >
                              <option value="">-- Selecione um contrato ativo --</option>
                              {detailClientContracts.map(contract => (
                                <option key={contract.id} value={contract.id}>
                                  Contrato {contract.contractNumber || 'S/N'} - {contract.title || 'Consultoria'} (R$ {(contract.value || 0).toLocaleString('pt-BR')})
                                </option>
                              ))}
                            </select>
                          )}
                        </div>
                      )}

                      {/* Destinatário (Celular/WhatsApp) */}
                      <div>
                        <label className="text-[10px] font-bold text-slate-400 uppercase block mb-1.5 ml-1">WhatsApp de Destino</label>
                        <div className="relative">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-xs font-mono font-bold">+55</span>
                          <input
                            type="text"
                            value={whatsappPhone}
                            onChange={(e) => setWhatsappPhone(e.target.value)}
                            placeholder="Ex: (45) 99999-9999"
                            className="glass-input pl-11 text-xs w-full py-2.5"
                          />
                        </div>
                        <span className="text-[9px] text-slate-400 mt-1 block leading-tight">
                          O número será higienizado automaticamente no backend, removendo espaços e caracteres especiais.
                        </span>
                      </div>

                      {/* Mensagem de Envio */}
                      <div>
                        <div className="flex justify-between items-center mb-1.5 ml-1">
                          <label className="text-[10px] font-bold text-slate-400 uppercase block">Conteúdo da Mensagem</label>
                          <span className="text-[9px] bg-emerald-100 text-emerald-800 font-black px-1.5 py-0.5 rounded uppercase">Suporta Markdown *Negrito*</span>
                        </div>
                        <textarea
                          rows={6}
                          value={whatsappMessage}
                          onChange={(e) => setWhatsappMessage(e.target.value)}
                          placeholder="Digite aqui o texto que deseja enviar ao cliente..."
                          className="glass-input text-xs w-full p-3 font-sans leading-relaxed focus:ring-emerald-500 focus:border-emerald-500"
                        />
                      </div>

                      {/* Botão de Envio */}
                      <button
                        type="button"
                        onClick={() => runExclusive('Clients.handleSendWhatsapp', () => handleSendWhatsapp())}
                        disabled={isSendingWhatsapp || !whatsappMessage.trim() || !whatsappPhone.trim()}
                        className="w-full py-3 bg-emerald-600 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-2 shadow-lg shadow-emerald-200 transition-all hover:bg-emerald-700 active:scale-95 disabled:opacity-50 disabled:pointer-events-none cursor-pointer"
                      >
                        {isSendingWhatsapp ? (
                          <>
                            <Loader2 className="w-4 h-4 animate-spin" />
                            Enviando via Evolution API...
                          </>
                        ) : (
                          <>
                            <Send className="w-4 h-4" />
                            Disparar Mensagem via WhatsApp
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                )}

                {/* Audit Trail for Admin */}
                {(user?.effectiveRole ?? user?.role) === 'admin' && (
                  <div className="pt-6 border-t border-slate-100">
                    <AuditTrail collectionName="clients" recordId={selectedClientDetail.id} />
                  </div>
                )}
              </div>

              {PERMISSIONS.canEditClient(((user?.effectiveRole ?? user?.role) as UserRole) || 'consultant') && (
                <div className="p-6 border-t border-slate-100 bg-slate-50 flex gap-3">
                  <button 
                    onClick={() => {
                      handleEditClick(selectedClientDetail);
                      setSelectedClientDetail(null);
                    }}
                    className="flex-1 py-3 bg-emerald-600 text-white rounded-xl text-sm font-bold flex items-center justify-center gap-2 shadow-lg shadow-emerald-200 transition-all active:scale-95"
                  >
                    <Edit2 className="w-4 h-4" /> Editar Perfil
                  </button>
                </div>
              )}
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {isModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-slate-900/40 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="relative glass-card w-full max-w-2xl p-0 shadow-2xl flex flex-col max-h-[90vh]"
            >
              <div className="p-6 border-b border-white/20 flex justify-between items-center bg-white/20">
                <div>
                  <h3 className="text-xl font-display font-bold">
                    {editingClientId ? 'Editar Cliente' : 'Cadastro de Cliente'}
                  </h3>
                  <div className="flex gap-4 mt-4">
                    {steps.map((step, i) => (
                      <div key={step.id} className="flex items-center gap-2">
                        <div className={cn(
                          "w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold transition-all",
                          currentStep === step.id ? "bg-emerald-600 text-white" : "bg-white/60 text-slate-400"
                        )}>
                          {i + 1}
                        </div>
                        <span className={cn(
                          "text-[10px] font-bold uppercase tracking-wider",
                          currentStep === step.id ? "text-emerald-700" : "text-slate-400"
                        )}>{step.label}</span>
                        {i < steps.length - 1 && <ChevronRight className="w-3 h-3 text-slate-300" />}
                      </div>
                    ))}
                  </div>
                </div>
                <button onClick={resetForm} className="p-2 hover:bg-white/60 rounded-full transition-colors">
                  <X className="w-5 h-5 text-slate-400" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-8">
                {currentStep === 'personal' && (
                  <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="space-y-4">
                    {/* Switcher to select simplified vs complete */}
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-bold text-slate-500 uppercase ml-1">Tipo de Cadastro</label>
                      <div className="flex bg-slate-100 p-1 rounded-xl">
                        <button
                          type="button"
                          onClick={() => {
                            setRegType('simplified');
                            setCurrentStep('personal');
                          }}
                          className={cn(
                            "flex-1 py-2 rounded-lg text-xs font-bold transition-all",
                            regType === 'simplified' 
                              ? "bg-white text-slate-800 shadow" 
                              : "text-slate-500 hover:text-slate-800"
                          )}
                        >
                          📝 Cadastro Simplificado (Rápido)
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setRegType('complete');
                            setCurrentStep('personal');
                          }}
                          className={cn(
                            "flex-1 py-2 rounded-lg text-xs font-bold transition-all",
                            regType === 'complete' 
                              ? "bg-white text-slate-800 shadow" 
                              : "text-slate-500 hover:text-slate-800"
                          )}
                        >
                          📂 Cadastro Completo (Dossiê)
                        </button>
                      </div>
                    </div>

                    {regType === 'simplified' ? (
                      <div className="space-y-4">
                        <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-1.5">
                            <label className="text-[10px] font-bold text-slate-500 uppercase ml-1">Nome Completo</label>
                            <input className="w-full glass-input" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} placeholder="Nome completo do produtor" />
                          </div>
                          <div className="space-y-1.5">
                            <div className="flex justify-between items-center ml-1">
                              <label className="text-[10px] font-bold text-slate-500 uppercase">CPF</label>
                              {formData.cpf.length > 0 && (
                                <span className={cn("text-[9px] font-bold uppercase", errors.cpf ? "text-rose-500" : "text-emerald-500")}>
                                  {errors.cpf ? (formData.cpf.replace(/\D/g, '').length < 11 ? "Incompleto" : "Inválido") : "Válido"}
                                </span>
                              )}
                            </div>
                            <input
                              className={cn("w-full glass-input", errors.cpf && "border-rose-500 bg-rose-50/10")}
                              value={formData.cpf}
                              onChange={e => {
                                const formatted = formatCPF(e.target.value);
                                setFormData({...formData, cpf: formatted});
                                if (formatted === '') {
                                  setErrors(prev => ({...prev, cpf: false}));
                                } else {
                                  setErrors(prev => ({...prev, cpf: !validateCPF(formatted)}));
                                }
                              }}
                              placeholder="000.000.000-00"
                            />
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-1.5">
                            <div className="flex justify-between items-center ml-1">
                              <label className="text-[10px] font-bold text-slate-500 uppercase">Email (Opcional)</label>
                              {formData.ownerEmail.length > 0 && (
                                <span className={cn("text-[9px] font-bold uppercase", errors.email ? "text-rose-500" : "text-emerald-500")}>
                                  {errors.email ? "Inválido" : "Válido"}
                                </span>
                              )}
                            </div>
                            <input 
                              className={cn("w-full glass-input", errors.email && "border-rose-500 bg-rose-50/10")} 
                              value={formData.ownerEmail} 
                              onChange={e => {
                                setFormData({...formData, ownerEmail: e.target.value});
                                setErrors(prev => ({...prev, email: e.target.value.trim() !== '' && !validateEmail(e.target.value)}));
                              }} 
                              placeholder="email@exemplo.com"
                            />
                          </div>
                          <div className="space-y-1.5">
                            <label className="text-[10px] font-bold text-slate-500 uppercase ml-1">Telefone</label>
                            <input
                              className="w-full glass-input"
                              value={formData.phone}
                              onChange={e => setFormData({...formData, phone: formatPhone(e.target.value)})}
                              placeholder="(00) 00000-0000"
                            />
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-1.5">
                            <label className="text-[10px] font-bold text-slate-500 uppercase ml-1">CEP do Endereço</label>
                            <input 
                              className="w-full glass-input" 
                              value={formData.address.cep} 
                              onBlur={handleCEPBlur} 
                              onChange={e => setFormData({...formData, address: {...formData.address, cep: e.target.value }})} 
                              placeholder="00000-000" 
                            />
                          </div>
                        </div>

                        <div className="bg-slate-50 p-4 rounded-xl border border-slate-100 space-y-3">
                          <span className="text-[10px] font-bold uppercase text-slate-400 block tracking-wider">Endereço Principal</span>
                          <div className="grid grid-cols-3 gap-2">
                            <div className="col-span-2 space-y-1">
                              <label className="text-[9px] font-bold text-slate-400 uppercase">Rua/Logradouro</label>
                              <input 
                                className="w-full glass-input text-xs py-1.5" 
                                value={formData.address.street} 
                                onChange={e => setFormData({...formData, address: {...formData.address, street: e.target.value }})} 
                                placeholder="Rua, Fazenda..." 
                              />
                            </div>
                            <div className="space-y-1">
                              <label className="text-[9px] font-bold text-slate-400 uppercase">Nº</label>
                              <input 
                                className="w-full glass-input text-xs py-1.5" 
                                value={formData.address.number} 
                                onChange={e => setFormData({...formData, address: {...formData.address, number: e.target.value }})} 
                                placeholder="Nº ou S/N" 
                              />
                            </div>
                          </div>
                          <div className="grid grid-cols-3 gap-2">
                            <div className="space-y-1">
                              <label className="text-[9px] font-bold text-slate-400 uppercase">Bairro</label>
                              <input 
                                className="w-full glass-input text-xs py-1.5" 
                                value={formData.address.neighborhood} 
                                onChange={e => setFormData({...formData, address: {...formData.address, neighborhood: e.target.value }})} 
                                placeholder="Bairro" 
                              />
                            </div>
                            <div className="space-y-1">
                              <label className="text-[9px] font-bold text-slate-400 uppercase">Cidade</label>
                              <input 
                                className="w-full glass-input text-xs py-1.5" 
                                value={formData.address.city} 
                                onChange={e => setFormData({...formData, address: {...formData.address, city: e.target.value }})} 
                                placeholder="Cidade" 
                              />
                            </div>
                            <div className="space-y-1">
                              <label className="text-[9px] font-bold text-slate-400 uppercase">UF</label>
                              <input 
                                className="w-full glass-input text-xs py-1.5" 
                                value={formData.address.state} 
                                onChange={e => setFormData({...formData, address: {...formData.address, state: e.target.value }})} 
                                placeholder="UF" 
                              />
                            </div>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-4">
                        <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-1.5">
                            <label className="text-[10px] font-bold text-slate-500 uppercase ml-1">Nome Completo</label>
                            <input className="w-full glass-input" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} placeholder="Nome completo do produtor" />
                          </div>
                          <div className="space-y-1.5">
                            <div className="flex justify-between items-center ml-1">
                              <label className="text-[10px] font-bold text-slate-500 uppercase">CPF</label>
                              {formData.cpf.length > 0 && (
                                <span className={cn("text-[9px] font-bold uppercase", errors.cpf ? "text-rose-500" : "text-emerald-500")}>
                                  {errors.cpf ? (formData.cpf.replace(/\D/g, '').length < 11 ? "Incompleto" : "Inválido") : "Válido"}
                                </span>
                              )}
                            </div>
                            <input 
                              id="client-cpf-input"
                              className={cn("w-full glass-input", errors.cpf && "border-rose-500 bg-rose-50/10")} 
                              value={formData.cpf} 
                              onChange={e => {
                                const formatted = formatCPF(e.target.value);
                                setFormData({...formData, cpf: formatted});
                                if (formatted === '') {
                                  setErrors(prev => ({...prev, cpf: false}));
                                } else {
                                  setErrors(prev => ({...prev, cpf: !validateCPF(formatted)}));
                                }
                              }} 
                              placeholder="000.000.000-00" 
                            />
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-1.5">
                            <div className="flex justify-between items-center ml-1">
                              <label className="text-[10px] font-bold text-slate-500 uppercase">Email</label>
                              {formData.ownerEmail.length > 0 && (
                                <span className={cn("text-[9px] font-bold uppercase", errors.email ? "text-rose-500" : "text-emerald-500")}>
                                  {errors.email ? "Inválido" : "Válido"}
                                </span>
                              )}
                            </div>
                            <input 
                              className={cn("w-full glass-input", errors.email && "border-rose-500 bg-rose-50/10")} 
                              value={formData.ownerEmail} 
                              onChange={e => {
                                setFormData({...formData, ownerEmail: e.target.value});
                                setErrors(prev => ({...prev, email: e.target.value.trim() !== '' && !validateEmail(e.target.value)}));
                              }}
                              placeholder="email@exemplo.com" 
                            />
                          </div>
                          <div className="space-y-1.5">
                            <label className="text-[10px] font-bold text-slate-500 uppercase ml-1">Telefone</label>
                            <input 
                              className="w-full glass-input" 
                              value={formData.phone} 
                              onChange={e => setFormData({...formData, phone: formatPhone(e.target.value)})} 
                              placeholder="(00) 00000-0000" 
                            />
                          </div>
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-[10px] font-bold text-slate-500 uppercase ml-1">Tipo de Cliente</label>
                          <div className="flex gap-4">
                            <button 
                              type="button" 
                              onClick={() => setFormData({...formData, clientType: 'pronaf'})}
                              className={cn("flex-1 p-4 rounded-2xl border flex flex-col gap-1 text-left transition-all", formData.clientType === 'pronaf' ? "bg-emerald-50 border-emerald-500 ring-2 ring-emerald-500/20" : "bg-white/40 border-white/60")}
                            >
                              <span className="font-bold text-sm">Pronafiano</span>
                              <span className="text-[10px] text-slate-500">Agricultor familiar enquadrado no Pronaf</span>
                            </button>
                            <button 
                              type="button" 
                              onClick={() => setFormData({...formData, clientType: 'rural_producer'})}
                              className={cn("flex-1 p-4 rounded-2xl border flex flex-col gap-1 text-left transition-all", formData.clientType === 'rural_producer' ? "bg-emerald-50 border-emerald-500 ring-2 ring-emerald-500/20" : "bg-white/40 border-white/60")}
                            >
                              <span className="font-bold text-sm">Produtor Rural</span>
                              <span className="text-[10px] text-slate-500">Produtores de médio e grande porte</span>
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                  </motion.div>
                )}

                {currentStep === 'address' && (
                  <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="space-y-6">
                    {/* Primary Address / Property */}
                    <div className="bg-white/40 p-5 rounded-2xl border border-white/60 space-y-4">
                      <h4 className="text-xs font-black uppercase text-emerald-800 tracking-wider flex items-center gap-2">
                        <MapPin className="w-4 h-4" /> Endereço Principal / Propriedade Sede
                      </h4>
                      
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div className="space-y-1.5">
                          <label className="text-[10px] font-bold text-slate-500 uppercase ml-1">CEP</label>
                          <input 
                            className="w-full glass-input" 
                            value={formData.address.cep} 
                            onBlur={handleCEPBlur} 
                            onChange={e => setFormData({...formData, address: {...formData.address, cep: e.target.value }})} 
                            placeholder="00000-000" 
                          />
                          <p className="text-[9px] text-slate-400 ml-1">Preencha o CEP para busca automática.</p>
                        </div>
                        <div className="md:col-span-2 space-y-1.5">
                          <label className="text-[10px] font-bold text-slate-500 uppercase ml-1">Rua, Fazenda ou Assentamento</label>
                          <input 
                            className="w-full glass-input" 
                            value={formData.address.street} 
                            onChange={e => setFormData({...formData, address: {...formData.address, street: e.target.value }})} 
                            placeholder="Nome do logradouro, fazenda, assentamento ou sítio..." 
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-1.5">
                          <div className="flex justify-between items-center ml-1">
                            <label className="text-[10px] font-bold text-slate-500 uppercase">Número</label>
                            <label className="flex items-center gap-1.5 text-[10px] font-medium text-slate-500 cursor-pointer select-none">
                              <input 
                                type="checkbox" 
                                checked={formData.address.noNumber || false} 
                                onChange={e => setFormData({
                                  ...formData, 
                                  address: {
                                    ...formData.address, 
                                    noNumber: e.target.checked,
                                    number: e.target.checked ? 'S/N' : ''
                                  }
                                })}
                                className="rounded text-emerald-600 focus:ring-emerald-500 w-3 h-3" 
                              />
                              Sem número
                            </label>
                          </div>
                          <input 
                            className="w-full glass-input" 
                            value={formData.address.number} 
                            disabled={formData.address.noNumber} 
                            onChange={e => setFormData({...formData, address: {...formData.address, number: e.target.value }})} 
                            placeholder={formData.address.noNumber ? "S/N" : "Ex: 120, Km 4"} 
                          />
                        </div>

                        <div className="space-y-1.5">
                          <div className="flex justify-between items-center ml-1">
                            <label className="text-[10px] font-bold text-slate-500 uppercase">Bairro / Comunidade</label>
                            <label className="flex items-center gap-1.5 text-[10px] font-medium text-slate-500 cursor-pointer select-none">
                              <input 
                                type="checkbox" 
                                checked={formData.address.noNeighborhood || false} 
                                onChange={e => setFormData({
                                  ...formData, 
                                  address: {
                                    ...formData.address, 
                                    noNeighborhood: e.target.checked,
                                    neighborhood: e.target.checked ? 'Sem Bairro / Comunidade' : ''
                                  }
                                })}
                                className="rounded text-emerald-600 focus:ring-emerald-500 w-3 h-3" 
                              />
                              Sem bairro
                            </label>
                          </div>
                          <input 
                            className="w-full glass-input" 
                            value={formData.address.neighborhood} 
                            disabled={formData.address.noNeighborhood} 
                            onChange={e => setFormData({...formData, address: {...formData.address, neighborhood: e.target.value }})} 
                            placeholder={formData.address.noNeighborhood ? "Sem bairro / comunidade" : "Ex: Centro, Comunidade rural"} 
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1.5">
                          <label className="text-[10px] font-bold text-slate-500 uppercase ml-1">Cidade</label>
                          <input 
                            className="w-full glass-input" 
                            value={formData.address.city} 
                            onChange={e => setFormData({...formData, address: {...formData.address, city: e.target.value }})} 
                            placeholder="Cidade" 
                          />
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-[10px] font-bold text-slate-500 uppercase ml-1">UF (Estado)</label>
                          <input 
                            className="w-full glass-input" 
                            value={formData.address.state} 
                            onChange={e => setFormData({...formData, address: {...formData.address, state: e.target.value }})} 
                            placeholder="Estado" 
                          />
                        </div>
                      </div>
                    </div>

                    {/* Additional Properties Section */}
                    <div className="bg-white/40 p-5 rounded-2xl border border-white/60 space-y-4">
                      <h4 className="text-xs font-black uppercase text-slate-700 tracking-wider flex items-center gap-2">
                        <LandPlot className="w-4 h-4 text-emerald-600" /> Outras Propriedades do Produtor
                      </h4>

                      {/* Added properties list */}
                      {formData.properties.length > 0 && (
                        <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                          {formData.properties.map((p, i) => (
                            <div key={i} className="flex justify-between items-start p-3 bg-white/70 rounded-xl border border-white/90 shadow-sm">
                              <div className="flex items-start gap-2.5 text-xs">
                                <Building2 className="w-4 h-4 text-emerald-500 mt-0.5" />
                                <div>
                                  <p className="font-bold text-slate-800">{p.name}</p>
                                  <p className="text-[10px] text-slate-500 leading-tight">
                                    {p.number ? `Nº ${p.number}` : 'S/N'} • {p.neighborhood || 'Sem bairro'} • {p.city}/{p.state}
                                  </p>
                                  {p.cep && <p className="text-[9px] text-slate-400">CEP: {p.cep}</p>}
                                </div>
                              </div>
                              <button 
                                type="button"
                                onClick={() => removeProperty(i)} 
                                className="text-rose-400 hover:text-rose-600 p-1 rounded-lg hover:bg-rose-50 transition-colors"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Collapse/Form to add other properties with exact same fields */}
                      {!showAddPropertyForm ? (
                        <button
                          type="button"
                          onClick={() => setShowAddPropertyForm(true)}
                          className="w-full py-3 bg-white/60 text-emerald-700 border border-emerald-200 hover:bg-emerald-50 hover:border-emerald-300 rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-all shadow-sm"
                        >
                          <Plus className="w-4 h-4" /> Adicionar Outra Propriedade
                        </button>
                      ) : (
                        <div className="border border-slate-200 bg-slate-50/50 p-4 rounded-xl space-y-4">
                          <div className="flex justify-between items-center pb-2 border-b border-slate-200/60">
                            <p className="text-[11px] font-bold text-emerald-700 uppercase tracking-wider">Nova Propriedade Adicional</p>
                            <button
                              type="button"
                              onClick={() => {
                                setShowAddPropertyForm(false);
                                setCurrentProperty({
                                  name: '', cep: '', street: '', number: '', noNumber: false,
                                  neighborhood: '', noNeighborhood: false, city: '', state: ''
                                });
                              }}
                              className="text-slate-400 hover:text-slate-600 text-[10px] font-bold uppercase tracking-wider transition-colors"
                            >
                              Cancelar
                            </button>
                          </div>
                          
                          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            <div className="space-y-1.5">
                              <label className="text-[10px] font-bold text-slate-500 uppercase ml-1">CEP</label>
                              <input 
                                className="w-full glass-input text-xs" 
                                value={currentProperty.cep} 
                                onBlur={handlePropertyCEPBlur} 
                                onChange={e => setCurrentProperty({...currentProperty, cep: e.target.value })} 
                                placeholder="00000-000" 
                              />
                            </div>
                            <div className="md:col-span-2 space-y-1.5">
                              <label className="text-[10px] font-bold text-slate-500 uppercase ml-1">Rua, Fazenda ou Assentamento</label>
                              <input 
                                className="w-full glass-input text-xs" 
                                value={currentProperty.street} 
                                onChange={e => setCurrentProperty({...currentProperty, street: e.target.value })} 
                                placeholder="Nome do logradouro, fazenda, assentamento ou sítio..." 
                              />
                            </div>
                          </div>

                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="space-y-1.5">
                              <div className="flex justify-between items-center ml-1">
                                <label className="text-[10px] font-bold text-slate-500 uppercase">Número</label>
                                <label className="flex items-center gap-1.5 text-[10px] font-medium text-slate-500 cursor-pointer select-none">
                                  <input 
                                    type="checkbox" 
                                    checked={currentProperty.noNumber || false} 
                                    onChange={e => setCurrentProperty({
                                      ...currentProperty, 
                                      noNumber: e.target.checked,
                                      number: e.target.checked ? 'S/N' : ''
                                    })}
                                    className="rounded text-emerald-600 focus:ring-emerald-500 w-3 h-3" 
                                  />
                                  Sem número
                                </label>
                              </div>
                              <input 
                                className="w-full glass-input text-xs" 
                                value={currentProperty.number} 
                                disabled={currentProperty.noNumber} 
                                onChange={e => setCurrentProperty({...currentProperty, number: e.target.value })} 
                                placeholder={currentProperty.noNumber ? "S/N" : "Número"} 
                              />
                            </div>

                            <div className="space-y-1.5">
                              <div className="flex justify-between items-center ml-1">
                                <label className="text-[10px] font-bold text-slate-500 uppercase">Bairro / Comunidade</label>
                                <label className="flex items-center gap-1.5 text-[10px] font-medium text-slate-500 cursor-pointer select-none">
                                  <input 
                                    type="checkbox" 
                                    checked={currentProperty.noNeighborhood || false} 
                                    onChange={e => setCurrentProperty({
                                      ...currentProperty, 
                                      noNeighborhood: e.target.checked,
                                      neighborhood: e.target.checked ? 'Sem Bairro / Comunidade' : ''
                                    })}
                                    className="rounded text-emerald-600 focus:ring-emerald-500 w-3 h-3" 
                                  />
                                  Sem bairro
                                </label>
                              </div>
                              <input 
                                className="w-full glass-input text-xs" 
                                value={currentProperty.neighborhood} 
                                disabled={currentProperty.noNeighborhood} 
                                onChange={e => setCurrentProperty({...currentProperty, neighborhood: e.target.value })} 
                                placeholder={currentProperty.noNeighborhood ? "Sem bairro" : "Bairro ou comunidade"} 
                              />
                            </div>
                          </div>

                          <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-1.5">
                              <label className="text-[10px] font-bold text-slate-500 uppercase ml-1">Cidade</label>
                              <input 
                                className="w-full glass-input text-xs" 
                                value={currentProperty.city} 
                                onChange={e => setCurrentProperty({...currentProperty, city: e.target.value })} 
                                placeholder="Cidade" 
                              />
                            </div>
                            <div className="space-y-1.5">
                              <label className="text-[10px] font-bold text-slate-500 uppercase ml-1">UF (Estado)</label>
                              <input 
                                className="w-full glass-input text-xs" 
                                value={currentProperty.state} 
                                onChange={e => setCurrentProperty({...currentProperty, state: e.target.value })} 
                                placeholder="Estado" 
                              />
                            </div>
                          </div>

                          <button 
                            type="button" 
                            onClick={addProperty}
                            className="w-full py-2 bg-emerald-600 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-2 hover:bg-emerald-700 shadow transition-all"
                          >
                            <Plus className="w-4 h-4" /> Salvar Propriedade Adicional
                          </button>
                        </div>
                      )}
                    </div>
                  </motion.div>
                )}

                {currentStep === 'documents' && (
                  <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="space-y-4">
                    <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100 flex items-center gap-3">
                      <ShieldCheck className="w-8 h-8 text-emerald-600 shrink-0" />
                      <div>
                        <h4 className="text-xs font-bold text-slate-800">Dossiê de Documentação do Produtor</h4>
                        <p className="text-[10px] text-slate-500">Envie os documentos oficiais para salvar na pasta de documentos gerais do cliente. Todos os campos são opcionais — você pode continuar o cadastro sem anexar nenhum e enviar depois.</p>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 gap-3 max-h-[45vh] overflow-y-auto pr-1">
                      {DOSSIE_DOC_ITEMS.map((docItem) => {
                        // Find if already exists in database
                        const dbFile = clientDocs.find(d => d.category === docItem.category);

                        // Find if locally selected
                        const tempFile = tempFiles[docItem.key];

                        const isUploaded = !!dbFile || !!tempFile;
                        const fileName = tempFile ? tempFile.name : (dbFile ? dbFile.name : '');

                        return (
                          <div key={docItem.key} className={cn(
                            "p-4 rounded-xl border flex items-center justify-between gap-4 transition-all bg-white",
                            isUploaded ? "border-emerald-200 bg-emerald-50/10" : "border-slate-100 hover:border-slate-200"
                          )}>
                            <div className="flex items-center gap-3 min-w-0">
                              <Paperclip className={cn("w-5 h-5 shrink-0", isUploaded ? "text-emerald-500" : "text-slate-400")} />
                              <div className="min-w-0">
                                <span className="text-[10px] font-bold uppercase text-slate-400 block tracking-wider flex items-center gap-1">
                                  {docItem.label}
                                  {docItem.req && <span className="text-rose-500">*</span>}
                                </span>
                                {isUploaded ? (
                                  <span className="text-xs font-medium text-slate-700 truncate block mt-0.5" title={fileName}>
                                    {fileName}
                                  </span>
                                ) : (
                                  <span className="text-xs text-slate-400 block mt-0.5">Nenhum arquivo enviado</span>
                                )}
                              </div>
                            </div>

                            <div className="flex items-center gap-2">
                              {isUploadingDoc === docItem.key ? (
                                <Loader2 className="w-5 h-5 animate-spin text-emerald-600" />
                              ) : isUploaded ? (
                                <div className="flex items-center gap-1">
                                  {dbFile?.url && (
                                    <a
                                      href={dbFile.url}
                                      onClick={(e) => handleFileLinkClick(e, dbFile.url, dbFile.name)}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="p-1.5 bg-slate-50 hover:bg-slate-100 text-slate-600 rounded-lg transition-colors border border-slate-200"
                                      title="Visualizar / Download"
                                    >
                                      <Download className="w-3.5 h-3.5" />
                                    </a>
                                  )}
                                  {(tempFile || (user?.effectiveRole ?? user?.role) === 'admin') && (
                                  <button
                                    type="button"
                                    onClick={async () => {
                                      if (tempFile) {
                                        setTempFiles(prev => {
                                          const next = { ...prev };
                                          delete next[docItem.key];
                                          return next;
                                        });
                                        toast.success('Seleção de arquivo removida.');
                                      } else if (dbFile) {
                                        const confirmDelete = await confirmAction({
                                          title: 'Remover documento?',
                                          description: `Deseja realmente remover o documento "${dbFile.name}" do dossiê?`,
                                          confirmLabel: 'Remover',
                                        });
                                        if (confirmDelete) {
                                          try {
                                            setIsUploadingDoc(docItem.key);
                                            if (dbFile.storagePath && hasValidConfig) {
                                              await deleteStoredFile(dbFile.storagePath).catch(err => console.warn('Arquivo antigo não encontrado', err));
                                            }
                                            const deletePromise = deleteDoc(doc(db, 'documents', dbFile.id));
                                            if (hasValidConfig) {
                                              await deletePromise;
                                            }
                                            toast.success('Documento removido do dossiê com sucesso.');
                                          } catch (err) {
                                            console.error(err);
                                            toast.error('Erro ao remover documento.');
                                          } finally {
                                            setIsUploadingDoc(null);
                                          }
                                        }
                                      }
                                    }}
                                    className="p-1.5 bg-rose-50 hover:bg-rose-100 text-rose-600 rounded-lg transition-colors border border-rose-100"
                                    title="Remover documento"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                  )}
                                </div>
                              ) : (
                                <label className="cursor-pointer px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold transition-all shadow-sm flex items-center gap-1">
                                  <Upload className="w-3.5 h-3.5" /> Enviar
                                  <input
                                    type="file"
                                    className="hidden"
                                    onChange={(e) => {
                                      const file = e.target.files?.[0];
                                      if (file && isTooLargeToSave(file)) {
                                        toast.error(uploadErrorMessage(new FileTooLargeError(file.name, file.size)));
                                        e.target.value = '';
                                        return;
                                      }
                                      if (file) {
                                        setTempFiles(prev => ({ ...prev, [docItem.key]: file }));
                                      }
                                    }}
                                  />
                                </label>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {editingClientId && (
                      <div className="pt-2">
                        <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100 flex items-center gap-3 mb-3">
                          <Calendar className="w-8 h-8 text-emerald-600 shrink-0" />
                          <div>
                            <h4 className="text-xs font-bold text-slate-800">Histórico de Visitas de Campo</h4>
                            <p className="text-[10px] text-slate-500">Visitas técnicas já registradas para este produtor, sincronizadas automaticamente da aba Visitas de Campo.</p>
                          </div>
                        </div>

                        {clientVisits.length === 0 ? (
                          <p className="text-xs text-slate-400 italic px-1">Nenhuma visita de campo registrada para este produtor ainda.</p>
                        ) : (
                          <div className="flex flex-col gap-2 max-h-[35vh] overflow-y-auto pr-1">
                            {clientVisits.map((visit) => (
                              <div key={visit.id} className="p-3 rounded-xl border border-slate-100 bg-white flex items-start gap-3">
                                <div className="w-8 h-8 rounded-lg bg-emerald-100 text-emerald-600 flex items-center justify-center shrink-0">
                                  <ClipboardList className="w-4 h-4" />
                                </div>
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center justify-between gap-2">
                                    <span className="text-xs font-bold text-slate-700">{formatDate(visit.visitDate)}</span>
                                    <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider truncate">{visit.propertyName || 'Propriedade não informada'}</span>
                                  </div>
                                  <p className="text-[11px] text-slate-600 mt-0.5 truncate">{visit.objective || 'Sem objetivo registrado'}</p>
                                  <p className="text-[10px] text-slate-400 mt-0.5">Técnico: {visit.technicianName || '—'}</p>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </motion.div>
                )}

                {currentStep === 'review' && (
                  <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div className="col-span-1 md:col-span-2 pb-4 border-b border-slate-100 flex items-center justify-between">
                        <div>
                          <span className="text-[10px] font-bold text-slate-400 uppercase">Modalidade do Cadastro</span>
                          <p className="text-sm font-bold text-slate-800">
                            {regType === 'simplified' ? '📝 Cadastro Simplificado (Rápido)' : '📂 Cadastro Completo (Dossiê)'}
                          </p>
                        </div>
                      </div>

                      <div className="space-y-4">
                         <div>
                            <div className="text-[10px] font-bold text-slate-400 uppercase">IDENTIFICAÇÃO</div>
                            <div className="mt-1 font-bold text-slate-800">{formData.name}</div>
                            {regType === 'complete' && <div className="text-xs text-slate-500">CPF: {formData.cpf}</div>}
                            <div className="text-xs text-slate-500">
                              {formData.phone ? formData.phone : 'Nenhum telefone'} | {formData.ownerEmail ? formData.ownerEmail : 'Nenhum e-mail'}
                            </div>
                         </div>
                         <div>
                            <div className="text-[10px] font-bold text-slate-400 uppercase">ENDEREÇO / PROPRIEDADE SEDE</div>
                            {formData.address.street ? (
                              <>
                                <div className="mt-1 text-xs text-slate-800">
                                  {formData.address.street}
                                  {formData.address.number ? `, ${formData.address.number}` : ' (S/N)'}
                                </div>
                                <div className="text-xs text-slate-800">
                                  {formData.address.neighborhood || 'Sem bairro'} — {formData.address.city}/{formData.address.state}
                                </div>
                                <div className="text-xs text-slate-500">CEP: {formData.address.cep}</div>
                              </>
                            ) : (
                              <p className="text-xs italic text-slate-400 mt-1">Nenhum endereço cadastrado</p>
                            )}
                         </div>
                      </div>
                      <div className="space-y-4">
                         {regType === 'complete' && (
                           <div>
                              <div className="text-[10px] font-bold text-slate-400 uppercase">ENQUADRAMENTO</div>
                              <span className="inline-block mt-1 px-2 py-0.5 bg-emerald-100 text-emerald-700 rounded-lg text-[10px] font-bold uppercase tracking-wider">
                                 {formData.clientType === 'pronaf' ? 'Pronafiano' : 'Produtor Rural'}
                              </span>
                           </div>
                         )}
                         {regType === 'complete' && (
                           <div>
                              <div className="text-[10px] font-bold text-slate-400 uppercase">PROPRIEDADES ADICIONAIS ({formData.properties.length})</div>
                              <div className="mt-2 space-y-2 max-h-36 overflow-y-auto pr-1">
                                 {formData.properties.map((p, i) => (
                                   <div key={i} className="text-xs p-2 bg-slate-50 rounded-xl border border-slate-150 flex flex-col gap-0.5">
                                      <span className="font-bold text-slate-700">{p.name}</span>
                                      <span className="text-[10px] text-slate-500 leading-none">
                                        {p.number ? `Nº ${p.number}` : 'S/N'} • {p.neighborhood || 'Sem bairro'} • {p.city}/{p.state}
                                      </span>
                                   </div>
                                 ))}
                                 {formData.properties.length === 0 && (
                                   <p className="text-[11px] italic text-slate-400">Nenhuma propriedade adicional cadastrada</p>
                                 )}
                              </div>
                           </div>
                         )}
                         {regType === 'complete' && (
                           <div>
                             <div className="text-[10px] font-bold text-slate-400 uppercase">DOCUMENTOS DO DOSSIÊ</div>
                             <div className="mt-1 text-xs text-slate-600">
                               {(() => {
                                 const filledSlots = DOSSIE_DOC_ITEMS.filter(item =>
                                   !!tempFiles[item.key] || clientDocs.some(d => d.category === item.category)
                                 ).length;
                                 return filledSlots > 0 ? (
                                   <span className="text-emerald-600 font-bold">
                                     ✓ {filledSlots} documento(s) anexado(s)
                                   </span>
                                 ) : (
                                   <span className="text-amber-600 italic">Nenhum documento anexado ao dossiê</span>
                                 );
                               })()}
                             </div>
                           </div>
                         )}
                      </div>
                    </div>
                    <div className="bg-emerald-50 border border-emerald-100 p-4 rounded-2xl flex gap-3 items-center">
                       <Check className="w-5 h-5 text-emerald-500" />
                       <p className="text-[10px] text-emerald-700 leading-tight">Revise todas as informações. Ao clicar em {editingClientId ? 'Confirmar' : 'Cadastrar'}, o cadastro do cliente será enviado e finalizado imediatamente.</p>
                    </div>
                  </motion.div>
                )}
              </div>

              <div className="p-6 border-t border-white/20 bg-white/20 flex gap-4">
                {currentStep !== 'personal' && (
                  <button 
                    onClick={() => {
                        if (currentStep === 'address') setCurrentStep('personal');
                        if (currentStep === 'documents') setCurrentStep('address');
                        if (currentStep === 'review') {
                            if (regType === 'simplified') setCurrentStep('personal');
                            else setCurrentStep('documents');
                        }
                    }}
                    className="px-6 py-3 border border-slate-200 rounded-xl text-sm font-bold text-slate-500 flex items-center gap-2"
                  >
                    <ChevronLeft className="w-4 h-4" /> Voltar
                  </button>
                )}
                
                {currentStep === 'personal' ? (
                   <button 
                    disabled={!(formData.name || '').trim() || (regType === 'complete' && (!formData.cpf || errors.cpf || !formData.ownerEmail || errors.email || !(formData.phone || '').trim())) || (regType === 'simplified' && (!formData.cpf || errors.cpf || !(formData.phone || '').trim() || ((formData.ownerEmail || '').trim() !== '' && errors.email)))}
                    onClick={() => {
                        if (regType === 'simplified') setCurrentStep('review');
                        else setCurrentStep('address');
                    }}
                    className={cn(
                      "flex-1 py-3 bg-emerald-600 text-white rounded-xl text-sm font-bold flex items-center justify-center gap-2 transition-opacity",
                      (!(formData.name || '').trim() || (regType === 'complete' && (!formData.cpf || errors.cpf || !formData.ownerEmail || errors.email || !(formData.phone || '').trim())) || (regType === 'simplified' && (!formData.cpf || errors.cpf || !(formData.phone || '').trim() || ((formData.ownerEmail || '').trim() !== '' && errors.email)))) && "opacity-50 cursor-not-allowed"
                    )}
                   >
                    Próximo Passo <ChevronRight className="w-4 h-4" />
                   </button>
                ) : currentStep !== 'review' ? (
                   <button 
                    onClick={() => {
                        if (currentStep === 'address') setCurrentStep('documents');
                        else if (currentStep === 'documents') setCurrentStep('review');
                    }}
                    className="flex-1 py-3 bg-emerald-600 text-white rounded-xl text-sm font-bold flex items-center justify-center gap-2"
                   >
                    Próximo Passo <ChevronRight className="w-4 h-4" />
                   </button>
                ) : (
                  <button
                    id="confirm-register-btn"
                    onClick={() => guardSubmit(handleAddClient)}
                    disabled={isSubmittingClient}
                    className="flex-1 py-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-sm font-bold flex items-center justify-center gap-2 shadow-lg shadow-emerald-200 cursor-pointer transition-all disabled:opacity-60 disabled:cursor-wait"
                  >
                    {isSubmittingClient ? 'Salvando...' : editingClientId ? 'Confirmar Alterações' : 'Cadastrar'} <Check className="w-4 h-4" />
                  </button>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {isRenewalModalOpen && renewalClient && (
          <div className="fixed inset-0 z-[110] flex items-center justify-center p-6 bg-slate-900/40 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="relative glass-card w-full max-w-lg p-0 shadow-2xl flex flex-col max-h-[90vh]"
            >
              <div className="p-6 border-b border-b-slate-100 flex justify-between items-center bg-white/20">
                <div>
                  <h3 className="text-lg font-display font-bold text-slate-800">
                    Revisar e Renovar Cadastro
                  </h3>
                  <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mt-0.5">
                    Contatos do Produtor: {renewalClient.name}
                  </p>
                </div>
                <button onClick={() => { setIsRenewalModalOpen(false); setRenewalClient(null); }} className="p-2 hover:bg-white/60 rounded-full transition-colors">
                  <X className="w-5 h-5 text-slate-400" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-6 space-y-4">
                <div className="p-4 bg-emerald-50 border border-emerald-100 rounded-2xl flex gap-3 items-center">
                  <Check className="w-5 h-5 text-emerald-500 shrink-0" />
                  <p className="text-[10px] text-emerald-800 leading-tight">
                    Confirmar as informações de contato abaixo renovará a validade do cadastro do produtor por <strong>1 ano (365 dias)</strong> na AgroGestão Pro.
                  </p>
                </div>

                <div className="space-y-4">
                  {/* Dados de Contato */}
                  <div>
                    <h4 className="text-[10px] font-black uppercase text-slate-400 tracking-wider mb-2">Dados de Contatos Atuais</h4>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1.5 font-sans">
                        <label className="text-[10px] font-bold text-slate-500 uppercase ml-1">E-mail</label>
                        <input 
                          type="email"
                          className={cn("w-full glass-input text-xs", renewalErrors.email && "border-rose-500 bg-rose-50/10")} 
                          value={renewalData.ownerEmail} 
                          onChange={e => {
                            setRenewalData({...renewalData, ownerEmail: e.target.value});
                            // E-mail é opcional aqui (nem todo cliente tem e-mail cadastrado
                            // — o cadastro "Simplificado" nem pede) — só marcamos erro se
                            // o campo tiver algo digitado e não for um e-mail válido.
                            setRenewalErrors(prev => ({...prev, email: e.target.value.trim() !== '' && !validateEmail(e.target.value)}));
                          }}
                          placeholder="email@exemplo.com (opcional)"
                        />
                      </div>
                      <div className="space-y-1.5 font-sans">
                        <label className="text-[10px] font-bold text-slate-500 uppercase ml-1">Telefone / WhatsApp</label>
                        <input 
                          type="text"
                          className="w-full glass-input text-xs" 
                          value={renewalData.phone} 
                          onChange={e => setRenewalData({...renewalData, phone: formatPhone(e.target.value)})} 
                          placeholder="(00) 00000-0000" 
                        />
                      </div>
                    </div>
                  </div>

                  {/* Endereço */}
                  <div>
                    <h4 className="text-[10px] font-black uppercase text-slate-400 tracking-wider mb-2">Confirmar Logradouro Principal</h4>
                    <div className="space-y-3">
                      <div className="grid grid-cols-3 gap-4">
                        <div className="space-y-1.5">
                          <label className="text-[10px] font-bold text-slate-500 uppercase ml-1">CEP</label>
                          <input 
                            className="w-full glass-input text-xs" 
                            value={renewalData.address.cep} 
                            onBlur={handleRenewalCEPBlur} 
                            onChange={e => setRenewalData({...renewalData, address: {...renewalData.address, cep: e.target.value }})} 
                            placeholder="00000-000" 
                          />
                        </div>
                        <div className="col-span-2 space-y-1.5">
                          <label className="text-[10px] font-bold text-slate-500 uppercase ml-1">Logradouro / Rua</label>
                          <input 
                            className="w-full glass-input text-xs" 
                            value={renewalData.address.street} 
                            onChange={e => setRenewalData({...renewalData, address: {...renewalData.address, street: e.target.value }})} 
                            placeholder="Rua..." 
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1.5">
                          <label className="text-[10px] font-bold text-slate-500 uppercase ml-1">Número / S/N</label>
                          <input 
                            className="w-full glass-input text-xs" 
                            value={renewalData.address.number} 
                            onChange={e => setRenewalData({...renewalData, address: {...renewalData.address, number: e.target.value }})} 
                            placeholder="Número" 
                          />
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-[10px] font-bold text-slate-500 uppercase ml-1">Bairro</label>
                          <input 
                            className="w-full glass-input text-xs" 
                            value={renewalData.address.neighborhood} 
                            onChange={e => setRenewalData({...renewalData, address: {...renewalData.address, neighborhood: e.target.value }})} 
                            placeholder="Bairro" 
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1.5">
                          <label className="text-[10px] font-bold text-slate-500 uppercase ml-1">Cidade</label>
                          <input 
                            className="w-full glass-input text-xs" 
                            value={renewalData.address.city} 
                            onChange={e => setRenewalData({...renewalData, address: {...renewalData.address, city: e.target.value }})} 
                            placeholder="Cidade" 
                          />
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-[10px] font-bold text-slate-500 uppercase ml-1">UF (Estado)</label>
                          <input 
                            className="w-full glass-input text-xs" 
                            value={renewalData.address.state} 
                            onChange={e => setRenewalData({...renewalData, address: {...renewalData.address, state: e.target.value }})} 
                            placeholder="Estado" 
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="p-4 border-t border-t-slate-100 bg-slate-50 flex gap-4">
                <button 
                  onClick={() => { setIsRenewalModalOpen(false); setRenewalClient(null); }}
                  className="px-4 py-2 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-500 hover:bg-slate-100 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  disabled={renewalErrors.email}
                  onClick={() => runExclusive('Clients.handleRenewalSubmit', () => handleRenewalSubmit())}
                  className={cn(
                    "flex-1 py-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-colors shadow-lg shadow-emerald-200",
                    renewalErrors.email && "opacity-50 cursor-not-allowed hover:bg-emerald-600 shadow-none"
                  )}
                >
                  Confirmar e Prorrogar Vigência <Check className="w-4 h-4" />
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <ConfirmationModal
        isOpen={!!isDeleteModalOpen}
        onClose={() => setIsDeleteModalOpen(null)}
        onConfirm={async () => {
          if (isDeleteModalOpen) {
            const targetClient = clients.find(c => c.id === isDeleteModalOpen);
            try {
              // Remove também o dossiê de documentos do cliente (Firestore + Storage),
              // pra não deixar arquivos e registros órfãos depois que o cliente some.
              if (hasValidConfig) {
                try {
                  const docsSnap = await getDocs(query(collection(db, 'documents'), where('clientId', '==', isDeleteModalOpen)));
                  await Promise.all(docsSnap.docs.map(async (docSnap) => {
                    const data = docSnap.data() as any;
                    if (data.storagePath) {
                      await deleteStoredFile(data.storagePath).catch((err) => console.warn('Arquivo do dossiê não encontrado:', err));
                    }
                    await deleteDoc(doc(db, 'documents', docSnap.id));
                  }));
                } catch (docErr) {
                  console.error('Erro ao remover documentos do dossiê do cliente:', docErr);
                }
              }

              const deletePromise = deleteDoc(doc(db, 'clients', isDeleteModalOpen));
              if (hasValidConfig) {
                await deletePromise;
              }

              await logAudit({
                userId: user?.uid || 'unknown',
                userName: user?.displayName || user?.email || 'Usuário',
                action: 'deleted',
                collection: 'clients',
                recordId: isDeleteModalOpen,
                recordName: targetClient ? targetClient.name : `Cliente ${isDeleteModalOpen}`,
                details: targetClient 
                  ? `Cliente/Produtor "${targetClient.name}" (CPF/CNPJ: ${targetClient.cpf}) foi removido permanentemente.`
                  : `Cliente ID ${isDeleteModalOpen} foi removido permanentemente.`,
                previousValues: targetClient || undefined
              });

              toast.success('Cliente removido com sucesso.');
            } catch (error) {
              handleFirestoreError(error, OperationType.DELETE, 'clients');
            }
          }
        }}
        title="Excluir Cliente e Dossiê?"
        description="Esta ação removerá permanentemente o produtor, seu histórico no dossiê de documentos anexados e todas as suas propriedades vinculadas da base de dados."
        confirmLabel="Confirmar Exclusão"
      />
    </div>
  );
}
