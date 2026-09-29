import React, { useState, useEffect } from 'react';
import { Bell } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { db } from '../../lib/firebase';
import { collection, onSnapshot, query, where, doc, writeBatch, setDoc } from 'firebase/firestore';
import { AppNotification } from '../../types';
import { cn, handleFirestoreError, OperationType, formatDateTime } from '../../lib/utils';

// Avisos gerais (userId 'all') são compartilhados por todos: não dá para marcar
// o documento como lido para um só usuário. Quais cada pessoa já leu fica na
// ficha dela (users/{uid}.readBroadcastIds) — assim o aviso lido num computador
// aparece lido também no outro. O localStorage fica só como reserva offline.
const broadcastKey = (uid: string) => `agrogestao-read-broadcasts-${uid}`;

function loadReadBroadcasts(uid: string): Set<string> {
  try {
    return new Set<string>(JSON.parse(localStorage.getItem(broadcastKey(uid)) || '[]'));
  } catch {
    return new Set();
  }
}

function saveReadBroadcasts(uid: string, ids: Set<string>) {
  try {
    localStorage.setItem(broadcastKey(uid), JSON.stringify(Array.from(ids).slice(-200)));
  } catch {
    // armazenamento indisponível: o aviso apenas volta a aparecer como novo
  }
}

export default function NotificationBell() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [readBroadcasts, setReadBroadcasts] = useState<Set<string>>(new Set());
  const [isOpen, setIsOpen] = useState(false);

  const isUnread = (n: AppNotification) =>
    n.userId === 'all' ? !readBroadcasts.has(n.id) : !n.read;
  const unreadCount = notifications.filter(isUnread).length;

  useEffect(() => {
    if (!user) return;
    setReadBroadcasts(loadReadBroadcasts(user.uid));
    // Lidos em qualquer computador (ficha do usuário no banco)
    const unsubRead = onSnapshot(doc(db, 'users', user.uid), (snap) => {
      const ids: string[] = snap.data()?.readBroadcastIds || [];
      if (ids.length) {
        setReadBroadcasts(prev => {
          const next = new Set<string>([...prev, ...ids]);
          saveReadBroadcasts(user.uid, next);
          return next;
        });
      }
    }, () => { /* sem acesso: fica o controle local */ });
    const path = 'notifications';
    // Sem orderBy/limit no Firestore: userId + createdAt exigiria um índice composto que não
    // existe no projeto (o sininho nunca carregava). Ordenamos e cortamos aqui.
    const q = query(
      collection(db, path),
      where('userId', 'in', [user.uid, 'all'])
    );
    const ms = (v: any) => (v?.toDate ? v.toDate().getTime() : new Date(v || 0).getTime()) || 0;
    const toList = (snap: any) => (snap.docs.map((d: any) => ({ id: d.id, ...d.data() } as AppNotification)) as AppNotification[])
      .sort((a, b) => ms(b.createdAt) - ms(a.createdAt))
      .slice(0, 15);
    let unsubFallback: (() => void) | null = null;
    const unsub = onSnapshot(q, (snap) => {
      setNotifications(toList(snap));
    }, (error) => {
      // Sem permissão para avisos gerais (ex.: conta sem cargo no token): mostra ao menos os pessoais.
      console.warn('[Notificações] Avisos gerais indisponíveis, exibindo só os pessoais:', error);
      const personalQ = query(collection(db, path), where('userId', '==', user.uid));
      unsubFallback = onSnapshot(personalQ, (snap) => setNotifications(toList(snap)), (err) => {
        handleFirestoreError(err, OperationType.LIST, path);
      });
    });
    return () => {
      unsub();
      unsubFallback?.();
      unsubRead();
    };
  }, [user?.uid]);

  const markAllAsRead = async () => {
    if (!user) return;
    const unreadPersonal = notifications.filter(n => n.userId !== 'all' && !n.read);
    const unreadBroadcast = notifications.filter(n => n.userId === 'all' && !readBroadcasts.has(n.id));

    if (unreadBroadcast.length > 0) {
      const next = new Set<string>(readBroadcasts);
      unreadBroadcast.forEach(n => next.add(n.id));
      setReadBroadcasts(next);
      saveReadBroadcasts(user.uid, next);
      try {
        await setDoc(doc(db, 'users', user.uid), { readBroadcastIds: Array.from(next).slice(-200) }, { merge: true });
      } catch {
        // offline: fica marcado neste PC e sincroniza na próxima vez que marcar
      }
    }

    if (unreadPersonal.length === 0) return;
    const path = 'notifications';
    try {
      const batch = writeBatch(db);
      unreadPersonal.forEach(n => {
        batch.update(doc(db, path, n.id), { read: true });
      });
      await batch.commit();
    } catch (error) {
       handleFirestoreError(error, OperationType.UPDATE, path);
    }
  };

  const getNotificationTime = (createdAt: any) => {
    if (!createdAt) return '';
    const date = createdAt.toDate ? createdAt.toDate() : new Date(createdAt);
    const isToday = date.toDateString() === new Date().toDateString();
    return isToday
      ? date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
      : formatDateTime(date);
  };

  return (
    <div className="relative">
      <button
        id="notification-trigger"
        onClick={() => {
          setIsOpen(!isOpen);
          if (!isOpen && unreadCount > 0) markAllAsRead();
        }}
        title="Notificações"
        className={cn(
          "p-2.5 glass rounded-xl relative transition-all group",
          isOpen ? "bg-emerald-500/10 text-emerald-600" : "text-slate-600 hover:bg-white shadow-sm"
        )}
      >
        <Bell className="w-5 h-5 group-hover:rotate-12 transition-transform" />
        {unreadCount > 0 && (
          <span className="absolute top-1.5 right-1.5 w-2.5 h-2.5 bg-rose-500 border-2 border-white rounded-full animate-pulse" />
        )}
      </button>

      <AnimatePresence>
        {isOpen && (
          <>
            <div className="fixed inset-0 z-[1000]" onClick={() => setIsOpen(false)} />
            <motion.div
              initial={{ opacity: 0, y: 10, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 10, scale: 0.95 }}
              className="absolute right-0 mt-3 w-80 bg-white shadow-2xl z-[1001] overflow-hidden rounded-3xl border border-slate-100"
            >
              <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
                <h3 className="font-bold text-slate-800 text-sm">Notificações</h3>
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{unreadCount} novas</span>
              </div>
              <div className="max-h-[360px] overflow-y-auto custom-scrollbar">
                {notifications.map(n => (
                  <div
                    key={n.id}
                    onClick={() => {
                      if (n.link) {
                        setIsOpen(false);
                        navigate(`/${String(n.link).replace(/^\/+/, '')}`);
                      }
                    }}
                    className={cn(
                      "p-4 border-b border-slate-50 last:border-0 hover:bg-slate-50 transition-colors",
                      n.link ? "cursor-pointer" : "cursor-default",
                      isUnread(n) && "bg-emerald-50/20"
                    )}
                  >
                    <div className="flex items-start gap-3">
                      <div className={cn(
                        "mt-1 w-2 h-2 rounded-full shrink-0",
                        n.type === 'success' ? "bg-emerald-500" :
                        n.type === 'alert' ? "bg-rose-500" :
                        n.type === 'update' ? "bg-emerald-500" : "bg-slate-400"
                      )} />
                      <div>
                        <div className="text-[11px] font-bold text-slate-800 leading-tight mb-0.5">{n.title}</div>
                        <div className="text-[10px] text-slate-500 mb-1">{n.message}</div>
                        <div className="text-[9px] font-bold text-slate-300 uppercase italic">
                          {getNotificationTime(n.createdAt)}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
                {notifications.length === 0 && (
                  <div className="p-10 text-center">
                    <Bell className="w-8 h-8 text-slate-100 mx-auto mb-2" />
                    <p className="text-[10px] font-bold text-slate-300 uppercase tracking-widest">Tudo limpo por aqui</p>
                  </div>
                )}
              </div>
              <button
                onClick={() => setIsOpen(false)}
                className="w-full py-3 text-[10px] font-bold text-slate-400 uppercase tracking-widest hover:bg-slate-50 border-t border-slate-100 transition-colors"
              >
                Fechar
              </button>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
