import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Sparkles, 
  ChevronRight, 
  ChevronLeft, 
  X, 
  TrendingUp, 
  FileText, 
  Map, 
  Calendar, 
  Palette, 
  CheckCircle2,
  HelpCircle
} from 'lucide-react';

interface TourStep {
  title: string;
  description: string;
  icon: React.ComponentType<any>;
  iconColor: string;
  badge: string;
  featureTip: string;
}

const TOUR_STEPS: TourStep[] = [
  {
    title: "Bem-vindo ao AgroGestão Pro!",
    description: "Sua plataforma completa de inteligência agrícola, planejamento financeiro, contratos digitais e regulação técnica integrada em um único lugar.",
    icon: Sparkles,
    iconColor: "text-amber-500 bg-amber-50",
    badge: "Boas-vindas",
    featureTip: "Dica: Você pode personalizar o nome e logotipo de sua empresa na aba de Configurações de Branding no menu!"
  },
  {
    title: "Contratos Digitais & Versões",
    description: "Crie contratos sofisticados, gerencie as revisões de texto linha por linha (Diff Visual), colete assinaturas digitais desenhadas na tela e gere PDFs oficiais instantaneamente.",
    icon: FileText,
    iconColor: "text-slate-600 bg-slate-50",
    badge: "Módulo Contratos",
    featureTip: "Dica: A aba de Histórico de Cláusulas possui controle de versão completo para atender auditorias."
  },
  {
    title: "Inteligência & Solo (Laudos)",
    description: "Registre análises completas de solo, água e foliar, e acompanhe os serviços técnicos (irrigação, topografia, regularização, crédito, avaliação e perícia) de cada propriedade.",
    icon: Map,
    iconColor: "text-emerald-600 bg-emerald-50",
    badge: "Módulo de Análises",
    featureTip: "Dica: Ao finalizar um serviço, gere o relatório em PDF com a logo da empresa."
  },
  {
    title: "Agenda & Visitas Técnicas",
    description: "Planeje visitas, registre rotas de veículos, controle custos de combustível, gerencie manutenções de frota e mantenha a equipe alinhada com as tarefas da lavoura.",
    icon: Calendar,
    iconColor: "text-slate-650 bg-slate-50",
    badge: "Planejamento Físico",
    featureTip: "Dica: O painel possui widgets integrados de previsão de tempo para 5 dias e alertas de chuva."
  },
  {
    title: "Configurações de Branding",
    description: "Altere as cores, nome e logotipo da empresa em segundos para dar ao sistema o visual próprio da sua marca ou cooperativa agrícola.",
    icon: Palette,
    iconColor: "text-rose-500 bg-rose-50",
    badge: "Personalização",
    featureTip: "Dica: As alterações de logotipo e slogan são aplicadas em tempo real em todas as telas e PDFs!"
  }
];

export default function QuickTipsTour() {
  const [isOpen, setIsOpen] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [showFloatingButton, setShowFloatingButton] = useState(false);

  useEffect(() => {
    // Check if user has seen the tour before
    const hasSeen = localStorage.getItem('agro_has_seen_tour_v2');
    if (!hasSeen) {
      // Small delay for natural appearance
      const timer = setTimeout(() => {
        setIsOpen(true);
      }, 1500);
      return () => clearTimeout(timer);
    } else {
      setShowFloatingButton(true);
    }
  }, []);

  const handleClose = () => {
    localStorage.setItem('agro_has_seen_tour_v2', 'true');
    setIsOpen(false);
    setShowFloatingButton(true);
  };

  const handleNext = () => {
    if (currentStep < TOUR_STEPS.length - 1) {
      setCurrentStep(prev => prev + 1);
    } else {
      handleClose();
    }
  };

  const handlePrev = () => {
    if (currentStep > 0) {
      setCurrentStep(prev => prev - 1);
    }
  };

  const activeStep = TOUR_STEPS[currentStep];
  const StepIcon = activeStep?.icon || Sparkles;

  return (
    <>
      {/* Mini floating help trigger on bottom-right corner if already completed */}
      {showFloatingButton && (
        <button
          onClick={() => {
            setCurrentStep(0);
            setIsOpen(true);
          }}
          className="fixed bottom-6 right-6 z-40 p-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-full shadow-lg hover:shadow-emerald-500/20 transition-all group flex items-center gap-2 cursor-pointer border border-emerald-400"
          title="Ver Tour de Dicas Rápidas"
          id="quick-tips-floating-btn"
        >
          <HelpCircle className="w-5 h-5 animate-pulse" />
          <span className="max-w-0 overflow-hidden group-hover:max-w-xs transition-all duration-350 text-xs font-bold uppercase tracking-wider block">
            Guia Rápido
          </span>
        </button>
      )}

      <AnimatePresence>
        {isOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm">
            {/* Modal Card wrapper */}
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 15 }}
              transition={{ type: "spring", duration: 0.4 }}
              className="relative w-full max-w-lg bg-white rounded-3xl border border-slate-100 shadow-2xl overflow-hidden flex flex-col"
              id="quick-tips-modal"
            >
              {/* Header bar / Background gradient graphic */}
              <div className="absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-emerald-500 via-emerald-600 to-rose-500" />

              {/* Close Button */}
              <button
                onClick={handleClose}
                className="absolute top-4 right-4 p-1.5 hover:bg-slate-50 text-slate-400 hover:text-slate-600 rounded-xl transition-colors cursor-pointer"
                aria-label="Fechar Guia"
              >
                <X className="w-4 h-4" />
              </button>

              {/* Content body */}
              <div className="p-6 md:p-8 flex-1">
                {/* Badge */}
                <div className="mb-4">
                  <span className="inline-flex items-center gap-1 text-[10px] bg-slate-100 text-slate-700 font-bold px-2.5 py-1 rounded-full uppercase tracking-widest border border-slate-200">
                    <Sparkles className="w-3 h-3 text-amber-500" />
                    {activeStep.badge}
                  </span>
                </div>

                <div className="flex flex-col items-center text-center space-y-4">
                  {/* Decorative Icon Container with smooth scale transition */}
                  <motion.div 
                    key={currentStep}
                    initial={{ scale: 0.8, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ type: "spring", stiffness: 200, damping: 15 }}
                    className={`w-16 h-16 rounded-2xl flex items-center justify-center ${activeStep.iconColor} shadow-inner border border-slate-100/50`}
                  >
                    <StepIcon className="w-8 h-8" />
                  </motion.div>

                  {/* Text Description with slide transitions */}
                  <div className="space-y-2 max-w-sm">
                    <motion.h2 
                      key={`title-${currentStep}`}
                      initial={{ opacity: 0, y: 5 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="text-lg font-display font-bold text-slate-800 leading-snug"
                    >
                      {activeStep.title}
                    </motion.h2>
                    <motion.p 
                      key={`desc-${currentStep}`}
                      initial={{ opacity: 0, y: 5 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="text-xs text-slate-500 leading-relaxed font-normal"
                    >
                      {activeStep.description}
                    </motion.p>
                  </div>

                  {/* Feature Tip Callout Box */}
                  <motion.div 
                    key={`tip-${currentStep}`}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="w-full bg-slate-50 border border-slate-150 p-3 rounded-2xl text-left flex items-start gap-2.5"
                  >
                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 mt-1.5 shrink-0 animate-pulse" />
                    <p className="text-[11px] text-slate-600 leading-relaxed font-medium">
                      {activeStep.featureTip}
                    </p>
                  </motion.div>
                </div>
              </div>

              {/* Footer controls */}
              <div className="bg-slate-50/75 border-t border-slate-100 px-6 py-4 flex items-center justify-between gap-4">
                {/* Dots Indicator */}
                <div className="flex items-center gap-1.5">
                  {TOUR_STEPS.map((_, idx) => (
                    <button
                      key={idx}
                      onClick={() => setCurrentStep(idx)}
                      className={`h-1.5 rounded-full transition-all duration-300 ${
                        idx === currentStep ? 'w-5 bg-emerald-600' : 'w-1.5 bg-slate-300 hover:bg-slate-400'
                      }`}
                      aria-label={`Ir para passo ${idx + 1}`}
                    />
                  ))}
                </div>

                {/* Navigation Buttons */}
                <div className="flex items-center gap-2">
                  {currentStep > 0 && (
                    <button
                      onClick={handlePrev}
                      className="px-3 py-1.5 border border-slate-200 hover:bg-white text-slate-600 font-bold text-xs uppercase rounded-xl flex items-center gap-1 transition-all cursor-pointer"
                    >
                      <ChevronLeft className="w-3.5 h-3.5" />
                      Voltar
                    </button>
                  )}

                  <button
                    onClick={handleNext}
                    className="px-4 py-1.5 bg-emerald-650 hover:bg-emerald-700 text-white font-bold text-xs uppercase rounded-xl flex items-center gap-1 transition-all cursor-pointer shadow-md shadow-emerald-500/10"
                  >
                    {currentStep === TOUR_STEPS.length - 1 ? (
                      <>
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        Finalizar
                      </>
                    ) : (
                      <>
                        Avançar
                        <ChevronRight className="w-3.5 h-3.5" />
                      </>
                    )}
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </>
  );
}
