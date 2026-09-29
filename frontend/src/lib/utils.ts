import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { auth } from './firebase';
import { toast } from 'sonner';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export async function getAuthToken(): Promise<string> {
  try {
    const currentUser = auth.currentUser;
    if (currentUser) {
      const token = await currentUser.getIdToken();
      if (token) return token;
    }
  } catch (err) {
    console.warn('[getAuthToken] Erro ao obter token do currentUser:', err);
  }

  // SEGURANÇA: sem login real não há token. Antes devolvia "virtual_<uid>" ou
  // "VIRTUAL_USER_BYPASS", que o servidor aceitava como administrador fora do
  // modo produção. Hoje o servidor recusa qualquer token que não seja do Firebase.
  return '';
}

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  }
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData?.map(provider => ({
        providerId: provider.providerId,
        email: provider.email,
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo, null, 2));

  // Antes o erro só ia para o console e o usuário ficava sem saber que a gravação falhou.
  // Leituras em segundo plano (list/get) não mostram aviso para não encher a tela.
  if (operationType !== OperationType.LIST && operationType !== OperationType.GET) {
    const code = (error as any)?.code || '';
    const message =
      code === 'permission-denied' ? 'Você não tem permissão para realizar esta ação.' :
      code === 'unavailable' ? 'Sem conexão com o servidor. Verifique sua internet e tente novamente.' :
      'Não foi possível salvar. Tente novamente em instantes.';
    toast.error(message);
  }

  throw new Error(JSON.stringify(errInfo));
}

export function parseDateInput(date: any): Date | null {
  if (!date) return null;
  let d: Date;
  if (date instanceof Date) {
    d = date;
  } else if (typeof date === 'object' && typeof date.toDate === 'function') {
    d = date.toDate();
  } else if (typeof date === 'string') {
    // Uma string "pura" tipo "2026-09-23" (sem hora) é interpretada pelo
    // Date() nativo como meia-noite UTC. Formatando depois em horário local
    // (Brasil = UTC-3), isso "volta" pro dia anterior (22/09 em vez de 23/09).
    // Ancorando em T00:00:00 (sem timezone), o Date já nasce no horário local,
    // e a exibição bate com a data que foi digitada/salva.
    d = /^\d{4}-\d{2}-\d{2}$/.test(date) ? new Date(date + 'T00:00:00') : new Date(date);
  } else if (typeof date === 'number') {
    d = new Date(date);
  } else {
    return null;
  }
  return isNaN(d.getTime()) ? null : d;
}

// Retorna a data de HOJE como "YYYY-MM-DD" no fuso horário LOCAL do usuário.
// Diferente de `new Date().toISOString().split('T')[0]`, que usa UTC e no
// Brasil (UTC-3) já vira o dia seguinte entre ~21h e a meia-noite local —
// usar isso pra "hoje" faz filtros de "hoje"/"min de data" pularem um dia cedo demais.
export function todayLocalDateString(): string {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function formatDate(date: any) {
  const d = parseDateInput(date);
  if (!d) return '';

  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(d);
}

export function formatTime(date: any) {
  const d = parseDateInput(date);
  if (!d) return '';

  return new Intl.DateTimeFormat('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
}

export function formatDateTime(date: any) {
  const d = parseDateInput(date);
  if (!d) return '';

  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
}

export function generateRegistrationNumber(role: string): string {
  throw new Error('Matrícula deve ser gerada pelo servidor.');
}

export function validateCPF(cpf: string) {
  const cleanCPF = cpf.replace(/\D/g, '');
  if (cleanCPF.length !== 11) return false;
  // CPFs com todos os dígitos iguais (111.111.111-11 etc.) passam no cálculo
  // abaixo mas nunca são válidos de verdade — bloqueados explicitamente.
  if (/^(\d)\1{10}$/.test(cleanCPF)) return false;

  const digits = cleanCPF.split('').map(Number);
  const calcCheckDigit = (base: number[], factorStart: number) => {
    const sum = base.reduce((acc, digit, idx) => acc + digit * (factorStart - idx), 0);
    const remainder = (sum * 10) % 11;
    return remainder === 10 ? 0 : remainder;
  };

  const firstCheck = calcCheckDigit(digits.slice(0, 9), 10);
  if (firstCheck !== digits[9]) return false;

  const secondCheck = calcCheckDigit(digits.slice(0, 10), 11);
  if (secondCheck !== digits[10]) return false;

  return true;
}

export function validateEmail(email: string) {
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return re.test(email);
}

export function formatPhone(value: string) {
  // Telefone é opcional no cadastro: sem ele a ficha do cliente quebrava.
  const numbers = (value || '').replace(/\D/g, '');
  if (numbers.length <= 10) {
    return numbers.replace(/(\d{2})(\d{4})(\d{4})/, '($1) $2-$3').substring(0, 14);
  } else {
    return numbers.replace(/(\d{2})(\d{5})(\d{4})/, '($1) $2-$3').substring(0, 15);
  }
}

/**
 * Links digitados por usuários (tribunal, reunião, mapa...) só podem ser http(s).
 * Bloqueia "javascript:" e "data:", que executariam código ao clicar (XSS).
 */
export function safeUrl(url?: string | null): string | undefined {
  if (!url) return undefined;
  const trimmed = String(url).trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (/^www\./i.test(trimmed)) return `https://${trimmed}`;
  return undefined;
}

/** Converte Timestamp do Firestore, string ISO ou número em milissegundos (0 se inválido). */
export function toMillis(v: any): number {
  if (!v) return 0;
  if (typeof v.toDate === 'function') return v.toDate().getTime();
  if (typeof v.seconds === 'number') return v.seconds * 1000;
  const t = new Date(v).getTime();
  return isNaN(t) ? 0 : t;
}

/**
 * Ordena do mais recente para o mais antigo pelo campo informado.
 * Usado no lugar de where(...) + orderBy(outro campo), que exige índice composto no Firestore.
 */
export function sortByDateDesc<T>(list: T[], field: keyof T | string): T[] {
  return [...list].sort((a: any, b: any) => toMillis(b[field]) - toMillis(a[field]));
}

/** Reduz uma imagem (data URL) para caber em maxSize px, mantendo transparência (PNG). */
export function shrinkImage(dataUrl: string, maxSize: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
      if (scale === 1 && dataUrl.length < 300 * 1024) return resolve(dataUrl);
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext('2d');
      if (!ctx) return reject(new Error('canvas indisponível'));
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = reject;
    img.src = dataUrl;
  });
}

export function formatCPF(value: string) {
  const numbers = (value || '').replace(/\D/g, '').substring(0, 11);
  if (numbers.length <= 3) return numbers;
  if (numbers.length <= 6) return `${numbers.slice(0, 3)}.${numbers.slice(3)}`;
  if (numbers.length <= 9) return `${numbers.slice(0, 3)}.${numbers.slice(3, 6)}.${numbers.slice(6)}`;
  return `${numbers.slice(0, 3)}.${numbers.slice(3, 6)}.${numbers.slice(6, 9)}-${numbers.slice(9, 11)}`;
}

export const getStatusConfig = (status: string) => {
  const s = status?.toLowerCase() || '';
  if (s.includes('concl')) return { color: 'text-emerald-600', bg: 'bg-emerald-50', dot: 'bg-emerald-500', label: 'Concluído' };
  if (s.includes('exec') || s.includes('andamento') || s.includes('análise')) return { color: 'text-slate-600', bg: 'bg-slate-50', dot: 'bg-emerald-500', label: 'Em Processo' };
  if (s.includes('pendent')) return { color: 'text-amber-600', bg: 'bg-amber-50', dot: 'bg-amber-500', label: 'Pendente' };
  if (s.includes('canc') || s.includes('atraso')) return { color: 'text-rose-600', bg: 'bg-rose-50', dot: 'bg-rose-500', label: 'Atenção' };
  return { color: 'text-slate-600', bg: 'bg-slate-50', dot: 'bg-slate-500', label: 'Outros' };
};

export function formatCurrency(value: number | undefined | null): string {
  if (value === undefined || value === null || isNaN(value)) return 'R$ 0,00';
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export function numberToWordsBRL(value: number): string {
  if (isNaN(value) || value === 0) return 'zero reais';
  
  const unidades = ['', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove'];
  const especiais = ['dez', 'onze', 'doze', 'treze', 'quatorze', 'quinze', 'dezesseis', 'dezessete', 'dezoito', 'dezenove'];
  const dezenas = ['', '', 'vinte', 'trinta', 'quarenta', 'cinquenta', 'sessenta', 'setenta', 'oitenta', 'noventa'];
  const centenas = ['', 'cento', 'duzentos', 'trezentos', 'quatrocentos', 'quinhentos', 'seiscentos', 'setecentos', 'oitocentos', 'novecentos'];

  function converterCentena(n: number): string {
    if (n === 0) return '';
    if (n === 100) return 'cem';
    const c = Math.floor(n / 100);
    const d = Math.floor((n % 100) / 10);
    const u = n % 10;
    const partes: string[] = [];

    if (c > 0) partes.push(centenas[c]);
    if (d === 1) {
      partes.push(especiais[u]);
    } else {
      if (d > 1) partes.push(dezenas[d]);
      if (u > 0) partes.push(unidades[u]);
    }
    return partes.join(' e ');
  }

  const inteiro = Math.floor(Math.abs(value));
  const centavos = Math.round((Math.abs(value) - inteiro) * 100);

  if (inteiro === 0 && centavos > 0) {
    return `${centavos} centavo${centavos > 1 ? 's' : ''}`;
  }

  const bilhoes = Math.floor(inteiro / 1_000_000_000);
  const milhoes = Math.floor((inteiro % 1_000_000_000) / 1_000_000);
  const milhares = Math.floor((inteiro % 1_000_000) / 1000);
  const resto = inteiro % 1000;

  const partes: string[] = [];

  if (bilhoes > 0) {
    partes.push(`${converterCentena(bilhoes)} ${bilhoes === 1 ? 'bilhão' : 'bilhões'}`);
  }
  if (milhoes > 0) {
    partes.push(`${converterCentena(milhoes)} ${milhoes === 1 ? 'milhão' : 'milhões'}`);
  }
  if (milhares > 0) {
    partes.push(`${milhares === 1 ? 'mil' : `${converterCentena(milhares)} mil`}`);
  }
  if (resto > 0) {
    partes.push(converterCentena(resto));
  }

  let extenso = partes.join(', ').replace(/, ([^,]*)$/, ' e $1');
  extenso += inteiro === 1 ? ' real' : ' reais';

  if (centavos > 0) {
    extenso += ` e ${centavos} centavo${centavos > 1 ? 's' : ''}`;
  }

  return extenso;
}

export { ensureDocumentFolder, type EnsureDocumentFolderParams } from './firebase';
export { 
  dossierSyncManager, 
  useDossierLiveSync, 
  type SyncStatusInfo, 
  type SyncBadgeState 
} from './dossierSyncObserver';

export {
  ensureServiceDocumentFolder,
  syncJudicialExpertiseDossier,
  syncRuralValuationDossier,
  documentSyncManager,
  useDocumentSync,
  type ServiceSyncInfo,
  type EnsureServiceFolderOptions
} from './documentSync';

/**
 * Converte texto digitado em número aceitando o formato brasileiro:
 * "R$ 1.234,56" → 1234.56 · "15,5" → 15.5 · "15.5" → 15.5 · "" → NaN.
 */
export function parseDecimalBR(value: unknown): number {
  if (typeof value === 'number') return value;
  let s = String(value ?? '').replace(/[^\d,.-]/g, '').trim();
  if (!s) return NaN;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.'); // vírgula decimal: pontos são milhar
  return Number(s);
}
