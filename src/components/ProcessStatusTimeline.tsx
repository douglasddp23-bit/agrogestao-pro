import React, { useState } from 'react';
import { 
  CheckCircle2, 
  Circle, 
  Clock, 
  Calendar, 
  Gavel, 
  Scale, 
  FileSpreadsheet, 
  FileCheck2, 
  MapPin, 
  DollarSign, 
  TrendingUp, 
  ChevronRight, 
  Sparkles, 
  ArrowRight,
  ShieldCheck,
  Building2,
  FileText,
  BadgePercent,
  Compass
} from 'lucide-react';
import { motion } from 'motion/react';
import { toast } from 'sonner';
import { doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { cn, formatDate, formatCurrency, todayLocalDateString } from '../lib/utils';
import { JudicialExpertise, RuralPropertyValuation } from '../types';

export interface TimelineStage {
  id: string;
  number: number;
  title: string;
  shortTitle: string;
  subtitle: string;
  regulatoryCode: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  checkpoints: string[];
  fieldHighlights?: (data: any) => { label: string; value: string | React.ReactNode }[];
  isCompleted: (data: any) => boolean;
  isActive: (data: any, completedBefore: boolean) => boolean;
  onAdvance?: (docId: string, currentData: any) => Promise<void>;
}

// ─── STAGES: PERÍCIA JUDICIAL (PJe & CPC 2015) ──────────────────────────
const JUDICIAL_EXPERTISE_STAGES: TimelineStage[] = [
  {
    id: 'stage_nomeacao',
    number: 1,
    title: 'Nomeação & Proposta de Honorários',
    shortTitle: 'Nomeação',
    subtitle: 'Intimação no PJe e Petição de Honorários',
    regulatoryCode: 'CPC Art. 465, § 2º',
    description: 'Ciência da nomeação judicial pelo MM. Juiz, elaboração e protocolo da proposta de honorários periciais com discriminação de horas técnicas e despesas.',
    icon: Gavel,
    checkpoints: [
      'Intimação eletrônica recebida no sistema PJe',
      'Aceite do encargo pericial pelo perito',
      'Petição com proposta circunstanciada de honorários'
    ],
    fieldHighlights: (exp: JudicialExpertise) => [
      { label: 'Comarca / Vara', value: `${exp.comarca || 'N/A'} - ${exp.vara || 'Vara Cível'}` },
      { label: 'Honorários Propostos', value: formatCurrency(exp.honorariosPropostos) },
      { label: 'Status Inicial', value: exp.honorariosStatus === 'aguardando_nomeacao' ? 'Aguardando Despacho' : 'Proposta Registrada' }
    ],
    isCompleted: (exp: JudicialExpertise) => {
      return exp.honorariosStatus !== 'aguardando_nomeacao' && exp.honorariosStatus !== 'nomeado';
    },
    isActive: (exp: JudicialExpertise) => {
      return exp.honorariosStatus === 'aguardando_nomeacao' || exp.honorariosStatus === 'nomeado';
    },
    onAdvance: async (id: string) => {
      await updateDoc(doc(db, 'judicial_expertises', id), {
        honorariosStatus: 'proposta_enviada',
        updatedAt: new Date().toISOString()
      });
    }
  },
  {
    id: 'stage_homologacao',
    number: 2,
    title: 'Homologação & Depósito Judicial',
    shortTitle: 'Honorários',
    subtitle: 'Aprovação pelo Juiz e Depósito em Juízo',
    regulatoryCode: 'CPC Art. 465, § 4º',
    description: 'Manifestação das partes sobre a proposta, decisão interlocutória de fixação de honorários e intimação para depósito na conta judicial vinculada ao processo.',
    icon: DollarSign,
    checkpoints: [
      'Juiz fixa o valor dos honorários periciais',
      'Parte sucumbente/autora intimada para depósito',
      'Comprovante de depósito juntado aos autos'
    ],
    fieldHighlights: (exp: JudicialExpertise) => [
      { label: 'Honorários Aprovados', value: exp.honorariosAprovados ? formatCurrency(exp.honorariosAprovados) : 'Aguardando Homologação' },
      { label: 'Status Financeiro', value: exp.honorariosStatus === 'aprovado' || exp.honorariosStatus === 'alvara_emitido' || exp.honorariosStatus === 'pago' ? 'Homologado pelo Juízo' : 'Pendente de Fixação' },
      { label: 'Alvará Judicial', value: exp.alvaraNumber || 'Aguardando Entrega do Laudo' }
    ],
    isCompleted: (exp: JudicialExpertise) => {
      return ['aprovado', 'alvara_emitido', 'pago'].includes(exp.honorariosStatus) || !!exp.honorariosAprovados;
    },
    isActive: (exp: JudicialExpertise) => {
      return exp.honorariosStatus === 'proposta_enviada' && !exp.honorariosAprovados;
    },
    onAdvance: async (id: string, exp: JudicialExpertise) => {
      await updateDoc(doc(db, 'judicial_expertises', id), {
        honorariosStatus: 'aprovado',
        honorariosAprovados: exp.honorariosAprovados || exp.honorariosPropostos,
        updatedAt: new Date().toISOString()
      });
    }
  },
  {
    id: 'stage_vistoria',
    number: 3,
    title: 'Diligência Pericial (Vistoria de Campo)',
    shortTitle: 'Vistoria In Loco',
    subtitle: 'Inspeção Técnica e Coleta de Dados',
    regulatoryCode: 'CPC Art. 466 e NBR 14.653-3',
    description: 'Comunicação prévia aos assistentes técnicos e advogados sobre a data da diligência. Vistoria in loco, levantamento cadastral, fotos e medições periciais.',
    icon: MapPin,
    checkpoints: [
      'Notificação formal de data aos assistentes técnicos',
      'Diligência presencial no imóvel com coordenadas GPS',
      'Inspeção de benfeitorias, tipologia e uso do solo'
    ],
    fieldHighlights: (exp: JudicialExpertise) => [
      { label: 'Data da Vistoria', value: exp.visitaDate ? formatDate(exp.visitaDate) : 'Não agendada' },
      { label: 'Imóvel Periciado', value: `${exp.propertyName} (${exp.propertyArea || 0} ha)` },
      { label: 'Localização', value: `${exp.propertyCity}/${exp.propertyState}` }
    ],
    isCompleted: (exp: JudicialExpertise) => {
      return !!exp.visitaDate && (exp.laudoStatus === 'em_elaboracao' || exp.laudoStatus === 'concluido' || exp.laudoStatus === 'entregue');
    },
    isActive: (exp: JudicialExpertise) => {
      return !exp.visitaDate || (exp.laudoStatus === 'nao_iniciado' && ['aprovado', 'proposta_enviada'].includes(exp.honorariosStatus));
    },
    onAdvance: async (id: string) => {
      await updateDoc(doc(db, 'judicial_expertises', id), {
        laudoStatus: 'em_elaboracao',
        visitaDate: todayLocalDateString(),
        updatedAt: new Date().toISOString()
      });
    }
  },
  {
    id: 'stage_elaboracao',
    number: 4,
    title: 'Elaboração Técnica & NBR 14.653',
    shortTitle: 'Redação Laudo',
    subtitle: 'Homogeneização, Cálculos e Quesitos',
    regulatoryCode: 'ABNT NBR 14.653-3 / CPC Art. 473',
    description: 'Tratamento de dados comparativos de mercado, avaliação de terra nua e benfeitorias, respostas fundamentadas aos quesitos do juízo e das partes.',
    icon: FileSpreadsheet,
    checkpoints: [
      'Cálculo do valor de terra nua (VTN) e benfeitorias',
      'Respostas aos quesitos do Autor e do Réu',
      'Fechamento do laudo com fundamentação e precisão'
    ],
    fieldHighlights: (exp: JudicialExpertise) => [
      { label: 'Metodologia', value: exp.metodologia || 'Comparativo Direto' },
      { label: 'Norma Aplicada', value: exp.normaAplicada || 'ABNT NBR 14.653-3' },
      { label: 'Prazo Fatal de Entrega', value: exp.laudoDeadline ? formatDate(exp.laudoDeadline) : 'Sem prazo fixado' }
    ],
    isCompleted: (exp: JudicialExpertise) => {
      return exp.laudoStatus === 'concluido' || exp.laudoStatus === 'entregue';
    },
    isActive: (exp: JudicialExpertise) => {
      return exp.laudoStatus === 'em_elaboracao';
    },
    onAdvance: async (id: string) => {
      await updateDoc(doc(db, 'judicial_expertises', id), {
        laudoStatus: 'concluido',
        updatedAt: new Date().toISOString()
      });
    }
  },
  {
    id: 'stage_entrega_alvara',
    number: 5,
    title: 'Protocolo PJe & Alvará de Pagamento',
    shortTitle: 'Protocolo & Alvará',
    subtitle: 'Juntada nos Autos e Liberação dos Honorários',
    regulatoryCode: 'CPC Art. 477',
    description: 'Juntada do laudo pericial oficial no PJe, eventuais esclarecimentos complementares e expedição do alvará judicial com liberação do saldo de honorários.',
    icon: ShieldCheck,
    checkpoints: [
      'Juntada do laudo pericial em PDF no sistema PJe',
      'Manifestação dos assistentes e eventuais esclarecimentos',
      'Expedição do Alvará Judicial e levantamento dos honorários'
    ],
    fieldHighlights: (exp: JudicialExpertise) => [
      { label: 'Status do Laudo', value: exp.laudoStatus === 'entregue' ? 'Protocolado nos Autos' : (exp.laudoStatus === 'concluido' ? 'Pronto para Protocolo' : 'Em Elaboração') },
      { label: 'Número do Alvará', value: exp.alvaraNumber || 'Aguardando Expedição' },
      { label: 'Status do Processo', value: exp.status === 'concluido' ? 'Processo Concluído' : 'Em Andamento' }
    ],
    isCompleted: (exp: JudicialExpertise) => {
      return exp.laudoStatus === 'entregue' && (exp.honorariosStatus === 'pago' || exp.honorariosStatus === 'alvara_emitido');
    },
    isActive: (exp: JudicialExpertise) => {
      return exp.laudoStatus === 'concluido' || (exp.laudoStatus === 'entregue' && exp.honorariosStatus !== 'pago');
    },
    onAdvance: async (id: string) => {
      await updateDoc(doc(db, 'judicial_expertises', id), {
        laudoStatus: 'entregue',
        honorariosStatus: 'alvara_emitido',
        status: 'concluido',
        updatedAt: new Date().toISOString()
      });
    }
  }
];

// ─── STAGES: AVALIAÇÃO DE IMÓVEIS RURAIS (ABNT NBR 14.653-1 / 14.653-3) ──
const RURAL_VALUATION_STAGES: TimelineStage[] = [
  {
    id: 'val_enquadramento',
    number: 1,
    title: 'Contratação & Levantamento Documental',
    shortTitle: 'Enquadramento',
    subtitle: 'Definição de Finalidade e Documentos do Imóvel',
    regulatoryCode: 'NBR 14.653-1 Item 7.1',
    description: 'Definição da finalidade da avaliação (Garantia Bancária, Partilha, Compra e Venda, Desapropriação), certidão de matrícula imobiliária, CAR, CCIR e ITR.',
    icon: FileText,
    checkpoints: [
      'Definição da finalidade e objetivo da avaliação',
      'Levantamento da certidão de matrícula atualizada e CAR',
      'Fixação preliminar do grau de fundamentação desejado'
    ],
    fieldHighlights: (val: RuralPropertyValuation) => [
      { label: 'Finalidade', value: val.purpose?.toUpperCase() || 'Compra / Venda' },
      { label: 'Matrícula / CAR', value: `${val.registrationNumber || 'N/A'} | ${val.car ? 'Possui CAR' : 'Sem CAR'}` },
      { label: 'Solicitante', value: val.clientName || 'Cliente' }
    ],
    isCompleted: (val: RuralPropertyValuation) => {
      return !!val.registrationNumber || !!val.totalArea || !!val.visitaDate || val.status !== 'em_elaboracao';
    },
    isActive: (val: RuralPropertyValuation) => {
      return !val.visitaDate && !val.comparativeData?.reference1?.value;
    },
    onAdvance: async (id: string) => {
      await updateDoc(doc(db, 'rural_valuations', id), {
        updatedAt: new Date().toISOString()
      });
    }
  },
  {
    id: 'val_vistoria',
    number: 2,
    title: 'Vistoria In Loco & Caracterização Física',
    shortTitle: 'Vistoria Técnica',
    subtitle: 'Inspeção Agronômica, Solo e Benfeitorias',
    regulatoryCode: 'NBR 14.653-3 Item 7.3',
    description: 'Inspeção agronômica presencial no imóvel avaliando: relevo, classes de capacidade de uso do solo, recursos hídricos, divisões de pastagem, lavouras e benfeitorias reprodutivas/não reprodutivas.',
    icon: Compass,
    checkpoints: [
      'Vistoria técnica presencial e registro fotográfico',
      'Identificação da classe de solo predominante e recursos hídricos',
      'Inventário detalhado do estado de conservação das benfeitorias'
    ],
    fieldHighlights: (val: RuralPropertyValuation) => [
      { label: 'Área Total / Lavoura', value: `${val.totalArea || 0} ha (${val.agriculturalArea || 0} ha agrícolas)` },
      { label: 'Solo & Água', value: `${val.soilClass || 'Latossolo'} • ${val.waterSource || 'Nascentes'}` },
      { label: 'Data da Vistoria', value: val.visitaDate ? formatDate(val.visitaDate) : 'Pendente de Agendamento' }
    ],
    isCompleted: (val: RuralPropertyValuation) => {
      return !!val.visitaDate || !!val.soilClass || !!val.comparativeData?.reference1?.value;
    },
    isActive: (val: RuralPropertyValuation) => {
      return !val.visitaDate && !val.comparativeData?.reference1?.value;
    },
    onAdvance: async (id: string) => {
      await updateDoc(doc(db, 'rural_valuations', id), {
        visitaDate: todayLocalDateString(),
        updatedAt: new Date().toISOString()
      });
    }
  },
  {
    id: 'val_amostragem',
    number: 3,
    title: 'Pesquisa de Mercado & Amostragem',
    shortTitle: 'Amostragem',
    subtitle: 'Coleta de Dados de Imóveis Comparáveis',
    regulatoryCode: 'NBR 14.653-3 Item 7.4',
    description: 'Pesquisa e coleta de amostras de mercado de imóveis rurais assemelhados na mesma região geográfica e zona agronômica homogênea, com identificação das fontes e atributos relevantes.',
    icon: TrendingUp,
    checkpoints: [
      'Coleta de dados de negócios realizados e ofertas na microrregião',
      'Identificação e saneamento das variáveis de influência',
      'Inserção mínima de 3 amostras representativas'
    ],
    fieldHighlights: (val: RuralPropertyValuation) => [
      { label: 'Amostras Informadas', value: [val.comparativeData?.reference1, val.comparativeData?.reference2, val.comparativeData?.reference3].filter(Boolean).filter(r => r?.value).length + ' referências' },
      { label: 'Distância à Cidade', value: `${val.distanceToCity || 0} km (${val.roadType || 'misto'})` },
      { label: 'Atividade Principal', value: val.mainActivity || 'Agropecuária' }
    ],
    isCompleted: (val: RuralPropertyValuation) => {
      return !!(val.comparativeData?.reference1?.value || (val.landValuePerHa && val.landValuePerHa > 0));
    },
    isActive: (val: RuralPropertyValuation) => {
      return !val.comparativeData?.reference1?.value && (!val.landValuePerHa || val.landValuePerHa === 0);
    },
    onAdvance: async (id: string, val: RuralPropertyValuation) => {
      await updateDoc(doc(db, 'rural_valuations', id), {
        landValuePerHa: val.landValuePerHa || 15000,
        updatedAt: new Date().toISOString()
      });
    }
  },
  {
    id: 'val_homogeneizacao',
    number: 4,
    title: 'Tratamento dos Dados & Homogeneização',
    shortTitle: 'Homogeneização',
    subtitle: 'Aplicação do Método Comparativo Direto',
    regulatoryCode: 'NBR 14.653-3 Item 8',
    description: 'Tratamento estatístico por fatores de homogeneização (fator área, situação, relevo, benfeitorias, transação) para determinação do Valor da Terra Nua (VTN) unitário e valor total.',
    icon: BadgePercent,
    checkpoints: [
      'Aplicação dos fatores de homogeneização ou regressão linear',
      'Determinação do Grau de Fundamentação e Precisão (Grau I, II ou III)',
      'Cálculo do valor das benfeitorias reprodutivas e não reprodutivas'
    ],
    fieldHighlights: (val: RuralPropertyValuation) => [
      { label: 'VTN Médio Apurado', value: val.landValuePerHa ? `${formatCurrency(val.landValuePerHa)}/ha` : 'Aguardando Cálculo' },
      { label: 'Valor Benfeitorias', value: formatCurrency(val.improvementsValue || 0) },
      { label: 'Grau NBR', value: `Grau ${val.fundamentationDegree || 'II'}` }
    ],
    isCompleted: (val: RuralPropertyValuation) => {
      return !!val.totalValue && val.totalValue > 0 && (val.status === 'concluido' || val.status === 'entregue');
    },
    isActive: (val: RuralPropertyValuation) => {
      return val.status === 'em_elaboracao' && (val.landValuePerHa || 0) > 0;
    },
    onAdvance: async (id: string, val: RuralPropertyValuation) => {
      const calculatedTotal = (val.totalValue && val.totalValue > 0) 
        ? val.totalValue 
        : ((val.landValuePerHa || 15000) * (val.totalArea || 1) + (val.improvementsValue || 0));
      await updateDoc(doc(db, 'rural_valuations', id), {
        totalValue: calculatedTotal,
        status: 'concluido',
        updatedAt: new Date().toISOString()
      });
    }
  },
  {
    id: 'val_emissao',
    number: 5,
    title: 'Laudo Pericial NBR 14.653 & ART/TRT',
    shortTitle: 'Emissão & ART',
    subtitle: 'Consolidação Final e Entrega do Laudo',
    regulatoryCode: 'NBR 14.653-3 Item 9 / CONFEA',
    description: 'Emissão formal do Laudo de Avaliação Rural impresso/digital com memorial fotográfico, anotação de ART/TRT no conselho de classe e entrega oficial ao cliente.',
    icon: FileCheck2,
    checkpoints: [
      'Geração e assinatura digital do Laudo Técnico Completo',
      'Anotação de Responsabilidade Técnica (ART/CREA ou TRT/CFT)',
      'Entrega final e integração ao Dossiê Digital do Cliente'
    ],
    fieldHighlights: (val: RuralPropertyValuation) => [
      { label: 'Valor Mercadológico Total', value: formatCurrency(val.totalValue || ((val.landValuePerHa || 0) * val.totalArea + (val.improvementsValue || 0))) },
      { label: 'Status da Avaliação', value: val.status === 'entregue' ? 'Entregue ao Cliente' : (val.status === 'concluido' ? 'Concluído (Pronto)' : 'Em Elaboração') },
      { label: 'Data do Relatório', value: val.reportDate ? formatDate(val.reportDate) : formatDate(new Date()) }
    ],
    isCompleted: (val: RuralPropertyValuation) => {
      return val.status === 'entregue';
    },
    isActive: (val: RuralPropertyValuation) => {
      return val.status === 'concluido';
    },
    onAdvance: async (id: string) => {
      await updateDoc(doc(db, 'rural_valuations', id), {
        status: 'entregue',
        reportDate: todayLocalDateString(),
        updatedAt: new Date().toISOString()
      });
    }
  }
];

interface ProcessStatusTimelineProps {
  mode: 'judicial_expertise' | 'rural_valuation';
  record: JudicialExpertise | RuralPropertyValuation;
  onRefresh?: () => void;
}

export default function ProcessStatusTimeline({
  mode,
  record,
  onRefresh
}: ProcessStatusTimelineProps) {
  const stages = mode === 'judicial_expertise' ? JUDICIAL_EXPERTISE_STAGES : RURAL_VALUATION_STAGES;
  
  // Calculate completed steps
  let lastCompletedIndex = -1;
  stages.forEach((stage, idx) => {
    if (stage.isCompleted(record)) {
      lastCompletedIndex = idx;
    }
  });

  // Default active view to the currently active step or the next pending step
  const activeStageIndex = Math.min(Math.max(lastCompletedIndex + 1, 0), stages.length - 1);
  const [selectedStageIndex, setSelectedStageIndex] = useState<number>(activeStageIndex);
  const [isUpdating, setIsUpdating] = useState(false);

  const selectedStage = stages[selectedStageIndex];
  const progressPercent = Math.round(((lastCompletedIndex + 1) / stages.length) * 100);

  const handleAdvanceStage = async () => {
    if (!selectedStage.onAdvance || !record.id) return;
    setIsUpdating(true);
    try {
      await selectedStage.onAdvance(record.id, record);
      toast.success(`Etapa "${selectedStage.shortTitle}" atualizada com sucesso!`);
      if (onRefresh) onRefresh();
    } catch (err: any) {
      console.error('Error updating stage:', err);
      toast.error('Erro ao atualizar etapa: ' + (err.message || 'Falha de rede'));
    } finally {
      setIsUpdating(false);
    }
  };

  return (
    <div className="bg-white dark:bg-slate-900 rounded-3xl p-5 border border-slate-200/80 dark:border-slate-800 shadow-xs space-y-4 text-left">
      {/* Header with Title & Overall Progress */}
      <div className="flex items-center justify-between gap-2 border-b border-slate-100 dark:border-slate-800/80 pb-3.5">
        <div className="flex items-center gap-2.5">
          <div className={cn(
            "p-2.5 rounded-2xl shrink-0",
            mode === 'judicial_expertise' 
              ? "bg-slate-50 dark:bg-emerald-950/40 text-slate-600 dark:text-slate-400" 
              : "bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400"
          )}>
            {mode === 'judicial_expertise' ? <Scale className="w-5 h-5" /> : <Building2 className="w-5 h-5" />}
          </div>
          <div>
            <h4 className="text-xs font-display font-bold text-slate-800 dark:text-slate-100 flex items-center gap-1.5">
              <span>{mode === 'judicial_expertise' ? 'Rito Pericial PJe / TJMG' : 'Rito Avaliatório NBR 14.653'}</span>
              <span className="text-[9px] font-mono px-1.5 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 font-bold uppercase">
                {mode === 'judicial_expertise' ? 'CPC Art. 465' : 'ABNT NBR'}
              </span>
            </h4>
            <p className="text-[10.5px] text-slate-500 dark:text-slate-400">
              Etapa {activeStageIndex + 1} de {stages.length}: <strong className="text-slate-700 dark:text-slate-200">{stages[activeStageIndex]?.title}</strong>
            </p>
          </div>
        </div>

        {/* Progress percent pill */}
        <div className="flex flex-col items-end">
          <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300">
            <Sparkles className="w-2.5 h-2.5" />
            {progressPercent}% Concluído
          </span>
          <span className="text-[9px] text-slate-400 font-semibold mt-0.5">
            {lastCompletedIndex + 1} de {stages.length} marcos
          </span>
        </div>
      </div>

      {/* Graphical Step Nodes Bar */}
      <div className="relative pt-2 pb-1">
        {/* Background Track Line */}
        <div className="absolute top-[22px] left-5 right-5 h-1 bg-slate-100 dark:bg-slate-800 rounded-full z-0" />
        
        {/* Active Filled Track Line */}
        <div 
          className="absolute top-[22px] left-5 h-1 bg-emerald-500 rounded-full transition-all duration-500 z-0" 
          style={{ 
            width: `calc(${(Math.max(lastCompletedIndex, 0) / (stages.length - 1)) * 100}% - 10px)` 
          }}
        />

        {/* Nodes Grid */}
        <div className="grid grid-cols-5 gap-1 relative z-10">
          {stages.map((stage, idx) => {
            const isCompleted = idx <= lastCompletedIndex;
            const isCurrent = idx === activeStageIndex;
            const isSelected = idx === selectedStageIndex;
            const IconComp = stage.icon;

            return (
              <button
                key={stage.id}
                type="button"
                onClick={() => setSelectedStageIndex(idx)}
                className="flex flex-col items-center group cursor-pointer text-center focus:outline-hidden"
              >
                <div 
                  className={cn(
                    "w-9 h-9 rounded-full flex items-center justify-center font-bold text-xs transition-all duration-200 border-2",
                    isSelected ? "ring-2 ring-emerald-500 ring-offset-2 dark:ring-offset-slate-900 scale-105" : "",
                    isCompleted
                      ? "bg-emerald-600 border-emerald-600 text-white shadow-xs"
                      : isCurrent
                      ? "bg-amber-500 border-amber-500 text-white animate-pulse shadow-xs"
                      : "bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-700 text-slate-400 group-hover:border-emerald-400"
                  )}
                >
                  {isCompleted ? (
                    <CheckCircle2 className="w-4 h-4" />
                  ) : (
                    <span>{stage.number}</span>
                  )}
                </div>

                <div className="mt-2 space-y-0.5">
                  <span className={cn(
                    "text-[10px] font-bold block truncate max-w-[70px] leading-tight transition-colors",
                    isSelected ? "text-emerald-700 dark:text-emerald-400 font-extrabold" : "text-slate-600 dark:text-slate-400 group-hover:text-slate-900"
                  )}>
                    {stage.shortTitle}
                  </span>
                  <span className="text-[8px] font-semibold text-slate-400 block uppercase tracking-tighter">
                    {isCompleted ? 'Concluído' : isCurrent ? 'Em Curso' : 'A Iniciar'}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Selected Stage Detail Card */}
      <motion.div 
        key={selectedStage.id}
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2 }}
        className="bg-slate-50 dark:bg-slate-800/60 rounded-2xl p-4 border border-slate-100 dark:border-slate-700/70 space-y-3"
      >
        {/* Stage Header Info */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-2.5">
            <div className="p-2 bg-white dark:bg-slate-900 rounded-xl shadow-xs border border-slate-100 dark:border-slate-800 text-emerald-600 shrink-0 mt-0.5">
              <selectedStage.icon className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-bold text-slate-800 dark:text-slate-100">
                  Etapa {selectedStage.number}: {selectedStage.title}
                </span>
                <span className="text-[9px] font-mono font-bold px-2 py-0.5 rounded-full bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300">
                  {selectedStage.regulatoryCode}
                </span>
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 leading-relaxed">
                {selectedStage.description}
              </p>
            </div>
          </div>

          <span className={cn(
            "text-[9px] font-extrabold px-2 py-0.5 rounded-full uppercase tracking-wider shrink-0",
            selectedStageIndex <= lastCompletedIndex 
              ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
              : selectedStageIndex === activeStageIndex 
              ? "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300" 
              : "bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-400"
          )}>
            {selectedStageIndex <= lastCompletedIndex ? 'Concluída' : selectedStageIndex === activeStageIndex ? 'Etapa Atual' : 'Pendente'}
          </span>
        </div>

        {/* Dynamic Parameter Highlights */}
        {selectedStage.fieldHighlights && (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 pt-2 border-t border-slate-200/60 dark:border-slate-700/60 text-xs">
            {selectedStage.fieldHighlights(record).map((item, i) => (
              <div key={i} className="bg-white dark:bg-slate-900 p-2 rounded-xl border border-slate-100 dark:border-slate-800/80">
                <span className="text-[9px] font-bold uppercase text-slate-400 block">{item.label}</span>
                <span className="font-bold text-slate-700 dark:text-slate-200 text-[11px] truncate block">{item.value}</span>
              </div>
            ))}
          </div>
        )}

        {/* Checkpoints List */}
        <div className="space-y-1.5 pt-1">
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
            Critérios do Rito Processual / ABNT:
          </span>
          <div className="space-y-1">
            {selectedStage.checkpoints.map((cp, idx) => (
              <div key={idx} className="flex items-center gap-2 text-[11px] text-slate-600 dark:text-slate-300">
                <CheckCircle2 className={cn(
                  "w-3.5 h-3.5 shrink-0",
                  selectedStageIndex <= lastCompletedIndex ? "text-emerald-600" : "text-slate-300 dark:text-slate-600"
                )} />
                <span>{cp}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Fast Action Footer */}
        {selectedStageIndex === activeStageIndex && (
          <div className="pt-2 border-t border-slate-200/60 dark:border-slate-700/60 flex items-center justify-between gap-2">
            <span className="text-[10px] font-semibold text-slate-500 dark:text-slate-400 italic">
              Concluiu as exigências deste marco?
            </span>
            <button
              type="button"
              disabled={isUpdating}
              onClick={handleAdvanceStage}
              className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-[10.5px] font-bold uppercase tracking-wider flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50 shadow-xs"
            >
              <ArrowRight className="w-3.5 h-3.5" />
              Avançar Marco
            </button>
          </div>
        )}
      </motion.div>
    </div>
  );
}
