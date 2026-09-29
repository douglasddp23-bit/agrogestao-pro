import React, { useState, useEffect } from 'react';
import { ROLE_LABELS, UserRole } from '../lib/permissions';
import { runExclusive } from '../lib/submitGuard';
import { 
  User, 
  Mail, 
  Briefcase, 
  Hash, 
  Calendar, 
  Palmtree, 
  FileText, 
  Camera,
  ChevronRight,
  DollarSign,
  AlertCircle,
  KeyRound,
  Shield,
  Edit,
  Bell,
  X,
  Loader2
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { cn, formatDate, formatCurrency } from '../lib/utils';
import { toast } from 'sonner';
import { doc, getDoc, updateDoc, collection, query, where, onSnapshot, addDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { motion, AnimatePresence } from 'motion/react';
import PageHeader from '../components/layout/PageHeader';
import { User as PageIcon } from 'lucide-react';
import TwoFactorCard from '../components/security/TwoFactorCard';
import BackupCard from '../components/security/BackupCard';
import ChangePasswordModal from '../components/security/ChangePasswordModal';

const compressImage = (file: File, maxWidth = 180, maxHeight = 180): Promise<string> => {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > maxWidth) {
            height = Math.round((height * maxWidth) / width);
            width = maxWidth;
          }
        } else {
          if (height > maxHeight) {
            width = Math.round((width * maxHeight) / height);
            height = maxHeight;
          }
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0, width, height);
          const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
          resolve(dataUrl);
        } else {
          resolve(e.target?.result as string || '');
        }
      };
      img.src = e.target?.result as string;
    };
    reader.readAsDataURL(file);
  });
};

const dataURItoBlob = (dataURI: string) => {
  const byteString = atob(dataURI.split(',')[1]);
  const mimeString = dataURI.split(',')[0].split(':')[1].split(';')[0];
  const ab = new ArrayBuffer(byteString.length);
  const ia = new Uint8Array(ab);
  for (let i = 0; i < byteString.length; i++) {
    ia[i] = byteString.charCodeAt(i);
  }
  return new Blob([ab], { type: mimeString });
};

export default function Profile() {
  const { user, updateUserProfile } = useAuth();
  const [profileData, setProfileData] = useState<any>(null);
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [isUpdatingPhoto, setIsUpdatingPhoto] = useState(false);
  const [isEditingName, setIsEditingName] = useState(false);
  const [tempName, setTempName] = useState('');

  const defaultSettings = {
    newTasks: { email: true, push: true },
    upcomingDeadlines: { email: true, push: true },
    projectUpdates: { email: true, push: true },
    otherInfo: { email: true, push: true }
  };

  const [notifSettings, setNotifSettings] = useState(defaultSettings);

  useEffect(() => {
    if (!user?.uid) return;
    
    // Optimistic: Seed state from user context instantly to bypass any loading delay
    setProfileData(user);
    setTempName(user.displayName || '');

    const docRef = doc(db, 'users', user.uid);
    getDoc(docRef).then(snap => {
      if (snap.exists()) {
        const data = snap.data();
        setProfileData(data);
        if (data.displayName) {
          setTempName(data.displayName);
        }
        if (data.notificationSettings) {
          setNotifSettings({
            newTasks: { ...defaultSettings.newTasks, ...data.notificationSettings.newTasks },
            upcomingDeadlines: { ...defaultSettings.upcomingDeadlines, ...data.notificationSettings.upcomingDeadlines },
            projectUpdates: { ...defaultSettings.projectUpdates, ...data.notificationSettings.projectUpdates },
            otherInfo: { ...defaultSettings.otherInfo, ...data.notificationSettings.otherInfo }
          });
        }
      }
      setLoadingProfile(false);
    }).catch(err => {
      console.warn('Silent skip of profile fetching from firestore (client offline or sandbox limit):', err);
      setLoadingProfile(false);
    });
  }, [user]);

  const handleToggleSetting = async (category: string, type: 'email' | 'push', value: boolean) => {
    if (!user?.uid) return;

    const updatedSettings = {
      ...notifSettings,
      [category]: {
        ...(notifSettings as any)[category],
        [type]: value
      }
    };

    setNotifSettings(updatedSettings);

    try {
      const docRef = doc(db, 'users', user.uid);
      await updateDoc(docRef, {
        notificationSettings: updatedSettings
      });
      toast.success('Preferência de notificação salva com sucesso!');
    } catch (err) {
      console.error(err);
      toast.error('Erro ao salvar preferências de notificação.');
    }
  };

  const handleUpdatePhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user?.uid) return;
    setIsUpdatingPhoto(true);
    const toastId = toast.loading('Enviando foto...');
    try {
      // Always compress the image first to a high-quality lightweight 180x180 JPEG (usually < 10KB)
      // Fica no próprio perfil (sem Firebase Storage, que exige plano pago).
      const url = await compressImage(file, 180, 180);

      await updateUserProfile({ photoURL: url });
      setProfileData((prev: any) => prev ? { ...prev, photoURL: url } : { photoURL: url });
      toast.success('Foto de perfil atualizada!', { id: toastId });
    } catch (err: any) {
      console.error(err);
      toast.error('Erro ao atualizar foto: ' + (err.message || ''), { id: toastId });
    } finally {
      setIsUpdatingPhoto(false);
    }
  };

  const handleSaveName = async () => {
    if (!tempName.trim()) {
      toast.error('O nome não pode ficar em branco.');
      return;
    }
    const toastId = toast.loading('Salvando nome...');
    try {
      await updateUserProfile({ displayName: tempName.trim() });
      setProfileData((prev: any) => prev ? { ...prev, displayName: tempName.trim() } : { displayName: tempName.trim() });
      setIsEditingName(false);
      toast.success('Nome atualizado com sucesso!', { id: toastId });
    } catch (err: any) {
      console.error(err);
      toast.error('Erro ao atualizar nome: ' + (err.message || ''), { id: toastId });
    }
  };

  // Abre direto a troca de senha quando vem do aviso "sua senha vence em X dias"
  const [isChangePasswordOpen, setIsChangePasswordOpen] = useState(
    () => new URLSearchParams(window.location.search).has('trocarSenha')
  );
  const handleResetPassword = () => setIsChangePasswordOpen(true);

  const [myVacations, setMyVacations] = useState<any[]>([]);
  const [isVacationModalOpen, setIsVacationModalOpen] = useState(false);
  const [vacationSubmitting, setVacationSubmitting] = useState(false);
  const [vacationForm, setVacationForm] = useState({
    startDate: '',
    endDate: '',
    reason: ''
  });

  const [isPayrollModalOpen, setIsPayrollModalOpen] = useState(false);
  const [selectedPayroll, setSelectedPayroll] = useState<any | null>(null);

  useEffect(() => {
    if (!user?.uid) return;
    const qVac = query(collection(db, 'vacations'), where('userId', '==', user.uid));
    const unsub = onSnapshot(qVac, (snap) => {
      setMyVacations(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }, (err) => {
      console.warn("Vacation query fallback:", err);
    });
    return () => unsub();
  }, [user]);

  // Holerites reais (coleção payrolls, gerados pelo RH em Ponto Eletrônico → Folha de Pagamento)
  const [payrolls, setPayrolls] = useState<any[]>([]);
  const [payrollsUnavailable, setPayrollsUnavailable] = useState(false);
  useEffect(() => {
    if (!user?.uid) return;
    const qPay = query(collection(db, 'payrolls'), where('employeeId', '==', user.uid));
    const unsub = onSnapshot(qPay, (snap) => {
      setPayrollsUnavailable(false);
      setPayrolls(
        snap.docs
          .map(d => ({ id: d.id, ...d.data() } as any))
          .sort((a, b) => String(b.month || '').localeCompare(String(a.month || '')))
      );
    }, (err) => {
      console.warn('Payroll query:', err);
      setPayrollsUnavailable(true);
    });
    return () => unsub();
  }, [user]);

  const formatMonth = (month?: string) => {
    if (!month || !/^\d{4}-\d{2}$/.test(month)) return month || 'Não informado';
    const [y, m] = month.split('-');
    return `${m}/${y}`;
  };

  const payrollStatusLabel: Record<string, string> = {
    pending: 'Em processamento',
    approved: 'Aprovada',
    paid: 'Paga',
  };

  const vacationStatusLabel = (status?: string) => {
    const s = (status || '').toLowerCase();
    if (s === 'approved' || s === 'aprovado') return 'Aprovado';
    if (s === 'rejected' || s === 'rejeitado') return 'Rejeitado';
    return 'Aguardando RH';
  };

  const handleSubmitVacation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user?.uid) return;
    if (!vacationForm.startDate || !vacationForm.endDate) {
      toast.error('Informe as datas de início e término das férias.');
      return;
    }
    const start = new Date(vacationForm.startDate + 'T00:00:00');
    const end = new Date(vacationForm.endDate + 'T00:00:00');
    const daysRequested = Math.round((end.getTime() - start.getTime()) / 86400000) + 1;
    if (daysRequested < 5 || daysRequested > 30) {
      toast.error('A solicitação de férias deve ter no mínimo 5 e no máximo 30 dias (e a data de término deve ser depois do início).');
      return;
    }
    setVacationSubmitting(true);
    try {
      await addDoc(collection(db, 'vacations'), {
        userId: user.uid,
        userName: user.displayName || user.email,
        userRole: user.role,
        startDate: vacationForm.startDate,
        endDate: vacationForm.endDate,
        daysRequested,
        reason: vacationForm.reason || 'Férias regulares',
        // Mesmo valor usado pelo RH para listar pedidos pendentes e mostrar Aprovar/Rejeitar
        status: 'pending',
        createdAt: new Date().toISOString()
      });
      toast.success('Solicitação de férias enviada ao RH com sucesso!');
      setIsVacationModalOpen(false);
      setVacationForm({ startDate: '', endDate: '', reason: '' });
    } catch (err: any) {
      console.error(err);
      toast.error('Erro ao enviar solicitação: ' + (err.message || ''));
    } finally {
      setVacationSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col gap-6 h-full overflow-y-auto pr-2 pb-10">
      {isChangePasswordOpen && <ChangePasswordModal onClose={() => setIsChangePasswordOpen(false)} />}
      <PageHeader icon={PageIcon} title="Meu Perfil" subtitle="Seus dados, senha, férias e preferências" />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Profile Card */}
        <div className="lg:col-span-1 space-y-6">
          <div className="glass-card p-8 flex flex-col items-center text-center relative overflow-hidden">
             <div className="absolute top-0 left-0 w-full h-24 bg-emerald-600/10"></div>
             
             <div className="relative mt-4">
                <div className="w-32 h-32 rounded-full border-4 border-white shadow-xl overflow-hidden bg-emerald-100 flex items-center justify-center">
                   {isUpdatingPhoto ? (
                     <div className="w-8 h-8 border-4 border-emerald-500 border-t-transparent animate-spin rounded-full"></div>
                   ) : profileData?.photoURL || user?.photoURL ? (
                     <img src={profileData?.photoURL || user?.photoURL} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                   ) : (
                     <User className="w-16 h-16 text-emerald-600" />
                   )}
                </div>
                <label 
                   htmlFor="profile-photo-upload"
                   className={cn(
                     "absolute bottom-0 right-0 p-2 bg-emerald-600 text-white rounded-full border-2 border-white shadow-lg hover:bg-emerald-700 transition-colors cursor-pointer flex items-center justify-center",
                     isUpdatingPhoto && "pointer-events-none opacity-50"
                   )}
                >
                   <Camera className="w-4 h-4" />
                </label>
                <input 
                  type="file" 
                  id="profile-photo-upload" 
                  className="hidden" 
                  accept="image/*" 
                  onChange={handleUpdatePhoto} 
                  disabled={isUpdatingPhoto}
                />
             </div>

             <div className="mt-4 w-full px-2">
                {isEditingName ? (
                  <div className="flex flex-col items-center gap-2">
                    <input
                      type="text"
                      value={tempName}
                      onChange={(e) => setTempName(e.target.value)}
                      className="w-full glass-input text-center text-sm font-bold py-1.5 focus:border-emerald-500 rounded-lg"
                      placeholder="Seu Nome Completo"
                      autoFocus
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={() => runExclusive('Profile.handleSaveName', () => handleSaveName())}
                        className="px-3 py-1 bg-emerald-600 text-white rounded-lg text-[10px] font-bold uppercase tracking-wider hover:bg-emerald-700 transition-colors cursor-pointer"
                      >
                        Salvar
                      </button>
                      <button
                        onClick={() => setIsEditingName(false)}
                        className="px-3 py-1 bg-slate-100 text-slate-500 rounded-lg text-[10px] font-bold uppercase tracking-wider hover:bg-slate-200 transition-colors cursor-pointer"
                      >
                        Cancelar
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col items-center">
                    <div className="flex items-center gap-1.5 group/name justify-center">
                      <h3 className="text-xl font-display font-bold text-slate-800">{profileData?.displayName || user?.displayName}</h3>
                      <button
                        onClick={() => {
                          setTempName(profileData?.displayName || user?.displayName || '');
                          setIsEditingName(true);
                        }}
                        className="p-1 text-slate-400 hover:text-emerald-600 transition-colors cursor-pointer"
                        title="Editar nome"
                      >
                        <Edit className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <p className="text-sm font-bold text-emerald-600 uppercase tracking-wider mt-0.5">{ROLE_LABELS[(profileData?.role || user?.role) as UserRole] || profileData?.role || user?.role}</p>
                  </div>
                )}
             </div>

             <div className="w-full mt-8 space-y-4 text-left">
                <div className="flex items-center gap-3 p-3 bg-white/40 rounded-xl border border-white/60">
                   <Mail className="w-4 h-4 text-slate-400" />
                   <div>
                      <div className="text-[10px] font-bold text-slate-400 uppercase">E-mail</div>
                      <div className="text-xs font-medium text-slate-700">{profileData?.email || user?.email}</div>
                   </div>
                </div>
                <div className="flex items-center gap-3 p-3 bg-white/40 rounded-xl border border-white/60">
                   <Briefcase className="w-4 h-4 text-slate-400" />
                   <div>
                      <div className="text-[10px] font-bold text-slate-400 uppercase">Cargo</div>
                      <div className="text-xs font-medium text-slate-700 capitalize">{ROLE_LABELS[(profileData?.role || user?.role) as UserRole] || profileData?.role || user?.role}</div>
                   </div>
                </div>
                <div className="flex items-center gap-3 p-3 bg-white/40 rounded-xl border border-white/60">
                   <Hash className="w-4 h-4 text-slate-400" />
                   <div>
                      <div className="text-[10px] font-bold text-slate-400 uppercase">Matrícula</div>
                      <div className="text-xs font-medium text-slate-700">{profileData?.registrationNumber || user?.registrationNumber || 'AGRO-2024-000'}</div>
                   </div>
                </div>
                {(profileData?.professionalCertification || user?.professionalCertification) && (
                   <div className="flex items-center gap-3 p-3 bg-white/40 rounded-xl border border-white/60">
                      <Shield className="w-4 h-4 text-emerald-500" />
                      <div>
                         <div className="text-[10px] font-bold text-slate-400 uppercase">Certificação</div>
                         <div className="text-xs font-medium text-slate-700">{profileData?.professionalCertification || user?.professionalCertification}</div>
                      </div>
                   </div>
                )}
             </div>

             <div className="w-full pt-4">
                <button 
                  onClick={handleResetPassword}
                  className="w-full py-3 bg-white border border-slate-200 text-slate-600 rounded-xl font-bold text-xs uppercase tracking-widest hover:bg-slate-50 transition-all flex items-center justify-center gap-2"
                >
                  <KeyRound className="w-3.5 h-3.5 text-emerald-600" /> Alterar Minha Senha
                </button>
             </div>
          </div>

          <div className="glass-card p-6">
             <h4 className="text-sm font-bold text-slate-800 mb-4 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-amber-500" />
                Dicas de Segurança
             </h4>
             <p className="text-[11px] text-slate-500 leading-relaxed italic">
                Mantenha sua senha segura e não a compartilhe com outros colaboradores. Lembre-se de sempre bater o ponto no início e fim da jornada.
             </p>
          </div>
        </div>

        {/* Info Tabs */}
        <div className="lg:col-span-2 space-y-6">
           {/* Professional & Admission */}
           <div className="glass-card p-8">
              <h3 className="font-display font-bold text-lg mb-6 flex items-center gap-2">
                 <Briefcase className="w-5 h-5 text-emerald-600" /> Informações Profissionais
              </h3>
              <div className="grid grid-cols-2 gap-8">
                 <div className="space-y-1">
                    <span className="text-[10px] font-bold text-slate-400 uppercase">Data de Admissão</span>
                    <div className="flex items-center gap-2 text-sm font-bold text-slate-700">
                       <Calendar className="w-4 h-4 text-emerald-500" /> {profileData?.admissionDate ? (formatDate(profileData.admissionDate) || profileData.admissionDate) : 'Não informado'}
                    </div>
                 </div>
                 <div className="space-y-1">
                    <span className="text-[10px] font-bold text-slate-400 uppercase">Departamento</span>
                    <div className="text-sm font-bold text-slate-700">{profileData?.department || 'Não informado'}</div>
                 </div>
                 <div className="space-y-1">
                    <span className="text-[10px] font-bold text-slate-400 uppercase">Gestor Local</span>
                    <div className="text-sm font-bold text-slate-700">{profileData?.manager || 'Não informado'}</div>
                 </div>
                 <div className="space-y-1">
                    <span className="text-[10px] font-bold text-slate-400 uppercase">Unidade</span>
                    <div className="text-sm font-bold text-slate-700">{profileData?.unit || 'Não informado'}</div>
                 </div>
              </div>
           </div>

           {/* Segurança e backup — só para a conta de Administrador */}
           {user?.role === 'admin' && (
             <>
               <TwoFactorCard />
               <BackupCard />
             </>
           )}

           {/* Notification Settings */}
           <div className="glass-card p-8 text-left">
              <h3 className="font-display font-bold text-lg mb-6 flex items-center gap-2">
                 <Bell className="w-5 h-5 text-emerald-600" /> Preferências de Notificações
              </h3>
              <p className="text-xs text-slate-500 mb-6 font-medium">
                Personalize como deseja receber alertas sobre novas tarefas, prazos de vencimentos e atualizações de projetos do AgroGestão.
              </p>
              
              <div className="space-y-4">
                {/* Category 1: Novas Tarefas */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between p-4 bg-slate-50/50 border border-slate-100 rounded-2xl gap-3 text-left">
                  <div>
                    <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider text-left">Novas Tarefas e Serviços</h4>
                    <p className="text-[10px] text-slate-400 mt-0.5 font-medium text-left">Alertas ao ser designado para novas análises ou projetos técnicos.</p>
                  </div>
                  <div className="flex items-center gap-4 shrink-0 justify-start">
                    <label className="flex items-center gap-1.5 cursor-pointer select-none">
                      <input 
                        type="checkbox" 
                        checked={notifSettings.newTasks.push} 
                        onChange={(e) => handleToggleSetting('newTasks', 'push', e.target.checked)}
                        className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500 h-4 w-4" 
                      />
                      <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Push</span>
                    </label>
                    <label className="flex items-center gap-1.5 cursor-pointer select-none">
                      <input 
                        type="checkbox" 
                        checked={notifSettings.newTasks.email} 
                        onChange={(e) => handleToggleSetting('newTasks', 'email', e.target.checked)}
                        className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500 h-4 w-4" 
                      />
                      <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">E-mail</span>
                    </label>
                  </div>
                </div>

                {/* Category 2: Prazos Próximos */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between p-4 bg-slate-50/50 border border-slate-100 rounded-2xl gap-3 text-left">
                  <div>
                    <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider text-left">Prazos e Vencimentos</h4>
                    <p className="text-[10px] text-slate-400 mt-0.5 font-medium text-left">Notificações preventivas de vencimento de contratos ou cadastros rurais.</p>
                  </div>
                  <div className="flex items-center gap-4 shrink-0 justify-start">
                    <label className="flex items-center gap-1.5 cursor-pointer select-none">
                      <input 
                        type="checkbox" 
                        checked={notifSettings.upcomingDeadlines.push} 
                        onChange={(e) => handleToggleSetting('upcomingDeadlines', 'push', e.target.checked)}
                        className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500 h-4 w-4" 
                      />
                      <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Push</span>
                    </label>
                    <label className="flex items-center gap-1.5 cursor-pointer select-none">
                      <input 
                        type="checkbox" 
                        checked={notifSettings.upcomingDeadlines.email} 
                        onChange={(e) => handleToggleSetting('upcomingDeadlines', 'email', e.target.checked)}
                        className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500 h-4 w-4" 
                      />
                      <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">E-mail</span>
                    </label>
                  </div>
                </div>

                {/* Category 3: Atualizações de Projetos */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between p-4 bg-slate-50/50 border border-slate-100 rounded-2xl gap-3 text-left">
                  <div>
                    <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider text-left">Atualizações de Projetos</h4>
                    <p className="text-[10px] text-slate-400 mt-0.5 font-medium text-left">Alertas de alteração de laudos, novos faturamentos ou pareceres técnicos.</p>
                  </div>
                  <div className="flex items-center gap-4 shrink-0 justify-start">
                    <label className="flex items-center gap-1.5 cursor-pointer select-none">
                      <input 
                        type="checkbox" 
                        checked={notifSettings.projectUpdates.push} 
                        onChange={(e) => handleToggleSetting('projectUpdates', 'push', e.target.checked)}
                        className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500 h-4 w-4" 
                      />
                      <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Push</span>
                    </label>
                    <label className="flex items-center gap-1.5 cursor-pointer select-none">
                      <input 
                        type="checkbox" 
                        checked={notifSettings.projectUpdates.email} 
                        onChange={(e) => handleToggleSetting('projectUpdates', 'email', e.target.checked)}
                        className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500 h-4 w-4" 
                      />
                      <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">E-mail</span>
                    </label>
                  </div>
                </div>

                {/* Category 4: Outros */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between p-4 bg-slate-50/50 border border-slate-100 rounded-2xl gap-3 text-left">
                  <div>
                    <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider text-left">Outras Informações Relevantes</h4>
                    <p className="text-[10px] text-slate-400 mt-0.5 font-medium text-left">Mensagens administrativas e circulares internas de coordenação de campo.</p>
                  </div>
                  <div className="flex items-center gap-4 shrink-0 justify-start">
                    <label className="flex items-center gap-1.5 cursor-pointer select-none">
                      <input 
                        type="checkbox" 
                        checked={notifSettings.otherInfo.push} 
                        onChange={(e) => handleToggleSetting('otherInfo', 'push', e.target.checked)}
                        className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500 h-4 w-4" 
                      />
                      <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Push</span>
                    </label>
                    <label className="flex items-center gap-1.5 cursor-pointer select-none">
                      <input 
                        type="checkbox" 
                        checked={notifSettings.otherInfo.email} 
                        onChange={(e) => handleToggleSetting('otherInfo', 'email', e.target.checked)}
                        className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500 h-4 w-4" 
                      />
                      <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">E-mail</span>
                    </label>
                  </div>
                </div>
              </div>
           </div>

           {/* Vacation Section */}
           <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="glass-card p-6">
                 <div className="flex justify-between items-center mb-6">
                    <h3 className="font-display font-bold flex items-center gap-2">
                       <Palmtree className="w-5 h-5 text-emerald-600" /> Férias
                    </h3>
                    <button 
                      onClick={() => setIsVacationModalOpen(true)}
                      className="text-[10px] font-bold text-emerald-600 hover:text-emerald-700 bg-emerald-50 hover:bg-emerald-100 px-3 py-1 rounded-lg uppercase tracking-wider transition-colors cursor-pointer"
                    >
                      Solicitar
                    </button>
                 </div>
                 
                 <div className="flex gap-4 mb-6">
                    <div className="flex-1 bg-emerald-50 p-4 rounded-2xl border border-emerald-100">
                       <div className="text-[10px] font-bold text-emerald-600 uppercase">Dias Disponíveis</div>
                       <div className={cn("font-bold text-emerald-800", profileData?.vacationDaysAvailable != null ? "text-2xl" : "text-xs mt-1")}>{profileData?.vacationDaysAvailable ?? 'Não informado pelo RH'}</div>
                    </div>
                    <div className="flex-1 bg-slate-50 p-4 rounded-2xl border border-slate-100">
                       <div className="text-[10px] font-bold text-slate-400 uppercase">Próximo Período</div>
                       <div className="text-xs font-bold text-slate-600 mt-1">{profileData?.nextVacationPeriod || 'Não informado pelo RH'}</div>
                    </div>
                 </div>

                 <div className="space-y-3">
                    <span className="text-[10px] font-bold text-slate-400 uppercase">Minhas Solicitações</span>
                    {myVacations.length > 0 ? (
                      myVacations.map(req => (
                        <div key={req.id} className="flex justify-between items-center p-3 bg-white/40 rounded-xl border border-white/60">
                           <div>
                             <div className="text-xs font-bold text-slate-700">{formatDate(req.startDate)} até {formatDate(req.endDate)}</div>
                             {req.reason && <div className="text-[10px] text-slate-400 truncate max-w-[140px]">{req.reason}</div>}
                           </div>
                           <span className={cn(
                             "text-[9px] px-2 py-0.5 rounded-lg font-bold uppercase",
                             vacationStatusLabel(req.status) === 'Aprovado' ? 'bg-emerald-100 text-emerald-700' :
                             vacationStatusLabel(req.status) === 'Rejeitado' ? 'bg-rose-100 text-rose-700' : 'bg-amber-100 text-amber-700'
                           )}>
                             {vacationStatusLabel(req.status)}
                           </span>
                        </div>
                      ))
                    ) : (
                      <div className="p-4 text-center text-[11px] text-slate-400 bg-white/40 rounded-xl border border-white/60">
                        Você ainda não fez nenhuma solicitação de férias.
                      </div>
                    )}
                 </div>
              </div>

              {/* Payroll Section */}
              <div className="glass-card p-6">
                 <div className="flex justify-between items-center mb-6">
                    <h3 className="font-display font-bold flex items-center gap-2">
                       <FileText className="w-5 h-5 text-emerald-600" /> Folha de Pagamento
                    </h3>
                    {payrolls.length > 0 && (
                      <button
                        onClick={() => {
                          setSelectedPayroll(payrolls[0]);
                          setIsPayrollModalOpen(true);
                        }}
                        className="text-[10px] font-bold text-emerald-600 hover:text-emerald-700 bg-emerald-50 hover:bg-emerald-100 px-3 py-1 rounded-lg uppercase tracking-wider transition-colors cursor-pointer"
                      >
                        Ver Detalhes
                      </button>
                    )}
                 </div>

                 <div className="space-y-3">
                    {payrolls.length === 0 && (
                      <div className="p-4 text-center text-[11px] text-slate-400 bg-white/40 rounded-xl border border-white/60">
                        {payrollsUnavailable
                          ? 'Seus holerites ainda não estão liberados para consulta aqui. Fale com o RH.'
                          : 'Nenhum holerite lançado pelo RH até agora.'}
                      </div>
                    )}
                    {payrolls.map(pay => (
                      <div 
                        key={pay.id} 
                        onClick={() => {
                          setSelectedPayroll(pay);
                          setIsPayrollModalOpen(true);
                        }}
                        className="flex justify-between items-center p-3 bg-white/40 rounded-xl border border-white/60 hover:bg-white/60 transition-all cursor-pointer group"
                      >
                         <div className="flex items-center gap-3">
                            <div className="p-2 bg-emerald-100 text-emerald-600 rounded-lg group-hover:bg-emerald-600 group-hover:text-white transition-colors">
                               <DollarSign className="w-4 h-4" />
                            </div>
                            <div>
                               <div className="text-xs font-bold text-slate-700">Competência {formatMonth(pay.month)}</div>
                               <div className="text-[10px] text-slate-400">{payrollStatusLabel[pay.status] || 'Em processamento'}</div>
                            </div>
                         </div>
                         <div className="flex items-center gap-2">
                           <span className="text-xs font-bold text-slate-800">{formatCurrency(pay.netSalary)}</span>
                           <ChevronRight className="w-4 h-4 text-slate-300" />
                         </div>
                      </div>
                    ))}
                 </div>
              </div>
           </div>
        </div>
      </div>

      {/* Vacation Request Modal */}
      <AnimatePresence>
        {isVacationModalOpen && (
          <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-slate-900/80 backdrop-blur-md">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-3xl w-full max-w-md p-6 shadow-2xl border border-slate-100 text-left"
            >
              <div className="flex items-center justify-between border-b border-slate-100 pb-4 mb-4">
                <div className="flex items-center gap-2.5">
                  <div className="p-2.5 bg-emerald-50 rounded-xl text-emerald-600">
                    <Palmtree className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="font-display font-bold text-slate-800 text-base">Solicitar Férias</h3>
                    <p className="text-[11px] text-slate-400">Envie o pedido para aprovação do RH</p>
                  </div>
                </div>
                <button onClick={() => setIsVacationModalOpen(false)} className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100">
                  <X className="w-4 h-4" />
                </button>
              </div>

              <form onSubmit={(e) => { e.preventDefault(); runExclusive('Profile.handleSubmitVacation', () => handleSubmitVacation(e)); }} className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Data Início</label>
                    <input
                      type="date"
                      required
                      value={vacationForm.startDate}
                      onChange={(e) => setVacationForm({ ...vacationForm, startDate: e.target.value })}
                      className="w-full glass-input text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Data Término</label>
                    <input
                      type="date"
                      required
                      value={vacationForm.endDate}
                      onChange={(e) => setVacationForm({ ...vacationForm, endDate: e.target.value })}
                      className="w-full glass-input text-xs"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Observações / Motivo (Opcional)</label>
                  <textarea
                    rows={3}
                    placeholder="Ex: Férias do período aquisitivo 2025/2026..."
                    value={vacationForm.reason}
                    onChange={(e) => setVacationForm({ ...vacationForm, reason: e.target.value })}
                    className="w-full glass-input text-xs resize-none"
                  />
                </div>

                <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={() => setIsVacationModalOpen(false)}
                    className="px-4 py-2 text-xs font-bold text-slate-500 hover:bg-slate-100 rounded-xl uppercase tracking-wider"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={vacationSubmitting}
                    className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl uppercase tracking-wider flex items-center gap-2 disabled:opacity-50"
                  >
                    {vacationSubmitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                    Enviar Solicitação
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Payroll Details Modal */}
      <AnimatePresence>
        {isPayrollModalOpen && selectedPayroll && (
          <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-slate-900/80 backdrop-blur-md">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-3xl w-full max-w-md p-6 shadow-2xl border border-slate-100 text-left"
            >
              <div className="flex items-center justify-between border-b border-slate-100 pb-4 mb-4">
                <div className="flex items-center gap-2.5">
                  <div className="p-2.5 bg-emerald-50 rounded-xl text-emerald-600">
                    <DollarSign className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="font-display font-bold text-slate-800 text-base">Comprovante de Holerite</h3>
                    <p className="text-[11px] text-slate-400">Competência: {formatMonth(selectedPayroll.month)}</p>
                  </div>
                </div>
                <button onClick={() => setIsPayrollModalOpen(false)} className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100">
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="space-y-3">
                <div className="flex justify-between items-center p-3 bg-slate-50 rounded-xl">
                  <span className="text-xs font-bold text-slate-500 uppercase">Salário Base Bruto</span>
                  <span className="text-sm font-bold text-slate-800">{formatCurrency(selectedPayroll.baseSalary)}</span>
                </div>
                <div className="flex justify-between items-center p-3 bg-slate-50 rounded-xl">
                  <span className="text-xs font-bold text-slate-500 uppercase">Horas Extras / Adicionais</span>
                  <span className="text-sm font-bold text-emerald-700">+ {formatCurrency(selectedPayroll.extraHoursVal)}</span>
                </div>
                <div className="flex justify-between items-center p-3 bg-slate-50 rounded-xl">
                  <span className="text-xs font-bold text-slate-500 uppercase">Descontos (INSS / IRRF / outros)</span>
                  <span className="text-sm font-bold text-rose-600">- {formatCurrency(selectedPayroll.deductions)}</span>
                </div>
                {selectedPayroll.notes && (
                  <p className="text-[11px] text-slate-500 italic px-1">{selectedPayroll.notes}</p>
                )}
                <div className="flex justify-between items-center p-4 bg-emerald-50 border border-emerald-100 rounded-2xl">
                  <div>
                    <div className="text-[10px] font-bold text-emerald-700 uppercase tracking-wider">Valor Líquido</div>
                    <div className="text-xs text-slate-500">{payrollStatusLabel[selectedPayroll.status] || 'Em processamento'}</div>
                  </div>
                  <span className="text-xl font-display font-bold text-emerald-800">{formatCurrency(selectedPayroll.netSalary)}</span>
                </div>
              </div>

              <div className="pt-4 mt-2 border-t border-slate-100 flex justify-end">
                <button
                  onClick={() => setIsPayrollModalOpen(false)}
                  className="px-5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl uppercase tracking-wider"
                >
                  Fechar
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
