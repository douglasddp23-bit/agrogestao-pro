import React, { useRef, useState, useEffect } from 'react';
import { Trash2, Check, PenTool, User } from 'lucide-react';
import { toast } from 'sonner';
import { runExclusive } from '../lib/submitGuard';

interface SignaturePadProps {
  onSave: (signatureDataUrl: string, signerName: string) => void;
  onCancel: () => void;
  defaultSignerName?: string;
  documentTitle?: string;
}

export default function SignaturePad({ onSave, onCancel, defaultSignerName = '', documentTitle = 'Contrato' }: SignaturePadProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [signerName, setSignerName] = useState(defaultSignerName);
  const [isDrawing, setIsDrawing] = useState(false);
  const [isEmpty, setIsEmpty] = useState(true);

  // Resize canvas on mount
  useEffect(() => {
    const handleResize = () => {
      const canvas = canvasRef.current;
      const container = containerRef.current;
      if (!canvas || !container) return;

      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      // Determine dimensions
      const width = container.clientWidth;
      const height = 220;

      // Support high DPI screens
      const dpr = window.devicePixelRatio || 1;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;

      ctx.scale(dpr, dpr);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.lineWidth = 3;
      ctx.strokeStyle = '#1e293b'; // Slate 800

      clearCanvas();
    };

    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const clearCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // Draw subtle guideline
    const width = canvas.width / (window.devicePixelRatio || 1);
    const height = canvas.height / (window.devicePixelRatio || 1);

    ctx.beginPath();
    ctx.strokeStyle = '#cbd5e1'; // Slate 300
    ctx.setLineDash([6, 4]);
    ctx.lineWidth = 1.5;
    ctx.moveTo(30, height - 50);
    ctx.lineTo(width - 30, height - 50);
    ctx.stroke();
    ctx.setLineDash([]); // Reset dash

    // Re-config style for stroke
    ctx.strokeStyle = '#1e293b'; // Slate 800
    ctx.lineWidth = 3;

    setIsEmpty(true);
  };

  const getCoordinates = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();

    if ('touches' in e) {
      if (e.touches.length === 0) return null;
      // Prevent scrolling while signing on mobile
      return {
        x: e.touches[0].clientX - rect.left,
        y: e.touches[0].clientY - rect.top,
      };
    } else {
      return {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      };
    }
  };

  const startDrawing = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    const coords = getCoordinates(e);
    if (!coords) return;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.beginPath();
    ctx.moveTo(coords.x, coords.y);
    setIsDrawing(true);
    setIsEmpty(false);
  };

  const draw = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return;
    const coords = getCoordinates(e);
    if (!coords) return;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.lineTo(coords.x, coords.y);
    ctx.stroke();
  };

  const stopDrawing = () => {
    setIsDrawing(false);
  };

  const handleSave = () => {
    if (isEmpty) {
      toast.error('Por favor, assine o documento antes de salvar.');
      return;
    }
    if (!signerName.trim()) {
      toast.error('Por favor, informe o nome do assinante para autenticação.');
      return;
    }

    const canvas = canvasRef.current;
    if (!canvas) return;

    const dataUrl = canvas.toDataURL('image/png');
    onSave(dataUrl, signerName.trim());
  };

  return (
    <div className="space-y-5 text-slate-800">
      <div className="bg-slate-50/55 p-4 rounded-2xl border border-slate-100 flex items-start gap-3">
        <PenTool className="w-5 h-5 text-slate-600 shrink-0 mt-0.5" />
        <div>
          <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider">Assinatura Eletrônica Qualificada</h4>
          <p className="text-[11px] text-slate-800 mt-1 leading-relaxed">
            Ao assinar abaixo, você registra o consentimento formal referente aos termos estabelecidos no <strong className="text-slate-950">{documentTitle}</strong>. Utilize o mouse ou uma tela touchscreen.
          </p>
        </div>
      </div>

      <div className="space-y-1.5">
        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block ml-1">
          Nome Completo do Assinante
        </label>
        <div className="relative">
          <User className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            required
            value={signerName}
            onChange={(e) => setSignerName(e.target.value)}
            placeholder="Digite seu nome completo conforme documento oficial"
            className="w-full glass-input pl-10 text-xs font-bold text-slate-800 focus:ring-emerald-500"
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <div className="flex justify-between items-center ml-1">
          <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
            Painel de Assinatura
          </label>
          <button
            type="button"
            onClick={clearCanvas}
            className="text-[10px] font-bold text-rose-500 hover:text-rose-700 flex items-center gap-1 uppercase tracking-wider transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" /> Limpar Painel
          </button>
        </div>

        <div 
          ref={containerRef}
          className="relative bg-slate-50 border-2 border-dashed border-slate-200 rounded-2xl overflow-hidden cursor-crosshair touch-none"
        >
          <canvas
            ref={canvasRef}
            onMouseDown={startDrawing}
            onMouseMove={draw}
            onMouseUp={stopDrawing}
            onMouseLeave={stopDrawing}
            onTouchStart={startDrawing}
            onTouchMove={draw}
            onTouchEnd={stopDrawing}
            className="block w-full h-[220px]"
          />
          {isEmpty && (
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none select-none text-slate-400 bg-slate-50/20">
              <PenTool className="w-8 h-8 stroke-1 text-slate-300 mb-2 animate-pulse" />
              <p className="text-[10px] font-bold uppercase tracking-widest text-center px-4">
                Assine aqui com mouse ou touchscreen
              </p>
            </div>
          )}
        </div>
      </div>

      <div className="flex gap-2.5 pt-4 border-t border-slate-100">
        <button
          type="button"
          onClick={onCancel}
          className="flex-1 py-3 bg-slate-100 hover:bg-slate-200 active:scale-[0.98] border border-slate-200 text-slate-600 rounded-xl text-xs font-bold uppercase tracking-wider transition-all cursor-pointer"
        >
          Cancelar
        </button>
        <button
          type="button"
          onClick={() => runExclusive('SignaturePad.save', () => handleSave())}
          className="flex-1 py-3 bg-emerald-600 hover:bg-emerald-700 active:scale-[0.98] text-white rounded-xl text-xs font-bold uppercase tracking-wider transition-all cursor-pointer flex items-center justify-center gap-1.5 shadow-md shadow-emerald-500/10 font-display"
        >
          <Check className="w-4 h-4" /> Confirmar Assinatura
        </button>
      </div>
    </div>
  );
}
