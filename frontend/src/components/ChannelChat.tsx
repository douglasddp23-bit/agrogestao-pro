import React, { useState, useEffect, useRef } from 'react';
import { runExclusive } from '../lib/submitGuard';
import { 
  Send, 
  Paperclip, 
  Smile, 
  Image as ImageIcon, 
  FileText, 
  Trash2, 
  X, 
  Users, 
  Hash, 
  Folder, 
  Download,
  Info,
  Eye
} from 'lucide-react';
import { toast } from 'sonner';
import { checkUpload, DOCUMENT_KINDS, sanitizeFileName } from '../lib/uploadGuard';
import { 
  collection, 
  addDoc, 
  onSnapshot, 
  query, 
  where, 
  updateDoc, 
  doc, 
  serverTimestamp, 
  deleteDoc,
  setDoc
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useAuth } from '../contexts/AuthContext';
import { Channel, ChannelMessage, UserProfile, MessageAttachment } from '../types';
import { motion, AnimatePresence } from 'motion/react';
import { ROLE_LABELS, UserRole } from '../lib/permissions';
import { handleFirestoreError, OperationType, cn } from '../lib/utils';

interface ChannelChatProps {
  channel: Channel;
  users: UserProfile[];
  onBack?: () => void;
}

const EMOJIS = ['👍', '❤️', '😄', '😮', '😢', '🔥', '👏', '✅'];

export default function ChannelChat({ channel, users, onBack }: ChannelChatProps) {
  const { user } = useAuth();
  const [messages, setMessages] = useState<ChannelMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [attachedFiles, setAttachedFiles] = useState<MessageAttachment[]>([]);
  const [showEmojiPickerForMsg, setShowEmojiPickerForMsg] = useState<string | null>(null);
  const [showChannelDetails, setShowChannelDetails] = useState(false);
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Presence and Read Receipt States
  const [typingUsers, setTypingUsers] = useState<{ userId: string; userName: string }[]>([]);
  const [isLocalTyping, setIsLocalTyping] = useState(false);
  const typingTimeoutRef = useRef<any>(null);
  const [readRecords, setReadRecords] = useState<{ userId: string; userName: string; userPhotoURL: string; lastReadAt: string; lastReadMessageId: string }[]>([]);

  // Function to set typing presence state in Firestore
  const setTypingState = async (isTyping: boolean) => {
    if (!user || !channel?.id) return;
    try {
      await setDoc(doc(db, 'channel_typing', `${channel.id}_${user.uid}`), {
        channelId: channel.id,
        userId: user.uid,
        userName: user.displayName || user.email || 'Usuário',
        userPhotoURL: user.photoURL || '',
        isTyping,
        lastActive: new Date().toISOString()
      }, { merge: true });
    } catch (err) {
      console.error("Error setting typing state:", err);
    }
  };

  // Debounced input change handler for typing indicator
  const handleInputChange = (val: string) => {
    setInputText(val);

    if (!user || !channel?.id) return;

    if (!isLocalTyping && val.trim().length > 0) {
      setIsLocalTyping(true);
      setTypingState(true);
    }

    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }

    typingTimeoutRef.current = setTimeout(() => {
      setIsLocalTyping(false);
      setTypingState(false);
    }, 3000);
  };

  // Subscribe to other users typing in real-time
  useEffect(() => {
    if (!channel?.id || !user?.uid) return;

    const q = query(
      collection(db, 'channel_typing'),
      where('channelId', '==', channel.id),
      where('isTyping', '==', true)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const list = snapshot.docs
        .map(doc => doc.data())
        .filter(data => data.userId !== user.uid)
        .filter(data => {
          // Filter out typing events older than 8s (stale)
          const lastActiveTime = data.lastActive ? new Date(data.lastActive).getTime() : 0;
          return Date.now() - lastActiveTime < 8000;
        })
        .map(data => ({
          userId: data.userId || '',
          userName: data.userName || 'Membro'
        }));
      setTypingUsers(list);
    });

    return () => {
      unsubscribe();
      // Reset typing state on leave
      setTypingState(false);
    };
  }, [channel.id, user?.uid]);

  // Subscribe to read receipts in real-time
  useEffect(() => {
    if (!channel?.id) return;

    const q = query(
      collection(db, 'channel_reads'),
      where('channelId', '==', channel.id)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const records = snapshot.docs.map(doc => {
        const data = doc.data();
        return {
          userId: data.userId || '',
          userName: data.userName || 'Usuário',
          userPhotoURL: data.userPhotoURL || '',
          lastReadAt: data.lastReadAt || '',
          lastReadMessageId: data.lastReadMessageId || ''
        };
      });
      setReadRecords(records);
    });

    return () => unsubscribe();
  }, [channel.id]);

  // Update read status when messages or channel changes
  useEffect(() => {
    if (messages.length > 0 && channel?.id && user?.uid) {
      const updateReadStatus = async () => {
        try {
          const lastMsg = messages[messages.length - 1];
          if (!lastMsg) return;

          const lastMsgTime = lastMsg.createdAt 
            ? (typeof lastMsg.createdAt === 'object' && lastMsg.createdAt.seconds 
                ? new Date(lastMsg.createdAt.seconds * 1000).toISOString()
                : new Date(lastMsg.createdAt).toISOString())
            : new Date().toISOString();

          await setDoc(doc(db, 'channel_reads', `${channel.id}_${user.uid}`), {
            channelId: channel.id,
            userId: user.uid,
            userName: user.displayName || user.email || 'Usuário',
            userPhotoURL: user.photoURL || '',
            lastReadAt: lastMsgTime,
            lastReadMessageId: lastMsg.id,
            updatedAt: new Date().toISOString()
          }, { merge: true });
        } catch (err) {
          console.error("Error updating read status:", err);
        }
      };

      updateReadStatus();
    }
  }, [messages.length, channel.id, user?.uid]);

  // Memoize readers per message
  const readersByMessage = React.useMemo(() => {
    const map: Record<string, typeof readRecords> = {};
    
    readRecords.forEach(record => {
      if (record.userId === user?.uid) return; // Ignore myself
      
      let furthestMsgId = record.lastReadMessageId;
      
      if (!furthestMsgId && record.lastReadAt) {
        const readTime = new Date(record.lastReadAt).getTime();
        for (let i = messages.length - 1; i >= 0; i--) {
          const m = messages[i];
          const getTimestamp = (val: any) => {
            if (!val) return Date.now();
            if (typeof val === 'object' && val.seconds !== undefined) return val.seconds * 1000;
            if (typeof val === 'object' && typeof val.toDate === 'function') return val.toDate().getTime();
            return new Date(val).getTime();
          };
          const mTime = getTimestamp(m.createdAt);
          if (readTime >= mTime - 1000) {
            furthestMsgId = m.id;
            break;
          }
        }
      }

      if (furthestMsgId) {
        if (!map[furthestMsgId]) {
          map[furthestMsgId] = [];
        }
        map[furthestMsgId].push(record);
      }
    });

    return map;
  }, [readRecords, messages, user?.uid]);

  // Subscribe to channel messages in real-time
  useEffect(() => {
    if (!channel?.id) return;

    const q = query(
      collection(db, 'channel_messages'),
      where('channelId', '==', channel.id)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const msgs = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as ChannelMessage[];

      // Sort in-memory to handle latency with null serverTimestamp()
      msgs.sort((a, b) => {
        const getTimestamp = (val: any) => {
          if (!val) return Date.now();
          if (typeof val === 'object' && val.seconds !== undefined) return val.seconds * 1000;
          if (typeof val === 'object' && typeof val.toDate === 'function') return val.toDate().getTime();
          return new Date(val).getTime();
        };
        return getTimestamp(a.createdAt) - getTimestamp(b.createdAt);
      });

      setMessages(msgs);
    }, (error) => {
      console.error("Error loading channel messages:", error);
      toast.error("Erro ao carregar mensagens do canal.");
    });

    return () => unsubscribe();
  }, [channel.id]);

  // Scroll to bottom on new messages or typing events
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, typingUsers.length > 0]);

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || (!inputText.trim() && attachedFiles.length === 0)) return;

    // Reset typing indicators immediately
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }
    setIsLocalTyping(false);
    setTypingState(false);

    const currentText = inputText;
    const currentAttachments = [...attachedFiles];

    setInputText('');
    setAttachedFiles([]);

    try {
      await addDoc(collection(db, 'channel_messages'), {
        channelId: channel.id,
        senderId: user.uid,
        senderName: user.displayName || user.email || 'Usuário',
        senderPhotoURL: user.photoURL || '',
        content: currentText,
        attachments: currentAttachments,
        createdAt: serverTimestamp()
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'channel_messages');
      toast.error("Erro ao enviar mensagem.");
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return;
    const picked = Array.from(e.target.files) as File[];
    e.target.value = '';
    // Segurança: confere o formato real do arquivo (não só a extensão) e o tamanho
    const filesList: File[] = [];
    for (const file of picked) {
      try {
        await checkUpload(file, file.name, { allow: DOCUMENT_KINDS, maxBytes: 700 * 1024 });
        filesList.push(file);
      } catch (err: any) {
        toast.error(err?.message || 'Arquivo não aceito.');
      }
    }
    
    filesList.forEach((file: File) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const isImg = file.type.startsWith('image/');
        const base64String = reader.result as string;
        
        const fileMB = (file.size / (1024 * 1024)).toFixed(2);
        const sizeStr = file.size > 1024 * 1024 ? `${fileMB} MB` : `${Math.ceil(file.size / 1024)} KB`;

        setAttachedFiles((prev) => [
          ...prev,
          {
            name: sanitizeFileName(file.name),
            type: file.type,
            size: sizeStr,
            url: base64String,
            isImage: isImg
          }
        ]);
        toast.success(`Arquivo anexado: ${sanitizeFileName(file.name)}`);
      };
      reader.readAsDataURL(file);
    });
  };

  const removeAttachment = (index: number) => {
    setAttachedFiles((prev) => prev.filter((_, idx) => idx !== index));
    toast.info('Anexo removido');
  };

  const handleToggleReaction = async (msgId: string, emoji: string) => {
    if (!user) return;
    const msg = messages.find(m => m.id === msgId);
    if (!msg) return;

    const currentReactions = msg.reactions || {};
    const userList = currentReactions[emoji] || [];
    const hasReacted = userList.includes(user.uid);

    let newUserList;
    if (hasReacted) {
      newUserList = userList.filter(uid => uid !== user.uid);
    } else {
      newUserList = [...userList, user.uid];
    }

    const updatedReactions = { ...currentReactions };
    if (newUserList.length === 0) {
      delete updatedReactions[emoji];
    } else {
      updatedReactions[emoji] = newUserList;
    }

    try {
      await updateDoc(doc(db, 'channel_messages', msgId), { reactions: updatedReactions });
    } catch (error) {
       console.error("Error updating reaction:", error);
    }
    setShowEmojiPickerForMsg(null);
  };

  const handleDeleteMessage = async (msgId: string) => {
    try {
      await deleteDoc(doc(db, 'channel_messages', msgId));
      toast.success("Mensagem excluída.");
    } catch (error) {
      console.error(error);
      toast.error("Erro ao excluir mensagem.");
    }
  };

  const formatMessageTime = (val: any) => {
    if (!val) return '';
    let d: Date;
    if (typeof val === 'object' && val.seconds !== undefined) {
      d = new Date(val.seconds * 1000);
    } else {
      d = new Date(val);
    }
    return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  };

  // Find linked project or department badge info
  const getChannelBadge = () => {
    if (channel.type === 'project') {
      return (
        <span className="px-2.5 py-1 bg-emerald-50 border border-emerald-100 text-emerald-700 rounded-full text-[10px] font-bold flex items-center gap-1 shrink-0">
          <Folder className="w-3 h-3" /> Projeto: {channel.projectName || 'Associado'}
        </span>
      );
    }
    if (channel.type === 'department') {
      return (
        <span className="px-2.5 py-1 bg-slate-50 border border-slate-100 text-slate-700 rounded-full text-[10px] font-bold flex items-center gap-1 shrink-0">
          <Hash className="w-3 h-3" /> Departamento: {channel.department || 'Geral'}
        </span>
      );
    }
    return (
      <span className="px-2.5 py-1 bg-slate-50 border border-slate-100 text-slate-700 rounded-full text-[10px] font-bold flex items-center gap-1 shrink-0">
        📢 Geral
      </span>
    );
  };

  return (
    <div className="flex flex-1 h-full overflow-hidden bg-slate-50 relative">
      {/* Main Chat Interface */}
      <div className="flex-1 flex flex-col h-full overflow-hidden border-r border-slate-100 bg-white">
        
        {/* Chat Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 shrink-0 bg-white">
          <div className="flex items-center gap-3">
            {onBack && (
              <button 
                onClick={onBack}
                className="md:hidden p-1.5 hover:bg-slate-100 rounded-full text-slate-500 transition-colors mr-1"
              >
                <X className="w-4 h-4" />
              </button>
            )}
            <div className="w-10 h-10 rounded-full bg-slate-50 text-slate-600 flex items-center justify-center font-bold text-lg border border-slate-100 shadow-sm shrink-0">
              #
            </div>
            <div className="min-w-0 text-left">
              <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2 truncate">
                {channel.name}
              </h3>
              <p className="text-[11px] text-slate-500 truncate max-w-[200px] sm:max-w-md">
                {channel.description || 'Sem descrição do canal'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {getChannelBadge()}
            <button
              onClick={() => setShowChannelDetails(!showChannelDetails)}
              className={cn(
                "p-2 hover:bg-slate-100 rounded-full text-slate-500 transition-all cursor-pointer",
                showChannelDetails ? "bg-slate-50 text-emerald-600" : ""
              )}
              title="Informações do canal"
            >
              <Info className="w-4.5 h-4.5" />
            </button>
          </div>
        </div>

        {/* Chat Messages Scrolling Area */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4 bg-slate-50/50">
          {messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-slate-400 gap-2 py-12">
              <Hash className="w-10 h-10 text-slate-300 stroke-[1.5]" />
              <p className="text-xs font-semibold text-slate-500">Início do canal #{channel.name}</p>
              <p className="text-[10px] text-slate-400">Envie a primeira mensagem para iniciar a conversa.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {messages.map((msg) => {
                const isMe = msg.senderId === user?.uid;
                const senderProfile = users.find(u => u.uid === msg.senderId);
                const displayName = senderProfile?.displayName || msg.senderName;
                const roleLabels: Record<string, string> = {
                  admin: 'Administrador',
                  manager: 'Gerente',
                  hr: 'Recursos Humanos',
                  consultant: 'Consultor',
                  staff: 'Colaborador'
                };
                const userRole = senderProfile?.role ? roleLabels[senderProfile.role] : 'Membro';

                return (
                  <div 
                    key={msg.id} 
                    className={cn(
                      "flex gap-3 max-w-2xl select-none group relative",
                      isMe ? "ml-auto flex-row-reverse" : "mr-auto"
                    )}
                  >
                    {/* User Avatar */}
                    <div className="shrink-0 self-end">
                      {senderProfile?.photoURL ? (
                        <img 
                          src={senderProfile.photoURL} 
                          alt={displayName} 
                          className="w-8 h-8 rounded-full object-cover border border-slate-200"
                          referrerPolicy="no-referrer"
                        />
                      ) : (
                        <div className="w-8 h-8 rounded-full bg-slate-200 text-slate-600 flex items-center justify-center font-bold text-xs border border-slate-300">
                          {displayName.charAt(0).toUpperCase()}
                        </div>
                      )}
                    </div>

                    {/* Message Bubble Column */}
                    <div className="flex flex-col gap-1 min-w-0">
                      {/* Name & Role */}
                      {!isMe && (
                        <div className="flex items-center gap-2 px-1 text-left">
                          <span className="text-[11px] font-bold text-slate-700">{displayName}</span>
                          <span className="text-[9px] px-1.5 py-0.2 bg-slate-200 text-slate-600 rounded-full font-medium">
                            {userRole}
                          </span>
                        </div>
                      )}

                      <div className="relative group">
                        {/* Message Content Bubble */}
                        <div className={cn(
                          "rounded-2xl px-4 py-2.5 text-xs text-left shadow-sm relative break-words",
                          isMe 
                            ? "bg-emerald-50 text-slate-800 rounded-br-none border border-slate-100" 
                            : "bg-white text-slate-700 rounded-bl-none border border-slate-100"
                        )}>
                          <p className="whitespace-pre-wrap">{msg.content}</p>

                          {/* Render attachments */}
                          {msg.attachments && msg.attachments.length > 0 && (
                            <div className="mt-3 space-y-2 border-t border-slate-100/50 pt-2">
                              {msg.attachments.map((file, idx) => (
                                <div 
                                  key={idx} 
                                  className="flex items-center justify-between gap-3 bg-slate-50/80 hover:bg-slate-100/80 p-2 rounded-xl border border-slate-250/20 transition-all text-slate-700"
                                >
                                  <div className="flex items-center gap-2 min-w-0">
                                    {file.isImage ? (
                                      <img 
                                        src={file.url} 
                                        alt={file.name} 
                                        className="w-8 h-8 rounded-lg object-cover shrink-0" 
                                      />
                                    ) : (
                                      <FileText className="w-5 h-5 text-slate-500 shrink-0" />
                                    )}
                                    <div className="min-w-0">
                                      <p className="text-[10px] font-bold truncate max-w-[120px] sm:max-w-[200px]" title={file.name}>
                                        {file.name}
                                      </p>
                                      <p className="text-[8.5px] text-slate-400 font-mono">{file.size}</p>
                                    </div>
                                  </div>
                                  <a 
                                    href={file.url} 
                                    download={file.name}
                                    className="p-1 hover:bg-slate-200 rounded text-slate-500"
                                    title="Baixar arquivo"
                                  >
                                    <Download className="w-3.5 h-3.5" />
                                  </a>
                                </div>
                              ))}
                            </div>
                          )}

                          {/* Time Stamp inside bubble */}
                          <div className="text-right mt-1.5">
                            <span className="text-[8.5px] text-slate-400 font-mono font-medium">
                              {formatMessageTime(msg.createdAt)}
                            </span>
                          </div>
                        </div>

                        {/* Emoji Reactions Pill Bar */}
                        {msg.reactions && Object.keys(msg.reactions).length > 0 && (
                          <div className={cn(
                            "flex items-center gap-1 flex-wrap mt-1 px-1",
                            isMe ? "justify-end" : "justify-start"
                          )}>
                            {Object.entries(msg.reactions).map(([emoji, uids]) => {
                              const uidsList = (uids || []) as string[];
                              const hasIReacted = uidsList.includes(user.uid);
                              return (
                                <button
                                  key={emoji}
                                  onClick={() => handleToggleReaction(msg.id, emoji)}
                                  className={cn(
                                    "flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] border transition-all hover:scale-105",
                                    hasIReacted 
                                      ? "bg-slate-50 border-slate-200 text-slate-600 font-bold" 
                                      : "bg-white border-slate-200 text-slate-500"
                                  )}
                                  title={`${uidsList.length} pessoa(s) reagiram com ${emoji}`}
                                >
                                  <span>{emoji}</span>
                                  <span>{uidsList.length}</span>
                                </button>
                              );
                            })}
                          </div>
                        )}

                        {/* Message Viewed Receipts Indicators */}
                        {readersByMessage[msg.id] && readersByMessage[msg.id].length > 0 && (
                          <div className={cn(
                            "flex items-center gap-1 mt-1 px-1 select-none",
                            isMe ? "justify-end" : "justify-start"
                          )}>
                            <div className="flex -space-x-1 overflow-hidden">
                              {readersByMessage[msg.id].map(reader => (
                                reader.userPhotoURL ? (
                                  <img
                                    key={reader.userId}
                                    src={reader.userPhotoURL}
                                    alt={reader.userName}
                                    title={`Visualizado por ${reader.userName}`}
                                    className="w-3.5 h-3.5 rounded-full object-cover border border-white ring-1 ring-slate-100"
                                    referrerPolicy="no-referrer"
                                  />
                                ) : (
                                  <div
                                    key={reader.userId}
                                    title={`Visualizado por ${reader.userName}`}
                                    className="w-3.5 h-3.5 rounded-full bg-slate-100 text-slate-600 border border-white ring-1 ring-slate-100 flex items-center justify-center font-bold text-[7px]"
                                  >
                                    {reader.userName.charAt(0).toUpperCase()}
                                  </div>
                                )
                              ))}
                            </div>
                            <span className="text-[9px] text-slate-400 font-medium ml-1 flex items-center gap-1">
                              <Eye className="w-3 h-3 text-slate-300" />
                              {readersByMessage[msg.id].length === 1 
                                ? readersByMessage[msg.id][0].userName.split(' ')[0]
                                : `${readersByMessage[msg.id].length} visualizações`}
                            </span>
                          </div>
                        )}

                        {/* Floating Quick Action Overlay (Delete / Reaction Picker toggle) */}
                        <div className={cn(
                          "absolute top-1/2 -translate-y-1/2 hidden group-hover:flex items-center gap-1 bg-white shadow border border-slate-100 rounded-full px-2 py-1 z-10",
                          isMe ? "left-0 -translate-x-[110%]" : "right-0 translate-x-[110%]"
                        )}>
                          <div className="flex items-center gap-0.5">
                            {EMOJIS.slice(0, 4).map(emoji => (
                              <button
                                key={emoji}
                                onClick={() => handleToggleReaction(msg.id, emoji)}
                                className="w-6 h-6 hover:bg-slate-150/65 rounded-full flex items-center justify-center text-xs hover:scale-115 transition-all cursor-pointer"
                              >
                                {emoji}
                              </button>
                            ))}
                            
                            {/* Toggle rest of Emojis */}
                            <button
                              onClick={() => setShowEmojiPickerForMsg(showEmojiPickerForMsg === msg.id ? null : msg.id)}
                              className="w-6 h-6 hover:bg-slate-100 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-600 transition-colors cursor-pointer"
                              title="Mais reações"
                            >
                              <Smile className="w-3.5 h-3.5" />
                            </button>
                          </div>

                          {/* Message Delete Action if owner or admin */}
                          {(isMe || senderProfile?.role === 'admin') && (
                            <button
                              onClick={() => handleDeleteMessage(msg.id)}
                              className="w-6 h-6 hover:bg-rose-50 text-slate-400 hover:text-rose-500 rounded-full flex items-center justify-center transition-all cursor-pointer ml-1 border-l border-slate-100 pl-1"
                              title="Excluir mensagem"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>

                        {/* Extended Emoji Picker Panel */}
                        <AnimatePresence>
                          {showEmojiPickerForMsg === msg.id && (
                            <motion.div
                              initial={{ opacity: 0, scale: 0.95, y: 10 }}
                              animate={{ opacity: 1, scale: 1, y: 0 }}
                              exit={{ opacity: 0, scale: 0.95, y: 10 }}
                              className={cn(
                                "absolute bottom-full mb-2 bg-white shadow-lg border border-slate-200 rounded-xl p-2 flex gap-1.5 z-20",
                                isMe ? "right-0" : "left-0"
                              )}
                            >
                              {EMOJIS.map(emoji => (
                                <button
                                  key={emoji}
                                  onClick={() => handleToggleReaction(msg.id, emoji)}
                                  className="w-8 h-8 hover:bg-slate-100 rounded-lg flex items-center justify-center text-sm hover:scale-115 transition-all"
                                >
                                  {emoji}
                                </button>
                              ))}
                            </motion.div>
                          )}
                        </AnimatePresence>

                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Typing Indicators */}
          {typingUsers.length > 0 && (
            <div className="flex items-center gap-2 px-1 text-slate-400 text-[11px] font-medium py-1 animate-pulse select-none">
              <div className="flex gap-1 items-center bg-white border border-slate-100 rounded-full px-3 py-1.5 shadow-xs">
                {/* Tiny animated dots */}
                <div className="flex gap-0.5 mr-1.5 shrink-0">
                  <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-bounce [animation-delay:-0.3s]"></span>
                  <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-bounce [animation-delay:-0.15s]"></span>
                  <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-bounce"></span>
                </div>
                <span>
                  {typingUsers.length === 1
                    ? `${typingUsers[0].userName.split(' ')[0]} está digitando...`
                    : `${typingUsers.map(u => u.userName.split(' ')[0]).join(', ')} estão digitando...`}
                </span>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Selected attached files bar */}
        {attachedFiles.length > 0 && (
          <div className="px-6 py-2.5 border-t border-slate-100 bg-slate-50 flex items-center gap-2 flex-wrap shrink-0">
            {attachedFiles.map((file, idx) => (
              <div 
                key={idx} 
                className="flex items-center gap-2 bg-white px-3 py-1 rounded-full text-[10px] font-semibold border border-slate-200 text-slate-650"
              >
                <span>{file.name}</span>
                <button 
                  onClick={() => removeAttachment(idx)}
                  className="hover:bg-slate-150 p-0.5 rounded-full text-rose-500"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Message Input Footer Form */}
        <form 
          onSubmit={(e) => { e.preventDefault(); runExclusive('ChannelChat.handleSendMessage', () => handleSendMessage(e)); }}
          className="p-4 border-t border-slate-100 bg-white shrink-0 flex items-center gap-3"
        >
          {/* File Upload Helpers */}
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => imageInputRef.current?.click()}
              className="p-2 hover:bg-slate-100 rounded-full text-slate-500 transition-colors"
              title="Inserir imagem"
            >
              <ImageIcon className="w-5 h-5" />
            </button>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="p-2 hover:bg-slate-100 rounded-full text-slate-500 transition-colors"
              title="Anexar arquivo"
            >
              <Paperclip className="w-5 h-5" />
            </button>
          </div>

          <input 
            type="file"
            ref={imageInputRef}
            onChange={handleFileChange}
            accept="image/*"
            className="hidden"
            multiple
          />
          <input 
            type="file"
            ref={fileInputRef}
            onChange={handleFileChange}
            className="hidden"
            multiple
          />

          {/* Text input area */}
          <input
            type="text"
            value={inputText}
            onChange={(e) => handleInputChange(e.target.value)}
            placeholder={`Enviar mensagem para #${channel.name}...`}
            className="flex-1 bg-slate-100 text-xs py-2.5 px-4 rounded-full border border-transparent focus:bg-white focus:border-slate-200 outline-none transition-all placeholder:text-slate-400 text-slate-800"
          />

          <button
            type="submit"
            disabled={!inputText.trim() && attachedFiles.length === 0}
            className={cn(
              "p-2.5 rounded-full flex items-center justify-center transition-all shrink-0 cursor-pointer",
              (inputText.trim() || attachedFiles.length > 0)
                ? "bg-emerald-600 text-white shadow hover:bg-emerald-600 hover:scale-[1.02]"
                : "bg-slate-100 text-slate-400"
            )}
          >
            <Send className="w-4 h-4" />
          </button>
        </form>

      </div>

      {/* Channel details side information bar (Collapsible Drawer right side) */}
      <AnimatePresence>
        {showChannelDetails && (
          <motion.div
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: 320, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            className="hidden lg:flex flex-col bg-white border-l border-slate-100 h-full overflow-y-auto shrink-0"
          >
            {/* Header details bar */}
            <div className="p-4 border-b border-slate-100 flex items-center justify-between">
              <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                <Info className="w-4 h-4 text-slate-500" /> Sobre o Canal
              </h4>
              <button 
                onClick={() => setShowChannelDetails(false)}
                className="p-1 hover:bg-slate-100 rounded-full text-slate-500 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-6 text-left">
              {/* Channel metadata */}
              <div className="space-y-2">
                <label className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Nome</label>
                <p className="text-sm font-bold text-slate-800 flex items-center gap-1.5">
                  #{channel.name}
                </p>
                
                <label className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block mt-4">Descrição</label>
                <p className="text-xs text-slate-600 bg-slate-50 p-2.5 rounded-xl border border-slate-100 leading-relaxed">
                  {channel.description || 'Nenhuma descrição fornecida.'}
                </p>
              </div>

              {/* Related project/department */}
              <div className="border-t border-slate-100 pt-4 space-y-2">
                <label className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">Contexto do Canal</label>
                {channel.type === 'project' ? (
                  <div className="bg-emerald-50/50 p-3 rounded-xl border border-emerald-100 flex items-center gap-3">
                    <Folder className="w-8 h-8 text-emerald-600 shrink-0" />
                    <div className="min-w-0">
                      <p className="text-[11px] font-bold text-emerald-800 truncate">{channel.projectName}</p>
                      <p className="text-[9px] text-emerald-600">Canal vinculado a um projeto ativo</p>
                    </div>
                  </div>
                ) : channel.type === 'department' ? (
                  <div className="bg-slate-50/50 p-3 rounded-xl border border-slate-100 flex items-center gap-3">
                    <Hash className="w-8 h-8 text-slate-600 shrink-0" />
                    <div className="min-w-0">
                      <p className="text-[11px] font-bold text-slate-800 truncate">{channel.department}</p>
                      <p className="text-[9px] text-slate-600">Canal de comunicação departamental</p>
                    </div>
                  </div>
                ) : (
                  <div className="bg-slate-50 p-3 rounded-xl border border-slate-100 flex items-center gap-3">
                    <Users className="w-8 h-8 text-slate-500 shrink-0" />
                    <div className="min-w-0">
                      <p className="text-[11px] font-bold text-slate-800 truncate">Canal Geral</p>
                      <p className="text-[9px] text-slate-500">Comunicação corporativa geral</p>
                    </div>
                  </div>
                )}
              </div>

              {/* Members in the system */}
              <div className="border-t border-slate-100 pt-4 space-y-3">
                <label className="text-[10px] text-slate-400 font-bold uppercase tracking-wider flex items-center justify-between">
                  <span>Membros Disponíveis</span>
                  <span className="bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded text-[9px] font-bold">{users.length}</span>
                </label>
                
                <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                  {users.map((member) => (
                    <div key={member.uid} className="flex items-center gap-2 px-1">
                      {member.photoURL ? (
                        <img 
                          src={member.photoURL} 
                          alt={member.displayName} 
                          className="w-6 h-6 rounded-full object-cover"
                          referrerPolicy="no-referrer"
                        />
                      ) : (
                        <div className="w-6 h-6 rounded-full bg-slate-100 text-slate-600 flex items-center justify-center font-bold text-[10px] border border-slate-200">
                          {member.displayName.charAt(0).toUpperCase()}
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="text-[10.5px] font-semibold text-slate-700 truncate">{member.displayName}</p>
                        <p className="text-[8.5px] text-slate-400 font-medium">{ROLE_LABELS[member.role as UserRole] || member.role}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
