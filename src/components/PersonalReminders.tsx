import React, { useState, useEffect } from 'react';
import { runExclusive } from '../lib/submitGuard';
import { 
  CheckCircle2, 
  Circle, 
  Plus, 
  Trash2, 
  GripVertical, 
  ListTodo, 
  Sparkles,
  ClipboardCheck
} from 'lucide-react';
import { 
  collection, 
  query, 
  where, 
  onSnapshot, 
  addDoc, 
  updateDoc, 
  deleteDoc, 
  doc, 
  writeBatch 
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useAuth } from '../contexts/AuthContext';
import { cn } from '../lib/utils';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'motion/react';

interface Reminder {
  id: string;
  userId: string;
  text: string;
  completed: boolean;
  position: number;
  createdAt: any;
}

export default function PersonalReminders() {
  const { user } = useAuth();
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [inputText, setInputText] = useState('');
  const [loading, setLoading] = useState(true);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);

  // Subscribe to reminders for the current user in real-time
  useEffect(() => {
    if (!user?.uid) return;

    // Ordenação feita aqui: userId + orderBy(position) exigiria índice composto no Firestore.
    const q = query(
      collection(db, 'personal_reminders'),
      where('userId', '==', user.uid)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const list = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      } as Reminder));
      list.sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
      setReminders(list);
      setLoading(false);
    }, (error) => {
      console.error("Error loading personal reminders:", error);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [user?.uid]);

  const handleAddReminder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user?.uid || !inputText.trim()) return;

    const textToAdd = inputText.trim();
    setInputText('');

    try {
      // Position is placed at the end of the list
      const nextPosition = reminders.length > 0 
        ? Math.max(...reminders.map(r => r.position)) + 1 
        : 0;

      await addDoc(collection(db, 'personal_reminders'), {
        userId: user.uid,
        text: textToAdd,
        completed: false,
        position: nextPosition,
        createdAt: new Date().toISOString()
      });
    } catch (err) {
      console.error("Error adding reminder:", err);
      toast.error("Erro ao adicionar lembrete.");
    }
  };

  const handleToggleCompleted = async (reminder: Reminder) => {
    try {
      await updateDoc(doc(db, 'personal_reminders', reminder.id), {
        completed: !reminder.completed
      });
    } catch (err) {
      console.error("Error toggling reminder completed state:", err);
      toast.error("Erro ao atualizar lembrete.");
    }
  };

  const handleDeleteReminder = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'personal_reminders', id));
    } catch (err) {
      console.error("Error deleting reminder:", err);
      toast.error("Erro ao deletar lembrete.");
    }
  };

  // HTML5 Drag and Drop handlers
  const handleDragStart = (e: React.DragEvent, index: number) => {
    setDraggedIndex(index);
    // Needed for Firefox
    e.dataTransfer.setData('text/plain', index.toString());
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (draggedIndex === null || draggedIndex === index) return;
  };

  const handleDrop = async (e: React.DragEvent, targetIndex: number) => {
    e.preventDefault();
    if (draggedIndex === null || draggedIndex === targetIndex) return;

    // Reorder array locally
    const reorderedList = [...reminders];
    const [draggedItem] = reorderedList.splice(draggedIndex, 1);
    reorderedList.splice(targetIndex, 0, draggedItem);

    // Update positions locally so responsiveness is instantaneous
    setReminders(reorderedList);
    setDraggedIndex(null);

    // Update positions in Firestore using a Batch write for atomic transactional integrity
    try {
      const batch = writeBatch(db);
      reorderedList.forEach((item, idx) => {
        const ref = doc(db, 'personal_reminders', item.id);
        batch.update(ref, { position: idx });
      });
      await batch.commit();
    } catch (err) {
      console.error("Error saving reminders new order:", err);
      toast.error("Erro ao salvar ordenação de prioridade.");
    }
  };

  const handleDragEnd = () => {
    setDraggedIndex(null);
  };

  const completedCount = reminders.filter(r => r.completed).length;

  return (
    <div className="bg-white/40 glass p-6 rounded-[2.5rem] border border-white/40 shadow-sm flex flex-col gap-4 relative overflow-hidden">
      <div className="flex items-center justify-between">
        <h3 className="font-display font-bold text-slate-800 flex items-center gap-2">
          <ListTodo className="w-5 h-5 text-slate-600 animate-pulse" /> Lembretes Pessoais
        </h3>
        {reminders.length > 0 && (
          <span className="text-[10px] bg-slate-50 text-slate-700 font-bold px-2 py-0.5 rounded-full">
            {completedCount}/{reminders.length} Concluídos
          </span>
        )}
      </div>

      {/* Input Form */}
      <form onSubmit={(e) => { e.preventDefault(); runExclusive('PersonalReminders.handleAddReminder', () => handleAddReminder(e)); }} className="relative flex items-center">
        <input 
          type="text"
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          placeholder="Adicionar tarefa ou nota rápida..."
          className="w-full pl-4 pr-12 py-2.5 bg-white/60 text-xs border border-slate-100 rounded-2xl outline-none focus:border-emerald-400 focus:bg-white transition-all text-slate-800 placeholder:text-slate-400"
        />
        <button 
          type="submit"
          className="absolute right-2 p-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl transition-all active:scale-95 cursor-pointer"
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
      </form>

      {/* Reminders List */}
      <div className="space-y-2 max-h-[280px] overflow-y-auto pr-1 custom-scrollbar min-h-[80px] flex flex-col justify-start">
        {loading ? (
          <div className="space-y-2 animate-pulse py-4">
            <div className="h-9 bg-slate-100 rounded-xl w-full"></div>
            <div className="h-9 bg-slate-100 rounded-xl w-full"></div>
          </div>
        ) : reminders.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-6 text-center text-slate-400 gap-1.5">
            <ClipboardCheck className="w-8 h-8 text-slate-300 stroke-[1.5]" />
            <p className="text-[11px] font-medium">Nenhum lembrete para hoje.</p>
            <p className="text-[9px] text-slate-400">Insira tarefas rápidas acima e ordene-as arrastando.</p>
          </div>
        ) : (
          <AnimatePresence initial={false}>
            {reminders.map((reminder, index) => {
              const isDragged = draggedIndex === index;
              return (
                <motion.div
                  key={reminder.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  transition={{ duration: 0.15 }}
                  draggable
                  onDragStart={(e) => handleDragStart(e, index)}
                  onDragOver={(e) => handleDragOver(e, index)}
                  onDrop={(e) => handleDrop(e, index)}
                  onDragEnd={handleDragEnd}
                  className={cn(
                    "flex items-center gap-2 p-3 bg-white/75 hover:bg-white rounded-2xl border transition-all select-none group/item",
                    reminder.completed ? "border-slate-100 bg-slate-50/50" : "border-slate-150/60 shadow-xs",
                    isDragged ? "opacity-40 border-dashed border-emerald-400 scale-[0.98]" : ""
                  )}
                >
                  {/* Grip Handle */}
                  <div 
                    className="cursor-grab active:cursor-grabbing text-slate-300 hover:text-slate-400 p-0.5 shrink-0 transition-colors"
                    title="Arrastar para reordenar"
                  >
                    <GripVertical className="w-3.5 h-3.5" />
                  </div>

                  {/* Checkbox */}
                  <button
                    type="button"
                    onClick={() => handleToggleCompleted(reminder)}
                    className="text-slate-400 hover:text-slate-600 transition-colors shrink-0 cursor-pointer"
                  >
                    {reminder.completed ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-500 fill-emerald-50" />
                    ) : (
                      <Circle className="w-4 h-4 text-slate-300 hover:border-emerald-400" />
                    )}
                  </button>

                  {/* Text */}
                  <span className={cn(
                    "text-xs flex-1 truncate font-medium",
                    reminder.completed ? "line-through text-slate-400 font-normal" : "text-slate-700"
                  )}>
                    {reminder.text}
                  </span>

                  {/* Delete Button */}
                  <button
                    type="button"
                    onClick={() => handleDeleteReminder(reminder.id)}
                    className="opacity-0 group-hover/item:opacity-100 p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-all shrink-0 cursor-pointer"
                    title="Excluir lembrete"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </motion.div>
              );
            })}
          </AnimatePresence>
        )}
      </div>

      {/* Extra Tip bottom line */}
      {reminders.length > 1 && (
        <div className="flex items-center gap-1 text-[9px] text-slate-400 font-semibold select-none bg-slate-50/50 p-2 rounded-xl border border-slate-100/30">
          <Sparkles className="w-3 h-3 text-slate-500" />
          <span>Arraste e solte usando o ícone lateral para ordenar prioridades.</span>
        </div>
      )}
    </div>
  );
}
