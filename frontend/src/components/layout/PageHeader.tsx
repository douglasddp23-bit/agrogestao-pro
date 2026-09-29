import React from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '../../lib/utils';

/**
 * Cabeçalho padrão de TODAS as páginas do sistema.
 *
 * Antes cada página tinha um título diferente (tamanhos text-xl a text-4xl,
 * com e sem ícone, fundos brancos, translúcidos ou nenhum). Agora:
 *  - título = mesmo nome do menu lateral, sempre do mesmo tamanho;
 *  - ícone = o mesmo do menu, num quadrado verde;
 *  - subtítulo = uma linha curta explicando a página;
 *  - ações (botões, abas, busca) ficam à direita.
 *
 * Uso simples:
 *   <PageHeader icon={Users} title="Clientes" subtitle="...">
 *     <button>Novo Cliente</button>
 *   </PageHeader>
 *
 * Em páginas cujo cabeçalho já tem uma estrutura própria de ações, use só o
 * contêiner e o título:
 *   <div className={PAGE_HEADER_CLASS}>
 *     <PageTitle icon={...} title="..." subtitle="..." />
 *     ...ações da página...
 *   </div>
 */
export const PAGE_HEADER_CLASS =
  'flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white/60 dark:bg-slate-900/40 px-5 py-4 rounded-2xl glass border border-white/60 shadow-sm shrink-0';

interface PageTitleProps {
  icon: LucideIcon;
  title: string;
  subtitle?: string;
  badge?: React.ReactNode;
}

export function PageTitle({ icon: Icon, title, subtitle, badge }: PageTitleProps) {
  return (
    <div className="flex items-center gap-3 min-w-0" data-page-title>
      <div className="w-11 h-11 rounded-xl bg-emerald-600 text-white flex items-center justify-center shadow-md shadow-emerald-200/60 shrink-0">
        <Icon className="w-5 h-5" />
      </div>
      <div className="min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <h1 className="text-xl font-display font-bold text-slate-800 dark:text-slate-100 leading-tight tracking-tight">{title}</h1>
          {badge}
        </div>
        {subtitle && <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 leading-snug">{subtitle}</p>}
      </div>
    </div>
  );
}

interface PageHeaderProps extends PageTitleProps {
  children?: React.ReactNode;
  className?: string;
}

export default function PageHeader({ children, className, ...title }: PageHeaderProps) {
  return (
    <header className={cn(PAGE_HEADER_CLASS, className)} data-page-header>
      <PageTitle {...title} />
      {children && <div className="flex flex-wrap items-center gap-2 md:justify-end">{children}</div>}
    </header>
  );
}
