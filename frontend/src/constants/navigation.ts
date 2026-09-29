import {
  LayoutDashboard, Users, ClipboardCheck, Map, Droplet, FileText,
  UsersRound, Clock, Wallet, ShieldCheck, DollarSign, BarChart3,
  Package, ClipboardList, FilePen, Car,
  CalendarDays, History, Scale, Landmark
} from 'lucide-react';
import { UserRole } from '../lib/permissions';

export interface NavItem {
  id: string;
  key: string;
  label: string;
  icon: any;
  group: string;
  roles?: UserRole[];
}

export const NAV_ITEMS: NavItem[] = [
  { id: 'dashboard',              key: 'dashboard',           label: 'Dashboard',              icon: LayoutDashboard, group: 'Operacional' },
  { id: 'clients',                key: 'clients',             label: 'Clientes',               icon: Users,           group: 'Operacional' },
  { id: 'field_visits',           key: 'field_visits',        label: 'Visitas de Campo',       icon: ClipboardList,   group: 'Operacional' },
  { id: 'scheduling',             key: 'scheduling',          label: 'Agendamentos',           icon: CalendarDays,    group: 'Operacional' },

  { id: 'judicial-expertise',     key: 'judicial_expertise',  label: 'Perícia Judicial',       icon: Scale,           group: 'Serviços' },
  { id: 'analysis',               key: 'analyses',            label: 'Análises Técnicas',      icon: ClipboardCheck,  group: 'Serviços' },
  { id: 'analysis_irrigation',    key: 'irrigation',          label: 'Irrigação',              icon: Droplet,         group: 'Serviços' },
  { id: 'analysis_documentation', key: 'regularization',      label: 'Regularização Ambiental',icon: ShieldCheck,     group: 'Serviços' },
  { id: 'analysis_topography',    key: 'topography',          label: 'Topografia',             icon: Map,             group: 'Serviços' },
  { id: 'analysis_credit',        key: 'rural_credit',        label: 'Crédito Rural',          icon: Wallet,          group: 'Serviços' },
  // As 4 telas abaixo já existiam no sistema, mas não tinham item no menu (ficavam inacessíveis).
  { id: 'rural_valuation',        key: 'rural_valuation',     label: 'Avaliação de Imóveis',   icon: Landmark,        group: 'Serviços' },

  { id: 'financial',              key: 'financial',           label: 'Financeiro',             icon: DollarSign,      group: 'Gestão' },
  { id: 'reports',                key: 'reports',             label: 'Relatórios',             icon: BarChart3,       group: 'Gestão' },
  { id: 'inventory',              key: 'inventory',           label: 'Estoque / Insumos',      icon: Package,         group: 'Gestão' },

  { id: 'hr',                     key: 'hr',                  label: 'Ponto Eletrônico',       icon: Clock,           group: 'Equipe/RH' },
  { id: 'vehicles',               key: 'vehicles',            label: 'Veículos / Km',          icon: Car,             group: 'Equipe/RH' },
  { id: 'users',                  key: 'users',               label: 'Usuários',               icon: UsersRound,      group: 'Equipe/RH' },

  { id: 'contracts',              key: 'contracts',           label: 'Contratos',              icon: FilePen,         group: 'Administrativo' },
  { id: 'documents',              key: 'documents',           label: 'Documentos',             icon: FileText,        group: 'Administrativo' },
  { id: 'audit_logs',             key: 'audit_logs',          label: 'Auditoria Global',       icon: History,         group: 'Administrativo' },
];
