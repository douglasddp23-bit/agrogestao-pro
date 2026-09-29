import React, { useState, useEffect } from 'react';
import { runExclusive } from '../lib/submitGuard';
import { 
  UsersRound, 
  Search, 
  Plus, 
  Shield, 
  Mail, 
  MoreVertical, 
  UserPlus,
  BadgeCheck,
  X,
  Hash,
  LayoutGrid,
  List as ListIcon,
  Ban,
  Unlock,
  KeyRound,
  Trash2,
  CheckCircle2,
  Download,
  FileText,
  Calendar,
  Check
} from 'lucide-react';
import jsPDF from 'jspdf';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';
import { collection, onSnapshot, query, orderBy, addDoc, doc, updateDoc, deleteDoc, serverTimestamp, limit, getDoc, setDoc } from 'firebase/firestore';
import { sendPasswordResetEmail } from 'firebase/auth';
import { db, auth } from '../lib/firebase';
import { UserProfile, UserRole } from '../types';
import { handleFirestoreError, OperationType, generateRegistrationNumber, cn } from '../lib/utils';
import { useAuth } from '../contexts/AuthContext';
import { createNotification } from '../lib/notifications';
import { canCreateRole, ROLE_LABELS } from '../lib/permissions';
import { logAudit } from '../lib/audit';

import ConfirmationModal from '../components/ConfirmationModal';
import UserDetailModal from '../components/users/UserDetailModal';
import NewDelegationModal from '../components/users/NewDelegationModal';
import { PageTitle, PAGE_HEADER_CLASS } from '../components/layout/PageHeader';
import { UsersRound as PageIcon } from 'lucide-react';

export default function Users() {
  const { user } = useAuth();
  const [searchTerm, setSearchTerm] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [team, setTeam] = useState<UserProfile[]>([]);
  const [selectedUser, setSelectedUser] = useState<string | null>(null);
  const [detailModalUser, setDetailModalUser] = useState<UserProfile | null>(null);
  const [detailModalTab, setDetailModalTab] = useState<'assignments' | 'delegations' | 'permissions'>('assignments');
  const [isGlobalNewDelegationOpen, setIsGlobalNewDelegationOpen] = useState(false);
  const [registrationSuccess, setRegistrationSuccess] = useState<{
    email: string;
    tempPass: string;
    regNum: string;
    displayName: string;
    role: string;
    cert?: string;
  } | null>(null);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState<UserProfile | null>(null);
  
  // States for dynamic assignments and vacation replacements
  const [editingAssignmentsUser, setEditingAssignmentsUser] = useState<UserProfile | null>(null);
  const [tempAllowedPages, setTempAllowedPages] = useState<string[]>([]);
  const [tempAssignedAreas, setTempAssignedAreas] = useState<string[]>([]);
  const [tempIsVacation, setTempIsVacation] = useState(false);
  const [tempReplacementForId, setTempReplacementForId] = useState('');
  const [tempStartDate, setTempStartDate] = useState('');
  const [tempEndDate, setTempEndDate] = useState('');
  const [isSavingAssignments, setIsSavingAssignments] = useState(false);

  useEffect(() => {
    if (editingAssignmentsUser) {
      setTempAllowedPages(editingAssignmentsUser.allowedPages || []);
      setTempAssignedAreas(editingAssignmentsUser.assignedAreas || []);
      setTempIsVacation(!!editingAssignmentsUser.isVacationReplacement);
      setTempReplacementForId(editingAssignmentsUser.replacementForId || '');
      setTempStartDate(editingAssignmentsUser.replacementStartDate || '');
      setTempEndDate(editingAssignmentsUser.replacementEndDate || '');
    }
  }, [editingAssignmentsUser]);

  const handleSaveAssignments = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingAssignmentsUser) return;

    setIsSavingAssignments(true);
    try {
      const replacementUser = team.find(u => u.uid === tempReplacementForId);
      const updates = {
        allowedPages: tempAllowedPages,
        assignedAreas: tempAssignedAreas,
        isVacationReplacement: tempIsVacation,
        replacementForId: tempReplacementForId,
        replacementForName: replacementUser ? replacementUser.displayName : '',
        replacementStartDate: tempStartDate,
        replacementEndDate: tempEndDate,
        // Inherit the role of the replaced user during vacation coverage
        temporaryRole: (tempIsVacation && replacementUser) ? replacementUser.role : null,
      };

      await updateDoc(doc(db, 'users', editingAssignmentsUser.uid), updates);
      toast.success(`Atribuições de ${editingAssignmentsUser.displayName} atualizadas!`);
      
      if (user?.uid) {
        await createNotification(
          user.uid,
          '🛡️ Atribuições Atualizadas',
          `As atribuições e permissões de ${editingAssignmentsUser.displayName} foram reconfiguradas pelo Administrador.`,
          'info'
        );
      }
      setEditingAssignmentsUser(null);
    } catch (err: any) {
      console.error(err);
      toast.error('Erro ao atualizar atribuições: ' + err.message);
    } finally {
      setIsSavingAssignments(false);
    }
  };

  const handleReplacementChange = (uid: string) => {
    setTempReplacementForId(uid);
    if (!uid) return;
    const replacementUser = team.find(u => u.uid === uid);
    if (replacementUser) {
      // Merge unique pages and areas so they are pre-selected in the form automatically!
      const mergedPages = Array.from(new Set([...tempAllowedPages, ...(replacementUser.allowedPages || [])]));
      const mergedAreas = Array.from(new Set([...tempAssignedAreas, ...(replacementUser.assignedAreas || [])]));
      setTempAllowedPages(mergedPages);
      setTempAssignedAreas(mergedAreas);
      toast.info(`Acessos e áreas de ${replacementUser.displayName} vinculados automaticamente para agilizar a cobertura!`);
    }
  };
  
  const isManagement = (user?.effectiveRole ?? user?.role) === 'admin' || (user?.effectiveRole ?? user?.role) === 'hr';
  const isAdmin = (user?.effectiveRole ?? user?.role) === 'admin';
  const canDeleteUsers = isAdmin;
  const canBlockUsers = isAdmin;
  const [inviteData, setInviteData] = useState({
    email: '',
    role: 'consultant' as UserRole,
    displayName: '',
    professionalCertification: '',
    registrationNumber: ''
  });

  useEffect(() => {
    if (isModalOpen) {
      setInviteData(prev => ({ ...prev, registrationNumber: 'Gerada pelo Servidor' }));
    }
  }, [inviteData.role, isModalOpen]);

  useEffect(() => {
    const q = query(collection(db, 'users'), orderBy('displayName', 'asc'), limit(100));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setTeam(snapshot.docs.map(doc => ({ uid: doc.id, ...doc.data() } as UserProfile)));
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'users');
    });
    return unsubscribe;
  }, []);

  const generateEmail = (name: string) => {
    const clean = name
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '') // strip accents
      .replace(/[^a-z0-9 ]/g, '')
      .trim()
      .split(/\s+/);
      
    const first = clean[0] || 'colaborador';
    const last = clean.length > 1 ? clean[clean.length - 1] : '';
    
    const base = last ? `${first}.${last}` : first;
    return `${base}@agrogestao.com.br`;
  };

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    const autoEmail = generateEmail(inviteData.displayName);

    try {
      let idToken = '';
      const currentUser = auth.currentUser;
      if (currentUser) {
        idToken = await currentUser.getIdToken();
      } else {
        const cachedSession = localStorage.getItem('virtual_user_session');
        if (cachedSession) {
          const parsed = JSON.parse(cachedSession);
          idToken = '';
        }
      }
      
      const response = await fetch('/api/create-user', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`
        },
        body: JSON.stringify({
          displayName: inviteData.displayName,
          role: inviteData.role,
          department: inviteData.professionalCertification || 'Suporte Técnico',
          professionalCertification: inviteData.professionalCertification,
          createdBy: user?.uid
        }),
      });

      let result: any = {};
      try {
        result = await response.json();
      } catch (jsonErr) {}
      // Antes, se o servidor recusasse, a tela seguia assim mesmo com uma
      // matrícula/senha inventadas — o colaborador recebia um PDF de acesso
      // que nunca funcionaria.
      if (!response.ok || !result.uid || !(result.temporaryPassword || result.tempPassword)) {
        toast.error(result.error || 'O servidor não conseguiu criar o acesso. Nada foi cadastrado.');
        return;
      }

      const finalUid = result.uid;
      const finalRegNum = result.registrationNumber;
      const finalTempPass = result.temporaryPassword || result.tempPassword;

      const successData = {
        email: result.email || autoEmail,
        tempPass: finalTempPass,
        regNum: finalRegNum,
        displayName: inviteData.displayName,
        role: inviteData.role,
        cert: inviteData.professionalCertification
      };

      setRegistrationSuccess(successData);
      generatePDFForUserData(successData);
      setIsModalOpen(false);
      
      // Clear and reset form
      setInviteData({ email: '', role: 'staff', displayName: '', professionalCertification: '', registrationNumber: '' });
      toast.success('Colaborador cadastrado eletronicamente!');

      await setDoc(doc(db, 'users', finalUid), {
        uid: finalUid,
        displayName: successData.displayName,
        email: result.email || autoEmail,
        role: successData.role,
        department: successData.cert || 'Suporte Técnico',
        status: 'offline',
        mustChangePassword: true,
        createdAt: new Date().toISOString(),
        registrationNumber: finalRegNum,
        professionalCertification: successData.cert,
        adminId: user?.uid || '',
        adminName: user?.displayName || '',
        adminEmail: user?.email || '',
        createdBy: user?.uid || '',
      }, { merge: true });

      if (user?.uid) {
        await createNotification(
          user.uid,
          '👥 Novo Colaborador Registrado',
          `O colaborador ${successData.displayName} (Matrícula: ${finalRegNum}) foi cadastrado com sucesso. As credenciais seguras foram disparadas por e-mail.`,
          'success'
        );
      }
    } catch (err) {
      console.error('Invitation failed:', err);
      toast.error('Erro ao cadastrar colaborador');
    }
  };

  const handleToggleBlock = async (member: UserProfile) => {
    if (!isManagement) return;
    const action = member.blocked ? 'unblock-user' : 'block-user';
    const originalBlocked = member.blocked;

    // 1. Optimistic feedback: update UI state instantly
    setTeam(prev => prev.map(u => u.uid === member.uid ? { ...u, blocked: !u.blocked } : u));
    toast.success(`Colaborador ${originalBlocked ? 'restabelecido' : 'suspenso'} com sucesso!`);
    setSelectedUser(null);

    // 2. Perform backend & Firebase updates asynchronously in the background
    (async () => {
      let idToken = '';
      const currentUser = auth.currentUser;
      if (currentUser) {
        idToken = await currentUser.getIdToken();
      } else {
        const cachedSession = localStorage.getItem('virtual_user_session');
        if (cachedSession) {
          const parsed = JSON.parse(cachedSession);
          idToken = '';
        }
      }
      
      const response = await fetch(`/api/${action}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`
        },
        body: JSON.stringify({ uid: member.uid }),
      });

      if (!response.ok) {
        console.warn('Backend toggle block returned non-ok status.');
      }

      await updateDoc(doc(db, 'users', member.uid), { blocked: !originalBlocked });
    })().catch(err => {
      console.error('Background toggle block failed:', err);
    });
  };

  const handleResetPassword = async (member: UserProfile) => {
    let toastId: any = undefined;
    try {
      toastId = toast.loading('Redefinindo senha eletronicamente no backend...');
      let idToken = '';
      const currentUser = auth.currentUser;
      if (currentUser) {
        idToken = await currentUser.getIdToken();
      } else {
        const cachedSession = localStorage.getItem('virtual_user_session');
        if (cachedSession) {
          const parsed = JSON.parse(cachedSession);
          idToken = '';
        }
      }

      const response = await fetch('/api/admin/reset-password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`
        },
        body: JSON.stringify({
          uid: member.uid
        }),
      });

      const responseText = await response.text();
      let result: any = {};
      try {
        result = JSON.parse(responseText);
      } catch (jsonErr) {
        throw new Error(`Resposta de redefinição inválida (${response.status}): ${responseText.slice(0, 150)}`);
      }

      if (!response.ok) {
        throw new Error(result.error || 'Falha na comunicação de redefinição.');
      }

      // Link/associate security logs inside system notifications
      const adminIdToNotify = member.createdBy || member.adminId || user?.uid;
      if (adminIdToNotify) {
        await createNotification(
          adminIdToNotify,
          '🔐 Redefinição de Senha Solicitada',
          `A senha para ${member.displayName} foi gerada e enviada via canal SMTP ao e-mail do gestor.`,
          'success'
        );
      }

      toast.success(
        <div className="flex flex-col gap-1.5 p-1">
          <p className="font-bold text-slate-800 font-display">Senha Redefinida com Sucesso!</p>
          <p className="text-xs text-slate-500">Colaborador: <span className="font-bold text-slate-700">{member.displayName}</span></p>
          
          <div className="my-1.5 p-3 bg-rose-50 rounded-xl border border-rose-100 text-rose-800 font-medium leading-relaxed font-sans text-center">
             <span className="text-[9px] text-rose-500 font-bold block uppercase mb-1">Nova Senha Temporária</span>
             <span className="font-mono text-lg font-bold block tracking-widest text-rose-700 select-all">{result.tempPassword || result.temporaryPassword}</span>
          </div>
          <p className="text-[10px] text-slate-500 leading-tight">
             Entregue esta nova senha ao colaborador para que ele possa realizar o acesso inicial e cadastrar a senha definitiva.
          </p>
        </div>,
        { id: toastId, duration: 15000 }
      );
      
      setSelectedUser(null);
    } catch (error: any) {
      console.error(error);
      toast.error('Erro ao redefinir credenciais: ' + (error.message || 'Falha no processamento.'), { id: toastId });
    }
  };

  const handleDeleteUser = async (member: UserProfile) => {
    if (!canDeleteUsers) {
      toast.error("Sem permissão para excluir.");
      return;
    }
    
    if (member.uid === user?.uid) {
      toast.error("Não é possível excluir seu próprio perfil.");
      return;
    }

    // Só some da tela depois que o servidor confirmar (antes dizia "removido com
    // sucesso" mesmo quando o servidor recusava, e o erro era ignorado).
    const toastId = toast.loading(`Excluindo ${member.displayName}...`);
    try {
      const idToken = auth.currentUser ? await auth.currentUser.getIdToken() : '';
      const response = await fetch('/api/delete-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` },
        body: JSON.stringify({ uid: member.uid })
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || `Servidor recusou (${response.status}).`);
      setTeam(prev => prev.filter(u => u.uid !== member.uid));
      setSelectedUser(null);
      toast.success('Colaborador removido com sucesso!', { id: toastId });
    } catch (err: any) {
      console.error('Erro ao excluir colaborador:', err);
      toast.error('Não foi possível excluir: ' + (err?.message || 'falha na comunicação com o servidor.'), { id: toastId });
    }
  };

  const generatePDFForUserData = (data: {
    email: string;
    tempPass: string;
    regNum: string;
    displayName: string;
    role: string;
    cert?: string;
  }) => {
    try {
      const pdf = new jsPDF('p', 'mm', 'a4');
      
      // Document frame border
      pdf.setDrawColor(220, 225, 230);
      pdf.setLineWidth(0.4);
      pdf.rect(15, 15, 180, 260);

      // Top banner
      pdf.setFillColor(5, 150, 105); // emerald-600
      pdf.rect(15, 15, 180, 32, 'F');

      // Title
      pdf.setTextColor(255, 255, 255);
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(22);
      pdf.text('AGROSYSTEM', 22, 30);
      
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(10);
      pdf.text('SISTEMA INTEGRADO DE GESTAO AGRICOLA', 22, 38);

      // Section label
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(12);
      pdf.setTextColor(30, 41, 59); // slate-800
      pdf.text('CREDENCIAIS DE NOVO COLABORADOR', 22, 60);

      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(9.5);
      pdf.setTextColor(100, 116, 139); // slate-500
      pdf.text('Abaixo estao descritas as credenciais provisorias geradas de forma segura para o acesso inicial.', 22, 67);
      pdf.text('Mantenha estes dados em local seguro e nao os compartilhe com terceiros.', 22, 72);

      // horizontal division line
      pdf.setDrawColor(226, 232, 240);
      pdf.line(22, 78, 188, 78);

      // Helper function to draw dynamic info boxes
      const drawInfoBox = (x: number, y: number, w: number, h: number, title: string, value: string, isAccent = false) => {
        pdf.setFillColor(isAccent ? 254 : 248, isAccent ? 242 : 250, isAccent ? 242 : 252);
        pdf.setDrawColor(isAccent ? 254 : 226, isAccent ? 202 : 232, isAccent ? 211 : 240);
        pdf.rect(x, y, w, h, 'F');
        pdf.rect(x, y, w, h);

        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(8.5);
        pdf.setTextColor(isAccent ? 220 : 100, isAccent ? 38 : 116, isAccent ? 38 : 139);
        pdf.text(title.toUpperCase(), x + 4, y + 6);

        if (isAccent) {
          pdf.setFont('courier', 'bold');
          pdf.setFontSize(14);
          pdf.setTextColor(153, 27, 27);
          pdf.text(value, x + 4, y + 16);
        } else {
          pdf.setFont('helvetica', 'bold');
          pdf.setFontSize(11);
          pdf.setTextColor(15, 23, 42);
          pdf.text(value, x + 4, y + 15);
        }
      };

      // Layout details grid
      const startY = 84;
      
      // Colaborador
      drawInfoBox(22, startY, 80, 22, 'Colaborador', data.displayName);
      
      // Matricula
      drawInfoBox(108, startY, 80, 22, 'Matricula', data.regNum);

      // Cargo / Função
      const displayRole = data.role === 'admin' ? 'Administrador' :
                          data.role === 'hr' ? 'Gestor de RH' :
                          data.role === 'manager' ? 'Gerente / Gestor' :
                          data.role === 'staff' ? 'Consultor Técnico' : data.role;
      drawInfoBox(22, startY + 28, 80, 22, 'Funcao / Cargo', displayRole.toUpperCase());

      // Certificacao / Departamento
      drawInfoBox(108, startY + 28, 80, 22, 'Departamento / Certificacao', data.cert || 'Suporte Tecnico');

      // E-mail de Acesso
      drawInfoBox(22, startY + 56, 166, 22, 'E-mail Oficial de Acesso', data.email);

      // Senha Temporaria Box (Highlighted in Light Red)
      drawInfoBox(22, startY + 84, 166, 26, 'Senha Secreta Temporaria', data.tempPass, true);

      // Security Notice details
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(9);
      pdf.setTextColor(71, 85, 105);
      
      const disclaimerY = startY + 122;
      pdf.setFont('helvetica', 'bold');
      pdf.text('INSTRUCOES DE SEGURANCA:', 22, disclaimerY);
      
      pdf.setFont('helvetica', 'normal');
      pdf.text('1. Acesse o sistema operacional AgroSystem utilizando o e-mail oficial acima.', 22, disclaimerY + 7);
      pdf.text('2. Digite ou cole a Senha Secreta Temporaria informada neste documento.', 22, disclaimerY + 13);
      pdf.text('3. O sistema solicitara obrigatoriamente a redefinicao de senha em seu primeiro login.', 22, disclaimerY + 19);
      pdf.text('4. Defina uma senha forte de sua preferencia para garantir a integridade dos seus dados.', 22, disclaimerY + 25);

      // Footer
      pdf.setDrawColor(226, 232, 240);
      pdf.line(22, disclaimerY + 40, 188, disclaimerY + 40);

      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(8);
      pdf.setTextColor(148, 163, 184);
      pdf.text('AgroSystem Tecnologia Agricola - Todos os direitos reservados.', 22, disclaimerY + 48);
      pdf.text(`Documento emitido eletronicamente em: ${new Date().toLocaleDateString('pt-BR')} as ${new Date().toLocaleTimeString('pt-BR')}`, 22, disclaimerY + 53);

      pdf.save(`credenciais_${data.regNum}.pdf`);
      toast.success("PDF de credenciais gerado com sucesso!");
    } catch (error) {
      console.error("PDF generation directly failed:", error);
      toast.error("Erro ao gerar PDF.");
    }
  };

  const handleDownloadPDF = async () => {
    if (!registrationSuccess) return;
    generatePDFForUserData(registrationSuccess);
  };

  const filteredTeam = team.filter(m => 
    (m.displayName || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
    (m.role || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
    m.registrationNumber?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="flex flex-col gap-6 h-full">
      <header className={PAGE_HEADER_CLASS} data-page-header>
        <div className="flex items-center gap-4">
          <PageTitle icon={PageIcon} title="Usuários" subtitle="Equipe, cargos, acessos e delegações" />
          <div className="relative hidden sm:block">
            <input 
              type="text" 
              placeholder="Buscar colaborador..." 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9 pr-4 py-1.5 glass-input w-64 text-xs"
            />
            <Search className="w-3.5 h-3.5 absolute left-3 top-2 text-slate-400" />
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex bg-white/40 p-1 rounded-xl border border-white/50">
            <button 
              onClick={() => setViewMode('grid')}
              className={cn(
                "p-2 rounded-lg transition-all",
                viewMode === 'grid' ? "bg-white shadow-sm text-emerald-600" : "text-slate-400 hover:text-slate-600"
              )}
            >
              <LayoutGrid className="w-4 h-4" />
            </button>
            <button 
              onClick={() => setViewMode('list')}
              className={cn(
                "p-2 rounded-lg transition-all",
                viewMode === 'list' ? "bg-white shadow-sm text-emerald-600" : "text-slate-400 hover:text-slate-600"
              )}
            >
              <ListIcon className="w-4 h-4" />
            </button>
          </div>

          {isAdmin && (
            <button 
              id="btn-global-delegation"
              onClick={() => setIsGlobalNewDelegationOpen(true)}
              className="bg-amber-500 hover:bg-amber-600 text-white px-3.5 py-2 rounded-xl text-sm font-bold flex items-center gap-2 shadow-lg shadow-amber-200 transition-all cursor-pointer"
              title="Atribuir Nova Delegação de Permissões"
            >
              <UsersRound className="w-4 h-4" /> <span className="hidden sm:inline">Nova Delegação</span>
            </button>
          )}

          {isManagement && (
            <button 
              onClick={() => setIsModalOpen(true)}
              className="bg-emerald-600 text-white px-4 py-2 rounded-xl text-sm font-bold flex items-center gap-2 hover:bg-emerald-700 transition-colors shadow-lg shadow-emerald-200 cursor-pointer"
            >
              <UserPlus className="w-4 h-4" /> <span className="hidden sm:inline">Registrar</span>
            </button>
          )}
        </div>
      </header>

      {/* Content Area */}
      {filteredTeam.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center py-20 text-center">
          <div className="w-16 h-16 rounded-full bg-slate-100 flex items-center justify-center mb-4">
            <UsersRound className="w-8 h-8 text-slate-300" />
          </div>
          <h3 className="text-lg font-bold text-slate-600">Nenhum colaborador encontrado</h3>
          <p className="text-sm text-slate-400 mt-1 max-w-xs">Não encontramos nenhum membro da equipe que corresponda ao termo pesquisado.</p>
          <button 
            onClick={() => setSearchTerm('')}
            className="mt-4 text-emerald-600 font-bold text-xs uppercase tracking-widest hover:text-emerald-700"
          >
            Limpar Busca
          </button>
        </div>
      ) : viewMode === 'grid' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6 overflow-y-auto pr-2 pb-6">
          {filteredTeam.map((member) => (
            <motion.div 
              layout
              key={member.uid}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className={cn(
                "glass-card p-6 flex flex-col gap-4 group transition-all relative",
                member.blocked ? "opacity-60 grayscale border-rose-200" : "hover:border-emerald-500/30"
              )}
            >
              {member.blocked && (
                <div className="absolute top-4 right-4 bg-rose-500 text-white p-1 rounded-full shadow-lg">
                  <Ban className="w-3 h-3" />
                </div>
              )}
              <div className="flex justify-between items-start">
                 <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-full bg-emerald-50 flex items-center justify-center text-emerald-600 font-bold text-lg border-2 border-white shadow-sm overflow-hidden">
                       {member.photoURL ? <img src={member.photoURL} alt="" /> : member.displayName[0]}
                    </div>
                    <div>
                       <h3 className="font-bold text-slate-700">{member.displayName}</h3>
                       <div className="flex items-center gap-1.5 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                          <Shield className="w-3 h-3 text-emerald-500" />
                          {member.role === 'admin' ? 'Administrador' : member.role === 'hr' ? 'Gestor RH' : member.role === 'manager' ? 'Gerente' : 'Consultor'}
                       </div>
                    </div>
                 </div>
                 {isManagement && (
                    <div className="relative">
                      <button 
                        onClick={() => setSelectedUser(selectedUser === member.uid ? null : member.uid)}
                        className="p-2 hover:bg-slate-100 rounded-full transition-colors"
                      >
                        <MoreVertical className="w-4 h-4 text-slate-400" />
                      </button>
                      <AnimatePresence>
                        {selectedUser === member.uid && (
                          <motion.div 
                            initial={{ opacity: 0, scale: 0.95 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.95 }}
                            className="absolute right-0 top-10 w-48 bg-white rounded-xl shadow-xl border border-slate-100 z-10 py-1 overflow-hidden"
                          >
                            {(user?.effectiveRole ?? user?.role) === 'admin' && (
                            <button 
                               onClick={() => handleResetPassword(member)}
                               className="w-full px-4 py-2 text-left text-xs font-bold text-slate-600 hover:bg-slate-50 flex items-center gap-2"
                            >
                               <KeyRound className="w-3.5 h-3.5" /> Redefinir Senha
                            </button>
                            )}
                            <button 
                               onClick={() => {
                                 setDetailModalUser(member);
                                 setDetailModalTab('permissions');
                                 setSelectedUser(null);
                               }}
                               className="w-full px-4 py-2 text-left text-xs font-bold text-slate-600 hover:bg-slate-50 flex items-center gap-2 border-t border-slate-100"
                            >
                               <Shield className="w-3.5 h-3.5 text-slate-500" /> Permissões & Módulos
                            </button>
                            {isAdmin && (
                              <button 
                                 onClick={() => {
                                   setDetailModalUser(member);
                                   setDetailModalTab('delegations');
                                   setSelectedUser(null);
                                 }}
                                 className="w-full px-4 py-2 text-left text-xs font-bold text-amber-700 hover:bg-amber-50 flex items-center gap-2 border-t border-slate-100"
                              >
                                 <UsersRound className="w-3.5 h-3.5 text-amber-600" /> Delegações Temporárias
                              </button>
                            )}
                            {isAdmin && (
                              <button 
                                 onClick={() => {
                                   setDetailModalUser(member);
                                   setDetailModalTab('assignments');
                                   setSelectedUser(null);
                                 }}
                                 className="w-full px-4 py-2 text-left text-xs font-bold text-slate-600 hover:bg-slate-50 flex items-center gap-2 border-t border-slate-100"
                              >
                                 <Shield className="w-3.5 h-3.5 text-emerald-500" /> Atribuições e Acessos
                              </button>
                            )}
                            {canBlockUsers && (
                              <button 
                                 onClick={() => handleToggleBlock(member)}
                                 className={cn(
                                   "w-full px-4 py-2 text-left text-xs font-bold flex items-center gap-2",
                                   member.blocked ? "text-emerald-600 hover:bg-emerald-50" : "text-rose-600 hover:bg-rose-50"
                                 )}
                              >
                                 {member.blocked ? <><Unlock className="w-3.5 h-3.5" /> Desbloquear</> : <><Ban className="w-3.5 h-3.5" /> Bloquear Acesso</>}
                              </button>
                            )}

                            {canDeleteUsers && (
                              <button 
                                id={`delete-user-grid-${member.uid}`}
                                onClick={() => setIsDeleteModalOpen(member)}
                                className="w-full px-4 py-2 text-left text-xs font-bold text-rose-600 hover:bg-rose-50 flex items-center gap-2 border-t border-slate-50"
                              >
                                <Trash2 className="w-3.5 h-3.5" /> Excluir Colaborador
                              </button>
                            )}
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                 )}
              </div>

              <div className="space-y-2 pt-2">
                 <div className="flex items-center gap-3 text-xs text-slate-500">
                    <Mail className="w-3.5 h-3.5 text-slate-400" />
                    <span className="truncate">{member.email}</span>
                 </div>
                 <div className="flex items-center gap-3 text-xs text-slate-500">
                    <Hash className="w-3.5 h-3.5 text-slate-400" />
                    Matrícula: {member.registrationNumber || '---'}
                 </div>
                 <div className="flex items-center gap-3 text-[11px] text-slate-500 bg-slate-50/50 p-2 rounded-lg border border-slate-100 mt-1.5">
                    <Shield className="w-3.5 h-3.5 text-emerald-500" />
                    <span>Gestor: <span className="font-bold text-slate-700">{member.adminName || '—'}</span></span>
                 </div>
              </div>

              <div className="flex justify-between items-center pt-4 mt-auto border-t border-white/20">
                 <div className="flex items-center gap-1.5">
                    <span className={cn(
                      "w-2 h-2 rounded-full", 
                      member.blocked ? "bg-rose-500" : member.status === 'online' ? "bg-emerald-500 animate-pulse" : "bg-slate-300"
                    )}></span>
                    <span className="text-[10px] font-bold text-slate-400 uppercase">
                      {member.blocked ? 'Bloqueado' : member.status === 'online' ? 'Online' : 'Offline'}
                    </span>
                 </div>
                 <button 
                   onClick={() => {
                     setDetailModalUser(member);
                     setDetailModalTab('permissions');
                   }}
                   className="text-[10px] font-bold text-emerald-600 hover:text-emerald-700 transition-colors uppercase tracking-widest cursor-pointer"
                 >
                    Ver Perfil
                 </button>
              </div>
            </motion.div>
          ))}
        </div>
      ) : (
        <div className="flex flex-col gap-3 overflow-y-auto pr-2 pb-6">
          <div className="glass shadow-sm rounded-xl border border-white/40 overflow-hidden">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="bg-white/40 text-slate-400 border-b border-white/20">
                  <th className="p-4 font-bold uppercase tracking-widest">Colaborador</th>
                  <th className="p-4 font-bold uppercase tracking-widest hidden md:table-cell">E-mail</th>
                  <th className="p-4 font-bold uppercase tracking-widest hidden lg:table-cell">Matrícula</th>
                  <th className="p-4 font-bold uppercase tracking-widest">Cargo</th>
                  <th className="p-4 font-bold uppercase tracking-widest">Status</th>
                  <th className="p-4 font-bold uppercase tracking-widest text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/10">
                {filteredTeam.map((member) => (
                  <tr 
                    key={member.uid} 
                    className={cn(
                      "hover:bg-white/30 transition-colors group",
                      member.blocked && "opacity-50 grayscale bg-rose-50/10"
                    )}
                  >
                    <td className="p-4">
                       <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-emerald-50 flex items-center justify-center text-emerald-600 font-bold border border-white shrink-0">
                             {member.photoURL ? <img src={member.photoURL} alt="" /> : member.displayName[0]}
                          </div>
                          <div>
                            <div className="font-bold text-slate-700">{member.displayName}</div>
                            <div className="text-[10px] text-slate-400 mt-0.5">Gestor: {member.adminName || '—'}</div>
                          </div>
                       </div>
                    </td>
                    <td className="p-4 text-slate-500 hidden md:table-cell">{member.email}</td>
                    <td className="p-4 text-slate-500 hidden lg:table-cell">{member.registrationNumber || '---'}</td>
                    <td className="p-4">
                       <span className="px-2 py-0.5 bg-emerald-50 text-emerald-600 rounded-lg font-bold uppercase text-[9px] tracking-tighter">
                          {ROLE_LABELS[member.role as keyof typeof ROLE_LABELS] || member.role}
                       </span>
                    </td>
                    <td className="p-4">
                       <div className="flex items-center gap-1.5">
                          <span className={cn(
                            "w-1.5 h-1.5 rounded-full", 
                            member.blocked ? "bg-rose-500" : member.status === 'online' ? "bg-emerald-500" : "bg-slate-300"
                          )}></span>
                          <span className="text-[10px] font-bold text-slate-400">
                             {member.blocked ? 'Bloqueado' : member.status === 'online' ? 'Online' : 'Offline'}
                          </span>
                       </div>
                    </td>
                    <td className="p-4 text-right">
                       <button 
                         onClick={() => {
                           setDetailModalUser(member);
                           setDetailModalTab('permissions');
                         }}
                         className="p-1.5 bg-slate-50 text-slate-600 rounded-lg hover:bg-slate-100 transition-all font-bold mr-1 align-middle inline-flex cursor-pointer"
                         title="Permissões do Sistema"
                       >
                         <Shield className="w-3.5 h-3.5 text-slate-600" />
                       </button>
                       {(user?.effectiveRole ?? user?.role) === 'admin' && (
                         <button 
                           onClick={() => {
                             setDetailModalUser(member);
                             setDetailModalTab('delegations');
                           }}
                           className="p-1.5 bg-amber-50 text-amber-700 rounded-lg hover:bg-amber-100 transition-all font-bold mr-1 align-middle inline-flex cursor-pointer"
                           title="Delegações Temporárias"
                         >
                           <UsersRound className="w-3.5 h-3.5" />
                         </button>
                       )}
                       {(user?.effectiveRole ?? user?.role) === 'admin' && (
                         <button 
                           onClick={() => {
                             setDetailModalUser(member);
                             setDetailModalTab('assignments');
                           }}
                           className="p-1.5 bg-emerald-50 text-emerald-600 rounded-lg hover:bg-emerald-100 transition-all font-bold mr-2 align-middle inline-flex cursor-pointer"
                           title="Atribuições e Acessos"
                         >
                           <Shield className="w-3.5 h-3.5" />
                         </button>
                       )}
                       {isManagement && (
                         <div className="flex items-center justify-end gap-2">
                           {canBlockUsers && (
                             <button 
                               onClick={() => handleToggleBlock(member)}
                               className={cn(
                                 "p-1.5 rounded-lg transition-all",
                                 member.blocked ? "bg-emerald-50 text-emerald-600 hover:bg-emerald-100" : "bg-rose-50 text-rose-600 hover:bg-rose-100"
                               )}
                               title={member.blocked ? "Desbloquear" : "Bloquear"}
                             >
                               {member.blocked ? <Unlock className="w-3.5 h-3.5" /> : <Ban className="w-3.5 h-3.5" />}
                             </button>
                           )}
                           {(user?.effectiveRole ?? user?.role) === 'admin' && (
                           <button 
                             onClick={() => handleResetPassword(member)}
                             className="p-1.5 bg-slate-50 text-slate-600 rounded-lg hover:bg-slate-100 transition-all font-bold"
                             title="Redefinir Senha"
                           >
                             <KeyRound className="w-3.5 h-3.5" />
                           </button>
                           )}
                           {canDeleteUsers && (
                             <button 
                               id={`delete-user-list-${member.uid}`}
                               onClick={() => setIsDeleteModalOpen(member)}
                               className="p-1.5 bg-rose-50 text-rose-600 rounded-lg hover:bg-rose-100 transition-all font-bold"
                               title="Excluir Colaborador"
                             >
                               <Trash2 className="w-3.5 h-3.5" />
                             </button>
                           )}
                         </div>
                       )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <AnimatePresence>
        {isModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-slate-900/40 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="relative glass-card w-full max-w-md p-8 shadow-2xl"
            >
              <div className="flex justify-between items-center mb-6">
                 <div>
                    <h3 className="text-xl font-display font-bold">Registrar Novo Usuário</h3>
                    <p className="text-xs text-slate-400 mt-1">A matrícula será gerada automaticamente.</p>
                 </div>
                 <button onClick={() => setIsModalOpen(false)} className="p-2 hover:bg-slate-100 rounded-full transition-colors">
                    <X className="w-5 h-5 text-slate-400" />
                 </button>
              </div>

              <form onSubmit={(e) => { e.preventDefault(); runExclusive('Users.handleInvite', () => handleInvite(e)); }} className="space-y-4">
                 <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-slate-500 uppercase ml-1">Nome Completo</label>
                    <input 
                      required
                      value={inviteData.displayName}
                      onChange={(e) => setInviteData({...inviteData, displayName: e.target.value})}
                      className="w-full glass-input" 
                      placeholder="Nome do colaborador" 
                    />
                    {inviteData.displayName && (
                      <p className="text-[9px] text-emerald-600 font-bold ml-1 flex items-center gap-1">
                        <Mail className="w-3 h-3" /> E-mail sugerido: {generateEmail(inviteData.displayName)}
                      </p>
                    )}
                 </div>
                 <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-slate-500 uppercase ml-1">Nível de Acesso (Cargo)</label>
                    <select 
                      value={inviteData.role}
                      onChange={(e) => setInviteData({...inviteData, role: e.target.value as UserRole})}
                      className="w-full glass-input bg-white/50"
                    >
                       {([
                         { value: 'consultant', label: 'Consultor Técnico (F)' },
                         { value: 'hr', label: 'Gestor de RH (R)' },
                         { value: 'manager', label: 'Gestor / Gerente (G)' },
                         { value: 'admin', label: 'Administrador (A)' },
                       ] as { value: UserRole; label: string }[])
                         .filter(r => canCreateRole(((user?.effectiveRole ?? user?.role) as UserRole) || 'consultant', r.value))
                         .map(r => (
                           <option key={r.value} value={r.value}>{r.label}</option>
                         ))}
                    </select>
                 </div>
                 <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-slate-500 uppercase ml-1">Certificação Profissional (CREA, CFTA, etc.)</label>
                    <input 
                      value={inviteData.professionalCertification}
                      onChange={(e) => setInviteData({...inviteData, professionalCertification: e.target.value})}
                      className="w-full glass-input" 
                      placeholder="Número do Registro Profissional" 
                    />
                 </div>
                 <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-slate-500 uppercase ml-1">Matrícula Associada</label>
                    <div className="flex gap-2">
                       <input 
                         readOnly
                         required
                         value={inviteData.registrationNumber}
                         className="flex-1 glass-input font-mono uppercase tracking-wider text-xs bg-slate-50/80 text-slate-500 outline-none select-none cursor-not-allowed" 
                         placeholder="F1000" 
                       />
                    </div>
                 </div>
                 <div className="p-4 bg-emerald-50 border border-emerald-100 rounded-2xl flex flex-col gap-2 mt-6">
                    <BadgeCheck className="w-5 h-5 text-emerald-500" />
                    <p className="text-[10px] text-emerald-700 leading-tight">Ao confirmar, o sistema registrará o novo colaborador com a matrícula de nível gerada automaticamente.</p>
                 </div>
                 <div className="flex gap-3 pt-4">
                    <button type="button" onClick={() => setIsModalOpen(false)} className="flex-1 py-3 border border-slate-200 rounded-xl text-sm font-bold text-slate-500 hover:bg-slate-50 transition-all cursor-pointer">Cancelar</button>
                    <button type="submit" className="flex-1 py-3 bg-emerald-600 text-white rounded-xl text-sm font-bold hover:bg-emerald-700 transition-all shadow-lg shadow-emerald-200 cursor-pointer">Confirmar e Registrar</button>
                 </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {registrationSuccess && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-6 bg-slate-900/60 backdrop-blur-md">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="glass-card w-full max-w-sm p-8 text-center"
            >
              <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-4 border-4 border-white shadow-xl shadow-emerald-100/50">
                <CheckCircle2 className="w-8 h-8 text-emerald-600" />
              </div>
              <h3 className="text-xl font-display font-bold text-slate-800">Sucesso!</h3>
              <p className="text-sm text-slate-500 mt-2">Colaborador registrado com sucesso.</p>
              
              <div id="registration-card" className="mt-6 p-6 bg-white rounded-2xl border border-slate-200 text-left space-y-4">
                <div className="flex flex-col gap-1 border-b border-slate-100 pb-3">
                  <h4 className="text-slate-800 font-bold text-base">AgroSystem - Credenciais</h4>
                  <p className="text-[10px] text-slate-500 uppercase tracking-widest font-bold">Documento de Acesso Interno</p>
                </div>

                <div className="space-y-3">
                  <div className="flex justify-between items-start">
                    <div>
                      <label className="text-[9px] font-bold text-slate-400 uppercase">Colaborador</label>
                      <p className="text-sm font-bold text-slate-800">{registrationSuccess.displayName}</p>
                    </div>
                    <div className="text-right">
                      <label className="text-[9px] font-bold text-slate-400 uppercase">Matrícula</label>
                      <p className="font-mono text-emerald-700 font-bold">{registrationSuccess.regNum}</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-[9px] font-bold text-slate-400 uppercase">Cargo</label>
                      <p className="text-slate-800 font-bold text-xs uppercase">{registrationSuccess.role}</p>
                    </div>
                    {registrationSuccess.cert && (
                      <div>
                        <label className="text-[9px] font-bold text-slate-400 uppercase">Certificação</label>
                        <p className="text-slate-800 font-bold text-xs">{registrationSuccess.cert}</p>
                      </div>
                    )}
                  </div>

                  <div className="pt-3 border-t border-slate-100">
                    <label className="text-[9px] font-bold text-slate-400 uppercase">E-mail de Acesso</label>
                    <p className="text-slate-700 font-medium text-xs bg-slate-50 p-2 rounded-lg border border-slate-100">{registrationSuccess.email}</p>
                  </div>

                  <div>
                    <label className="text-[9px] font-bold text-rose-400 uppercase">Senha Temporária</label>
                    <div className="flex bg-rose-50 p-3 rounded-lg border border-rose-100 mt-1">
                      <p className="font-mono text-rose-700 font-bold flex-1 text-center text-xl tracking-widest">{registrationSuccess.tempPass}</p>
                    </div>
                    <p className="text-[9px] text-slate-400 mt-3 leading-tight italic">
                      * Por segurança, você deverá alterar esta senha em seu primeiro acesso ao sistema.
                    </p>
                  </div>
                </div>
              </div>

              <div className="flex gap-3 mt-8">
                <button 
                  onClick={handleDownloadPDF}
                  className="flex-1 py-4 bg-white border border-slate-200 text-slate-600 rounded-xl text-sm font-bold flex items-center justify-center gap-2 hover:bg-slate-50 transition-all"
                >
                  <Download className="w-4 h-4" /> Gerar PDF
                </button>
                <button 
                  onClick={() => setRegistrationSuccess(null)}
                  className="flex-1 py-4 bg-slate-800 text-white rounded-xl text-sm font-bold hover:bg-slate-900 transition-all shadow-lg"
                >
                  Concluído
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {editingAssignmentsUser && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-md overflow-y-auto">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 15 }}
              className="glass-card w-full max-w-2xl bg-white rounded-3xl border border-slate-200 shadow-2xl flex flex-col max-h-[90vh] overflow-hidden"
            >
              {/* Header */}
              <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
                <div className="flex items-center gap-2.5">
                  <div className="w-10 h-10 bg-emerald-100 text-emerald-700 rounded-xl flex items-center justify-center shadow-md shadow-emerald-100/50">
                    <Shield className="w-5 h-5" />
                  </div>
                  <div className="text-left">
                    <h3 className="text-lg font-display font-bold text-slate-800">Atribuições e Sistemas Restritos</h3>
                    <p className="text-xs text-slate-500 font-medium">Configure as atribuições de áreas e sistemas para <span className="font-bold text-emerald-600">{editingAssignmentsUser.displayName}</span></p>
                  </div>
                </div>
                <button 
                  onClick={() => setEditingAssignmentsUser(null)}
                  className="p-1.5 hover:bg-slate-200 text-slate-400 hover:text-slate-600 rounded-lg transition-colors cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Scrollable Form Body */}
              <form onSubmit={(e) => { e.preventDefault(); runExclusive('Users.handleSaveAssignments', () => handleSaveAssignments(e)); }} className="flex-1 overflow-y-auto p-6 space-y-6 text-left custom-scrollbar">
                
                {/* 1. Technical Areas / Assigned Areas */}
                <div className="space-y-3">
                  <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                    <span className="w-1 h-3.5 bg-emerald-500 rounded-full"></span>
                    Atribuição de Áreas Técnicas
                  </h4>
                  <p className="text-xs text-slate-500 leading-normal">Defina a quais frentes de serviço técnico este colaborador está atrelado para seu fluxo de trabalho.</p>
                  
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                    {[
                      { id: 'irrigation', label: 'Irrigação e Recursos Hídricos' },
                      { id: 'documentation', label: 'Regularização Ambiental / CAR' },
                      { id: 'topography', label: 'Topografia e Agrimensura' },
                      { id: 'credit', label: 'Crédito Rural e Projetos' },
                      { id: 'general', label: 'Análises e Vistorias Gerais' }
                    ].map(area => {
                      const isChecked = tempAssignedAreas.includes(area.id);
                      return (
                        <label 
                          key={area.id}
                          className={cn(
                            "flex items-center gap-3 p-3 rounded-2xl border transition-all cursor-pointer select-none",
                            isChecked 
                              ? "bg-emerald-50/40 border-emerald-200 shadow-sm" 
                              : "bg-white border-slate-200 hover:bg-slate-50"
                          )}
                        >
                          <input 
                            type="checkbox"
                            checked={isChecked}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setTempAssignedAreas([...tempAssignedAreas, area.id]);
                              } else {
                                setTempAssignedAreas(tempAssignedAreas.filter(a => a !== area.id));
                              }
                            }}
                            className="sr-only"
                          />
                          <div className={cn(
                            "w-5 h-5 rounded-lg border flex items-center justify-center transition-all",
                            isChecked 
                              ? "bg-emerald-500 border-emerald-500 text-white" 
                              : "border-slate-300 bg-slate-50"
                          )}>
                            {isChecked && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                          </div>
                          <span className={cn("text-xs font-bold", isChecked ? "text-emerald-800" : "text-slate-600")}>
                            {area.label}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </div>

                {/* 2. Restricted Pages Access */}
                <div className="space-y-3 pt-2">
                  <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                    <span className="w-1 h-3.5 bg-emerald-500 rounded-full"></span>
                    Sistemas Restritos e Módulos do Sistema
                  </h4>
                  <p className="text-xs text-slate-500 leading-normal">
                    Selecione quais sistemas adicionais este colaborador poderá visualizar e acessar, contornando as permissões padrão do cargo dele.
                  </p>

                  <div className="space-y-4 pt-1">
                    {/* Management and Finance */}
                    <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100 space-y-3">
                      <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest text-left">Gestão e Finanças</div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                        {[
                          { id: 'financial', label: 'Fluxo Financeiro' },
                          { id: 'contracts', label: 'Gestão de Contratos' },
                          { id: 'documents', label: 'Documentos e Arquivos' },
                          { id: 'clients', label: 'Cadastro de Produtores' },
                          { id: 'field_visits', label: 'Visitas de Campo' },
                          { id: 'scheduling', label: 'Agendamentos' },
                          { id: 'inventory', label: 'Estoque / Insumos' }
                        ].map(page => {
                          const isChecked = tempAllowedPages.includes(page.id);
                          return (
                            <label key={page.id} className="flex items-center gap-2.5 cursor-pointer select-none">
                              <input 
                                type="checkbox"
                                checked={isChecked}
                                onChange={(e) => {
                                  if (e.target.checked) {
                                    setTempAllowedPages([...tempAllowedPages, page.id]);
                                  } else {
                                    setTempAllowedPages(tempAllowedPages.filter(p => p !== page.id));
                                  }
                                }}
                                className="rounded text-slate-600 focus:ring-emerald-500 h-4 w-4 border-slate-300"
                              />
                              <span className="text-xs text-slate-600 font-medium">{page.label}</span>
                            </label>
                          );
                        })}
                      </div>
                    </div>

                    {/* HR and Admin */}
                    <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100 space-y-3">
                      <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest text-left">Recursos Humanos & Administração</div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                        {[
                          { id: 'users', label: 'Gerenciamento de Equipe' },
                          { id: 'hr', label: 'Ponto Eletrônico' },
                          { id: 'vehicles', label: 'Veículos / Km Rodados' },
                          { id: 'audit_logs', label: 'Logs de Auditoria Global' }
                        ].map(page => {
                          const isChecked = tempAllowedPages.includes(page.id);
                          return (
                            <label key={page.id} className="flex items-center gap-2.5 cursor-pointer select-none">
                              <input 
                                type="checkbox"
                                checked={isChecked}
                                onChange={(e) => {
                                  if (e.target.checked) {
                                    setTempAllowedPages([...tempAllowedPages, page.id]);
                                  } else {
                                    setTempAllowedPages(tempAllowedPages.filter(p => p !== page.id));
                                  }
                                }}
                                className="rounded text-slate-600 focus:ring-emerald-500 h-4 w-4 border-slate-300"
                              />
                              <span className="text-xs text-slate-600 font-medium">{page.label}</span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </div>

                {/* 3. Vacation / License Replacement */}
                <div className="space-y-4 pt-2 border-t border-slate-100">
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                        <span className="w-1 h-3.5 bg-amber-500 rounded-full"></span>
                        Substituição de Férias ou Licença
                      </h4>
                      <p className="text-xs text-slate-500 leading-normal mt-0.5">Defina se este colaborador está temporariamente cobrindo as funções de outro.</p>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input 
                        type="checkbox"
                        checked={tempIsVacation}
                        onChange={(e) => setTempIsVacation(e.target.checked)}
                        className="sr-only peer"
                      />
                      <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-amber-500"></div>
                    </label>
                  </div>

                  {tempIsVacation && (
                    <motion.div 
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      className="p-4 bg-amber-50/40 rounded-2xl border border-amber-200 space-y-4"
                    >
                      <div>
                        <label className="block text-[10px] font-bold text-amber-800 uppercase tracking-wider mb-1.5 text-left font-sans">Cobrir funções do colaborador:</label>
                        <select
                          required={tempIsVacation}
                          value={tempReplacementForId}
                          onChange={(e) => handleReplacementChange(e.target.value)}
                          className="w-full bg-white border border-amber-200 rounded-xl px-3.5 py-2.5 text-xs font-bold text-slate-700 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent transition-all"
                        >
                          <option value="">Selecione quem será substituído...</option>
                          {team
                            .filter(u => u.uid !== editingAssignmentsUser.uid)
                            .map(u => (
                              <option key={u.uid} value={u.uid}>
                                {u.displayName} ({(u.role || '').toUpperCase()})
                              </option>
                            ))
                          }
                        </select>
                        <p className="text-[10px] text-amber-700/80 mt-1 leading-normal italic text-left">
                          * Durante a cobertura de férias, o colaborador herdará automaticamente a função e todas as permissões de acesso do colaborador selecionado acima.
                        </p>
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="block text-[10px] font-bold text-amber-800 uppercase tracking-wider mb-1.5 text-left">Início da Cobertura:</label>
                          <div className="relative">
                            <input 
                              type="date"
                              required={tempIsVacation}
                              value={tempStartDate}
                              onChange={(e) => setTempStartDate(e.target.value)}
                              className="w-full bg-white border border-amber-200 rounded-xl pl-10 pr-3.5 py-2 text-xs font-medium text-slate-700 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent transition-all"
                            />
                            <Calendar className="w-4 h-4 text-amber-500 absolute left-3.5 top-3 pointer-events-none" />
                          </div>
                        </div>

                        <div>
                          <label className="block text-[10px] font-bold text-amber-800 uppercase tracking-wider mb-1.5 text-left">Fim da Cobertura:</label>
                          <div className="relative">
                            <input 
                              type="date"
                              required={tempIsVacation}
                              value={tempEndDate}
                              onChange={(e) => setTempEndDate(e.target.value)}
                              className="w-full bg-white border border-amber-200 rounded-xl pl-10 pr-3.5 py-2 text-xs font-medium text-slate-700 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent transition-all"
                            />
                            <Calendar className="w-4 h-4 text-amber-500 absolute left-3.5 top-3 pointer-events-none" />
                          </div>
                        </div>
                      </div>
                    </motion.div>
                  )}
                </div>
              </form>

              {/* Footer Actions */}
              <div className="p-6 border-t border-slate-100 flex gap-3 bg-slate-50/50">
                <button 
                  type="button" 
                  onClick={() => setEditingAssignmentsUser(null)} 
                  className="flex-1 py-3 border border-slate-200 rounded-xl text-xs font-bold text-slate-500 hover:bg-slate-50 transition-all cursor-pointer"
                >
                  Descartar Alterações
                </button>
                <button 
                  onClick={(e) => runExclusive('Users.handleSaveAssignments', () => handleSaveAssignments(e))}
                  disabled={isSavingAssignments}
                  className="flex-1 py-3 bg-emerald-600 text-white rounded-xl text-xs font-bold hover:bg-emerald-700 disabled:bg-slate-400 disabled:cursor-not-allowed transition-all shadow-lg shadow-emerald-200 flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  {isSavingAssignments ? 'Salvando...' : 'Salvar Atribuições'}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <ConfirmationModal
        isOpen={!!isDeleteModalOpen}
        onClose={() => setIsDeleteModalOpen(null)}
        onConfirm={() => isDeleteModalOpen && handleDeleteUser(isDeleteModalOpen)}
        title="Remover Acesso?"
        description={`Esta ação removerá permanentemente o acesso de ${isDeleteModalOpen?.displayName}. Ele não poderá mais acessar o sistema.`}
        confirmLabel="Remover Acesso"
      />

      {/* User Detail Modal with Assignments, Delegations and Permissions Tabs */}
      <UserDetailModal
        isOpen={!!detailModalUser}
        onClose={() => setDetailModalUser(null)}
        user={detailModalUser}
        team={team}
        initialTab={detailModalTab}
      />

      {/* Global New Delegation Modal triggered from Header */}
      <NewDelegationModal
        isOpen={isGlobalNewDelegationOpen}
        onClose={() => setIsGlobalNewDelegationOpen(false)}
        team={team}
      />
    </div>
  );
}


