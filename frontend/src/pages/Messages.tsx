import React, { useState, useEffect, useRef } from 'react';
import { runExclusive } from '../lib/submitGuard';
import { 
  Send, 
  Inbox, 
  SendHorizontal, 
  Archive, 
  Star, 
  Trash2, 
  Search, 
  User,
  Plus,
  X,
  Mail,
  Paperclip,
  Image,
  File,
  Download,
  ArrowLeft,
  MailOpen,
  RefreshCw
} from 'lucide-react';
import { toast } from 'sonner';
import { checkUpload, DOCUMENT_KINDS, sanitizeFileName } from '../lib/uploadGuard';
import { collection, addDoc, onSnapshot, query, where, updateDoc, doc, serverTimestamp, deleteDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useAuth } from '../contexts/AuthContext';
import { InternalMessage, UserProfile, EmailTemplate, Channel } from '../types';
import { motion, AnimatePresence } from 'motion/react';
import PageHeader from '../components/layout/PageHeader';
import { MessageSquare as PageIcon } from 'lucide-react';
import { handleFirestoreError, OperationType, formatDateTime, formatTime, cn } from '../lib/utils';
import { FileText, Settings } from 'lucide-react';

import ConfirmationModal from '../components/ConfirmationModal';
import ChannelChat from '../components/ChannelChat';

export default function Messages() {
  const { user } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const [messages, setMessages] = useState<InternalMessage[]>([]);
  const [folder, setFolder] = useState<'inbox' | 'sent' | 'starred' | 'drafts' | 'trash'>('inbox');
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [selectedMsg, setSelectedMsg] = useState<InternalMessage | null>(null);
  const [isComposeOpen, setIsComposeOpen] = useState(false);
  const [isTemplateManagerOpen, setIsTemplateManagerOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState<string | null>(null);
  const [userSignature, setUserSignature] = useState('');
  const [userSignaturePhoto, setUserSignaturePhoto] = useState('');
  
  // Channels and group chats state hooks
  const [channels, setChannels] = useState<Channel[]>([]);
  const [activeChannelId, setActiveChannelId] = useState<string | null>(null);
  const [isCreateChannelOpen, setIsCreateChannelOpen] = useState(false);
  const [channelForm, setChannelForm] = useState({
    name: '',
    description: '',
    type: 'general' as 'project' | 'department' | 'general',
    projectId: '',
    projectName: '',
    department: ''
  });

  // Clients and projects loaded from Firestore
  const [clients, setClients] = useState<any[]>([]);
  const [projects, setProjects] = useState<any[]>([]);
  
  // Sidebar or main message list quick-filters
  const [filterClientId, setFilterClientId] = useState('');
  const [filterProjectId, setFilterProjectId] = useState('');

  const [newMessage, setNewMessage] = useState({
    recipientId: '',
    subject: '',
    content: '',
    cc: '',
    bcc: '',
    clientId: '',
    clientName: '',
    projectId: '',
    projectName: ''
  });
  const [attachedFiles, setAttachedFiles] = useState<{ name: string; type: string; size: string; url: string; isImage: boolean }[]>([]);
  const [showCc, setShowCc] = useState(false);
  const [showBcc, setShowBcc] = useState(false);
  const [activeDraftId, setActiveDraftId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [templateForm, setTemplateForm] = useState({
    title: '',
    subject: '',
    content: ''
  });

  useEffect(() => {
    if (!user) return;

    // Fetch user signature from profile
    const unsubscribeProfile = onSnapshot(doc(db, 'users', user.uid), (doc) => {
      if (doc.exists()) {
        const data = doc.data();
        setUserSignature(data.emailSignature || '');
        setUserSignaturePhoto(data.emailSignaturePhoto || '');
      }
    });

    // Messages targeting current user (recipient)
    const qReceived = query(
      collection(db, 'messages'),
      where('recipientId', '==', user.uid)
    );

    // Messages sent by current user (sender)
    const qSent = query(
      collection(db, 'messages'),
      where('senderId', '==', user.uid)
    );

    let receivedList: InternalMessage[] = [];
    let sentList: InternalMessage[] = [];

    const handleUpdate = () => {
      // Merge, deduplicate, and sort cleanly in memory
      const combined = [...receivedList, ...sentList];
      const uniqueMap = new Map();
      combined.forEach(m => {
        uniqueMap.set(m.id, m);
      });
      const msgs = Array.from(uniqueMap.values()) as InternalMessage[];
      
      msgs.sort((a, b) => {
        const getTimestamp = (val: any) => {
          if (!val) return Date.now();
          if (typeof val === 'object' && val.seconds !== undefined) return val.seconds * 1000;
          if (typeof val === 'object' && typeof val.toDate === 'function') return val.toDate().getTime();
          return new Date(val).getTime();
        };
        return getTimestamp(b.createdAt) - getTimestamp(a.createdAt);
      });

      setMessages(msgs);
    };

    const unsubscribeReceived = onSnapshot(qReceived, (snapshot) => {
      receivedList = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as InternalMessage));
      handleUpdate();
    }, (error) => {
      console.error("Error loading received messages:", error);
    });

    const unsubscribeSent = onSnapshot(qSent, (snapshot) => {
      sentList = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as InternalMessage));
      handleUpdate();
    }, (error) => {
      console.error("Error loading sent messages:", error);
    });

    // Users for recipient list
    const unsubscribeUsers = onSnapshot(collection(db, 'users'), (snapshot) => {
      setUsers(snapshot.docs.map(doc => ({ uid: doc.id, ...doc.data() } as UserProfile)));
    });

    // Email Templates
    const unsubscribeTemplates = onSnapshot(collection(db, 'email_templates'), (snapshot) => {
      setTemplates(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as EmailTemplate)));
    });

    // Clients subscription
    const unsubscribeClients = onSnapshot(collection(db, 'clients'), (snapshot) => {
      setClients(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    });

    // Analyses (agronomic projects/services) subscription
    const unsubscribeAnalyses = onSnapshot(collection(db, 'analyses'), (snapshot) => {
      setProjects(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    });

    // Communication Channels subscription with automatic bootstrapping of defaults
    const unsubscribeChannels = onSnapshot(collection(db, 'channels'), async (snapshot) => {
      const channelList = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Channel));
      setChannels(channelList);

      if (snapshot.empty && user) {
        const defaultChannels = [
          { name: 'Geral', description: 'Canal de comunicação geral para todos os colaboradores.', type: 'general', createdBy: user.uid, createdAt: serverTimestamp() },
          { name: 'Irrigação', description: 'Canal oficial para o departamento de projetos de Irrigação.', type: 'department', department: 'Irrigação', createdBy: user.uid, createdAt: serverTimestamp() },
          { name: 'Topografia', description: 'Canal oficial para serviços topográficos e de mapeamento.', type: 'department', department: 'Topografia', createdBy: user.uid, createdAt: serverTimestamp() }
        ];
        for (const chan of defaultChannels) {
          try {
            await addDoc(collection(db, 'channels'), chan);
          } catch (e) {
            console.error("Error bootstrapping channel:", e);
          }
        }
      }
    });

    return () => { 
      unsubscribeReceived();
      unsubscribeSent();
      unsubscribeUsers(); 
      unsubscribeTemplates();
      unsubscribeProfile();
      unsubscribeClients();
      unsubscribeAnalyses();
      unsubscribeChannels();
    };
  }, [user]);

  const handleCreateTemplate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    try {
      await addDoc(collection(db, 'email_templates'), {
        ...templateForm,
        createdBy: user.uid,
        createdAt: serverTimestamp()
      });
      setTemplateForm({ title: '', subject: '', content: '' });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'email_templates');
    }
  };

  const handleDeleteTemplate = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'email_templates', id));
      toast.success('Modelo excluído com sucesso.');
    } catch (error) {
       console.error(error);
       toast.error('Erro ao excluir modelo.');
    }
  };

  const handleCreateChannel = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    if (!(channelForm.name || '').trim()) {
      toast.error('O nome do canal é obrigatório.');
      return;
    }

    try {
      const selectedProject = projects.find(p => p.id === channelForm.projectId);
      const docRef = await addDoc(collection(db, 'channels'), {
        name: (channelForm.name || '').trim(),
        description: (channelForm.description || '').trim(),
        type: channelForm.type,
        projectId: channelForm.type === 'project' ? channelForm.projectId : '',
        projectName: (channelForm.type === 'project' && selectedProject) ? `${selectedProject.clientName} - ${selectedProject.type}` : '',
        department: channelForm.type === 'department' ? channelForm.department : '',
        createdBy: user.uid,
        createdAt: serverTimestamp()
      });
      
      setChannelForm({
        name: '',
        description: '',
        type: 'general',
        projectId: '',
        projectName: '',
        department: ''
      });
      setIsCreateChannelOpen(false);
      setActiveChannelId(docRef.id);
      setSelectedMsg(null);
      toast.success('Canal criado com sucesso!');
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'channels');
      toast.error('Erro ao criar o canal.');
    }
  };

  const applyTemplate = (template: EmailTemplate) => {
    setNewMessage({
      ...newMessage,
      subject: template.subject,
      content: template.content
    });
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

  const handleSendMessage = async (e?: React.FormEvent, isDraft: boolean = false) => {
    if (e) e.preventDefault();
    if (!user) return;

    if (!isDraft) {
      if (!newMessage.recipientId) {
        toast.error('Escolha o destinatário da mensagem.');
        return;
      }
      if (!(newMessage.subject || '').trim() && !(newMessage.content || '').trim()) {
        toast.error('Escreva um assunto ou o texto da mensagem antes de enviar.');
        return;
      }
    }

    // Os anexos vão dentro da própria mensagem no Firestore, que tem limite de ~1 MB por documento.
    const attachmentsSize = attachedFiles.reduce((sum, f) => sum + (f.url?.length || 0), 0);
    if (attachmentsSize > 700 * 1024) {
      toast.error('Os anexos passam do limite de ~500 KB por mensagem. Remova ou reduza algum arquivo (para documentos grandes, use a tela Documentos).');
      return;
    }

    try {
      const finalContent = (!isDraft && userSignature && !newMessage.content.includes(userSignature))
        ? `${newMessage.content}\n\n--\n${userSignature}`
        : newMessage.content;

      if (activeDraftId) {
        await updateDoc(doc(db, 'messages', activeDraftId), {
          ...newMessage,
          content: finalContent,
          isDraft,
          attachments: attachedFiles,
          createdAt: serverTimestamp()
        });
      } else {
        await addDoc(collection(db, 'messages'), {
          ...newMessage,
          content: finalContent,
          senderId: user.uid,
          senderName: user.displayName,
          senderSignaturePhoto: userSignaturePhoto,
          isRead: false,
          isDraft,
          trashBy: [],
          attachments: attachedFiles,
          createdAt: serverTimestamp()
        });
      }

      setIsComposeOpen(false);
      setNewMessage({ 
        recipientId: '', 
        subject: '', 
        content: '', 
        cc: '', 
        bcc: '', 
        clientId: '', 
        clientName: '', 
        projectId: '', 
        projectName: '' 
      });
      setAttachedFiles([]);
      setShowCc(false);
      setShowBcc(false);
      setActiveDraftId(null);
      toast.success(isDraft ? 'Rascunho salvo' : 'Mensagem enviada com sucesso');
      if (isDraft) {
        setFolder('drafts');
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'messages');
    }
  };

  const handleCloseCompose = async () => {
    const hasContent = newMessage.recipientId || newMessage.subject || newMessage.content || newMessage.cc || newMessage.bcc || attachedFiles.length > 0;
    if (hasContent) {
      await handleSendMessage(undefined, true);
    } else {
      setIsComposeOpen(false);
      setNewMessage({ 
        recipientId: '', 
        subject: '', 
        content: '', 
        cc: '', 
        bcc: '', 
        clientId: '', 
        clientName: '', 
        projectId: '', 
        projectName: '' 
      });
      setAttachedFiles([]);
      setShowCc(false);
      setShowBcc(false);
      setActiveDraftId(null);
    }
  };

  const handleDiscardCompose = async () => {
    try {
      if (activeDraftId) {
        await deleteDoc(doc(db, 'messages', activeDraftId));
        toast.success('Rascunho descartado');
      } else {
        toast.info('Mensagem descartada');
      }
    } catch (error) {
      console.error(error);
    }
    setIsComposeOpen(false);
    setNewMessage({ 
      recipientId: '', 
      subject: '', 
      content: '', 
      cc: '', 
      bcc: '', 
      clientId: '', 
      clientName: '', 
      projectId: '', 
      projectName: '' 
    });
    setAttachedFiles([]);
    setShowCc(false);
    setShowBcc(false);
    setActiveDraftId(null);
  };

  const moveToTrash = async (msgId: string) => {
    if (!user) return;
    try {
      const msg = messages.find(m => m.id === msgId) || selectedMsg;
      if (!msg) return;
      
      const newTrashBy = [...(msg.trashBy || []), user.uid];
      await updateDoc(doc(db, 'messages', msgId), { trashBy: newTrashBy });
      toast.success('Mensagem movida para a lixeira');
      
      if (selectedMsg?.id === msgId) {
        setSelectedMsg(null);
      }
    } catch (error) {
      console.error(error);
    }
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    try {
      await updateDoc(doc(db, 'users', user.uid), {
        emailSignature: userSignature,
        emailSignaturePhoto: userSignaturePhoto
      });
      setIsSettingsOpen(false);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'users');
    }
  };

  const handleToggleReaction = async (msgId: string, emoji: string) => {
    if (!user) return;
    const msg = messages.find(m => m.id === msgId) || selectedMsg;
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
      await updateDoc(doc(db, 'messages', msgId), { reactions: updatedReactions });
    } catch (error) {
       console.error(error);
    }
  };

  const markAsRead = async (msg: InternalMessage) => {
    if (!user || msg.isRead || msg.recipientId !== user.uid) return;
    try {
      await updateDoc(doc(db, 'messages', msg.id), { isRead: true });
    } catch (error) {
       console.error(error);
    }
  };

  const toggleStar = async (msgId: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (!user) return;
    try {
      const msg = messages.find(m => m.id === msgId) || selectedMsg;
      if (!msg) return;
      const currentStarredBy = msg.starredBy || [];
      const isStarred = currentStarredBy.includes(user.uid);
      const newStarredBy = isStarred 
        ? currentStarredBy.filter(uid => uid !== user.uid)
        : [...currentStarredBy, user.uid];
      
      await updateDoc(doc(db, 'messages', msgId), { starredBy: newStarredBy });
      toast.success(isStarred ? 'Estrela removida' : 'Mensagem marcada com estrela');
      
      if (selectedMsg?.id === msgId) {
        setSelectedMsg(prev => prev ? { ...prev, starredBy: newStarredBy } : null);
      }
    } catch (error) {
      console.error(error);
      toast.error('Erro ao atualizar estrela');
    }
  };

  const toggleReadStatus = async (msgId: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (!user) return;
    try {
      const msg = messages.find(m => m.id === msgId) || selectedMsg;
      if (!msg) return;
      const newReadState = !msg.isRead;
      await updateDoc(doc(db, 'messages', msgId), { isRead: newReadState });
      toast.success(newReadState ? 'Marcada como lida' : 'Marcada como não lida');
      
      if (selectedMsg?.id === msgId) {
        setSelectedMsg(prev => prev ? { ...prev, isRead: newReadState } : null);
      }
    } catch (error) {
      console.error(error);
      toast.error('Erro ao atualizar status de leitura');
    }
  };

  const EMOJIS = ['👍', '❤️', '😄', '😮', '😢', '🔥', '👏', '✅'];

  // Filter and compute folder lists
  const unreadInboxCount = messages.filter(m => m.recipientId === user?.uid && !m.isRead && !m.isDraft && !(m.trashBy || []).includes(user?.uid || "")).length;
  const draftsCount = messages.filter(m => m.senderId === user?.uid && m.isDraft && !(m.trashBy || []).includes(user?.uid || "")).length;

  const displayedMessages = messages.filter(m => {
    const isUserTrash = (m.trashBy || []).includes(user?.uid || "");
    const isUserStarred = (m.starredBy || []).includes(user?.uid || "");
    
    if (folder === 'trash') {
      return isUserTrash;
    }
    
    // Non-trash folders should NEVER show trashed messages
    if (isUserTrash) return false;

    if (folder === 'inbox') {
      return m.recipientId === user?.uid && !m.isDraft;
    }
    if (folder === 'sent') {
      return m.senderId === user?.uid && !m.isDraft;
    }
    if (folder === 'starred') {
      return isUserStarred && !m.isDraft;
    }
    if (folder === 'drafts') {
      return m.senderId === user?.uid && m.isDraft;
    }
    return false;
  });

  const filteredMessages = displayedMessages.filter(m => {
    // 1. Client history filter
    if (filterClientId && m.clientId !== filterClientId) {
      return false;
    }
    // 2. Project/Service history filter
    if (filterProjectId && m.projectId !== filterProjectId) {
      return false;
    }

    if (!searchTerm) return true;
    const term = searchTerm.toLowerCase();
    const senderObj = users.find(u => u.uid === m.senderId);
    const senderNameVal = senderObj?.displayName || m.senderName || '';
    return (
      (m.subject || '').toLowerCase().includes(term) ||
      (m.content || '').toLowerCase().includes(term) ||
      senderNameVal.toLowerCase().includes(term) ||
      (m.clientName || '').toLowerCase().includes(term) ||
      (m.projectName || '').toLowerCase().includes(term)
    );
  });

  const sidebarFolders = [
    { id: 'inbox', label: 'Caixa de Entrada', icon: Inbox, count: unreadInboxCount },
    { id: 'starred', label: 'Com estrela', icon: Star, count: messages.filter(m => (m.starredBy || []).includes(user?.uid || "") && !(m.trashBy || []).includes(user?.uid || "") && !m.isDraft).length },
    { id: 'sent', label: 'Enviados', icon: SendHorizontal, count: 0 },
    { id: 'drafts', label: 'Rascunhos', icon: FileText, count: draftsCount },
    { id: 'trash', label: 'Lixeira', icon: Trash2, count: 0 }
  ];

  return (
    <div className="flex flex-col gap-4 h-full">
      <PageHeader icon={PageIcon} title="Mensagens" subtitle="E-mail interno da equipe e canais de conversa" />
      <div className="flex flex-1 min-h-0 bg-slate-50 p-0 overflow-hidden text-slate-800 rounded-2xl">
      {/* Left Navigation Rails - exactly modern Gmail style! */}
      <div className="w-64 bg-slate-50 pr-2 pl-3 py-4 flex flex-col gap-1 shrink-0 select-none hidden md:flex">
        {/* Gmail written compose button */}
        <button 
          onClick={() => {
            setNewMessage({ recipientId: '', subject: '', content: '', cc: '', bcc: '' });
            setAttachedFiles([]);
            setShowCc(false);
            setShowBcc(false);
            setActiveDraftId(null);
            setIsComposeOpen(true);
          }}
          className="flex items-center gap-3 bg-emerald-100 hover:bg-emerald-200 text-slate-900 font-semibold text-sm px-6 py-4 rounded-2xl shadow-sm hover:shadow hover:scale-[1.01] transition-all self-start mb-6 mt-2 select-none"
        >
          <Plus className="w-5 h-5 stroke-[2.5]" />
          <span>Escrever</span>
        </button>

        {/* Folders List */}
        <div className="flex flex-col gap-0.5">
          {sidebarFolders.map(f => {
            const IconComponent = f.icon;
            const isActive = folder === f.id && !activeChannelId;
            return (
              <button
                key={f.id}
                onClick={() => { setFolder(f.id as any); setSelectedMsg(null); setActiveChannelId(null); }}
                className={cn(
                  "flex items-center justify-between px-6 py-2 rounded-full text-xs font-semibold transition-all group w-full text-left",
                  isActive 
                    ? "bg-emerald-50 text-emerald-600" 
                    : "text-slate-600 hover:bg-slate-100"
                )}
              >
                <div className="flex items-center gap-3">
                  <IconComponent className={cn("w-4 h-4", isActive ? "text-emerald-600" : "text-slate-500")} />
                  <span>{f.label}</span>
                </div>
                {f.count > 0 && (
                  <span className={cn(
                    "text-[10.5px] px-2 py-0.5 rounded-full font-bold",
                    isActive ? "bg-slate-100 text-emerald-600" : "bg-slate-200/60 text-slate-600"
                  )}>
                    {f.count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Channels Section header */}
        <div className="mt-4 pt-3 border-t border-slate-200/60 px-4 mb-2 flex items-center justify-between shrink-0">
          <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Canais de Grupo</span>
          <button 
            onClick={() => setIsCreateChannelOpen(true)}
            className="p-1 hover:bg-slate-200 rounded text-slate-500 hover:text-slate-600 transition-colors cursor-pointer"
            title="Criar canal"
          >
            <Plus className="w-3.5 h-3.5 stroke-[2.5]" />
          </button>
        </div>

        {/* Channels list scrollable box */}
        <div className="flex flex-col gap-0.5 max-h-[180px] overflow-y-auto pr-1">
          {channels.map(chan => {
            const isSelected = activeChannelId === chan.id;
            return (
              <button
                key={chan.id}
                onClick={() => {
                  setActiveChannelId(chan.id);
                  setSelectedMsg(null);
                }}
                className={cn(
                  "flex items-center gap-2.5 px-6 py-1.5 rounded-full text-xs font-semibold transition-all w-full text-left truncate group",
                  isSelected 
                    ? "bg-emerald-50 text-emerald-600" 
                    : "text-slate-600 hover:bg-slate-100"
                )}
              >
                <span className={cn("text-[13px] font-bold", isSelected ? "text-emerald-600" : "text-slate-400 group-hover:text-slate-500")}>#</span>
                <span className="truncate">{chan.name}</span>
              </button>
            );
          })}
        </div>

        {/* Separate utilities division */}
        <div className="mt-auto px-4 py-3 border-t border-slate-200/80 flex flex-col gap-1">
          <button 
            onClick={() => setIsSettingsOpen(true)}
            className="flex items-center gap-3 py-2 px-3 text-slate-600 hover:bg-slate-100 rounded-xl transition-all text-left text-xs font-medium"
          >
            <Settings className="w-4 h-4 text-slate-400" />
            <span>Assinatura</span>
          </button>
          <button 
            onClick={() => setIsTemplateManagerOpen(true)}
            className="flex items-center gap-3 py-2 px-3 text-slate-600 hover:bg-slate-100 rounded-xl transition-all text-left text-xs font-medium"
          >
            <FileText className="w-4 h-4 text-slate-400" />
            <span>Gerenciar Modelos</span>
          </button>
        </div>
      </div>

      {/* Main Mailbox Content area */}
      <div className="flex-1 bg-white md:rounded-3xl border border-slate-200/50 my-2 mr-2 shadow-sm overflow-hidden flex flex-col">
        {/* Top filter and header status row */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 bg-white">
          <div className="flex items-center gap-3 w-full max-w-lg">
            {/* Mobile directory drawer icon (when small screen, toggle folder list) */}
            <div className="md:hidden flex bg-slate-100 p-1 rounded-xl gap-1 overflow-x-auto">
              {sidebarFolders.map(f => (
                <button
                  key={f.id}
                  onClick={() => { setFolder(f.id as any); setSelectedMsg(null); setActiveChannelId(null); }}
                  className={cn(
                    "px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase whitespace-nowrap transition-all",
                    (folder === f.id && !activeChannelId) ? "bg-white text-emerald-600 shadow-sm" : "text-slate-500"
                  )}
                >
                  {f.label.split(' ')[0]}
                </button>
              ))}
            </div>

            {/* General search view */}
            <div className="relative flex-1 hidden md:block">
              <input 
                type="text" 
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Pesquisar no correio..." 
                className="w-full bg-slate-100 text-xs py-2 pl-10 pr-4 rounded-full border border-transparent focus:bg-white focus:border-slate-200 focus:ring-1 focus:ring-emerald-400 outline-none transition-all placeholder:text-slate-400 text-slate-800"
              />
              <Search className="w-4 h-4 absolute left-3.5 top-2.5 text-slate-400" />
              {searchTerm && (
                <button onClick={() => setSearchTerm('')} className="absolute right-3.5 top-2 rounded-full p-0.5 hover:bg-slate-200">
                  <X className="w-3 h-3 text-slate-500" />
                </button>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Refresh / Actions */}
            <button
              onClick={() => { setSelectedMsg(null); setSearchTerm(''); }}
              className="p-1.5 hover:bg-slate-100 rounded-full text-slate-500 transition-colors"
              title="Atualizar pasta"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
            <span className="text-[11px] text-slate-400 font-medium whitespace-nowrap pr-1">
              {filteredMessages.length} mensagem(ns)
            </span>
            <button
              onClick={() => {
                setNewMessage({ recipientId: '', subject: '', content: '', cc: '', bcc: '' });
                setAttachedFiles([]);
                setShowCc(false);
                setShowBcc(false);
                setActiveDraftId(null);
                setIsComposeOpen(true);
              }}
              className="md:hidden w-8 h-8 bg-emerald-100 text-slate-900 rounded-full flex items-center justify-center hover:bg-emerald-200 transition-colors"
              title="Escrever"
            >
              <Plus className="w-4 h-4 stroke-[2.5]" />
            </button>
          </div>
        </div>

        {/* Mobile search bar and channels badges */}
        <div className="p-3 bg-slate-50/50 border-b border-slate-100 md:hidden flex flex-col gap-2">
          <div className="relative">
            <input 
              type="text" 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Pesquisar mensagens..." 
              className="w-full bg-slate-100 text-xs py-2 pl-10 pr-4 rounded-lg border border-transparent outline-none text-slate-800"
            />
            <Search className="w-4 h-4 absolute left-3 top-2 text-slate-400" />
          </div>
          {channels.length > 0 && (
            <div className="flex items-center gap-1.5 overflow-x-auto py-0.5 select-none no-scrollbar">
              <span className="text-[9px] text-slate-400 font-bold uppercase tracking-wider shrink-0">Canais:</span>
              {channels.map(chan => {
                const isSelected = activeChannelId === chan.id;
                return (
                  <button
                    key={chan.id}
                    onClick={() => {
                      setActiveChannelId(chan.id);
                      setSelectedMsg(null);
                    }}
                    className={cn(
                      "px-2 py-0.5 rounded-full text-[9px] font-bold transition-all whitespace-nowrap",
                      isSelected ? "bg-slate-100 text-emerald-600 border border-slate-200" : "bg-white text-slate-600 border border-slate-200/60"
                    )}
                  >
                    #{chan.name}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Double layout splitter or detail switcher */}
        <div className="flex-1 overflow-hidden flex flex-col md:flex-row bg-slate-50">
          {activeChannelId && channels.find(c => c.id === activeChannelId) ? (
            <ChannelChat 
              channel={channels.find(c => c.id === activeChannelId)!}
              users={users}
              onBack={() => setActiveChannelId(null)}
            />
          ) : (
            <>
              {/* Section 1: Emails list */}
          <div className={cn(
            "flex-1 overflow-y-auto flex flex-col bg-white",
            selectedMsg ? "hidden lg:flex lg:w-96 lg:max-w-md lg:border-r lg:border-slate-100" : "flex"
          )}>
            {/* Histórico Filter Bar */}
            <div className="px-4 py-2 bg-slate-50 border-b border-slate-100 flex flex-wrap items-center gap-3 text-xs select-none">
              <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider flex items-center gap-1 shrink-0">
                <Settings className="w-3.5 h-3.5" /> Histórico:
              </span>
              <div className="flex items-center gap-1 min-w-0">
                <span className="text-[10px] text-slate-500 font-medium">Cliente:</span>
                <select
                  value={filterClientId}
                  onChange={(e) => setFilterClientId(e.target.value)}
                  className="bg-white border border-slate-200 focus:border-emerald-400 rounded-lg text-[10px] font-bold text-slate-650 px-1.5 py-0.5 outline-none transition-all max-w-[100px] truncate cursor-pointer"
                >
                  <option value="">Todos</option>
                  {clients.map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>

              <div className="flex items-center gap-1 min-w-0">
                <span className="text-[10px] text-slate-500 font-medium">Projeto:</span>
                <select
                  value={filterProjectId}
                  onChange={(e) => setFilterProjectId(e.target.value)}
                  className="bg-white border border-slate-200 focus:border-emerald-400 rounded-lg text-[10px] font-bold text-slate-650 px-1.5 py-0.5 outline-none transition-all max-w-[100px] truncate cursor-pointer"
                >
                  <option value="">Todos</option>
                  {projects.map(p => (
                    <option key={p.id} value={p.id}>{p.type}</option>
                  ))}
                </select>
              </div>

              {(filterClientId || filterProjectId) && (
                <button
                  onClick={() => { setFilterClientId(''); setFilterProjectId(''); }}
                  className="p-1 text-rose-500 hover:text-rose-700 font-bold text-[9px] uppercase tracking-wider hover:bg-rose-50 rounded transition-colors ml-auto cursor-pointer"
                >
                  Limpar
                </button>
              )}
            </div>

            {filteredMessages.length === 0 ? (
              <div className="flex-grow flex flex-col items-center justify-center text-slate-400 gap-3 py-16">
                <Inbox className="w-12 h-12 stroke-[1.2] opacity-40 text-slate-400" />
                <div className="text-center">
                  <p className="text-xs font-semibold text-slate-500">Nenhuma mensagem encontrada</p>
                  <p className="text-[10px] text-slate-400 mt-0.5">Esta pasta está vazia ou nenhum item corresponde ao filtro</p>
                </div>
              </div>
            ) : (
              <div className="flex flex-col">
                {filteredMessages.map(msg => {
                  const isStarred = (msg.starredBy || []).includes(user?.uid || "");
                  const isUnread = !msg.isRead && msg.recipientId === user?.uid;
                  return (
                    <div 
                      key={msg.id}
                      onClick={() => { setSelectedMsg(msg); markAsRead(msg); }}
                      className={cn(
                        "group flex items-center border-b border-slate-100 py-2.5 px-4 gap-3 text-xs cursor-pointer transition-all relative select-none",
                        selectedMsg?.id === msg.id 
                          ? "bg-emerald-50 text-slate-900 font-semibold" 
                          : isUnread 
                            ? "bg-white text-slate-900 font-bold hover:bg-slate-50/80 animate-fade-in" 
                            : "bg-slate-50/10 text-slate-600 hover:bg-slate-100/50"
                      )}
                    >
                      {/* Active Left indicator */}
                      {isUnread && (
                        <div className="absolute left-0 top-0 bottom-0 w-1 bg-emerald-600" />
                      )}

                      {/* Select state checkbox & Star */}
                      <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
                        <button
                          onClick={(e) => toggleStar(msg.id, e)}
                          className="p-1 hover:bg-slate-200/60 rounded text-slate-300 hover:text-amber-400 transition-colors"
                        >
                          <Star className={cn("w-4 h-4", isStarred ? "text-amber-400 fill-amber-400 animate-pulse" : "text-slate-300")} />
                        </button>
                      </div>

                      {/* Mail Row Sender name */}
                      <div className="w-28 sm:w-36 shrink-0 truncate text-left font-sans">
                        <span className={cn(isUnread ? "text-slate-800 font-bold" : "text-slate-600 font-medium")}>
                          {msg.senderId === user?.uid 
                            ? `Para: ${users.find(u => u.uid === msg.recipientId)?.displayName || 'Carregando...'}` 
                            : msg.senderName
                          }
                        </span>
                      </div>

                      {/* Subject and preview snippet */}
                      <div className="flex-1 min-w-0 pr-4 text-left flex flex-col gap-0.5 justify-center bg-transparent">
                        <div className="flex items-baseline gap-1">
                          <span className={cn(isUnread ? "text-slate-900 font-bold" : "text-slate-700 font-medium", "truncate shrink-0 max-w-[120px] sm:max-w-xs")}>
                            {msg.subject || '(Sem assunto)'}
                          </span>
                          <span className="text-slate-400 font-normal truncate shrink text-[11px]">
                            — {(msg.content || '').replace(/\s+/g, ' ')}
                          </span>
                        </div>
                        {/* Tags */}
                        {(msg.clientName || msg.projectName) && (
                          <div className="flex items-center gap-1 flex-wrap mt-0.5 select-none">
                            {msg.clientName && (
                              <span className="px-1.5 py-0.5 bg-slate-50 border border-slate-100 text-slate-600 rounded text-[9px] font-bold truncate max-w-[100px]" title={`Cliente: ${msg.clientName}`}>
                                👤 {msg.clientName}
                              </span>
                            )}
                            {msg.projectName && (
                              <span className="px-1.5 py-0.5 bg-emerald-50 border border-emerald-100 text-emerald-750 rounded text-[9px] font-bold truncate max-w-[100px]" title={`Projeto: ${msg.projectName}`}>
                                📄 {msg.projectName.split(' (')[0]}
                              </span>
                            )}
                          </div>
                        )}
                      </div>

                      {/* Attachment icons list */}
                      {msg.attachments && msg.attachments.length > 0 && (
                        <Paperclip className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                      )}

                      {/* Status date or Hover actions */}
                      <div className="w-16 shrink-0 text-right relative h-5 flex items-center justify-end">
                        {/* Normal Time view */}
                        <span className="group-hover:invisible text-[10px] text-slate-400 font-medium font-mono">
                          {formatTime(msg.createdAt)}
                        </span>

                        {/* Hover actions menu exactly like Gmail */}
                        <div className="hidden group-hover:flex items-center gap-0.5 absolute right-0 bg-white shadow-md border border-slate-200/60 rounded px-1 py-0.5 z-10" onClick={e => e.stopPropagation()}>
                          <button
                            onClick={() => moveToTrash(msg.id)}
                            className="p-1 hover:bg-rose-50 text-slate-400 hover:text-rose-500 rounded transition-colors"
                            title="Mover para a lixeira"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                          
                          {/* Read Toggle */}
                          {msg.recipientId === user?.uid && (
                            <button
                              onClick={() => toggleReadStatus(msg.id)}
                              className="p-1 hover:bg-slate-100 text-slate-400 hover:text-slate-500 rounded transition-colors"
                              title={msg.isRead ? "Marcar como não lida" : "Marcar como lida"}
                            >
                              {msg.isRead ? <Mail className="w-3.5 h-3.5" /> : <MailOpen className="w-3.5 h-3.5" />}
                            </button>
                          )}

                          {/* Star Toggle helper */}
                          <button
                            onClick={() => toggleStar(msg.id)}
                            className="p-1 hover:bg-slate-100 text-slate-300 hover:text-amber-500 rounded transition-all"
                            title="Sinalizar"
                          >
                            <Star className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>

                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Section 2: Selected Email details render */}
          <div className={cn(
            "flex-1 overflow-y-auto bg-slate-50 flex flex-col",
            !selectedMsg ? "hidden lg:flex" : "flex"
          )}>
            {selectedMsg ? (
              <div className="p-6 h-full flex flex-col">
                
                {/* Gmail-like Top Header Toolbar */}
                <div className="flex items-center gap-3 justify-between border-b border-slate-150 pb-3 mb-5 select-none bg-transparent">
                  <div className="flex items-center gap-1.55">
                    {/* Return arrow */}
                    <button
                      onClick={() => setSelectedMsg(null)}
                      className="p-2 hover:bg-slate-200 rounded-full text-slate-600 transition-all border border-slate-200/50 bg-white"
                      title="Voltar para a lista"
                    >
                      <ArrowLeft className="w-4 h-4" />
                    </button>

                    <div className="h-5 w-px bg-slate-200 mx-1"></div>

                    {/* Move to Trash */}
                    <button
                      onClick={() => { moveToTrash(selectedMsg.id); setSelectedMsg(null); }}
                      className="p-2 hover:bg-slate-200 rounded-full text-slate-500 hover:text-rose-500 transition-all border border-slate-200/50 bg-white"
                      title="Excluir"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>

                    {/* Unread Toggle */}
                    {selectedMsg.recipientId === user?.uid && (
                      <button
                        onClick={() => { toggleReadStatus(selectedMsg.id); setSelectedMsg(null); }}
                        className="p-2 hover:bg-slate-200 rounded-full text-slate-500 hover:text-slate-600 transition-all border border-slate-200/50 bg-white"
                        title="Marcar como não lida"
                      >
                        <Mail className="w-4 h-4" />
                      </button>
                    )}

                    {/* Star Toggle */}
                    <button
                      onClick={() => toggleStar(selectedMsg.id)}
                      className="p-2 hover:bg-slate-200 rounded-full text-slate-500 hover:text-amber-500 transition-all border border-slate-200/50 bg-white"
                      title="Sinalizar com estrela"
                    >
                      <Star className={cn("w-4 h-4", (selectedMsg.starredBy || []).includes(user?.uid || "") ? "text-amber-500 fill-amber-500 animate-pulse" : "text-slate-400")} />
                    </button>
                  </div>

                  <div className="text-[10px] text-slate-400 font-mono tracking-wide">
                    {formatDateTime(selectedMsg.createdAt)}
                  </div>
                </div>

                {/* Email Subject Area */}
                <div className="mb-4">
                  <h2 className="text-lg font-bold font-sans text-slate-800 tracking-tight flex items-center gap-2">
                    {selectedMsg.subject || '(Sem assunto)'}
                    {selectedMsg.isDraft && (
                      <span className="px-2 py-0.5 bg-rose-100 text-rose-750 font-bold font-mono rounded text-[9px] uppercase">
                        Rascunho
                      </span>
                    )}
                  </h2>
                </div>

                {/* Sender/Recipient Circle & Meta block */}
                <div className="flex items-start justify-between mb-4 pb-4 border-b border-slate-100">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-emerald-600/10 text-emerald-600 font-bold text-sm flex items-center justify-center shrink-0">
                      {selectedMsg.senderName ? selectedMsg.senderName[0].toUpperCase() : 'U'}
                    </div>
                    <div className="flex flex-col text-left">
                      <div className="flex items-baseline gap-1.5 flex-wrap">
                        <span className="text-xs font-bold text-slate-700">{selectedMsg.senderName}</span>
                        <span className="text-[10px] text-slate-400">
                          &lt;{users.find(u => u.uid === selectedMsg.senderId)?.email || 'agrogestaopro@gmail.com'}&gt;
                        </span>
                      </div>
                      <div className="text-[10.5px] text-slate-500 mt-0.5">
                        <span>Para: </span>
                        <span className="font-semibold text-slate-600">
                          {selectedMsg.recipientId === user?.uid ? 'Mim' : users.find(u => u.uid === selectedMsg.recipientId)?.displayName || 'Destinatário'}
                        </span>
                        {selectedMsg.cc && <span className="ml-2 text-slate-400">Cc: {selectedMsg.cc}</span>}
                        {selectedMsg.bcc && <span className="ml-2 text-slate-400">Cco: {selectedMsg.bcc}</span>}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Associated metadata tags */}
                {(selectedMsg.clientName || selectedMsg.projectName) && (
                  <div className="flex flex-wrap items-center gap-2 mb-4 p-2 bg-slate-100/50 rounded-xl border border-slate-150 text-left select-none animate-fade-in">
                    <span className="text-[9px] text-slate-400 font-bold uppercase tracking-wider ml-1">Associações de Histórico:</span>
                    {selectedMsg.clientName && (
                      <div className="flex items-center gap-1 px-2.5 py-1 bg-slate-50 border border-slate-150 text-slate-700 rounded-lg text-[10px] font-bold">
                        <User className="w-3 h-3 text-slate-500" />
                        <span>Cliente: {selectedMsg.clientName}</span>
                      </div>
                    )}
                    {selectedMsg.projectName && (
                      <div className="flex items-center gap-1 px-2.5 py-1 bg-emerald-50 border border-emerald-155 text-emerald-750 rounded-lg text-[10px] font-bold">
                        <FileText className="w-3 h-3 text-emerald-550" />
                        <span>Projeto: {selectedMsg.projectName}</span>
                      </div>
                    )}
                  </div>
                )}

                {/* Body Message text area */}
                <div className="flex-1 overflow-y-auto bg-white rounded-2xl p-6 border border-slate-200/60 shadow-sm flex flex-col justify-between min-h-[250px] text-slate-700 text-xs leading-relaxed text-left">
                  <div className="whitespace-pre-wrap font-sans">{selectedMsg.content}</div>

                  {/* Signatures and Photos */}
                  {selectedMsg.senderSignaturePhoto && (
                    <div className="mt-8 border-t border-slate-100 pt-4 self-start">
                      <img
                        src={selectedMsg.senderSignaturePhoto}
                        alt="Assinatura"
                        className="max-w-[150px] max-h-[80px] rounded-lg object-contain border border-slate-100 bg-white"
                        referrerPolicy="no-referrer"
                      />
                    </div>
                  )}

                  {/* Visual attachments render list */}
                  {selectedMsg.attachments && selectedMsg.attachments.length > 0 && (
                    <div className="mt-8 border-t border-slate-100 pt-4">
                      <h4 className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-3 flex items-center gap-1.5 select-none">
                        <Paperclip className="w-3.5 h-3.5 text-slate-400" />
                        Anexos ({selectedMsg.attachments.length})
                      </h4>
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                        {selectedMsg.attachments.map((attach, index) => (
                          <div key={index} className="flex flex-col border border-slate-200/60 rounded-xl bg-white overflow-hidden shadow-sm hover:shadow transition-all group">
                            {attach.isImage ? (
                              <div className="h-24 bg-slate-50 relative flex items-center justify-center overflow-hidden">
                                <img src={attach.url} alt={attach.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform" />
                                <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                  <a href={attach.url} download={attach.name} className="p-2 bg-white rounded-full text-slate-700 hover:scale-110 transition-transform shadow">
                                    <Download className="w-3.5 h-3.5" />
                                  </a>
                                </div>
                              </div>
                            ) : (
                              <div className="h-24 bg-slate-50 flex flex-col items-center justify-center p-3 text-center border-b border-slate-100">
                                <File className="w-7 h-7 text-slate-400 mb-1" />
                                <span className="text-[10px] text-slate-600 font-medium truncate max-w-full w-full">{attach.name}</span>
                              </div>
                            )}
                            <div className="p-2 flex items-center justify-between text-[10px] text-slate-500 bg-slate-50/50">
                              <span className="truncate font-medium flex-1 mr-2">{attach.name}</span>
                              <span className="shrink-0 text-slate-400 font-mono text-[9px]">{attach.size}</span>
                            </div>
                            {!attach.isImage && (
                              <div className="px-2 pb-2 bg-slate-50/50">
                                <a href={attach.url} download={attach.name} className="w-full h-6 rounded bg-slate-100 border border-slate-200/60 flex items-center justify-center gap-1 hover:bg-white text-[9px] text-slate-600 font-bold transition-all">
                                  <Download className="w-3 h-3" /> Baixar
                                </a>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Responder / Forward Footer Buttons */}
                <div className="mt-5 pt-4 border-t border-slate-100 flex gap-3">
                  {selectedMsg.isDraft ? (
                    <button
                      onClick={() => {
                        setNewMessage({
                          recipientId: selectedMsg.recipientId,
                          subject: selectedMsg.subject,
                          content: selectedMsg.content,
                          cc: (selectedMsg as any).cc || '',
                          bcc: (selectedMsg as any).bcc || '',
                        });
                        setAttachedFiles(selectedMsg.attachments || []);
                        setActiveDraftId(selectedMsg.id); // set active draft key!
                        if ((selectedMsg as any).cc) setShowCc(true);
                        if ((selectedMsg as any).bcc) setShowBcc(true);
                        setIsComposeOpen(true);
                      }}
                      className="flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-all shadow-sm font-sans"
                    >
                      <FileText className="w-4 h-4" /> Continuar Editando Rascunho
                    </button>
                  ) : (
                    <>
                      <button
                        onClick={() => {
                          setNewMessage({
                            recipientId: selectedMsg.senderId,
                            subject: selectedMsg.subject.startsWith('Re:') ? selectedMsg.subject : `Re: ${selectedMsg.subject}`,
                            content: `\n\nEm ${formatDateTime(selectedMsg.createdAt)}, ${selectedMsg.senderName} escreveu:\n> ${(selectedMsg.content || '').split('\n').join('\n> ')}`,
                            cc: '',
                            bcc: ''
                          });
                          setActiveDraftId(null);
                          setIsComposeOpen(true);
                        }}
                        className="py-2.5 px-6 border border-slate-300 text-slate-600 hover:bg-slate-50 bg-white shadow-sm rounded-xl text-xs font-semibold flex items-center gap-2 transition-all"
                      >
                        <Send className="w-3.5 h-3.5 rotate-45 transform" /> Responder
                      </button>

                      {folder === 'trash' && (
                        <button
                          onClick={async () => {
                            await deleteDoc(doc(db, 'messages', selectedMsg.id));
                            setSelectedMsg(null);
                            toast.success('Mensagem deletada permanentemente');
                          }}
                          className="py-2.5 px-6 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-semibold flex items-center gap-2 transition-all ml-auto self-start shadow-sm"
                        >
                          <Trash2 className="w-4 h-4" /> Excluir Definitivamente
                        </button>
                      )}
                    </>
                  )}
                </div>

              </div>
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-slate-300 gap-4 select-none">
                <div className="p-4 bg-white rounded-full border border-slate-100 shadow-sm">
                  <Mail className="w-12 h-12 text-slate-300 stroke-[1.2]" />
                </div>
                <div>
                  <p className="text-xs font-semibold text-slate-500">Selecione um e-mail para visualizar</p>
                  <p className="text-[10px] text-slate-400 mt-1">Clique em qualquer item da lista à esquerda para ler seu conteúdo aqui.</p>
                </div>
              </div>
            )}
          </div>
          </>
          )}

        </div>
      </div>

      {/* Template Manager Modal */}
      <AnimatePresence>
        {isTemplateManagerOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-slate-900/40 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="relative glass-card w-full max-w-4xl p-8 shadow-2xl flex flex-col max-h-[80vh]"
            >
              <div className="flex justify-between items-center mb-6">
                <div className="flex items-center gap-2">
                  <FileText className="w-6 h-6 text-emerald-600" />
                  <h3 className="text-xl font-display font-bold">Gerenciar Modelos de Email</h3>
                </div>
                <button onClick={() => setIsTemplateManagerOpen(false)} className="p-2 hover:bg-slate-100 rounded-full">
                   <X className="w-5 h-5 text-slate-400" />
                </button>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 overflow-hidden">
                {/* Create Form */}
                <div className="space-y-4">
                  <h4 className="text-sm font-bold text-slate-700">Criar Novo Modelo</h4>
                  <form onSubmit={(e) => { e.preventDefault(); runExclusive('Messages.handleCreateTemplate', () => handleCreateTemplate(e)); }} className="space-y-4">
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-bold text-slate-400 uppercase">Título Interno</label>
                      <input 
                        required
                        type="text" 
                        value={templateForm.title}
                        onChange={(e) => setTemplateForm({...templateForm, title: e.target.value})}
                        placeholder="Ex: Cobrança de Análise" 
                        className="w-full glass-input"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-bold text-slate-400 uppercase">Assunto do Email</label>
                      <input 
                        required
                        type="text" 
                        value={templateForm.subject}
                        onChange={(e) => setTemplateForm({...templateForm, subject: e.target.value})}
                        placeholder="Assunto que o destinatário verá" 
                        className="w-full glass-input"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-bold text-slate-400 uppercase">Mensagem Padrão</label>
                      <textarea 
                        required
                        rows={6}
                        value={templateForm.content}
                        onChange={(e) => setTemplateForm({...templateForm, content: e.target.value})}
                        placeholder="Conteúdo do modelo..." 
                        className="w-full glass-input resize-none"
                      />
                    </div>
                    <button 
                      type="submit"
                      className="w-full py-3 bg-emerald-600 text-white rounded-xl font-bold hover:bg-emerald-700 transition-colors"
                    >
                      Salvar Modelo
                    </button>
                  </form>
                </div>

                {/* List of Templates */}
                <div className="flex flex-col gap-4 overflow-hidden">
                  <h4 className="text-sm font-bold text-slate-700">Modelos Salvos</h4>
                  <div className="flex-1 overflow-y-auto space-y-3 pr-2">
                    {templates.map(tmp => (
                      <div key={tmp.id} className="p-4 bg-white/40 border border-white/60 rounded-2xl hover:border-emerald-500/30 transition-all group">
                        <div className="flex justify-between items-start mb-1">
                          <span className="font-bold text-slate-800 text-sm">{tmp.title}</span>
                          <button 
                             onClick={() => handleDeleteTemplate(tmp.id)}
                             className="text-slate-300 hover:text-rose-500 transition-colors"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                        <div className="text-[10px] text-slate-500 font-medium mb-2">{tmp.subject}</div>
                        <div className="text-[10px] text-slate-400 line-clamp-2 italic">"{tmp.content}"</div>
                      </div>
                    ))}
                    {templates.length === 0 && (
                      <div className="text-center py-10 text-slate-400 text-xs italic">
                        Nenhum modelo cadastrado.
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Create Channel Modal */}
      <AnimatePresence>
        {isCreateChannelOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-slate-900/40 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="relative bg-white border border-slate-100 w-full max-w-lg rounded-2xl p-6 shadow-2xl flex flex-col font-sans"
            >
              <div className="flex justify-between items-center mb-6">
                <div className="flex items-center gap-2">
                  <div className="p-2 bg-slate-50 text-emerald-600 rounded-xl">
                    <Plus className="w-5 h-5 stroke-[2.5]" />
                  </div>
                  <h3 className="text-base font-bold text-slate-800">Criar Novo Canal de Grupo</h3>
                </div>
                <button 
                  onClick={() => setIsCreateChannelOpen(false)} 
                  className="p-1.5 hover:bg-slate-100 rounded-full text-slate-400 hover:text-slate-650 transition-colors cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <form onSubmit={(e) => { e.preventDefault(); runExclusive('Messages.handleCreateChannel', () => handleCreateChannel(e)); }} className="space-y-4 text-left">
                {/* Channel Name */}
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Nome do Canal</label>
                  <input 
                    required
                    type="text" 
                    value={channelForm.name}
                    onChange={(e) => setChannelForm({...channelForm, name: e.target.value})}
                    placeholder="Ex: Irrigação-Sul, Geral, RH" 
                    className="w-full bg-slate-100 text-xs py-2.5 px-4 rounded-xl border border-transparent focus:bg-white focus:border-slate-200 outline-none transition-all placeholder:text-slate-400 text-slate-800"
                  />
                </div>

                {/* Description */}
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Descrição</label>
                  <textarea 
                    rows={3}
                    value={channelForm.description}
                    onChange={(e) => setChannelForm({...channelForm, description: e.target.value})}
                    placeholder="Para que serve este canal?" 
                    className="w-full bg-slate-100 text-xs py-2.5 px-4 rounded-xl border border-transparent focus:bg-white focus:border-slate-200 outline-none transition-all placeholder:text-slate-400 text-slate-800 resize-none"
                  />
                </div>

                {/* Channel Type Choice */}
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Tipo do Canal</label>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { id: 'general', label: 'Geral', desc: 'Comunicação ampla' },
                      { id: 'department', label: 'Departamento', desc: 'Sistemas/RH/Áreas' },
                      { id: 'project', label: 'Projeto', desc: 'Serviço Agronômico' }
                    ].map(typeOpt => (
                      <button
                        key={typeOpt.id}
                        type="button"
                        onClick={() => setChannelForm({
                          ...channelForm, 
                          type: typeOpt.id as any,
                          projectId: '',
                          department: ''
                        })}
                        className={cn(
                          "flex flex-col items-center justify-center p-3 rounded-xl border transition-all text-center gap-1 cursor-pointer",
                          channelForm.type === typeOpt.id 
                            ? "border-emerald-500 bg-slate-50/40 text-slate-600" 
                            : "border-slate-200 hover:bg-slate-50 text-slate-500"
                        )}
                      >
                        <span className="text-[11px] font-bold">{typeOpt.label}</span>
                        <span className="text-[8px] opacity-75">{typeOpt.desc}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Context Selection based on Channel Type */}
                <AnimatePresence mode="wait">
                  {channelForm.type === 'project' && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="space-y-1.5 overflow-hidden"
                    >
                      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Vincular a Projeto/Serviço</label>
                      <select 
                        required
                        value={channelForm.projectId}
                        onChange={(e) => setChannelForm({...channelForm, projectId: e.target.value})}
                        className="w-full bg-slate-100 text-xs py-2.5 px-4 rounded-xl border border-transparent focus:bg-white focus:border-slate-200 outline-none transition-all cursor-pointer text-slate-800"
                      >
                        <option value="">Selecionar projeto agronômico...</option>
                        {projects.map(p => (
                          <option key={p.id} value={p.id}>{p.clientName} — {p.type}</option>
                        ))}
                      </select>
                    </motion.div>
                  )}

                  {channelForm.type === 'department' && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="space-y-1.5 overflow-hidden"
                    >
                      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Departamento / Área</label>
                      <select 
                        required
                        value={channelForm.department}
                        onChange={(e) => setChannelForm({...channelForm, department: e.target.value, name: e.target.value})}
                        className="w-full bg-slate-100 text-xs py-2.5 px-4 rounded-xl border border-transparent focus:bg-white focus:border-slate-200 outline-none transition-all cursor-pointer text-slate-800"
                      >
                        <option value="">Selecionar departamento...</option>
                        <option value="Irrigação">Irrigação</option>
                        <option value="Topografia">Topografia</option>
                        <option value="RH">Recursos Humanos (RH)</option>
                        <option value="Financeiro">Financeiro</option>
                        <option value="Comercial">Comercial</option>
                        <option value="Sistemas Restritos">Sistemas Restritos (TI)</option>
                      </select>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Actions */}
                <div className="flex gap-3 pt-4 border-t border-slate-100">
                  <button 
                    type="button"
                    onClick={() => setIsCreateChannelOpen(false)}
                    className="flex-1 py-2.5 border border-slate-200 hover:bg-slate-50 rounded-xl text-xs font-semibold text-slate-500 cursor-pointer"
                  >
                    Cancelar
                  </button>
                  <button 
                    type="submit"
                    className="flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-600 rounded-xl text-xs font-semibold text-white shadow-sm cursor-pointer"
                  >
                    Criar Canal
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Compose Modal (Gmail Style Float Drawer) */}
      <AnimatePresence>
        {isComposeOpen && (
          <div className="fixed bottom-0 right-[4%] md:right-[6%] z-50 w-full max-w-lg lg:max-w-xl bg-white border border-slate-300 shadow-2xl rounded-t-xl overflow-hidden flex flex-col font-sans mb-0">
            <motion.div 
              initial={{ y: 250, opacity: 0.8 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 250, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 260, damping: 25 }}
              className="flex flex-col h-[550px]"
            >
              {/* Header Box - Gmail Colors */}
              <div className="bg-slate-900 text-white h-10 px-4 flex items-center justify-between select-none rounded-t-xl shrink-0">
                <span className="text-xs font-bold leading-none tracking-wide text-slate-100">Nova mensagem</span>
                <div className="flex items-center gap-1">
                  <button 
                    type="button"
                    onClick={() => runExclusive('Messages.handleSendMessage', () => handleSendMessage(undefined, true))}
                    className="p-1 hover:bg-white/10 rounded transition-colors text-slate-300 hover:text-white"
                    title="Salvar como Rascunho e fechar"
                  >
                    <Archive className="w-3.5 h-3.5" />
                  </button>
                  <button 
                    type="button" 
                    onClick={handleCloseCompose}
                    className="p-1 hover:bg-white/10 rounded transition-colors text-slate-300 hover:text-white"
                    title="Salvar Rascunho e Fechar"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* Composition Form */}
              <form onSubmit={(e) => { e.preventDefault(); runExclusive('Messages.handleSendMessage', () => handleSendMessage(e)); }} className="flex-1 flex flex-col overflow-hidden bg-white">
                <input 
                  type="file" 
                  ref={fileInputRef} 
                  onChange={handleFileChange} 
                  multiple 
                  className="hidden" 
                />
                <input 
                  type="file" 
                  accept="image/*" 
                  ref={imageInputRef} 
                  onChange={handleFileChange} 
                  multiple 
                  className="hidden" 
                />
                {/* To Recipient Field Row */}
                <div className="flex items-center border-b border-slate-100 px-3 py-1.5 focus-within:bg-slate-50 transition-colors">
                  <span className="text-xs text-slate-500 font-medium mr-2 select-none">Para:</span>
                  <select 
                    required
                    value={newMessage.recipientId}
                    onChange={(e) => setNewMessage({...newMessage, recipientId: e.target.value})}
                    className="flex-1 bg-transparent border-none outline-none focus:ring-0 text-xs text-slate-800 py-0 cursor-pointer"
                  >
                    <option value="">Selecionar destinatário...</option>
                    {users.filter(u => u.uid !== user?.uid).map(u => (
                      <option key={u.uid} value={u.uid}>{u.displayName} ({u.role})</option>
                    ))}
                  </select>
                  <div className="flex gap-2 text-[11px] text-slate-400 font-medium select-none ml-2">
                    {!showCc && (
                      <button 
                        type="button" 
                        onClick={() => setShowCc(true)}
                        className="hover:underline hover:text-slate-700"
                      >
                        Cc
                      </button>
                    )}
                    {!showBcc && (
                      <button 
                        type="button" 
                        onClick={() => setShowBcc(true)}
                        className="hover:underline hover:text-slate-700"
                      >
                        Cco
                      </button>
                    )}
                  </div>
                </div>

                {/* CC Field Row */}
                {showCc && (
                  <div className="flex items-center border-b border-slate-100 px-3 py-1.5 bg-white transition-colors">
                    <span className="text-xs text-slate-500 font-medium mr-2 select-none">Cc:</span>
                    <input 
                      type="text" 
                      value={newMessage.cc}
                      onChange={(e) => setNewMessage({...newMessage, cc: e.target.value})}
                      placeholder="Contatos em cópia..." 
                      className="flex-1 bg-transparent border-none outline-none focus:ring-0 text-xs text-slate-800 py-0"
                    />
                    <button 
                      type="button" 
                      onClick={() => { setShowCc(false); setNewMessage({...newMessage, cc: ''}); }}
                      className="p-0.5 text-slate-300 hover:text-slate-500 rounded"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}

                {/* BCC Field Row */}
                {showBcc && (
                  <div className="flex items-center border-b border-slate-100 px-3 py-1.5 bg-white transition-colors">
                    <span className="text-xs text-slate-500 font-medium mr-2 select-none">Cco:</span>
                    <input 
                      type="text" 
                      value={newMessage.bcc}
                      onChange={(e) => setNewMessage({...newMessage, bcc: e.target.value})}
                      placeholder="Contatos em cópia oculta (Cco)..." 
                      className="flex-1 bg-transparent border-none outline-none focus:ring-0 text-xs text-slate-800 py-0"
                    />
                    <button 
                      type="button" 
                      onClick={() => { setShowBcc(false); setNewMessage({...newMessage, bcc: ''}); }}
                      className="p-0.5 text-slate-300 hover:text-slate-500 rounded"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}

                {/* Associated Client / Project Row */}
                <div className="grid grid-cols-2 gap-2 border-b border-slate-100 px-3 py-1 bg-slate-50/50">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="text-[10px] text-slate-400 font-bold uppercase shrink-0 select-none">Cliente:</span>
                    <select
                      value={newMessage.clientId}
                      onChange={(e) => {
                        const targetId = e.target.value;
                        const matchClient = clients.find(c => c.id === targetId);
                        setNewMessage({
                          ...newMessage,
                          clientId: targetId,
                          clientName: matchClient ? matchClient.name : ''
                        });
                      }}
                      className="flex-1 bg-transparent border-none outline-none focus:ring-0 text-[11px] text-slate-700 py-0.5 cursor-pointer truncate"
                    >
                      <option value="">Nenhum associado</option>
                      {clients.map(c => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                  </div>

                  <div className="flex items-center gap-1.5 min-w-0 border-l border-slate-200 pl-2">
                    <span className="text-[10px] text-slate-400 font-bold uppercase shrink-0 select-none">Projeto/Laudo:</span>
                    <select
                      value={newMessage.projectId}
                      onChange={(e) => {
                        const targetId = e.target.value;
                        const matchProj = projects.find(p => p.id === targetId);
                        setNewMessage({
                          ...newMessage,
                          projectId: targetId,
                          projectName: matchProj ? `${matchProj.type} (${matchProj.clientName || 'Geral'})` : ''
                        });
                      }}
                      className="flex-1 bg-transparent border-none outline-none focus:ring-0 text-[11px] text-slate-700 py-0.5 cursor-pointer truncate"
                    >
                      <option value="">Nenhum associado</option>
                      {projects.map(p => (
                        <option key={p.id} value={p.id}>{p.type} {p.clientName ? `(${p.clientName})` : ''}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Subject Field Row */}
                <div className="flex items-center border-b border-slate-100 px-3 py-1.5 bg-white">
                  <input 
                    required
                    type="text" 
                    value={newMessage.subject}
                    onChange={(e) => setNewMessage({...newMessage, subject: e.target.value})}
                    placeholder="Assunto" 
                    className="w-full bg-transparent border-none outline-none focus:ring-0 text-xs text-slate-800 py-0 placeholder:text-slate-400"
                  />
                </div>

                {/* Email Body & Signature Scroll Box */}
                <div className="flex-grow flex flex-col p-4 overflow-y-auto bg-white min-h-0 select-text">
                  <textarea 
                    required
                    rows={12}
                    value={newMessage.content}
                    onChange={(e) => setNewMessage({...newMessage, content: e.target.value})}
                    placeholder="Escreva sua mensagem aqui..." 
                    className="w-full flex-grow bg-transparent border-none outline-none focus:ring-0 text-xs text-slate-800 resize-none placeholder:text-slate-300 leading-relaxed font-sans min-h-[160px]"
                  />

                  {/* Attached files preview block in composer */}
                  {attachedFiles.length > 0 && (
                    <div className="mt-4 pt-3 border-t border-slate-100">
                      <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2 select-none flex items-center gap-1">
                        <Paperclip className="w-3 h-3 text-slate-400" />
                        Arquivos Anexados ({attachedFiles.length})
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        {attachedFiles.map((file, idx) => (
                          <div key={idx} className="flex items-center justify-between p-2 rounded bg-slate-50 border border-slate-200">
                            <div className="flex items-center gap-2 min-w-0">
                              {file.isImage ? (
                                <img src={file.url} className="w-8 h-8 rounded object-cover shrink-0" alt="anexo" />
                              ) : (
                                <div className="w-8 h-8 rounded bg-slate-200 flex items-center justify-center shrink-0">
                                  <File className="w-4 h-4 text-slate-500" />
                                </div>
                              )}
                              <div className="min-w-0">
                                <div className="text-[10px] font-medium text-slate-700 truncate max-w-[120px]" title={file.name}>
                                  {file.name}
                                </div>
                                <div className="text-[9px] text-slate-400 font-mono">
                                  {file.size}
                                </div>
                              </div>
                            </div>
                            <button 
                              type="button" 
                              onClick={() => removeAttachment(idx)} 
                              className="p-1 hover:bg-rose-50 hover:text-rose-500 rounded text-slate-400 transition-colors"
                              title="Remover anexo"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Dynamic Signature Section inside composer */}
                  {userSignature && (
                    <div className="mt-4 pt-4 border-t border-slate-100 text-[11px] text-slate-400 font-sans tracking-wide">
                      <div className="text-slate-300 font-medium mb-1 select-none">--</div>
                      <div className="whitespace-pre-wrap leading-relaxed">{userSignature}</div>
                      {userSignaturePhoto && (
                        <div className="mt-2 select-none">
                          <img 
                            src={userSignaturePhoto} 
                            alt="Assinatura" 
                            className="max-w-[130px] max-h-[60px] object-contain rounded border border-slate-100 shadow-sm"
                            referrerPolicy="no-referrer"
                          />
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Email Footer / Toolbar - Gmail Gray Style */}
                <div className="bg-slate-50 border-t border-slate-100 px-4 py-2.5 flex items-center justify-between shrink-0 select-none">
                  <div className="flex items-center gap-3">
                    <button 
                      type="submit"
                      className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold px-5 py-2 rounded-full flex items-center gap-1 shadow-sm transition-all text-slate-100 hover:shadow"
                    >
                      Enviar
                    </button>
                    
                    {/* Quick options and templates dropdown */}
                    <div className="flex items-center gap-1.5 border-l border-slate-200 pl-3">
                      {/* Paperclip upload button */}
                      <button 
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="p-1.5 hover:bg-slate-200 rounded text-slate-500 hover:text-emerald-600 transition-colors"
                        title="Anexar arquivos"
                      >
                        <Paperclip className="w-4 h-4" />
                      </button>

                      {/* Image format/upload button */}
                      <button 
                        type="button"
                        onClick={() => imageInputRef.current?.click()}
                        className="p-1.5 hover:bg-slate-200 rounded text-slate-500 hover:text-emerald-600 transition-colors"
                        title="Inserir foto"
                      >
                        <Image className="w-4 h-4" />
                      </button>

                      <button 
                        type="button"
                        onClick={() => runExclusive('Messages.handleSendMessage', () => handleSendMessage(undefined, true))}
                        className="p-1.5 hover:bg-slate-200 rounded text-slate-500 hover:text-slate-800 transition-colors"
                        title="Salvar Rascunho"
                      >
                        <Archive className="w-4 h-4" />
                      </button>

                      <div className="relative group/tpl flex items-center gap-1 text-[11px] text-slate-500 hover:text-slate-800 py-1 px-1.5 hover:bg-slate-200 rounded transition-colors cursor-pointer ml-1">
                        <FileText className="w-3.5 h-3.5 text-slate-600" />
                        <select 
                          onChange={(e) => {
                            const template = templates.find(t => t.id === e.target.value);
                            if (template) applyTemplate(template);
                          }}
                          className="bg-transparent border-none text-[10px] font-bold text-slate-600 hover:text-slate-700 focus:ring-0 p-0 cursor-pointer m-0 max-w-[90px]"
                        >
                          <option value="">Modelos...</option>
                          {templates.map(t => (
                            <option key={t.id} value={t.id}>{t.title}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                  </div>

                  {/* Discard / Delete composition button */}
                  <button 
                    type="button"
                    onClick={handleDiscardCompose}
                    className="p-1.5 hover:bg-rose-100 rounded text-slate-400 hover:text-rose-500 transition-colors"
                    title="Descartar rascunho"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Email Settings Modal */}
      <AnimatePresence>
        {isSettingsOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-slate-900/40 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="relative glass-card w-full max-w-lg p-8 shadow-2xl"
            >
              <div className="flex justify-between items-center mb-6">
                <div className="flex items-center gap-2">
                  <Settings className="w-6 h-6 text-emerald-600" />
                  <h3 className="text-xl font-display font-bold">Configurações de Email</h3>
                </div>
                <button onClick={() => setIsSettingsOpen(false)} className="p-2 hover:bg-slate-100 rounded-full">
                   <X className="w-5 h-5 text-slate-400" />
                </button>
              </div>

              <form onSubmit={(e) => { e.preventDefault(); runExclusive('Messages.handleSaveSettings', () => handleSaveSettings(e)); }} className="space-y-6">
                <div className="space-y-4">
                  <div className="flex flex-col gap-1">
                    <label className="text-sm font-bold text-slate-700">Foto da Assinatura (URL)</label>
                    <p className="text-[10px] text-slate-400">Insira a URL de uma imagem para sua assinatura (logo ou foto).</p>
                    <input 
                      type="text"
                      value={userSignaturePhoto}
                      onChange={(e) => setUserSignaturePhoto(e.target.value)}
                      placeholder="https://exemplo.com/sua-foto.jpg"
                      className="w-full glass-input text-sm p-3 mt-1"
                    />
                  </div>

                  <div className="flex flex-col gap-1">
                    <label className="text-sm font-bold text-slate-700">Texto da Assinatura</label>
                    <p className="text-[10px] text-slate-400">Esta assinatura será anexada ao final de todas as suas mensagens enviadas.</p>
                    <textarea 
                      rows={4}
                      value={userSignature}
                      onChange={(e) => setUserSignature(e.target.value)}
                      placeholder="Ex: Atenciosamente, [Seu Nome] - Consultor Ambiental" 
                      className="w-full glass-input resize-none font-sans text-sm p-4 mt-1"
                    />
                  </div>

                  <div className="p-4 bg-slate-50 rounded-xl border border-slate-100">
                    <h5 className="text-[10px] font-bold text-slate-400 uppercase mb-2">Pré-visualização</h5>
                    <div className="text-[11px] text-slate-500 italic whitespace-pre-wrap">
                      Sua mensagem aqui...
                      {"\n\n--\n"}
                      {userSignature || "Sem texto de assinatura definido"}
                    </div>
                    {userSignaturePhoto && (
                      <div className="mt-2 pt-2 border-t border-slate-100">
                        <img 
                          src={userSignaturePhoto} 
                          alt="Preview assinatura" 
                          className="max-w-[100px] max-h-[50px] object-contain rounded"
                          referrerPolicy="no-referrer"
                        />
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex gap-3 pt-2">
                  <button 
                    type="button"
                    onClick={() => setIsSettingsOpen(false)}
                    className="flex-1 py-3 border border-slate-200 rounded-xl text-sm font-bold text-slate-500 hover:bg-slate-50 transition-colors"
                  >
                    Cancelar
                  </button>
                  <button 
                    type="submit"
                    className="flex-1 py-3 bg-emerald-600 text-white rounded-xl font-bold hover:bg-emerald-700 transition-shadow shadow-lg shadow-emerald-100"
                  >
                    Salvar Alterações
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
      <ConfirmationModal
        isOpen={!!isDeleteModalOpen}
        onClose={() => setIsDeleteModalOpen(null)}
        onConfirm={() => isDeleteModalOpen && handleDeleteTemplate(isDeleteModalOpen)}
        title="Excluir Modelo?"
        description="Esta ação removerá permanentemente o modelo de e-mail. Você não poderá recuperá-lo."
        confirmLabel="Excluir Modelo"
      />
      </div>
    </div>
  );
}
