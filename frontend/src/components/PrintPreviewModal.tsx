import React, { useState } from 'react';
import { 
  Printer, 
  X, 
  ZoomIn, 
  ZoomOut, 
  Building2, 
  Calendar, 
  User, 
  ShieldCheck,
  Leaf
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useAuth } from '../contexts/AuthContext';
import { formatDateTime } from '../lib/utils';

interface PrintPreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  category?: string;
  children: React.ReactNode;
}

export default function PrintPreviewModal({
  isOpen,
  onClose,
  title,
  subtitle,
  category = 'Relatório Geral',
  children
}: PrintPreviewModalProps) {
  const { user } = useAuth();
  const [orientation, setOrientation] = useState<'portrait' | 'landscape'>('portrait');
  const [zoom, setZoom] = useState<number>(0.85); // Default zoom level for comfortable preview fit
  const [showHeader, setShowHeader] = useState<boolean>(true);
  const [showFooter, setShowFooter] = useState<boolean>(true);
  const [compactMode, setCompactMode] = useState<boolean>(false);

  if (!isOpen) return null;

  const handlePrint = () => {
    // Add print trigger attribute to body if needed
    document.body.classList.add('printing-from-preview');
    window.print();
    setTimeout(() => {
      document.body.classList.remove('printing-from-preview');
    }, 1000);
  };

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[100] flex flex-col bg-slate-950/90 backdrop-blur-md overflow-hidden text-slate-100">
        
        {/* Top Action Control Toolbar */}
        <div className="h-16 px-6 bg-slate-900 border-b border-slate-800 flex items-center justify-between shrink-0 shadow-lg z-10 no-print">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-emerald-500/20 text-emerald-400 rounded-xl border border-emerald-500/30">
              <Printer className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-white tracking-wide">Pré-visualização de Impressão A4</h3>
                <span className="text-[10px] uppercase font-mono font-extrabold px-2 py-0.5 bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 rounded-full">
                  Simulação Real
                </span>
              </div>
              <p className="text-xs text-slate-400 hidden sm:block">
                Ajuste layout, margens e orientação antes de enviar para a impressora.
              </p>
            </div>
          </div>

          {/* Quick Settings Bar */}
          <div className="flex items-center gap-2 md:gap-4">
            
            {/* Orientation Toggle */}
            <div className="flex items-center bg-slate-800 p-1 rounded-xl border border-slate-700/60 text-xs">
              <button
                onClick={() => setOrientation('portrait')}
                className={`px-3 py-1.5 rounded-lg font-medium transition-all flex items-center gap-1.5 cursor-pointer ${
                  orientation === 'portrait'
                    ? 'bg-emerald-600 text-white shadow-sm font-bold'
                    : 'text-slate-400 hover:text-white'
                }`}
                title="Orientação Retrato (210mm x 297mm)"
              >
                <div className="w-2.5 h-3.5 border-1.5 border-current rounded-xs shrink-0" />
                <span className="hidden md:inline">Retrato</span>
              </button>
              <button
                onClick={() => setOrientation('landscape')}
                className={`px-3 py-1.5 rounded-lg font-medium transition-all flex items-center gap-1.5 cursor-pointer ${
                  orientation === 'landscape'
                    ? 'bg-emerald-600 text-white shadow-sm font-bold'
                    : 'text-slate-400 hover:text-white'
                }`}
                title="Orientação Paisagem (297mm x 210mm)"
              >
                <div className="w-3.5 h-2.5 border-1.5 border-current rounded-xs shrink-0" />
                <span className="hidden md:inline">Paisagem</span>
              </button>
            </div>

            {/* Zoom Controls */}
            <div className="hidden lg:flex items-center bg-slate-800 px-2 py-1 rounded-xl border border-slate-700/60 text-xs gap-1">
              <button
                onClick={() => setZoom((prev) => Math.max(0.5, +(prev - 0.1).toFixed(2)))}
                className="p-1 hover:bg-slate-700 rounded-md text-slate-300 transition-colors cursor-pointer"
                title="Reduzir Visualização"
              >
                <ZoomOut className="w-4 h-4" />
              </button>
              <span className="w-12 text-center font-mono font-bold text-emerald-400 text-xs">
                {Math.round(zoom * 100)}%
              </span>
              <button
                onClick={() => setZoom((prev) => Math.min(1.25, +(prev + 0.1).toFixed(2)))}
                className="p-1 hover:bg-slate-700 rounded-md text-slate-300 transition-colors cursor-pointer"
                title="Aumentar Visualização"
              >
                <ZoomIn className="w-4 h-4" />
              </button>
            </div>

            {/* Print Button */}
            <button
              onClick={handlePrint}
              className="px-5 py-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold rounded-xl text-xs transition-all flex items-center gap-2 cursor-pointer shadow-lg shadow-emerald-950/50 hover:scale-102"
            >
              <Printer className="w-4 h-4 text-slate-950" />
              <span className="hidden sm:inline">Imprimir Relatório</span>
              <span className="sm:hidden">Imprimir</span>
            </button>

            {/* Close Button */}
            <button
              onClick={onClose}
              className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded-xl transition-colors cursor-pointer ml-1"
              title="Fechar Pré-visualização"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Secondary Options Sub-bar */}
        <div className="bg-slate-900/60 border-b border-slate-800/80 px-6 py-2 flex items-center justify-between text-xs text-slate-400 no-print shrink-0">
          <div className="flex items-center gap-4 flex-wrap">
            <label className="flex items-center gap-1.5 cursor-pointer hover:text-slate-200 transition-colors">
              <input
                type="checkbox"
                checked={showHeader}
                onChange={(e) => setShowHeader(e.target.checked)}
                className="rounded border-slate-700 text-emerald-500 focus:ring-emerald-500/20 bg-slate-800"
              />
              <span>Cabeçalho Oficial</span>
            </label>

            <label className="flex items-center gap-1.5 cursor-pointer hover:text-slate-200 transition-colors">
              <input
                type="checkbox"
                checked={showFooter}
                onChange={(e) => setShowFooter(e.target.checked)}
                className="rounded border-slate-700 text-emerald-500 focus:ring-emerald-500/20 bg-slate-800"
              />
              <span>Rodapé de Autenticidade</span>
            </label>

            <label className="flex items-center gap-1.5 cursor-pointer hover:text-slate-200 transition-colors">
              <input
                type="checkbox"
                checked={compactMode}
                onChange={(e) => setCompactMode(e.target.checked)}
                className="rounded border-slate-700 text-emerald-500 focus:ring-emerald-500/20 bg-slate-800"
              />
              <span>Modo Compacto</span>
            </label>
          </div>

          <div className="hidden md:flex items-center gap-2 text-[11px] text-slate-500">
            <span>Dica: Use <strong>Ctrl + P</strong> para salvar diretamente como PDF.</span>
          </div>
        </div>

        {/* Paper Canvas Workbench */}
        <div className="flex-1 overflow-auto p-4 md:p-8 flex justify-center items-start custom-scrollbar bg-slate-950/80">
          <motion.div
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25 }}
            style={{ transform: `scale(${zoom})`, transformOrigin: 'top center' }}
            className={`bg-white text-slate-900 shadow-2xl rounded-xs border border-slate-300 transition-all print-preview-paper ${
              orientation === 'portrait' 
                ? 'w-[210mm] min-h-[297mm] p-[12mm]' 
                : 'w-[297mm] min-h-[210mm] p-[12mm]'
            }`}
          >
            {/* Simulated Paper Content Container */}
            <div className={`flex flex-col justify-between h-full space-y-6 ${compactMode ? 'text-xs' : ''}`}>
              <div>
                
                {/* Official Corporate Header */}
                {showHeader && (
                  <div className="border-b-2 border-slate-900 pb-4 mb-6 print-header-banner">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-emerald-600 rounded-xl flex items-center justify-center text-white font-bold shadow-sm">
                          <Leaf className="w-6 h-6" />
                        </div>
                        <div>
                          <h1 className="text-lg font-extrabold text-slate-900 tracking-tight leading-tight">
                            AGROGESTÃO PRO
                          </h1>
                          <p className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider">
                            Sistema de Gestão & Inteligência Agrícola Integrada
                          </p>
                        </div>
                      </div>

                      <div className="text-right text-[10px] text-slate-600 space-y-0.5">
                        <div className="flex items-center justify-end gap-1 font-bold text-slate-800">
                          <Building2 className="w-3 h-3 text-emerald-600" />
                          <span>AgroGestão Soluções Rurais S.A.</span>
                        </div>
                        <div className="flex items-center justify-end gap-1">
                          <Calendar className="w-3 h-3 text-slate-400" />
                          <span>Emissão: {formatDateTime(new Date().toISOString())}</span>
                        </div>
                        <div className="flex items-center justify-end gap-1">
                          <User className="w-3 h-3 text-slate-400" />
                          <span>Operador: {user?.displayName || user?.email || 'Usuário do Sistema'}</span>
                        </div>
                      </div>
                    </div>

                    {/* Document Title Bar */}
                    <div className="mt-4 pt-3 border-t border-slate-200 flex items-center justify-between">
                      <div>
                        <span className="text-[9px] uppercase tracking-widest font-extrabold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                          {category}
                        </span>
                        <h2 className="text-base font-bold text-slate-900 mt-1">{title}</h2>
                        {subtitle && <p className="text-xs text-slate-500">{subtitle}</p>}
                      </div>
                      <div className="text-right">
                        <span className="text-[9px] font-mono text-slate-400">DOC-ID: {Math.random().toString(36).substring(2, 9).toUpperCase()}</span>
                      </div>
                    </div>
                  </div>
                )}

                {/* Main Dynamic Document Body */}
                <div className="print-body-content">
                  {children}
                </div>
              </div>

              {/* Official Corporate Footer */}
              {showFooter && (
                <div className="mt-12 pt-4 border-t border-slate-300 text-[9px] text-slate-500 flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
                    <span>Documento oficial gerado via plataforma <strong>AgroGestão Pro</strong>. Autenticidade garantida por assinatura digital.</span>
                  </div>
                  <div>
                    <span>Página 1 de 1</span>
                  </div>
                </div>
              )}

            </div>
          </motion.div>
        </div>

      </div>
    </AnimatePresence>
  );
}
