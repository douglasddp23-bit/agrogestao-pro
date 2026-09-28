import React, { useState, useEffect, useMemo } from 'react';
import { runExclusive } from '../lib/submitGuard';
import { 
  UsersRound, 
  Clock, 
  Calendar, 
  MapPin, 
  CheckCircle2, 
  AlertCircle,
  TrendingDown,
  TrendingUp,
  UserCheck,
  UserX,
  Palmtree,
  UserPlus,
  X,
  Check,
  ArrowRight,
  ShieldAlert,
  Award,
  Plus,
  HelpCircle,
  Activity,
  Landmark,
  DollarSign,
  Briefcase,
  FileText,
  FileSpreadsheet
} from 'lucide-react';
import { collection, addDoc, onSnapshot, query, orderBy, limit, where, serverTimestamp, Timestamp, doc, updateDoc, setDoc, deleteField } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useAuth } from '../contexts/AuthContext';
import { AttendanceRecord, UserProfile, VacationRequest } from '../types';
import { logAudit } from '../lib/audit';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';
import { handleFirestoreError, OperationType, formatDateTime, formatDate, cn, todayLocalDateString, sortByDateDesc, toMillis, formatCurrency, validateCPF } from '../lib/utils';
import WeeklyWorkedHoursChart from '../components/WeeklyWorkedHoursChart';
import { canCreateRole, UserRole, ROLE_LABELS } from '../lib/permissions';
import { PageTitle, PAGE_HEADER_CLASS } from '../components/layout/PageHeader';
import { Clock as PageIcon } from 'lucide-react';

export default function HR() {
  const { user } = useAuth();
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [team, setTeam] = useState<UserProfile[]>([]);
  // Dados confidenciais (CPF, salário, banco) ficam em employee_records/{uid}, que só
  // RH/Admin (e o próprio colaborador) leem — o documento users/{uid} é visível a todos.
  const [employeeRecords, setEmployeeRecords] = useState<Record<string, any>>({});
  const [lastLog, setLastLog] = useState<AttendanceRecord | null>(null);
  const [vacations, setVacations] = useState<VacationRequest[]>([]);
  const [leaves, setLeaves] = useState<any[]>([]);
  const [payrolls, setPayrolls] = useState<any[]>([]);
  const [hrLogs, setHrLogs] = useState<any[]>([]);
  const [activeTab, setActiveTab] = useState<'meu_painel' | 'funcionarios' | 'licencas' | 'folha' | 'logs'>('meu_painel');
  const [currentTime, setCurrentTime] = useState(new Date());

  // Modals / Form states
  const [isVacationModalOpen, setIsVacationModalOpen] = useState(false);
  const [newVacation, setNewVacation] = useState({
    startDate: '',
    endDate: '',
    reason: ''
  });

  const [isLeaveModalOpen, setIsLeaveModalOpen] = useState(false);
  const [newLeave, setNewLeave] = useState({
    startDate: '',
    endDate: '',
    type: 'médica',
    reason: ''
  });

  const [isEmployeeModalOpen, setIsEmployeeModalOpen] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState<any | null>(null);
  const [employeeForm, setEmployeeForm] = useState({
    displayName: '',
    email: '',
    role: 'consultant',
    registrationNumber: '',
    cpf: '',
    phone: '',
    department: 'Operações',
    salary: '',
    admissionDate: '',
    bankName: '',
    bankAgency: '',
    bankAccount: '',
    hoursPerDay: '8',
    status: 'Ativo'
  });

  const [isPayrollModalOpen, setIsPayrollModalOpen] = useState(false);
  const [payrollForm, setPayrollForm] = useState({
    employeeId: '',
    month: todayLocalDateString().substring(0, 7),
    baseSalary: '0',
    extraHoursVal: '0',
    deductions: '0',
    notes: ''
  });

  // Log filter state
  const [logTypeFilter, setLogTypeFilter] = useState<'all' | 'admin' | 'employee' | 'hr'>('all');

  const activeRole = (user?.effectiveRole ?? user?.role) as UserRole;
  const isHROrAdmin = (user?.effectiveRole ?? user?.role) === 'admin' || (user?.effectiveRole ?? user?.role) === 'hr';
  const isAdmin = (user?.effectiveRole ?? user?.role) === 'admin';
  const isManagement = isHROrAdmin;

  const isVacationOverdue = (admissionDateStr?: string, takenCount = 0, lastDateStr?: string) => {
    if (!admissionDateStr) return false;
    const admission = new Date(admissionDateStr);
    const today = new Date();
    const totalMonths = (today.getFullYear() - admission.getFullYear()) * 12 + (today.getMonth() - admission.getMonth());
    const periodsAcquired = Math.floor(totalMonths / 12);
    if (periodsAcquired <= 1) return false;
    const periodsTaken = takenCount;
    const pendingPeriods = periodsAcquired - 1 - periodsTaken;
    return pendingPeriods > 0;
  };

  // Pedidos feitos pelo "Meu Perfil" antes da correção foram gravados como 'Pendente'
  const isPendingVacation = (status?: string) => status === 'pending' || status === 'Pendente';

  const statusTranslation: Record<string, string> = {
    pending: 'Aguardando',
    Pendente: 'Aguardando',
    approved: 'Aprovado',
    rejected: 'Reprovado'
  };

  const daysCount = useMemo(() => {
    if (!newVacation.startDate || !newVacation.endDate) return 0;
    try {
      const start = new Date(newVacation.startDate + 'T00:00:00');
      const end = new Date(newVacation.endDate + 'T00:00:00');
      const diff = end.getTime() - start.getTime();
      if (diff < 0) return 0;
      return Math.round(diff / (1000 * 60 * 60 * 24)) + 1;
    } catch {
      return 0;
    }
  }, [newVacation.startDate, newVacation.endDate]);

  const isVacationValid = daysCount >= 5 && daysCount <= 30;

  // CLT: direito a férias após 12 meses de trabalho (período aquisitivo), contados da admissão.
  // Antes o botão exigia 30 dias com as 4 batidas de ponto completas, o que bloqueava quase todos.
  const vacationEligibility = useMemo(() => {
    const raw = (user as any)?.admissionDate as string | undefined;
    const match = raw && /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
    if (!match) return { known: false, eligible: true, availableFrom: '' };
    const admission = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    const firstRight = new Date(admission.getFullYear() + 1, admission.getMonth(), admission.getDate());
    return {
      known: true,
      eligible: new Date() >= firstRight,
      availableFrom: firstRight.toLocaleDateString('pt-BR'),
    };
  }, [user]);

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!isHROrAdmin) return;
    return onSnapshot(collection(db, 'employee_records'), (snap) => {
      const map: Record<string, any> = {};
      snap.docs.forEach(d => { map[d.id] = d.data(); });
      setEmployeeRecords(map);
    }, (err) => console.warn('[HR] Fichas confidenciais indisponíveis:', err));
  }, [isHROrAdmin]);

  // Equipe com os dados confidenciais mesclados (só aparecem para RH/Admin)
  const teamView = useMemo(
    () => team.map(t => ({ ...t, ...(employeeRecords[t.uid] || {}) })),
    [team, employeeRecords]
  );

  useEffect(() => {
    // 1. Team members list
    const unsubscribeTeam = onSnapshot(query(collection(db, 'users'), limit(100)), (snapshot) => {
      setTeam(snapshot.docs.map(doc => ({ uid: doc.id, ...doc.data() } as UserProfile)));
    });

    // 2. Vacations list
    // Para quem não é RH/Admin, as consultas filtram pelo próprio usuário SEM orderBy:
    // where(userId) + orderBy(outro campo) exige índice composto que não existe no projeto
    // (as listas nunca carregavam). A ordenação é feita aqui.
    const qVac = isManagement
      ? query(collection(db, 'vacations'), orderBy('createdAt', 'desc'), limit(50))
      : query(collection(db, 'vacations'), where('userId', '==', user?.uid || ''));

    const unsubscribeVac = onSnapshot(qVac, (snapshot) => {
      setVacations(sortByDateDesc(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as VacationRequest)), 'createdAt'));
    }, (err) => console.warn('[HR] Férias indisponíveis:', err));

    // 3. Leaves (Licenças) list
    const qLeaves = isManagement
      ? query(collection(db, 'leaves'), orderBy('createdAt', 'desc'), limit(50))
      : query(collection(db, 'leaves'), where('userId', '==', user?.uid || ''));

    const unsubscribeLeaves = onSnapshot(qLeaves, (snapshot) => {
      setLeaves(sortByDateDesc(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as any)), 'createdAt'));
    }, (err) => console.warn('[HR] Licenças indisponíveis:', err));

    // 4. Payrolls (Folha de Pagamento) list
    const qPayrolls = isManagement
      ? query(collection(db, 'payrolls'), orderBy('month', 'desc'), limit(50))
      : query(collection(db, 'payrolls'), where('employeeId', '==', user?.uid || ''));

    const unsubscribePayrolls = onSnapshot(qPayrolls, (snapshot) => {
      setPayrolls(snapshot.docs
        .map(doc => ({ id: doc.id, ...doc.data() } as any))
        .sort((a, b) => String(b.month || '').localeCompare(String(a.month || ''))));
    }, (err) => {
      console.warn('[HR] Folha indisponível para este usuário:', err);
      setPayrolls([]);
    });

    // 5. System Logs list (aba Auditoria & Logs só existe para RH/Admin)
    const unsubscribeLogs = isManagement
      ? onSnapshot(query(collection(db, 'logs'), orderBy('timestamp', 'desc'), limit(150)), (snapshot) => {
          setHrLogs(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as any)));
        }, (err) => console.warn('[HR] Logs indisponíveis:', err))
      : () => {};

    // 6. Attendance records
    if (user) {
      const oneYearAgo = Timestamp.fromDate(
        new Date(Date.now() - 365 * 24 * 60 * 60 * 1000)
      );
      const q = isManagement
        ? query(
            collection(db, 'attendance'),
            where('timestamp', '>=', oneYearAgo.toDate().toISOString()),
            orderBy('timestamp', 'desc'),
            limit(1000)
          )
        : query(
            collection(db, 'attendance'),
            where('userId', '==', user.uid)
          );
      const oneYearAgoIso = oneYearAgo.toDate().toISOString();
      const unsubscribeAtt = onSnapshot(q, (snapshot) => {
        let data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as AttendanceRecord));
        if (!isManagement) {
          // Filtro de 1 ano e ordenação feitos aqui (ver comentário acima sobre índices).
          data = sortByDateDesc(data.filter(r => toMillis(r.timestamp) >= Date.parse(oneYearAgoIso)), 'timestamp');
        }
        setRecords(data);
        const myLastLog = data.find(r => r.userId === user.uid);
        if (myLastLog) setLastLog(myLastLog);
      }, (err) => {
        console.error('[HR] Erro ao carregar registros de ponto:', err);
        toast.error('Não foi possível carregar seu histórico de ponto. Verifique a conexão.');
      });

      return () => { 
        unsubscribeTeam(); 
        unsubscribeVac();
        unsubscribeLeaves();
        unsubscribePayrolls();
        unsubscribeLogs();
        unsubscribeAtt();
      };
    }
  }, [user, isManagement]);

  const getTimestampMs = (timestamp: any): number => {
    if (!timestamp) return 0;
    try {
      if (typeof timestamp.toDate === 'function') {
        return timestamp.toDate().getTime();
      }
      if (typeof timestamp.seconds === 'number') {
        return timestamp.seconds * 1000;
      }
      const d = new Date(timestamp);
      const t = d.getTime();
      return isNaN(t) ? 0 : t;
    } catch {
      return 0;
    }
  };

  const getRecordDateStr = (record: AttendanceRecord) => {
    if (!record.timestamp) return '';
    try {
      const ms = getTimestampMs(record.timestamp);
      if (ms === 0) return '';
      return new Date(ms).toLocaleDateString('pt-BR');
    } catch {
      return '';
    }
  };

  const todayStr = new Date().toLocaleDateString('pt-BR');
  const myRecordsToday = records
    .filter(r => r.userId === user?.uid && getRecordDateStr(r) === todayStr)
    .sort((a, b) => getTimestampMs(a.timestamp) - getTimestampMs(b.timestamp));

  const getRecordPontoLabel = (record: AttendanceRecord) => {
    if (!record.timestamp) return 'Ponto';
    try {
      const ms = getTimestampMs(record.timestamp);
      if (ms === 0) return 'Ponto';
      const recDate = new Date(ms);
      const recDay = recDate.toLocaleDateString('pt-BR');
      const dayRecordsOfUser = records
        .filter(r => r.userId === record.userId && getRecordDateStr(r) === recDay)
        .sort((a, b) => getTimestampMs(a.timestamp) - getTimestampMs(b.timestamp));
        
      const idx = dayRecordsOfUser.findIndex(r => r.id === record.id);
      return idx !== -1 ? `Ponto ${idx + 1}` : 'Ponto';
    } catch {
      return 'Ponto';
    }
  };

  const monthlySummary = useMemo(() => {
    if (!user) return { totalHours: 0, completedDays: 0, periodDays: 0, incompleteDays: 0, totalOvertime: 0, dailyDetails: [] };

    const oneYearAgo = Date.now() - 365 * 24 * 60 * 60 * 1000;
    const myRecords = records.filter(r =>
      r.userId === user.uid &&
      getTimestampMs(r.timestamp) >= oneYearAgo
    );

    const daysMap: Record<string, { records: AttendanceRecord[] }> = {};
    myRecords.forEach(rec => {
      if (!rec.timestamp) return;
      try {
        const ms = getTimestampMs(rec.timestamp);
        if (ms === 0) return;
        // Data local (Brasil). toISOString() usa UTC e jogava batidas após 21h para o dia seguinte.
        const d = new Date(ms);
        const dayKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        if (!daysMap[dayKey]) {
          daysMap[dayKey] = { records: [] };
        }
        daysMap[dayKey].records.push(rec);
      } catch (e) {
        console.error(e);
      }
    });

    let totalMs = 0;
    let completedDays = 0;
    let periodDays = 0;
    let incompleteDays = 0;
    let totalOvertime = 0;
    const dailyDetails: any[] = [];
    const oneYearAgoMs = Date.now() - 365 * 24 * 60 * 60 * 1000;

    Object.keys(daysMap).forEach(dayKey => {
      const dayRecs = daysMap[dayKey].records.sort((a, b) => getTimestampMs(a.timestamp) - getTimestampMs(b.timestamp));
      let dayMs = 0;
      const isComplete = dayRecs.length === 4;

      if (isComplete) {
        for (let i = 0; i < dayRecs.length - 1; i += 2) {
          const recStart = dayRecs[i];
          const recEnd = dayRecs[i + 1];
          if (recStart && recEnd) {
            const tS = getTimestampMs(recStart.timestamp);
            const tE = getTimestampMs(recEnd.timestamp);
            if (tS > 0 && tE > 0) {
              dayMs += (tE - tS);
            }
          }
        }
        completedDays++;
        try {
          const dayTime = new Date(dayKey + 'T00:00:00').getTime();
          if (dayTime >= oneYearAgoMs) {
            periodDays++;
          }
        } catch (_) {
          periodDays++;
        }
      } else {
        incompleteDays++;
      }

      totalMs += dayMs;
      const dayHoursDecimal = dayMs / (1000 * 60 * 60);
      const overtimeHours = Math.max(0, dayHoursDecimal - 8);
      totalOvertime += overtimeHours;

      dailyDetails.push({
        dateStr: dayKey,
        hours: dayHoursDecimal,
        recordCount: dayRecs.length,
        isComplete,
        overtimeHours
      });
    });

    const totalHoursDecimal = totalMs / (1000 * 60 * 60);

    return {
      totalHours: totalHoursDecimal,
      completedDays,
      periodDays,
      incompleteDays,
      totalOvertime,
      dailyDetails: dailyDetails.sort((a, b) => b.dateStr.localeCompare(a.dateStr))
    };
  }, [records, user]);

  const handleClockAction = () => {
    if (!user) return;

    if (lastLog && lastLog.timestamp) {
      try {
        const lastTs = lastLog.timestamp.toDate ? lastLog.timestamp.toDate().getTime() : new Date(lastLog.timestamp).getTime();
        const diffMs = Date.now() - lastTs;
        if (diffMs < 60 * 1000) {
          toast.error("O intervalo mínimo entre as batidas de ponto é de 1 minuto.");
          return;
        }
      } catch (e) {
        console.error(e);
      }
    }

    const todayStrStr = new Date().toLocaleDateString('pt-BR');
    const countToday = records.filter(r => r.userId === user.uid && getRecordDateStr(r) === todayStrStr).length;
    if (countToday >= 4) {
      toast.warning('Seus 4 pontos já foram registrados hoje.');
      return;
    }

    toast("Confirmar registro de ponto?", {
      description: "Tem certeza que deseja registrar o seu ponto agora?",
      action: {
        label: "Confirmar",
        onClick: async () => {
          try {
            const nextType = countToday % 2 === 0 ? 'in' : 'out';
            await addDoc(collection(db, 'attendance'), {
              userId: user.uid,
              userName: user.displayName,
              type: nextType,
              timestamp: new Date().toISOString(),
            });

            // Log employee activity
            await logAudit({
              userId: user.uid,
              userName: user.displayName || user.email,
              action: 'created',
              collection: 'attendance',
              recordId: user.uid,
              recordName: user.displayName || user.email,
              details: `Ponto de ${nextType === 'in' ? 'Entrada' : 'Saída'} registrado por ${user.displayName}.`
            });

            if (myRecordsToday.length + 1 >= 4) {
              toast.success('Jornada do dia concluída! Até amanhã. 🌿');
            } else {
              toast.success('Ponto registrado com sucesso!');
            }
          } catch (error) {
            handleFirestoreError(error, OperationType.CREATE, 'attendance');
          }
        }
      }
    });
  };

  // ─── ADD / EDIT EMPLOYEE ──────────────────────────────────────────
  const handleOpenNewEmployee = () => {
    setEditingEmployee(null);
    setEmployeeForm({
      displayName: '',
      email: '',
      role: 'consultant',
      registrationNumber: Math.floor(1000 + Math.random() * 9000).toString(),
      cpf: '',
      phone: '',
      department: 'Operações',
      salary: '',
      admissionDate: todayLocalDateString(),
      bankName: '',
      bankAgency: '',
      bankAccount: '',
      hoursPerDay: '8',
      status: 'Ativo'
    });
    setIsEmployeeModalOpen(true);
  };

  const handleOpenEditEmployee = (emp: any) => {
    setEditingEmployee(emp);
    setEmployeeForm({
      displayName: emp.displayName || '',
      email: emp.email || '',
      role: emp.role || 'consultant',
      registrationNumber: emp.registrationNumber || '',
      cpf: emp.cpf || '',
      phone: emp.phone || '',
      department: emp.department || 'Operações',
      salary: emp.salary || '',
      admissionDate: emp.admissionDate || '',
      bankName: emp.bankName || '',
      bankAgency: emp.bankAgency || '',
      bankAccount: emp.bankAccount || '',
      hoursPerDay: emp.hoursPerDay || '8',
      status: emp.status || 'Ativo'
    });
    setIsEmployeeModalOpen(true);
  };

  const handleSaveEmployeeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (employeeForm.displayName.trim().length < 3) {
      toast.error('Informe o nome completo do colaborador.');
      return;
    }
    if (employeeForm.cpf && !validateCPF(employeeForm.cpf)) {
      toast.error('O CPF informado é inválido.');
      return;
    }
    // Dados confidenciais vão para employee_records (só RH/Admin e o próprio leem);
    // o restante fica no perfil público users/{uid}.
    const { cpf, salary, bankName, bankAgency, bankAccount, ...publicData } = employeeForm;
    const confidential = { cpf, salary, bankName, bankAgency, bankAccount, updatedAt: new Date().toISOString(), updatedBy: user?.uid || '' };
    try {
      if (editingEmployee) {
        const empRef = doc(db, 'users', editingEmployee.uid);
        await updateDoc(empRef, {
          ...publicData,
          // limpa cópias antigas que possam ter ficado no perfil público
          cpf: deleteField(), salary: deleteField(), bankName: deleteField(), bankAgency: deleteField(), bankAccount: deleteField(),
          updatedAt: serverTimestamp()
        });
        await setDoc(doc(db, 'employee_records', editingEmployee.uid), confidential, { merge: true });

        // Log administrative and HR audit action
        await logAudit({
          userId: user?.uid || 'unknown',
          userName: user?.displayName || user?.email || 'Administrador',
          action: 'updated',
          collection: 'users',
          recordId: editingEmployee.uid,
          recordName: employeeForm.displayName,
          details: `Cadastro do funcionário ${employeeForm.displayName} atualizado (Cargo: ${employeeForm.role}, Setor: ${employeeForm.department}).`
        });

        toast.success('Colaborador atualizado com sucesso!');
      } else {
        // Create random UID for mock client registration in Firestore
        const newUid = doc(collection(db, 'users')).id;
        const userRef = doc(db, 'users', newUid);
        await setDoc(userRef, {
          uid: newUid,
          ...publicData,
          createdBy: user?.uid || '',
          createdAt: new Date().toISOString()
        });
        await setDoc(doc(db, 'employee_records', newUid), confidential);

        // Log HR audit action
        await logAudit({
          userId: user?.uid || 'unknown',
          userName: user?.displayName || user?.email || 'Administrador',
          action: 'created',
          collection: 'users',
          recordId: newUid,
          recordName: employeeForm.displayName,
          details: `Novo colaborador ${employeeForm.displayName} cadastrado no departamento de ${employeeForm.department}.`
        });

        // Esta ficha não cria login: contas de acesso são criadas em Equipe/RH → Usuários.
        toast.success('Ficha do colaborador cadastrada!', {
          description: 'Para ele entrar no sistema, crie também o acesso em Usuários.',
          duration: 8000,
        });
      }
      setIsEmployeeModalOpen(false);
    } catch (err) {
      toast.error('Erro ao salvar os dados do colaborador.');
      console.error(err);
    }
  };

  // ─── LEAVE MANAGEMENT (LICENÇAS) ──────────────────────────────────
  const handleRequestLeave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newLeave.startDate || !newLeave.endDate) {
      toast.error('As datas de início e término são obrigatórias.');
      return;
    }
    try {
      const leaveRef = await addDoc(collection(db, 'leaves'), {
        userId: user?.uid,
        userName: user?.displayName,
        startDate: newLeave.startDate,
        endDate: newLeave.endDate,
        type: newLeave.type,
        reason: newLeave.reason,
        status: 'pending',
        createdAt: new Date().toISOString()
      });

      // Log Employee Activity
      await logAudit({
        userId: user?.uid || 'unknown',
        userName: user?.displayName || user?.email || 'Usuário',
        action: 'created',
        collection: 'leaves',
        recordId: leaveRef.id,
        recordName: user?.displayName || 'Usuário',
        details: `Licença do tipo ${newLeave.type} solicitada de ${newLeave.startDate} a ${newLeave.endDate}.`
      });

      toast.success('Solicitação de licença registrada!');
      setIsLeaveModalOpen(false);
      setNewLeave({ startDate: '', endDate: '', type: 'médica', reason: '' });
    } catch (err) {
      toast.error('Erro ao registrar solicitação de licença.');
      console.error(err);
    }
  };

  const handleLeaveStatusChange = async (leaveId: string, employeeName: string, type: string, status: 'approved' | 'rejected') => {
    try {
      await updateDoc(doc(db, 'leaves', leaveId), { status });

      // Log HR action
      await logAudit({
        userId: user?.uid || 'unknown',
        userName: user?.displayName || user?.email || 'RH',
        action: status === 'approved' ? 'approved' : 'rejected',
        collection: 'leaves',
        recordId: leaveId,
        recordName: employeeName,
        details: `Solicitação de licença (${type}) de ${employeeName} foi ${status === 'approved' ? 'aprovada' : 'rejeitada'}.`
      });

      toast.success(`Solicitação de licença ${status === 'approved' ? 'aprovada' : 'rejeitada'} com sucesso!`);
    } catch (err) {
      toast.error('Erro ao atualizar status da licença.');
      console.error(err);
    }
  };

  // ─── PAYROLL MANAGEMENT (FOLHA DE PAGAMENTO) ──────────────────────
  const handleOpenNewPayroll = () => {
    setPayrollForm({
      employeeId: '',
      month: todayLocalDateString().substring(0, 7),
      baseSalary: '0',
      extraHoursVal: '0',
      deductions: '0',
      notes: ''
    });
    setIsPayrollModalOpen(true);
  };

  // Auto fill base salary when employee is selected
  useEffect(() => {
    if (payrollForm.employeeId) {
      const selectedEmp = teamView.find(t => t.uid === payrollForm.employeeId) as any;
      if (selectedEmp && selectedEmp.salary) {
        setPayrollForm(prev => ({
          ...prev,
          baseSalary: selectedEmp.salary.toString()
        }));
      }
    }
  }, [payrollForm.employeeId, teamView]);

  const handleGeneratePayrollSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!payrollForm.employeeId) {
      toast.error('Selecione um colaborador.');
      return;
    }
    const emp = team.find(t => t.uid === payrollForm.employeeId);
    if (!emp) return;

    if (payrolls.some(p => p.employeeId === payrollForm.employeeId && p.month === payrollForm.month)) {
      toast.error(`Já existe uma folha de ${emp.displayName} para ${payrollForm.month}. Edite ou exclua a existente antes de gerar outra.`);
      return;
    }

    try {
      const base = parseFloat(payrollForm.baseSalary) || 0;
      const extra = parseFloat(payrollForm.extraHoursVal) || 0;
      const ded = parseFloat(payrollForm.deductions) || 0;
      const net = (base + extra) - ded;
      if (base <= 0) {
        toast.error('Informe o salário base do colaborador.');
        return;
      }
      if (net < 0) {
        toast.error('Os descontos são maiores que o salário bruto. Confira os valores.');
        return;
      }

      const payrollRef = await addDoc(collection(db, 'payrolls'), {
        employeeId: payrollForm.employeeId,
        employeeName: emp.displayName,
        month: payrollForm.month,
        baseSalary: base,
        extraHoursVal: extra,
        deductions: ded,
        netSalary: net,
        notes: payrollForm.notes,
        status: 'pending',
        createdAt: new Date().toISOString(),
        createdBy: user?.displayName || 'Sistema'
      });

      // Log HR action
      await logAudit({
        userId: user?.uid || 'unknown',
        userName: user?.displayName || user?.email || 'RH',
        action: 'created',
        collection: 'payrolls',
        recordId: payrollRef.id,
        recordName: `${emp.displayName} - ${payrollForm.month}`,
        details: `Folha de pagamento de ${emp.displayName} gerada para ${payrollForm.month} (Bruto: ${formatCurrency((base+extra))}, Líquido: ${formatCurrency(net)}).`
      });

      toast.success('Folha de pagamento gerada!');
      setIsPayrollModalOpen(false);
    } catch (err) {
      toast.error('Erro ao gerar folha de pagamento.');
      console.error(err);
    }
  };

  const handlePayrollStatusChange = async (payrollId: string, employeeName: string, month: string, currentNet: number, status: 'approved' | 'paid') => {
    try {
      await updateDoc(doc(db, 'payrolls', payrollId), { status });

      // Log HR audit process
      await logAudit({
        userId: user?.uid || 'unknown',
        userName: user?.displayName || user?.email || 'RH',
        action: 'status_changed',
        collection: 'payrolls',
        recordId: payrollId,
        recordName: `${employeeName} - ${month}`,
        details: `Folha de pagamento de ${employeeName} para ${month} foi marcada como ${status === 'paid' ? 'Paga' : 'Aprovada'} (Valor: ${formatCurrency(currentNet)}).`
      });

      toast.success(`Folha de pagamento ${status === 'paid' ? 'marcada como Paga' : 'Aprovada'} com sucesso!`);
    } catch (err) {
      toast.error('Erro ao atualizar folha.');
      console.error(err);
    }
  };

  // ─── FILTERED AUDIT / HR LOGS ─────────────────────────────────────
  const filteredHrLogs = useMemo(() => {
    return hrLogs.filter(log => {
      if (logTypeFilter === 'all') return true;
      if (logTypeFilter === 'admin') {
        // System wide actions, user block/unblock, edits on users collection
        return log.collection === 'users' && (log.action === 'created' || log.action === 'updated' || log.action === 'deleted');
      }
      if (logTypeFilter === 'employee') {
        // Attendance logs, leaves/vacation requests
        return log.collection === 'attendance' || (log.collection === 'vacations' && log.action === 'created') || (log.collection === 'leaves' && log.action === 'created');
      }
      if (logTypeFilter === 'hr') {
        // Payroll creation and approvals, leave approvals, vacation approvals
        return log.collection === 'payrolls' || (log.collection === 'vacations' && (log.action === 'approved' || log.action === 'rejected')) || (log.collection === 'leaves' && (log.action === 'approved' || log.action === 'rejected'));
      }
      return true;
    });
  }, [hrLogs, logTypeFilter]);

  return (
    <div className="flex flex-col gap-6 h-full p-2">
      {/* Header and custom navigation tab system */}
      <div className={PAGE_HEADER_CLASS} data-page-header>
        <PageTitle icon={PageIcon} title="Ponto Eletrônico" subtitle="Ponto, férias, licenças e folha de pagamento" />

        {/* Tab switcher buttons */}
        <div className="flex flex-wrap gap-1 bg-slate-100 p-1 rounded-2xl">
          <button 
            onClick={() => setActiveTab('meu_painel')}
            className={cn(
              "px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer",
              activeTab === 'meu_painel' ? "bg-white text-emerald-700 shadow-sm" : "text-slate-600 hover:text-slate-900"
            )}
          >
            Meu Painel
          </button>
          
          {isManagement && (
            <button 
              onClick={() => setActiveTab('funcionarios')}
              className={cn(
                "px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer",
                activeTab === 'funcionarios' ? "bg-white text-emerald-700 shadow-sm" : "text-slate-600 hover:text-slate-900"
              )}
            >
              Funcionários
            </button>
          )}

          <button 
            onClick={() => setActiveTab('licencas')}
            className={cn(
              "px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer",
              activeTab === 'licencas' ? "bg-white text-emerald-700 shadow-sm" : "text-slate-600 hover:text-slate-900"
            )}
          >
            Licenças & Afastamentos
          </button>

          <button 
            onClick={() => setActiveTab('folha')}
            className={cn(
              "px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer",
              activeTab === 'folha' ? "bg-white text-emerald-700 shadow-sm" : "text-slate-600 hover:text-slate-900"
            )}
          >
            {isManagement ? 'Folha de Pagamento' : 'Minha Folha'}
          </button>

          {isManagement && (
            <button 
              onClick={() => setActiveTab('logs')}
              className={cn(
                "px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer",
                activeTab === 'logs' ? "bg-white text-emerald-700 shadow-sm" : "text-slate-600 hover:text-slate-900"
              )}
            >
              Auditoria & Logs
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 min-h-0">
        <AnimatePresence mode="wait">
          {/* 1. MEU PAINEL TAB */}
          {activeTab === 'meu_painel' && (
            <motion.div 
              key="meu_painel"
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -15 }}
              className="flex flex-col lg:flex-row gap-6 h-full"
            >
              <div className="flex-1 flex flex-col gap-6 overflow-y-auto pr-1">
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                  {/* Clock Control Card */}
                  <div className="glass-card p-6 flex flex-col items-center justify-center text-center gap-4 bg-gradient-to-br from-emerald-50 to-white/60 border-emerald-200">
                    <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center text-emerald-600 mb-2">
                      <Clock className="w-8 h-8 animate-pulse" />
                    </div>
                    <div>
                      <h3 className="text-xl font-display font-bold">Registro de Ponto</h3>
                      <p className="text-sm text-slate-500 mt-1">Pontos hoje: <span className="font-bold text-emerald-600">{Math.min(myRecordsToday.length, 4)} / 4</span></p>
                    </div>
                    
                    <div className="my-2 py-3 px-6 bg-white/70 rounded-2xl border border-emerald-100 shadow-sm w-full max-w-xs">
                      <div className="text-3xl font-mono font-bold text-slate-800 tracking-wider">
                        {currentTime.toLocaleTimeString('pt-BR')}
                      </div>
                      <div className="text-[10px] font-bold text-slate-400 uppercase mt-1">
                        {currentTime.toLocaleDateString('pt-BR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
                      </div>
                    </div>

                    {/* Histórico Diário de 4 Pontos */}
                    <div className="w-full grid grid-cols-4 gap-2 py-3 px-4 bg-white/75 rounded-2xl border border-emerald-100 shadow-sm">
                      {[0, 1, 2, 3].map((index) => {
                        const rec = myRecordsToday[index];
                        let timeStr = '--:--';
                        if (rec && rec.timestamp) {
                          try {
                            const dateObj = new Date(rec.timestamp);
                            timeStr = dateObj.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
                          } catch (e) {
                            timeStr = '--:--';
                          }
                        }
                        return (
                          <div key={index} className="flex flex-col items-center bg-white/80 p-2 rounded-xl border border-slate-100 shadow-xs">
                            <span className="text-[8px] font-bold text-slate-400 uppercase tracking-wider mb-1">Ponto {index + 1}</span>
                            <span className={cn(
                              "text-xs font-mono font-bold",
                              rec ? "text-emerald-600 font-bold" : "text-slate-300"
                            )}>
                              {timeStr}
                            </span>
                          </div>
                        );
                      })}
                    </div>

                    <div className="w-full mt-2">
                      {myRecordsToday.length >= 4 ? (
                        <div className="w-full py-4 rounded-2xl font-bold flex items-center justify-center gap-2 bg-emerald-50 text-emerald-800 border border-emerald-200 shadow-sm">
                          <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                          Jornada do dia completa ✓
                        </div>
                      ) : (
                        <button 
                          onClick={handleClockAction}
                          className="w-full py-4 text-white bg-emerald-600 hover:bg-emerald-700 rounded-2xl font-bold flex items-center justify-center gap-2 transition-all shadow-lg shadow-emerald-200 hover:scale-[1.01] active:scale-[0.99] cursor-pointer"
                        >
                          <UserCheck className="w-5 h-5" />
                          Registrar Ponto
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Card Resumo do Mês */}
                  <div className="glass-card p-6 flex flex-col gap-4 bg-gradient-to-br from-emerald-50/50 to-white/60 border-slate-200">
                    <div className="flex items-center gap-2 border-b border-slate-100 pb-2">
                      <div className="w-8 h-8 rounded-lg bg-emerald-600 text-white flex items-center justify-center">
                        <Calendar className="w-4 h-4" />
                      </div>
                      <div>
                        <h3 className="font-display font-semibold text-sm text-slate-800">Resumo do Mês</h3>
                        <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Estimativa de Jornada</p>
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-2">
                      <div className="bg-white/85 p-2.5 rounded-2xl border border-slate-100/85 shadow-xs flex flex-col justify-between">
                        <span className="text-[9px] uppercase font-bold text-slate-400">Total Horas</span>
                        <div className="text-base font-black text-slate-700 mt-2">
                          {monthlySummary.totalHours.toFixed(1)}h
                        </div>
                      </div>

                      <div className="bg-white/85 p-2.5 rounded-2xl border border-slate-100/85 shadow-xs flex flex-col justify-between">
                        <span className="text-[9px] uppercase font-bold text-slate-400">Hrs Extras</span>
                        <div className="text-base font-black text-amber-600 mt-2">
                          +{monthlySummary.totalOvertime.toFixed(1)}h
                        </div>
                      </div>

                      <div className="bg-white/85 p-2.5 rounded-2xl border border-slate-100/85 shadow-xs flex flex-col justify-between">
                        <span className="text-[9px] uppercase font-bold text-slate-400">Status Dias</span>
                        <div className="flex gap-1 items-center mt-2.5">
                          <span className="text-[10px] font-bold text-emerald-600">✓ {monthlySummary.completedDays}</span>
                          <span className="text-[10px] font-bold text-rose-500">⚠ {monthlySummary.incompleteDays}</span>
                        </div>
                      </div>
                    </div>

                    <div className="flex-1 overflow-y-auto max-h-[160px] custom-scrollbar space-y-2 mt-1">
                      {monthlySummary.dailyDetails.map((day: any) => {
                        const parts = day.dateStr.split('-');
                        const formattedDay = parts.length === 3 ? `${parts[2]}/${parts[1]}` : day.dateStr;

                        return (
                          <div key={day.dateStr} className="flex justify-between items-center p-2.5 bg-white/65 rounded-xl border border-white/50 text-[11px]">
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-slate-700">{formattedDay}</span>
                              <span className={cn(
                                "text-[8px] font-black uppercase px-2 py-0.5 rounded-full",
                                day.isComplete ? "bg-emerald-50 text-emerald-700 border border-emerald-100" : "bg-rose-50 text-rose-600 border border-rose-100"
                              )}>
                                {day.isComplete ? "Completo" : "Batida Ausente"}
                              </span>
                              {day.isComplete && day.overtimeHours > 0 && (
                                <span className="bg-amber-50 text-amber-700 border border-amber-100 text-[8px] font-black uppercase px-1.5 py-0.5 rounded">
                                  +{day.overtimeHours.toFixed(1)}h
                                </span>
                              )}
                            </div>
                            <span className="font-mono font-bold text-slate-800">
                              {day.hours.toFixed(1)} Hs
                            </span>
                          </div>
                        );
                      })}
                      {monthlySummary.dailyDetails.length === 0 && (
                        <div className="text-center py-6 text-slate-400 text-[11px] italic">
                          Nenhuma batida registrada neste mês.
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Vacation Summary Card */}
                  <div className="glass-card p-6 flex flex-col gap-4">
                    <h3 className="font-display font-bold">Férias & Saldo</h3>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="bg-white/40 p-4 rounded-2xl border border-white/60">
                        <div className="text-[10px] uppercase font-bold text-slate-400 mb-1">Membros Ativos</div>
                        <div className="text-2xl font-bold text-slate-800">{team.filter(m => !m.blocked).length}</div>
                        <div className="flex items-center gap-1 text-[10px] text-emerald-600 font-bold mt-1">
                          <UserCheck className="w-3 h-3" /> Total da Equipe
                        </div>
                      </div>
                      <div className="bg-white/40 p-4 rounded-2xl border border-white/60">
                        <div className="text-[10px] uppercase font-bold text-slate-400 mb-1">Férias Pendentes</div>
                        <div className="text-2xl font-bold text-slate-800">{vacations.filter(v => isPendingVacation(v.status)).length}</div>
                        <div className="flex items-center gap-1 text-[10px] text-amber-600 font-bold mt-1">
                          <Palmtree className="w-3 h-3" /> Aguardando
                        </div>
                      </div>
                    </div>
                    
                    <div className="flex flex-col gap-2 mt-2 w-full">
                      {vacationEligibility.eligible ? (
                        <div className="self-center px-2.5 py-1 rounded bg-emerald-100 text-emerald-800 text-[10px] font-bold uppercase tracking-wider text-center">
                          {vacationEligibility.known ? 'Período aquisitivo completo' : 'Admissão não informada'}
                        </div>
                      ) : (
                        <div className="self-center px-2.5 py-1 rounded bg-amber-100 text-amber-800 text-[10px] font-bold uppercase tracking-wider text-center">
                          Férias liberadas a partir de {vacationEligibility.availableFrom}
                        </div>
                      )}

                      <button
                        disabled={!vacationEligibility.eligible}
                        onClick={() => setIsVacationModalOpen(true)}
                        className={cn(
                          "w-full py-2.5 text-white rounded-xl text-xs font-bold transition-all border flex items-center justify-center gap-2",
                          vacationEligibility.eligible
                            ? "bg-emerald-600 border-emerald-500 hover:bg-emerald-700 shadow-lg shadow-emerald-100 cursor-pointer"
                            : "bg-slate-200 border-slate-200 text-slate-400 cursor-not-allowed opacity-60"
                        )}
                      >
                        <Palmtree className="w-4 h-4" /> Solicitar Férias
                      </button>

                      <div className="text-center text-[10px] text-slate-500 font-medium pt-1">
                        {vacationEligibility.known
                          ? 'Direito a 30 dias após cada 12 meses de trabalho (CLT).'
                          : 'O RH confere o período aquisitivo ao analisar o pedido.'}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Gráfico de Barras: Distribuição de Horas Trabalhadas por Colaborador */}
                <WeeklyWorkedHoursChart team={team} records={records} />

                {/* Bottom Lists: Attendance Records & Vacation Requests */}
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 min-h-[300px]">
                  {/* Attendance History */}
                  <div className="glass-card flex flex-col overflow-hidden">
                    <div className="p-4 border-b border-white/20 flex justify-between items-center bg-white/20">
                      <h3 className="font-display font-bold text-sm">Histórico Recente de Ponto</h3>
                      <Calendar className="w-4 h-4 text-slate-400" />
                    </div>
                    <div className="flex-1 overflow-y-auto max-h-[350px] custom-scrollbar">
                      <table className="w-full text-left text-xs">
                        <thead>
                          <tr className="text-slate-400 border-b border-white/10">
                            <th className="p-4 uppercase text-[9px] font-bold">Colaborador</th>
                            <th className="p-4 uppercase text-[9px] font-bold">Registro</th>
                            <th className="p-4 uppercase text-[9px] font-bold">Horário</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-white/10">
                          {records.slice(0, 15).map((record) => (
                            <tr key={record.id} className="hover:bg-white/10 transition-colors">
                              <td className="p-4 font-bold text-slate-700">{record.userName}</td>
                              <td className="p-4">
                                <span className={cn(
                                  "px-2 py-0.5 rounded-lg text-[9px] font-bold uppercase",
                                  record.type === 'in' ? "bg-emerald-150 text-emerald-800" : "bg-amber-100 text-amber-800"
                                )}>
                                  {getRecordPontoLabel(record)} ({record.type === 'in' ? 'Entrada' : 'Saída'})
                                </span>
                              </td>
                              <td className="p-4 text-slate-600">{formatDateTime(record.timestamp)}</td>
                            </tr>
                          ))}
                          {records.length === 0 && (
                            <tr>
                              <td colSpan={3} className="text-center p-8 text-slate-400 italic">Nenhum ponto registrado recentemente.</td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Vacation Requests list */}
                  <div className="glass-card flex flex-col overflow-hidden">
                    <div className="p-4 border-b border-white/20 flex justify-between items-center bg-white/20">
                      <h3 className="font-display font-bold text-sm">Solicitações de Férias</h3>
                      <Palmtree className="w-4 h-4 text-amber-500" />
                    </div>
                    <div className="flex-1 overflow-y-auto p-4 space-y-3 max-h-[350px] custom-scrollbar">
                      {vacations.map((v) => (
                        <div key={v.id} className="p-4 bg-white/40 rounded-2xl border border-white/60 flex flex-col gap-3">
                          <div className="flex justify-between items-start">
                            <div className="flex items-center gap-3">
                              <div className="w-8 h-8 rounded-full bg-amber-100 flex items-center justify-center text-amber-600 font-bold text-xs uppercase">
                                {v.userName?.[0] || 'U'}
                              </div>
                              <div>
                                <div className="text-xs font-bold text-slate-700">{v.userName}</div>
                                <div className="text-[10px] text-slate-400 font-medium flex items-center gap-2">
                                  <span>{formatDateTime(v.createdAt)}</span>
                                  {v.daysRequested && (
                                    <span className="px-1.5 py-0.5 bg-slate-50 text-slate-700 rounded font-semibold text-[9px]">
                                      {v.daysRequested} dias
                                    </span>
                                  )}
                                </div>
                              </div>
                            </div>
                            <span className={cn(
                              "px-2.5 py-1 rounded-full text-[9px] font-bold uppercase tracking-wider",
                              v.status === 'approved' ? 'bg-emerald-100 text-emerald-700' :
                              v.status === 'rejected' ? 'bg-rose-100 text-rose-700' :
                              'bg-amber-100 text-amber-700'
                            )}>
                              {statusTranslation[v.status] || v.status}
                            </span>
                          </div>
                          
                          <div className="flex items-center gap-3 text-xs text-slate-600 bg-white/50 p-2.5 rounded-xl border border-white/40">
                            <div className="flex flex-col">
                              <span className="text-[8px] uppercase font-bold text-slate-400">Início</span>
                              <span className="font-bold">{formatDate(v.startDate)}</span>
                            </div>
                            <ArrowRight className="w-3 h-3 text-slate-300" />
                            <div className="flex flex-col">
                              <span className="text-[8px] uppercase font-bold text-slate-400">Término</span>
                              <span className="font-bold">{formatDate(v.endDate)}</span>
                            </div>
                          </div>

                          {v.reason && <p className="text-[10px] text-slate-500 italic">{v.reason}</p>}

                          {isManagement && isPendingVacation(v.status) && v.userId === user?.uid && (
                            <p className="text-[10px] text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-2 py-1.5">
                              Seu próprio pedido precisa ser aprovado por outro gestor (RH ou Administrador).
                            </p>
                          )}
                          {isManagement && isPendingVacation(v.status) && v.userId !== user?.uid && (
                            <div className="flex gap-2 pt-2 border-t border-white/20 mt-1">
                              <button 
                                onClick={() => runExclusive(`HR.vacation.${v.id}`, async () => {
                                  try {
                                    await updateDoc(doc(db, 'vacations', v.id), { status: 'approved' });
                                    await logAudit({
                                      userId: user?.uid || 'unknown',
                                      userName: user?.displayName || user?.email || 'RH',
                                      action: 'approved',
                                      collection: 'vacations',
                                      recordId: v.id,
                                      recordName: v.userName,
                                      details: `Férias de ${v.userName} de ${v.startDate} a ${v.endDate} aprovadas.`
                                    }).catch(err => console.warn('Audit log:', err));
                                    toast.success('Férias aprovadas!');
                                  } catch (err) {
                                    console.error(err);
                                    toast.error('Não foi possível aprovar as férias. Tente novamente.');
                                  }
                                })}
                                className="flex-1 py-1.5 bg-emerald-50 text-emerald-600 rounded-lg text-[10px] font-bold hover:bg-emerald-100 transition-colors flex items-center justify-center gap-1"
                              >
                                <Check className="w-3 h-3" /> Aprovar
                              </button>
                              <button 
                                onClick={() => runExclusive(`HR.vacation.${v.id}`, async () => {
                                  try {
                                    await updateDoc(doc(db, 'vacations', v.id), { status: 'rejected' });
                                    await logAudit({
                                      userId: user?.uid || 'unknown',
                                      userName: user?.displayName || user?.email || 'RH',
                                      action: 'rejected',
                                      collection: 'vacations',
                                      recordId: v.id,
                                      recordName: v.userName,
                                      details: `Férias de ${v.userName} de ${v.startDate} a ${v.endDate} rejeitadas.`
                                    }).catch(err => console.warn('Audit log:', err));
                                    toast.success('Férias rejeitadas!');
                                  } catch (err) {
                                    console.error(err);
                                    toast.error('Não foi possível rejeitar as férias. Tente novamente.');
                                  }
                                })}
                                className="flex-1 py-1.5 bg-rose-50 text-rose-600 rounded-lg text-[10px] font-bold hover:bg-rose-100 transition-all flex items-center justify-center gap-1"
                              >
                                <X className="w-3 h-3" /> Rejeitar
                              </button>
                            </div>
                          )}
                        </div>
                      ))}
                      {vacations.length === 0 && (
                        <div className="text-center py-12 text-slate-400">
                          <Palmtree className="w-8 h-8 mx-auto mb-2 opacity-20" />
                          <p className="text-[10px] font-medium uppercase font-display italic">Nenhum pedido de férias encontrado</p>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Team Sidebar - Visible ONLY to HR and Admin */}
              {isHROrAdmin && (
                <div className="w-full lg:w-80 glass-card p-5 flex flex-col gap-6">
                  <h3 className="font-display font-bold text-slate-800">Minha Equipe</h3>
                  <div className="flex-1 space-y-4 overflow-y-auto max-h-[400px] lg:max-h-none pr-2 custom-scrollbar">
                    {team.map((member) => (
                      <div key={member.uid} className="flex items-center justify-between p-2 rounded-2xl hover:bg-white/40 transition-all">
                        <div className="flex items-center gap-3">
                          <div className="relative">
                            {member.photoURL ? (
                              <img src={member.photoURL} alt="" className="w-10 h-10 rounded-full border-2 border-white shadow-sm" />
                            ) : (
                              <div className="w-10 h-10 rounded-full bg-slate-200 border-2 border-white flex items-center justify-center font-bold text-slate-500">
                                {member.displayName ? member.displayName[0].toUpperCase() : 'U'}
                              </div>
                            )}
                            <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-emerald-500 border-2 border-white rounded-full"></div>
                          </div>
                          <div className="flex flex-col">
                            <span className="text-sm font-bold text-slate-700">{member.displayName}</span>
                            <div className="flex items-center gap-1">
                              <span className="text-[10px] text-slate-400">{ROLE_LABELS[member.role as UserRole] || member.role}</span>
                              {isVacationOverdue(member.createdAt, 0) && (
                                <span className="px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wider bg-rose-100 text-rose-800 rounded animate-pulse">
                                  Férias Vencidas
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                  
                  <div className="p-4 bg-emerald-600 rounded-2xl text-white">
                    <h4 className="text-sm font-bold mb-1">Informativo Agro-RH</h4>
                    <p className="text-[10px] opacity-90">Colaboradores de campo devem registrar o ponto obrigatoriamente antes do deslocamento para as glebas.</p>
                  </div>
                </div>
              )}
            </motion.div>
          )}

          {/* 2. CADASTRO DE FUNCIONÁRIOS TAB */}
          {activeTab === 'funcionarios' && isManagement && (
            <motion.div 
              key="funcionarios"
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -15 }}
              className="bg-white/40 glass p-6 rounded-[2rem] border border-white/40 flex flex-col gap-6 h-full"
            >
              <div className="flex justify-between items-center">
                <div>
                  <h3 className="text-lg font-display font-bold text-slate-800">Diretório de Funcionários</h3>
                  <p className="text-xs text-slate-500">Cadastro detalhado, cargos, salários e informações bancárias.</p>
                </div>
                <button 
                  onClick={handleOpenNewEmployee}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition-all flex items-center gap-2 cursor-pointer"
                >
                  <UserPlus className="w-4 h-4" /> Cadastrar Funcionário
                </button>
              </div>

              <div className="overflow-x-auto custom-scrollbar">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="text-slate-400 border-b border-white/10 uppercase text-[9px] font-bold">
                      <th className="p-4">Colaborador / Contato</th>
                      <th className="p-4">Matrícula</th>
                      <th className="p-4">Setor / Cargo</th>
                      <th className="p-4">Salário Base</th>
                      <th className="p-4">Admissão</th>
                      <th className="p-4">Status</th>
                      <th className="p-4 text-right">Ações</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/10">
                    {teamView.map((emp: any) => (
                      <tr key={emp.uid} className="hover:bg-white/20 transition-colors">
                        <td className="p-4">
                          <div className="font-bold text-slate-800">{emp.displayName}</div>
                          <div className="text-[10px] text-slate-400">{emp.email} • {emp.phone || 'Sem fone'}</div>
                        </td>
                        <td className="p-4 font-mono font-bold text-slate-600">
                          {emp.registrationNumber || '---'}
                        </td>
                        <td className="p-4">
                          <span className="font-semibold text-slate-700">{ROLE_LABELS[emp.role as UserRole] || emp.role}</span>
                          <div className="text-[10px] text-slate-400">{emp.department || 'Operações'}</div>
                        </td>
                        <td className="p-4 font-bold text-slate-700">
                          {emp.salary ? `R$ ${parseFloat(emp.salary).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` : 'Não informado'}
                        </td>
                        <td className="p-4 text-slate-600">
                          {emp.admissionDate ? formatDate(emp.admissionDate) : '---'}
                        </td>
                        <td className="p-4">
                          <span className={cn(
                            "px-2 py-0.5 rounded-full text-[9px] font-bold uppercase",
                            emp.status === 'Ativo' ? "bg-emerald-100 text-emerald-800" :
                            emp.status === 'Férias' ? "bg-amber-100 text-amber-800" :
                            "bg-slate-100 text-slate-800"
                          )}>
                            {emp.status || 'Ativo'}
                          </span>
                        </td>
                        <td className="p-4 text-right">
                          <button 
                            onClick={() => handleOpenEditEmployee(emp)}
                            className="px-2.5 py-1.5 bg-white border border-slate-200 hover:border-slate-200 text-slate-600 hover:text-slate-600 rounded-lg text-[10px] font-bold transition-all cursor-pointer"
                          >
                            Editar
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </motion.div>
          )}

          {/* 3. LICENÇAS & AFASTAMENTOS TAB */}
          {activeTab === 'licencas' && (
            <motion.div 
              key="licencas"
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -15 }}
              className="bg-white/40 glass p-6 rounded-[2rem] border border-white/40 flex flex-col gap-6 h-full"
            >
              <div className="flex justify-between items-center">
                <div>
                  <h3 className="text-lg font-display font-bold text-slate-800">Solicitação de Licenças</h3>
                  <p className="text-xs text-slate-500">Afastamentos legais, licença médica, gala, nojo ou capacitação.</p>
                </div>
                <button 
                  onClick={() => setIsLeaveModalOpen(true)}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition-all flex items-center gap-2 cursor-pointer"
                >
                  <Plus className="w-4 h-4" /> Solicitar Licença
                </button>
              </div>

              <div className="overflow-x-auto custom-scrollbar">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="text-slate-400 border-b border-white/10 uppercase text-[9px] font-bold">
                      <th className="p-4">Colaborador</th>
                      <th className="p-4">Tipo de Licença</th>
                      <th className="p-4">Período</th>
                      <th className="p-4">Motivo / Justificativa</th>
                      <th className="p-4">Status</th>
                      {isManagement && <th className="p-4 text-right">Ações</th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/10">
                    {leaves.map((l: any) => (
                      <tr key={l.id} className="hover:bg-white/20 transition-colors">
                        <td className="p-4 font-bold text-slate-800">{l.userName || 'Desconhecido'}</td>
                        <td className="p-4 capitalize font-semibold text-slate-600">{l.type}</td>
                        <td className="p-4">
                          <div className="flex items-center gap-1 text-slate-700 font-medium">
                            <span>{formatDate(l.startDate)}</span>
                            <ArrowRight className="w-3 h-3 text-slate-300" />
                            <span>{formatDate(l.endDate)}</span>
                          </div>
                        </td>
                        <td className="p-4 text-slate-500 max-w-xs truncate" title={l.reason}>
                          {l.reason || 'Sem justificativa'}
                        </td>
                        <td className="p-4">
                          <span className={cn(
                            "px-2 py-0.5 rounded-full text-[9px] font-bold uppercase",
                            l.status === 'approved' ? "bg-emerald-100 text-emerald-800" :
                            l.status === 'rejected' ? "bg-rose-100 text-rose-800" :
                            "bg-amber-100 text-amber-800"
                          )}>
                            {statusTranslation[l.status] || l.status}
                          </span>
                        </td>
                        {isManagement && (
                          <td className="p-4 text-right">
                            {l.status === 'pending' && l.userId === user?.uid ? (
                              <span className="text-[9px] font-bold text-amber-700">Aguardando outro gestor</span>
                            ) : l.status === 'pending' ? (
                              <div className="flex gap-1.5 justify-end">
                                <button 
                                  onClick={() => handleLeaveStatusChange(l.id, l.userName, l.type, 'approved')}
                                  className="p-1 text-emerald-600 hover:bg-emerald-50 rounded"
                                  title="Aprovar"
                                >
                                  <Check className="w-4 h-4" />
                                </button>
                                <button 
                                  onClick={() => handleLeaveStatusChange(l.id, l.userName, l.type, 'rejected')}
                                  className="p-1 text-rose-600 hover:bg-rose-50 rounded"
                                  title="Rejeitar"
                                >
                                  <X className="w-4 h-4" />
                                </button>
                              </div>
                            ) : (
                              <span className="text-[10px] text-slate-400 font-bold uppercase">Decidido</span>
                            )}
                          </td>
                        )}
                      </tr>
                    ))}
                    {leaves.length === 0 && (
                      <tr>
                        <td colSpan={6} className="text-center p-8 text-slate-400 italic">Nenhuma solicitação de licença registrada.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </motion.div>
          )}

          {/* 4. FOLHA DE PAGAMENTO TAB */}
          {activeTab === 'folha' && (
            <motion.div 
              key="folha"
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -15 }}
              className="bg-white/40 glass p-6 rounded-[2rem] border border-white/40 flex flex-col gap-6 h-full"
            >
              <div className="flex justify-between items-center">
                <div>
                  <h3 className="text-lg font-display font-bold text-slate-800">Demonstrativos de Pagamento</h3>
                  <p className="text-xs text-slate-500">Folha de pagamento, horas extras calculadas e tributos.</p>
                </div>
                {isManagement && (
                  <button 
                    onClick={handleOpenNewPayroll}
                    className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition-all flex items-center gap-2 cursor-pointer"
                  >
                    <FileSpreadsheet className="w-4 h-4" /> Gerar Holerite
                  </button>
                )}
              </div>

              <div className="overflow-x-auto custom-scrollbar">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="text-slate-400 border-b border-white/10 uppercase text-[9px] font-bold">
                      <th className="p-4">Colaborador</th>
                      <th className="p-4">Competência</th>
                      <th className="p-4">Salário Base</th>
                      <th className="p-4">Horas Extras (R$)</th>
                      <th className="p-4">Deduções / Descontos</th>
                      <th className="p-4 font-bold text-slate-800">Líquido a Receber</th>
                      <th className="p-4">Status</th>
                      {isManagement && <th className="p-4 text-right">Ações</th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/10">
                    {payrolls.map((p: any) => (
                      <tr key={p.id} className="hover:bg-white/20 transition-colors">
                        <td className="p-4 font-bold text-slate-800">{p.employeeName}</td>
                        <td className="p-4 font-semibold text-slate-500">{p.month}</td>
                        <td className="p-4">R$ {p.baseSalary?.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
                        <td className="p-4 text-emerald-600">+R$ {p.extraHoursVal?.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
                        <td className="p-4 text-rose-600">-R$ {p.deductions?.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
                        <td className="p-4 font-black text-slate-700">R$ {p.netSalary?.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
                        <td className="p-4">
                          <span className={cn(
                            "px-2 py-0.5 rounded-full text-[9px] font-bold uppercase",
                            p.status === 'paid' ? "bg-emerald-100 text-emerald-800" :
                            p.status === 'approved' ? "bg-slate-100 text-slate-800" :
                            "bg-amber-100 text-amber-800"
                          )}>
                            {p.status === 'paid' ? 'Pago' : p.status === 'approved' ? 'Aprovado' : 'Aguardando'}
                          </span>
                        </td>
                        {isManagement && (
                          <td className="p-4 text-right">
                            {p.status === 'pending' && (
                              <button 
                                onClick={() => runExclusive('HR.handlePayrollStatusChange', () => handlePayrollStatusChange(p.id, p.employeeName, p.month, p.netSalary, 'approved'))}
                                className="px-2 py-1 bg-slate-50 text-slate-600 hover:bg-slate-100 text-[10px] font-bold rounded"
                              >
                                Aprovar
                              </button>
                            )}
                            {p.status === 'approved' && (
                              <button 
                                onClick={() => runExclusive('HR.handlePayrollStatusChange', () => handlePayrollStatusChange(p.id, p.employeeName, p.month, p.netSalary, 'paid'))}
                                className="px-2 py-1 bg-emerald-50 text-emerald-600 hover:bg-emerald-100 text-[10px] font-bold rounded"
                              >
                                Pagar
                              </button>
                            )}
                          </td>
                        )}
                      </tr>
                    ))}
                    {payrolls.length === 0 && (
                      <tr>
                        <td colSpan={8} className="text-center p-8 text-slate-400 italic">Nenhum demonstrativo gerado ou disponível.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </motion.div>
          )}

          {/* 5. AUDITORIA & LOGS TAB */}
          {activeTab === 'logs' && isManagement && (
            <motion.div 
              key="logs"
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -15 }}
              className="bg-white/40 glass p-6 rounded-[2rem] border border-white/40 flex flex-col gap-6 h-full"
            >
              <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                  <h3 className="text-lg font-display font-bold text-slate-800">Trilhas de Auditoria Agro-RH</h3>
                  <p className="text-xs text-slate-500">Controles forenses, batidas de ponto, contratos e movimentações de RH.</p>
                </div>
                
                {/* Logs Category Filter buttons */}
                <div className="flex gap-1.5 bg-slate-100 p-1 rounded-xl">
                  <button 
                    onClick={() => setLogTypeFilter('all')}
                    className={cn("px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer", logTypeFilter === 'all' ? "bg-white text-emerald-700" : "text-slate-600")}
                  >
                    Todos
                  </button>
                  <button 
                    onClick={() => setLogTypeFilter('admin')}
                    className={cn("px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer", logTypeFilter === 'admin' ? "bg-white text-emerald-700" : "text-slate-600")}
                  >
                    Adm / Usuários
                  </button>
                  <button 
                    onClick={() => setLogTypeFilter('employee')}
                    className={cn("px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer", logTypeFilter === 'employee' ? "bg-white text-emerald-700" : "text-slate-600")}
                  >
                    Atividades
                  </button>
                  <button 
                    onClick={() => setLogTypeFilter('hr')}
                    className={cn("px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer", logTypeFilter === 'hr' ? "bg-white text-emerald-700" : "text-slate-600")}
                  >
                    Auditoria RH
                  </button>
                </div>
              </div>

              <div className="overflow-y-auto max-h-[500px] custom-scrollbar">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="text-slate-400 border-b border-white/10 uppercase text-[9px] font-bold">
                      <th className="p-4">Data / Hora</th>
                      <th className="p-4">Categoria</th>
                      <th className="p-4">Responsável</th>
                      <th className="p-4">Evento / Detalhe</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/10">
                    {filteredHrLogs.map((log: any) => (
                      <tr key={log.id} className="hover:bg-white/20 transition-colors">
                        <td className="p-4 whitespace-nowrap text-slate-600">
                          {log.timestamp ? new Date(log.timestamp).toLocaleString('pt-BR') : '---'}
                        </td>
                        <td className="p-4">
                          <span className={cn(
                            "px-2 py-0.5 rounded text-[8px] font-bold uppercase",
                            log.collection === 'attendance' ? "bg-slate-50 text-slate-700 border border-slate-100" :
                            log.collection === 'vacations' ? "bg-amber-50 text-amber-700 border border-amber-100" :
                            log.collection === 'leaves' ? "bg-slate-50 text-slate-700 border border-slate-100" :
                            log.collection === 'payrolls' ? "bg-slate-50 text-slate-700 border border-slate-100" :
                            log.collection === 'users' ? "bg-slate-50 text-slate-700 border border-slate-100" :
                            "bg-slate-50 text-slate-750 border border-slate-100"
                          )}>
                            {log.collection}
                          </span>
                        </td>
                        <td className="p-4 font-bold text-slate-700">{log.userName || 'Sistema'}</td>
                        <td className="p-4 text-slate-600 leading-relaxed font-medium">{log.details}</td>
                      </tr>
                    ))}
                    {filteredHrLogs.length === 0 && (
                      <tr>
                        <td colSpan={4} className="text-center p-8 text-slate-400 italic">Nenhum log de auditoria encontrado na categoria selecionada.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* ─── MODALS SECTION ─── */}
      <AnimatePresence>
        {/* Vacation Request Modal */}
        {isVacationModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-slate-900/40 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="relative glass-card w-full max-w-md p-8 shadow-2xl"
            >
              <div className="flex justify-between items-center mb-6">
                <div>
                  <h3 className="text-xl font-display font-bold">Solicitar Férias</h3>
                  <p className="text-xs text-slate-400 mt-1">Sua solicitação será enviada para o RH.</p>
                </div>
                <button onClick={() => setIsVacationModalOpen(false)} className="p-2 hover:bg-slate-100 rounded-full transition-colors">
                  <X className="w-5 h-5 text-slate-400" />
                </button>
              </div>

              <form className="space-y-4" onSubmit={(e) => {
                e.preventDefault();
                runExclusive('HR.vacationRequest', async () => {
                if (!isVacationValid) {
                  toast.error('A solicitação de férias deve ser de no mínimo 5 e no máximo 30 dias.');
                  return;
                }
                try {
                  const vacRef = await addDoc(collection(db, 'vacations'), {
                    userId: user?.uid,
                    userName: user?.displayName,
                    ...newVacation,
                    daysRequested: daysCount,
                    admissionDate: user?.createdAt || '',
                    status: 'pending',
                    createdAt: new Date().toISOString()
                  });

                  // Log Employee vacation request
                  await logAudit({
                    userId: user?.uid || 'unknown',
                    userName: user?.displayName || user?.email || 'Usuário',
                    action: 'created',
                    collection: 'vacations',
                    recordId: vacRef.id,
                    recordName: user?.displayName || 'Usuário',
                    details: `Pedido de férias enviado: de ${newVacation.startDate} a ${newVacation.endDate} (${daysCount} dias).`
                  });

                  setIsVacationModalOpen(false);
                  setNewVacation({ startDate: '', endDate: '', reason: '' });
                  toast.success('Solicitação de férias enviada!');
                } catch (error) {
                  handleFirestoreError(error, OperationType.CREATE, 'vacations');
                }
                });
              }}>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-slate-500 uppercase ml-1">Data Início</label>
                    <input 
                      required
                      type="date"
                      value={newVacation.startDate}
                      onChange={(e) => setNewVacation({...newVacation, startDate: e.target.value})}
                      className="w-full glass-input" 
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-slate-500 uppercase ml-1">Data Término</label>
                    <input 
                      required
                      type="date"
                      value={newVacation.endDate}
                      onChange={(e) => setNewVacation({...newVacation, endDate: e.target.value})}
                      className="w-full glass-input" 
                    />
                  </div>
                </div>

                {newVacation.startDate && newVacation.endDate && (
                  <div className={cn(
                    "p-3 rounded-xl border text-xs font-semibold flex justify-between items-center transition-all",
                    isVacationValid 
                      ? "bg-emerald-50 border-emerald-100 text-emerald-700" 
                      : "bg-rose-50 border-rose-100 text-rose-700"
                  )}>
                    <span>Duração: {daysCount} {daysCount === 1 ? 'dia' : 'dias'}</span>
                    {!isVacationValid && (
                      <span className="text-[10px] font-semibold">Mínimo 5 dias, máximo 30 dias</span>
                    )}
                  </div>
                )}

                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-slate-500 uppercase ml-1">Motivo (Opcional)</label>
                  <textarea 
                    value={newVacation.reason}
                    onChange={(e) => setNewVacation({...newVacation, reason: e.target.value})}
                    className="w-full glass-input min-h-[100px] py-3 text-xs" 
                    placeholder="Observações do seu pedido."
                  />
                </div>
                <div className="flex gap-3 pt-4">
                  <button type="button" onClick={() => setIsVacationModalOpen(false)} className="flex-1 py-3 border border-slate-200 rounded-xl text-sm font-bold text-slate-500 hover:bg-slate-50 transition-all">Cancelar</button>
                  <button 
                    type="submit" 
                    disabled={!isVacationValid}
                    className={cn(
                      "flex-1 py-3 text-white rounded-xl text-sm font-bold transition-all shadow-lg",
                      isVacationValid 
                        ? "bg-emerald-600 hover:bg-emerald-700 shadow-emerald-200 cursor-pointer" 
                        : "bg-slate-300 shadow-none cursor-not-allowed opacity-60"
                    )}
                  >
                    Enviar Solicitação
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}

        {/* Leave Request Modal */}
        {isLeaveModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-slate-900/40 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="relative glass-card w-full max-w-md p-8 shadow-2xl"
            >
              <div className="flex justify-between items-center mb-6">
                <div>
                  <h3 className="text-xl font-display font-bold">Solicitar Licença / Afastamento</h3>
                  <p className="text-xs text-slate-400 mt-1">Insira o período e tipo de licença agro-legal.</p>
                </div>
                <button onClick={() => setIsLeaveModalOpen(false)} className="p-2 hover:bg-slate-100 rounded-full transition-colors">
                  <X className="w-5 h-5 text-slate-400" />
                </button>
              </div>

              <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); runExclusive('HR.handleRequestLeave', () => handleRequestLeave(e)); }}>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-slate-500 uppercase ml-1">Tipo de Licença</label>
                  <select 
                    value={newLeave.type}
                    onChange={(e) => setNewLeave({...newLeave, type: e.target.value})}
                    className="w-full glass-input bg-white"
                  >
                    <option value="médica">Médica (Atestado)</option>
                    <option value="maternidade">Maternidade / Paternidade</option>
                    <option value="estudos">Estudos / Treinamento</option>
                    <option value="casamento">Gala (Casamento)</option>
                    <option value="luto">Nojo (Luto de parente)</option>
                    <option value="outro">Outros motivos</option>
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-slate-500 uppercase ml-1">Data Início</label>
                    <input 
                      required
                      type="date"
                      value={newLeave.startDate}
                      onChange={(e) => setNewLeave({...newLeave, startDate: e.target.value})}
                      className="w-full glass-input" 
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-slate-500 uppercase ml-1">Data Término</label>
                    <input 
                      required
                      type="date"
                      value={newLeave.endDate}
                      onChange={(e) => setNewLeave({...newLeave, endDate: e.target.value})}
                      className="w-full glass-input" 
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-slate-500 uppercase ml-1">Justificativa / Motivo</label>
                  <textarea 
                    required
                    value={newLeave.reason}
                    onChange={(e) => setNewLeave({...newLeave, reason: e.target.value})}
                    className="w-full glass-input min-h-[100px] py-3 text-xs" 
                    placeholder="Justifique o motivo detalhadamente para análise do RH."
                  />
                </div>
                
                <div className="flex gap-3 pt-4">
                  <button type="button" onClick={() => setIsLeaveModalOpen(false)} className="flex-1 py-3 border border-slate-200 rounded-xl text-sm font-bold text-slate-500 hover:bg-slate-50 transition-all">Cancelar</button>
                  <button type="submit" className="flex-1 py-3 text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl text-sm font-bold transition-all shadow-lg shadow-emerald-200">
                    Enviar Solicitação
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}

        {/* Employee Modal (Add or Edit) */}
        {isEmployeeModalOpen && isManagement && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-slate-900/40 backdrop-blur-sm overflow-y-auto">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="relative glass-card w-full max-w-2xl p-8 shadow-2xl my-8"
            >
              <div className="flex justify-between items-center mb-6">
                <div>
                  <h3 className="text-xl font-display font-bold">
                    {editingEmployee ? 'Editar Ficha do Colaborador' : 'Cadastrar Novo Colaborador'}
                  </h3>
                  <p className="text-xs text-slate-400 mt-1">Insira as informações profissionais, salário e dados bancários.</p>
                </div>
                <button onClick={() => setIsEmployeeModalOpen(false)} className="p-2 hover:bg-slate-100 rounded-full transition-colors">
                  <X className="w-5 h-5 text-slate-400" />
                </button>
              </div>

              <form className="space-y-5" onSubmit={(e) => { e.preventDefault(); runExclusive('HR.handleSaveEmployeeSubmit', () => handleSaveEmployeeSubmit(e)); }}>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-slate-500 uppercase ml-1">Nome Completo</label>
                    <input 
                      required
                      type="text"
                      value={employeeForm.displayName}
                      onChange={(e) => setEmployeeForm({...employeeForm, displayName: e.target.value})}
                      className="w-full glass-input" 
                      placeholder="Ex: João da Silva"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-slate-500 uppercase ml-1">Email Corporativo</label>
                    <input 
                      required
                      type="email"
                      disabled={editingEmployee !== null}
                      value={employeeForm.email}
                      onChange={(e) => setEmployeeForm({...employeeForm, email: e.target.value})}
                      className="w-full glass-input bg-slate-50 disabled:opacity-60" 
                      placeholder="Ex: joao@agro.com"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-slate-500 uppercase ml-1">Cargo</label>
                    {/* Mesma regra da tela Usuários (canCreateRole): RH só atribui Consultor ou RH;
                        cargos de Gerente/Administrador só o Administrador define. */}
                    <select
                      value={employeeForm.role}
                      onChange={(e) => setEmployeeForm({...employeeForm, role: e.target.value})}
                      disabled={!canCreateRole(activeRole, employeeForm.role as UserRole)}
                      className="w-full glass-input bg-white disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                      {employeeForm.role === 'staff' && <option value="staff">Colaborador / Campo (Staff)</option>}
                      {([
                        ['consultant', 'Consultor Técnico'],
                        ['hr', 'Analista de RH'],
                        ['manager', 'Gerente Agro'],
                        ['admin', 'Administrador Geral'],
                      ] as [UserRole, string][])
                        .filter(([value]) => canCreateRole(activeRole, value) || value === employeeForm.role)
                        .map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-slate-500 uppercase ml-1">Setor / Departamento</label>
                    <select 
                      value={employeeForm.department}
                      onChange={(e) => setEmployeeForm({...employeeForm, department: e.target.value})}
                      className="w-full glass-input bg-white"
                    >
                      <option value="Campo">Campo / Agricultura</option>
                      <option value="Técnico">Técnico / Agronomia</option>
                      <option value="Administrativo">Administrativo</option>
                      <option value="Financeiro">Financeiro</option>
                      <option value="Operações">Operações Logísticas</option>
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-slate-500 uppercase ml-1">CPF</label>
                    <input 
                      required
                      type="text"
                      value={employeeForm.cpf}
                      onChange={(e) => setEmployeeForm({...employeeForm, cpf: e.target.value})}
                      className="w-full glass-input" 
                      placeholder="000.000.000-00"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-slate-500 uppercase ml-1">Telefone</label>
                    <input 
                      type="text"
                      value={employeeForm.phone}
                      onChange={(e) => setEmployeeForm({...employeeForm, phone: e.target.value})}
                      className="w-full glass-input" 
                      placeholder="(00) 00000-0000"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-slate-500 uppercase ml-1">Salário Base (R$)</label>
                    <input 
                      required
                      type="number"
                      step="0.01"
                      value={employeeForm.salary}
                      onChange={(e) => setEmployeeForm({...employeeForm, salary: e.target.value})}
                      className="w-full glass-input" 
                      placeholder="Ex: 3500.00"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-slate-500 uppercase ml-1">Data de Admissão</label>
                    <input 
                      required
                      type="date"
                      value={employeeForm.admissionDate}
                      onChange={(e) => setEmployeeForm({...employeeForm, admissionDate: e.target.value})}
                      className="w-full glass-input" 
                    />
                  </div>
                </div>

                {/* Bank account section */}
                <div className="border-t border-slate-100 pt-4">
                  <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider mb-3 flex items-center gap-1">
                    <Landmark className="w-4 h-4 text-emerald-600" /> Informações para Pagamento
                  </h4>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-bold text-slate-500 uppercase ml-1">Banco</label>
                      <input 
                        type="text"
                        value={employeeForm.bankName}
                        onChange={(e) => setEmployeeForm({...employeeForm, bankName: e.target.value})}
                        className="w-full glass-input" 
                        placeholder="Ex: Banco do Brasil"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-bold text-slate-500 uppercase ml-1">Agência</label>
                      <input 
                        type="text"
                        value={employeeForm.bankAgency}
                        onChange={(e) => setEmployeeForm({...employeeForm, bankAgency: e.target.value})}
                        className="w-full glass-input" 
                        placeholder="Ex: 1234-5"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-bold text-slate-500 uppercase ml-1">Conta Corrente</label>
                      <input 
                        type="text"
                        value={employeeForm.bankAccount}
                        onChange={(e) => setEmployeeForm({...employeeForm, bankAccount: e.target.value})}
                        className="w-full glass-input" 
                        placeholder="Ex: 98765-4"
                      />
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 border-t border-slate-100 pt-4">
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-slate-500 uppercase ml-1">Horas Diárias</label>
                    <input 
                      type="number"
                      value={employeeForm.hoursPerDay}
                      onChange={(e) => setEmployeeForm({...employeeForm, hoursPerDay: e.target.value})}
                      className="w-full glass-input" 
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-slate-500 uppercase ml-1">Status de Ocupação</label>
                    <select 
                      value={employeeForm.status}
                      onChange={(e) => setEmployeeForm({...employeeForm, status: e.target.value})}
                      className="w-full glass-input bg-white"
                    >
                      <option value="Ativo">Ativo</option>
                      <option value="Férias">Em Férias</option>
                      <option value="Licença">Em Licença</option>
                      <option value="Desligado">Desligado / Inativo</option>
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-slate-500 uppercase ml-1">Matrícula (Gerada)</label>
                    <input 
                      type="text"
                      disabled
                      value={employeeForm.registrationNumber}
                      className="w-full glass-input bg-slate-50 font-mono font-bold" 
                    />
                  </div>
                </div>

                <div className="flex gap-3 pt-4 border-t border-slate-100">
                  <button type="button" onClick={() => setIsEmployeeModalOpen(false)} className="flex-1 py-3 border border-slate-200 rounded-xl text-sm font-bold text-slate-500 hover:bg-slate-50 transition-all">Cancelar</button>
                  <button type="submit" className="flex-1 py-3 text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl text-sm font-bold transition-all shadow-lg shadow-emerald-200">
                    Salvar Colaborador
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}

        {/* Generate Payroll Modal */}
        {isPayrollModalOpen && isManagement && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-slate-900/40 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="relative glass-card w-full max-w-md p-8 shadow-2xl"
            >
              <div className="flex justify-between items-center mb-6">
                <div>
                  <h3 className="text-xl font-display font-bold">Gerar Demonstrativo de Pagamento</h3>
                  <p className="text-xs text-slate-400 mt-1">Calcule o salário líquido, proventos e descontos.</p>
                </div>
                <button onClick={() => setIsPayrollModalOpen(false)} className="p-2 hover:bg-slate-100 rounded-full transition-colors">
                  <X className="w-5 h-5 text-slate-400" />
                </button>
              </div>

              <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); runExclusive('HR.handleGeneratePayrollSubmit', () => handleGeneratePayrollSubmit(e)); }}>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-slate-500 uppercase ml-1">Colaborador</label>
                  <select 
                    required
                    value={payrollForm.employeeId}
                    onChange={(e) => setPayrollForm({...payrollForm, employeeId: e.target.value})}
                    className="w-full glass-input bg-white"
                  >
                    <option value="">Selecione um funcionário...</option>
                    {team.map(t => (
                      <option key={t.uid} value={t.uid}>{t.displayName}</option>
                    ))}
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-slate-500 uppercase ml-1">Competência</label>
                    <input 
                      required
                      type="month"
                      value={payrollForm.month}
                      onChange={(e) => setPayrollForm({...payrollForm, month: e.target.value})}
                      className="w-full glass-input" 
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-slate-500 uppercase ml-1">Salário Base (R$)</label>
                    <input 
                      required
                      type="number"
                      step="0.01"
                      value={payrollForm.baseSalary}
                      onChange={(e) => setPayrollForm({...payrollForm, baseSalary: e.target.value})}
                      className="w-full glass-input font-bold text-slate-700" 
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-slate-500 uppercase ml-1">Horas Extras (R$)</label>
                    <input 
                      required
                      type="number"
                      step="0.01"
                      value={payrollForm.extraHoursVal}
                      onChange={(e) => setPayrollForm({...payrollForm, extraHoursVal: e.target.value})}
                      className="w-full glass-input" 
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-slate-500 uppercase ml-1">Deduções / IRRF / INSS</label>
                    <input 
                      required
                      type="number"
                      step="0.01"
                      value={payrollForm.deductions}
                      onChange={(e) => setPayrollForm({...payrollForm, deductions: e.target.value})}
                      className="w-full glass-input" 
                    />
                  </div>
                </div>

                {/* Quick preview calculation box */}
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl flex justify-between items-center text-xs">
                  <span className="font-bold text-slate-500 uppercase text-[9px]">Salário Líquido Estimado</span>
                  <span className="font-black text-slate-700 text-sm">
                    R$ {((parseFloat(payrollForm.baseSalary) || 0) + (parseFloat(payrollForm.extraHoursVal) || 0) - (parseFloat(payrollForm.deductions) || 0)).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                  </span>
                </div>

                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-slate-500 uppercase ml-1">Observações (Opcional)</label>
                  <textarea 
                    value={payrollForm.notes}
                    onChange={(e) => setPayrollForm({...payrollForm, notes: e.target.value})}
                    className="w-full glass-input min-h-[70px] py-2 text-xs" 
                    placeholder="Descrição de bônus, vales ou observações."
                  />
                </div>

                <div className="flex gap-3 pt-4">
                  <button type="button" onClick={() => setIsPayrollModalOpen(false)} className="flex-1 py-3 border border-slate-200 rounded-xl text-sm font-bold text-slate-500 hover:bg-slate-50 transition-all">Cancelar</button>
                  <button type="submit" className="flex-1 py-3 text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl text-sm font-bold transition-all shadow-lg">
                    Gerar Folha
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
