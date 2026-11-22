/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo } from 'react';
import {
  Users, HardHat, AlertTriangle, Award, BadgeAlert,
  BarChart3, Building, PieChart, RefreshCw, Sparkles, Bot, Zap,
  X, CheckCircle, CheckCheck, ChevronUp, ChevronDown, ArrowRight,
  Lightbulb, ClipboardList, Plus, TrendingUp, Check,
  ArrowRightLeft, Sliders, MapPin, Building2, UserCheck, Lock
} from 'lucide-react';
import {
  ResponsiveContainer, BarChart as ReBarChart, Bar, XAxis, YAxis, Tooltip,
  CartesianGrid, Cell, PieChart as RePieChart, Pie, LabelList
} from 'recharts';
import {
  Contractor, DailyManpowerAudit, AIManpowerRecommendation,
  ProjectProfile, isOfficeOrExecutive, isIndividualStaffOrEngineer
} from '../types';
import { useTheme } from '../context/ThemeContext';
import { normalizeRole, UserRole } from '../utils/rbac';
import { getStoredSession } from '../utils/session';
import { getCsrfToken } from '../utils/apiClient';
import WorkforceMessengerRoster from './WorkforceMessengerRoster';

export interface LaborWorkforceArtisanTradesProps {
  contractors: Contractor[];
  manpowerAudits: DailyManpowerAudit[];
  projects: ProjectProfile[];
  userRole?: string;
  isAdmin?: boolean;
  aiRecommendations: AIManpowerRecommendation[];
  isAiScanning: boolean;
  aiScanMessage: string | null;
  handleTriggerAiScan: () => void;
  onApplyAIRecommendation?: (recId: string) => Promise<any> | void;
  onDismissAIRecommendation?: (recId: string) => Promise<any> | void;
  showAppliedRecsHistory: boolean;
  setShowAppliedRecsHistory: React.Dispatch<React.SetStateAction<boolean>>;
  totalManpower: number;
  deployedFieldContractors: Contractor[];
  inHouseCount: number;
  outsourcedCount: number;
  projectLaborChartData: any[];
  tradeManpowerChartData: any[];
  rollCallComparisonChartData: any[];
  employmentMixChartData: any[];
  onDeleteContractor?: (id: string) => void;
  onUpdateContractor?: (contractor: Contractor) => void;
  onUpdateContractors?: (contractors: Contractor[]) => void;
  onUpdateProject?: (id: string, updates: Partial<ProjectProfile>) => void;
  onRegisterWorkerClick: () => void;
  onLogAuditClick: () => void;
  onVerifyRollCall?: (contractorId: string) => void;
  notify: (msg: string) => void;
  /** Forces an initial sub-tab. */
  initialTab?: WorkforceTabId;
  readOnly?: boolean;
  isFinance?: boolean;
  hideTabs?: boolean;
}

export type WorkforceTabId = 'workbench' | 'site-analytics' | 'analytics' | 'directory';

export interface AllocationAuditEntry {
  id: string;
  timestamp: string;
  actorRole: string;
  workerId: string;
  workerName: string;
  trade: string;
  projectId: string;
  projectName: string;
  action: 'Assigned' | 'Unassigned' | 'Conflict Override' | 'AI Recommendation Applied';
  source: 'Manual' | 'AI';
  hadScheduleConflict: boolean;
  conflictDetails?: string;
  overrideNote?: string;
  isLockedByAdmin: boolean;
  dailyRate: number;
}

const OVERRIDE_REASON_PRESETS = [
  'Critical-Path Recovery',
  'Split-Shift Supervision',
  'Emergency Coverage',
  'Custom Note',
];

export interface ProjectTradeRequirement {
  id: string;
  label: string;
  required: number;
  matchTerms: string[];
}

const DEFAULT_SITE_TRADE_REQUIREMENTS: ProjectTradeRequirement[] = [
  { id: 'mep', label: 'MEP Engineer', required: 1, matchTerms: ['mep', 'mepfs', 'electrical', 'electrician', 'mechanical', 'plumbing', 'plumber', 'hvac', 'fdas', 'fire protection', 'sanitary'] },
  { id: 'architect', label: 'Architect', required: 1, matchTerms: ['architect', 'architectural', 'interior designer', 'interior', 'cad', 'draftsman'] },
  { id: 'pm', label: 'PM', required: 1, matchTerms: ['project manager', 'site engineer', 'civil engineer', 'head engineer', 'project engineer', 'structural engineer', 'resident engineer'] },
  { id: 'foreman', label: 'Site Foreman', required: 1, matchTerms: ['foreman', 'leadman', 'site supervisor', 'general foreman', 'field supervisor'] },
  { id: 'labor', label: 'Labor Crew', required: 1, matchTerms: ['mason', 'carpenter', 'welder', 'painter', 'tile', 'drywall', 'labor', 'artisan', 'helper', 'finishing', 'steel', 'general'] }
];

const TRADE_REQUIREMENT_PRESETS: Array<{ id: string; name: string; subtitle: string; requirements: ProjectTradeRequirement[] }> = [
  {
    id: 'standard',
    name: 'Standard 5-Role Site Crew',
    subtitle: 'Balanced 1-per-role baseline for general sites',
    requirements: DEFAULT_SITE_TRADE_REQUIREMENTS
  },
  {
    id: 'residential_2storey',
    name: '2-Storey Residential Build',
    subtitle: 'Civil/structural supervision + 2 labor artisans',
    requirements: [
      { ...DEFAULT_SITE_TRADE_REQUIREMENTS[2], required: 1 },
      { ...DEFAULT_SITE_TRADE_REQUIREMENTS[3], required: 1 },
      { ...DEFAULT_SITE_TRADE_REQUIREMENTS[0], required: 1 },
      { ...DEFAULT_SITE_TRADE_REQUIREMENTS[1], required: 1 },
      { ...DEFAULT_SITE_TRADE_REQUIREMENTS[4], required: 2 }
    ]
  },
  {
    id: 'commercial_fitout',
    name: 'Commercial / Office Fit-Out',
    subtitle: 'MEP-heavy fit-out with Safety Officer & 2 artisans',
    requirements: [
      { ...DEFAULT_SITE_TRADE_REQUIREMENTS[2], required: 1 },
      { ...DEFAULT_SITE_TRADE_REQUIREMENTS[3], required: 1 },
      { ...DEFAULT_SITE_TRADE_REQUIREMENTS[0], required: 2 },
      { ...DEFAULT_SITE_TRADE_REQUIREMENTS[1], required: 1 },
      { id: 'safety', label: 'Safety Officer', required: 1, matchTerms: ['safety', 'hse', 'osh', 'ppe'] },
      { ...DEFAULT_SITE_TRADE_REQUIREMENTS[4], required: 2 }
    ]
  },
  {
    id: 'condo_renovation',
    name: 'Condominium Renovation',
    subtitle: 'Compact interior crew (Foreman, MEP, Architect, Crew)',
    requirements: [
      { ...DEFAULT_SITE_TRADE_REQUIREMENTS[3], required: 1 },
      { ...DEFAULT_SITE_TRADE_REQUIREMENTS[0], required: 1 },
      { ...DEFAULT_SITE_TRADE_REQUIREMENTS[1], required: 1 },
      { ...DEFAULT_SITE_TRADE_REQUIREMENTS[4], required: 1 }
    ]
  }
];

function buildMatchTermsForLabel(label: string): string[] {
  const lower = label.toLowerCase().trim();
  const baseTerms = new Set<string>([lower]);
  lower.split(/[\s/,&-]+/).forEach((tok) => {
    if (tok.length >= 3 && !['the', 'and', 'for', 'site', 'lead', 'senior', 'junior'].includes(tok)) {
      baseTerms.add(tok);
    }
  });
  if (lower.includes('mep') || lower.includes('electr') || lower.includes('mech') || lower.includes('plumb')) {
    ['mep', 'mepfs', 'electrical', 'electrician', 'mechanical', 'plumbing', 'plumber', 'hvac'].forEach(t => baseTerms.add(t));
  }
  if (lower.includes('safety')) ['safety', 'osh', 'hse'].forEach(t => baseTerms.add(t));
  if (lower.includes('qa') || lower.includes('qc')) ['qa', 'qc', 'quality', 'inspector'].forEach(t => baseTerms.add(t));
  return Array.from(baseTerms);
}

function isExecutiveOrCorporateWorker(w: Contractor): boolean {
  if (isOfficeOrExecutive(w)) return true;
  const text = `${w.roleTitle || ''} ${w.tradeType || ''} ${w.specialty || ''}`.toLowerCase();
  return /\b(ceo|coo|cfo|president|vice president|vp|director|hr|human resources|accounting|finance|legal|admin officer|executive)\b/.test(text);
}

// Priority-ordered trade matcher: specific technical trades (MEP, Architect, Safety, etc.) match BEFORE generic Foreman/Labor
function matchWorkerToTradeSlot(w: Contractor, requirements: ProjectTradeRequirement[]): string | null {
  if (isExecutiveOrCorporateWorker(w)) return null;
  const text = `${w.roleTitle || ''} ${w.tradeType || ''} ${w.specialty || ''}`.toLowerCase();

  // Order requirements so specific technical roles (mep, architect, custom) are evaluated before generic foreman/labor
  const priorityOrder = (req: ProjectTradeRequirement) => {
    if (req.id === 'mep') return 1;
    if (req.id === 'architect') return 2;
    if (req.id !== 'pm' && req.id !== 'foreman' && req.id !== 'labor') return 3;
    if (req.id === 'pm') return 4;
    if (req.id === 'foreman') return 5;
    return 6;
  };
  const ordered = [...requirements].sort((a, b) => priorityOrder(a) - priorityOrder(b));

  for (const slot of ordered) {
    if (slot.matchTerms.some((term) => term && text.includes(term.toLowerCase()))) {
      return slot.id;
    }
  }
  const laborFallback = requirements.find(r => r.id === 'labor');
  return laborFallback ? laborFallback.id : null;
}

function loadProjectTradeRequirements(projectId: string | undefined): ProjectTradeRequirement[] {
  if (!projectId || typeof window === 'undefined') return DEFAULT_SITE_TRADE_REQUIREMENTS;
  try {
    const raw = localStorage.getItem(`ldm_project_trade_reqs_${projectId}`);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch { }
  return DEFAULT_SITE_TRADE_REQUIREMENTS;
}

const TABS: { id: WorkforceTabId; label: string; icon: React.ElementType }[] = [
  { id: 'workbench', label: 'Dispatch Workbench', icon: Sliders },
  { id: 'site-analytics', label: 'Site Analytics', icon: PieChart },
  { id: 'analytics', label: 'Workforce Analytics & Reports', icon: BarChart3 },
  { id: 'directory', label: 'Personnel Directory & Roster', icon: Users },
];

export const LaborWorkforceArtisanTrades: React.FC<LaborWorkforceArtisanTradesProps> = ({
  contractors,
  manpowerAudits,
  projects,
  userRole,
  isAdmin = false,
  aiRecommendations,
  isAiScanning,
  aiScanMessage,
  handleTriggerAiScan,
  onApplyAIRecommendation,
  onDismissAIRecommendation,
  showAppliedRecsHistory,
  setShowAppliedRecsHistory,
  totalManpower,
  deployedFieldContractors,
  inHouseCount,
  outsourcedCount,
  projectLaborChartData,
  tradeManpowerChartData,
  rollCallComparisonChartData,
  employmentMixChartData,
  onDeleteContractor,
  onUpdateContractor,
  onUpdateContractors,
  onUpdateProject,
  onRegisterWorkerClick,
  onLogAuditClick,
  onVerifyRollCall,
  notify,
  initialTab,
  readOnly = false,
  isFinance = false,
  hideTabs = false,
}) => {
  const { isDark } = useTheme();

  const currentRole = normalizeRole(userRole);
  const isOM = currentRole === UserRole.OM || isAdmin;
  const isPM = currentRole === UserRole.PM;

  const availableTabs = useMemo(() => {
    return TABS.filter(tab => {
      // Dispatch Workbench & Project-Scoped Site Analytics: PM / Site Engineer only
      if (tab.id === 'workbench' || tab.id === 'site-analytics') return isPM || (!isOM && !isPM);
      // Company-wide Workforce Analytics & Reports: OM only
      if (tab.id === 'analytics') return isOM;
      // Personnel Directory & Roster: Show for both
      return true;
    });
  }, [isOM, isPM]);

  const [activeSubTab, setActiveSubTab] = useState<WorkforceTabId>(() => {
    if (initialTab) return initialTab;
    if (isOM) return 'analytics';
    return 'workbench';
  });

  // Guard activeSubTab if role changes or tab is unauthorized
  useEffect(() => {
    if (isOM && (activeSubTab === 'workbench' || activeSubTab === 'site-analytics')) {
      setActiveSubTab('analytics');
    } else if (isPM && activeSubTab === 'analytics') {
      setActiveSubTab('workbench');
    }
  }, [isOM, isPM, activeSubTab]);
  const [recommendationQueue, setRecommendationQueue] = useState<AIManpowerRecommendation[]>([]);
  const [appliedTransfersHistory, setAppliedTransfersHistory] = useState<AIManpowerRecommendation[]>([]);

  // Live Immutable Synced State for Projects & Contractors (ensures instant reactive updates across Tab 1 & Tab 2)
  const [localContractors, setLocalContractors] = useState<Contractor[]>(contractors);
  const [localProjectAssignments, setLocalProjectAssignments] = useState<Record<string, string[]>>({});

  useEffect(() => {
    setLocalContractors(contractors);
  }, [contractors]);

  useEffect(() => {
    setLocalProjectAssignments(prev => {
      const next = { ...prev };
      projects.forEach(p => {
        if (!next[p.id]) {
          const byId = p.assignedContractorIds || [];
          const bySite = contractors
            .filter(c => (c.activeProjectSite || '').trim().toLowerCase() === p.name.trim().toLowerCase())
            .map(c => c.id);
          next[p.id] = Array.from(new Set([...byId, ...bySite]));
        }
      });
      return next;
    });
  }, [projects, contractors]);

  // Unified Allocation Workbench State
  const [selectedWorkbenchProjectId, setSelectedWorkbenchProjectId] = useState<string>(() => {
    const active = projects.find(p => p.status !== 'COMPLETED' && p.status !== 'HANDED_OVER') || projects[0];
    return active?.id || '';
  });
  const [isAiAssistantOpen, setIsAiAssistantOpen] = useState<boolean>(true);
  const [aiSortMode, setAiSortMode] = useState<'match' | 'cost'>('match');
  const [rosterSearchQuery, setRosterSearchQuery] = useState<string>('');
  const [quickAddWorkerId, setQuickAddWorkerId] = useState<string>('');
  const [quickAddOverrideReason, setQuickAddOverrideReason] = useState<string>(OVERRIDE_REASON_PRESETS[0]);
  const [poolPendingOverrideReasons, setPoolPendingOverrideReasons] = useState<Record<string, string>>({});
  const [crewSelectedWorkerIds, setCrewSelectedWorkerIds] = useState<string[]>([]);
  const [dismissedWorkforceStagedIds, setDismissedWorkforceStagedIds] = useState<string[]>([]);
  const [crewAllocationSourceMap, setCrewAllocationSourceMap] = useState<Record<string, 'Manual' | 'AI'>>({});
  const [crewOverrideNotes, setCrewOverrideNotes] = useState<Record<string, string>>({});
  const [crewAdminLocks, setCrewAdminLocks] = useState<Record<string, boolean>>({});
  const [activeWorkforceNoteEditorId, setActiveWorkforceNoteEditorId] = useState<string | null>(null);
  const [allocationAuditTrail, setAllocationAuditTrail] = useState<AllocationAuditEntry[]>([]);
  const [lastAllocationFeedback, setLastAllocationFeedback] = useState<{
    workerId: string;
    workerName: string;
    source: 'Manual' | 'AI';
    action: 'assigned' | 'unassigned';
  } | null>(null);

  const storedSession = getStoredSession();
  const resolvedRoleLabel = isFinance
    ? 'Finance Controller'
    : isPM
      ? 'Project Manager'
      : isOM
        ? 'Operations Manager'
        : String(userRole || storedSession?.role || 'Site Staff');
  const currentActorRole = storedSession?.name
    ? `${storedSession.name} (${resolvedRoleLabel})`
    : resolvedRoleLabel;

  // Per-project configurable trade requirements state + Edit Requirements Modal
  const [projectTradeReqsMap, setProjectTradeReqsMap] = useState<Record<string, ProjectTradeRequirement[]>>({});
  const [isEditReqsModalOpen, setIsEditReqsModalOpen] = useState(false);
  const [draftTradeReqs, setDraftTradeReqs] = useState<ProjectTradeRequirement[]>(DEFAULT_SITE_TRADE_REQUIREMENTS);
  const [newCustomTradeLabel, setNewCustomTradeLabel] = useState('');
  const [newCustomTradeQty, setNewCustomTradeQty] = useState<number>(1);

  // Explainable AI Score Drawer, Auto-Optimize Preview Modal & Conflict Override Modal State
  const [expandedScoreCardIds, setExpandedScoreCardIds] = useState<Record<string, boolean>>({});
  const [isOptimizeModalOpen, setIsOptimizeModalOpen] = useState(false);
  const [isDeployingOptimizedCrew, setIsDeployingOptimizedCrew] = useState(false);
  const [pendingConflictAssign, setPendingConflictAssign] = useState<{
    worker: Contractor;
    source: 'Manual' | 'AI';
    linkedRec?: AIManpowerRecommendation;
    conflictSites: string[];
  } | null>(null);
  const [conflictOverridePreset, setConflictOverridePreset] = useState<string>(OVERRIDE_REASON_PRESETS[0]);
  const [conflictCustomNote, setConflictCustomNote] = useState<string>('');

  // Daily wage rate helper (₱/day)
  const getWorkerDailyRate = (w: Contractor): number => {
    if (w.dailyRate && Number(w.dailyRate) > 0) return Math.round(Number(w.dailyRate));
    if (w.monthlySalary && Number(w.monthlySalary) > 0) return Math.round(Number(w.monthlySalary) / 26);
    const trade = (w.tradeType || w.specialty || w.roleTitle || '').toLowerCase();
    if (trade.includes('foreman') || trade.includes('engineer') || trade.includes('architect')) return 1200;
    if (trade.includes('electrician') || trade.includes('plumber') || trade.includes('welder') || trade.includes('carpenter') || trade.includes('mason')) return 950;
    return 800;
  };

  // Human Override Protection Lock check: strictly true if locked by Admin or has a manual override note
  const isWorkerLockedByAdmin = (w: Contractor): boolean => {
    const note = (crewOverrideNotes[w.id] ?? w.manualOverrideNote ?? '').trim();
    return Boolean(crewAdminLocks[w.id] || w.isLockedByAdmin || note.length > 0);
  };

  // Active target project for the Allocation Workbench
  const targetAllocationProject = useMemo(() => {
    if (selectedWorkbenchProjectId && projects.length > 0) {
      const matched = projects.find(p => p.id === selectedWorkbenchProjectId);
      if (matched) return matched;
    }
    return projects.find(p => p.status !== 'COMPLETED' && p.status !== 'HANDED_OVER') || projects[0] || null;
  }, [selectedWorkbenchProjectId, projects]);

  // Active project's configurable trade requirements (persisted per project in localStorage)
  const activeProjectTradeReqs = useMemo<ProjectTradeRequirement[]>(() => {
    const pid = targetAllocationProject?.id;
    if (!pid) return DEFAULT_SITE_TRADE_REQUIREMENTS;
    if (projectTradeReqsMap[pid]) return projectTradeReqsMap[pid];
    return loadProjectTradeRequirements(pid);
  }, [targetAllocationProject?.id, projectTradeReqsMap]);

  const handleOpenEditReqsModal = () => {
    setDraftTradeReqs(activeProjectTradeReqs.map(r => ({ ...r, matchTerms: [...r.matchTerms] })));
    setNewCustomTradeLabel('');
    setNewCustomTradeQty(1);
    setIsEditReqsModalOpen(true);
  };

  const handleSaveProjectTradeReqs = () => {
    const pid = targetAllocationProject?.id;
    if (!pid) return;
    const cleaned = draftTradeReqs.filter(r => r.label.trim().length > 0 && r.required > 0);
    const finalReqs = cleaned.length > 0 ? cleaned : DEFAULT_SITE_TRADE_REQUIREMENTS;
    setProjectTradeReqsMap(prev => ({ ...prev, [pid]: finalReqs }));
    try {
      localStorage.setItem(`ldm_project_trade_reqs_${pid}`, JSON.stringify(finalReqs));
    } catch { }
    setIsEditReqsModalOpen(false);
    notify(`✓ Updated Site Trade Requirements for "${targetAllocationProject?.name}".`);
  };

  // Keep selectedWorkbenchProjectId valid when projects load
  useEffect(() => {
    if (!selectedWorkbenchProjectId && targetAllocationProject) {
      setSelectedWorkbenchProjectId(targetAllocationProject.id);
    }
  }, [targetAllocationProject?.id]);

  // Helper to get live assigned worker IDs for any project
  const getProjectAssignedIds = (proj: ProjectProfile): string[] => {
    if (localProjectAssignments[proj.id]) {
      return localProjectAssignments[proj.id];
    }
    const assignedByIds = proj.assignedContractorIds || [];
    const assignedBySite = localContractors
      .filter(c => (c.activeProjectSite || '').trim().toLowerCase() === proj.name.trim().toLowerCase())
      .map(c => c.id);
    return Array.from(new Set([...assignedByIds, ...assignedBySite]));
  };

  // Sync assigned crew IDs when target project changes
  useEffect(() => {
    if (targetAllocationProject) {
      const merged = getProjectAssignedIds(targetAllocationProject);
      setCrewSelectedWorkerIds(merged);
      setCrewAllocationSourceMap(prev => {
        const next = { ...prev };
        merged.forEach(id => {
          const found = localContractors.find(c => c.id === id);
          if (!next[id]) next[id] = found?.allocationSource || 'Manual';
        });
        return next;
      });
    } else {
      setCrewSelectedWorkerIds([]);
    }
  }, [targetAllocationProject?.id, localProjectAssignments]);

  // Append an entry to the live Audit Trail (capturing exact timestamp, administrator role, and justification note)
  const appendAuditEntry = (entry: Omit<AllocationAuditEntry, 'id' | 'timestamp' | 'actorRole'> & { actorRole?: string }) => {
    const now = new Date();
    const formattedTimestamp = `${now.toLocaleDateString([], { year: 'numeric', month: 'short', day: '2-digit' })} • ${now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
    const newEntry: AllocationAuditEntry = {
      ...entry,
      actorRole: entry.actorRole || currentActorRole,
      id: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      timestamp: formattedTimestamp
    };
    setAllocationAuditTrail(prev => [newEntry, ...prev].slice(0, 25));
  };

  const handleUpdateWorkforceOverrideNote = (worker: Contractor, note: string) => {
    setCrewOverrideNotes(prev => ({ ...prev, [worker.id]: note }));
    const hasNote = note.trim().length > 0;
    const nextLocked = hasNote ? true : Boolean(crewAdminLocks[worker.id]);
    setCrewAdminLocks(prev => ({ ...prev, [worker.id]: nextLocked }));
    setCrewAllocationSourceMap(prev => ({ ...prev, [worker.id]: 'Manual' }));

    const updatedWorker: Contractor = {
      ...worker,
      manualOverrideNote: note,
      isLockedByAdmin: nextLocked,
      allocationSource: 'Manual'
    };
    setLocalContractors(prev => prev.map(c => (c.id === worker.id ? updatedWorker : c)));
    if (onUpdateContractor) onUpdateContractor(updatedWorker);
    if (onUpdateContractors) {
      onUpdateContractors(localContractors.map(c => (c.id === worker.id ? updatedWorker : c)));
    }

    if (hasNote && targetAllocationProject) {
      const avail = getWorkerAvailabilityAdvisory(worker, targetAllocationProject);
      appendAuditEntry({
        workerId: worker.id,
        workerName: worker.name,
        trade: worker.tradeType || worker.specialty || 'General Trade',
        projectId: targetAllocationProject.id,
        projectName: targetAllocationProject.name,
        action: 'Conflict Override',
        source: 'Manual',
        hadScheduleConflict: avail.isOverlapping,
        conflictDetails: avail.isOverlapping ? avail.badgeText : undefined,
        overrideNote: note,
        isLockedByAdmin: true,
        dailyRate: getWorkerDailyRate(worker)
      });
    }
  };

  const handleToggleWorkforceAdminLock = (worker: Contractor) => {
    const currentLock = isWorkerLockedByAdmin(worker);
    const nextLock = !currentLock;
    setCrewAdminLocks(prev => ({ ...prev, [worker.id]: nextLock }));
    setCrewAllocationSourceMap(prev => ({ ...prev, [worker.id]: 'Manual' }));

    const updatedWorker: Contractor = {
      ...worker,
      isLockedByAdmin: nextLock,
      allocationSource: 'Manual'
    };
    setLocalContractors(prev => prev.map(c => (c.id === worker.id ? updatedWorker : c)));
    if (onUpdateContractor) onUpdateContractor(updatedWorker);
    if (onUpdateContractors) {
      onUpdateContractors(localContractors.map(c => (c.id === worker.id ? updatedWorker : c)));
    }
  };

  // Non-Blocking Overlap & Availability Cross-Reference against startDate & targetHandoverDate
  const getWorkerAvailabilityAdvisory = (
    w: Contractor,
    targetProj?: ProjectProfile | null
  ): { isOverlapping: boolean; overlappingProjects: string[]; badgeText: string } => {
    const excludeId = targetProj?.id;
    const reqStart = targetProj?.startDate ? new Date(targetProj.startDate).getTime() : NaN;
    const reqEnd = targetProj?.targetHandoverDate ? new Date(targetProj.targetHandoverDate).getTime() : NaN;
    const hasValidTargetDates = !isNaN(reqStart) && !isNaN(reqEnd);

    const activeProjects = projects.filter(
      p => p.id !== excludeId && p.status !== 'COMPLETED' && p.status !== 'HANDED_OVER'
    );

    const overlappingNames: string[] = [];

    for (const proj of activeProjects) {
      const projIds = getProjectAssignedIds(proj);
      const isAssignedById = projIds.includes(w.id) || w.assignedProjectId === proj.id;
      const isAssignedBySiteName = Boolean(
        w.activeProjectSite &&
        !w.activeProjectSite.toLowerCase().includes('standby') &&
        proj.name.trim().toLowerCase() === w.activeProjectSite.trim().toLowerCase()
      );

      if (!isAssignedById && !isAssignedBySiteName) continue;

      const projStart = proj.startDate ? new Date(proj.startDate).getTime() : NaN;
      const projEnd = proj.targetHandoverDate ? new Date(proj.targetHandoverDate).getTime() : NaN;
      const hasValidProjDates = !isNaN(projStart) && !isNaN(projEnd);

      const datesOverlap =
        hasValidTargetDates && hasValidProjDates
          ? reqStart <= projEnd && reqEnd >= projStart
          : true;

      if (datesOverlap && !overlappingNames.includes(proj.name)) {
        overlappingNames.push(proj.name);
      }
    }

    if (overlappingNames.length > 0) {
      const primary = overlappingNames[0];
      const extra = overlappingNames.length > 1 ? ` (+${overlappingNames.length - 1})` : '';
      return {
        isOverlapping: true,
        overlappingProjects: overlappingNames,
        badgeText: `⚠️ Advisory: Active on ${primary}${extra}`
      };
    }

    return {
      isOverlapping: false,
      overlappingProjects: [],
      badgeText: 'Available'
    };
  };

  // Explainable AI Crew Suggestion Generator for Target Project (Strictly skips isLockedByAdmin & already-assigned workers)
  const workforceAiCrewSuggestions = useMemo(() => {
    const scopeText = `${targetAllocationProject?.name || ''} ${targetAllocationProject?.description || ''}`.toLowerCase();
    const projectBudget = Number(targetAllocationProject?.budget || 0);

    const desiredTrades = [
      { keyword: 'Foreman', matchTerms: ['foreman', 'lead', 'supervisor'] },
      { keyword: 'Carpenter', matchTerms: ['carpenter', 'carpentry', 'partition', 'fit-out', 'ceiling', 'wood', 'architectural'] },
      { keyword: 'Electrician', matchTerms: ['electrician', 'electrical', 'mep', 'lighting', 'power', 'wiring'] },
      { keyword: 'Mason', matchTerms: ['mason', 'masonry', 'civil', 'concrete', 'tile', 'structural', 'wall'] },
      { keyword: 'Plumber', matchTerms: ['plumber', 'plumbing', 'sanitary', 'water', 'pipe', 'mep'] },
      { keyword: 'Painter', matchTerms: ['painter', 'painting', 'finish', 'coating', 'interior'] },
      { keyword: 'Welder', matchTerms: ['welder', 'steel', 'metal', 'structural', 'fabrication'] }
    ];

    // Compute open site trade slots dynamically from currently assigned crew & project's custom requirements
    const currentlyAssignedWorkers = localContractors.filter(c => crewSelectedWorkerIds.includes(c.id));
    const slotFillCounts = new Map<string, number>();
    activeProjectTradeReqs.forEach(req => slotFillCounts.set(req.id, 0));
    currentlyAssignedWorkers.forEach(w => {
      const slotId = matchWorkerToTradeSlot(w, activeProjectTradeReqs);
      if (slotId) {
        slotFillCounts.set(slotId, (slotFillCounts.get(slotId) || 0) + 1);
      }
    });
    const openSlotIds = new Set<string>(
      activeProjectTradeReqs.filter(req => (slotFillCounts.get(req.id) || 0) < req.required).map(req => req.id)
    );

    // Strictly skip any worker flagged as isLockedByAdmin, already assigned to selected project, or corporate/executive (CEO/COO)
    const unlockedPool = localContractors.filter(
      c => !isWorkerLockedByAdmin(c) && !crewSelectedWorkerIds.includes(c.id)
    );
    const fieldCandidates = unlockedPool.filter(c => !isExecutiveOrCorporateWorker(c));
    const pool = fieldCandidates;

    const benchmarkDailyRate = projectBudget > 0
      ? Math.max(900, Math.min(2500, (projectBudget * 0.25) / (30 * 5)))
      : 1350;

    const scored = pool.map(w => {
      const avail = getWorkerAvailabilityAdvisory(w, targetAllocationProject);
      const rate = getWorkerDailyRate(w);
      const matchedSlotId = matchWorkerToTradeSlot(w, activeProjectTradeReqs);
      const matchedSlotDef = activeProjectTradeReqs.find(s => s.id === matchedSlotId) || null;
      const fillsOpenSlot = Boolean(matchedSlotId && openSlotIds.has(matchedSlotId));

      // Check if there is also an active cross-site AI recommendation for this worker
      const matchingAiRec = recommendationQueue.find(
        r => r.workerId === w.id || r.contractorId === w.id || (r.workerName || r.contractorName || '').toLowerCase() === w.name.toLowerCase()
      );

      // Genuine 4-Factor Weighted Scoring (0–100%):
      // 1. Trade Match (40 pts): 40 if fills open required slot, 18 if reinforces filled slot, 10 general field
      const tradeScore = fillsOpenSlot ? 40 : matchedSlotDef ? 18 : 10;

      // 2. Availability / Zero-Conflict (30 pts): 30 if Unassigned/Available, 5 if active on another site
      const availabilityScore = avail.isOverlapping ? 5 : 30;

      // 3. Budget Efficiency (20 pts): scaled vs. project labor budget benchmark
      const budgetScore =
        rate <= benchmarkDailyRate * 0.75
          ? 20
          : rate <= benchmarkDailyRate
            ? 16
            : rate <= benchmarkDailyRate * 1.35
              ? 11
              : 6;

      // 4. Reliability / Rating (10 pts): scaled from worker rating (0-5)
      const numericRating = Number(w.rating || 4.3);
      const ratingScore = Math.min(10, Math.max(2, Math.round((numericRating / 5) * 10)));

      const score = tradeScore + availabilityScore + budgetScore + ratingScore;

      const rationaleParts = [
        fillsOpenSlot && matchedSlotDef
          ? `Fills open ${matchedSlotDef.label} slot`
          : matchedSlotDef
            ? `Additional ${matchedSlotDef.label} support`
            : 'General field trade',
        avail.isOverlapping
          ? `Active on ${avail.overlappingProjects[0]} (Conflict)`
          : 'Zero schedule conflict',
        `₱${rate.toLocaleString()}/day`
      ];

      return {
        worker: w,
        rate,
        avail,
        score,
        matchingAiRec,
        matchedSlotId,
        matchedSlotLabel: matchedSlotDef?.label || 'Field Crew',
        fillsOpenSlot,
        breakdown: {
          tradeScore,
          availabilityScore,
          budgetScore,
          ratingScore,
          numericRating
        },
        fourFactorBreakdown: `Trade ${tradeScore}/40 • Avail ${availabilityScore}/30 • Budget ${budgetScore}/20 • Rating ${ratingScore}/10`,
        rationale: rationaleParts.join(' • ')
      };
    });

    scored.sort((a, b) => b.score - a.score || a.rate - b.rate);
    const filtered = scored.filter(item => !dismissedWorkforceStagedIds.includes(item.worker.id));
    if (aiSortMode === 'cost') {
      return [...filtered].sort((a, b) => a.rate - b.rate || b.score - a.score).slice(0, 6);
    }
    return [...filtered].sort((a, b) => b.score - a.score || a.rate - b.rate).slice(0, 6);
  }, [localContractors, projects, targetAllocationProject, crewSelectedWorkerIds, crewOverrideNotes, crewAdminLocks, dismissedWorkforceStagedIds, recommendationQueue, localProjectAssignments, aiSortMode, activeProjectTradeReqs]);

  // Unified entry point for assigning a worker: enforces Dual-Site Conflict Override modal when overlapping
  const requestAssignWorker = (
    worker: Contractor,
    source: 'Manual' | 'AI',
    linkedRec?: AIManpowerRecommendation
  ) => {
    if (!targetAllocationProject) return;
    const avail = getWorkerAvailabilityAdvisory(worker, targetAllocationProject);
    if (avail.isOverlapping) {
      setConflictOverridePreset(OVERRIDE_REASON_PRESETS[0]);
      setConflictCustomNote('');
      setPendingConflictAssign({
        worker,
        source,
        linkedRec,
        conflictSites: avail.overlappingProjects
      });
      return;
    }
    handleAssignWorkerToProject(worker, source, linkedRec);
  };

  const handleConfirmConflictOverride = async () => {
    if (!pendingConflictAssign) return;
    const finalReason =
      conflictOverridePreset === 'Custom Note'
        ? conflictCustomNote.trim() || 'Authorized Dual-Site Override'
        : conflictCustomNote.trim()
          ? `${conflictOverridePreset} — ${conflictCustomNote.trim()}`
          : conflictOverridePreset;
    const { worker, source, linkedRec } = pendingConflictAssign;
    setPendingConflictAssign(null);
    await handleAssignWorkerToProject(worker, source, linkedRec, finalReason);
  };

  // Unified Assign Worker Handler (Cohesive for both Manual & AI Recommendation actions, with Conflict Override Persistence)
  const handleAssignWorkerToProject = async (
    worker: Contractor,
    source: 'Manual' | 'AI',
    linkedRec?: AIManpowerRecommendation,
    explicitOverrideNote?: string
  ) => {
    if (!targetAllocationProject) return;
    const avail = getWorkerAvailabilityAdvisory(worker, targetAllocationProject);
    const nextIds = crewSelectedWorkerIds.includes(worker.id)
      ? crewSelectedWorkerIds
      : [...crewSelectedWorkerIds, worker.id];

    // If worker has an active conflict and is assigned manually, persist the selected override note and isLockedByAdmin = true
    const resolvedOverrideNote =
      explicitOverrideNote !== undefined
        ? explicitOverrideNote
        : avail.isOverlapping && source === 'Manual'
          ? poolPendingOverrideReasons[worker.id] || OVERRIDE_REASON_PRESETS[0]
          : crewOverrideNotes[worker.id] ?? worker.manualOverrideNote ?? '';

    const shouldLock =
      source === 'Manual' && (avail.isOverlapping || resolvedOverrideNote.trim().length > 0)
        ? true
        : Boolean(crewAdminLocks[worker.id] || worker.isLockedByAdmin);

    if (resolvedOverrideNote.trim().length > 0) {
      setCrewOverrideNotes(prev => ({ ...prev, [worker.id]: resolvedOverrideNote }));
    }
    if (shouldLock) {
      setCrewAdminLocks(prev => ({ ...prev, [worker.id]: true }));
    }

    // Immutably update local project assignments & crew selection
    setCrewSelectedWorkerIds(nextIds);
    setLocalProjectAssignments(prev => ({
      ...prev,
      [targetAllocationProject.id]: nextIds
    }));
    setCrewAllocationSourceMap(prev => ({ ...prev, [worker.id]: source }));

    const updatedWorker: Contractor = {
      ...worker,
      activeProjectSite: targetAllocationProject.name,
      assignedProjectId: targetAllocationProject.id,
      allocationSource: source,
      manualOverrideNote: resolvedOverrideNote || worker.manualOverrideNote,
      isLockedByAdmin: shouldLock
    };

    const nextContractorsList = localContractors.map(c => (c.id === worker.id ? updatedWorker : c));
    setLocalContractors(nextContractorsList);

    if (onUpdateContractor) {
      onUpdateContractor(updatedWorker);
    }
    if (onUpdateContractors) {
      onUpdateContractors(nextContractorsList);
    }
    if (onUpdateProject) {
      onUpdateProject(targetAllocationProject.id, {
        assignedContractorIds: nextIds,
        assignedWorkersCount: nextIds.length
      });
    }

    // Record in live Audit Trail
    appendAuditEntry({
      workerId: worker.id,
      workerName: worker.name,
      trade: worker.tradeType || worker.specialty || 'General Trade',
      projectId: targetAllocationProject.id,
      projectName: targetAllocationProject.name,
      action:
        source === 'AI'
          ? 'AI Recommendation Applied'
          : avail.isOverlapping
            ? 'Conflict Override'
            : 'Assigned',
      source,
      hadScheduleConflict: avail.isOverlapping,
      conflictDetails: avail.isOverlapping ? avail.badgeText : undefined,
      overrideNote: resolvedOverrideNote || undefined,
      isLockedByAdmin: shouldLock,
      dailyRate: getWorkerDailyRate(worker)
    });

    const buildWorkforceAuthHeaders = (): Record<string, string> => {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      const csrf = getCsrfToken();
      if (csrf) headers['x-csrf-token'] = csrf;
      const bearer = (storedSession as any)?.sessionToken || (storedSession as any)?.token;
      if (typeof bearer === 'string' && bearer.trim().length >= 16) {
        headers['Authorization'] = `Bearer ${bearer.trim()}`;
      }
      return headers;
    };

    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(targetAllocationProject.id)}/workers`, {
        method: 'PUT',
        credentials: 'include',
        headers: buildWorkforceAuthHeaders(),
        body: JSON.stringify({
          workerId: worker.id,
          action: 'add',
          allocationSource: source,
          manualOverrideNote: resolvedOverrideNote || undefined,
          isLockedByAdmin: shouldLock
        })
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        console.error('[Workforce Assign] DB sync failed:', res.status, errBody);
        notify(`Warning: ${worker.name} assigned locally, but DB sync failed (${errBody.error || `HTTP ${res.status}`}).`);
      }
    } catch (err) {
      console.error('[Workforce Assign] Network error:', err);
      notify(`Warning: ${worker.name} assigned locally, but server sync failed.`);
    }

    if (linkedRec && onApplyAIRecommendation) {
      try {
        await onApplyAIRecommendation(linkedRec.id);
      } catch {
        // non-blocking
      }
    }

    setLastAllocationFeedback({
      workerId: worker.id,
      workerName: worker.name,
      source,
      action: 'assigned'
    });
    setTimeout(() => {
      setLastAllocationFeedback(prev => (prev?.workerId === worker.id ? null : prev));
    }, 3500);

    notify(
      source === 'AI'
        ? `✓ Applied AI recommendation: ${worker.name} assigned to "${targetAllocationProject.name}".`
        : avail.isOverlapping
          ? `✓ Assigned ${worker.name} to "${targetAllocationProject.name}" with Override (${resolvedOverrideNote}).`
          : `✓ Assigned ${worker.name} to "${targetAllocationProject.name}".`
    );
  };

  // Unified Unassign Worker Handler
  const handleUnassignWorkerFromProject = async (worker: Contractor) => {
    if (!targetAllocationProject) return;
    const nextIds = crewSelectedWorkerIds.filter(id => id !== worker.id);
    setCrewSelectedWorkerIds(nextIds);
    setLocalProjectAssignments(prev => ({
      ...prev,
      [targetAllocationProject.id]: nextIds
    }));

    const isCurrentSiteMatch =
      (worker.activeProjectSite || '').trim().toLowerCase() ===
      targetAllocationProject.name.trim().toLowerCase();

    const updatedWorker: Contractor = {
      ...worker,
      activeProjectSite: isCurrentSiteMatch ? 'General Standby Pool' : worker.activeProjectSite,
      assignedProjectId: worker.assignedProjectId === targetAllocationProject.id ? undefined : worker.assignedProjectId,
      allocationSource: 'Manual'
    };

    const nextContractorsList = localContractors.map(c => (c.id === worker.id ? updatedWorker : c));
    setLocalContractors(nextContractorsList);

    if (onUpdateContractor) {
      onUpdateContractor(updatedWorker);
    }
    if (onUpdateContractors) {
      onUpdateContractors(nextContractorsList);
    }
    if (onUpdateProject) {
      onUpdateProject(targetAllocationProject.id, {
        assignedContractorIds: nextIds,
        assignedWorkersCount: nextIds.length
      });
    }

    appendAuditEntry({
      workerId: worker.id,
      workerName: worker.name,
      trade: worker.tradeType || worker.specialty || 'General Trade',
      projectId: targetAllocationProject.id,
      projectName: targetAllocationProject.name,
      action: 'Unassigned',
      source: 'Manual',
      hadScheduleConflict: false,
      overrideNote: crewOverrideNotes[worker.id] || worker.manualOverrideNote,
      isLockedByAdmin: isWorkerLockedByAdmin(worker),
      dailyRate: getWorkerDailyRate(worker)
    });

    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      const csrf = getCsrfToken();
      if (csrf) headers['x-csrf-token'] = csrf;
      const bearer = (storedSession as any)?.sessionToken || (storedSession as any)?.token;
      if (typeof bearer === 'string' && bearer.trim().length >= 16) {
        headers['Authorization'] = `Bearer ${bearer.trim()}`;
      }
      const res = await fetch(`/api/projects/${encodeURIComponent(targetAllocationProject.id)}/workers`, {
        method: 'PUT',
        credentials: 'include',
        headers,
        body: JSON.stringify({ workerId: worker.id, action: 'remove' })
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        console.error('[Workforce Unassign] DB sync failed:', res.status, errBody);
        notify(`Warning: ${worker.name} unassigned locally, but DB sync failed (${errBody.error || `HTTP ${res.status}`}).`);
      }
    } catch (err) {
      console.error('[Workforce Unassign] Network error:', err);
      notify(`Warning: ${worker.name} unassigned locally, but server sync failed.`);
    }

    setLastAllocationFeedback({
      workerId: worker.id,
      workerName: worker.name,
      source: 'Manual',
      action: 'unassigned'
    });
    setTimeout(() => {
      setLastAllocationFeedback(prev => (prev?.workerId === worker.id ? null : prev));
    }, 3500);

    notify(`Unassigned ${worker.name} from "${targetAllocationProject.name}".`);
  };

  // Dismiss a single AI suggestion from the assistant card
  const handleDismissWorkforceStagedSuggestion = (workerId: string) => {
    setDismissedWorkforceStagedIds(prev => (prev.includes(workerId) ? prev : [...prev, workerId]));
  };

  // Derived Live Workbench Metrics (Assigned Crew, Active Sites, Site Utilization, Live Labor Budget Burn)
  const assignedCrewWorkers = useMemo(
    () => localContractors.filter(c => crewSelectedWorkerIds.includes(c.id)),
    [localContractors, crewSelectedWorkerIds]
  );

  // Dynamic Project Trade Requirements & Coverage Strip (driven by per-project configurable requirements)
  const siteTradeCoverage = useMemo(() => {
    const counts = new Map<string, number>();
    activeProjectTradeReqs.forEach(r => counts.set(r.id, 0));
    assignedCrewWorkers.forEach(w => {
      const slot = matchWorkerToTradeSlot(w, activeProjectTradeReqs);
      if (slot) counts.set(slot, (counts.get(slot) || 0) + 1);
    });
    const slots = activeProjectTradeReqs.map(req => {
      const assigned = counts.get(req.id) || 0;
      return {
        ...req,
        assigned,
        isFilled: assigned >= req.required,
        missing: Math.max(0, req.required - assigned)
      };
    });
    const filledCount = slots.filter(s => s.isFilled).length;
    const totalHeadcountRequired = slots.reduce((sum, s) => sum + s.required, 0);
    const totalHeadcountFilled = slots.reduce((sum, s) => sum + Math.min(s.assigned, s.required), 0);
    return { slots, filledCount, totalCount: slots.length, totalHeadcountRequired, totalHeadcountFilled };
  }, [assignedCrewWorkers, activeProjectTradeReqs]);

  // 1-Click Auto-Optimize Crew Plan (highest-scoring non-conflicting candidates for all open headcount slots)
  const autoOptimizePlan = useMemo(() => {
    const openSlots = siteTradeCoverage.slots.filter(s => !s.isFilled);
    const chosenIds = new Set<string>();
    const proposed: Array<{
      slotId: string;
      slotLabel: string;
      worker: Contractor;
      rate: number;
      score: number;
      matchingAiRec?: AIManpowerRecommendation;
    }> = [];
    const unfilledSlots: string[] = [];

    const nonConflictingCandidates = workforceAiCrewSuggestions.filter(item => !item.avail.isOverlapping);

    for (const slot of openSlots) {
      let filledThisSlot = 0;
      for (let need = 0; need < slot.missing; need++) {
        const bestMatch = nonConflictingCandidates.find(
          c => c.matchedSlotId === slot.id && !chosenIds.has(c.worker.id)
        );
        if (bestMatch) {
          chosenIds.add(bestMatch.worker.id);
          proposed.push({
            slotId: slot.id,
            slotLabel: slot.label,
            worker: bestMatch.worker,
            rate: bestMatch.rate,
            score: bestMatch.score,
            matchingAiRec: bestMatch.matchingAiRec
          });
          filledThisSlot++;
        }
      }
      if (filledThisSlot < slot.missing) {
        unfilledSlots.push(`${slot.label} (${slot.missing - filledThisSlot} open)`);
      }
    }

    const additionalDailyBurn = proposed.reduce((sum, p) => sum + p.rate, 0);
    const currentDailyBurn = assignedCrewWorkers.reduce((sum, w) => sum + getWorkerDailyRate(w), 0);
    const projectedDailyBurn = currentDailyBurn + additionalDailyBurn;

    return {
      proposed,
      unfilledSlots,
      additionalDailyBurn,
      currentDailyBurn,
      projectedDailyBurn,
      coverageBefore: `${siteTradeCoverage.totalHeadcountFilled}/${siteTradeCoverage.totalHeadcountRequired}`,
      coverageAfter: `${siteTradeCoverage.totalHeadcountFilled + proposed.length}/${siteTradeCoverage.totalHeadcountRequired}`
    };
  }, [siteTradeCoverage, workforceAiCrewSuggestions, assignedCrewWorkers]);

  const handleConfirmAutoOptimizeDeploy = async () => {
    if (!targetAllocationProject || autoOptimizePlan.proposed.length === 0) return;
    setIsDeployingOptimizedCrew(true);
    try {
      for (const item of autoOptimizePlan.proposed) {
        await handleAssignWorkerToProject(item.worker, 'AI', item.matchingAiRec);
      }
      setIsOptimizeModalOpen(false);
      notify(
        `✓ Auto-Optimized Crew deployed: ${autoOptimizePlan.proposed.length} worker(s) assigned to "${targetAllocationProject.name}" (${autoOptimizePlan.coverageAfter} trade coverage).`
      );
    } finally {
      setIsDeployingOptimizedCrew(false);
    }
  };

  const unassignedRosterWorkers = useMemo(
    () =>
      localContractors.filter(c => {
        if (crewSelectedWorkerIds.includes(c.id)) return false;
        if (!rosterSearchQuery.trim()) return true;
        const q = rosterSearchQuery.toLowerCase();
        return (
          c.name.toLowerCase().includes(q) ||
          (c.tradeType || '').toLowerCase().includes(q) ||
          (c.specialty || '').toLowerCase().includes(q) ||
          (c.roleTitle || '').toLowerCase().includes(q)
        );
      }),
    [localContractors, crewSelectedWorkerIds, rosterSearchQuery]
  );

  const activeSitesCount = useMemo(
    () => projects.filter(p => p.status !== 'COMPLETED' && p.status !== 'HANDED_OVER').length,
    [projects]
  );

  // Live deployed field workers across all active projects
  const liveDeployedWorkerIds = useMemo(() => {
    const deployedSet = new Set<string>();
    projects.forEach(p => {
      if (p.status === 'COMPLETED' || p.status === 'HANDED_OVER') return;
      const ids = getProjectAssignedIds(p);
      ids.forEach(id => deployedSet.add(id));
    });
    localContractors.forEach(c => {
      const site = (c.activeProjectSite || '').trim().toLowerCase();
      if (site && !site.includes('standby') && !site.includes('unassigned')) {
        deployedSet.add(c.id);
      }
    });
    return deployedSet;
  }, [projects, localProjectAssignments, localContractors]);

  const liveTotalManpower = useMemo(() => {
    return Math.max(localContractors.length, totalManpower || 0);
  }, [localContractors, totalManpower]);

  const liveSiteUtilizationPct = useMemo(() => {
    if (liveTotalManpower <= 0) return 0;
    return Math.min(100, Math.round((liveDeployedWorkerIds.size / liveTotalManpower) * 100));
  }, [liveDeployedWorkerIds, liveTotalManpower]);

  const workbenchLaborBurn = useMemo(() => {
    const dailyCombinedRate = assignedCrewWorkers.reduce((sum, w) => sum + getWorkerDailyRate(w), 0);
    const startMs = targetAllocationProject?.startDate ? new Date(targetAllocationProject.startDate).getTime() : NaN;
    const endMs = targetAllocationProject?.targetHandoverDate ? new Date(targetAllocationProject.targetHandoverDate).getTime() : NaN;
    const rawDays = !isNaN(startMs) && !isNaN(endMs) && endMs > startMs
      ? Math.max(1, Math.round((endMs - startMs) / (1000 * 60 * 60 * 24)))
      : 30;
    const workingDays = Math.max(1, Math.round(rawDays * (26 / 30)));
    const projectedCost = dailyCombinedRate * workingDays;
    const contractBudget = Number(targetAllocationProject?.budget || 0);
    const burnPct = contractBudget > 0 ? Math.round((projectedCost / contractBudget) * 100) : 0;
    const isHighBurn = contractBudget > 0 && burnPct > 40;
    return {
      dailyCombinedRate,
      workingDays,
      projectedCost,
      contractBudget,
      burnPct,
      isHighBurn
    };
  }, [assignedCrewWorkers, targetAllocationProject]);

  // Live Reactive Analytics Data for Tab 2 (Connected directly to live project & contractor state)
  const liveProjectLaborChartData = useMemo(() => {
    if (projects.length === 0) return projectLaborChartData;
    return projects.map(p => {
      const assignedIds = getProjectAssignedIds(p);
      const dailyBurn = assignedIds.reduce((sum, id) => {
        const w = localContractors.find(c => c.id === id);
        return sum + (w ? getWorkerDailyRate(w) : 0);
      }, 0);
      const shortName = p.name.length > 18 ? `${p.name.slice(0, 16)}…` : p.name;
      return {
        name: shortName,
        fullName: p.name,
        workers: assignedIds.length,
        dailyBurn,
        progress: p.progress ?? 0,
        status: (p.status || 'IN_PROGRESS').replace('_', ' ')
      };
    });
  }, [projects, localProjectAssignments, localContractors, projectLaborChartData]);

  const liveTradeManpowerChartData = useMemo(() => {
    if (localContractors.length === 0) return tradeManpowerChartData;
    const tradePalette = ['#14b8a6', '#38bdf8', '#f59e0b', '#818cf8', '#ec4899', '#10b981', '#f97316', '#a855f7'];
    const stats: Record<string, { count: number; dailyBurn: number }> = {};
    localContractors.forEach(c => {
      const rawTrade = (c.tradeType || c.specialty || c.roleTitle || 'General Artisan').trim();
      if (!stats[rawTrade]) {
        stats[rawTrade] = { count: 0, dailyBurn: 0 };
      }
      stats[rawTrade].count += 1;
      stats[rawTrade].dailyBurn += getWorkerDailyRate(c);
    });
    return Object.entries(stats)
      .sort((a, b) => b[1].count - a[1].count)
      .map(([name, data], idx) => ({
        name,
        value: data.count,
        dailyBurn: data.dailyBurn,
        color: tradePalette[idx % tradePalette.length]
      }));
  }, [localContractors, tradeManpowerChartData]);

  const liveInHouseAndOutsourced = useMemo(() => {
    if (localContractors.length === 0) {
      return {
        inHouse: inHouseCount,
        outsourced: outsourcedCount,
        inHouseDailyBurn: 0,
        outsourcedDailyBurn: 0,
        ratio: Math.round((inHouseCount / Math.max(1, inHouseCount + outsourcedCount)) * 100),
        chartData: employmentMixChartData
      };
    }
    let inHouse = 0;
    let outsourced = 0;
    let inHouseDailyBurn = 0;
    let outsourcedDailyBurn = 0;
    localContractors.forEach(c => {
      const empType = (c.employmentType || '').toLowerCase();
      const companyStr = (c.company || '').toLowerCase();
      const rate = getWorkerDailyRate(c);
      if (
        empType.includes('in-house') ||
        empType.includes('in_house') ||
        empType.includes('regular') ||
        companyStr.includes('ctvill') ||
        isIndividualStaffOrEngineer(c)
      ) {
        inHouse += 1;
        inHouseDailyBurn += rate;
      } else {
        outsourced += 1;
        outsourcedDailyBurn += rate;
      }
    });
    const total = Math.max(1, inHouse + outsourced);
    return {
      inHouse,
      outsourced,
      inHouseDailyBurn,
      outsourcedDailyBurn,
      ratio: Math.round((inHouse / total) * 100),
      chartData: [
        { name: 'LDM In-House Core', value: inHouse, dailyBurn: inHouseDailyBurn, color: '#10b981' },
        { name: 'Outsourced Trade Partners', value: outsourced, dailyBurn: outsourcedDailyBurn, color: '#f59e0b' }
      ]
    };
  }, [localContractors, inHouseCount, outsourcedCount, employmentMixChartData]);

  // Filter out non-artisan personnel (office staff, executives, architects, PMs, engineers, permanent safety inspectors)
  const isNonArtisanStaff = (rec: AIManpowerRecommendation) => {
    const role = (rec.tradeType || '').toLowerCase();
    const name = (rec.workerName || rec.contractorName || '').toLowerCase();
    return (
      name.includes('builders') ||
      name.includes('corporation') ||
      name.includes('inc.') ||
      role.includes('safety') ||
      role.includes('ehso') ||
      role.includes('inspector') ||
      role.includes('architect') ||
      role.includes('designer') ||
      role.includes('project manager') ||
      role.includes('pm') ||
      role.includes('construction manager') ||
      role.includes('site manager') ||
      role.includes('site engineer') ||
      role.includes('project engineer') ||
      role.includes('engineer') ||
      role.includes('coordinator') ||
      role.includes('consultant') ||
      (role.includes('officer') && !role.includes('artisan')) ||
      name.includes('coo') ||
      name.includes('president') ||
      name.includes('hr') ||
      name.includes('finance')
    );
  };

  // Sync recommendationQueue and appliedTransfersHistory whenever aiRecommendations or admin locks change
  useEffect(() => {
    if (aiRecommendations && aiRecommendations.length > 0) {
      const isRecWorkerLocked = (r: AIManpowerRecommendation) => {
        const wId = r.workerId || r.contractorId;
        const wName = (r.workerName || r.contractorName || '').trim().toLowerCase();
        const matched = localContractors.find(
          c => c.id === wId || c.name.trim().toLowerCase() === wName
        );
        return matched ? isWorkerLockedByAdmin(matched) : false;
      };
      const pending = aiRecommendations.filter(
        r => !r.applied && !r.dismissed && !isNonArtisanStaff(r) && !isRecWorkerLocked(r)
      );
      setRecommendationQueue(pending);
      const applied = aiRecommendations.filter(r => r.applied && !r.dismissed && !isNonArtisanStaff(r));
      setAppliedTransfersHistory(applied);
    }
  }, [aiRecommendations, localContractors, crewOverrideNotes, crewAdminLocks]);

  const inHouseRatio = liveInHouseAndOutsourced.ratio;

  // Project-Scoped Site Analytics Data (strictly scoped to targetAllocationProject & its assignedCrewWorkers)
  const pmSiteAnalytics = useMemo(() => {
    // 1. Trade Coverage (Assigned vs. Required)
    const coverageChartData = siteTradeCoverage.slots.map(slot => ({
      trade: slot.label,
      required: slot.required,
      assigned: slot.assigned,
      isFilled: slot.isFilled
    }));

    // 2. Daily Labor Burn Breakdown by Trade
    const burnByTradeMap = new Map<string, { trade: string; dailyBurn: number; workers: number }>();
    assignedCrewWorkers.forEach(w => {
      const slotId = matchWorkerToTradeSlot(w, activeProjectTradeReqs);
      const slotLabel = activeProjectTradeReqs.find(r => r.id === slotId)?.label || w.tradeType || w.specialty || 'General Crew';
      const rate = getWorkerDailyRate(w);
      const existing = burnByTradeMap.get(slotLabel) || { trade: slotLabel, dailyBurn: 0, workers: 0 };
      existing.dailyBurn += rate;
      existing.workers += 1;
      burnByTradeMap.set(slotLabel, existing);
    });
    const burnByTradeData = Array.from(burnByTradeMap.values()).sort((a, b) => b.dailyBurn - a.dailyBurn);
    const totalDailyBurn = burnByTradeData.reduce((s, r) => s + r.dailyBurn, 0);
    const projectedWeeklyBurn = totalDailyBurn * 6; // 6-day Philippine construction workweek

    // 3. Crew Deployment Health (Dedicated On-Site vs. Dual-Site Shared/Conflict)
    let dedicatedCount = 0;
    let conflictCount = 0;
    assignedCrewWorkers.forEach(w => {
      const avail = getWorkerAvailabilityAdvisory(w, targetAllocationProject);
      if (avail.isOverlapping) conflictCount += 1;
      else dedicatedCount += 1;
    });
    const deploymentHealthData = [
      { name: 'Dedicated On-Site', value: dedicatedCount, color: '#10b981' },
      { name: 'Dual-Site Conflict', value: conflictCount, color: '#f59e0b' }
    ].filter(d => d.value > 0);

    return {
      coverageChartData,
      burnByTradeData,
      totalDailyBurn,
      projectedWeeklyBurn,
      dedicatedCount,
      conflictCount,
      deploymentHealthData
    };
  }, [siteTradeCoverage, assignedCrewWorkers, activeProjectTradeReqs, targetAllocationProject]);

  const siteChartCursor = { fill: isDark ? 'rgba(255, 255, 255, 0.06)' : 'rgba(15, 23, 42, 0.06)' };
  const siteChartGridStroke = isDark ? 'rgba(148, 163, 184, 0.14)' : 'rgba(15, 23, 42, 0.08)';
  const siteChartAxisTick = isDark ? '#94a3b8' : '#475569';

  // High-contrast custom tooltip renderer for all 3 PM Site Analytics charts across Light, Dark & Night modes
  const renderSiteChartTooltip = (mode: 'coverage' | 'health' | 'burn') => ({ active, payload, label }: any) => {
    if (!active || !Array.isArray(payload) || payload.length === 0) return null;
    const containerStyle: React.CSSProperties = isDark
      ? {
        backgroundColor: '#111827',
        border: '1px solid #334155',
        borderRadius: '10px',
        padding: '10px 12px',
        boxShadow: '0 10px 25px rgba(0, 0, 0, 0.45)',
        color: '#F8FAFC',
        fontSize: '12px',
        minWidth: '175px'
      }
      : {
        backgroundColor: '#FFFFFF',
        border: '1px solid #CBD5E1',
        borderRadius: '10px',
        padding: '10px 12px',
        boxShadow: '0 8px 20px rgba(15, 23, 42, 0.1)',
        color: '#0F172A',
        fontSize: '12px',
        minWidth: '175px'
      };
    const titleColor = isDark ? '#F8FAFC' : '#0F172A';
    const labelColor = isDark ? '#CBD5E1' : '#475569';
    const valueColor = isDark ? '#F8FAFC' : '#0F172A';
    const emeraldColor = isDark ? '#34D399' : '#059669';
    const amberColor = isDark ? '#FBBF24' : '#D97706';
    const tealColor = isDark ? '#2DD4BF' : '#0D9488';

    if (mode === 'coverage') {
      const row = payload[0]?.payload;
      const isFilled = Boolean(row?.isFilled);
      return (
        <div style={containerStyle}>
          <div style={{ color: titleColor, fontWeight: 700, marginBottom: '6px' }}>{label || row?.trade}</div>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '14px', marginBottom: '3px' }}>
            <span style={{ color: labelColor }}>Required Target</span>
            <span style={{ color: valueColor, fontWeight: 700, fontFamily: 'monospace' }}>{row?.required ?? 0}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '14px' }}>
            <span style={{ color: labelColor }}>Assigned On-Site</span>
            <span style={{ color: isFilled ? emeraldColor : amberColor, fontWeight: 700, fontFamily: 'monospace' }}>
              {row?.assigned ?? 0} {isFilled ? '(Filled)' : '(Shortfall)'}
            </span>
          </div>
        </div>
      );
    }

    if (mode === 'health') {
      const item = payload[0];
      const name = String(item?.name || '');
      const isConflict = name.toLowerCase().includes('conflict');
      return (
        <div style={containerStyle}>
          <div style={{ color: isConflict ? amberColor : emeraldColor, fontWeight: 700, marginBottom: '4px' }}>
            {name}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '14px' }}>
            <span style={{ color: labelColor }}>Assigned Crew</span>
            <span style={{ color: valueColor, fontWeight: 700, fontFamily: 'monospace' }}>
              {item?.value ?? 0} worker{Number(item?.value) === 1 ? '' : 's'}
            </span>
          </div>
        </div>
      );
    }

    // mode === 'burn'
    const row = payload[0]?.payload;
    const workersCount = Number(row?.workers || 0);
    const dailyVal = Number(row?.dailyBurn || 0);
    return (
      <div style={containerStyle}>
        <div style={{ color: titleColor, fontWeight: 700, marginBottom: '6px' }}>{label || row?.trade}</div>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '14px', marginBottom: '3px' }}>
          <span style={{ color: labelColor }}>Daily Burn</span>
          <span style={{ color: tealColor, fontWeight: 700, fontFamily: 'monospace' }}>
            ₱{dailyVal.toLocaleString()}/day
          </span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '14px' }}>
          <span style={{ color: labelColor }}>Headcount</span>
          <span style={{ color: valueColor, fontWeight: 700, fontFamily: 'monospace' }}>
            {workersCount} worker{workersCount === 1 ? '' : 's'}
          </span>
        </div>
      </div>
    );
  };

  const isDedicatedAuditView = hideTabs;

  return (
    <div className="space-y-6">

      {/* Top Header & Tab Switcher - Hidden in dedicated audit view */}
      {!isDedicatedAuditView && (
        <>
          {/* Top Header */}
          <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Users className="w-5 h-5 text-amber-400" />
                Labor Workforce &amp; Artisan Trades
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Operational Dispatch Workbench, non-blocking AI decision support, conflict override auditing, and live workforce analytics.
              </p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="bg-slate-900 border border-slate-800 text-teal-300 text-xs font-mono px-3 py-1.5 rounded-lg font-medium whitespace-nowrap">
                {liveDeployedWorkerIds.size} / {liveTotalManpower} Deployed ({liveSiteUtilizationPct}% Util.)
              </span>
            </div>
          </div>

          {/* Top-Level Tab Switcher (Tab 1: Dispatch Workbench | Tab 2: Workforce Analytics & Reports | Personnel Directory) */}
          <div className={`flex items-center gap-2 border-b ${isDark ? 'border-slate-800' : 'border-slate-200'} pb-2 overflow-x-auto`}>
            {availableTabs.map(tab => {
              const isActive = activeSubTab === tab.id;
              const IconComponent = tab.icon;
              const count =
                tab.id === 'workbench'
                  ? assignedCrewWorkers.length
                  : tab.id === 'directory'
                    ? liveTotalManpower
                    : undefined;

              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveSubTab(tab.id)}
                  className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-semibold font-mono transition-all cursor-pointer whitespace-nowrap ${isActive
                    ? isDark
                      ? 'bg-teal-500/15 text-teal-300 border border-teal-500/30 shadow-xs'
                      : 'bg-slate-900 text-white shadow-xs border border-slate-900'
                    : isDark
                      ? 'text-slate-400 hover:text-white hover:bg-slate-900 border border-transparent'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100 border border-transparent'
                    }`}
                >
                  <IconComponent className={`w-4 h-4 ${isActive ? (isDark ? 'text-teal-400' : 'text-amber-400') : (isDark ? 'text-slate-400' : 'text-slate-500')}`} />
                  <span>{tab.label}</span>
                  {count !== undefined && (
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${isActive
                      ? isDark
                        ? 'bg-teal-500/25 text-teal-200'
                        : 'bg-slate-800 text-slate-200'
                      : isDark
                        ? 'bg-slate-800 text-slate-400'
                        : 'bg-slate-200 text-slate-700'
                      }`}>
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </>
      )}

      {/* ------------------------------------------------------------- */}
      {/* PERSONNEL DIRECTORY & ROSTER                                   */}
      {/* ------------------------------------------------------------- */}
      {activeSubTab === 'directory' && (
        <div className="animate-fadeIn">
          <WorkforceMessengerRoster
            contractors={localContractors}
            manpowerAudits={manpowerAudits}
            projects={projects}
            userRole={userRole}
            isAdmin={isAdmin}
            onRegisterClick={onRegisterWorkerClick}
            onVerifyRollCall={onVerifyRollCall}
            onDeleteContractor={onDeleteContractor}
            onUpdateContractor={onUpdateContractor}
            onUpdateContractors={onUpdateContractors}
            onUpdateProject={onUpdateProject}
            onSwitchToAllocationTab={(workerId?: string) => {
              setActiveSubTab('workbench');
              if (workerId) setQuickAddWorkerId(workerId);
            }}
            notify={notify}
          />
        </div>
      )}

      {/* ------------------------------------------------------------- */}
      {/* TAB 1: DISPATCH WORKBENCH (OPERATIONAL EXECUTION ONLY)        */}
      {/* ------------------------------------------------------------- */}
      {activeSubTab === 'workbench' && (
        <div className="space-y-6 animate-fadeIn">
          {/* ============================================================= */}
          {/* UNIFIED TWO-PANEL RESOURCE ALLOCATION WORKBENCH               */}
          {/* ============================================================= */}
          <div className="bg-slate-950/90 border border-slate-800/90 rounded-2xl p-5 shadow-xl space-y-5">
            {/* Top Bar: Clean Project Selector Dropdown + Quick Status Metrics */}
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-slate-800/80 pb-4">
              {/* Project Selector */}
              <div className="flex flex-col sm:flex-row sm:items-center gap-3.5 flex-1 min-w-0">
                <div className="flex items-center gap-2.5 shrink-0">
                  <div className="p-2 bg-teal-500/10 border border-teal-500/25 rounded-xl text-teal-400">
                    <Building2 className="w-4 h-4" />
                  </div>
                  <div>
                    <span className="text-[10px] font-mono uppercase tracking-wider text-slate-400 block">
                      Dispatch Workbench
                    </span>
                    <h4 className="text-sm font-semibold text-white">
                      {targetAllocationProject?.name || 'Active Project Roster'}
                    </h4>
                  </div>
                </div>

                <div className="sm:max-w-xs w-full">
                  <select
                    value={targetAllocationProject?.id || ''}
                    onChange={(e) => {
                      setSelectedWorkbenchProjectId(e.target.value);
                      setDismissedWorkforceStagedIds([]);
                      setLastAllocationFeedback(null);
                    }}
                    className="w-full bg-slate-900/80 border border-slate-800 focus:border-teal-500 rounded-xl px-3.5 py-2 text-xs font-medium text-white focus:outline-none cursor-pointer transition"
                  >
                    {projects.map(p => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({p.status.replace('_', ' ')})
                      </option>
                    ))}
                  </select>
                </div>

                {/* Subtle Inline Micro-Feedback Confirmation Pill */}
                {lastAllocationFeedback && (
                  <div
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-[11px] font-medium animate-fadeIn shrink-0 whitespace-nowrap ${lastAllocationFeedback.action === 'assigned'
                      ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                      : 'bg-slate-800/80 border-slate-700 text-slate-300'
                      }`}
                  >
                    <CheckCircle className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                    <span>
                      {lastAllocationFeedback.action === 'assigned'
                        ? `${lastAllocationFeedback.workerName} assigned (${lastAllocationFeedback.source === 'AI' ? 'Source: AI' : 'Source: Manual'})`
                        : `${lastAllocationFeedback.workerName} unassigned`}
                    </span>
                  </div>
                )}
              </div>

              {/* Quick Status Metrics: Total Headcount & Site Utilization, Active Sites, Labor Budget Burn */}
              <div className="grid grid-cols-3 gap-3 shrink-0">
                <div className="bg-slate-900/60 border border-slate-800/80 rounded-xl px-3.5 py-2">
                  <span className="text-[10px] font-mono uppercase text-slate-400 block whitespace-nowrap">
                    Headcount &amp; Util.
                  </span>
                  <div className="text-sm font-semibold text-white flex items-baseline gap-1.5 mt-0.5 whitespace-nowrap">
                    <span className="text-teal-400">{assignedCrewWorkers.length}</span>
                    <span className="text-xs text-slate-400 font-normal">
                      / {liveTotalManpower} ({liveSiteUtilizationPct}%)
                    </span>
                  </div>
                </div>

                <div className="bg-slate-900/60 border border-slate-800/80 rounded-xl px-3.5 py-2">
                  <span className="text-[10px] font-mono uppercase text-slate-400 block whitespace-nowrap">
                    Active Sites
                  </span>
                  <div className="text-sm font-semibold text-white flex items-baseline gap-1.5 mt-0.5 whitespace-nowrap">
                    <span className="text-amber-400">{activeSitesCount}</span>
                    <span className="text-xs text-slate-400 font-normal">Commercial</span>
                  </div>
                </div>

                <div
                  className={`rounded-xl px-3.5 py-2 border ${workbenchLaborBurn.isHighBurn
                    ? 'bg-amber-950/25 border-amber-500/30'
                    : 'bg-slate-900/60 border-slate-800/80'
                    }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[10px] font-mono uppercase text-slate-400 whitespace-nowrap">
                      Labor Budget Burn
                    </span>
                    {workbenchLaborBurn.contractBudget > 0 && (
                      <span
                        className={`px-2 py-0.5 rounded-md text-[11px] font-medium whitespace-nowrap ${workbenchLaborBurn.isHighBurn
                          ? 'bg-amber-500/15 text-amber-300'
                          : 'bg-emerald-500/15 text-emerald-300'
                          }`}
                      >
                        {workbenchLaborBurn.burnPct}%
                      </span>
                    )}
                  </div>
                  <div className="text-sm font-semibold text-white flex items-baseline gap-1 mt-0.5 whitespace-nowrap">
                    <span>₱{workbenchLaborBurn.dailyCombinedRate.toLocaleString()}</span>
                    <span className="text-xs text-slate-400 font-normal">/day</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Project Trade Requirements & Coverage Strip */}
            <div className="bg-slate-900/70 border border-slate-800/90 rounded-xl px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2.5">
              <div className="flex items-center gap-2 shrink-0 flex-wrap">
                <HardHat className="w-4 h-4 text-amber-400" />
                <span className="text-xs font-bold text-white">Site Trade Coverage</span>
                <span className={`px-2 py-0.5 rounded-md text-[11px] font-mono font-semibold border ${siteTradeCoverage.filledCount === siteTradeCoverage.totalCount
                  ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                  : 'bg-amber-500/15 text-amber-300 border-amber-500/30'
                  }`}>
                  {siteTradeCoverage.totalHeadcountFilled}/{siteTradeCoverage.totalHeadcountRequired} Filled
                </span>
                <button
                  type="button"
                  onClick={handleOpenEditReqsModal}
                  disabled={!targetAllocationProject}
                  className="px-2.5 py-1 rounded-lg bg-slate-800/90 hover:bg-slate-700 text-slate-200 border border-slate-700 text-[11px] font-medium transition cursor-pointer flex items-center gap-1"
                  title="Customize required trades and headcount for this project"
                >
                  <Sliders className="w-3 h-3 text-amber-400" />
                  <span>Edit Requirements</span>
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {siteTradeCoverage.slots.map(slot => (
                  <div
                    key={slot.id}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-mono font-medium border flex items-center gap-1.5 transition-colors ${slot.isFilled
                      ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                      : 'bg-amber-500/10 border-amber-500/30 text-amber-300'
                      }`}
                  >
                    {slot.isFilled ? (
                      <CheckCircle className="w-3 h-3 text-emerald-400 shrink-0" />
                    ) : (
                      <AlertTriangle className="w-3 h-3 text-amber-400 shrink-0" />
                    )}
                    <span>{slot.label} ({slot.assigned}/{slot.required})</span>
                    <span className={`text-[10px] uppercase font-bold ${slot.isFilled ? 'text-emerald-400' : 'text-amber-400'}`}>
                      • {slot.isFilled ? 'Filled' : 'Missing'}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Non-Blocking High Labor Burn Advisory Banner (When > 40% of Contract Budget) */}
            {workbenchLaborBurn.isHighBurn && (
              <div className="px-3.5 py-2.5 rounded-xl bg-amber-500/10 border border-amber-500/25 flex items-center justify-between gap-3 text-xs text-amber-200">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                  <span>
                    Advisory: Selected crew daily rate (₱{workbenchLaborBurn.dailyCombinedRate.toLocaleString()}/day • est. ₱{workbenchLaborBurn.projectedCost.toLocaleString()} over {workbenchLaborBurn.workingDays} workdays) is {workbenchLaborBurn.burnPct}% of contract budget (₱{workbenchLaborBurn.contractBudget.toLocaleString()}).
                  </span>
                </div>
                <span className="px-2 py-0.5 rounded-md text-[11px] font-medium bg-amber-500/15 text-amber-300 shrink-0 whitespace-nowrap">
                  Non-Blocking Advisory
                </span>
              </div>
            )}

            {/* Main View (Split Layout: Left Column = Assigned Crew, Available Pool & Audit Trail; Right Column = Sticky AI Advisory & Quick Add) */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
              {/* LEFT COLUMN: Assigned Crew, Available Workforce Pool & Audit Trail */}
              <div className="lg:col-span-7 bg-slate-950/60 border border-slate-800/80 rounded-2xl p-4 space-y-5">
                {/* Assigned Crew Section */}
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800/80 pb-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <UserCheck className="w-4 h-4 text-teal-400" />
                        <h5 className="text-sm font-semibold text-white">
                          Assigned Crew — {targetAllocationProject?.name || 'Selected Project'}
                        </h5>
                        <span className="px-2 py-0.5 rounded-md text-[11px] font-medium bg-teal-500/10 border border-teal-500/25 text-teal-300 whitespace-nowrap">
                          {assignedCrewWorkers.length} Assigned
                        </span>
                      </div>
                      <p className="text-xs text-slate-400 mt-1">
                        Schedule window: {targetAllocationProject?.startDate || 'TBD'} → {targetAllocationProject?.targetHandoverDate || 'TBD'}
                      </p>
                    </div>
                  </div>

                  {/* Assigned Crew Card Rows */}
                  {assignedCrewWorkers.length === 0 ? (
                    <div className="py-8 px-4 text-center border-2 border-dashed border-slate-800 rounded-xl bg-slate-900/20 space-y-1.5">
                      <Users className="w-6 h-6 text-slate-500 mx-auto" />
                      <div className="text-sm font-semibold text-white">
                        0 Workers Currently Assigned to {targetAllocationProject?.name || 'This Project'}
                      </div>
                      <p className="text-xs text-slate-400 max-w-md mx-auto">
                        Select a worker from the Available Workforce Pool below or click <span className="text-amber-300 font-medium">[Apply Recommendation]</span> in the ✨ AI Crew Assistant.
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {assignedCrewWorkers.map(worker => {
                        const rate = getWorkerDailyRate(worker);
                        const avail = getWorkerAvailabilityAdvisory(worker, targetAllocationProject);
                        const isLocked = isWorkerLockedByAdmin(worker);
                        const overrideNote = crewOverrideNotes[worker.id] ?? worker.manualOverrideNote ?? '';
                        const sourceBadge = crewAllocationSourceMap[worker.id] === 'AI' && !isLocked ? 'Source: AI' : 'Source: Manual';
                        const isNoteOpen = activeWorkforceNoteEditorId === worker.id || overrideNote.trim().length > 0;
                        const isJustAssigned =
                          lastAllocationFeedback?.workerId === worker.id &&
                          lastAllocationFeedback?.action === 'assigned';

                        return (
                          <div
                            key={worker.id}
                            className={`bg-slate-900/60 hover:bg-slate-900 border border-slate-800/80 rounded-xl p-3.5 transition space-y-2.5 overflow-hidden ${isJustAssigned ? 'ring-1 ring-emerald-500/40 bg-emerald-950/15' : ''
                              }`}
                          >
                            <div className="flex items-center justify-between gap-2 flex-wrap">
                              {/* Primary & Secondary Typography */}
                              <div className="min-w-0 flex-1 space-y-1.5">
                                <div className="flex items-center justify-between gap-2 flex-wrap">
                                  <div className="flex items-center gap-2 flex-wrap min-w-0">
                                    <span title={worker.name} className="text-sm font-semibold text-white truncate max-w-[200px] sm:max-w-xs">
                                      {worker.name}
                                    </span>
                                    <span
                                      title={avail.badgeText}
                                      className={`px-2 py-0.5 rounded-md text-[11px] font-medium border truncate max-w-[200px] sm:max-w-xs ${avail.isOverlapping
                                        ? 'bg-amber-500/10 border-amber-500/30 text-amber-300'
                                        : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                                        }`}
                                    >
                                      {avail.badgeText}
                                    </span>
                                    <span className="px-2 py-0.5 rounded-md text-[11px] font-medium bg-slate-800/80 border border-slate-700/80 text-slate-300 whitespace-nowrap">
                                      {sourceBadge}
                                    </span>
                                    {overrideNote.trim().length > 0 && (
                                      <span
                                        title={`Override: ${overrideNote}`}
                                        className="px-2 py-0.5 rounded-md text-[11px] font-medium bg-amber-500/10 border border-amber-500/30 text-amber-300 truncate max-w-[200px] sm:max-w-xs"
                                      >
                                        Override: {overrideNote}
                                      </span>
                                    )}
                                    {isJustAssigned && (
                                      <span className="px-2 py-0.5 rounded-md text-[11px] font-medium bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 whitespace-nowrap">
                                        ✓ Added
                                      </span>
                                    )}
                                  </div>
                                </div>

                                <div className="text-xs text-slate-400 flex items-center justify-between gap-2 flex-wrap">
                                  <div className="flex items-center gap-2 flex-wrap min-w-0">
                                    <span className="truncate max-w-[200px] sm:max-w-xs">
                                      {worker.tradeType || worker.specialty || worker.roleTitle || 'General Trade'}
                                    </span>
                                    <span>•</span>
                                    <span className="whitespace-nowrap font-mono text-slate-300">
                                      ₱{rate.toLocaleString()}/day
                                    </span>
                                    {worker.company && (
                                      <>
                                        <span>•</span>
                                        <span className="truncate max-w-[200px] sm:max-w-xs">{worker.company}</span>
                                      </>
                                    )}
                                  </div>
                                </div>
                              </div>

                              {/* Actions: Lock/Note & Clean [Unassign] Button */}
                              <div className="flex items-center gap-2 shrink-0">
                                <button
                                  type="button"
                                  onClick={() => {
                                    handleToggleWorkforceAdminLock(worker);
                                    setActiveWorkforceNoteEditorId(prev => (prev === worker.id ? null : worker.id));
                                  }}
                                  title={isLocked ? 'Locked by Admin (isLockedByAdmin). AI skips this worker.' : 'Lock assignment or add override note'}
                                  className={`px-2.5 py-1 rounded-lg text-[11px] font-medium border flex items-center gap-1.5 transition cursor-pointer whitespace-nowrap ${isLocked
                                    ? 'bg-rose-500/10 border-rose-500/40 text-rose-300'
                                    : 'bg-slate-950/70 hover:bg-slate-800 border-slate-800 text-slate-400 hover:text-white'
                                    }`}
                                >
                                  <Lock className="w-3 h-3" />
                                  <span>{isLocked ? 'Locked' : 'Lock'}</span>
                                </button>

                                <button
                                  type="button"
                                  onClick={() => handleUnassignWorkerFromProject(worker)}
                                  className="px-3 py-1 rounded-lg bg-slate-950/80 hover:bg-rose-950/70 text-slate-300 hover:text-rose-300 border border-slate-800 hover:border-rose-500/40 text-xs font-medium transition cursor-pointer whitespace-nowrap"
                                >
                                  Unassign
                                </button>
                              </div>
                            </div>

                            {/* Non-blocking Admin Override Note Input + Quick Presets */}
                            {isNoteOpen && (
                              <div className="pt-2 border-t border-slate-800/60 space-y-2">
                                <div className="flex items-center justify-between gap-2 flex-wrap">
                                  <input
                                    type="text"
                                    value={overrideNote}
                                    onChange={(e) => handleUpdateWorkforceOverrideNote(worker, e.target.value)}
                                    placeholder="Manual override note (sets isLockedByAdmin = true)..."
                                    className="flex-1 min-w-[180px] bg-slate-950/90 border border-slate-800 focus:border-amber-500/60 rounded-lg px-3 py-1.5 text-xs text-slate-200 focus:outline-none"
                                  />
                                  {isLocked && (
                                    <span className="px-2 py-0.5 rounded-md text-[11px] font-medium bg-rose-500/10 border border-rose-500/30 text-rose-300 shrink-0 whitespace-nowrap">
                                      isLockedByAdmin
                                    </span>
                                  )}
                                </div>
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <span className="text-[10px] font-mono uppercase text-slate-500">Presets:</span>
                                  {OVERRIDE_REASON_PRESETS.map(preset => (
                                    <button
                                      key={preset}
                                      type="button"
                                      title={preset}
                                      onClick={() => handleUpdateWorkforceOverrideNote(worker, preset)}
                                      className={`px-2 py-0.5 rounded-md text-[10px] font-medium border transition cursor-pointer truncate max-w-[200px] sm:max-w-xs ${overrideNote === preset
                                        ? 'bg-amber-500/15 border-amber-500/40 text-amber-300'
                                        : 'bg-slate-950/60 hover:bg-slate-800 border-slate-800 text-slate-400 hover:text-slate-200'
                                        }`}
                                    >
                                      {preset}
                                    </button>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Available Workforce Pool Section */}
                <div className="pt-4 border-t border-slate-800/80 space-y-3">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div>
                      <h6 className="text-sm font-semibold text-white">
                        Available Workforce Pool ({unassignedRosterWorkers.length})
                      </h6>
                      <p className="text-xs text-slate-400">
                        Manually assign artisans from the company roster (schedule conflicts remain non-blocking)
                      </p>
                    </div>
                    <input
                      type="text"
                      value={rosterSearchQuery}
                      onChange={(e) => setRosterSearchQuery(e.target.value)}
                      placeholder="Filter unassigned by name or trade..."
                      className="w-full sm:w-64 bg-slate-900/80 border border-slate-800 focus:border-teal-500 rounded-xl px-3 py-1.5 text-xs text-white focus:outline-none"
                    />
                  </div>

                  <div className="max-h-[500px] overflow-y-auto pr-1 space-y-2.5 custom-scrollbar">
                    {unassignedRosterWorkers.length === 0 ? (
                      <div className="py-6 text-center text-xs text-slate-400 border border-dashed border-slate-800 rounded-xl">
                        No matching unassigned workers found.
                      </div>
                    ) : (
                      unassignedRosterWorkers.map(worker => {
                        const rate = getWorkerDailyRate(worker);
                        const avail = getWorkerAvailabilityAdvisory(worker, targetAllocationProject);
                        const selectedConflictReason =
                          poolPendingOverrideReasons[worker.id] || OVERRIDE_REASON_PRESETS[0];

                        return (
                          <div
                            key={worker.id}
                            className="bg-slate-900/60 hover:bg-slate-900 border border-slate-800/80 rounded-xl p-3.5 flex items-center justify-between gap-2 flex-wrap transition overflow-hidden"
                          >
                            <div className="min-w-0 flex-1 space-y-1">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span title={worker.name} className="text-sm font-semibold text-white truncate max-w-[200px] sm:max-w-xs">
                                  {worker.name}
                                </span>
                                <span
                                  title={avail.badgeText}
                                  className={`px-2 py-0.5 rounded-md text-[11px] font-medium border truncate max-w-[200px] sm:max-w-xs ${avail.isOverlapping
                                    ? 'bg-amber-500/10 border-amber-500/30 text-amber-300'
                                    : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                                    }`}
                                >
                                  {avail.badgeText}
                                </span>
                              </div>
                              <div className="text-xs text-slate-400 flex items-center gap-2 flex-wrap">
                                <span className="truncate max-w-[200px] sm:max-w-xs">
                                  {worker.tradeType || worker.specialty || 'General Trade'}
                                </span>
                                <span>•</span>
                                <span className="whitespace-nowrap font-mono text-slate-300">
                                  ₱{rate.toLocaleString()}/day
                                </span>
                              </div>
                            </div>

                            <div className="flex items-center gap-2 shrink-0 flex-wrap">
                              <button
                                type="button"
                                onClick={() => requestAssignWorker(worker, 'Manual')}
                                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition cursor-pointer shrink-0 flex items-center gap-1.5 whitespace-nowrap border ${avail.isOverlapping
                                  ? 'bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border-amber-500/30'
                                  : 'bg-teal-500/15 hover:bg-teal-600 text-teal-300 hover:text-white border-teal-500/30'
                                  }`}
                              >
                                <Plus className="w-3.5 h-3.5" />
                                <span>{avail.isOverlapping ? 'Override & Assign' : 'Assign'}</span>
                              </button>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>

                {/* Allocation & Conflict Override Audit Trail */}
                <div className="pt-4 border-t border-slate-800/80 space-y-3">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-2 flex-wrap">
                      <ClipboardList className="w-4 h-4 text-amber-400" />
                      <h6 className="text-sm font-semibold text-white">
                        Allocation &amp; Conflict Override Audit Trail
                      </h6>
                      <span className="px-2 py-0.5 rounded-md text-[11px] font-medium bg-slate-800/80 border border-slate-700/80 text-slate-300 whitespace-nowrap">
                        {allocationAuditTrail.length} Records
                      </span>
                    </div>
                    <span className="text-[11px] font-mono text-slate-400 whitespace-nowrap">
                      Active Role: <strong className="text-teal-300">{currentActorRole}</strong>
                    </span>
                  </div>

                  {allocationAuditTrail.length === 0 ? (
                    <div className="py-4 px-3.5 text-xs text-slate-400 border border-dashed border-slate-800 rounded-xl bg-slate-900/20">
                      All manual assignments, schedule conflict overrides (capturing exact timestamp, administrator role, and justification note such as <span className="text-amber-300">Executive Approval / Urgent Pull-Out</span>), and AI applications are recorded here in real time.
                    </div>
                  ) : (
                    <div className="max-h-64 overflow-y-auto pr-1 custom-scrollbar border border-slate-800/80 rounded-xl bg-slate-950/60">
                      <table className="w-full text-left border-collapse text-xs">
                        <thead>
                          <tr className="border-b border-slate-800/90 bg-slate-900/80 text-[10px] font-mono uppercase text-slate-400">
                            <th className="py-2 px-3 whitespace-nowrap">Timestamp</th>
                            <th className="py-2 px-3 whitespace-nowrap">Admin Role</th>
                            <th className="py-2 px-3">Worker &amp; Site</th>
                            <th className="py-2 px-3">Action &amp; Justification Note</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800/60">
                          {allocationAuditTrail.map(entry => (
                            <tr key={entry.id} className="hover:bg-slate-900/50 transition">
                              <td className="py-2.5 px-3 font-mono text-[11px] text-slate-400 whitespace-nowrap align-top">
                                {entry.timestamp}
                              </td>
                              <td className="py-2.5 px-3 align-top whitespace-nowrap">
                                <span className="px-2 py-0.5 rounded-md text-[11px] font-medium bg-teal-500/10 border border-teal-500/25 text-teal-300 whitespace-nowrap">
                                  {entry.actorRole}
                                </span>
                              </td>
                              <td className="py-2.5 px-3 align-top">
                                <div className="font-semibold text-white truncate max-w-[180px] sm:max-w-[220px]">
                                  {entry.workerName}
                                </div>
                                <div className="text-[11px] text-slate-400 flex items-center gap-1.5 flex-wrap mt-0.5">
                                  <span className="truncate max-w-[160px]">{entry.projectName}</span>
                                  <span>•</span>
                                  <span className="font-mono text-slate-300 whitespace-nowrap">
                                    ₱{entry.dailyRate.toLocaleString()}/day
                                  </span>
                                </div>
                              </td>
                              <td className="py-2.5 px-3 align-top space-y-1">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <span
                                    className={`px-2 py-0.5 rounded-md text-[11px] font-medium border whitespace-nowrap ${entry.action === 'Conflict Override'
                                      ? 'bg-amber-500/10 border-amber-500/30 text-amber-300'
                                      : entry.action === 'Unassigned'
                                        ? 'bg-slate-800 border-slate-700 text-slate-300'
                                        : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                                      }`}
                                  >
                                    {entry.action}
                                  </span>
                                  <span className="px-2 py-0.5 rounded-md text-[11px] font-medium bg-slate-800/80 border border-slate-700/80 text-slate-300 whitespace-nowrap">
                                    Source: {entry.source}
                                  </span>
                                  {entry.isLockedByAdmin && (
                                    <span className="px-2 py-0.5 rounded-md text-[11px] font-medium bg-rose-500/10 border border-rose-500/30 text-rose-300 whitespace-nowrap">
                                      isLockedByAdmin
                                    </span>
                                  )}
                                </div>
                                {entry.overrideNote ? (
                                  <div
                                    title={entry.overrideNote}
                                    className="text-[11px] text-amber-300/90 font-mono truncate max-w-[200px] sm:max-w-xs"
                                  >
                                    Note: &ldquo;{entry.overrideNote}&rdquo;
                                  </div>
                                ) : (
                                  <div className="text-[11px] text-slate-500 font-mono">
                                    Standard allocation logged
                                  </div>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>

              {/* RIGHT COLUMN: Sticky AI Crew Assistant */}
              <div className="lg:col-span-5 sticky top-6 self-start space-y-4">
                {/* Dedicated AI Assistant Sidebar Card */}
                <div className="bg-slate-900 border border-slate-700/60 rounded-2xl overflow-hidden shadow-sm">
                  <div className="p-4 flex items-center justify-between gap-2 flex-wrap border-b border-slate-800/80">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="p-2 rounded-xl bg-amber-500/10 border border-amber-500/25 text-amber-400 shrink-0">
                        <Sparkles className="w-4 h-4" />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h5 className="text-sm font-semibold text-white">AI Crew Assistant</h5>
                          <span className="px-2 py-0.5 rounded-md text-[11px] font-medium bg-slate-800/80 border border-slate-700/70 text-slate-300 whitespace-nowrap">
                            {workforceAiCrewSuggestions.length} Matches
                          </span>
                        </div>
                        <p className="text-xs text-slate-400 truncate mt-0.5">
                          Multi-skill recommendations • Respects admin locks
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0 flex-wrap">
                      <button
                        type="button"
                        onClick={() => setIsOptimizeModalOpen(true)}
                        disabled={!targetAllocationProject || siteTradeCoverage.filledCount === siteTradeCoverage.totalCount}
                        className="px-2.5 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 disabled:opacity-40 disabled:cursor-not-allowed text-slate-950 text-xs font-bold transition cursor-pointer flex items-center gap-1.5 whitespace-nowrap shadow-xs"
                        title="Select highest-scoring non-conflicting candidates for all open trade slots"
                      >
                        <Zap className="w-3.5 h-3.5" />
                        <span>Auto-Optimize Crew</span>
                      </button>

                      {(() => {
                        const showScanning = isAiScanning && workforceAiCrewSuggestions.length > 0;
                        return (
                          <button
                            type="button"
                            onClick={() => {
                              setDismissedWorkforceStagedIds([]);
                              setIsAiAssistantOpen(true);
                              if (localContractors.some(c => !crewSelectedWorkerIds.includes(c.id))) {
                                handleTriggerAiScan();
                              }
                            }}
                            disabled={showScanning}
                            className="px-2.5 py-1.5 rounded-lg bg-slate-800/90 hover:bg-slate-800 text-slate-200 border border-slate-700 text-xs font-medium transition cursor-pointer flex items-center gap-1.5 whitespace-nowrap"
                            title="Refresh multi-skill AI recommendations"
                          >
                            <RefreshCw className={`w-3.5 h-3.5 text-amber-400 ${showScanning ? 'animate-spin' : ''}`} />
                            <span>{showScanning ? 'Scanning...' : 'Scan'}</span>
                          </button>
                        );
                      })()}

                      <button
                        type="button"
                        onClick={() => setIsAiAssistantOpen(prev => !prev)}
                        className="p-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-white border border-slate-800 transition cursor-pointer"
                        title={isAiAssistantOpen ? 'Collapse AI Crew Assistant' : 'Expand AI Crew Assistant'}
                      >
                        {isAiAssistantOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  {isAiAssistantOpen && (
                    <div className="p-4 space-y-3 animate-fadeIn">
                      {/* Subtle AI Recommendation Sorting Toggle */}
                      <div className="flex items-center justify-between gap-2 flex-wrap bg-slate-950/70 border border-slate-800/80 rounded-xl px-3 py-2">
                        <span className="text-[11px] font-mono uppercase tracking-wider text-slate-400">
                          Sort By:
                        </span>
                        <div className="inline-flex items-center rounded-lg bg-slate-900 p-0.5 border border-slate-800">
                          <button
                            type="button"
                            onClick={() => setAiSortMode('match')}
                            className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition cursor-pointer whitespace-nowrap ${aiSortMode === 'match'
                              ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                              : 'text-slate-400 hover:text-slate-200 border border-transparent'
                              }`}
                          >
                            Highest Match
                          </button>
                          <button
                            type="button"
                            onClick={() => setAiSortMode('cost')}
                            className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition cursor-pointer whitespace-nowrap ${aiSortMode === 'cost'
                              ? 'bg-teal-500/20 text-teal-300 border border-teal-500/30'
                              : 'text-slate-400 hover:text-slate-200 border border-transparent'
                              }`}
                          >
                            Lowest Cost (₱/day)
                          </button>
                        </div>
                      </div>

                      {aiScanMessage && (
                        <div className="bg-slate-900/90 border border-amber-500/30 text-amber-200 text-xs px-3 py-2 rounded-xl flex items-center gap-2">
                          <CheckCircle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                          <span>{aiScanMessage}</span>
                        </div>
                      )}

                      {workforceAiCrewSuggestions.length === 0 ? (
                        <div className="py-8 px-4 text-center text-xs text-slate-400 space-y-2 border border-dashed border-slate-800 rounded-xl bg-slate-950/70">
                          <Bot className="w-6 h-6 text-amber-400/80 mx-auto" />
                          <div className="text-sm font-semibold text-white">All optimal candidates are assigned</div>
                          <button
                            type="button"
                            onClick={() => setDismissedWorkforceStagedIds([])}
                            className="text-xs text-slate-300 hover:text-amber-300 underline cursor-pointer transition-colors"
                          >
                            Reset dismissed suggestions
                          </button>
                        </div>
                      ) : (
                        <div className="space-y-3">
                          {workforceAiCrewSuggestions.map(({ worker, rate, avail, score, matchingAiRec, matchedSlotLabel, fillsOpenSlot, breakdown, fourFactorBreakdown, rationale }) => {
                            const isWhyOpen = Boolean(expandedScoreCardIds[worker.id]);
                            return (
                              <div
                                key={worker.id}
                                className="bg-slate-950/60 hover:bg-slate-950/90 border border-slate-800/90 rounded-xl p-3.5 transition space-y-2.5 overflow-hidden"
                              >
                                {/* Top Row: Primary Name, Secondary Metadata, Score Pill */}
                                <div className="flex items-center justify-between gap-2 flex-wrap">
                                  <div className="min-w-0 flex-1 space-y-1">
                                    <div className="flex items-center gap-2 flex-wrap">
                                      <span title={worker.name} className="text-sm font-semibold text-white truncate max-w-[200px] sm:max-w-xs">
                                        {worker.name}
                                      </span>
                                      <span
                                        title={avail.badgeText}
                                        className={`px-2 py-0.5 rounded-md text-[11px] font-medium border truncate max-w-[200px] sm:max-w-xs ${avail.isOverlapping
                                          ? 'bg-amber-500/10 border-amber-500/30 text-amber-300'
                                          : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                                          }`}
                                      >
                                        {avail.badgeText}
                                      </span>
                                    </div>
                                    <div className="text-xs text-slate-400 flex items-center gap-2 flex-wrap">
                                      <span className="truncate max-w-[200px] sm:max-w-xs">
                                        {worker.tradeType || worker.specialty || 'General Trade'}
                                      </span>
                                      <span>•</span>
                                      <span className="whitespace-nowrap font-mono text-slate-300">
                                        ₱{rate.toLocaleString()}/day
                                      </span>
                                      {fillsOpenSlot && (
                                        <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-emerald-500/10 text-emerald-300 border border-emerald-500/25">
                                          Fills {matchedSlotLabel}
                                        </span>
                                      )}
                                    </div>
                                  </div>

                                  <div className="flex items-center gap-1.5 shrink-0">
                                    <span
                                      title={fourFactorBreakdown}
                                      className={`px-2 py-0.5 rounded-md text-[11px] font-mono font-bold border whitespace-nowrap cursor-help ${score >= 80
                                        ? 'bg-emerald-500/15 border-emerald-500/35 text-emerald-300'
                                        : score >= 60
                                          ? 'bg-amber-500/15 border-amber-500/35 text-amber-300'
                                          : 'bg-slate-800 border-slate-700 text-slate-300'
                                        }`}
                                    >
                                      {Math.round(score)}% Match
                                    </span>
                                    <button
                                      type="button"
                                      onClick={() => handleDismissWorkforceStagedSuggestion(worker.id)}
                                      className="p-1 rounded-md text-slate-500 hover:text-slate-300 hover:bg-slate-800/60 transition cursor-pointer"
                                      title="Dismiss suggestion"
                                    >
                                      <X className="w-3.5 h-3.5" />
                                    </button>
                                  </div>
                                </div>

                                {/* Concise Rationale + Why This Score Toggle + Secondary Apply Action */}
                                <div className="flex items-center justify-between gap-2 pt-0.5 flex-wrap">
                                  <div className="min-w-0 flex-1 space-y-1">
                                    <p className="text-xs text-slate-400 leading-relaxed line-clamp-1">
                                      {rationale}
                                    </p>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setExpandedScoreCardIds(prev => ({ ...prev, [worker.id]: !prev[worker.id] }))
                                      }
                                      className="text-[11px] font-mono text-amber-400/90 hover:text-amber-300 flex items-center gap-1 cursor-pointer transition"
                                    >
                                      <span>Why this score?</span>
                                      <ChevronDown className={`w-3 h-3 transition-transform ${isWhyOpen ? 'rotate-180' : ''}`} />
                                    </button>
                                  </div>

                                  <button
                                    type="button"
                                    onClick={() => requestAssignWorker(worker, 'AI', matchingAiRec)}
                                    className="px-3 py-1.5 rounded-lg bg-slate-800/90 hover:bg-amber-500/15 text-amber-300 border border-amber-500/30 hover:border-amber-400/60 font-semibold text-xs transition cursor-pointer flex items-center gap-1.5 shrink-0 whitespace-nowrap"
                                  >
                                    <Check className="w-3.5 h-3.5 stroke-[2.2]" />
                                    <span>Apply</span>
                                  </button>
                                </div>

                                {/* Collapsible Explainable AI 4-Factor Mini Progress Bars */}
                                {isWhyOpen && (
                                  <div className="pt-2.5 mt-1 border-t border-slate-800/80 space-y-2 animate-fadeIn">
                                    {[
                                      { label: 'Trade Match', val: breakdown.tradeScore, max: 40, bar: 'bg-amber-400' },
                                      { label: 'Availability / Zero-Conflict', val: breakdown.availabilityScore, max: 30, bar: avail.isOverlapping ? 'bg-rose-400' : 'bg-emerald-400' },
                                      { label: 'Budget Efficiency', val: breakdown.budgetScore, max: 20, bar: 'bg-teal-400' },
                                      { label: `Reliability / Rating (${breakdown.numericRating.toFixed(1)}★)`, val: breakdown.ratingScore, max: 10, bar: 'bg-sky-400' }
                                    ].map(factor => (
                                      <div key={factor.label} className="space-y-1">
                                        <div className="flex items-center justify-between text-[11px] font-mono">
                                          <span className="text-slate-400">{factor.label}</span>
                                          <span className="text-slate-200 font-semibold">{factor.val}/{factor.max} pts</span>
                                        </div>
                                        <div className="w-full h-1.5 rounded-full bg-slate-800 overflow-hidden">
                                          <div
                                            className={`h-full rounded-full ${factor.bar}`}
                                            style={{ width: `${Math.round((factor.val / factor.max) * 100)}%` }}
                                          />
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------- */}
      {/* PM PROJECT-SCOPED SITE ANALYTICS TAB                          */}
      {/* ------------------------------------------------------------- */}
      {activeSubTab === 'site-analytics' && (
        <div className="space-y-5 animate-fadeIn">
          {/* Site Scope Selector & Summary Header */}
          <div className="bg-slate-900/70 border border-slate-800 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3 flex-wrap">
              <div className="p-2 rounded-xl bg-amber-500/10 border border-amber-500/25 text-amber-400">
                <PieChart className="w-4 h-4" />
              </div>
              <div>
                <h4 className="text-sm font-bold text-white">
                  Site Analytics — {targetAllocationProject?.name || 'Selected Project'}
                </h4>
                <p className="text-xs text-slate-400">
                  Project-scoped crew coverage, daily labor burn by trade, and deployment conflict health
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <select
                value={targetAllocationProject?.id || ''}
                onChange={(e) => setSelectedWorkbenchProjectId(e.target.value)}
                className="bg-slate-950 border border-slate-700 focus:border-amber-500 rounded-xl px-3 py-1.5 text-xs font-semibold text-white focus:outline-none cursor-pointer"
              >
                {projects.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={handleOpenEditReqsModal}
                disabled={!targetAllocationProject}
                className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-medium transition cursor-pointer flex items-center gap-1.5"
              >
                <Sliders className="w-3.5 h-3.5 text-amber-400" />
                <span>Edit Requirements</span>
              </button>
            </div>
          </div>

          {/* 3-Card Project-Scoped Analytics Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
            {/* CHART 1: Trade Coverage (Assigned vs. Required) */}
            <div className="lg:col-span-7 bg-slate-900/70 border border-slate-800 rounded-2xl p-5 flex flex-col justify-between space-y-4">
              <div className="flex items-center justify-between gap-2 border-b border-slate-800/80 pb-3">
                <div>
                  <h5 className="text-sm font-bold text-white flex items-center gap-2">
                    <HardHat className="w-4 h-4 text-amber-400" />
                    <span>Trade Coverage (Assigned vs. Required)</span>
                  </h5>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Target headcount from Site Trade Requirements vs. currently assigned workers
                  </p>
                </div>
                <span className={`px-2.5 py-1 rounded-lg text-[11px] font-mono font-bold border shrink-0 ${siteTradeCoverage.totalHeadcountFilled >= siteTradeCoverage.totalHeadcountRequired
                  ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                  : 'bg-amber-500/15 text-amber-300 border-amber-500/30'
                  }`}>
                  {siteTradeCoverage.totalHeadcountFilled}/{siteTradeCoverage.totalHeadcountRequired} Filled
                </span>
              </div>

              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <ReBarChart
                    data={pmSiteAnalytics.coverageChartData}
                    layout="vertical"
                    margin={{ top: 4, right: 20, left: 10, bottom: 4 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke={siteChartGridStroke} horizontal={false} />
                    <XAxis type="number" allowDecimals={false} tick={{ fill: siteChartAxisTick, fontSize: 11 }} axisLine={false} tickLine={false} />
                    <YAxis type="category" dataKey="trade" width={105} tick={{ fill: siteChartAxisTick, fontSize: 11 }} axisLine={false} tickLine={false} />
                    <Tooltip
                      cursor={siteChartCursor}
                      content={renderSiteChartTooltip('coverage')}
                    />
                    <Bar dataKey="required" name="required" fill="#475569" radius={[0, 4, 4, 0]} barSize={12} />
                    <Bar dataKey="assigned" name="assigned" radius={[0, 4, 4, 0]} barSize={12}>
                      {pmSiteAnalytics.coverageChartData.map((entry, idx) => (
                        <Cell key={`cov-${idx}`} fill={entry.isFilled ? '#10b981' : '#f59e0b'} />
                      ))}
                    </Bar>
                  </ReBarChart>
                </ResponsiveContainer>
              </div>

              <div className="flex items-center gap-4 text-[11px] font-mono text-slate-400 pt-1">
                <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-xs bg-slate-600 inline-block" />Required</span>
                <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-xs bg-emerald-500 inline-block" />Assigned (Filled)</span>
                <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-xs bg-amber-500 inline-block" />Assigned (Shortfall)</span>
              </div>
            </div>

            {/* CHART 3: Crew Deployment Health Donut */}
            <div className="lg:col-span-5 bg-slate-900/70 border border-slate-800 rounded-2xl p-5 flex flex-col justify-between space-y-4">
              <div className="border-b border-slate-800/80 pb-3">
                <h5 className="text-sm font-bold text-white flex items-center gap-2">
                  <UserCheck className="w-4 h-4 text-emerald-400" />
                  <span>Crew Deployment Health</span>
                </h5>
                <p className="text-xs text-slate-400 mt-0.5">
                  Dedicated On-Site vs. Dual-Site Shared / Conflict workers
                </p>
              </div>

              {assignedCrewWorkers.length === 0 ? (
                <div className="h-56 flex flex-col items-center justify-center text-center text-xs text-slate-400 space-y-1.5">
                  <Users className="w-7 h-7 text-slate-600" />
                  <div className="font-semibold text-white">No Workers Assigned Yet</div>
                  <p>Assign crew members in Dispatch Workbench to view deployment health.</p>
                </div>
              ) : (
                <div className="relative h-56 w-full flex items-center justify-center">
                  <ResponsiveContainer width="100%" height="100%">
                    <RePieChart>
                      <Pie
                        data={pmSiteAnalytics.deploymentHealthData}
                        dataKey="value"
                        nameKey="name"
                        cx="50%"
                        cy="50%"
                        innerRadius={56}
                        outerRadius={82}
                        paddingAngle={pmSiteAnalytics.deploymentHealthData.length > 1 ? 4 : 0}
                        stroke="none"
                      >
                        {pmSiteAnalytics.deploymentHealthData.map((entry, idx) => (
                          <Cell key={`health-${idx}`} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip content={renderSiteChartTooltip('health')} />
                    </RePieChart>
                  </ResponsiveContainer>
                  <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                    <span className="text-2xl font-bold font-mono text-white">{assignedCrewWorkers.length}</span>
                    <span className="text-[10px] font-mono uppercase text-slate-400">Assigned</span>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-2.5 pt-2 border-t border-slate-800/80 text-xs font-mono">
                <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-2.5">
                  <div className="flex items-center gap-1.5 text-emerald-400 text-[11px]">
                    <span className="w-2 h-2 rounded-full bg-emerald-500" />
                    <span>Dedicated</span>
                  </div>
                  <div className="text-base font-bold text-white mt-0.5">{pmSiteAnalytics.dedicatedCount}</div>
                </div>
                <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-2.5">
                  <div className="flex items-center gap-1.5 text-amber-400 text-[11px]">
                    <span className="w-2 h-2 rounded-full bg-amber-500" />
                    <span>Dual-Site Conflict</span>
                  </div>
                  <div className="text-base font-bold text-white mt-0.5">{pmSiteAnalytics.conflictCount}</div>
                </div>
              </div>
            </div>

            {/* CHART 2: Daily Labor Burn Breakdown by Trade */}
            <div className="lg:col-span-12 bg-slate-900/70 border border-slate-800 rounded-2xl p-5 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800/80 pb-3">
                <div>
                  <h5 className="text-sm font-bold text-white flex items-center gap-2">
                    <TrendingUp className="w-4 h-4 text-teal-400" />
                    <span>Daily Labor Burn Breakdown by Trade</span>
                  </h5>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Daily wage rate (₱/day) per trade on {targetAllocationProject?.name || 'selected site'}
                  </p>
                </div>

                <div className="flex items-center gap-3 flex-wrap font-mono">
                  <div className="bg-slate-950/70 border border-slate-800 rounded-xl px-3 py-1.5">
                    <span className="text-[10px] uppercase text-slate-400 block">Total Daily Burn</span>
                    <span className="text-sm font-bold text-teal-400">
                      ₱{pmSiteAnalytics.totalDailyBurn.toLocaleString()}/day
                    </span>
                  </div>
                  <div className="bg-slate-950/70 border border-slate-800 rounded-xl px-3 py-1.5">
                    <span className="text-[10px] uppercase text-slate-400 block">Projected Weekly (6-Day)</span>
                    <span className="text-sm font-bold text-amber-400">
                      ₱{pmSiteAnalytics.projectedWeeklyBurn.toLocaleString()}/wk
                    </span>
                  </div>
                </div>
              </div>

              {pmSiteAnalytics.burnByTradeData.length === 0 ? (
                <div className="h-52 flex flex-col items-center justify-center text-center text-xs text-slate-400 space-y-1.5">
                  <BarChart3 className="w-7 h-7 text-slate-600" />
                  <div className="font-semibold text-white">No Active Labor Burn for This Site</div>
                  <p>Daily and weekly burn per trade will chart automatically once workers are assigned.</p>
                </div>
              ) : (
                <div className="h-60 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <ReBarChart data={pmSiteAnalytics.burnByTradeData} margin={{ top: 10, right: 16, left: 0, bottom: 4 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke={siteChartGridStroke} vertical={false} />
                      <XAxis dataKey="trade" tick={{ fill: siteChartAxisTick, fontSize: 11 }} axisLine={false} tickLine={false} />
                      <YAxis
                        tickFormatter={(v) => `₱${Number(v).toLocaleString()}`}
                        tick={{ fill: siteChartAxisTick, fontSize: 11 }}
                        axisLine={false}
                        tickLine={false}
                        width={68}
                      />
                      <Tooltip
                        cursor={siteChartCursor}
                        content={renderSiteChartTooltip('burn')}
                      />
                      <Bar dataKey="dailyBurn" fill="#14b8a6" radius={[6, 6, 0, 0]} maxBarSize={48} />
                    </ReBarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------- */}
      {/* TAB 2: WORKFORCE ANALYTICS & REPORTS (EXECUTIVE VIEW)         */}
      {/* ------------------------------------------------------------- */}
      {activeSubTab === 'analytics' && (
        <div className="space-y-6 animate-fadeIn">
          {/* Executive Analytics KPI Cards (Live Synced) */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4 space-y-1">
              <div className="flex justify-between items-center text-slate-400 text-xs font-mono">
                <span className="uppercase">TOTAL FIELD PERSONNEL</span>
                <HardHat className="w-4 h-4 text-teal-400" />
              </div>
              <div className="text-2xl font-bold font-mono text-white flex items-baseline gap-1.5">
                <span>{liveTotalManpower}</span>
                <span className="text-xs text-slate-400 font-normal">Laborers</span>
              </div>
              <span className="text-[10px] text-slate-400 block font-mono">{localContractors.length} Registered Entities</span>
            </div>

            <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4 space-y-1">
              <div className="flex justify-between items-center text-slate-400 text-xs font-mono">
                <span className="uppercase">IN-HOUSE CORE STAFF</span>
                <Users className="w-4 h-4 text-emerald-400" />
              </div>
              <div className="text-2xl font-bold font-mono text-white flex items-baseline gap-1.5">
                <span>{liveInHouseAndOutsourced.inHouse}</span>
                <span className="text-xs text-slate-400 font-normal">Permanent</span>
              </div>
              <span className="text-[10px] text-slate-400 block font-mono">{inHouseRatio}% of Total Workforce</span>
            </div>

            <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4 space-y-1">
              <div className="flex justify-between items-center text-slate-400 text-xs font-mono">
                <span className="uppercase">OUTSOURCED CREWS</span>
                <Building className="w-4 h-4 text-amber-400" />
              </div>
              <div className="text-2xl font-bold font-mono text-white flex items-baseline gap-1.5">
                <span>{liveInHouseAndOutsourced.outsourced}</span>
                <span className="text-xs text-slate-400 font-normal">Contractors</span>
              </div>
              <span className="text-[10px] text-slate-400 block font-mono">Specialized Trade Partners</span>
            </div>

            <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4 space-y-1">
              <div className="flex justify-between items-center text-slate-400 text-xs font-mono">
                <span className="uppercase">ACTIVE SITE DEPLOYMENTS</span>
                <Award className="w-4 h-4 text-teal-400" />
              </div>
              <div className="text-2xl font-bold font-mono text-white flex items-baseline gap-1.5">
                <span>{liveDeployedWorkerIds.size}</span>
                <span className="text-xs text-slate-400 font-normal">Active Workers</span>
              </div>
              <span className="text-[10px] text-slate-400 block font-mono">{liveSiteUtilizationPct}% Fleet Utilization</span>
            </div>
          </div>

          {/* Visual Workforce Analytics Charts (Connected Directly to Live Project & Contractor State) */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

            {/* Chart 1: Manpower Headcount Deployed per Commercial Project */}
            <div className={`${isDark ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200/80 shadow-xs'} border rounded-xl p-4.5 space-y-3`}>
              <div className={`flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b ${isDark ? 'border-slate-800/80' : 'border-slate-100'} pb-2.5`}>
                <div>
                  <h4 className={`text-xs font-bold ${isDark ? 'text-white' : 'text-slate-900'} flex items-center gap-2`}>
                    <BarChart3 className={`w-4 h-4 ${isDark ? 'text-teal-400' : 'text-blue-600'}`} />
                    Labor Allocation by Commercial Site
                  </h4>
                  <p className={`text-[11px] ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>Live physical workforce distribution &amp; daily burn across active project sites</p>
                </div>
                <span className={`text-[10px] font-mono ${isDark ? 'bg-teal-950/80 border-teal-800/80 text-teal-300' : 'bg-blue-50 border-blue-200 text-blue-700'} border px-2.5 py-0.5 rounded-full font-bold whitespace-nowrap`}>
                  {liveProjectLaborChartData.reduce((sum, p) => sum + p.workers, 0)} Total Assigned
                </span>
              </div>

              {liveProjectLaborChartData.length === 0 ? (
                <div className="h-52 flex flex-col items-center justify-center text-slate-500 space-y-2 text-center p-4">
                  <Building className="w-8 h-8 text-slate-400" />
                  <span className={`text-xs font-semibold ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>No Commercial Sites Registered</span>
                  <span className={`text-[11px] ${isDark ? 'text-slate-600' : 'text-slate-400'}`}>Register a commercial project site to track labor distribution.</span>
                </div>
              ) : (
                <>
                  <div className="h-60 w-full pt-1">
                    <ResponsiveContainer width="100%" height="100%">
                      <ReBarChart data={liveProjectLaborChartData} margin={{ top: 20, right: 16, left: -12, bottom: 42 }}>
                        <defs>
                          <linearGradient id="blueAllocBarGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor={isDark ? '#38bdf8' : '#0284c7'} stopOpacity={0.98} />
                            <stop offset="100%" stopColor={isDark ? '#0284c7' : '#0369a1'} stopOpacity={0.92} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid
                          strokeDasharray="3 3"
                          stroke={isDark ? '#1e293b' : '#e2e8f0'}
                          strokeOpacity={isDark ? 0.8 : 0.9}
                          vertical={false}
                        />
                        <XAxis
                          dataKey="name"
                          stroke={isDark ? '#64748b' : '#334155'}
                          tick={{ fill: isDark ? '#cbd5e1' : '#334155', fontSize: 11, fontWeight: 600 }}
                          tickLine={false}
                          interval={0}
                          angle={-15}
                          textAnchor="end"
                          height={46}
                          dy={6}
                        />
                        <YAxis
                          stroke={isDark ? '#64748b' : '#334155'}
                          tick={{ fill: isDark ? '#94a3b8' : '#334155', fontSize: 11, fontWeight: 600 }}
                          tickLine={false}
                          allowDecimals={false}
                        />
                        <Tooltip
                          content={({ active, payload }) => {
                            if (active && payload && payload.length) {
                              const data = payload[0].payload;
                              return (
                                <div className={`${isDark ? 'bg-slate-900 border-slate-700 text-white' : 'bg-white border-slate-300 text-slate-900 shadow-xl'} border p-3 rounded-xl text-xs space-y-1 font-sans pointer-events-none select-none`}>
                                  <div className="font-bold">{data.fullName}</div>
                                  <div className={`${isDark ? 'text-teal-400' : 'text-blue-800'} font-mono font-bold`}>
                                    Personnel Headcount: {data.workers} Active Workers
                                  </div>
                                  <div className={`${isDark ? 'text-amber-400' : 'text-amber-800'} font-mono font-semibold`}>
                                    Cumulative Daily Burn: ₱{Number(data.dailyBurn || 0).toLocaleString()}/day
                                  </div>
                                  <div className={`${isDark ? 'text-slate-300' : 'text-slate-700'} font-mono`}>Completion: {data.progress}%</div>
                                  <div className="text-[10px] text-slate-500 font-mono uppercase">{data.status}</div>
                                </div>
                              );
                            }
                            return null;
                          }}
                        />
                        <Bar dataKey="workers" fill="url(#blueAllocBarGrad)" radius={[6, 6, 0, 0]} maxBarSize={54}>
                          <LabelList
                            dataKey="workers"
                            position="top"
                            fill={isDark ? '#f8fafc' : '#0f172a'}
                            fontSize={11}
                            fontWeight={700}
                            formatter={(val: any) => `${val} pax`}
                          />
                        </Bar>
                      </ReBarChart>
                    </ResponsiveContainer>
                  </div>

                  <div className={`grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2 border-t ${isDark ? 'border-slate-800/80' : 'border-slate-100'} text-[11px]`}>
                    {liveProjectLaborChartData.slice(0, 4).map((p, i) => (
                      <div key={i} className={`${isDark ? 'bg-slate-900/60 border-slate-800/80' : 'bg-slate-50 border-slate-200/80'} border rounded-xl p-2.5 space-y-1`}>
                        <div className={`font-bold ${isDark ? 'text-white' : 'text-slate-900'} truncate text-xs`}>{p.name}</div>
                        <div className="flex items-center justify-between font-mono text-[10px]">
                          <span className={`${isDark ? 'text-teal-400' : 'text-blue-600'} font-bold`}>{p.workers} Crew</span>
                          <span className="text-amber-400">₱{Number(p.dailyBurn || 0).toLocaleString()}/d</span>
                        </div>
                        <div className={`w-full h-1 ${isDark ? 'bg-slate-800' : 'bg-slate-200'} rounded-full overflow-hidden`}>
                          <div className={`h-full ${isDark ? 'bg-teal-400' : 'bg-blue-600'} rounded-full`} style={{ width: `${p.progress}%` }}></div>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>

            {/* Chart 2: Engineering Specialty & Trade Distribution Donut */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4.5 shadow-xs space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800/80 pb-2.5">
                <div>
                  <h4 className="text-xs font-bold text-white flex items-center gap-2">
                    <PieChart className="w-4 h-4 text-indigo-400" />
                    Trade Discipline &amp; Specialty Breakdown
                  </h4>
                  <p className="text-[11px] text-slate-400">Headcount &amp; cumulative daily labor burn across specialized trades</p>
                </div>
                <span className="text-[10px] font-mono bg-indigo-950/80 border border-indigo-800/80 text-indigo-300 px-2.5 py-0.5 rounded-full font-bold whitespace-nowrap">
                  {liveTradeManpowerChartData.length} Specialized Trades
                </span>
              </div>

              {liveTradeManpowerChartData.length === 0 ? (
                <div className="h-52 flex flex-col items-center justify-center text-slate-500 space-y-2 text-center p-4">
                  <Users className="w-8 h-8 text-slate-600" />
                  <span className="text-xs font-semibold text-slate-400">No Trade Workers Registered</span>
                  <span className="text-[11px] text-slate-600">Click &quot;Register Worker&quot; above to add construction personnel and trades.</span>
                </div>
              ) : (
                (() => {
                  const totalCrew = liveTradeManpowerChartData.reduce((sum, item) => sum + (item.value || 0), 0);

                  return (
                    <>
                      <div className="h-52 w-full flex items-center justify-center relative">
                        <ResponsiveContainer width="100%" height="100%">
                          <RePieChart>
                            <Pie
                              data={liveTradeManpowerChartData}
                              cx="50%"
                              cy="50%"
                              innerRadius={50}
                              outerRadius={75}
                              paddingAngle={4}
                              dataKey="value"
                            >
                              {liveTradeManpowerChartData.map((entry, index) => (
                                <Cell key={`cell-${index}`} fill={entry.color} stroke={isDark ? '#0f172a' : '#ffffff'} strokeWidth={2} />
                              ))}
                            </Pie>
                            <Tooltip
                              content={({ active, payload }) => {
                                if (active && payload && payload.length) {
                                  const data = payload[0].payload;
                                  const disciplineCount = Number(data.value || 0);
                                  const percentage = totalCrew > 0 ? Math.round((disciplineCount / totalCrew) * 100) : 0;
                                  return (
                                    <div className="bg-slate-900 border border-slate-700 p-3 rounded-xl shadow-xl text-xs space-y-1 font-sans pointer-events-none select-none">
                                      <div className="font-bold text-white">{data.name}</div>
                                      <div className="text-teal-400 font-mono font-bold">
                                        Personnel Headcount: {disciplineCount} Workers ({percentage}%)
                                      </div>
                                      <div className="text-amber-400 font-mono font-semibold">
                                        Cumulative Daily Burn: ₱{Number(data.dailyBurn || 0).toLocaleString()}/day
                                      </div>
                                    </div>
                                  );
                                }
                                return null;
                              }}
                            />
                          </RePieChart>
                        </ResponsiveContainer>
                        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                          <span className="text-xl font-black font-mono text-white">{totalCrew}</span>
                          <span className="text-[10px] text-slate-400 uppercase font-mono tracking-wider">Total Crew</span>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 pt-2 border-t border-slate-800/80 text-[11px]">
                        {liveTradeManpowerChartData.slice(0, 6).map((item, idx) => {
                          const disciplineCount = Number(item.value || 0);
                          const percentage = totalCrew > 0 ? Math.round((disciplineCount / totalCrew) * 100) : 0;
                          return (
                            <div key={idx} className="bg-slate-900/60 border border-slate-800/80 rounded-xl p-2 space-y-0.5">
                              <div className="flex items-center gap-1.5 font-semibold text-slate-200 truncate">
                                <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: item.color }}></span>
                                <span className="truncate text-xs">{item.name}</span>
                              </div>
                              <div className="flex justify-between items-center text-[10px] font-mono text-slate-400">
                                <span>{percentage}% • <strong className="text-white">{item.value} Men</strong></span>
                                <span className="text-amber-400">₱{Number(item.dailyBurn || 0).toLocaleString()}/d</span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </>
                  );
                })()
              )}
            </div>

            {/* Chart 3: Employment Mix: In-House Core vs Outsourced Partners */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4.5 shadow-xs space-y-3 lg:col-span-2">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800/80 pb-2.5">
                <div>
                  <h4 className="text-xs font-bold text-white flex items-center gap-2">
                    <Users className="w-4 h-4 text-emerald-400" />
                    Workforce Structure: In-House vs Outsourced
                  </h4>
                  <p className="text-[11px] text-slate-400">Direct employee supervision vs subcontractor specialized capacity &amp; daily burn</p>
                </div>
                <span className="text-[10px] font-mono bg-emerald-950/80 border border-emerald-800/80 text-emerald-300 px-2.5 py-0.5 rounded-full font-bold whitespace-nowrap">
                  {localContractors.length} Total Workforce Entities
                </span>
              </div>

              {liveInHouseAndOutsourced.chartData.length === 0 ? (
                <div className="h-48 flex flex-col items-center justify-center text-slate-500 space-y-2 text-center p-4">
                  <Users className="w-8 h-8 text-slate-600" />
                  <span className="text-xs font-semibold text-slate-400">No Workforce Registered</span>
                  <span className="text-[11px] text-slate-600">Register in-house personnel or subcontracted trade partners to view organizational mix.</span>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-center">
                  <div className="h-48 w-full flex items-center justify-center relative md:col-span-1">
                    <ResponsiveContainer width="100%" height="100%">
                      <RePieChart>
                        <Pie
                          data={liveInHouseAndOutsourced.chartData}
                          cx="50%"
                          cy="50%"
                          innerRadius={55}
                          outerRadius={80}
                          paddingAngle={5}
                          dataKey="value"
                        >
                          {liveInHouseAndOutsourced.chartData.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={entry.color} stroke={isDark ? '#0f172a' : '#ffffff'} strokeWidth={2} />
                          ))}
                        </Pie>
                        <Tooltip
                          content={({ active, payload }) => {
                            if (active && payload && payload.length) {
                              const data = payload[0].payload;
                              const total = liveInHouseAndOutsourced.chartData.reduce((s, i) => s + i.value, 0);
                              const pct = total > 0 ? ((data.value / total) * 100).toFixed(1) : '0';
                              return (
                                <div className="bg-slate-900 border border-slate-700 p-3 rounded-xl shadow-xl text-xs space-y-1 font-sans pointer-events-none select-none">
                                  <div className="font-bold text-white">{data.name}</div>
                                  <div className="text-teal-400 font-mono font-bold">
                                    Personnel Headcount: {data.value} ({pct}%)
                                  </div>
                                  <div className="text-amber-400 font-mono font-semibold">
                                    Cumulative Daily Burn: ₱{Number(data.dailyBurn || 0).toLocaleString()}/day
                                  </div>
                                </div>
                              );
                            }
                            return null;
                          }}
                        />
                      </RePieChart>
                    </ResponsiveContainer>
                    <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                      <span className="text-xl font-black font-mono text-white">
                        {inHouseRatio}%
                      </span>
                      <span className="text-[10px] text-slate-400 uppercase font-mono tracking-wider">In-House</span>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 md:col-span-2 text-xs">
                    <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4 space-y-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5 font-bold text-white">
                          <span className="w-2.5 h-2.5 rounded-full bg-emerald-400"></span>
                          <span>LDM In-House Core</span>
                        </div>
                        <span className="text-[11px] font-mono text-amber-400">
                          ₱{liveInHouseAndOutsourced.inHouseDailyBurn.toLocaleString()}/day
                        </span>
                      </div>
                      <div className="text-2xl font-black font-mono text-white">{liveInHouseAndOutsourced.inHouse} Staff</div>
                      <p className="text-[11px] text-slate-400 leading-relaxed">Permanent Engineers, Foremen &amp; Core Skilled Trades directly under company payroll.</p>
                    </div>

                    <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4 space-y-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5 font-bold text-white">
                          <span className="w-2.5 h-2.5 rounded-full bg-amber-400"></span>
                          <span>Outsourced Trade Partners</span>
                        </div>
                        <span className="text-[11px] font-mono text-amber-400">
                          ₱{liveInHouseAndOutsourced.outsourcedDailyBurn.toLocaleString()}/day
                        </span>
                      </div>
                      <div className="text-2xl font-black font-mono text-white">{liveInHouseAndOutsourced.outsourced} Workers</div>
                      <p className="text-[11px] text-slate-400 leading-relaxed">Specialized Subcontractors, MEPFS Teams &amp; Manpower Suppliers deployed per milestone.</p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* EDIT SITE TRADE REQUIREMENTS MODAL */}
      {isEditReqsModalOpen && targetAllocationProject && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-fadeIn">
          <div className="w-full max-w-lg bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden text-slate-100">
            <div className="px-5 py-4 border-b border-slate-800 bg-slate-950/70 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-amber-500/15 border border-amber-500/30 text-amber-400">
                  <Sliders className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">Edit Site Trade Requirements</h3>
                  <p className="text-xs text-slate-400">
                    {targetAllocationProject.name} • Feeds Site Coverage, AI Scoring &amp; Auto-Optimize
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsEditReqsModalOpen(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-4 max-h-[70vh] overflow-y-auto">
              {/* Quick Presets by Project Type */}
              <div className="space-y-1.5">
                <span className="text-[10px] font-mono uppercase tracking-wider text-slate-400 font-bold block">
                  Quick Presets by Project Type
                </span>
                <div className="grid grid-cols-2 gap-2">
                  {TRADE_REQUIREMENT_PRESETS.map(preset => (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() =>
                        setDraftTradeReqs(preset.requirements.map(r => ({ ...r, matchTerms: [...r.matchTerms] })))
                      }
                      className="text-left p-2.5 rounded-xl bg-slate-950/70 hover:bg-slate-800/80 border border-slate-800 hover:border-amber-500/40 transition cursor-pointer"
                    >
                      <div className="text-xs font-semibold text-white">{preset.name}</div>
                      <div className="text-[10px] text-slate-400 mt-0.5 line-clamp-1">{preset.subtitle}</div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Current Required Trades & Headcount Steppers */}
              <div className="space-y-2">
                <span className="text-[10px] font-mono uppercase tracking-wider text-slate-400 font-bold block">
                  Required Trades &amp; Target Headcount ({draftTradeReqs.reduce((s, r) => s + r.required, 0)} total)
                </span>
                <div className="space-y-1.5">
                  {draftTradeReqs.map(req => (
                    <div
                      key={req.id}
                      className="flex items-center justify-between gap-2 px-3 py-2 rounded-xl bg-slate-950/70 border border-slate-800 text-xs"
                    >
                      <span className="font-semibold text-white truncate">{req.label}</span>
                      <div className="flex items-center gap-2 shrink-0">
                        <div className="flex items-center bg-slate-900 border border-slate-700 rounded-lg overflow-hidden">
                          <button
                            type="button"
                            onClick={() =>
                              setDraftTradeReqs(prev =>
                                prev.map(r => (r.id === req.id ? { ...r, required: Math.max(1, r.required - 1) } : r))
                              )
                            }
                            className="px-2 py-1 text-slate-300 hover:bg-slate-800 cursor-pointer font-mono font-bold"
                          >
                            −
                          </button>
                          <span className="px-2.5 py-1 font-mono font-bold text-amber-300 min-w-[28px] text-center">
                            {req.required}
                          </span>
                          <button
                            type="button"
                            onClick={() =>
                              setDraftTradeReqs(prev =>
                                prev.map(r => (r.id === req.id ? { ...r, required: Math.min(20, r.required + 1) } : r))
                              )
                            }
                            className="px-2 py-1 text-slate-300 hover:bg-slate-800 cursor-pointer font-mono font-bold"
                          >
                            +
                          </button>
                        </div>
                        <button
                          type="button"
                          onClick={() => setDraftTradeReqs(prev => prev.filter(r => r.id !== req.id))}
                          disabled={draftTradeReqs.length <= 1}
                          className="p-1.5 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 disabled:opacity-30 cursor-pointer transition"
                          title="Remove trade requirement"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Add Custom Trade Row */}
              <div className="pt-2 border-t border-slate-800 space-y-1.5">
                <span className="text-[10px] font-mono uppercase tracking-wider text-slate-400 font-bold block">
                  Add Custom Trade Role
                </span>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={newCustomTradeLabel}
                    onChange={(e) => setNewCustomTradeLabel(e.target.value)}
                    placeholder="e.g. Safety Officer, QA/QC Engineer, Welder..."
                    className="flex-1 bg-slate-950 border border-slate-700 focus:border-amber-500 rounded-xl px-3 py-2 text-xs text-white focus:outline-none"
                  />
                  <input
                    type="number"
                    min={1}
                    max={20}
                    value={newCustomTradeQty}
                    onChange={(e) => setNewCustomTradeQty(Math.max(1, Math.min(20, Number(e.target.value) || 1)))}
                    className="w-16 bg-slate-950 border border-slate-700 focus:border-amber-500 rounded-xl px-2.5 py-2 text-xs font-mono text-white text-center focus:outline-none"
                  />
                  <button
                    type="button"
                    disabled={!newCustomTradeLabel.trim()}
                    onClick={() => {
                      const label = newCustomTradeLabel.trim();
                      if (!label) return;
                      const slug = `custom_${label.toLowerCase().replace(/[^a-z0-9]+/g, '_')}_${Date.now().toString().slice(-3)}`;
                      setDraftTradeReqs(prev => [
                        ...prev,
                        {
                          id: slug,
                          label,
                          required: newCustomTradeQty,
                          matchTerms: buildMatchTermsForLabel(label)
                        }
                      ]);
                      setNewCustomTradeLabel('');
                      setNewCustomTradeQty(1);
                    }}
                    className="px-3 py-2 rounded-xl bg-teal-600 hover:bg-teal-500 disabled:opacity-40 text-white text-xs font-semibold transition cursor-pointer flex items-center gap-1 shrink-0"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Add</span>
                  </button>
                </div>
              </div>
            </div>

            <div className="px-5 py-3.5 border-t border-slate-800 bg-slate-950/60 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setIsEditReqsModalOpen(false)}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium border border-slate-700 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveProjectTradeReqs}
                className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs transition cursor-pointer flex items-center gap-1.5"
              >
                <Check className="w-3.5 h-3.5" />
                <span>Save Requirements</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CREW OPTIMIZATION PREVIEW MODAL */}
      {isOptimizeModalOpen && targetAllocationProject && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-fadeIn">
          <div className="w-full max-w-xl bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden text-slate-100">
            <div className="px-5 py-4 border-b border-slate-800 bg-slate-950/70 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-amber-500/15 border border-amber-500/30 text-amber-400">
                  <Zap className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">Crew Optimization Preview</h3>
                  <p className="text-xs text-slate-400">
                    {targetAllocationProject.name} • Highest-scoring non-conflicting candidates
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => !isDeployingOptimizedCrew && setIsOptimizeModalOpen(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              {/* Impact Summary KPIs */}
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-slate-950/70 border border-slate-800 rounded-xl p-3">
                  <span className="text-[10px] font-mono uppercase text-slate-400 block">Trade Coverage</span>
                  <div className="text-sm font-bold text-white mt-1 flex items-center gap-2 font-mono">
                    <span className="text-amber-300">{autoOptimizePlan.coverageBefore}</span>
                    <ArrowRight className="w-3.5 h-3.5 text-slate-500" />
                    <span className="text-emerald-400">{autoOptimizePlan.coverageAfter} Filled</span>
                  </div>
                </div>
                <div className="bg-slate-950/70 border border-slate-800 rounded-xl p-3">
                  <span className="text-[10px] font-mono uppercase text-slate-400 block">Projected Daily Burn</span>
                  <div className="text-sm font-bold text-white mt-1 font-mono">
                    ₱{autoOptimizePlan.projectedDailyBurn.toLocaleString()}/day
                    <span className="text-[11px] text-teal-400 font-normal ml-1.5">
                      (+₱{autoOptimizePlan.additionalDailyBurn.toLocaleString()})
                    </span>
                  </div>
                </div>
              </div>

              {/* Proposed Assignments */}
              {autoOptimizePlan.proposed.length === 0 ? (
                <div className="py-6 px-4 text-center border border-dashed border-slate-800 rounded-xl bg-slate-950/40 text-xs text-slate-400 space-y-1">
                  <AlertTriangle className="w-5 h-5 text-amber-400 mx-auto" />
                  <div className="text-white font-semibold">No non-conflicting candidates available for open slots</div>
                  <p>All eligible unassigned workers are already deployed. Use manual Override &amp; Assign if dual-site sharing is required.</p>
                </div>
              ) : (
                <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                  <span className="text-[10px] font-mono uppercase text-slate-400 block">
                    Proposed Assignments ({autoOptimizePlan.proposed.length})
                  </span>
                  {autoOptimizePlan.proposed.map(item => (
                    <div
                      key={item.worker.id}
                      className="bg-slate-950/70 border border-slate-800 rounded-xl px-3.5 py-2.5 flex items-center justify-between gap-3 text-xs"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-white truncate">{item.worker.name}</span>
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                            {item.slotLabel}
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-400 mt-0.5">
                          {item.worker.tradeType || item.worker.specialty || 'Field Artisan'} • Unassigned (Zero Conflict)
                        </div>
                      </div>
                      <div className="text-right shrink-0 font-mono">
                        <div className="text-emerald-300 font-bold">{item.score}% Match</div>
                        <div className="text-[11px] text-slate-400">₱{item.rate.toLocaleString()}/day</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Conflict / Unfilled Slot Advisories */}
              {autoOptimizePlan.unfilledSlots.length > 0 && (
                <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-xs text-amber-200 flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                  <span>
                    <strong>Remaining Open Slots:</strong> {autoOptimizePlan.unfilledSlots.join(', ')} (no unassigned conflict-free candidates found).
                  </span>
                </div>
              )}
            </div>

            <div className="px-5 py-3.5 border-t border-slate-800 bg-slate-950/60 flex items-center justify-end gap-2">
              <button
                type="button"
                disabled={isDeployingOptimizedCrew}
                onClick={() => setIsOptimizeModalOpen(false)}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium border border-slate-700 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isDeployingOptimizedCrew || autoOptimizePlan.proposed.length === 0}
                onClick={handleConfirmAutoOptimizeDeploy}
                className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-950 font-bold text-xs transition cursor-pointer flex items-center gap-1.5 shadow-sm"
              >
                {isDeployingOptimizedCrew ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Deploying Crew...</span>
                  </>
                ) : (
                  <>
                    <CheckCheck className="w-3.5 h-3.5" />
                    <span>Confirm &amp; Deploy Crew</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* DUAL-SITE CONFLICT OVERRIDE CONFIRMATION MODAL */}
      {pendingConflictAssign && targetAllocationProject && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-fadeIn">
          <div className="w-full max-w-md bg-slate-900 border border-amber-500/40 rounded-2xl shadow-2xl overflow-hidden text-slate-100">
            <div className="px-5 py-4 border-b border-slate-800 bg-slate-950/70 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-amber-500/15 border border-amber-500/30 text-amber-400">
                  <AlertTriangle className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">Dual-Site Conflict Override</h3>
                  <p className="text-xs text-slate-400">Audit reason required before dual-site assignment</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setPendingConflictAssign(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 text-xs space-y-1">
                <div className="font-bold text-white">{pendingConflictAssign.worker.name}</div>
                <div className="text-slate-400">
                  Currently active on:{' '}
                  <strong className="text-amber-300">
                    {pendingConflictAssign.conflictSites.join(', ')}
                  </strong>
                </div>
                <div className="text-slate-400">
                  Target site: <strong className="text-teal-300">{targetAllocationProject.name}</strong>
                </div>
              </div>

              <div className="space-y-2">
                <label className="block text-[10px] font-mono uppercase tracking-wider text-slate-400 font-bold">
                  Override Reason *
                </label>
                <div className="grid grid-cols-1 gap-1.5">
                  {OVERRIDE_REASON_PRESETS.map(preset => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => setConflictOverridePreset(preset)}
                      className={`px-3 py-2 rounded-xl text-left text-xs font-medium border transition cursor-pointer flex items-center justify-between ${conflictOverridePreset === preset
                        ? 'bg-amber-500/15 border-amber-500/50 text-amber-200 font-semibold'
                        : 'bg-slate-950/60 border-slate-800 text-slate-300 hover:border-slate-700'
                        }`}
                    >
                      <span>{preset}</span>
                      {conflictOverridePreset === preset && <Check className="w-3.5 h-3.5 text-amber-400" />}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-mono uppercase tracking-wider text-slate-400 font-bold mb-1">
                  {conflictOverridePreset === 'Custom Note' ? 'Custom Override Note *' : 'Additional Note (Optional)'}
                </label>
                <input
                  type="text"
                  value={conflictCustomNote}
                  onChange={(e) => setConflictCustomNote(e.target.value)}
                  placeholder="Enter justification for audit trail..."
                  className="w-full bg-slate-950 border border-slate-700 focus:border-amber-500 rounded-xl px-3 py-2 text-xs text-white focus:outline-none"
                />
              </div>

              <div className="text-[11px] font-mono text-slate-400">
                Logged under actor: <strong className="text-teal-300">{currentActorRole}</strong>
              </div>
            </div>

            <div className="px-5 py-3.5 border-t border-slate-800 bg-slate-950/60 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setPendingConflictAssign(null)}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium border border-slate-700 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={conflictOverridePreset === 'Custom Note' && !conflictCustomNote.trim()}
                onClick={handleConfirmConflictOverride}
                className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-950 font-bold text-xs transition cursor-pointer flex items-center gap-1.5"
              >
                <Check className="w-3.5 h-3.5" />
                <span>Confirm Override &amp; Assign</span>
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};

export default LaborWorkforceArtisanTrades;
