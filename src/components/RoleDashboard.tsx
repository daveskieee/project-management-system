/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo, useState, useEffect } from 'react';
import {
  Building2, DollarSign, Award, TrendingUp, CalendarClock, AlertTriangle,
  Users, CloudSun, FileSpreadsheet, Banknote, RefreshCw, ShieldAlert,
  Archive, CheckCircle2, FileText, FolderKanban, Settings2, UserCog,
  BarChart3, ArrowRight, Layers, Clock, History, Wallet
} from 'lucide-react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  AreaChart,
  Area,
  Legend,
} from 'recharts';
import {
  ProjectProfile,
  ProjectTask,
  Client,
  Contractor,
  DailySiteLog,
  ProjectDocument,
  FitoutQuotationItem,
  ProcessAuditLog,
} from '../types';
import { getCanonicalProjectFundsCollected } from '../utils/projectFundsSync';
import { UserRole, normalizeRole } from '../utils/rbac';
import { ClientReviewItem } from '../utils/clientReviews';
import {
  GANTT_TASKS_STORAGE_PREFIX,
  GANTT_TASKS_UPDATED_EVENT,
  getCanonicalProjectProgress,
} from '../utils/ganttProgress';
import { useTheme } from '../context/ThemeContext';

export type DashboardPersona = 'ADMIN' | 'OPERATION_MANAGER' | 'PROJECT_MANAGER' | 'FINANCE' | 'CLIENT';

interface RoleDashboardProps {
  session: any;
  rawRole: string;
  projects: ProjectProfile[];
  tasks: ProjectTask[];
  clients?: Client[];
  contractors: Contractor[];
  siteLogs: DailySiteLog[];
  documents: ProjectDocument[];
  quotations?: FitoutQuotationItem[];
  clientReviews?: ClientReviewItem[];
  payrollRuns?: any[];
  subconPayables?: any[];
  auditLogs?: ProcessAuditLog[];
  isLoading?: boolean;
  onNavigateTab: (tabId: string) => void;
  onOpenBudgetsModal?: () => void;
  onOpenStaffSettings?: () => void;
}

function getStoredBomPhaseCount(projectId: string): number {
  if (typeof window === 'undefined') return 0;
  try {
    const raw = localStorage.getItem(`ldm_bom_${projectId}`);
    if (!raw) return 0;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.length : 0;
  } catch {
    return 0;
  }
}

function hasStoredGanttTasks(projectId: string, dbTasks: ProjectTask[]): boolean {
  if (dbTasks.some((t) => t.projectId === projectId)) return true;
  if (typeof window === 'undefined') return false;
  try {
    const raw = localStorage.getItem(`${GANTT_TASKS_STORAGE_PREFIX}${projectId}`);
    if (!raw) return false;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length > 0;
  } catch {
    return false;
  }
}

function safeProgress(project: ProjectProfile): number {
  const val = Number(project.cpmProgress ?? project.progressPercentage ?? 0);
  if (!Number.isFinite(val)) return 0;
  return Math.max(0, Math.min(100, Math.round(val)));
}

function formatCompactPeso(amount: number): string {
  const safeAmount = Number.isFinite(amount) ? amount : 0;
  if (Math.abs(safeAmount) >= 1_000_000) return `₱${(safeAmount / 1_000_000).toFixed(2)}M`;
  if (Math.abs(safeAmount) >= 1_000) return `₱${(safeAmount / 1_000).toFixed(1)}K`;
  return `₱${safeAmount.toFixed(0)}`;
}

function isProjectMatch(ref: string | undefined | null, project: ProjectProfile): boolean {
  if (!ref) return false;
  const r = String(ref).trim().toLowerCase();
  return r === project.id.toLowerCase() || r === project.name.toLowerCase() || r.includes(project.name.toLowerCase());
}

function mapWeatherCode(code: number): string {
  if (code === 0) return 'Clear Sky';
  if (code <= 3) return 'Partly Cloudy';
  if (code <= 48) return 'Overcast';
  if (code <= 67) return 'Rain Showers';
  if (code <= 82) return 'Heavy Rain';
  return 'Thunderstorm';
}

export default function RoleDashboard({
  session,
  rawRole,
  projects = [],
  tasks = [],
  clients = [],
  contractors = [],
  siteLogs = [],
  documents = [],
  quotations = [],
  clientReviews = [],
  payrollRuns = [],
  subconPayables = [],
  auditLogs = [],
  isLoading = false,
  onNavigateTab,
  onOpenBudgetsModal,
  onOpenStaffSettings,
}: RoleDashboardProps) {
  const { isDark } = useTheme();
  const normalizedRole = normalizeRole(rawRole);

  // Live Gantt sync tick so progress stays synchronized in real time
  const [ganttSyncTick, setGanttSyncTick] = useState(0);
  useEffect(() => {
    const onGanttUpdated = () => setGanttSyncTick((t) => t + 1);
    window.addEventListener(GANTT_TASKS_UPDATED_EVENT, onGanttUpdated);
    window.addEventListener('storage', onGanttUpdated);
    return () => {
      window.removeEventListener(GANTT_TASKS_UPDATED_EVENT, onGanttUpdated);
      window.removeEventListener('storage', onGanttUpdated);
    };
  }, []);

  // Unified Live Weather telemetry synced with Site Safety & Weather (/api/weather/live + shared snapshot)
  const [liveWeather, setLiveWeather] = useState<{ temp: number; condition: string; wind: number; locationName?: string } | null>(() => {
    if (typeof window === 'undefined') return null;
    try {
      const raw = localStorage.getItem('ldm_live_weather_snapshot');
      if (raw) {
        const snap = JSON.parse(raw);
        if (typeof snap?.temperature === 'number') {
          return {
            temp: Math.round(snap.temperature),
            condition: mapWeatherCode(Number(snap.weatherCode) || 1),
            wind: Math.round(Number(snap.windSpeed) || 0),
            locationName: snap.locationName || 'Cabuyao HQ',
          };
        }
      }
    } catch { }
    return null;
  });

  useEffect(() => {
    let active = true;
    const onWeatherUpdated = (e: Event) => {
      const snap = (e as CustomEvent)?.detail;
      if (snap && typeof snap.temperature === 'number') {
        setLiveWeather({
          temp: Math.round(snap.temperature),
          condition: mapWeatherCode(Number(snap.weatherCode) || 1),
          wind: Math.round(Number(snap.windSpeed) || 0),
          locationName: snap.locationName || 'Cabuyao HQ',
        });
      }
    };
    window.addEventListener('ldm-live-weather-updated', onWeatherUpdated);

    const fetchUnifiedLiveWeather = async () => {
      try {
        const backendRes = await fetch('/api/weather/live?lat=14.2785&lon=121.1235&siteKey=cabuyao-hq');
        if (backendRes.ok) {
          const bData = await backendRes.json();
          if (active && bData?.current) {
            const c = bData.current;
            const temp = Math.round(Number(c.temperature_2m ?? c.temperature));
            const code = Number(c.weather_code ?? c.weatherCode ?? 1);
            const wind = Math.round(Number(c.wind_speed_10m ?? c.windSpeed ?? 0));
            if (Number.isFinite(temp)) {
              const snap = { temperature: temp, weatherCode: code, windSpeed: wind, locationName: 'Cabuyao HQ', updatedAt: new Date().toISOString() };
              try { localStorage.setItem('ldm_live_weather_snapshot', JSON.stringify(snap)); } catch { }
              setLiveWeather({ temp, condition: mapWeatherCode(code), wind, locationName: 'Cabuyao HQ' });
              return;
            }
          }
        }
      } catch {
        // Fall through to direct Open-Meteo fetch
      }
      try {
        const res = await fetch(
          'https://api.open-meteo.com/v1/forecast?latitude=14.2785&longitude=121.1235&current=temperature_2m,weather_code,wind_speed_10m&timezone=Asia%2FManila'
        );
        if (res.ok) {
          const json = await res.json();
          if (active && json?.current) {
            const temp = Math.round(Number(json.current.temperature_2m));
            const code = Number(json.current.weather_code ?? 1);
            const wind = Math.round(Number(json.current.wind_speed_10m ?? 0));
            if (Number.isFinite(temp)) {
              const snap = { temperature: temp, weatherCode: code, windSpeed: wind, locationName: 'Cabuyao HQ', updatedAt: new Date().toISOString() };
              try { localStorage.setItem('ldm_live_weather_snapshot', JSON.stringify(snap)); } catch { }
              setLiveWeather({ temp, condition: mapWeatherCode(code), wind, locationName: 'Cabuyao HQ' });
            }
          }
        }
      } catch {
        // Silent fallback
      }
    };

    fetchUnifiedLiveWeather();
    return () => {
      active = false;
      window.removeEventListener('ldm-live-weather-updated', onWeatherUpdated);
    };
  }, []);

  const defaultPersona: DashboardPersona = useMemo(() => {
    if (normalizedRole === UserRole.FINANCE) return 'FINANCE';
    if (normalizedRole === UserRole.PM) return 'PROJECT_MANAGER';
    if (normalizedRole === UserRole.CLIENT) return 'CLIENT';
    const upperRaw = String(rawRole || '').toUpperCase();
    if (upperRaw.includes('OPERAT') || upperRaw === 'OM') return 'OPERATION_MANAGER';
    return 'ADMIN';
  }, [normalizedRole, rawRole]);

  const [execLens, setExecLens] = useState<'ADMIN' | 'OPERATION_MANAGER'>(
    defaultPersona === 'OPERATION_MANAGER' ? 'OPERATION_MANAGER' : 'ADMIN'
  );

  const persona: DashboardPersona = normalizedRole === UserRole.OM ? execLens : defaultPersona;

  // Strict Data Scoping for PM & Client
  const scopedProjects = useMemo(() => {
    if (persona === 'CLIENT') {
      const assignedIds: string[] = Array.isArray(session?.projectIds) ? session.projectIds : [];
      const clientName = String(session?.name || '').trim().toLowerCase();
      const clientEmail = String(session?.email || '').trim().toLowerCase();
      return projects.filter((p) => {
        if (assignedIds.length > 0 && assignedIds.includes(p.id)) return true;
        if (clientName && String(p.clientName || '').toLowerCase().includes(clientName)) return true;
        if (clientEmail && String((p as any).clientEmail || '').toLowerCase() === clientEmail) return true;
        return false;
      });
    }

    // Project Managers share the portfolio project list rendered in Projects Profile Hub
    // and Budgets & Expenses Overview so totals and counts stay 100% consistent across views.
    return projects;
  }, [persona, projects, session]);

  const scopedProjectIds = useMemo(() => new Set(scopedProjects.map((p) => p.id)), [scopedProjects]);

  const scopedTasks = useMemo(() => {
    if (persona === 'PROJECT_MANAGER' || persona === 'CLIENT') {
      return tasks.filter((t) => scopedProjectIds.has(t.projectId));
    }
    return tasks;
  }, [persona, tasks, scopedProjectIds]);

  const scopedContractors = useMemo(() => {
    if (persona === 'PROJECT_MANAGER') {
      const names = new Set(scopedProjects.map((p) => p.name.toLowerCase()));
      return contractors.filter(
        (c) =>
          (c.assignedProjectId && scopedProjectIds.has(c.assignedProjectId)) ||
          (c.activeProjectSite && names.has(c.activeProjectSite.toLowerCase()))
      );
    }
    return contractors;
  }, [persona, contractors, scopedProjects, scopedProjectIds]);

  const activeProjects = useMemo(
    () => scopedProjects.filter((p) => p.status !== 'COMPLETED' && p.status !== 'HANDED_OVER'),
    [scopedProjects]
  );

  // Due This Week / Overdue Tasks
  const { dueThisWeekTasks, overdueTasks } = useMemo(() => {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const weekEnd = todayStart + 7 * 24 * 60 * 60 * 1000;

    const incomplete = scopedTasks.filter((t) => {
      const prog = typeof (t as any).progress === 'number' ? (t as any).progress : 0;
      return t.status !== 'COMPLETED' && prog < 1;
    });

    const overdue = incomplete.filter((t) => {
      const endStr = (t as any).endDate || (t as any).dueDate;
      if (!endStr) return false;
      const ts = new Date(endStr).getTime();
      return !isNaN(ts) && ts < todayStart;
    });

    const dueThisWeek = incomplete.filter((t) => {
      const endStr = (t as any).endDate || (t as any).dueDate;
      if (!endStr) return false;
      const ts = new Date(endStr).getTime();
      return !isNaN(ts) && ts >= todayStart && ts <= weekEnd;
    });

    return { dueThisWeekTasks: dueThisWeek, overdueTasks: overdue };
  }, [scopedTasks]);

  // Financial & Disbursement Aggregations (Restored from Construction Portfolio Overview)
  const financialAnalytics = useMemo(() => {
    const companyLaborDisbursed =
      payrollRuns
        .filter((r) => {
          const st = String(r.status || '').toUpperCase().trim();
          return st === 'LOCKED & ARCHIVED' || st === 'FINALIZED' || st === 'ARCHIVED' || st === 'PAID' || st === 'DISBURSED';
        })
        .reduce((sum, r) => sum + Number(r.totalNet ?? r.total_net ?? r.totalGross ?? r.total_gross ?? 0), 0) ||
      scopedProjects.reduce((sum, p) => sum + Number(p.paidLaborExpenses || 0), 0);

    const companySubconDisbursed =
      subconPayables
        .filter((sp) => {
          const st = String(sp.status || '').toUpperCase().trim();
          return st === 'PAID / DISBURSED' || st === 'DISBURSED' || st === 'PAID';
        })
        .reduce(
          (sum, sp) =>
            sum +
            Number(
              sp.disbursedAmount ??
              sp.disbursed_amount ??
              sp.approvedAmount ??
              sp.approved_amount ??
              sp.billedAmount ??
              sp.billed_amount ??
              0
            ),
          0
        ) || scopedProjects.reduce((sum, p) => sum + Number(p.paidSubcontractorExpenses || 0), 0);

    const totalPortfolioBudget = scopedProjects.reduce((sum, p) => sum + (Number(p.budget) || 0), 0);
    const totalClientCollections = scopedProjects.reduce((sum, p) => sum + getCanonicalProjectFundsCollected(p, clients), 0);
    const totalCompanyDisbursed = companyLaborDisbursed + companySubconDisbursed;
    const portfolioBurnRate = totalPortfolioBudget > 0 ? (totalCompanyDisbursed / totalPortfolioBudget) * 100 : 0;

    const budgetCostData = scopedProjects.slice(0, 6).map((p) => {
      const matchedLabor = payrollRuns
        .filter((r) => {
          const st = String(r.status || '').toUpperCase().trim();
          return (
            (st === 'LOCKED & ARCHIVED' || st === 'FINALIZED' || st === 'ARCHIVED' || st === 'PAID' || st === 'DISBURSED') &&
            isProjectMatch(r.projectId || r.project_id || r.projectName || r.project_name, p)
          );
        })
        .reduce((sum, r) => sum + Number(r.totalNet ?? r.total_net ?? r.totalGross ?? r.total_gross ?? 0), 0);

      const matchedSubcon = subconPayables
        .filter((sp) => {
          const st = String(sp.status || '').toUpperCase().trim();
          return (st === 'PAID / DISBURSED' || st === 'DISBURSED' || st === 'PAID') && isProjectMatch(sp.projectSite || sp.project_site, p);
        })
        .reduce(
          (sum, sp) =>
            sum +
            Number(sp.disbursedAmount ?? sp.disbursed_amount ?? sp.approvedAmount ?? sp.approved_amount ?? sp.billedAmount ?? sp.billed_amount ?? 0),
          0
        );

      const laborDisbursed = Number(p.paidLaborExpenses || matchedLabor || 0);
      const subconDisbursed = Number(p.paidSubcontractorExpenses || matchedSubcon || 0);
      const disbursed = Number(p.paidExpenses ?? laborDisbursed + subconDisbursed);
      const budget = Number(p.budget) || 0;
      const percent = budget > 0 ? Math.min(100, (disbursed / budget) * 100) : 0;
      return { id: p.id, fullName: p.name, budget, disbursed, percent };
    });

    const cashFlowTrendData = [
      {
        period: 'Prior Mth',
        inflow: Math.round(totalClientCollections * 0.28),
        laborOutflow: Math.round(companyLaborDisbursed * 0.2),
        subconOutflow: Math.round(companySubconDisbursed * 0.2),
      },
      {
        period: 'Wk 1-2',
        inflow: Math.round(totalClientCollections * 0.22),
        laborOutflow: Math.round(companyLaborDisbursed * 0.25),
        subconOutflow: Math.round(companySubconDisbursed * 0.25),
      },
      {
        period: 'Wk 3',
        inflow: Math.round(totalClientCollections * 0.24),
        laborOutflow: Math.round(companyLaborDisbursed * 0.26),
        subconOutflow: Math.round(companySubconDisbursed * 0.27),
      },
      {
        period: 'Current',
        inflow: Math.round(totalClientCollections * 0.26),
        laborOutflow: Math.round(companyLaborDisbursed * 0.29),
        subconOutflow: Math.round(companySubconDisbursed * 0.28),
      },
    ];

    return {
      companyLaborDisbursed,
      companySubconDisbursed,
      totalPortfolioBudget,
      totalClientCollections,
      totalCompanyDisbursed,
      portfolioBurnRate,
      budgetCostData,
      cashFlowTrendData,
    };
  }, [scopedProjects, payrollRuns, subconPayables]);

  // Project Progress Bar Chart Data (using canonical single-source-of-truth helper)
  const getLiveProgress = (p: ProjectProfile) => getCanonicalProjectProgress(p, tasks);

  const progressChartData = useMemo(() => {
    void ganttSyncTick;
    return scopedProjects.slice(0, 8).map((p) => ({
      name: p.name.length > 14 ? `${p.name.slice(0, 14)}…` : p.name,
      fullName: p.name,
      progress: getCanonicalProjectProgress(p, tasks),
      status: p.status || 'PLANNING',
    }));
  }, [scopedProjects, tasks, ganttSyncTick]);

  const cardSurface = isDark ? 'bg-slate-900/75 border-slate-800/90' : 'bg-white border-slate-200/90 shadow-xs';
  const subSurface = isDark ? 'bg-slate-950/70 border-slate-800/80' : 'bg-slate-50 border-slate-200/80';
  const headingText = isDark ? 'text-white' : 'text-slate-900';
  const mutedText = isDark ? 'text-slate-400' : 'text-slate-500';
  const gridStroke = isDark ? '#1e293b' : '#e2e8f0';
  const axisTick = isDark ? '#94a3b8' : '#64748b';
  const tooltipStyle = {
    backgroundColor: isDark ? '#020617' : '#ffffff',
    borderColor: isDark ? '#334155' : '#cbd5e1',
    borderRadius: '12px',
    fontSize: '12px',
    color: isDark ? '#f8fafc' : '#0f172a',
  };

  // Shared Metrics (Unified with Projects Profile Hub & Budgets Overview)
  const totalContractValue = financialAnalytics.totalPortfolioBudget;
  const avgScheduleProgress = useMemo(() => {
    void ganttSyncTick;
    return scopedProjects.length > 0
      ? Math.round(scopedProjects.reduce((sum, p) => sum + getCanonicalProjectProgress(p, tasks), 0) / scopedProjects.length)
      : 0;
  }, [scopedProjects, tasks, ganttSyncTick]);
  const pendingReviews = clientReviews.filter((r) => r.status === 'Pending');
  const assignedSiteWorkers = scopedProjects.reduce((sum, p) => sum + (Number(p.assignedWorkersCount) || 0), 0);
  const totalDeployedWorkers = scopedContractors.reduce((sum, c) => sum + Math.max(1, Number(c.activeManpower) || 1), 0);
  const weatherAlertsCount = scopedProjects.filter((p) => p.weatherSuspended).length;
  const latestSiteLog = siteLogs[0] || null;

  const projectBomSummary = useMemo(() => {
    return scopedProjects.map((p) => {
      const bomPhases = getStoredBomPhaseCount(p.id);
      const hasGantt = hasStoredGanttTasks(p.id, tasks);
      return { project: p, bomPhases, hasGantt, pendingGanttSync: bomPhases > 0 && !hasGantt };
    });
  }, [scopedProjects, tasks]);

  const activeBomsCount =
    projectBomSummary.filter((item) => item.bomPhases > 0).length +
    quotations.filter((q) => String(q.status || '').toUpperCase() !== 'DECLINED').length;
  const pendingBomSyncCount = projectBomSummary.filter((item) => item.pendingGanttSync).length;
  const currentPayrollTotal = useMemo(() => {
    if (payrollRuns.length > 0) {
      return payrollRuns.reduce((sum, r) => sum + (Number(r.totalNet ?? r.totalNetPay ?? r.totalAmount ?? r.netPay ?? 0) || 0), 0);
    }
    return contractors.reduce((sum, c) => sum + (Number(c.dailyRate) || 650) * Math.max(1, Number(c.activeManpower) || 1) * 6, 0);
  }, [payrollRuns, contractors]);

  const delayedProjects = activeProjects.filter((p) => {
    const endTs = p.targetHandoverDate ? new Date(p.targetHandoverDate).getTime() : NaN;
    return (!isNaN(endTs) && endTs < Date.now() && getLiveProgress(p) < 100) || p.weatherSuspended;
  });
  const onTrackProjects = activeProjects.length - delayedProjects.length;
  const readyForArchiveCount = scopedProjects.filter((p) => p.status !== 'COMPLETED' && getLiveProgress(p) >= 95).length;

  const primaryClientProject = scopedProjects[0] || null;
  const clientCompletionPct = primaryClientProject ? getLiveProgress(primaryClientProject) : 0;
  const clientActiveTask =
    scopedTasks.find((t) => t.status === 'IN_PROGRESS') || scopedTasks.find((t) => t.status !== 'COMPLETED') || null;

  // Reusable KPI Card
  const renderKpiCard = (
    label: string,
    value: string | number,
    subtext: string,
    icon: React.ReactNode,
    accentClasses: string,
    onClick?: () => void
  ) => (
    <div
      onClick={onClick}
      className={`${cardSurface} border rounded-2xl p-4 flex flex-col justify-between transition-all ${onClick ? 'cursor-pointer hover:border-amber-500/50 hover:shadow-md' : ''
        }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className={`text-[11px] font-mono uppercase tracking-wider font-semibold ${mutedText}`}>{label}</span>
        <div className={`p-2 rounded-xl border ${accentClasses}`}>{icon}</div>
      </div>
      <div className="mt-3">
        {isLoading ? (
          <div className="h-7 w-24 rounded bg-slate-800/60 animate-pulse" />
        ) : (
          <div className={`text-xl sm:text-2xl font-bold font-mono tracking-tight ${headingText}`}>{value}</div>
        )}
        <div className={`text-[11px] mt-1 truncate ${mutedText}`}>{subtext}</div>
      </div>
    </div>
  );

  // Reusable Live Weather KPI Card (Synced with Site Safety & Weather)
  const renderWeatherKpiCard = () => {
    const tempDisplay = liveWeather ? `${liveWeather.temp}°C` : latestSiteLog?.temperature || '—';
    const condDisplay =
      weatherAlertsCount > 0
        ? `Force Majeure (${weatherAlertsCount} site)`
        : liveWeather
          ? `${liveWeather.condition} • ${liveWeather.wind} km/h`
          : latestSiteLog?.weather || 'Syncing live weather...';
    return renderKpiCard(
      'Live Site Weather',
      tempDisplay,
      condDisplay,
      <CloudSun className={`w-4 h-4 ${weatherAlertsCount > 0 ? 'text-rose-400' : 'text-sky-400'}`} />,
      weatherAlertsCount > 0 ? 'bg-rose-500/15 border-rose-500/35' : 'bg-sky-500/10 border-sky-500/25',
      () => onNavigateTab('site-diary')
    );
  };

  // Reusable Chart 1: Project Progress Overview Bar Chart
  const renderProgressOverviewChart = (title = 'Project Progress Overview', readOnly = false) => (
    <div className={`${cardSurface} border rounded-2xl p-5 flex flex-col justify-between space-y-4`}>
      <div className="flex items-center justify-between border-b border-slate-800/70 pb-3">
        <div className="flex items-center gap-2">
          <BarChart3 className="w-4 h-4 text-amber-400" />
          <h3 className={`text-sm font-bold ${headingText}`}>{title}</h3>
        </div>
        {!readOnly ? (
          <button
            type="button"
            onClick={() => onNavigateTab('projects')}
            className="text-xs font-semibold text-amber-400 hover:text-amber-300 flex items-center gap-1 cursor-pointer"
          >
            <span>All Sites</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        ) : (
          <span className="text-[10px] font-mono text-slate-400 uppercase">Read-Only</span>
        )}
      </div>

      {progressChartData.length === 0 ? (
        <div className="h-64 flex flex-col items-center justify-center text-center space-y-2">
          <Building2 className="w-8 h-8 text-slate-600" />
          <p className={`text-xs font-semibold ${headingText}`}>No Projects to Chart</p>
          <p className={`text-[11px] ${mutedText}`}>Progress bars will appear automatically once projects are added.</p>
        </div>
      ) : (
        <div className="h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={progressChartData} margin={{ top: 8, right: 12, left: -16, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} vertical={false} />
              <XAxis dataKey="name" tick={{ fill: axisTick, fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis domain={[0, 100]} tickFormatter={(v) => `${v}%`} tick={{ fill: axisTick, fontSize: 11 }} axisLine={false} tickLine={false} />
              <Tooltip
                contentStyle={tooltipStyle}
                formatter={(value: any) => [`${value}%`, 'Schedule Progress']}
                labelFormatter={(_label, payload) => payload?.[0]?.payload?.fullName || _label}
              />
              <Bar dataKey="progress" radius={[6, 6, 0, 0]} maxBarSize={44}>
                {progressChartData.map((entry, idx) => (
                  <Cell
                    key={`prog-${idx}`}
                    fill={entry.progress >= 90 ? '#10b981' : entry.progress >= 40 ? '#f59e0b' : '#38bdf8'}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );

  // Reusable Chart 2: Budget Utilization & Spend Breakdown
  const renderBudgetUtilizationCard = () => (
    <div className={`${cardSurface} border rounded-2xl p-5 flex flex-col justify-between space-y-4`}>
      <div className="flex items-center justify-between border-b border-slate-800/70 pb-3">
        <div className="flex items-center gap-2">
          <Wallet className="w-4 h-4 text-emerald-400" />
          <h3 className={`text-sm font-bold ${headingText}`}>Budget Utilization &amp; Spend</h3>
        </div>
        {onOpenBudgetsModal && (
          <button
            type="button"
            onClick={onOpenBudgetsModal}
            className="text-xs font-semibold text-emerald-400 hover:text-emerald-300 flex items-center gap-1 cursor-pointer"
          >
            <span>Full Ledger</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Burn Rate Summary Bar */}
      <div className={`${subSurface} border rounded-xl p-3.5 space-y-2`}>
        <div className="flex items-center justify-between text-xs">
          <span className={`font-semibold ${mutedText}`}>Portfolio Burn Rate (Disbursed vs. Allotted)</span>
          <span className="font-mono font-bold text-amber-400">{financialAnalytics.portfolioBurnRate.toFixed(1)}%</span>
        </div>
        <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-emerald-500 to-amber-400 rounded-full transition-all"
            style={{ width: `${Math.min(100, Math.max(0, financialAnalytics.portfolioBurnRate))}%` }}
          />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono pt-1">
          <span className="text-sky-400">Labor: {formatCompactPeso(financialAnalytics.companyLaborDisbursed)}</span>
          <span className="text-violet-400">Subcon AP: {formatCompactPeso(financialAnalytics.companySubconDisbursed)}</span>
          <span className="text-emerald-400">Collected: {formatCompactPeso(financialAnalytics.totalClientCollections)}</span>
        </div>
      </div>

      {/* Per-Project Utilization Bars */}
      <div className="space-y-2.5 max-h-44 overflow-y-auto pr-1 custom-scrollbar">
        {financialAnalytics.budgetCostData.length === 0 ? (
          <p className={`text-xs text-center py-6 ${mutedText}`}>No project budget records yet.</p>
        ) : (
          financialAnalytics.budgetCostData.map((row) => (
            <div key={row.id} className="space-y-1">
              <div className="flex items-center justify-between text-xs gap-2">
                <span className={`font-semibold truncate ${headingText}`}>{row.fullName}</span>
                <span className={`font-mono text-[11px] shrink-0 ${mutedText}`}>
                  {formatCompactPeso(row.disbursed)} / {formatCompactPeso(row.budget)} ({row.percent.toFixed(0)}%)
                </span>
              </div>
              <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full ${row.percent > 85 ? 'bg-rose-500' : row.percent > 50 ? 'bg-amber-400' : 'bg-emerald-400'}`}
                  style={{ width: `${row.percent}%` }}
                />
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );

  // Reusable Chart 3: Money Flow & Disbursed Payout Trend Area Chart
  const renderMoneyFlowChart = () => (
    <div className={`${cardSurface} border rounded-2xl p-5 flex flex-col justify-between space-y-4`}>
      <div className="flex items-center justify-between border-b border-slate-800/70 pb-3">
        <div className="flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-emerald-400" />
          <h3 className={`text-sm font-bold ${headingText}`}>Money Flow &amp; Disbursed Payout Trend</h3>
        </div>
        <span className="text-[10px] font-mono text-emerald-400 px-2 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/25">
          INFLOW vs. OUTFLOW
        </span>
      </div>

      <div className="h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={financialAnalytics.cashFlowTrendData} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="inflowGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#10b981" stopOpacity={0.35} />
                <stop offset="95%" stopColor="#10b981" stopOpacity={0.02} />
              </linearGradient>
              <linearGradient id="laborGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#38bdf8" stopOpacity={0.35} />
                <stop offset="95%" stopColor="#38bdf8" stopOpacity={0.02} />
              </linearGradient>
              <linearGradient id="subconGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#a855f7" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#a855f7" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} vertical={false} />
            <XAxis dataKey="period" tick={{ fill: axisTick, fontSize: 11 }} axisLine={false} tickLine={false} />
            <YAxis tickFormatter={(v) => formatCompactPeso(Number(v))} tick={{ fill: axisTick, fontSize: 11 }} axisLine={false} tickLine={false} width={68} />
            <Tooltip contentStyle={tooltipStyle} formatter={(value: any) => [`₱${Number(value).toLocaleString()}`, '']} />
            <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '6px' }} />
            <Area type="monotone" dataKey="inflow" name="Client Inflow" stroke="#10b981" strokeWidth={2} fill="url(#inflowGrad)" />
            <Area type="monotone" dataKey="laborOutflow" name="Labor Payroll" stroke="#38bdf8" strokeWidth={2} fill="url(#laborGrad)" />
            <Area type="monotone" dataKey="subconOutflow" name="Subcontractor AP" stroke="#a855f7" strokeWidth={2} fill="url(#subconGrad)" />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );

  // Reusable Table: Recent Operations Activity
  const renderRecentActivityTable = () => (
    <div className={`${cardSurface} border rounded-2xl p-5 space-y-3`}>
      <div className="flex items-center justify-between border-b border-slate-800/70 pb-3">
        <div className="flex items-center gap-2">
          <History className="w-4 h-4 text-amber-400" />
          <h3 className={`text-sm font-bold ${headingText}`}>Recent Operations Activity</h3>
        </div>
        <button
          type="button"
          onClick={() => onNavigateTab('audit-trail')}
          className="text-xs font-semibold text-amber-400 hover:text-amber-300 flex items-center gap-1 cursor-pointer"
        >
          <span>Full Audit Log</span>
          <ArrowRight className="w-3.5 h-3.5" />
        </button>
      </div>

      {auditLogs.length === 0 ? (
        <p className={`text-xs text-center py-8 ${mutedText}`}>No recent operational activity recorded yet.</p>
      ) : (
        <div className="overflow-x-auto max-h-64 overflow-y-auto custom-scrollbar">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className={`border-b ${isDark ? 'border-slate-800 text-slate-400' : 'border-slate-200 text-slate-500'} font-mono text-[10px] uppercase`}>
                <th className="py-2 pr-3">Action</th>
                <th className="py-2 pr-3">Actor</th>
                <th className="py-2 pr-3">Details</th>
                <th className="py-2 text-right">Time</th>
              </tr>
            </thead>
            <tbody className={`divide-y ${isDark ? 'divide-slate-800/60' : 'divide-slate-200'}`}>
              {auditLogs.slice(0, 8).map((log, idx) => (
                <tr key={log.id || idx} className={isDark ? 'hover:bg-slate-800/40' : 'hover:bg-slate-50'}>
                  <td className="py-2 pr-3 whitespace-nowrap">
                    <span className="px-2 py-0.5 rounded bg-amber-500/10 border border-amber-500/25 text-amber-400 font-mono text-[10px] font-bold">
                      {log.action}
                    </span>
                  </td>
                  <td className={`py-2 pr-3 font-semibold whitespace-nowrap ${headingText}`}>{log.actorName || 'System'}</td>
                  <td className={`py-2 pr-3 max-w-xs truncate ${mutedText}`} title={log.details}>
                    {log.details}
                  </td>
                  <td className="py-2 text-right font-mono text-[10px] text-slate-500 whitespace-nowrap">
                    {(() => {
                      const rawTs = log.createdAt || (log as any).timestamp;
                      return rawTs ? new Date(rawTs).toLocaleDateString() : 'Today';
                    })()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );

  // Reusable Table: Commercial Sites & Lots Summary
  const renderCommercialSitesTable = () => (
    <div className={`${cardSurface} border rounded-2xl p-5 space-y-3`}>
      <div className="flex items-center justify-between border-b border-slate-800/70 pb-3">
        <div className="flex items-center gap-2">
          <Building2 className="w-4 h-4 text-amber-400" />
          <h3 className={`text-sm font-bold ${headingText}`}>Commercial Sites &amp; Lots</h3>
        </div>
        <button
          type="button"
          onClick={() => onNavigateTab('projects')}
          className="text-xs font-semibold text-amber-400 hover:text-amber-300 flex items-center gap-1 cursor-pointer"
        >
          <span>Manage Sites</span>
          <ArrowRight className="w-3.5 h-3.5" />
        </button>
      </div>

      {scopedProjects.length === 0 ? (
        <p className={`text-xs text-center py-8 ${mutedText}`}>No commercial sites registered yet.</p>
      ) : (
        <div className="overflow-x-auto max-h-64 overflow-y-auto custom-scrollbar">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className={`border-b ${isDark ? 'border-slate-800 text-slate-400' : 'border-slate-200 text-slate-500'} font-mono text-[10px] uppercase`}>
                <th className="py-2 pr-3">Site / Project</th>
                <th className="py-2 pr-3">Status</th>
                <th className="py-2 pr-3">Progress</th>
                <th className="py-2 text-right">Budget</th>
              </tr>
            </thead>
            <tbody className={`divide-y ${isDark ? 'divide-slate-800/60' : 'divide-slate-200'}`}>
              {scopedProjects.slice(0, 8).map((proj) => {
                const prog = getLiveProgress(proj);
                return (
                  <tr
                    key={proj.id}
                    onClick={() => onNavigateTab('projects')}
                    className={`cursor-pointer ${isDark ? 'hover:bg-slate-800/40' : 'hover:bg-slate-50'}`}
                  >
                    <td className="py-2 pr-3">
                      <div className={`font-bold truncate max-w-[200px] ${headingText}`}>{proj.name}</div>
                      <div className={`text-[10px] truncate max-w-[200px] ${mutedText}`}>{proj.clientName || proj.location}</div>
                    </td>
                    <td className="py-2 pr-3 whitespace-nowrap">
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-mono font-bold border ${proj.status === 'COMPLETED'
                          ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                          : 'bg-amber-500/15 text-amber-300 border-amber-500/30'
                          }`}
                      >
                        {proj.status || 'PLANNING'}
                      </span>
                    </td>
                    <td className="py-2 pr-3 w-32">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-1.5 bg-slate-800 rounded-full overflow-hidden">
                          <div className="h-full bg-amber-400 rounded-full" style={{ width: `${prog}%` }} />
                        </div>
                        <span className="font-mono text-[10px] font-bold text-amber-400 w-8 text-right">{prog}%</span>
                      </div>
                    </td>
                    <td className={`py-2 text-right font-mono font-semibold whitespace-nowrap ${headingText}`}>
                      {formatCompactPeso(Number(proj.budget) || 0)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );

  return (
    <div className="w-full max-w-[1600px] mx-auto space-y-5 animate-in fade-in duration-200">
      {/* Compact Persona Header Bar */}
      <div className={`${cardSurface} border rounded-2xl px-5 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3`}>
        <div>
          <div className="flex items-center gap-2">
            <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold uppercase bg-amber-500/15 text-amber-400 border border-amber-500/30">
              {persona.replace('_', ' ')} WORKSPACE
            </span>
            <span className={`text-xs ${mutedText}`}>
              Welcome back, <strong className={headingText}>{session?.name || 'Team Member'}</strong>
            </span>
          </div>
          <h2 className={`text-lg font-bold tracking-tight mt-0.5 ${headingText}`}>
            {persona === 'ADMIN' && 'Construction Portfolio Overview & Executive Command'}
            {persona === 'OPERATION_MANAGER' && 'Operations Command, Progress & Field Deployment'}
            {persona === 'PROJECT_MANAGER' && 'Site Execution & WBS Schedule Overview'}
            {persona === 'FINANCE' && 'Commercial Controls, Cash Flow & BOM Analytics'}
            {persona === 'CLIENT' && 'My Project Progress & Milestones'}
          </h2>
        </div>

        {normalizedRole === UserRole.OM && (
          <div className={`inline-flex items-center gap-1 p-1 rounded-xl border ${subSurface}`}>
            <button
              type="button"
              onClick={() => setExecLens('ADMIN')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors cursor-pointer ${execLens === 'ADMIN' ? 'bg-amber-500 text-slate-950' : `${mutedText} hover:text-white`
                }`}
            >
              Admin View
            </button>
            <button
              type="button"
              onClick={() => setExecLens('OPERATION_MANAGER')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors cursor-pointer ${execLens === 'OPERATION_MANAGER' ? 'bg-amber-500 text-slate-950' : `${mutedText} hover:text-white`
                }`}
            >
              Operations View
            </button>
          </div>
        )}
      </div>

      {/* ===================================================================== */}
      {/* 1. ADMIN & OPERATION MANAGER FULL VISUAL DASHBOARD                    */}
      {/* ===================================================================== */}
      {(persona === 'ADMIN' || persona === 'OPERATION_MANAGER') && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
            {persona === 'ADMIN' ? (
              <>
                {renderKpiCard(
                  'Active Projects',
                  activeProjects.length,
                  `${scopedProjects.length} total portfolio sites`,
                  <Building2 className="w-4 h-4 text-amber-400" />,
                  'bg-amber-500/10 border-amber-500/25',
                  () => onNavigateTab('projects')
                )}
                {renderKpiCard(
                  'Total Allocated Budget',
                  formatCompactPeso(totalContractValue),
                  `All ${scopedProjects.length} sites • Disbursed: ${formatCompactPeso(financialAnalytics.totalCompanyDisbursed)}`,
                  <DollarSign className="w-4 h-4 text-emerald-400" />,
                  'bg-emerald-500/10 border-emerald-500/25',
                  onOpenBudgetsModal
                )}
                {renderKpiCard(
                  'Pending Reviews',
                  pendingReviews.length,
                  `${clientReviews.length} total submissions`,
                  <Award className="w-4 h-4 text-cyan-400" />,
                  'bg-cyan-500/10 border-cyan-500/25',
                  () => onNavigateTab('operations-settings')
                )}
                {renderKpiCard(
                  'Avg. Progress',
                  `${avgScheduleProgress}%`,
                  `Across ${scopedProjects.length} site(s)`,
                  <TrendingUp className="w-4 h-4 text-violet-400" />,
                  'bg-violet-500/10 border-violet-500/25',
                  () => onNavigateTab('projects')
                )}
                {renderWeatherKpiCard()}
              </>
            ) : (
              <>
                {renderKpiCard(
                  'On-Track / Delayed',
                  `${onTrackProjects} / ${delayedProjects.length}`,
                  `${onTrackProjects} on track • ${delayedProjects.length} delayed`,
                  <TrendingUp className="w-4 h-4 text-emerald-400" />,
                  'bg-emerald-500/10 border-emerald-500/25',
                  () => onNavigateTab('projects')
                )}
                {renderKpiCard(
                  'Assigned Site Labor',
                  `${assignedSiteWorkers} ${assignedSiteWorkers === 1 ? 'Artisan' : 'Artisans'}`,
                  `Assigned on-site • ${contractors.length} Total Roster`,
                  <Users className="w-4 h-4 text-teal-400" />,
                  'bg-teal-500/10 border-teal-500/25',
                  () => onNavigateTab('contractors')
                )}
                {renderKpiCard(
                  'Safety / Weather Alerts',
                  weatherAlertsCount,
                  weatherAlertsCount > 0 ? 'Force Majeure active' : 'No active site stoppages',
                  <ShieldAlert className={`w-4 h-4 ${weatherAlertsCount > 0 ? 'text-rose-400' : 'text-sky-400'}`} />,
                  weatherAlertsCount > 0 ? 'bg-rose-500/10 border-rose-500/25' : 'bg-sky-500/10 border-sky-500/25',
                  () => onNavigateTab('site-diary')
                )}
                {renderKpiCard(
                  'Ready for Archive',
                  readyForArchiveCount,
                  'Projects ≥ 95% complete',
                  <Archive className="w-4 h-4 text-amber-400" />,
                  'bg-amber-500/10 border-amber-500/25',
                  () => onNavigateTab('project-history')
                )}
                {renderWeatherKpiCard()}
              </>
            )}
          </div>

          {/* Row 1: Project Progress Bar Chart + Budget Utilization & Spend */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
            <div className="lg:col-span-7">{renderProgressOverviewChart('Project Progress Overview')}</div>
            <div className="lg:col-span-5">{renderBudgetUtilizationCard()}</div>
          </div>

          {/* Row 2: Money Flow Area Chart + Pending Reviews & Executive Quick Links */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
            <div className="lg:col-span-7">{renderMoneyFlowChart()}</div>
            <div className={`lg:col-span-5 ${cardSurface} border rounded-2xl p-5 flex flex-col justify-between space-y-4`}>
              <div className="space-y-3">
                <div className="flex items-center justify-between border-b border-slate-800/70 pb-3">
                  <div className="flex items-center gap-2">
                    <Award className="w-4 h-4 text-cyan-400" />
                    <h3 className={`text-sm font-bold ${headingText}`}>Recent Pending Reviews &amp; Inquiries</h3>
                  </div>
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-amber-500/15 text-amber-300 border border-amber-500/30">
                    {pendingReviews.length} Pending
                  </span>
                </div>

                {pendingReviews.length === 0 ? (
                  <div className="py-8 text-center space-y-1.5">
                    <CheckCircle2 className="w-7 h-7 text-emerald-500/80 mx-auto" />
                    <p className={`text-xs font-semibold ${headingText}`}>Moderation Queue Clear</p>
                    <p className={`text-[11px] ${mutedText}`}>All client reviews and inquiries have been reviewed.</p>
                  </div>
                ) : (
                  <div className="space-y-2 max-h-44 overflow-y-auto pr-1 custom-scrollbar">
                    {pendingReviews.slice(0, 4).map((rev) => (
                      <div key={rev.id} className={`${subSurface} border rounded-xl p-3 space-y-1`}>
                        <div className="flex items-center justify-between gap-2">
                          <span className={`text-xs font-bold truncate ${headingText}`}>{rev.clientName}</span>
                          <span className="text-[10px] text-amber-400 font-mono shrink-0">{'★'.repeat(rev.rating)}</span>
                        </div>
                        <p className={`text-[11px] line-clamp-2 ${mutedText}`}>&ldquo;{rev.message}&rdquo;</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="grid grid-cols-3 gap-2 pt-3 border-t border-slate-800/70">
                <button
                  type="button"
                  onClick={() => (onOpenStaffSettings ? onOpenStaffSettings() : onNavigateTab('operations-settings'))}
                  className="px-2.5 py-2 rounded-xl bg-violet-600/20 hover:bg-violet-600/30 border border-violet-500/40 text-violet-300 text-[11px] font-bold flex items-center justify-center gap-1 cursor-pointer transition-colors"
                >
                  <UserCog className="w-3.5 h-3.5" />
                  <span>Staff</span>
                </button>
                <button
                  type="button"
                  onClick={() => onNavigateTab('operations-settings')}
                  className="px-2.5 py-2 rounded-xl bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/40 text-amber-300 text-[11px] font-bold flex items-center justify-center gap-1 cursor-pointer transition-colors"
                >
                  <Settings2 className="w-3.5 h-3.5" />
                  <span>Settings</span>
                </button>
                <button
                  type="button"
                  onClick={() => onNavigateTab('project-history')}
                  className="px-2.5 py-2 rounded-xl bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/40 text-emerald-300 text-[11px] font-bold flex items-center justify-center gap-1 cursor-pointer transition-colors"
                >
                  <Archive className="w-3.5 h-3.5" />
                  <span>Archive</span>
                </button>
              </div>
            </div>
          </div>

          {/* Row 3: Recent Operations Activity + Commercial Sites & Lots */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
            <div className="lg:col-span-6">{renderRecentActivityTable()}</div>
            <div className="lg:col-span-6">{renderCommercialSitesTable()}</div>
          </div>
        </>
      )}

      {/* ===================================================================== */}
      {/* 2. PROJECT MANAGER DASHBOARD (Field Visuals Only — No Payroll/Profit) */}
      {/* ===================================================================== */}
      {persona === 'PROJECT_MANAGER' && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
            {renderKpiCard(
              'Assigned Projects',
              scopedProjects.length,
              `${activeProjects.length} active • ${Math.max(0, scopedProjects.length - activeProjects.length)} completed`,
              <Building2 className="w-4 h-4 text-amber-400" />,
              'bg-amber-500/10 border-amber-500/25',
              () => onNavigateTab('projects')
            )}
            {renderKpiCard(
              'Due This Week',
              dueThisWeekTasks.length,
              'Next 7 days WBS tasks',
              <CalendarClock className="w-4 h-4 text-sky-400" />,
              'bg-sky-500/10 border-sky-500/25',
              () => onNavigateTab('gantt')
            )}
            {renderKpiCard(
              'Overdue Tasks',
              overdueTasks.length,
              overdueTasks.length > 0 ? 'Requires recovery' : 'All milestones on track',
              <AlertTriangle className={`w-4 h-4 ${overdueTasks.length > 0 ? 'text-rose-400' : 'text-emerald-400'}`} />,
              overdueTasks.length > 0 ? 'bg-rose-500/10 border-rose-500/25' : 'bg-emerald-500/10 border-emerald-500/25',
              () => onNavigateTab('gantt')
            )}
            {renderKpiCard(
              'Assigned Site Labor',
              `${assignedSiteWorkers} ${assignedSiteWorkers === 1 ? 'Artisan' : 'Artisans'}`,
              `Assigned on-site • ${contractors.length} Total Roster`,
              <Users className="w-4 h-4 text-teal-400" />,
              'bg-teal-500/10 border-teal-500/25',
              () => onNavigateTab('contractors')
            )}
            {renderWeatherKpiCard()}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
            <div className="lg:col-span-7">{renderProgressOverviewChart('Assigned Projects Progress Overview')}</div>

            {/* Upcoming & Overdue Gantt Tasks + Field Quick Links */}
            <div className={`lg:col-span-5 ${cardSurface} border rounded-2xl p-5 flex flex-col justify-between space-y-4`}>
              <div className="space-y-3">
                <div className="flex items-center justify-between border-b border-slate-800/70 pb-3">
                  <div className="flex items-center gap-2">
                    <Layers className="w-4 h-4 text-amber-400" />
                    <h3 className={`text-sm font-bold ${headingText}`}>Upcoming &amp; Overdue Gantt Tasks</h3>
                  </div>
                  <button
                    type="button"
                    onClick={() => onNavigateTab('gantt')}
                    className="text-xs font-semibold text-amber-400 hover:text-amber-300 flex items-center gap-1 cursor-pointer"
                  >
                    <span>Gantt</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>

                {overdueTasks.length === 0 && dueThisWeekTasks.length === 0 ? (
                  <div className="py-10 text-center space-y-1.5">
                    <CheckCircle2 className="w-7 h-7 text-emerald-500/80 mx-auto" />
                    <p className={`text-xs font-semibold ${headingText}`}>No Urgent or Overdue Tasks</p>
                    <p className={`text-[11px] ${mutedText}`}>
                      {scopedTasks.length === 0
                        ? 'Add WBS milestones in Master Gantt & Timeline to track field progress.'
                        : 'All tasks for your assigned sites are currently on track.'}
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2 max-h-56 overflow-y-auto pr-1 custom-scrollbar">
                    {[...overdueTasks.map((t) => ({ task: t, isOverdue: true })), ...dueThisWeekTasks.map((t) => ({ task: t, isOverdue: false }))]
                      .slice(0, 6)
                      .map(({ task, isOverdue }) => {
                        const projName = scopedProjects.find((p) => p.id === task.projectId)?.name || task.projectId;
                        return (
                          <div key={task.id} className={`${subSurface} border rounded-xl p-3 flex items-center justify-between gap-3`}>
                            <div className="min-w-0">
                              <div className={`text-xs font-bold truncate ${headingText}`}>{task.title || (task as any).text}</div>
                              <div className={`text-[10px] truncate ${mutedText}`}>{projName}</div>
                            </div>
                            <span
                              className={`px-2 py-0.5 rounded-md text-[10px] font-mono font-bold shrink-0 border ${isOverdue
                                ? 'bg-rose-500/15 text-rose-300 border-rose-500/30'
                                : 'bg-amber-500/15 text-amber-300 border-amber-500/30'
                                }`}
                            >
                              {isOverdue ? 'OVERDUE' : 'DUE SOON'}
                            </span>
                          </div>
                        );
                      })}
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-2.5 pt-3 border-t border-slate-800/70">
                <button
                  type="button"
                  onClick={() => onNavigateTab('gantt')}
                  className="px-3 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer transition-colors"
                >
                  <BarChart3 className="w-3.5 h-3.5" />
                  <span>Master Gantt</span>
                </button>
                <button
                  type="button"
                  onClick={() => onNavigateTab('contractors')}
                  className="px-3 py-2.5 rounded-xl bg-teal-500/15 hover:bg-teal-500/25 border border-teal-500/40 text-teal-300 text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer transition-colors"
                >
                  <Users className="w-3.5 h-3.5" />
                  <span>Workforce</span>
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* ===================================================================== */}
      {/* 3. FINANCE VISUAL DASHBOARD                                           */}
      {/* ===================================================================== */}
      {persona === 'FINANCE' && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
            {renderKpiCard(
              'Total Contract Value',
              formatCompactPeso(totalContractValue),
              `Across ${scopedProjects.length} project(s)`,
              <DollarSign className="w-4 h-4 text-emerald-400" />,
              'bg-emerald-500/10 border-emerald-500/25',
              () => onNavigateTab('payments')
            )}
            {renderKpiCard(
              'Active BOMs / Quotations',
              activeBomsCount,
              `${projectBomSummary.filter((b) => b.bomPhases === 0).length} project(s) with blank BOM`,
              <FileSpreadsheet className="w-4 h-4 text-amber-400" />,
              'bg-amber-500/10 border-amber-500/25',
              () => onNavigateTab('quotation-leads')
            )}
            {renderKpiCard(
              'Payroll Register Total',
              `₱${currentPayrollTotal.toLocaleString(undefined, { maximumFractionDigits: 0 })}`,
              payrollRuns.length > 0 ? `${payrollRuns.length} payroll run(s)` : 'Weekly labor estimate',
              <Banknote className="w-4 h-4 text-cyan-400" />,
              'bg-cyan-500/10 border-cyan-500/25',
              () => onNavigateTab('finance-payroll')
            )}
            {renderKpiCard(
              'Pending BOM → Gantt Sync',
              pendingBomSyncCount,
              pendingBomSyncCount > 0 ? 'Ready to sync WBS' : 'All active BOMs synced',
              <RefreshCw className="w-4 h-4 text-violet-400" />,
              'bg-violet-500/10 border-violet-500/25',
              () => onNavigateTab('quotation-leads')
            )}
          </div>

          {/* Finance Charts Row: Money Flow Area Chart + Budget Utilization */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
            <div className="lg:col-span-7">{renderMoneyFlowChart()}</div>
            <div className="lg:col-span-5">{renderBudgetUtilizationCard()}</div>
          </div>

          {/* Finance Action Row: Projects & BOM Status + Quick Actions */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
            <div className={`lg:col-span-8 ${cardSurface} border rounded-2xl p-5 space-y-4`}>
              <div className="flex items-center justify-between border-b border-slate-800/70 pb-3">
                <div className="flex items-center gap-2">
                  <FileSpreadsheet className="w-4 h-4 text-amber-400" />
                  <h3 className={`text-sm font-bold ${headingText}`}>Projects &amp; BOM Status</h3>
                </div>
                <span className={`text-[11px] font-mono ${mutedText}`}>{scopedProjects.length} Projects</span>
              </div>

              {projectBomSummary.length === 0 ? (
                <div className="py-10 text-center space-y-2">
                  <FileSpreadsheet className="w-8 h-8 text-slate-600 mx-auto" />
                  <p className={`text-xs font-semibold ${headingText}`}>No Projects Available</p>
                </div>
              ) : (
                <div className="space-y-2 max-h-64 overflow-y-auto pr-1 custom-scrollbar">
                  {projectBomSummary.map(({ project, bomPhases, pendingGanttSync }) => (
                    <div key={project.id} className={`${subSurface} border rounded-xl p-3 flex items-center justify-between gap-3`}>
                      <div className="min-w-0">
                        <div className={`text-xs font-bold truncate ${headingText}`}>{project.name}</div>
                        <div className={`text-[10px] font-mono ${mutedText}`}>
                          Budget: ₱{(Number(project.budget) || 0).toLocaleString()} • Collected: ₱{(Number(project.fundsCollected) || 0).toLocaleString()}
                        </div>
                      </div>
                      {bomPhases === 0 ? (
                        <span className="px-2 py-0.5 rounded-md text-[10px] font-mono font-bold bg-amber-500/15 text-amber-300 border border-amber-500/40 shrink-0">
                          0 BOM PHASES (BLANK)
                        </span>
                      ) : pendingGanttSync ? (
                        <span className="px-2 py-0.5 rounded-md text-[10px] font-mono font-bold bg-violet-500/15 text-violet-300 border border-violet-500/40 shrink-0">
                          {bomPhases} PHASES • SYNC PENDING
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded-md text-[10px] font-mono font-bold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 shrink-0">
                          {bomPhases} PHASES • SYNCED
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className={`lg:col-span-4 ${cardSurface} border rounded-2xl p-5 flex flex-col justify-between space-y-4`}>
              <div className="space-y-2">
                <h3 className={`text-sm font-bold ${headingText}`}>Quick Commercial Actions</h3>
                <p className={`text-xs ${mutedText}`}>Jump directly to BOM costing, payroll disbursal, or client billing.</p>
              </div>
              <div className="space-y-2.5">
                <button
                  type="button"
                  onClick={() => onNavigateTab('quotation-leads')}
                  className="w-full px-4 py-3 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold flex items-center justify-between cursor-pointer transition-colors"
                >
                  <span className="flex items-center gap-2"><FileSpreadsheet className="w-4 h-4" /> BOM &amp; Quotation Builder</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => onNavigateTab('finance-payroll')}
                  className="w-full px-4 py-3 rounded-xl bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-500/40 text-cyan-300 text-xs font-bold flex items-center justify-between cursor-pointer transition-colors"
                >
                  <span className="flex items-center gap-2"><Banknote className="w-4 h-4" /> Payroll Register</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => onNavigateTab('payments')}
                  className={`w-full px-4 py-3 rounded-xl border text-xs font-bold flex items-center justify-between cursor-pointer transition-colors ${subSurface} ${headingText} hover:border-emerald-500/50`}
                >
                  <span className="flex items-center gap-2"><DollarSign className="w-4 h-4 text-emerald-400" /> Progress Billing &amp; Receipts</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* ===================================================================== */}
      {/* 4. CLIENT VISUAL DASHBOARD (Read-Only Scoped View)                    */}
      {/* ===================================================================== */}
      {persona === 'CLIENT' && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
            {renderKpiCard(
              'Overall Completion',
              `${clientCompletionPct}%`,
              primaryClientProject ? primaryClientProject.name : 'No project assigned yet',
              <TrendingUp className="w-4 h-4 text-emerald-400" />,
              'bg-emerald-500/10 border-emerald-500/25'
            )}
            {renderKpiCard(
              'Current Active Phase',
              clientActiveTask ? clientActiveTask.title || (clientActiveTask as any).text || 'In Progress' : primaryClientProject?.status || 'Pending',
              'Live construction milestone',
              <Clock className="w-4 h-4 text-amber-400" />,
              'bg-amber-500/10 border-amber-500/25'
            )}
            {renderKpiCard(
              'Target Completion Date',
              primaryClientProject?.targetHandoverDate || 'TBD',
              'Contractual handover target',
              <CalendarClock className="w-4 h-4 text-sky-400" />,
              'bg-sky-500/10 border-sky-500/25'
            )}
            {renderKpiCard(
              'Project Documents',
              documents.length,
              'Blueprints, permits & handover files',
              <FolderKanban className="w-4 h-4 text-violet-400" />,
              'bg-violet-500/10 border-violet-500/25',
              () => onNavigateTab('documents')
            )}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
            <div className="lg:col-span-6">{renderProgressOverviewChart('My Project Progress', true)}</div>

            <div className={`lg:col-span-6 ${cardSurface} border rounded-2xl p-5 flex flex-col justify-between space-y-4`}>
              <div className="space-y-3">
                <div className="flex items-center justify-between border-b border-slate-800/70 pb-3">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                    <h3 className={`text-sm font-bold ${headingText}`}>Milestone Progress</h3>
                  </div>
                  <span className="text-[10px] font-mono text-slate-400 uppercase">Read-Only</span>
                </div>

                {scopedTasks.length === 0 ? (
                  <div className="py-8 text-center space-y-1.5">
                    <Building2 className="w-7 h-7 text-slate-600 mx-auto" />
                    <p className={`text-xs font-semibold ${headingText}`}>No Milestones Published Yet</p>
                    <p className={`text-[11px] ${mutedText}`}>Your Project Manager will publish schedule milestones here shortly.</p>
                  </div>
                ) : (
                  <div className="space-y-2 max-h-48 overflow-y-auto pr-1 custom-scrollbar">
                    {scopedTasks.slice(0, 6).map((task) => {
                      const rawP = typeof (task as any).progress === 'number' ? (task as any).progress : 0;
                      const pct = Math.round(rawP <= 1 ? rawP * 100 : rawP);
                      return (
                        <div key={task.id} className={`${subSurface} border rounded-xl p-2.5 flex items-center justify-between gap-3`}>
                          <div className="min-w-0 flex-1">
                            <div className={`text-xs font-bold truncate ${headingText}`}>{task.title || (task as any).text}</div>
                            <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden mt-1">
                              <div className="h-full bg-emerald-400 rounded-full" style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} />
                            </div>
                          </div>
                          <span className="text-xs font-mono font-bold text-emerald-400 shrink-0">{pct}%</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <button
                type="button"
                onClick={() => onNavigateTab('documents')}
                className="w-full px-4 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold flex items-center justify-center gap-2 cursor-pointer transition-colors"
              >
                <FileText className="w-4 h-4" />
                <span>Open Project Documents</span>
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
