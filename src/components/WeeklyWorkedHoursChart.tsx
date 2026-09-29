import React, { useState, useMemo } from 'react';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  Tooltip, 
  ResponsiveContainer, 
  CartesianGrid, 
  Cell,
  ReferenceLine
} from 'recharts';
import { 
  Clock, 
  Users, 
  Award, 
  TrendingUp, 
  Sparkles,
  Info
} from 'lucide-react';
import { AttendanceRecord, UserProfile } from '../types';

interface WeeklyWorkedHoursChartProps {
  team: UserProfile[];
  records: AttendanceRecord[];
}

export default function WeeklyWorkedHoursChart({ team, records }: WeeklyWorkedHoursChartProps) {
  const [selectedDepartment, setSelectedDepartment] = useState<string>('todos');
  const [targetHours, setTargetHours] = useState<number>(44);

  // Helper to parse timestamps safely
  const getTimestampMs = (timestamp: any): number => {
    if (!timestamp) return 0;
    try {
      if (typeof timestamp.toDate === 'function') {
        return timestamp.toDate().getTime();
      }
      if (typeof timestamp.seconds === 'number') {
        return timestamp.seconds * 1000;
      }
      const d = new Date(timestamp);
      const t = d.getTime();
      return isNaN(t) ? 0 : t;
    } catch {
      return 0;
    }
  };

  // Compute metrics per team member for the last 7 days
  const chartData = useMemo(() => {
    const now = Date.now();
    const sevenDaysAgoMs = now - 7 * 24 * 60 * 60 * 1000;

    // Filter records from the last 7 days
    const recentRecords = records.filter(r => getTimestampMs(r.timestamp) >= sevenDaysAgoMs);

    // Group records by user (by userId or userName)
    const userRecordsMap: Record<string, AttendanceRecord[]> = {};

    recentRecords.forEach(rec => {
      const key = rec.userId || rec.userName || 'Desconhecido';
      if (!userRecordsMap[key]) {
        userRecordsMap[key] = [];
      }
      userRecordsMap[key].push(rec);
    });

    // Build dataset based on team list + any user in records
    const teamUserIds = new Set(team.map(m => m.uid));
    const allMembers = [...team];

    // Add any records user not in team array
    Object.keys(userRecordsMap).forEach(key => {
      if (!teamUserIds.has(key)) {
        const sample = userRecordsMap[key][0];
        allMembers.push({
          uid: key,
          displayName: sample?.userName || 'Colaborador',
          email: '',
          role: 'consultant',
          department: 'Operações'
        } as UserProfile);
      }
    });

    // Process each member
    const processed = allMembers.map(member => {
      const userRecs = userRecordsMap[member.uid] || userRecordsMap[member.displayName || ''] || [];
      
      // Group user records by day YYYY-MM-DD
      const daysMap: Record<string, AttendanceRecord[]> = {};
      userRecs.forEach(r => {
        const ms = getTimestampMs(r.timestamp);
        if (ms === 0) return;
        const dayKey = new Date(ms).toISOString().split('T')[0];
        if (!daysMap[dayKey]) daysMap[dayKey] = [];
        daysMap[dayKey].push(r);
      });

      let totalWeeklyMs = 0;
      let daysWorkedCount = 0;
      let totalOvertimeMs = 0;

      Object.keys(daysMap).forEach(dayKey => {
        const dayRecs = daysMap[dayKey].sort((a, b) => getTimestampMs(a.timestamp) - getTimestampMs(b.timestamp));
        let dayMs = 0;

        if (dayRecs.length >= 2) {
          if (dayRecs.length === 4) {
            // Full 4-point day: (Ponto2 - Ponto1) + (Ponto4 - Ponto3)
            const t0 = getTimestampMs(dayRecs[0].timestamp);
            const t1 = getTimestampMs(dayRecs[1].timestamp);
            const t2 = getTimestampMs(dayRecs[2].timestamp);
            const t3 = getTimestampMs(dayRecs[3].timestamp);
            if (t1 > t0) dayMs += (t1 - t0);
            if (t3 > t2) dayMs += (t3 - t2);
          } else {
            // 2-point or pairwise day
            for (let i = 0; i < dayRecs.length - 1; i += 2) {
              const tStart = getTimestampMs(dayRecs[i].timestamp);
              const tEnd = getTimestampMs(dayRecs[i + 1].timestamp);
              if (tEnd > tStart) {
                dayMs += (tEnd - tStart);
              }
            }
          }
        }

        if (dayMs > 0) {
          daysWorkedCount++;
          totalWeeklyMs += dayMs;
          const dayHours = dayMs / (1000 * 60 * 60);
          if (dayHours > 8) {
            totalOvertimeMs += (dayHours - 8) * 1000 * 60 * 60;
          }
        }
      });

      const totalHours = Number((totalWeeklyMs / (1000 * 60 * 60)).toFixed(1));
      const overtimeHours = Number((totalOvertimeMs / (1000 * 60 * 60)).toFixed(1));
      const avgDailyHours = daysWorkedCount > 0 ? Number((totalHours / daysWorkedCount).toFixed(1)) : 0;

      // Formatting name for display
      const full = member.displayName || member.email?.split('@')[0] || 'Colaborador';
      const nameParts = full.split(' ');
      const shortName = nameParts.length > 1 ? `${nameParts[0]} ${nameParts[1][0]}.` : nameParts[0];

      return {
        uid: member.uid,
        fullDisplayName: full,
        name: shortName,
        department: (member as any).department || 'Operações',
        role: member.role || 'consultant',
        totalHours,
        daysWorked: daysWorkedCount,
        overtimeHours,
        avgDailyHours,
        status: (member as any).status || 'Ativo'
      };
    });

    // Filter by department if needed
    if (selectedDepartment !== 'todos') {
      return processed.filter(p => (p.department || '').toLowerCase() === selectedDepartment.toLowerCase());
    }

    return processed;
  }, [team, records, selectedDepartment]);

  // Extract unique departments for filter dropdown
  const departments = useMemo(() => {
    const set = new Set<string>();
    team.forEach(m => {
      const dept = (m as any).department || 'Operações';
      if (dept) set.add(dept);
    });
    return Array.from(set);
  }, [team]);

  // Aggregate stats
  const stats = useMemo(() => {
    if (chartData.length === 0) {
      return { totalHoursSum: 0, avgHoursPerUser: 0, activeCount: 0, topContributor: null };
    }
    const totalHoursSum = chartData.reduce((acc, curr) => acc + curr.totalHours, 0);
    const avgHoursPerUser = Number((totalHoursSum / chartData.length).toFixed(1));
    const activeCount = chartData.filter(c => c.totalHours > 0).length;
    const sorted = [...chartData].sort((a, b) => b.totalHours - a.totalHours);
    const topContributor = sorted[0] && sorted[0].totalHours > 0 ? sorted[0] : null;

    return {
      totalHoursSum: Number(totalHoursSum.toFixed(1)),
      avgHoursPerUser,
      activeCount,
      topContributor
    };
  }, [chartData]);

  // Custom Recharts Tooltip
  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;
      return (
        <div className="bg-slate-900/95 text-white p-3.5 rounded-2xl shadow-xl border border-slate-800 text-xs backdrop-blur-md min-w-[180px]">
          <div className="font-bold text-sm text-emerald-400 mb-1 border-b border-slate-800 pb-1 flex items-center justify-between">
            <span>{data.fullDisplayName}</span>
            <span className="text-[9px] bg-slate-800 text-slate-300 px-1.5 py-0.5 rounded font-mono uppercase">{data.department}</span>
          </div>
          <div className="space-y-1.5 mt-2">
            <div className="flex justify-between items-center text-slate-300">
              <span>Horas na Semana:</span>
              <span className="font-bold font-mono text-white text-sm">{data.totalHours}h</span>
            </div>
            <div className="flex justify-between items-center text-slate-400 text-[11px]">
              <span>Dias Trabalhados:</span>
              <span className="font-semibold text-slate-200">{data.daysWorked} dias</span>
            </div>
            <div className="flex justify-between items-center text-slate-400 text-[11px]">
              <span>Média Diária:</span>
              <span className="font-semibold text-slate-200">{data.avgDailyHours}h/dia</span>
            </div>
            {data.overtimeHours > 0 && (
              <div className="flex justify-between items-center text-amber-400 text-[11px] pt-1 border-t border-slate-800 font-semibold">
                <span>Horas Extras:</span>
                <span>+{data.overtimeHours}h</span>
              </div>
            )}
          </div>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="bg-white/40 glass p-6 rounded-[2.5rem] border border-white/40 shadow-sm flex flex-col gap-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-150/60 pb-4">
        <div>
          <h3 className="font-display font-bold text-slate-800 text-base flex items-center gap-2">
            <Clock className="w-5 h-5 text-emerald-600" /> Distribuição de Horas Trabalhadas (Última Semana)
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Total de horas registradas por colaborador nos últimos 7 dias via ponto eletrônico.
          </p>
        </div>

        {/* Filter and Target Controls */}
        <div className="flex items-center gap-2 self-start sm:self-auto">
          {departments.length > 0 && (
            <select
              value={selectedDepartment}
              onChange={(e) => setSelectedDepartment(e.target.value)}
              className="bg-white/80 border border-slate-200 text-slate-700 text-xs rounded-xl px-3 py-1.5 outline-none focus:border-emerald-500 font-medium cursor-pointer shadow-xs"
            >
              <option value="todos">Todos os Setores</option>
              {departments.map(dept => (
                <option key={dept} value={dept}>{dept}</option>
              ))}
            </select>
          )}

          <div className="flex items-center gap-1.5 bg-white/80 border border-slate-200 rounded-xl px-2.5 py-1.5 text-xs text-slate-600 font-medium shadow-xs">
            <span className="text-[10px] uppercase font-bold text-slate-400">Meta:</span>
            <select 
              value={targetHours}
              onChange={(e) => setTargetHours(Number(e.target.value))}
              className="bg-transparent font-bold text-slate-800 outline-none cursor-pointer"
            >
              <option value={44}>44h</option>
              <option value={40}>40h</option>
              <option value={36}>36h</option>
            </select>
          </div>
        </div>
      </div>

      {/* KPI Cards Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-white/70 p-3 rounded-2xl border border-slate-100 shadow-xs flex flex-col justify-between">
          <span className="text-[9px] uppercase font-bold text-slate-400 flex items-center gap-1">
            <Clock className="w-3 h-3 text-emerald-500" /> Total Geral
          </span>
          <div className="text-xl font-black text-slate-800 mt-1 font-mono">
            {stats.totalHoursSum} <span className="text-xs font-semibold text-slate-400">hs</span>
          </div>
        </div>

        <div className="bg-white/70 p-3 rounded-2xl border border-slate-100 shadow-xs flex flex-col justify-between">
          <span className="text-[9px] uppercase font-bold text-slate-400 flex items-center gap-1">
            <TrendingUp className="w-3 h-3 text-slate-500" /> Média / Colaborador
          </span>
          <div className="text-xl font-black text-slate-600 mt-1 font-mono">
            {stats.avgHoursPerUser} <span className="text-xs font-semibold text-slate-400">hs</span>
          </div>
        </div>

        <div className="bg-white/70 p-3 rounded-2xl border border-slate-100 shadow-xs flex flex-col justify-between">
          <span className="text-[9px] uppercase font-bold text-slate-400 flex items-center gap-1">
            <Users className="w-3 h-3 text-slate-500" /> Ativos na Semana
          </span>
          <div className="text-xl font-black text-slate-800 mt-1">
            {stats.activeCount} <span className="text-xs font-normal text-slate-400">/ {chartData.length}</span>
          </div>
        </div>

        <div className="bg-white/70 p-3 rounded-2xl border border-slate-100 shadow-xs flex flex-col justify-between">
          <span className="text-[9px] uppercase font-bold text-slate-400 flex items-center gap-1">
            <Award className="w-3 h-3 text-amber-500" /> Destaque da Semana
          </span>
          <div className="text-xs font-bold text-slate-800 mt-1 truncate">
            {stats.topContributor ? (
              <span>{stats.topContributor.name} ({stats.topContributor.totalHours}h)</span>
            ) : (
              <span className="text-slate-400 font-normal">Nenhum registro</span>
            )}
          </div>
        </div>
      </div>

      {/* Bar Chart Container */}
      <div className="w-full h-72 pt-2 pb-1">
        {chartData.length === 0 ? (
          <div className="w-full h-full flex flex-col items-center justify-center text-slate-400 gap-2">
            <Info className="w-8 h-8 text-slate-300 stroke-[1.5]" />
            <p className="text-xs font-medium">Nenhum dado de ponto para exibir no período selecionado.</p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={chartData}
              margin={{ top: 15, right: 15, left: -20, bottom: 25 }}
            >
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
              <XAxis 
                dataKey="name" 
                tick={{ fill: '#64748b', fontSize: 11, fontWeight: 600 }}
                axisLine={{ stroke: '#cbd5e1' }}
                tickLine={false}
                interval={0}
                angle={-15}
                textAnchor="end"
              />
              <YAxis 
                tick={{ fill: '#64748b', fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                unit="h"
              />
              <Tooltip content={<CustomTooltip />} />
              
              <ReferenceLine 
                y={targetHours} 
                stroke="#f59e0b" 
                strokeDasharray="4 4" 
                label={{ 
                  value: `Meta (${targetHours}h)`, 
                  fill: '#d97706', 
                  fontSize: 10, 
                  fontWeight: 700, 
                  position: 'top' 
                }} 
              />

              <Bar 
                dataKey="totalHours" 
                radius={[8, 8, 0, 0]}
                maxBarSize={48}
              >
                {chartData.map((entry, index) => {
                  // Color dynamic gradient depending on hours vs target
                  let fillColor = '#10b981'; // Emerald standard
                  if (entry.totalHours > targetHours + 4) {
                    fillColor = '#f59e0b'; // Amber for high overtime
                  } else if (entry.totalHours >= targetHours) {
                    fillColor = '#059669'; // Dark emerald
                  } else if (entry.totalHours < 20 && entry.totalHours > 0) {
                    fillColor = '#6366f1'; // Indigo for partial week
                  } else if (entry.totalHours === 0) {
                    fillColor = '#cbd5e1'; // Slate gray
                  }
                  return <Cell key={`cell-${index}`} fill={fillColor} />;
                })}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Legenda de cores */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] text-slate-500 font-medium border-t border-slate-150/60 pt-3">
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-600"></span> Jornada Padrão (&ge; 36h)
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500"></span> Jornada Parcial (&lt; 36h)
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-amber-500"></span> Excesso de Horas Extras
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-slate-300"></span> Sem Registro
          </span>
        </div>

        <div className="flex items-center gap-1 text-slate-400">
          <Sparkles className="w-3 h-3 text-slate-500" />
          <span>Sincronizado via Firestore</span>
        </div>
      </div>
    </div>
  );
}
