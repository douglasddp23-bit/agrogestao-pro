import React, { useState, useEffect, useRef } from 'react';
import { runExclusive } from '../lib/submitGuard';
import { motion, AnimatePresence } from 'motion/react';
import { 
  FileText, 
  CheckCircle2, 
  PenTool, 
  Calendar, 
  DollarSign, 
  Smartphone, 
  ChevronDown, 
  ChevronUp, 
  Loader2, 
  AlertTriangle,
  Award,
  Download,
  Check,
  RotateCcw,
  User,
  ExternalLink,
  SmartphoneIcon
} from 'lucide-react';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { logAudit } from '../lib/audit';
import { toast } from 'sonner';
import { Contract } from '../types';
import { formatDate } from '../lib/utils';
import { jsPDF } from 'jspdf';

interface RemoteSignatureProps {
  contractId: string;
}

export default function RemoteSignature({ contractId }: RemoteSignatureProps) {
  const [contract, setContract] = useState<Contract | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // Signature States
  const [signerName, setSignerName] = useState('');
  const [isDrawing, setIsDrawing] = useState(false);
  const [isEmpty, setIsEmpty] = useState(true);
  const [showFullTerms, setShowFullTerms] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [signedSuccessfully, setSignedSuccessfully] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Load contract details from Firestore
  useEffect(() => {
    async function fetchContract() {
      if (!contractId) {
        setError('ID do contrato não fornecido.');
        setLoading(false);
        return;
      }

      try {
        const docRef = doc(db, 'contracts', contractId);
        const docSnap = await getDoc(docRef);

        if (docSnap.exists()) {
          const data = docSnap.data() as Contract;
          setContract({ ...data, id: docSnap.id });
          setSignerName(data.clientName || '');
          
          if (data.signatureBase64) {
            setSignedSuccessfully(true);
          }
        } else {
          setError('Contrato não localizado em nosso banco de dados.');
        }
      } catch (err) {
        console.error('Erro ao buscar contrato:', err);
        setError('Ocorreu uma falha na comunicação com o servidor de assinaturas.');
      } finally {
        setLoading(false);
      }
    }

    fetchContract();
  }, [contractId]);

  // Handle signature canvas resizing and setup
  useEffect(() => {
    if (loading || error || signedSuccessfully || !canvasRef.current || !containerRef.current) return;

    const canvas = canvasRef.current;
    const container = containerRef.current;

    const handleResize = () => {
      const width = container.clientWidth;
      const height = 180; // Convenient mobile height

      const dpr = window.devicePixelRatio || 1;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;

      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.scale(dpr, dpr);
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.lineWidth = 3;
        ctx.strokeStyle = '#1e293b'; // Slate 800
        clearCanvas();
      }
    };

    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [loading, error, signedSuccessfully]);

  const clearCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // Draw signature guideline
    const width = canvas.width / (window.devicePixelRatio || 1);
    const height = canvas.height / (window.devicePixelRatio || 1);

    ctx.beginPath();
    ctx.strokeStyle = '#cbd5e1'; // Slate 300
    ctx.setLineDash([4, 4]);
    ctx.lineWidth = 1.5;
    ctx.moveTo(20, height - 40);
    ctx.lineTo(width - 20, height - 40);
    ctx.stroke();
    ctx.setLineDash([]); // Reset dash

    // Re-config style for drawing
    ctx.strokeStyle = '#0f172a'; // Slate 900 / dark ink
    ctx.lineWidth = 3;

    setIsEmpty(true);
  };

  const getCoordinates = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();

    if ('touches' in e) {
      if (e.touches.length === 0) return null;
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
    e.preventDefault();
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
    e.preventDefault();
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

  const handleSaveSignature = async () => {
    if (isEmpty) {
      toast.error('Por favor, desenhe sua assinatura na tela antes de confirmar.');
      return;
    }
    if (!signerName.trim()) {
      toast.error('Informe o nome completo do assinante titular para autenticação.');
      return;
    }
    if (!contract) return;

    setIsSubmitting(true);

    try {
      const canvas = canvasRef.current;
      if (!canvas) throw new Error('Canvas não disponível.');

      const dataUrl = canvas.toDataURL('image/png');
      const signedAtStr = new Date().toISOString();

      // Secure remote update to Firestore
      await updateDoc(doc(db, 'contracts', contract.id), {
        signatureBase64: dataUrl,
        signedAt: signedAtStr,
        signedByName: signerName.trim(),
        status: 'active',
        updatedAt: signedAtStr
      });

      // Log remote signature event
      await logAudit({
        userId: 'client_remote',
        userName: `Cliente: ${signerName.trim()}`,
        action: 'status_changed',
        collection: 'contracts',
        recordId: contract.id,
        recordName: `Contrato ${contract.contractNumber}`,
        details: `Contrato assinado remotamente pelo celular por ${signerName.trim()}. O status foi atualizado para Ativo.`,
        newValues: { signatureBase64: '[REDACTED_IMAGE_DATA]', signedAt: signedAtStr, signedByName: signerName.trim(), status: 'active' }
      });

      setContract(prev => prev ? {
        ...prev,
        signatureBase64: dataUrl,
        signedAt: signedAtStr,
        signedByName: signerName.trim(),
        status: 'active'
      } : null);

      setSignedSuccessfully(true);
      toast.success('Contrato assinado digitalmente com sucesso!');
    } catch (err) {
      console.error(err);
      toast.error('Ocorreu um erro ao salvar sua assinatura digital. Verifique sua conexão.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Generate a beautifully structured PDF of the signed contract
  const handleDownloadPDF = () => {
    if (!contract) return;

    const docPdf = new jsPDF();
    
    // Theme Colors
    const primaryColor = [16, 185, 129]; // Emerald 500
    const textColor = [30, 41, 59]; // Slate 800
    
    // Header
    docPdf.setFillColor(248, 250, 252); // Slate 50
    docPdf.rect(0, 0, 210, 40, 'F');
    
    docPdf.setTextColor(primaryColor[0], primaryColor[1], primaryColor[2]);
    docPdf.setFont('helvetica', 'bold');
    docPdf.setFontSize(22);
    docPdf.text(contract.contractorCompany || 'Contrato de Prestação de Serviços', 15, 20);
    
    docPdf.setFont('helvetica', 'normal');
    docPdf.setFontSize(9);
    docPdf.setTextColor(100, 116, 139);
    docPdf.text('SISTEMA DE GESTÃO E CONSULTORIA AGRÍCOLA INTEGRADA', 15, 26);
    docPdf.text(`Emitido em: ${new Date().toLocaleDateString('pt-BR')}`, 155, 26);
    
    // Title
    docPdf.setTextColor(textColor[0], textColor[1], textColor[2]);
    docPdf.setFont('helvetica', 'bold');
    docPdf.setFontSize(14);
    docPdf.text(`INSTRUMENTO PARTICULAR DE PRESTAÇÃO DE SERVIÇOS TÉCNICOS`, 15, 55);
    
    docPdf.setFontSize(11);
    docPdf.text(`Contrato de Prestação N°: ${contract.contractNumber}`, 15, 62);
    docPdf.text(`Categoria de Serviço: ${contract.category}`, 15, 68);
    
    // Separator line
    docPdf.setDrawColor(226, 232, 240);
    docPdf.line(15, 73, 195, 73);
    
    // Resumo do Contrato
    docPdf.setFont('helvetica', 'bold');
    docPdf.text('PARTES CONTRATANTES:', 15, 81);
    docPdf.setFont('helvetica', 'normal');
    docPdf.text(`CONTRATADA: ${contract.contractorCompany || '(conforme contrato)'}`, 15, 87);
    docPdf.text(`CONTRATANTE: ${contract.clientName}`, 15, 93);
    
    docPdf.setFont('helvetica', 'bold');
    docPdf.text('VIGÊNCIA E VALOR:', 15, 103);
    docPdf.setFont('helvetica', 'normal');
    docPdf.text(`Data de Início: ${formatDate(contract.startDate)}`, 15, 109);
    docPdf.text(`Data de Término: ${contract.endDate ? formatDate(contract.endDate) : 'Não definida'}`, 15, 115);
    docPdf.text(`Valor Total Pactual: R$ ${contract.totalValue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`, 15, 121);
    docPdf.text(`Número de Parcelas: ${contract.installmentsCount} parcelas mensais`, 15, 127);
    
    // Cláusula / Texto do Contrato
    docPdf.setFont('helvetica', 'bold');
    docPdf.text('TERMOS E CONDIÇÕES CONTRATUAIS:', 15, 137);
    
    docPdf.setFont('helvetica', 'normal');
    docPdf.setFontSize(9.5);
    docPdf.setTextColor(71, 85, 105);
    
    const clausesText = typeof contract.clauses === 'string' 
      ? contract.clauses 
      : Array.isArray(contract.clauses) 
        ? contract.clauses.join('\n\n') 
        : `O presente contrato tem como objeto a prestação de serviços de consultoria agronômica especializada, englobando análises de campo, recomendação técnica e faturamento periódico conforme cronograma pactuado no sistema de AgroGestão Pro.`;
        
    const splitText = docPdf.splitTextToSize(clausesText, 180);
    docPdf.text(splitText, 15, 143);
    
    // Add page if needed
    let signatureY = 195;
    if (splitText.length > 10) {
      docPdf.addPage();
      signatureY = 30;
    }
    
    // Signatures
    docPdf.setDrawColor(226, 232, 240);
    docPdf.line(15, signatureY, 195, signatureY);
    
    docPdf.setFont('helvetica', 'bold');
    docPdf.setFontSize(11);
    docPdf.setTextColor(textColor[0], textColor[1], textColor[2]);
    docPdf.text('FORMALIZAÇÃO E ASSINATURA DIGITAL', 15, signatureY + 10);
    
    docPdf.setFont('helvetica', 'normal');
    docPdf.setFontSize(9);
    docPdf.setTextColor(100, 116, 139);
    docPdf.text('Documento eletrônico validado judicialmente em conformidade com a MP 2.200-2/2001.', 15, signatureY + 16);
    docPdf.text(`Código de Integridade Eletrônica (ID): ${contract.id}`, 15, signatureY + 21);
    
    // AgroGestão Signature
    docPdf.setFont('helvetica', 'bold');
    docPdf.setTextColor(textColor[0], textColor[1], textColor[2]);
    docPdf.text('Assinado eletronicamente por:', 15, signatureY + 35);
    docPdf.setFont('helvetica', 'normal');
    docPdf.text(contract.contractorCompany || 'CONTRATADA', 15, signatureY + 41);
    docPdf.setFontSize(8);
    docPdf.text('Representante Legal Técnico', 15, signatureY + 45);
    
    // Client Signature Image or Stamp
    const clientNameStr = contract.signedByName || contract.clientName;
    const clientSignedDate = contract.signedAt ? new Date(contract.signedAt).toLocaleString('pt-BR') : '';
    
    docPdf.setFontSize(11);
    docPdf.setFont('helvetica', 'bold');
    docPdf.text('Contratante / Produtor:', 115, signatureY + 35);
    
    docPdf.setFontSize(9);
    docPdf.setFont('helvetica', 'normal');
    docPdf.text(clientNameStr, 115, signatureY + 41);
    docPdf.setFontSize(8);
    docPdf.text(`CPF cadastrado no sistema`, 115, signatureY + 45);
    if (clientSignedDate) {
      docPdf.text(`Assinado em: ${clientSignedDate}`, 115, signatureY + 49);
    }
    
    if (contract.signatureBase64) {
      try {
        docPdf.addImage(contract.signatureBase64, 'PNG', 115, signatureY + 54, 65, 20);
      } catch (err) {
        console.warn('Could not add signature image to PDF:', err);
      }
    }
    
    docPdf.save(`Contrato_${contract.contractNumber}_Assinado.pdf`);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
        <div className="text-center space-y-4">
          <Loader2 className="w-12 h-12 text-emerald-600 animate-spin mx-auto" />
          <h2 className="text-sm font-bold text-slate-700 uppercase tracking-widest">Carregando portal de assinatura...</h2>
          <p className="text-xs text-slate-400">Verificando validade do link eletrônico</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
        <div className="bg-white p-8 rounded-3xl border border-slate-200 shadow-xl max-w-md w-full text-center space-y-4">
          <div className="w-14 h-14 bg-rose-50 border border-rose-100 text-rose-600 rounded-full flex items-center justify-center mx-auto shadow-md">
            <AlertTriangle className="w-6 h-6" />
          </div>
          <h2 className="text-lg font-bold text-slate-800">Assinatura Indisponível</h2>
          <p className="text-xs text-slate-500 leading-relaxed">{error}</p>
          <div className="pt-4">
            <p className="text-[10px] text-slate-400 leading-normal">
              Se você recebeu este link por mensagem, entre em contato com o consultor responsável para que um novo link válido seja emitido.
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (!contract) return null;

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col font-sans">
      {/* Top Header */}
      <header className="bg-white border-b border-slate-200 py-4 px-6 flex items-center justify-between sticky top-0 z-40 shadow-xs">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-gradient-to-br from-emerald-500 to-emerald-600 rounded-lg flex items-center justify-center text-white font-black text-sm shadow-md">
            A
          </div>
          <div>
            <span className="font-display font-black text-slate-800 text-sm tracking-tight block">{contract?.contractorCompany || 'Assinatura de Contrato'}</span>
            <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block">Assinatura Eletrônica</span>
          </div>
        </div>
        
        <div className="flex items-center gap-1.5 bg-emerald-50 text-emerald-700 px-2.5 py-1 rounded-full text-[10px] font-bold border border-emerald-100">
          <Smartphone className="w-3 h-3 text-emerald-600" />
          MÓVEL
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 max-w-lg w-full mx-auto px-4 py-6 flex flex-col justify-start gap-5">
        
        <AnimatePresence mode="wait">
          {!signedSuccessfully ? (
            <motion.div 
              key="sign-portal"
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -15 }}
              className="space-y-5 flex-1 flex flex-col"
            >
              {/* Introduction Card */}
              <div className="bg-gradient-to-br from-slate-900 to-emerald-950 text-white p-5 rounded-3xl shadow-lg relative overflow-hidden">
                <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-500/10 rounded-full blur-3xl -z-0" />
                
                <span className="text-[10px] font-bold text-emerald-400 uppercase tracking-widest bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-0.5 rounded-full">
                  Pronto para Assinar
                </span>
                
                <h1 className="text-lg font-bold mt-3 leading-tight font-display">
                  Olá, {contract.clientName}!
                </h1>
                
                <p className="text-xs text-slate-300 mt-1.5 leading-relaxed">
                  {contract?.contractorCompany ? `A ${contract.contractorCompany} preparou` : 'Preparamos'} o seu contrato técnico de prestação de serviços. Assine digitalmente agora mesmo na tela do seu celular com validade jurídica garantida.
                </p>

                <div className="mt-4 pt-4 border-t border-white/10 flex items-center justify-between text-xs">
                  <div>
                    <span className="text-white/40 block text-[9px] uppercase tracking-wider">Contrato</span>
                    <span className="font-mono font-bold text-white">{contract.contractNumber}</span>
                  </div>
                  <div className="text-right">
                    <span className="text-white/40 block text-[9px] uppercase tracking-wider">Serviço</span>
                    <span className="font-bold text-emerald-300">{contract.category}</span>
                  </div>
                </div>
              </div>

              {/* Terms Preview Card */}
              <div className="bg-white p-5 rounded-3xl border border-slate-200 shadow-sm space-y-4">
                <h3 className="text-xs font-bold text-slate-700 uppercase tracking-widest flex items-center gap-2">
                  <FileText className="w-4 h-4 text-slate-600" /> Resumo do Instrumento
                </h3>

                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div className="bg-slate-50 p-3 rounded-2xl border border-slate-100 flex flex-col gap-0.5">
                    <span className="text-[9px] font-bold text-slate-400 uppercase">Vigência Inicial</span>
                    <span className="font-bold text-slate-700 flex items-center gap-1">
                      <Calendar className="w-3.5 h-3.5 text-slate-500" /> {formatDate(contract.startDate)}
                    </span>
                  </div>
                  <div className="bg-slate-50 p-3 rounded-2xl border border-slate-100 flex flex-col gap-0.5">
                    <span className="text-[9px] font-bold text-slate-400 uppercase">Previsão Fim</span>
                    <span className="font-bold text-slate-700 flex items-center gap-1">
                      <Calendar className="w-3.5 h-3.5 text-slate-500" /> {contract.endDate ? formatDate(contract.endDate) : 'Indeterminado'}
                    </span>
                  </div>
                  <div className="bg-slate-50 p-3 rounded-2xl border border-slate-100 flex flex-col gap-0.5">
                    <span className="text-[9px] font-bold text-slate-400 uppercase">Valor Global</span>
                    <span className="font-bold text-emerald-600 flex items-center gap-0.5">
                      <DollarSign className="w-3.5 h-3.5 text-emerald-500" /> R$ {contract.totalValue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                  <div className="bg-slate-50 p-3 rounded-2xl border border-slate-100 flex flex-col gap-0.5">
                    <span className="text-[9px] font-bold text-slate-400 uppercase">Forma PGTO</span>
                    <span className="font-bold text-slate-700">
                      {contract.installmentsCount} parcelas mensais
                    </span>
                  </div>
                </div>

                {/* Expandable Terms of Contract */}
                <div className="border-t pt-3">
                  <button
                    type="button"
                    onClick={() => setShowFullTerms(!showFullTerms)}
                    className="w-full flex items-center justify-between text-xs text-slate-600 hover:text-slate-700 font-bold py-1 px-1 rounded-lg hover:bg-slate-50/50 transition-colors cursor-pointer"
                  >
                    <span>{showFullTerms ? 'Ocultar Termos do Contrato' : 'Ler Cláusulas e Termos Integrais'}</span>
                    {showFullTerms ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  </button>

                  <AnimatePresence>
                    {showFullTerms && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="overflow-hidden"
                      >
                        <div className="mt-3 p-3 bg-slate-50 border border-slate-200 rounded-2xl max-h-[220px] overflow-y-auto text-slate-600 text-[11px] leading-relaxed space-y-3 font-sans scrollbar-thin whitespace-pre-wrap">
                          {typeof contract.clauses === 'string' 
                            ? contract.clauses 
                            : Array.isArray(contract.clauses) 
                              ? contract.clauses.join('\n\n') 
                              : `O presente contrato tem como objeto a prestação de serviços de consultoria agronômica especializada, englobando análises de campo, recomendação técnica e faturamento periódico conforme cronograma pactuado no sistema de AgroGestão Pro.`
                          }
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </div>

              {/* Signature Interactive Card */}
              <div className="bg-white p-5 rounded-3xl border border-slate-200 shadow-sm space-y-4 flex-1 flex flex-col">
                <h3 className="text-xs font-bold text-slate-700 uppercase tracking-widest flex items-center gap-2">
                  <PenTool className="w-4 h-4 text-emerald-600" /> Assinatura Eletrônica do Titular
                </h3>

                {/* Signer input name */}
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-400 uppercase block">Nome Completo do Assinante (Contratante)</label>
                  <div className="relative">
                    <User className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <input 
                      type="text" 
                      value={signerName} 
                      onChange={(e) => setSignerName(e.target.value)}
                      placeholder="Insira seu nome para assinatura"
                      className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-2xl text-xs font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:bg-white focus:border-emerald-500 transition-all"
                      required
                    />
                  </div>
                </div>

                {/* Canvas Drawing Area */}
                <div className="space-y-1.5 flex-1 flex flex-col min-h-[220px]">
                  <div className="flex items-center justify-between">
                    <label className="text-[10px] font-bold text-slate-400 uppercase block">Desenhe sua Assinatura abaixo</label>
                    <button
                      type="button"
                      onClick={clearCanvas}
                      className="text-[10px] text-slate-500 hover:text-rose-600 font-bold flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer"
                    >
                      <RotateCcw className="w-3 h-3" /> Limpar Tela
                    </button>
                  </div>

                  <div 
                    ref={containerRef}
                    className="flex-1 bg-slate-50 border border-slate-200 rounded-2xl overflow-hidden relative min-h-[180px] touch-none cursor-crosshair border-dashed hover:border-emerald-500/50 transition-colors"
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
                      className="absolute inset-0 block w-full h-full"
                    />
                    
                    {isEmpty && (
                      <div className="absolute inset-0 flex flex-col items-center justify-center p-4 text-center pointer-events-none select-none">
                        <PenTool className="w-8 h-8 text-slate-300 stroke-1 mb-1.5 animate-bounce" />
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Use o dedo ou caneta móvel</span>
                        <p className="text-[9px] text-slate-400 max-w-[200px] mt-0.5">Assine sobre a linha pontilhada</p>
                      </div>
                    )}
                  </div>
                </div>

                <div className="text-[9px] text-slate-400 text-center leading-normal pt-1 border-t">
                  Ao assinar este documento, você concorda com as cláusulas, termos e cronograma físico-financeiro representados acima, autorizando o início das atividades de campo pela equipe técnica.
                </div>

                {/* Finalize button */}
                <button
                  type="button"
                  onClick={() => runExclusive('RemoteSignature.handleSaveSignature', () => handleSaveSignature())}
                  disabled={isSubmitting}
                  className="w-full py-3.5 bg-gradient-to-r from-emerald-600 to-emerald-600 disabled:from-emerald-400 disabled:to-emerald-400 text-white rounded-2xl text-xs font-bold uppercase tracking-wider hover:shadow-lg hover:shadow-emerald-500/20 active:scale-95 transition-all flex items-center justify-center gap-2 cursor-pointer mt-2"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" /> Processando Assinatura Eletrônica...
                    </>
                  ) : (
                    <>
                      <Check className="w-4 h-4 stroke-[3px]" /> Finalizar Assinatura Digital
                    </>
                  )}
                </button>
              </div>
            </motion.div>
          ) : (
            <motion.div 
              key="sign-success"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="bg-white p-6 rounded-[2.5rem] border border-slate-200 shadow-xl text-center space-y-6 py-8"
            >
              <div className="w-18 h-18 bg-emerald-50 border border-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto shadow-md animate-pulse">
                <CheckCircle2 className="w-10 h-10 stroke-[1.5px]" />
              </div>

              <div className="space-y-2">
                <span className="text-[10px] font-bold text-emerald-600 uppercase tracking-widest bg-emerald-50 border border-emerald-100 px-3 py-1 rounded-full">
                  Assinado Eletronicamente
                </span>
                <h2 className="text-xl font-display font-black text-slate-800">Assinatura Concluída!</h2>
                <p className="text-xs text-slate-500 leading-relaxed max-w-sm mx-auto">
                  Parabéns, seu documento foi processado e arquivado com sucesso. O status do contrato foi atualizado para <strong>Ativo</strong>.
                </p>
              </div>

              <div className="p-4 bg-slate-50 border border-slate-200 rounded-3xl space-y-3.5 max-w-sm mx-auto text-left">
                <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest text-center pb-2 border-b">
                  Selo de Autenticidade Digital
                </h4>
                
                <div className="text-[10px] grid grid-cols-2 gap-y-2 text-slate-600">
                  <span className="font-bold">Contratante:</span>
                  <span className="text-right font-medium">{contract.signedByName || signerName}</span>
                  
                  <span className="font-bold">Data/Hora:</span>
                  <span className="text-right font-mono font-bold">
                    {contract.signedAt ? new Date(contract.signedAt).toLocaleDateString('pt-BR') : new Date().toLocaleDateString('pt-BR')} 
                    {' '}
                    {contract.signedAt ? new Date(contract.signedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                  
                  <span className="font-bold">Documento ID:</span>
                  <span className="text-right font-mono font-bold text-[8px] truncate">{contract.id}</span>
                  
                  <span className="font-bold">Validade:</span>
                  <span className="text-right text-emerald-600 font-bold flex items-center justify-end gap-0.5">
                    <Award className="w-3.5 h-3.5" /> JURÍDICA COMPATÍVEL
                  </span>
                </div>

                {contract.signatureBase64 && (
                  <div className="border border-slate-200 bg-white p-3 rounded-2xl flex flex-col items-center">
                    <span className="text-[8px] font-bold text-slate-400 uppercase mb-2">Rubrica Salva</span>
                    <img 
                      src={contract.signatureBase64} 
                      alt="Rubrica Eletrônica" 
                      className="max-h-[60px] object-contain"
                      referrerPolicy="no-referrer"
                    />
                  </div>
                )}
              </div>

              <div className="space-y-2 max-w-sm mx-auto">
                <button
                  type="button"
                  onClick={handleDownloadPDF}
                  className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-2xl text-xs font-bold uppercase tracking-wider shadow-md shadow-emerald-100 flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <Download className="w-4 h-4" /> Baixar Cópia em PDF
                </button>
                
                <p className="text-[9px] text-slate-400 leading-normal">
                  Guarde o PDF assinado baixado acima; a empresa também recebe a cópia assinada no sistema.
                </p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

      </main>

      {/* Footer */}
      <footer className="bg-white border-t border-slate-200 py-4 px-6 text-center text-[10px] text-slate-400">
        {contract?.contractorCompany ? `${contract.contractorCompany} · ` : ''}Assinatura eletrônica de contrato
      </footer>
    </div>
  );
}
