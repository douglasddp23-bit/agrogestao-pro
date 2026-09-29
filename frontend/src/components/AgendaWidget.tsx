import React, { useState, useEffect, useMemo } from 'react';
import { 
  Clock, 
  Search, 
  MapPin, 
  User, 
  ClipboardCheck, 
  AlertCircle,
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  Video,
  Phone,
  Truck,
  HelpCircle} from 'lucide-react';
import { motion } from 'motion/react';
import { collection, onSnapshot } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { cn, handleFirestoreError, OperationType, safeUrl } from '../lib/utils';
import { useAuth } from '../contexts/AuthContext';
import { 
  format, 
  addMonths, 
  subMonths, 
  startOfMonth, 
  endOfMonth, 
  startOfWeek, 
  endOfWeek, 
  eachDayOfInterval, 
  isSameMonth, 
  isSameDay, 
  parseISO,
  isToday
} from 'date-fns';
import { ptBR } from 'date-fns/locale';

interface UnifiedEvent {
  id: string;
  isAvulso: boolean;
  type: 'analysis' | 'topography' | 'irrigation' | 'visit' | 'reuniao' | 'ligacao' | 'entrega' | 'outro';
  clientName: string;
  scheduledDate: string; // ISO date-time or YYYY-MM-DD
  status: string;
  title: string;
  descriptionOrService: string;
  responsible?: string;
  propertyName?: string;
  externalLink?: string;
  notes?: string;
}

export default function AgendaWidget() {
  const { user } = useAuth();
  const [searchTerm, setSearchTerm] = useState('');
  const [events, setEvents] = useState<UnifiedEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterType, setFilterType] = useState<'all' | 'services' | 'avulso'>('all');
  
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState(new Date());

  // Subscribe to all sources of scheduling
  useEffect(() => {
    const collections = [
      { name: 'analyses', type: 'analysis', isAvulso: false },
      { name: 'topography_services', type: 'topography', isAvulso: false },
      { name: 'irrigation_projects', type: 'irrigation', isAvulso: false },
      { name: 'regularization_services', type: 'analysis', isAvulso: false },
      { name: 'field_visits', type: 'visit', isAvulso: false },
      { name: 'agenda_events', type: 'avulso', isAvulso: true }
    ];

    const unsubscribes = collections.map(coll => {
      return onSnapshot(collection(db, coll.name), (snapshot) => {
        const collEvents: UnifiedEvent[] = snapshot.docs.map(doc => {
          const data = doc.data();
          const scheduledDate = data.date || data.scheduledDate || data.collectionDate || data.visitDate || '';
          
          let eventType = coll.type as any;
          if (coll.isAvulso) {
            eventType = data.type || 'outro';
          }

          return {
            id: doc.id,
            isAvulso: coll.isAvulso,
            type: eventType,
            clientName: data.clientName || (data.clientId ? 'Cliente' : 'Compromisso Geral'),
            scheduledDate: scheduledDate,
            status: data.status || data.syncStatus || 'Pendente',
            title: data.title || (coll.isAvulso ? data.notes : ''),
            descriptionOrService: data.title || (coll.isAvulso ? (data.notes || 'Compromisso') :
                                 coll.type === 'topography' ? (data.serviceLabel || 'Topografia') : 
                                 coll.type === 'visit' ? `Visita: ${data.propertyName || 'Propriedade'}` :
                                 (data.type === 'drip' ? 'Irrigação: Gotejamento' : data.type === 'sprinkler' ? 'Irrigação: Aspersão' : data.description || 'Análise')),
            responsible: data.responsibleTechnician || data.technicalResponsible || data.technicianName || data.responsibleName || data.responsible || '',
            propertyName: data.propertyName || '',
            externalLink: data.externalLink || '',
            notes: data.notes || ''
          };
        });
        
        setEvents(prev => {
          const incomingIds = new Set(collEvents.map(s => s.id));
          const otherEvents = prev.filter(s => !incomingIds.has(s.id));
          
          return [...otherEvents, ...collEvents].sort((a, b) => {
             if (!a.scheduledDate) return 1;
             if (!b.scheduledDate) return -1;
             return a.scheduledDate.localeCompare(b.scheduledDate);
          });
        });
        setLoading(false);
      }, (error) => {
        handleFirestoreError(error, OperationType.LIST, coll.name);
      });
    });

    return () => unsubscribes.forEach(unsub => unsub());
  }, []);

  const calendarDays = useMemo(() => {
    const monthStart = startOfMonth(currentMonth);
    const monthEnd = endOfMonth(monthStart);
    const startDate = startOfWeek(monthStart, { locale: ptBR });
    const endDate = endOfWeek(monthEnd, { locale: ptBR });

    return eachDayOfInterval({ start: startDate, end: endDate });
  }, [currentMonth]);

  const nextMonth = () => setCurrentMonth(addMonths(currentMonth, 1));
  const prevMonth = () => setCurrentMonth(subMonths(currentMonth, 1));
  const goToToday = () => {
    setCurrentMonth(new Date());
    setSelectedDate(new Date());
  };

  const getEventsForDay = (day: Date) => {
    return events.filter(e => {
      if (!e.scheduledDate) return false;
      try {
        const date = parseISO(e.scheduledDate.substring(0, 10)); // compare only YYYY-MM-DD
        const matchesDay = isSameDay(day, date);
        const matchesSearch = (e.clientName || '').toLowerCase().includes(searchTerm.toLowerCase()) || 
                             (e.descriptionOrService || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
                             (e.title && (e.title || '').toLowerCase().includes(searchTerm.toLowerCase()));
        
        let matchesType = true;
        if (filterType === 'services') {
          matchesType = !e.isAvulso;
        } else if (filterType === 'avulso') {
          matchesType = e.isAvulso;
        }

        return matchesDay && matchesSearch && matchesType;
      } catch (err) {
        return false;
      }
    });
  };

  const filteredEventsForSelectedDay = useMemo(() => {
    return getEventsForDay(selectedDate);
  }, [events, selectedDate, searchTerm, filterType]);

  return (
    <div id="dashboard-agenda-widget" className="bg-white/40 glass p-6 rounded-[2rem] flex flex-col gap-6 shadow-sm border border-white/40 w-full mt-6">
      
      {/* Header and Controls */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 pb-2 border-b border-slate-100/50">
        <div>
          <div className="flex items-center gap-2">
            <span className="p-2 bg-emerald-600 text-white rounded-xl shadow-md">
              <CalendarIcon className="w-5 h-5" />
            </span>
            <h2 className="text-xl font-display font-bold text-slate-800">Agenda — Próximos Serviços & Compromissos</h2>
          </div>
          <p className="text-xs text-slate-500 mt-1">Veja seus serviços de campo e compromissos avulsos integrados</p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input 
              type="text" 
              placeholder="Buscar agendamentos..." 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9 pr-4 py-2 glass-input text-xs w-52 bg-white/50"
            />
          </div>

          <div className="flex bg-white/50 p-1 rounded-xl border border-white/60">
            <button 
              onClick={() => setFilterType('all')}
              className={cn(
                "px-2.5 py-1 rounded-lg text-[9px] font-bold uppercase transition-all",
                filterType === 'all' ? "bg-emerald-600 text-white" : "text-slate-500 hover:bg-white"
              )}
            >
              Tudo
            </button>
            <button 
              onClick={() => setFilterType('services')}
              className={cn(
                "px-2.5 py-1 rounded-lg text-[9px] font-bold uppercase transition-all",
                filterType === 'services' ? "bg-emerald-50 text-emerald-700" : "text-slate-500 hover:bg-white"
              )}
            >
              Módulos (Verde)
            </button>
            <button 
              onClick={() => setFilterType('avulso')}
              className={cn(
                "px-2.5 py-1 rounded-lg text-[9px] font-bold uppercase transition-all",
                filterType === 'avulso' ? "bg-slate-50 text-slate-700" : "text-slate-500 hover:bg-white"
              )}
            >
              Avulsos (Azul)
            </button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        
        {/* Monthly Calendar View */}
        <div className="xl:col-span-2 flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <h3 className="font-display font-medium text-slate-800 capitalize text-md">
                {format(currentMonth, 'MMMM yyyy', { locale: ptBR })}
              </h3>
              <div className="flex gap-1">
                <button onClick={prevMonth} className="p-1 hover:bg-white/60 rounded-lg transition-colors text-slate-400 hover:text-emerald-600 border border-transparent hover:border-emerald-100">
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <button onClick={nextMonth} className="p-1 hover:bg-white/60 rounded-lg transition-colors text-slate-400 hover:text-emerald-600 border border-transparent hover:border-emerald-100">
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
            
            <button 
              onClick={goToToday}
              className="px-2.5 py-1 bg-white/60 hover:bg-white text-emerald-600 text-[9px] font-bold uppercase tracking-wider rounded-lg border border-emerald-100 transition-all"
            >
              Hoje
            </button>
          </div>

          {/* Calendar Grid */}
          <div className="flex-1 flex flex-col min-h-0">
            <div className="grid grid-cols-7 mb-1 text-center">
              {['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'].map(day => (
                <div key={day} className="text-[9px] font-bold text-slate-400 uppercase tracking-wider py-1">
                  {day}
                </div>
              ))}
            </div>

            <div className="grid grid-cols-7 border border-slate-100/50 rounded-2xl overflow-hidden divide-x divide-y divide-slate-100/30">
              {calendarDays.map((day, idx) => {
                const dayEvents = getEventsForDay(day);
                const isCurrentMonth = isSameMonth(day, currentMonth);
                const isSelected = isSameDay(day, selectedDate);
                const isDayToday = isToday(day);

                return (
                  <div 
                    key={idx}
                    onClick={() => setSelectedDate(day)}
                    className={cn(
                      "min-h-[75px] p-1.5 flex flex-col gap-1 transition-all cursor-pointer relative",
                      !isCurrentMonth ? "bg-slate-50/20 text-slate-300" : "bg-white/40 hover:bg-emerald-50/30 text-slate-700",
                      isSelected ? "ring-2 ring-emerald-500/20 bg-emerald-50/40 z-10" : ""
                    )}
                  >
                    <div className="flex justify-between items-start">
                      <span className={cn(
                        "text-[10px] font-bold w-5 h-5 flex items-center justify-center rounded-lg transition-colors",
                        isDayToday ? "bg-emerald-600 text-white shadow-md shadow-emerald-100" : 
                        isSelected ? "bg-emerald-100 text-emerald-700" : ""
                      )}>
                        {format(day, 'd')}
                      </span>
                      {dayEvents.length > 0 && (
                        <div className="flex items-center gap-0.5">
                           <div className={cn("w-1.5 h-1.5 rounded-full", dayEvents.some(e => e.isAvulso) ? "bg-emerald-500" : "bg-emerald-500")}></div>
                           {dayEvents.length > 1 && <span className="text-[8px] font-bold text-slate-500">+{dayEvents.length - 1}</span>}
                        </div>
                      )}
                    </div>

                    <div className="flex-1 overflow-hidden flex flex-col gap-0.5 mt-0.5">
                      {dayEvents.slice(0, 2).map(ev => {
                        const isMeeting = ev.type === 'reuniao' && ev.externalLink;
                        return (
                          <div 
                            key={ev.id} 
                            className={cn(
                              "px-1 py-0.5 rounded text-[7px] font-bold truncate border flex items-center justify-between gap-1",
                              ev.isAvulso 
                                ? "bg-slate-50/70 border-slate-100 text-slate-700" 
                                : "bg-emerald-50/70 border-emerald-100 text-emerald-700"
                            )}
                          >
                            <span className="truncate">{ev.isAvulso ? ev.title : ev.clientName}</span>
                            {isMeeting && <Video className="w-2 h-2 text-slate-500 flex-shrink-0" />}
                          </div>
                        );
                      })}
                      {dayEvents.length > 2 && (
                        <div className="text-[7px] font-bold text-slate-400 pl-0.5">
                          + {dayEvents.length - 2} mais
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Selected Day Details Panel */}
        <div className="bg-white/40 glass p-5 rounded-[2rem] flex flex-col gap-4 border border-white/40 shadow-sm min-h-[300px] overflow-hidden">
          <div className="border-b border-slate-100 pb-3 flex flex-col gap-1">
            <span className="text-[9px] font-bold text-emerald-600 uppercase tracking-widest flex items-center gap-1">
              <Clock className="w-3.5 h-3.5" />
              {format(selectedDate, "EEEE, d 'de' MMMM", { locale: ptBR })}
            </span>
            <h4 className="font-display font-bold text-base text-slate-800">Compromissos do Dia</h4>
          </div>

          <div className="flex-1 overflow-y-auto custom-scrollbar pr-0.5 space-y-3">
            {loading ? (
              <div className="h-40 flex items-center justify-center">
                <div className="w-5 h-5 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin"></div>
              </div>
            ) : filteredEventsForSelectedDay.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-slate-400 gap-3 py-10 opacity-60">
                <AlertCircle className="w-10 h-10 stroke-[1px]" />
                <p className="text-[11px] font-medium text-center text-slate-500">Nenhum compromisso ou<br/>serviço para esta data.</p>
              </div>
            ) : (
              filteredEventsForSelectedDay.map(ev => {
                const hourFormatted = ev.scheduledDate && ev.scheduledDate.includes('T')
                  ? ev.scheduledDate.split('T')[1].substring(0, 5)
                  : '';
                const hasMeetingLink = ev.type === 'reuniao' && ev.externalLink;

                return (
                  <motion.div 
                    key={ev.id}
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className={cn(
                      "p-3.5 rounded-2xl border transition-all shadow-sm hover:shadow-md flex flex-col gap-2 relative bg-white/70",
                      ev.isAvulso 
                        ? "border-slate-100 hover:border-slate-300"
                        : "border-emerald-100 hover:border-emerald-300"
                    )}
                  >
                    <div className="flex justify-between items-start gap-2">
                      <div className="flex items-center gap-2">
                        <span className={cn(
                          "p-1.5 rounded-lg text-white",
                          ev.isAvulso ? "bg-emerald-600" : "bg-emerald-600"
                        )}>
                          {ev.isAvulso 
                            ? (ev.type === 'reuniao' ? <Video className="w-3.5 h-3.5" /> 
                              : ev.type === 'ligacao' ? <Phone className="w-3.5 h-3.5" />
                              : ev.type === 'entrega' ? <Truck className="w-3.5 h-3.5" />
                              : <HelpCircle className="w-3.5 h-3.5" />)
                            : <ClipboardCheck className="w-3.5 h-3.5" />
                          }
                        </span>
                        <div>
                          <h5 className="font-bold text-xs text-slate-800 uppercase tracking-tight line-clamp-1">
                            {ev.isAvulso ? ev.title : ev.descriptionOrService}
                          </h5>
                          {hourFormatted && (
                            <span className="text-[9px] font-extrabold text-slate-400 bg-slate-50 px-1.5 py-0.5 rounded border border-slate-100 flex items-center gap-1 w-fit mt-0.5">
                              <Clock className="w-2.5 h-2.5" />
                              {hourFormatted} Hs
                            </span>
                          )}
                        </div>
                      </div>

                      <span className={cn(
                        "text-[7.5px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-xl border",
                        ev.isAvulso
                          ? "bg-slate-50 text-slate-700 border-slate-200"
                          : "bg-emerald-50 text-emerald-700 border-emerald-200"
                      )}>
                        {ev.isAvulso ? 'Avulso' : 'Módulo'}
                      </span>
                    </div>

                    <div className="text-[10px] text-slate-600 space-y-1 mt-1 pl-1">
                      <p className="font-bold text-slate-700">Cliente: <span className="font-normal text-slate-600">{ev.clientName}</span></p>
                      {ev.propertyName && <p className="text-slate-500 flex items-center gap-1"><MapPin className="w-3 h-3 text-slate-400" />{ev.propertyName}</p>}
                      {ev.responsible && <p className="text-slate-500 flex items-center gap-1"><User className="w-3 h-3 text-slate-400" />Resp: {ev.responsible}</p>}
                      {ev.notes && <p className="text-[10px] italic text-slate-400 line-clamp-2 mt-1 border-l-2 border-slate-200 pl-1.5">{ev.notes}</p>}
                    </div>

                    {hasMeetingLink && (
                      <a 
                        href={safeUrl(ev.externalLink)}
                        target="_blank"
                        rel="referrer"
                        className="mt-2 w-full py-1.5 bg-slate-50 text-slate-700 text-[9px] font-bold uppercase tracking-wider rounded-xl hover:bg-slate-100 transition-all flex items-center justify-center gap-1 text-center border border-slate-200"
                      >
                        <Video className="w-3 h-3 text-slate-600 animate-pulse" />
                        Acessar Reunião (Video)
                      </a>
                    )}
                  </motion.div>
                );
              })
            )}
          </div>
        </div>

      </div>
    </div>
  );
}
