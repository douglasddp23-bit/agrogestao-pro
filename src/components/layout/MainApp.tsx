import React, { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useLocation, useNavigate } from 'react-router-dom';
import { 
  Search, 
  LayoutDashboard, 
  Users, 
  ClipboardCheck, 
  Map, 
  Droplet, 
  FileText, 
  UsersRound, 
  History, 
  Clock, 
  LogOut, 
  MessageSquare,
  Wallet,
  TrendingUp,
  User,
  Shield,
  ArrowRight,
  Upload,
  Building2,
  Sun,
  Moon,
  CheckCircle2,
  FileImage,
  Loader2,
  Trash2,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';
import { cn, handleFirestoreError, OperationType, shrinkImage, getAuthToken } from '../../lib/utils';
import { db } from '../../lib/firebase';
import { collection, onSnapshot, query, where, orderBy, doc, limit, setDoc } from 'firebase/firestore';
import { UserProfile, AttendanceRecord } from '../../types';
import { NAV_ITEMS } from '../../constants/navigation';
import { canAccessNav, UserRole, ROLE_LABELS } from '../../lib/permissions';
import { useGlobalSearch } from '../../hooks/useGlobalSearch';
import NotificationBell from './NotificationBell';
import QuickTipsTour from '../QuickTipsTour';

// Cada tela é um arquivo separado, baixado sob demanda (React.lazy). O mesmo
// "carregador" é usado para pré-baixar as telas em segundo plano (ver
// prefetchPage), então ao clicar numa aba o código dela já está pronto.
const PAGE_LOADERS: Record<string, () => Promise<{ default: React.ComponentType<any> }>> = {
  dashboard: () => import('../../pages/Dashboard'),
  clients: () => import('../../pages/Clients'),
  field_visits: () => import('../../pages/FieldVisits'),
  scheduling: () => import('../../pages/Scheduling'),
  'judicial-expertise': () => import('../../pages/JudicialExpertise'),
  analysis: () => import('../../pages/Analysis'),
  analysis_irrigation: () => import('../../pages/Irrigation'),
  analysis_documentation: () => import('../../pages/Regularization'),
  analysis_topography: () => import('../../pages/Topography'),
  analysis_credit: () => import('../../pages/RuralCredit'),
  rural_valuation: () => import('../../pages/RuralPropertyValuation'),
  pest_disease: () => import('../../pages/PestDisease'),
  environmental_xray: () => import('../../pages/EnvironmentalXray'),
  financial: () => import('../../pages/Financial'),
  reports: () => import('../../pages/Reports'),
  inventory: () => import('../../pages/Inventory'),
  property_map: () => import('../../pages/PropertyMap'),
  hr: () => import('../../pages/HR'),
  vehicles: () => import('../../pages/Vehicles'),
  users: () => import('../../pages/Users'),
  contracts: () => import('../../pages/Contracts'),
  documents: () => import('../../pages/Documents'),
  audit_logs: () => import('../../pages/AuditLogs'),
  messages: () => import('../../pages/Messages'),
  profile: () => import('../../pages/Profile'),
};

const prefetched = new Set<string>();
function prefetchPage(pageId: string) {
  const load = PAGE_LOADERS[pageId];
  if (!load || prefetched.has(pageId)) return;
  prefetched.add(pageId);
  load().catch(() => prefetched.delete(pageId));
}

const DashboardPage = React.lazy(PAGE_LOADERS.dashboard);
const ClientsPage = React.lazy(PAGE_LOADERS.clients);
const ContractsPage = React.lazy(PAGE_LOADERS.contracts);
const DocumentsPage = React.lazy(PAGE_LOADERS.documents);
const FinancialPage = React.lazy(PAGE_LOADERS.financial);
const HRPage = React.lazy(PAGE_LOADERS.hr);
const InventoryPage = React.lazy(PAGE_LOADERS.inventory);
const IrrigationPage = React.lazy(PAGE_LOADERS.analysis_irrigation);
const MessagesPage = React.lazy(PAGE_LOADERS.messages);
const ProfilePage = React.lazy(PAGE_LOADERS.profile);
const PropertyMapPage = React.lazy(PAGE_LOADERS.property_map);
const RegularizationPage = React.lazy(PAGE_LOADERS.analysis_documentation);
const ReportsPage = React.lazy(PAGE_LOADERS.reports);
const RuralCreditPage = React.lazy(PAGE_LOADERS.analysis_credit);
const SchedulingPage = React.lazy(PAGE_LOADERS.scheduling);
const TopographyPage = React.lazy(PAGE_LOADERS.analysis_topography);
const UsersPage = React.lazy(PAGE_LOADERS.users);
const VehiclesPage = React.lazy(PAGE_LOADERS.vehicles);
const FieldVisitsPage = React.lazy(PAGE_LOADERS.field_visits);
const AnalysisPage = React.lazy(PAGE_LOADERS.analysis);
const AuditLogsPage = React.lazy(PAGE_LOADERS.audit_logs);
const JudicialExpertisePage = React.lazy(PAGE_LOADERS['judicial-expertise']);
const RuralPropertyValuationPage = React.lazy(PAGE_LOADERS.rural_valuation);
const PestDiseasePage = React.lazy(PAGE_LOADERS.pest_disease);
const EnvironmentalXrayPage = React.lazy(PAGE_LOADERS.environmental_xray);

const PageFallback = () => (
  <div className="flex items-center justify-center h-full">
    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-600" />
  </div>
);

const shakeVariants = {
  shake: {
    x: [0, -10, 10, -10, 10, -5, 5, -2, 2, 0],
    transition: { duration: 0.5, ease: "easeInOut" }
  },
  default: {
    x: 0
  }
};

type Page = 'dashboard' | 'clients' | 'scheduling' | 'analysis' | 'analysis_irrigation' | 'analysis_documentation' | 'analysis_topography' | 'analysis_credit' | 'pest_disease' | 'environmental_xray' | 'property_map' | 'judicial-expertise' | 'judicial_expertise' | 'rural-valuation' | 'rural_valuation' | 'hr' | 'messages' | 'documents' | 'users' | 'profile' | 'financial' | 'inventory' | 'field_visits' | 'contracts' | 'reports' | 'vehicles' | 'audit_logs';

const getRoleBadgeClass = (role?: UserRole) => {
  switch (role) {
    case 'admin': return 'bg-slate-800 text-white border-slate-800';
    case 'manager': return 'bg-emerald-600 text-white border-emerald-600';
    case 'hr': return 'bg-slate-100 text-slate-700 border-slate-300';
    case 'consultant': return 'bg-emerald-100 text-emerald-700 border-emerald-200';
    default: return 'bg-slate-100 text-slate-700 border-slate-200';
  }
};

export default function MainApp() {
  const { user, logout, updateUserPassword, updateUserProfile } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  const [isDarkMode, setIsDarkMode] = useState(() => {
    const saved = localStorage.getItem('agrogestao-darkmode');
    if (saved !== null) {
      return saved === 'true';
    }
    return false;
  });

  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add('dark');
      document.body.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
      document.body.classList.remove('dark');
    }
    localStorage.setItem('agrogestao-darkmode', String(isDarkMode));
  }, [isDarkMode]);

  useEffect(() => {
    if (user) {
      if (typeof user.darkMode === 'boolean') {
        if (user.darkMode !== isDarkMode) {
          setIsDarkMode(user.darkMode);
        }
      } else {
        updateUserProfile({ darkMode: isDarkMode });
      }
    }
  }, [user]);

  const toggleDarkMode = () => {
    const newMode = !isDarkMode;
    setIsDarkMode(newMode);
    if (user) {
      updateUserProfile({ darkMode: newMode });
    }
  };

  const pathPart = location.pathname.substring(1);
  const currentPage = (pathPart || 'dashboard') as Page;

  const changePage = (page: Page) => {
    navigate(`/${page}`);
  };

  // Route authorization check & auto-redirect
  useEffect(() => {
    if (!user) return;
    const activeRole = (user.effectiveRole ?? user.role) as UserRole;
    if (!activeRole) return;
    const currentPath = location.pathname.substring(1) || 'dashboard';
    if (currentPath === 'profile' || currentPath === 'dashboard') return;

    const navItem = NAV_ITEMS.find(item => item.id === currentPath || item.key === currentPath);
    const navKey = navItem ? navItem.key : currentPath;

    if (!canAccessNav(activeRole, navKey)) {
      toast.error('Você não tem permissão para acessar esta área.');
      navigate('/dashboard', { replace: true });
    }
  }, [location.pathname, user?.role, user?.effectiveRole, navigate]);

  const activeRole = (user?.effectiveRole ?? user?.role) as UserRole;
  const canEditBranding = activeRole === 'admin' || activeRole === 'manager' || activeRole === 'hr';

  const [isProfileOpen, setIsProfileOpen] = useState(false);
  
   const [unreadMessagesCount, setUnreadMessagesCount] = useState(0);
  
  const [branding, setBranding] = useState({
    companyName: 'AgroGestão',
    companyLogo: '',
    companyPhrase: 'Almenara, MG',
  });
  const [isBrandingModalOpen, setIsBrandingModalOpen] = useState(false);
  const [brandingInput, setBrandingInput] = useState({
    companyName: '',
    companyLogo: '',
    companyPhrase: '',
  });
  const [brandingSaving, setBrandingSaving] = useState(false);
  const [brandingSaved, setBrandingSaved] = useState(false);
  const [brandingError, setBrandingError] = useState(false);
  const [shouldShake, setShouldShake] = useState(false);
  const [uploadedFileName, setUploadedFileName] = useState('');
  const [uploadedFileSize, setUploadedFileSize] = useState('');
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isUploading, setIsUploading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => {
    const unsubBranding = onSnapshot(doc(db, 'settings', 'branding'), (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.data();
        setBranding({
          companyName: data.companyName || 'AgroGestão',
          companyLogo: data.companyLogo || '',
          companyPhrase: data.companyPhrase || 'Almenara, MG',
        });
      }
    });

    return () => unsubBranding();
  }, []);

  const openBrandingModal = () => {
    if (canEditBranding) {
      setBrandingInput({
        companyName: branding.companyName,
        companyLogo: branding.companyLogo,
        companyPhrase: branding.companyPhrase,
      });
      setUploadedFileName(branding.companyLogo ? 'logotipo_atual.png' : '');
      setUploadedFileSize('');
      setUploadProgress(branding.companyLogo ? 100 : 0);
      setIsUploading(false);
      setIsDragging(false);
      setBrandingSaved(false);
      setBrandingError(false);
      setShouldShake(false);
      setIsBrandingModalOpen(false); // reset any visual glitches
      setTimeout(() => setIsBrandingModalOpen(true), 10);
    }
  };

  const handleSaveBranding = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!(brandingInput.companyName || '').trim()) {
      setBrandingError(true);
      setShouldShake(true);
      setTimeout(() => setShouldShake(false), 500);
      return;
    }
    setBrandingSaving(true);
    try {
      await setDoc(doc(db, 'settings', 'branding'), {
        companyName: (brandingInput.companyName || '').trim(),
        companyLogo: brandingInput.companyLogo,
        companyPhrase: (brandingInput.companyPhrase || '').trim(),
      });
      setBrandingSaved(true);
      setTimeout(() => {
        setIsBrandingModalOpen(false);
        setBrandingSaved(false);
      }, 1500);
    } catch (err) {
      console.error("Error saving branding settings:", err);
      toast.error('Não foi possível salvar a marca. Verifique sua conexão e se você tem permissão para alterar a marca.');
    } finally {
      setBrandingSaving(false);
    }
  };

  const processFile = (file: File) => {
    if (!file.type.startsWith('image/')) {
      toast.error('Por favor, selecione um arquivo de imagem válido (.png, .jpg, .svg, .webp)');
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      toast.error('A imagem deve ter no máximo 5MB.');
      return;
    }

    setUploadedFileName(file.name);
    setUploadedFileSize(
      file.size / 1024 < 1024
        ? `${(file.size / 1024).toFixed(1)} KB`
        : `${(file.size / (1024 * 1024)).toFixed(2)} MB`
    );
    setIsUploading(true);
    setUploadProgress(15);

    const reader = new FileReader();

    reader.onprogress = (e) => {
      if (e.lengthComputable) {
        const percent = Math.round((e.loaded / e.total) * 80);
        setUploadProgress(Math.max(15, percent));
      }
    };

    reader.onload = async () => {
      const original = reader.result as string;
      setUploadProgress(85);
      // O logo é salvo dentro de um documento do Firestore (limite de 1 MB),
      // então reduzimos a imagem para no máximo 512px antes de guardar.
      let base64String = original;
      try {
        base64String = await shrinkImage(original, 512);
      } catch {
        // SVG ou formato que o canvas não lê: segue com o original
      }
      if (base64String.length > 900 * 1024) {
        setIsUploading(false);
        setUploadProgress(0);
        toast.error('Imagem muito grande mesmo após redução. Use um PNG ou JPG menor.');
        return;
      }
      setUploadProgress(100);
      setBrandingInput((prev) => ({ ...prev, companyLogo: base64String }));
      setTimeout(() => {
        setIsUploading(false);
        toast.success('Imagem carregada com sucesso!');
      }, 250);
    };

    reader.onerror = () => {
      setIsUploading(false);
      setUploadProgress(0);
      toast.error('Erro ao processar imagem.');
    };

    reader.readAsDataURL(file);
  };

  const handleLogoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      processFile(file);
    }
    // reset input value so re-uploading same file triggers change
    e.target.value = '';
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      processFile(file);
    }
  };

  useEffect(() => {
    if (!user) return;

    // Unread messages
    const qUnreadMessages = query(
      collection(db, 'messages'),
      where('recipientId', '==', user.uid),
      where('isRead', '==', false),
      where('isDraft', '==', false)
    );
    const unsubscribeUnreadMessages = onSnapshot(qUnreadMessages, (snapshot) => {
      setUnreadMessagesCount(snapshot.size);
    });

    return () => {
      unsubscribeUnreadMessages();
    };
  }, [user?.uid]);

  // Depois que o sistema abre, baixa em segundo plano (quando o PC está
  // ocioso) o código de todas as telas que este usuário pode acessar.
  useEffect(() => {
    if (!user?.uid) return;
    const role = (user.effectiveRole ?? user.role) as UserRole;
    const ids = [
      ...NAV_ITEMS.filter(item => canAccessNav(role, item.key)).map(item => item.id),
      'messages',
      'profile',
    ];
    const idle: (cb: () => void) => void = (window as any).requestIdleCallback
      ? (cb) => (window as any).requestIdleCallback(cb, { timeout: 2000 })
      : (cb) => setTimeout(cb, 150);
    let cancelled = false;
    let i = 0;
    const next = () => {
      if (cancelled || i >= ids.length) return;
      prefetchPage(ids[i++]);
      idle(next);
    };
    const t = setTimeout(next, 1200);
    return () => { cancelled = true; clearTimeout(t); };
  }, [user?.uid, user?.role, user?.effectiveRole]);

  // Validade da senha (troca obrigatória a cada 30 dias): ao abrir o sistema,
  // avisa quando faltam 5 dias ou menos. Se já venceu (sessão aberta há dias),
  // o servidor marca a ficha e recarregamos para cair na tela de troca.
  useEffect(() => {
    if (!user?.uid || user.isVirtual) return;
    let cancelled = false;
    (async () => {
      try {
        const token = await getAuthToken();
        if (!token) return;
        const r = await fetch('/api/password-status', { headers: { Authorization: `Bearer ${token}` } });
        if (!r.ok || cancelled) return;
        const s = await r.json();
        if (s.expired) {
          // Só uma vez por sessão (evita recarregar sem parar se algo falhar)
          if (!sessionStorage.getItem('pwd_expired_reload')) {
            sessionStorage.setItem('pwd_expired_reload', '1');
            window.location.reload();
          }
          return;
        }
        const warnKey = `pwd_warned_${user.uid}`;
        if (s.daysLeft <= (s.warnDays ?? 5) && !sessionStorage.getItem(warnKey)) {
          sessionStorage.setItem(warnKey, '1');
          toast.warning(
            s.daysLeft <= 1 ? 'Sua senha vence amanhã' : `Sua senha vence em ${s.daysLeft} dias`,
            {
              id: 'password-expiry-warning',
              description: 'Troque agora para não ser obrigado a trocar no próximo acesso.',
              duration: 12000,
              action: { label: 'Trocar senha', onClick: () => navigate('/profile?trocarSenha=1') },
            }
          );
        }
      } catch {
        // sem rede: tenta de novo no próximo acesso
      }
    })();
    return () => { cancelled = true; };
  }, [user?.uid]);

  const [globalSearch, setGlobalSearch] = useState('');
  const { results: searchResults, loading: searchLoading } = useGlobalSearch(globalSearch);
  const [showSearchResults, setShowSearchResults] = useState(false);

  const handleSearchResultClick = (page: Page) => {
    navigate(`/${page}`);
    setGlobalSearch('');
    setShowSearchResults(false);
  };

  const renderPage = () => {
    // Role protection check
    const navItem = NAV_ITEMS.find(item => item.id === currentPage || item.key === currentPage);
    if (navItem && user) {
      if (!canAccessNav((user.effectiveRole ?? user.role) as UserRole, navItem.key)) {
        return (
          <div className="flex flex-col items-center justify-center h-full p-8 text-center bg-white rounded-3xl border border-slate-200 shadow-sm">
            <h3 className="text-xl font-display font-bold text-rose-500">Acesso Restrito</h3>
            <p className="text-sm text-slate-500 mt-2">Você não possui permissões necessárias para visualizar esta área do sistema.</p>
            <button 
              onClick={() => navigate('/dashboard')}
              className="mt-4 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold uppercase transition-all"
            >
              Voltar ao Dashboard
            </button>
          </div>
        );
      }
    }

    switch (currentPage) {
      case 'dashboard': return <DashboardPage />;
      case 'clients': return <ClientsPage />;
      case 'judicial-expertise':
      case 'judicial_expertise':
        return <JudicialExpertisePage />;
      case 'rural-valuation':
      case 'rural_valuation':
        return <RuralPropertyValuationPage />;
      case 'analysis': return <AnalysisPage typeFilter={undefined} />;
      case 'pest_disease': return <PestDiseasePage />;
      case 'environmental_xray': return <EnvironmentalXrayPage />;
      case 'property_map': return <PropertyMapPage />;
      case 'analysis_irrigation': return <IrrigationPage />;
      case 'analysis_documentation': return <RegularizationPage />;
      case 'analysis_topography': return <TopographyPage />;
      case 'analysis_credit': return <RuralCreditPage />;
      case 'hr': return <HRPage />;
      case 'users': return <UsersPage />;
      case 'messages': return <MessagesPage />;
      case 'documents': return <DocumentsPage />;
      case 'profile': return <ProfilePage />;
      case 'financial': return <FinancialPage />;
      case 'inventory': return <InventoryPage />;
      case 'field_visits': return <FieldVisitsPage />;
      case 'contracts': return <ContractsPage />;
      case 'reports': return <ReportsPage />;
      case 'vehicles': return <VehiclesPage />;
      case 'scheduling': return <SchedulingPage />;
      case 'audit_logs': return <AuditLogsPage />;
      default:
        return (
          <div className="flex flex-col items-center justify-center h-full gap-6 text-center">
            <div className="text-6xl font-light text-slate-200">404</div>
            <div>
              <p className="text-lg font-medium text-slate-700">Página não encontrada</p>
              <p className="text-sm text-slate-400 mt-1">
                A rota que você tentou acessar não existe.
              </p>
            </div>
            <button
              onClick={() => navigate('/dashboard')}
              className="px-6 py-2.5 bg-emerald-600 text-white rounded-xl text-sm font-medium hover:bg-emerald-700 transition-colors"
            >
              Voltar ao Dashboard
            </button>
          </div>
        );
    }
  };

  return (
    <div className="flex h-screen w-full p-6 gap-6 bg-slate-50 overflow-hidden">
      {/* Sidebar */}
      <aside className="w-64 flex flex-col gap-4 flex-shrink-0">
        <div 
          onClick={openBrandingModal}
          className={cn(
            "flex items-center gap-3 px-4 py-2 glass rounded-2xl select-none transition-all",
            canEditBranding && "cursor-pointer hover:bg-emerald-500/10 active:scale-95 border border-transparent hover:border-emerald-500/20"
          )}
          title={canEditBranding ? "Configurar Marca e Logo" : undefined}
        >
          {branding.companyLogo ? (
            <img 
              src={branding.companyLogo} 
              alt="Logo" 
              className="w-10 h-10 object-cover rounded-xl shadow-md border border-slate-100" 
            />
          ) : (
            <div className="w-10 h-10 bg-emerald-600 rounded-xl flex items-center justify-center text-white font-bold text-xl shadow-lg shadow-emerald-200">
              {branding.companyName ? branding.companyName.substring(0, 1).toUpperCase() : 'A'}
            </div>
          )}
          <div className="min-w-0">
            {/* Nome longo: diminui a letra e quebra em até 2 linhas (antes era cortado com "...") */}
            <span
              className={cn(
                "font-display font-bold tracking-tight text-slate-800 leading-tight block max-w-[165px] break-words line-clamp-3",
                (branding.companyName || '').length > 24 ? "text-sm" : (branding.companyName || '').length > 14 ? "text-base" : "text-xl"
              )}
              title={branding.companyName}
            >
              {branding.companyName}
            </span>
            <div className="flex items-center gap-1.5 mt-1">
              <span className={cn("px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider border", getRoleBadgeClass(user?.role as UserRole))}>
                {ROLE_LABELS[user?.role as UserRole] || user?.role}
              </span>
            </div>
          </div>
        </div>

        {/* Banner de Delegação Temporária Ativa */}
        {user?.effectiveRole && user.effectiveRole !== user.role && (
          <div 
            id="active-delegation-banner"
            className="flex items-start gap-2.5 px-3 py-2.5 bg-amber-50 text-amber-800 border border-amber-200 rounded-2xl shadow-xs transition-all animate-fadeIn"
            title={
              user.activeDelegationInfo 
                ? `Você está substituindo ${user.activeDelegationInfo.absentUserName} até ${user.activeDelegationInfo.endDate ? new Date(user.activeDelegationInfo.endDate + 'T12:00:00').toLocaleDateString('pt-BR') : 'prazo indeterminado'}`
                : `Você está atuando como ${ROLE_LABELS[user.effectiveRole] || user.effectiveRole}`
            }
          >
            <Users className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            <div className="min-w-0 flex-1 leading-tight">
              <div className="text-[10px] font-bold uppercase tracking-wider text-amber-700">Delegação Ativa</div>
              <div className="text-xs font-bold text-amber-900 truncate">
                Atuando como {ROLE_LABELS[user.effectiveRole] || user.effectiveRole}
              </div>
              {user.activeDelegationInfo?.absentUserName && (
                <div className="text-[11px] text-amber-700/90 truncate mt-0.5">
                  Substituindo {user.activeDelegationInfo.absentUserName}
                </div>
              )}
            </div>
          </div>
        )}
        
        <nav className="flex-1 flex flex-col gap-1 p-2 glass rounded-2xl overflow-y-auto custom-scrollbar">
          {['Operacional', 'Serviços', 'Gestão', 'Equipe/RH', 'Administrativo'].map(group => {
            const activeRole = (user?.effectiveRole ?? user?.role) as UserRole;
            const visibleItems = NAV_ITEMS.filter(item => {
              if (item.group !== group) return false;
              return canAccessNav(activeRole, item.key);
            });
            if (visibleItems.length === 0) return null;
            return (
              <React.Fragment key={group}>
                <div className="px-3 py-2 text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-2">{group}</div>
                {visibleItems.map(item => (
                  <button
                    key={item.id}
                    id={`nav-${item.id}`}
                    onMouseEnter={() => prefetchPage(item.id)}
                    onFocus={() => prefetchPage(item.id)}
                    onClick={() => changePage(item.id as Page)}
                    className={cn(
                      "flex items-center justify-between px-4 py-2 rounded-xl font-medium transition-all group",
                      currentPage === item.id 
                        ? "bg-emerald-500/10 text-emerald-700 shadow-sm" 
                        : "hover:bg-white/50 text-slate-600"
                    )}
                  >
                    <div className="flex items-center gap-3">
                      <item.icon className={cn("w-5 h-5", currentPage === item.id ? "text-emerald-600" : "text-slate-400 group-hover:text-slate-600")} />
                      <span className="text-sm">{item.label}</span>
                    </div>
                  </button>
                ))}
              </React.Fragment>
            );
          })}
        </nav>
        
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col gap-6 overflow-hidden">
        <header className="flex items-center justify-between shrink-0">
          <div className="flex items-center gap-4 flex-1">
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input 
                id="global-search"
                type="text" 
                placeholder="Busca Global (Produtores, Serviços...)" 
                value={globalSearch}
                onFocus={() => setShowSearchResults(true)}
                onChange={(e) => setGlobalSearch(e.target.value)}
                className="w-[28rem] glass-input pl-10 h-11 bg-white/40 border-white/40 focus:w-[32rem] transition-all"
              />
              
              <AnimatePresence>
                {showSearchResults && globalSearch.length >= 2 && (
                  <>
                    <div className="fixed inset-0 z-[60]" onClick={() => setShowSearchResults(false)} />
                    <motion.div 
                      key="search-results"
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: 10 }}
                      className="absolute top-full left-0 right-0 mt-2 glass-card shadow-2xl z-[70] p-2 max-h-96 overflow-y-auto border-white/20"
                    >
                      <div className="px-3 py-2 text-[10px] font-bold text-slate-400 uppercase tracking-widest border-b border-slate-100 mb-2">Resultados da Busca</div>
                      {searchLoading && <div className="p-4 text-center text-xs text-slate-400 uppercase tracking-widest animate-pulse">Buscando...</div>}
                      {searchResults.map(result => (
                        <button 
                          key={result.id}
                          onClick={() => handleSearchResultClick(result.page as Page)}
                          className="w-full flex items-center gap-4 p-3 hover:bg-emerald-50 rounded-2xl transition-all group border border-transparent hover:border-emerald-100"
                        >
                          <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center shadow-sm group-hover:bg-emerald-100 transition-colors">
                             {result.type === 'client' ? <Users className="w-5 h-5 text-emerald-600" /> : <ClipboardCheck className="w-5 h-5 text-slate-600" />}
                          </div>
                          <div className="text-left flex-1 min-w-0">
                            <div className="text-sm font-bold text-slate-700 truncate">{result.title}</div>
                            <div className="text-[10px] text-slate-400 font-bold uppercase tracking-tight">{result.subtitle}</div>
                          </div>
                          <ArrowRight className="w-4 h-4 text-emerald-300 opacity-0 group-hover:opacity-100 -translate-x-2 group-hover:translate-x-0 transition-all" />
                        </button>
                      ))}
                      {!searchLoading && searchResults.length === 0 && (
                        <div className="p-10 text-center text-slate-400">
                          <Search className="w-10 h-10 mx-auto mb-3 opacity-10" />
                          <p className="text-xs font-bold uppercase tracking-widest">Nenhum resultado para "{globalSearch}"</p>
                        </div>
                      )}
                    </motion.div>
                  </>
                )}
              </AnimatePresence>
            </div>
          </div>
          
          <div className="flex items-center gap-3">
            <div className="flex gap-2 mr-2">
               <button 
                 id="msg-page-btn"
                 onClick={() => changePage('messages')}
                 className={cn(
                   "p-2.5 glass rounded-xl relative transition-all group",
                   currentPage === 'messages' ? "bg-emerald-500/10 text-emerald-600" : "text-slate-600 hover:bg-white shadow-sm"
                 )}
                 title="E-mail Interno"
               >
                 <MessageSquare className="w-5 h-5 group-hover:scale-110 transition-transform" />
                 {unreadMessagesCount > 0 && (
                   <span className="absolute -top-1 -right-1 px-1.5 py-0.5 bg-emerald-600 text-white rounded-full text-[9px] font-bold border-2 border-white shadow-sm">
                     {unreadMessagesCount}
                   </span>
                 )}
               </button>
               
               <NotificationBell />
               
               <button 
                 id="darkmode-toggle-btn"
                 onClick={toggleDarkMode}
                 className="p-2.5 glass rounded-xl relative transition-all group text-slate-600 hover:bg-white shadow-sm flex items-center justify-center cursor-pointer"
                 title={isDarkMode ? "Modo Claro" : "Modo Escuro"}
               >
                 {isDarkMode ? (
                   <Sun className="w-5 h-5 text-amber-500 group-hover:scale-110 transition-transform" />
                 ) : (
                   <Moon className="w-5 h-5 text-slate-400 group-hover:-rotate-12 transition-transform" />
                 )}
               </button>
            </div>
            
            <div className="relative">
              <button 
                id="profile-trigger"
                onClick={() => setIsProfileOpen(!isProfileOpen)}
                className="flex items-center gap-3 pl-3 border-l border-slate-300 hover:opacity-80 transition-opacity cursor-pointer group"
              >
                <div className="text-right hidden sm:block">
                  <div className="text-sm font-bold group-hover:text-emerald-700 transition-colors">{user?.displayName}</div>
                  <div className="flex justify-end mt-0.5">
                    <span className={cn("px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider border", getRoleBadgeClass(user?.role as UserRole))}>
                      {ROLE_LABELS[user?.role as UserRole] || user?.role}
                    </span>
                  </div>
                </div>
                <div className="w-10 h-10 rounded-full bg-emerald-200 border-2 border-white shadow-sm overflow-hidden group-hover:border-emerald-500 transition-colors">
                  {user?.photoURL ? (
                    <img src={user.photoURL} alt={user.displayName} referrerPolicy="no-referrer" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center font-bold text-emerald-700">
                      {user?.displayName?.[0]}
                    </div>
                  )}
                </div>
              </button>

              <AnimatePresence>
                {isProfileOpen && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setIsProfileOpen(false)} />
                    <motion.div 
                      initial={{ opacity: 0, y: 10, scale: 0.95 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: 10, scale: 0.95 }}
                      className="absolute right-0 mt-2 w-48 glass-card shadow-xl z-50 overflow-hidden border-white/20"
                    >
                      <div className="p-2 space-y-1">
                        <button 
                          className="w-full text-left px-3 py-2 rounded-lg text-xs font-bold text-slate-600 hover:bg-emerald-50 hover:text-emerald-700 flex items-center gap-3 transition-colors"
                          onClick={() => {
                            changePage('profile');
                            setIsProfileOpen(false);
                          }}
                        >
                          <User className="w-4 h-4" /> Meu Perfil
                        </button>
                        <button 
                          id="logout-btn"
                          onClick={() => {
                            setIsProfileOpen(false);
                            logout();
                          }}
                          className="w-full text-left px-3 py-2 rounded-lg text-xs font-bold text-rose-600 hover:bg-rose-50 flex items-center gap-3 transition-colors"
                        >
                          <LogOut className="w-4 h-4" /> Sair
                        </button>
                      </div>
                    </motion.div>
                  </>
                )}
              </AnimatePresence>
            </div>
          </div>
        </header>

        <section className="flex-1 overflow-y-auto pr-2">
          {/* Antes: AnimatePresence mode="wait" esperava a aba antiga terminar
              uma animação de saída (0,28 s) para só então começar a montar a
              nova — cada clique tinha um atraso fixo. Agora a aba nova entra
              na hora, com um fade curto. */}
          <motion.div
            key={currentPage}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
            className="h-full"
          >
            <React.Suspense fallback={<PageFallback />}>
              {renderPage()}
            </React.Suspense>
          </motion.div>
        </section>
      </main>



      {/* Brand Configuration Modal */}
      <AnimatePresence>
        {isBrandingModalOpen && (
          <div className="fixed inset-0 z-[200] flex items-center justify-center p-6 bg-slate-900/85 backdrop-blur-md text-slate-800">
            <motion.div 
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-[2.5rem] w-full max-w-md p-8 flex flex-col gap-6 shadow-2xl relative border border-slate-100"
            >
              <div className="flex items-center gap-3">
                <div className="p-3 bg-emerald-50 rounded-2xl text-emerald-600">
                  <Building2 className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-lg font-display font-bold text-slate-800">Configurar Marca</h3>
                  <p className="text-xs text-slate-500 mt-0.5">Defina o nome da empresa e o logotipo de exibição do painel</p>
                </div>
              </div>

              <form onSubmit={handleSaveBranding} noValidate className="space-y-5 text-left">
                {/* Company Name */}
                <div className="space-y-1.5">
                  <label htmlFor="company-name-input" className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1">Nome da Empresa</label>
                  <input 
                    id="company-name-input"
                    type="text" 
                    value={brandingInput.companyName}
                    onChange={(e) => {
                      setBrandingInput(prev => ({ ...prev, companyName: e.target.value }));
                      if (brandingError && e.target.value.trim()) {
                        setBrandingError(false);
                      }
                    }}
                    className={cn(
                      "w-full px-4 py-3 bg-slate-50 border rounded-2xl text-sm font-medium outline-none transition-all placeholder:text-slate-300 focus:bg-white",
                      brandingError 
                        ? "border-rose-400 focus:border-rose-500 bg-rose-50/10 focus:ring-1 focus:ring-rose-400" 
                        : "border-slate-200 focus:border-emerald-500"
                    )}
                    placeholder="Empresa Agrícola"
                  />
                  {brandingError && (
                    <span className="text-[10px] text-rose-500 font-bold ml-1 block animate-fadeIn">
                      O nome da empresa é obrigatório.
                    </span>
                  )}
                </div>

                {/* Company Phrase / Subtitle */}
                <div className="space-y-1.5">
                  <label htmlFor="company-phrase-input" className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1">Slogan / Frase Curta (Subtítulo)</label>
                  <input 
                    id="company-phrase-input"
                    type="text" 
                    value={brandingInput.companyPhrase}
                    onChange={(e) => setBrandingInput(prev => ({ ...prev, companyPhrase: e.target.value }))}
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 focus:border-emerald-500 rounded-2xl text-sm font-medium outline-none transition-all placeholder:text-slate-300 focus:bg-white"
                    placeholder="Almenara, MG"
                  />
                </div>

                {/* Company Logo Dynamic Upload */}
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1">Logotipo Corporativo</label>
                  
                  {/* File Upload Box (supports Drag & Drop and click) */}
                  <div 
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                    onClick={() => {
                      if (!isUploading) {
                        document.getElementById('logo-file-picker')?.click();
                      }
                    }}
                    className={cn(
                      "relative border-2 border-dashed rounded-[2rem] p-6 text-center cursor-pointer transition-all flex flex-col items-center gap-3 justify-center group overflow-hidden",
                      isDragging 
                        ? "border-emerald-500 bg-emerald-50/60 scale-[1.01] shadow-inner" 
                        : "border-slate-200 hover:border-emerald-500 bg-slate-50 hover:bg-emerald-50/20"
                    )}
                    id="logo-drag-drop-zone"
                  >
                    <input 
                      id="logo-file-picker"
                      type="file" 
                      accept="image/*"
                      onChange={handleLogoChange}
                      className="hidden"
                    />
                    
                    {isUploading ? (
                      <div className="w-full flex flex-col items-center gap-3 py-2 animate-fadeIn">
                        {/* Dynamic Spinning Icon Container */}
                        <div className="relative flex items-center justify-center">
                          <motion.div
                            animate={{ rotate: 360 }}
                            transition={{ repeat: Infinity, duration: 3, ease: "linear" }}
                            className="w-14 h-14 rounded-2xl border-2 border-dashed border-emerald-500/60"
                          />
                          <div className="absolute w-11 h-11 bg-emerald-100/90 rounded-xl flex items-center justify-center text-emerald-600 shadow-inner">
                            <motion.div
                              animate={{ rotate: 360 }}
                              transition={{ repeat: Infinity, duration: 4, ease: "linear" }}
                              className="flex items-center justify-center"
                            >
                              <Upload className="w-5 h-5 text-emerald-600" />
                            </motion.div>
                          </div>
                        </div>

                        <div className="space-y-1 text-center w-full max-w-xs">
                          <p className="text-xs font-bold text-slate-800 truncate" title={uploadedFileName}>
                            {uploadedFileName || 'Processando arquivo...'}
                          </p>
                          {uploadedFileSize && (
                            <p className="text-[10px] text-slate-400 font-mono">{uploadedFileSize}</p>
                          )}
                        </div>
                        
                        {/* Dynamic Progress Bar */}
                        <div className="w-full max-w-xs space-y-1.5 mt-1">
                          <div className="flex items-center justify-between text-[10px] font-bold">
                            <span className="text-emerald-700 flex items-center gap-1">
                              Carregando imagem...
                            </span>
                            <span className="text-emerald-700 font-mono font-extrabold">{uploadProgress}%</span>
                          </div>
                          <div className="w-full bg-slate-200 h-2 rounded-full overflow-hidden">
                            <div 
                              className="bg-emerald-500 h-full rounded-full transition-all duration-200 ease-out"
                              style={{ width: `${uploadProgress}%` }}
                            />
                          </div>
                        </div>
                      </div>
                    ) : brandingInput.companyLogo ? (
                      <motion.div 
                        initial={{ scale: 0.85, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        transition={{ 
                          type: "spring", 
                          stiffness: 320, 
                          damping: 22,
                          mass: 0.8
                        }}
                        className="flex flex-col items-center gap-3.5 w-full py-1"
                      >
                        {/* Real-time Preview with Spring Pop */}
                        <motion.div 
                          initial={{ scale: 0.8, y: 10 }}
                          animate={{ scale: 1, y: 0 }}
                          transition={{ 
                            type: "spring", 
                            stiffness: 380, 
                            damping: 20,
                            delay: 0.05
                          }}
                          className="relative group/logo"
                        >
                          <img 
                            src={brandingInput.companyLogo} 
                            alt="Logo Preview" 
                            className="w-24 h-24 object-contain rounded-2xl shadow-md border-2 border-emerald-500/40 bg-white p-1"
                          />
                          <div className="absolute inset-0 bg-black/60 rounded-2xl opacity-0 group-hover/logo:opacity-100 flex flex-col items-center justify-center transition-opacity text-[10px] text-white font-bold uppercase gap-1 backdrop-blur-xs">
                            <Upload className="w-4 h-4 text-emerald-400" />
                            <span>Substituir</span>
                          </div>
                        </motion.div>

                        {/* File Name & Progress Status Inside Drop Zone */}
                        <motion.div 
                          initial={{ scale: 0.92, opacity: 0, y: 8 }}
                          animate={{ scale: 1, opacity: 1, y: 0 }}
                          transition={{ 
                            type: "spring", 
                            stiffness: 340, 
                            damping: 24,
                            delay: 0.1
                          }}
                          className="w-full max-w-xs bg-white p-3 rounded-2xl border border-slate-200 shadow-xs space-y-2 text-left"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2 min-w-0">
                              <div className="w-7 h-7 bg-emerald-50 text-emerald-600 rounded-lg flex items-center justify-center shrink-0 border border-emerald-100">
                                <FileImage className="w-4 h-4" />
                              </div>
                              <div className="min-w-0">
                                <p className="text-xs font-bold text-slate-800 truncate" title={uploadedFileName || 'logotipo.png'}>
                                  {uploadedFileName || 'Logotipo Selecionado'}
                                </p>
                                {uploadedFileSize && (
                                  <p className="text-[10px] text-slate-400 font-mono">{uploadedFileSize}</p>
                                )}
                              </div>
                            </div>
                            <motion.span 
                              initial={{ scale: 0.5, opacity: 0 }}
                              animate={{ scale: 1, opacity: 1 }}
                              transition={{ 
                                type: "spring", 
                                stiffness: 500, 
                                damping: 15, 
                                delay: 0.15 
                              }}
                              className="flex items-center gap-1 text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full shrink-0 shadow-xs"
                            >
                              <CheckCircle2 className="w-3 h-3 text-emerald-600" /> 100%
                            </motion.span>
                          </div>

                          {/* Completed Upload Progress Bar */}
                          <div className="space-y-1">
                            <div className="w-full bg-slate-100 h-1.5 rounded-full overflow-hidden">
                              <div className="bg-emerald-500 h-full w-full rounded-full transition-all duration-300" />
                            </div>
                            <div className="flex items-center justify-between text-[9px] text-slate-400">
                              <span>Upload concluído</span>
                              <span className="font-mono font-bold text-emerald-600">Pronto</span>
                            </div>
                          </div>
                        </motion.div>

                        <p className="text-[10px] text-slate-400 font-medium">
                          Clique ou arraste outro arquivo para substituir
                        </p>
                      </motion.div>
                    ) : (
                      <div className="flex flex-col items-center gap-2 text-slate-400 group-hover:text-emerald-600 transition-colors py-2">
                        <div className="w-12 h-12 rounded-2xl bg-slate-100 group-hover:bg-emerald-100/60 flex items-center justify-center transition-colors">
                          <Upload className="w-6 h-6 opacity-70 group-hover:opacity-100 group-hover:text-emerald-600 transition-colors" />
                        </div>
                        <div>
                          <span className="text-[11px] font-bold uppercase tracking-wider block text-slate-700 group-hover:text-emerald-700">
                            Carregar Imagem (.png, .jpg, .webp)
                          </span>
                          <span className="text-[10px] text-slate-400 font-medium">
                            Arraste e solte o arquivo aqui ou clique para selecionar
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5 mt-1">
                          <span className="px-2 py-0.5 bg-slate-100 rounded text-[9px] font-semibold text-slate-500">PNG</span>
                          <span className="px-2 py-0.5 bg-slate-100 rounded text-[9px] font-semibold text-slate-500">JPG</span>
                          <span className="px-2 py-0.5 bg-slate-100 rounded text-[9px] font-semibold text-slate-500">WEBP</span>
                          <span className="px-2 py-0.5 bg-slate-100 rounded text-[9px] font-semibold text-slate-500">Máx 5MB</span>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Alternative Raw input for URL */}
                  <div className="space-y-1.5 mt-3">
                    <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider ml-1">Ou informe a URL da Imagem</span>
                    <input 
                      id="company-logo-url-input"
                      type="text" 
                      value={brandingInput.companyLogo.startsWith('data:') ? '' : brandingInput.companyLogo}
                      onChange={(e) => setBrandingInput(prev => ({ ...prev, companyLogo: e.target.value }))}
                      className="w-full px-4 py-2 bg-slate-50 border border-slate-200 focus:border-emerald-500 rounded-xl text-xs outline-none transition-all focus:bg-white"
                      placeholder="https://exemplo.com/logo.png"
                    />
                  </div>

                  {/* Clear custom branding logo indicator */}
                  {brandingInput.companyLogo && (
                    <div className="text-right mt-1">
                      <button 
                        type="button"
                        onClick={() => setBrandingInput(prev => ({ ...prev, companyLogo: '' }))}
                        className="text-[10px] text-rose-600 hover:underline font-bold uppercase tracking-wider"
                      >
                        Restaurar Avatar Padrão
                      </button>
                    </div>
                  )}
                </div>

                <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100">
                  <button 
                    type="button"
                    onClick={() => setIsBrandingModalOpen(false)}
                    className="px-5 py-2.5 bg-slate-100 hover:bg-slate-200 rounded-2xl text-xs font-bold text-slate-600 transition-all uppercase tracking-wider cursor-pointer"
                  >
                    Cancelar
                  </button>
                  <motion.button 
                    type="submit"
                    disabled={brandingSaving || brandingSaved || !(brandingInput.companyName || '').trim()}
                    id="save-branding-btn"
                    variants={shakeVariants}
                    animate={shouldShake ? "shake" : "default"}
                    className="relative overflow-hidden px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-500/50 text-white rounded-2xl text-xs font-bold transition-all uppercase tracking-wider flex items-center gap-2 cursor-pointer shadow-md shadow-emerald-500/10"
                  >
                    {/* Progress bar at the top of the button */}
                    {brandingSaving && (
                      <div className="absolute top-0 left-0 right-0 h-1 bg-emerald-800">
                        <motion.div 
                          initial={{ width: "0%" }}
                          animate={{ width: "100%" }}
                          transition={{ duration: 1.5, ease: "easeInOut" }}
                          className="h-full bg-white/80"
                        />
                      </div>
                    )}

                    {brandingSaving ? (
                      'Gravando...'
                    ) : brandingSaved ? (
                      <motion.span 
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ duration: 0.3 }}
                        className="flex items-center gap-1.5"
                      >
                        Gravado
                        <motion.svg
                          className="w-4 h-4 text-white"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="3.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <motion.path
                            d="M20 6L9 17L4 12"
                            initial={{ pathLength: 0 }}
                            animate={{ pathLength: 1 }}
                            transition={{ duration: 0.4, ease: 'easeOut' }}
                          />
                        </motion.svg>
                      </motion.span>
                    ) : (
                      'Salvar Alterações'
                    )}
                  </motion.button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
      <QuickTipsTour />
    </div>
  );
}
