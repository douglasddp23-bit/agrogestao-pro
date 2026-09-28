import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { AlertTriangle, X } from 'lucide-react';
import { cn } from '../lib/utils';

interface ConfirmationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'warning' | 'info';
}

export default function ConfirmationModal({
  isOpen,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel = 'Confirmar',
  cancelLabel = 'Cancelar',
  variant = 'danger'
}: ConfirmationModalProps) {
  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center p-6">
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
          />
          <motion.div 
            initial={{ scale: 0.9, opacity: 0, y: 20 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.9, opacity: 0, y: 20 }}
            className="relative glass-card w-full max-w-sm p-8 text-center flex flex-col items-center bg-white"
          >
            <div className={cn(
              "w-16 h-16 rounded-2xl flex items-center justify-center mb-6",
              variant === 'danger' ? "bg-rose-100 text-rose-600" : 
              variant === 'warning' ? "bg-amber-100 text-amber-600" : 
              "bg-emerald-100 text-emerald-600"
            )}>
              <AlertTriangle className="w-8 h-8" />
            </div>
            
            <h3 className="text-xl font-display font-bold text-slate-800 mb-2">{title}</h3>
            <p className="text-sm text-slate-500 mb-8 leading-relaxed">{description}</p>
            
            <div className="flex gap-3 w-full mt-auto">
              <button 
                onClick={onClose}
                className="flex-1 py-3 glass rounded-xl font-bold text-slate-600 hover:bg-slate-50 transition-all text-xs uppercase tracking-widest"
              >
                {cancelLabel}
              </button>
              <button 
                onClick={() => {
                  onConfirm();
                  onClose();
                }}
                className={cn(
                  "flex-1 py-3 rounded-xl font-bold text-white transition-all text-xs uppercase tracking-widest shadow-lg active:scale-95",
                  variant === 'danger' ? "bg-rose-600 hover:bg-rose-700 shadow-rose-200" : 
                  variant === 'warning' ? "bg-amber-600 hover:bg-amber-700 shadow-amber-200" : 
                  "bg-emerald-600 hover:bg-emerald-700 shadow-emerald-200"
                )}
              >
                {confirmLabel}
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
