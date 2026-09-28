import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { 
  onAuthStateChanged, 
  User, 
  signInWithPopup, 
  GoogleAuthProvider, 
  signOut,
  signInWithEmailAndPassword,
  signInWithCustomToken,
  updatePassword
} from 'firebase/auth';
import { doc, getDoc, setDoc, query, collection, where, getDocs, limit, serverTimestamp, updateDoc, onSnapshot } from 'firebase/firestore';
import { auth, db, hasValidConfig } from '../lib/firebase';
import { UserProfile, UserRole } from '../types';
import { generateRegistrationNumber, handleFirestoreError, OperationType } from '../lib/utils';
import { getEffectiveRole, getActiveDelegation } from '../lib/permissions';

interface AuthContextType {
  user: UserProfile | null;
  loading: boolean;
  authError: string | null;
  signIn: () => Promise<void>;
  signInWithCredentials: (id: string, pass: string) => Promise<void>;
  updateUserPassword: (newPass: string) => Promise<void>;
  logout: () => Promise<void>;
  clearAuthError: () => void;
  isVirtualGoogleChooserOpen: boolean;
  setVirtualGoogleChooserOpen: (open: boolean) => void;
  signInWithVirtualGoogle: (email: string, displayName: string, photoURL?: string) => Promise<void>;
  updateUserProfile: (updates: Partial<UserProfile>) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const safeLocalStorageSetItem = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch (e: any) {
    console.warn(`[Local Storage Quota Check] Failed to set item for key: ${key}. Attempting to clean up large files...`, e);
    if (e.name === 'QuotaExceededError' || e.code === 22 || e.number === 0x8007000E) {
      // Clear all items that might contain massive old values to free up space
      try {
        for (let i = localStorage.length - 1; i >= 0; i--) {
          const k = localStorage.key(i);
          if (k && (k.startsWith('saved_profile_') || k.startsWith('virtual_user_session'))) {
            localStorage.removeItem(k);
          }
        }
        // Retry writing the new value (which is now compressed and lightweight)
        localStorage.setItem(key, value);
      } catch (innerErr) {
        console.error('[Local Storage Quota Check] Hard quota failure. Saving state in memory only.', innerErr);
      }
    }
  }
};

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);
  const [isVirtualGoogleChooserOpen, setVirtualGoogleChooserOpen] = useState(false);
  // Token de uso único emitido pelo servidor logo após um login com senha
  // correta. É exigido para trocar a própria senha (ver updateUserPassword),
  // assim ninguém consegue trocar a senha de outra pessoa só sabendo o uid.
  const passwordChangeTokenRef = useRef<string | null>(null);

  // Helper to record authentication attempts on server-side audit logs
  const triggerLoginLog = async (email: string, status: 'success' | 'failure', errorMsg?: string) => {
    try {
      await fetch('/api/login-log', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email,
          status,
          userAgent: navigator.userAgent,
          error: errorMsg || null,
        }),
      });
    } catch (e) {
      console.warn('Erro ao registrar log de auditoria no servidor:', e);
    }
  };

  // session auto-expiration control (60 minutes of total inactivity)
  useEffect(() => {
    if (!user) return;

    const timerKey = `last_active_${user.uid}`;
    safeLocalStorageSetItem(timerKey, Date.now().toString());

    const checkTimeout = () => {
      const stored = localStorage.getItem(timerKey);
      if (stored) {
        const lastActive = parseInt(stored, 10);
        const inactivityPeriod = Date.now() - lastActive;
        if (inactivityPeriod > 3600000) { // 1 hour in ms
          setAuthError('Sua sessão expirou por inatividade de 1 hora. Realize um novo login por segurança.');
          logout();
        }
      }
    };

    const refreshActiveTime = () => {
      safeLocalStorageSetItem(timerKey, Date.now().toString());
    };

    window.addEventListener('mousemove', refreshActiveTime);
    window.addEventListener('keydown', refreshActiveTime);
    window.addEventListener('click', refreshActiveTime);
    window.addEventListener('scroll', refreshActiveTime);

    const intervalId = setInterval(checkTimeout, 30000); // verify every 30 seconds

    return () => {
      window.removeEventListener('mousemove', refreshActiveTime);
      window.removeEventListener('keydown', refreshActiveTime);
      window.removeEventListener('click', refreshActiveTime);
      window.removeEventListener('scroll', refreshActiveTime);
      clearInterval(intervalId);
    };
  }, [user]);

  // As regras do Firestore só enxergam o cargo gravado no token de login
  // (custom claim "role"), não o do documento users/{uid}. Sem isso, a tela
  // libera os botões mas o Firestore nega a gravação ("missing or
  // insufficient permissions"). O servidor copia o cargo para o token e, se
  // algo mudou, renovamos o token para a claim nova valer já.
  const syncRoleClaim = async (firebaseUser: User) => {
    try {
      const idToken = await firebaseUser.getIdToken();
      const response = await fetch('/api/sync-role-claim', {
        method: 'POST',
        headers: { Authorization: `Bearer ${idToken}` },
      });
      if (response.ok) {
        const result = await response.json();
        if (result.updated) {
          await firebaseUser.getIdToken(true);
        }
      }
    } catch (e) {
      console.warn('[AuthContext] Não foi possível sincronizar o cargo no token:', e);
    }
  };

  const resolveUserWithDelegation = async (profile: UserProfile): Promise<UserProfile> => {
    try {
      const effectiveRole = await getEffectiveRole(profile.uid, profile.role, db);
      const delegation = await getActiveDelegation(profile.uid, db);
      return {
        ...profile,
        effectiveRole,
        activeDelegationInfo: delegation ? {
          absentUserName: delegation.absentUserName,
          absentUserRole: delegation.absentUserRole,
          endDate: delegation.endDate,
          reason: delegation.reason,
        } : undefined,
      };
    } catch (e) {
      console.warn('[AuthContext] Erro ao resolver role efetiva:', e);
      return { ...profile, effectiveRole: profile.role };
    }
  };

  // Real-time listener for delegations when user is logged in
  useEffect(() => {
    if (!user?.uid || !hasValidConfig) return;
    const q = query(
      collection(db, 'delegations'),
      where('delegateUserId', '==', user.uid),
      where('active', '==', true)
    );
    const unsub = onSnapshot(q, async () => {
      if (!user) return;
      // Delegação começou/terminou: o servidor recalcula o cargo no token (regras do
      // Firestore) e renovamos o token para valer na hora — antes a delegação só
      // mudava a tela, e o Firestore continuava negando as ações do substituto.
      if (auth.currentUser) await syncRoleClaim(auth.currentUser);
      const effectiveRole = await getEffectiveRole(user.uid, user.role, db);
      const delegation = await getActiveDelegation(user.uid, db);
      setUser(prev => {
        if (!prev) return null;
        if (prev.effectiveRole === effectiveRole && (!delegation === !prev.activeDelegationInfo)) {
          return prev;
        }
        return {
          ...prev,
          effectiveRole,
          activeDelegationInfo: delegation ? {
            absentUserName: delegation.absentUserName,
            absentUserRole: delegation.absentUserRole,
            endDate: delegation.endDate,
            reason: delegation.reason,
          } : undefined
        };
      });
    }, (err) => {
      console.warn('[AuthContext] Erro no listener de delegações:', err);
    });
    return () => unsub();
  }, [user?.uid, user?.role]);

  useEffect(() => {
    // 1. Check for Virtual User session on mount
    const storedVirtualSession = localStorage.getItem('virtual_user_session');
    let hasVirtual = false;
    if (storedVirtualSession) {
      try {
        const virtualUserObj = JSON.parse(storedVirtualSession);
        resolveUserWithDelegation(virtualUserObj).then(resolved => {
          setUser(resolved);
        }).catch(() => {
          setUser(virtualUserObj);
        });
        setLoading(false);
        hasVirtual = true;
      } catch (err) {
        console.warn('Erro ao decodificar sessão virtual local:', err);
      }
    }


    if (!hasValidConfig) {
      setLoading(false);
      return () => {};
    }

    let unsubscribe = () => {};
    try {
      unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
        if (firebaseUser) {
          // Clear virtual session if we have a real Firebase Auth user logged in, to prevent collision
          localStorage.removeItem('virtual_user_session');
          setLoading(true);
          try {
            await syncRoleClaim(firebaseUser);
            // Fetch custom claims securely on credentials refresh
            const tokenResult = await firebaseUser.getIdTokenResult(true);
            let userDoc;
            try {
              userDoc = await getDoc(doc(db, 'users', firebaseUser.uid));
            } catch (getDocErr: any) {
              console.warn('[AuthContext] Falha ao obter documento do usuário via rede/offline. Tentando carregar perfil local de fallback.', getDocErr);
              const primaryAdminEmails = [
                ((import.meta as any).env.VITE_ADMIN_EMAIL || '').toLowerCase().trim()
              ].filter(Boolean);
              const isUserPrimaryAdmin = firebaseUser.email && primaryAdminEmails.includes(firebaseUser.email.toLowerCase().trim());
              const fallbackProfile: UserProfile = {
                uid: firebaseUser.uid,
                displayName: firebaseUser.displayName || 'Consultor Corporativo',
                email: firebaseUser.email || '',
                role: isUserPrimaryAdmin ? 'admin' : 'consultant',
                registrationNumber: isUserPrimaryAdmin ? 'ADM-OFFLINE' : 'CON-OFFLINE',
                photoURL: firebaseUser.photoURL || undefined,
                status: 'online',
              };
              setUser(fallbackProfile);
              setLoading(false);
              return;
            }
            
            if (userDoc.exists()) {
              const profile = { uid: firebaseUser.uid, ...userDoc.data() } as UserProfile;
              
              // O cargo que vale é o do token (é o único que as regras do
              // Firestore enxergam). Antes, qualquer conta Google virava
              // "admin" só na tela — as regras continuavam negando tudo.
              // Administrador principal agora é só quem usa o e-mail de
              // administrador configurado (VITE_ADMIN_EMAIL / ADMIN_EMAIL).
              const roleFromClaim = tokenResult.claims.role as UserRole | undefined;
              const primaryAdminEmails = [
                ((import.meta as any).env.VITE_ADMIN_EMAIL || '').toLowerCase().trim()
              ].filter(Boolean);
              const isUserPrimaryAdmin = !!firebaseUser.email && primaryAdminEmails.includes(firebaseUser.email.toLowerCase().trim());

              const rank: Record<string, number> = { staff: 1, consultant: 1, hr: 2, manager: 3, admin: 4 };
              if (roleFromClaim && (rank[roleFromClaim] || 0) > (rank[profile.role] || 0)) {
                // Token com cargo MAIOR que o da ficha = delegação ativa: a tela mostra o
                // cargo próprio e a delegação aparece à parte (effectiveRole/banner).
              } else if (roleFromClaim) {
                profile.role = roleFromClaim;
              } else if (isUserPrimaryAdmin) {
                profile.role = 'admin';
              }

              if (profile.blocked) {
                await signOut(auth);
                setUser(null);
                setAuthError('Seu acesso corporativo foi bloqueado.');
              } else {
                const resolved = await resolveUserWithDelegation(profile);
                setUser(resolved);
                setAuthError(null);
              }
            } else {
              // Primeiro acesso: o cargo inicial é o do token (o servidor já dá
              // "admin" ao e-mail de administrador configurado); os demais
              // entram como consultor até um gestor alterar o cargo.
              const roleFromClaim = tokenResult.claims.role as UserRole | undefined;
              // SEGURANÇA: conta sem cargo atribuído pelo servidor = não foi cadastrada
              // por um administrador (ex.: alguém criou uma conta por fora). Não entra.
              if (!roleFromClaim) {
                await signOut(auth);
                setUser(null);
                setAuthError('Esta conta não está cadastrada no sistema. Peça ao administrador para criar seu acesso.');
                setLoading(false);
                return;
              }
              const initialRole: UserRole = roleFromClaim;
              const newProfile: UserProfile = {
                uid: firebaseUser.uid,
                displayName: firebaseUser.displayName || (initialRole === 'admin' ? 'Douglas Dias Pereira' : 'Consultor'),
                email: firebaseUser.email || '',
                role: initialRole,
                registrationNumber: initialRole === 'admin' ? 'ADM-001' : 'PENDENTE',
                photoURL: firebaseUser.photoURL || undefined,
                status: 'online',
              };
              try {
                await setDoc(doc(db, 'users', firebaseUser.uid), {
                  ...newProfile,
                  createdAt: serverTimestamp()
                });
                const resolved = await resolveUserWithDelegation(newProfile);
                setUser(resolved);
              } catch (err) {
                handleFirestoreError(err, OperationType.WRITE, 'users');
              }
            }
          } catch (authCycleError) {
            console.error('Falha no ciclo onAuthStateChanged:', authCycleError);
            setUser(null);
          }
        } else {
          // If there's no native Firebase Auth user, only clear the user state if we do NOT have an active virtual user session
          if (!localStorage.getItem('virtual_user_session')) {
            setUser(null);
          }
        }
        setLoading(false);
      });
    } catch (authInitErr) {
      console.warn('[AuthContext] Falha ao registrar onAuthStateChanged (modo offline/mock):', authInitErr);
      setLoading(false);
    }

    return () => unsubscribe();
  }, []);

  const signIn = async () => {
    setLoading(true);
    setAuthError(null);
    localStorage.removeItem('virtual_user_session');

    // SEGURANÇA: antes, com o Firebase mal configurado, o app entrava direto como
    // "Administrador Geral" sem senha nenhuma. Agora apenas avisa.
    if (!hasValidConfig) {
      setAuthError('O sistema não está configurado para login. Verifique o arquivo .env.local.');
      setLoading(false);
      return;
    }

    const provider = new GoogleAuthProvider();
    // Tentar auto-selecionar a conta conectada no navegador
    provider.setCustomParameters({ prompt: 'none' });

    let result;
    try {
      try {
        result = await signInWithPopup(auth, provider);
      } catch (promptErr: any) {
        const needsFallback =
          promptErr.message?.includes('interaction_required') ||
          promptErr.message?.includes('account_selection_required') ||
          promptErr.code === 'auth/popup-closed-by-user' ||
          promptErr.code === 'auth/cancelled-popup-request';
        if (needsFallback) {
          const fallback = new GoogleAuthProvider();
          // sem prompt:none — abre seletor manual
          result = await signInWithPopup(auth, fallback);
        } else {
          throw promptErr;
        }
      }

      if (result.user?.email) {
        triggerLoginLog(result.user.email, 'success');
      }
      setLoading(false);
    } catch (popupError: any) {
      if (popupError.code === 'auth/popup-closed-by-user') {
        setAuthError('O login com Google foi cancelado porque a janela de autenticação foi fechada.');
        setLoading(false);
        return;
      }

      // Detectar erros específicos do ambiente mock/AI Studio sandbox
      const isEnvError =
        popupError.code === 'auth/api-key-not-valid.-please-pass-a-valid-api-key.' ||
        popupError.code === 'auth/invalid-api-key' ||
        popupError.code === 'auth/network-request-failed' ||
        popupError.message?.includes('api-key') ||
        popupError.message?.includes('API key') ||
        popupError.message?.includes('intercepted');

      if (isEnvError) {
        // SEGURANÇA: antes, uma falha de rede aqui entrava como Administrador Geral sem senha.
        setAuthError('Sem conexão com o serviço de login do Google. Verifique a internet e tente novamente.');
        setLoading(false);
        return;
      }

      triggerLoginLog(
        auth.currentUser?.email || 'google_federated_user',
        'failure',
        popupError.message
      );
      setAuthError('Erro ao autenticar com Google. Tente novamente.');
      setLoading(false);
    }
  };

  const signInWithVirtualGoogle = async (_email: string, _displayName: string, _photoURL?: string) => {
    // SEGURANÇA: "Google simulado" desativado — dava acesso de Administrador a qualquer
    // e-mail com a palavra "admin", sem senha. Mantida só a assinatura por compatibilidade.
    setAuthError('Login simulado desativado. Use seu e-mail/matrícula e senha.');
  };

  const signInWithCredentials = async (id: string, pass: string) => {
    setLoading(true);
    const trackingEmail = id;
    const cleanId = id.replace(/[^a-zA-Z0-9]/g, '');
    const attemptsKey = `login_attempts_${cleanId}`;
    
    const storedAttempts = localStorage.getItem(attemptsKey);
    const failedAttemptsCount = storedAttempts ? parseInt(storedAttempts, 10) : 0;

    if (failedAttemptsCount >= 5) {
      triggerLoginLog(trackingEmail, 'failure', 'Suspensa por excesso de tentativas (5+)');
      throw new Error('Conta suspensa por exceder 5 tentativas. Contate o Administrador.');
    }

    try {
      // Call our secure unified login API
      const response = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, password: pass })
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || `E-mail, matrícula ou senha inválidos.`);
      }

      const data = await response.json();

      if (data.useNativeAuth) {
        // Usuários legados sem passwordHash no backend: quem valida a senha
        // aqui é o próprio Firebase Auth (signInWithEmailAndPassword). Antes,
        // se essa chamada falhasse por QUALQUER motivo — inclusive senha
        // errada (auth/wrong-password, auth/invalid-credential) — o código
        // caía num "login virtual" que autenticava o usuário mesmo assim,
        // sem checar a senha em lugar nenhum. Ou seja: qualquer senha
        // "funcionava" pra essas contas. Agora só entramos em modo virtual
        // quando o problema é de infraestrutura (Firebase Auth inacessível/
        // mal configurado) — nunca quando o motivo é credencial inválida.
        try {
          await signInWithEmailAndPassword(auth, data.email, pass);
          localStorage.removeItem(attemptsKey);
        } catch (firebaseErr: any) {
          const credentialErrorCodes = [
            'auth/wrong-password',
            'auth/invalid-credential',
            'auth/invalid-login-credentials',
            'auth/user-not-found',
            'auth/user-disabled',
          ];
          const isCredentialError = credentialErrorCodes.includes(firebaseErr?.code);
          // SEGURANÇA: antes, se o Firebase estivesse inacessível, o app entrava numa
          // "sessão virtual" SEM a senha ter sido conferida por ninguém. Agora falha.
          if (isCredentialError) throw new Error('E-mail/matrícula ou senha inválidos.');
          throw new Error('Não foi possível conectar ao servidor de login. Verifique a internet e tente novamente.');
        }
      } else if (data.success && data.user) {
        localStorage.removeItem(attemptsKey);
        passwordChangeTokenRef.current = data.passwordChangeToken || null;
        if (data.isVirtual) {
          // Usuário virtual: sem Firebase Auth, usar sessão local
          safeLocalStorageSetItem('virtual_user_session', JSON.stringify(data.user));
          const resolved = await resolveUserWithDelegation(data.user);
          setUser(resolved);
          triggerLoginLog(data.user.email, 'success');
        } else {
          // Usuário real: backend já validou a senha via bcrypt.
          // Tentar sincronizar com Firebase Auth (best effort).
          // Se falhar, usar sessão virtual — o backend é a fonte de verdade.
          try {
            if (data.firebaseToken) {
              // Token emitido pelo servidor depois de validar a senha: entra
              // no Firebase mesmo que a senha de lá esteja dessincronizada,
              // evitando a sessão virtual (que não consegue gravar nada).
              await signInWithCustomToken(auth, data.firebaseToken);
            } else {
              await signInWithEmailAndPassword(auth, data.user.email, pass);
            }
            localStorage.removeItem('virtual_user_session');
            triggerLoginLog(data.user.email, 'success');
          } catch (firebaseErr: any) {
            // Firebase Auth dessincronizado (senha mudou só no Firestore via bcrypt).
            // Usar sessão virtual como fallback seguro — o backend já validou.
            safeLocalStorageSetItem('virtual_user_session', JSON.stringify(data.user));
            const resolved = await resolveUserWithDelegation(data.user);
            setUser(resolved);
            setLoading(false);
            triggerLoginLog(data.user.email, 'success');
            // Tentar sincronizar senha no Firebase Auth em background (best effort).
            // O token de uso único é consumido pelo servidor assim que essa
            // chamada chega nele — independente do resultado. Por isso já
            // limpamos a referência aqui: se não fizermos isso, uma troca de
            // senha de verdade logo em seguida (ex: tela de "primeiro
            // acesso") reenviaria esse mesmo token já gasto e receberia um
            // "sessão de troca de senha inválida" confuso, obrigando o
            // usuário a sair e entrar de novo sem entender o motivo.
            const syncToken = passwordChangeTokenRef.current;
            passwordChangeTokenRef.current = null;
            try {
              fetch('/api/update-password', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  uid: data.user.uid,
                  newPassword: pass,
                  passwordChangeToken: syncToken,
                }),
              });
            } catch (_syncErr) {
              // Falha silenciosa — sessão virtual já está ativa
            }
          }
        }
      } else {
        throw new Error('Falha inesperada no servidor de login.');
      }
    } catch (error: any) {
      const newAttempts = failedAttemptsCount + 1;
      safeLocalStorageSetItem(attemptsKey, newAttempts.toString());
      
      triggerLoginLog(id, 'failure', error.message || String(error));
      
      console.error(error);
      if (error.code === 'auth/wrong-password' || error.code === 'auth/user-not-found' || error.code === 'auth/invalid-credential' || error.message?.includes('incorretos')) {
        throw new Error(`E-mail, matrícula ou senha inválidos. (${newAttempts}/5 tentativas)`);
      }
      throw error;
    } finally {
      setLoading(false);
    }
  };

  const updateUserPassword = async (newPass: string) => {
    if (!user) return;
    try {
      // Call our robust corporative change password API
      const response = await fetch('/api/update-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          uid: user.uid,
          newPassword: newPass,
          passwordChangeToken: passwordChangeTokenRef.current,
        })
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || 'Falha ao redefinir senha corporativa.');
      }

      // Token de uso único já foi consumido pelo servidor — evita reenviar.
      passwordChangeTokenRef.current = null;

      // Synchronize local state
      setUser(prev => prev ? { ...prev, mustChangePassword: false } : null);
      
      // Update virtual session inside localStorage if active
      const storedVirtualSession = localStorage.getItem('virtual_user_session');
      if (storedVirtualSession) {
        try {
          const obj = JSON.parse(storedVirtualSession);
          obj.mustChangePassword = false;
          safeLocalStorageSetItem('virtual_user_session', JSON.stringify(obj));
        } catch (e) {}
      }
    } catch (error: any) {
       console.error(error);
       throw error;
     }
  };

  const updateUserProfile = async (updates: Partial<UserProfile>) => {
    if (!user) return;
    const updatedUser = { ...user, ...updates };
    setUser(updatedUser);

    const storedVirtualSession = localStorage.getItem('virtual_user_session');
    if (storedVirtualSession) {
      try {
        const obj = JSON.parse(storedVirtualSession);
        const updatedObj = { ...obj, ...updates };
        safeLocalStorageSetItem('virtual_user_session', JSON.stringify(updatedObj));
        if (obj.email) {
          safeLocalStorageSetItem(`saved_profile_${obj.email.toLowerCase().trim()}`, JSON.stringify(updatedObj));
        }
      } catch (e) {
        console.error('Error updating virtual session localstorage:', e);
      }
    } else if (user?.email) {
      // Fallback if virtual session is not stored yet but user has email
      try {
        const savedKey = `saved_profile_${user.email.toLowerCase().trim()}`;
        const saved = localStorage.getItem(savedKey);
        const existing = saved ? JSON.parse(saved) : {};
        safeLocalStorageSetItem(savedKey, JSON.stringify({ ...existing, ...updates }));
      } catch (e) {}
    }

    if (hasValidConfig) {
      try {
        await updateDoc(doc(db, 'users', user.uid), updates);
      } catch (err) {
        console.warn('Silent skip of firestore profile sync:', err);
      }
    }
  };

  const logout = async () => {
    try {
      localStorage.removeItem('virtual_user_session');
      if (user?.uid) {
        localStorage.removeItem(`last_active_${user.uid}`);
      }
      // Privacidade em computador compartilhado: apaga a cópia local de dados
      // (clientes, visitas...) guardada para uso offline e perfis salvos.
      try {
        const { clearAllCache } = await import('../lib/indexedDbCache');
        await clearAllCache();
      } catch (cacheErr) {
        console.warn('Não foi possível limpar o cache local ao sair:', cacheErr);
      }
      Object.keys(localStorage)
        .filter(k => k.startsWith('saved_profile_'))
        .forEach(k => localStorage.removeItem(k));
      if (hasValidConfig && auth) {
        try {
          await signOut(auth);
        } catch (authErr) {
          console.warn('Silent fallback on signOut auth error:', authErr);
        }
      }
    } finally {
      setUser(null);
      setAuthError(null);
    }
  };

  const clearAuthError = () => setAuthError(null);

  const effectiveUser = React.useMemo(() => {
    if (!user) return null;
    if (user.isVacationReplacement && user.temporaryRole) {
      return {
        ...user,
        role: user.temporaryRole
      };
    }
    return user;
  }, [user]);

  return (
    <AuthContext.Provider value={{ 
      user: effectiveUser, 
      loading, 
      authError, 
      signIn, 
      signInWithCredentials, 
      updateUserPassword, 
      logout, 
      clearAuthError,
      isVirtualGoogleChooserOpen,
      setVirtualGoogleChooserOpen,
      signInWithVirtualGoogle,
      updateUserProfile
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
