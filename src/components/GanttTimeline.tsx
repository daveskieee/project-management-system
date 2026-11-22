/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  Calendar, RefreshCw, ZoomIn, ZoomOut, Save, Plus,
  CheckCircle2, Layers, HardHat, AlertTriangle, Edit3, Trash2,
  X, ChevronRight, ChevronDown, Clock, ArrowRight, Link2,
  AlertCircle, ChevronLeft, CornerDownRight, ChevronsDown, ChevronsUp,
  Maximize2, Minimize2, PanelLeftClose, PanelLeftOpen, Scan,
  Printer, Download, Wand2, BookmarkCheck, RotateCw, Sparkles, SlidersHorizontal, Loader2
} from 'lucide-react';
import { ProjectProfile, Contractor, DailySiteLog } from '../types';
import { useTheme } from '../context/ThemeContext';
import { useConfirm } from '../context/ConfirmDialogContext';
import { getCsrfToken } from '../utils/apiClient';
import { getStoredSession } from '../utils/session';
import {
  STANDARD_CONSTRUCTION_PHASES as SHARED_STANDARD_CONSTRUCTION_PHASES,
  computeUnifiedProjectProgress,
  getCanonicalProjectProgress,
  resolveTaskConstructionPhase,
  loadProjectGanttTasksFromStorage,
  saveProjectGanttTasks,
  setLiveGanttTasksSnapshot,
  normalizeTaskProgressFraction,
  getGanttStorageKey,
  createDefaultWbsTasksForProject,
  GANTT_SELECT_PROJECT_EVENT,
  GANTT_TASKS_UPDATED_EVENT,
} from '../utils/ganttProgress';

// ==========================================
// 1. Core Interfaces & Data Types
// ==========================================

export const STANDARD_CONSTRUCTION_PHASES: string[] = SHARED_STANDARD_CONSTRUCTION_PHASES;

export interface GanttTaskItem {
  id: string;
  projectId: string;
  wbsCode: string;
  text: string;
  startDate: string; // YYYY-MM-DD
  endDate: string;   // YYYY-MM-DD
  duration: number;  // working days (Mon-Sat, skipping Sundays)
  progress: number;  // 0.0 to 1.0
  weight?: number;   // Weighted percentage (0-100%) within parent phase or schedule
  constructionPhase?: string; // Standard civil construction phase
  baselineStart?: string | null;
  baselineEnd?: string | null;
  type: 'task' | 'project' | 'milestone';
  parentTaskId?: string | null;
  sortOrder: number;
  assignedContractorId?: string | null;
  contractorName?: string;
  predecessorIds: string[]; // Finish-to-Start predecessor task IDs
}

export interface GanttLinkItem {
  id: string;
  source: string; // predecessor task ID
  target: string; // successor task ID
  type: string;   // '0' = Finish-to-Start
  lag: number;
}

interface GanttTimelineProps {
  projects?: ProjectProfile[];
  contractors?: Contractor[];
  siteLogs?: DailySiteLog[];
  milestones?: any[];
  tasks?: any[];
  onUpdateProject?: (id: string, updates: Partial<ProjectProfile>) => void | Promise<void>;
  onDeleteTask?: (taskId: string) => void;
}

type ZoomLevel = 'year' | 'quarter' | 'month' | 'week' | 'day';

interface DragState {
  active: boolean;
  type: 'move' | 'resize-left' | 'resize-right';
  taskId: string;
  initialPointerX: number;
  initialStartDate: string;
  initialEndDate: string;
  initialDuration: number;
}

// ==========================================
// 2. Philippine 6-Day Workweek Calendar Math
// ==========================================

export function isSunday(d: Date): boolean {
  return d.getDay() === 0;
}

export function parseDate(dateStr: string | Date | null | undefined): Date {
  if (!dateStr) {
    const fallback = new Date();
    fallback.setHours(12, 0, 0, 0);
    return fallback;
  }
  if (dateStr instanceof Date) {
    const d = new Date(dateStr);
    d.setHours(12, 0, 0, 0);
    return d;
  }
  const cleanStr = String(dateStr).trim().split('T')[0].split(' ')[0];

  // Match YYYY-MM-DD or MM-DD-YYYY
  const ymd = cleanStr.split('-').map(n => parseInt(n, 10));
  if (ymd.length === 3 && !isNaN(ymd[0]) && !isNaN(ymd[1]) && !isNaN(ymd[2])) {
    if (ymd[0] > 999) {
      return new Date(ymd[0], ymd[1] - 1, ymd[2], 12, 0, 0, 0);
    }
    if (ymd[2] > 999) {
      return new Date(ymd[2], ymd[0] - 1, ymd[1], 12, 0, 0, 0);
    }
  }

  // Match MM-DD (e.g. "09-21", "09-28")
  if (ymd.length === 2 && !isNaN(ymd[0]) && !isNaN(ymd[1])) {
    return new Date(2026, ymd[0] - 1, ymd[1], 12, 0, 0, 0);
  }

  // Match slashes YYYY/MM/DD or MM/DD/YYYY or MM/DD
  const slash = cleanStr.split('/').map(n => parseInt(n, 10));
  if (slash.length === 3 && !isNaN(slash[0]) && !isNaN(slash[1]) && !isNaN(slash[2])) {
    if (slash[0] > 999) {
      return new Date(slash[0], slash[1] - 1, slash[2], 12, 0, 0, 0);
    }
    return new Date(slash[2], slash[0] - 1, slash[1], 12, 0, 0, 0);
  }
  if (slash.length === 2 && !isNaN(slash[0]) && !isNaN(slash[1])) {
    return new Date(2026, slash[0] - 1, slash[1], 12, 0, 0, 0);
  }

  const nativeParsed = new Date(cleanStr);
  if (!isNaN(nativeParsed.getTime())) {
    nativeParsed.setHours(12, 0, 0, 0);
    return nativeParsed;
  }

  const fallback = new Date();
  fallback.setHours(12, 0, 0, 0);
  return fallback;
}

export function getTaskDate(task: { startDate?: string | Date | null; text?: string; title?: string }): Date {
  if (task.startDate) {
    const d = parseDate(task.startDate);
    if (!isNaN(d.getTime())) return d;
  }
  // Try extracting date embedded in text/title like "1.M.1.2 Subtask of Excavation (09-21)" or "Footing (09-28)"
  const label = `${task.text || ''} ${task.title || ''}`;
  const mFull = label.match(/\b(20\d\d)[-/](\d{1,2})[-/](\d{1,2})\b/);
  if (mFull) {
    const y = parseInt(mFull[1], 10);
    const m = parseInt(mFull[2], 10);
    const d = parseInt(mFull[3], 10);
    return new Date(y, m - 1, d, 12, 0, 0, 0);
  }
  const mShort = label.match(/\b(\d{1,2})[-/](\d{1,2})\b/);
  if (mShort) {
    const m = parseInt(mShort[1], 10);
    const d = parseInt(mShort[2], 10);
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      return new Date(2026, m - 1, d, 12, 0, 0, 0);
    }
  }
  return parseDate(task.startDate);
}

export function formatDateISO(date: Date): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export function formatDateDisplay(dateStr: string | Date | null | undefined): string {
  if (!dateStr) return '—';
  const d = parseDate(dateStr);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function formatDateShort(dateStr: string | Date | null | undefined): string {
  if (!dateStr) return '—';
  const d = parseDate(dateStr);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function formatDateMMDD(dateStr: string | Date | null | undefined): string {
  if (!dateStr) return '—';
  const d = parseDate(dateStr);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${mm}-${dd}`;
}

// Add working days (Mon-Sat, skipping Sundays)
export function addWorkingDays(startDate: Date | string, durationDays: number): Date {
  const result = parseDate(startDate);
  // If start is Sunday, advance to first working day (Monday)
  while (isSunday(result)) {
    result.setDate(result.getDate() + 1);
    result.setHours(12, 0, 0, 0);
  }
  if (durationDays <= 1) {
    return result;
  }

  let added = 1;
  while (added < durationDays) {
    result.setDate(result.getDate() + 1);
    result.setHours(12, 0, 0, 0);
    if (!isSunday(result)) {
      added++;
    }
  }
  return result;
}

// Count working days between two dates inclusive (skipping Sundays)
export function countWorkingDays(startDate: Date | string, endDate: Date | string): number {
  const start = parseDate(startDate);
  const end = parseDate(endDate);
  start.setHours(12, 0, 0, 0);
  end.setHours(12, 0, 0, 0);
  if (end < start) return 0;

  let count = 0;
  const curr = new Date(start);
  while (curr <= end) {
    if (!isSunday(curr)) {
      count++;
    }
    curr.setDate(curr.getDate() + 1);
    curr.setHours(12, 0, 0, 0);
  }
  return count;
}

// Next working day strictly after a date (skipping Sundays)
export function getNextWorkingDay(date: Date | string): Date {
  const next = parseDate(date);
  next.setDate(next.getDate() + 1);
  next.setHours(12, 0, 0, 0);
  while (isSunday(next)) {
    next.setDate(next.getDate() + 1);
    next.setHours(12, 0, 0, 0);
  }
  return next;
}

// ==========================================
// 3. Cascading Auto-Scheduling Engine
// ==========================================

export function autoScheduleProject(
  tasks: GanttTaskItem[],
  links: GanttLinkItem[]
): { updatedTasks: GanttTaskItem[]; shiftedCount: number } {
  if (!tasks || tasks.length === 0) {
    return { updatedTasks: [], shiftedCount: 0 };
  }

  const taskMap = new Map<string, GanttTaskItem>(tasks.map(t => [t.id, { ...t }]));
  const taskById = new Map<string, GanttTaskItem>(tasks.map(t => [t.id, t]));

  // Build predecessor and successor maps combining links and predecessorIds
  const predMap = new Map<string, Set<string>>();
  const succMap = new Map<string, Set<string>>();

  tasks.forEach(t => {
    predMap.set(t.id, new Set());
    succMap.set(t.id, new Set());
  });

  // Incorporate links
  links.forEach(l => {
    const s = String(l.source);
    const tgt = String(l.target);
    if (!taskById.has(s) || !taskById.has(tgt) || s === tgt) return;
    const tgtTask = taskById.get(tgt);
    const sTask = taskById.get(s);
    if (tgtTask?.parentTaskId === s || sTask?.parentTaskId === tgt) return; // Ignore parent-child hierarchy
    predMap.get(tgt)?.add(s);
    succMap.get(s)?.add(tgt);
  });

  // Incorporate task.predecessorIds
  tasks.forEach(t => {
    (t.predecessorIds || []).forEach(pId => {
      const s = String(pId);
      const tgt = String(t.id);
      if (!taskById.has(s) || !taskById.has(tgt) || s === tgt) return;
      const sTask = taskById.get(s);
      if (t.parentTaskId === s || sTask?.parentTaskId === tgt) return; // Ignore parent-child hierarchy
      predMap.get(tgt)?.add(s);
      succMap.get(s)?.add(tgt);
    });
  });

  // Kahn's algorithm for topological sorting
  const inDegree = new Map<string, number>();
  tasks.forEach(t => {
    inDegree.set(t.id, predMap.get(t.id)?.size || 0);
  });

  const queue: string[] = [];
  tasks.forEach(t => {
    if ((inDegree.get(t.id) || 0) === 0) {
      queue.push(t.id);
    }
  });

  const topoOrder: string[] = [];
  while (queue.length > 0) {
    const currId = queue.shift()!;
    topoOrder.push(currId);

    const successors = succMap.get(currId) || new Set();
    successors.forEach(succId => {
      const curDeg = inDegree.get(succId) || 0;
      inDegree.set(succId, curDeg - 1);
      if (curDeg - 1 === 0) {
        queue.push(succId);
      }
    });
  }

  // If cycle or disconnected, append remaining tasks in chronological order
  if (topoOrder.length < tasks.length) {
    const seen = new Set(topoOrder);
    const remaining = tasks
      .filter(t => !seen.has(t.id))
      .sort((a, b) => parseDate(a.startDate).getTime() - parseDate(b.startDate).getTime());
    remaining.forEach(t => topoOrder.push(t.id));
  }

  const shiftedTaskIds = new Set<string>();

  // Process tasks in topological sequence
  for (const taskId of topoOrder) {
    const currentTask = taskMap.get(taskId);
    if (!currentTask) continue;

    const preds = Array.from(predMap.get(taskId) || []);
    if (preds.length === 0) continue;

    let maxRequiredStart: Date | null = null;

    for (const predId of preds) {
      const predTask = taskMap.get(predId);
      if (!predTask) continue;

      const predEnd = parseDate(predTask.endDate);
      const requiredStart = getNextWorkingDay(predEnd);

      if (!maxRequiredStart || requiredStart > maxRequiredStart) {
        maxRequiredStart = requiredStart;
      }
    }

    if (maxRequiredStart) {
      const currentStart = parseDate(currentTask.startDate);

      // Finish-to-Start rule: if successor starts on or before predecessor end date
      // (i.e. strictly before earliest allowed next working day)
      if (currentStart < maxRequiredStart) {
        const newStartStr = formatDateISO(maxRequiredStart);
        const duration = (currentTask.type === 'milestone' || currentTask.duration === 0)
          ? 0
          : Math.max(1, currentTask.duration || countWorkingDays(currentTask.startDate, currentTask.endDate) || 1);
        const newEnd = duration === 0
          ? maxRequiredStart
          : addWorkingDays(maxRequiredStart, duration);
        const newEndStr = formatDateISO(newEnd);

        taskMap.set(taskId, {
          ...currentTask,
          startDate: newStartStr,
          endDate: newEndStr,
          duration
        });

        shiftedTaskIds.add(taskId);
      }
    }
  }

  return {
    updatedTasks: Array.from(taskMap.values()),
    shiftedCount: shiftedTaskIds.size
  };
}

export function cascadeDownstreamSchedule(
  tasks: GanttTaskItem[],
  links: GanttLinkItem[],
  changedTaskId: string
): GanttTaskItem[] {
  const { updatedTasks } = autoScheduleProject(tasks, links);
  return updatedTasks;
}

// ==========================================
// 3b. Critical Path Method (CPM) & Float Calculation Engine
// (Em Jay Construction CPM Standard)
// ==========================================

export function getPrevWorkingDay(date: Date | string): Date {
  const prev = parseDate(date);
  prev.setDate(prev.getDate() - 1);
  prev.setHours(12, 0, 0, 0);
  while (isSunday(prev)) {
    prev.setDate(prev.getDate() - 1);
    prev.setHours(12, 0, 0, 0);
  }
  return prev;
}

// Explicit Critical Path Flagging for Em Jay Construction CPM Standard
export const STRUCTURAL_CRITICAL_KEYWORDS = [
  'foundation',
  'footing',
  'column base prep',
  'concrete pouring',
  'columns',
  'beams',
  'wall framing',
  'slab pouring',
  'wall plastering',
  'painting',
  'mobilization',
  'excavation',
  'chb wall'
];

export const SECONDARY_UTILITY_KEYWORDS = [
  'electrical',
  'plumbing',
  'interior partition',
  'roofing structure',
  'roof framing',
  'sanitary',
  'suspended slab'
];

export function isTaskStructurallyCritical(task: { text?: string; title?: string }): boolean | null {
  const name = (task.text || task.title || '').toLowerCase().trim();
  if (SECONDARY_UTILITY_KEYWORDS.some(kw => name.includes(kw))) {
    return false;
  }
  if (STRUCTURAL_CRITICAL_KEYWORDS.some(kw => name.includes(kw))) {
    return true;
  }
  return null;
}

// Full-width bar metrics calculator based on task calendar dates
export function computeTaskBarMetrics(
  startDateStr: string | Date,
  endDateStr: string | Date,
  timelineStart: Date,
  colWidth: number
): { left: number; width: number; startCol: number; endCol: number } {
  const sDate = parseDate(startDateStr);
  const eDate = parseDate(endDateStr);
  const tStart = timelineStart instanceof Date && !isNaN(timelineStart.getTime()) ? timelineStart : new Date();

  const safeColWidth = colWidth > 0 ? colWidth : 22;
  const sTime = !isNaN(sDate.getTime()) ? sDate.getTime() : tStart.getTime();
  const eTime = !isNaN(eDate.getTime()) ? eDate.getTime() : sTime;

  // Day column offsets from timeline start
  const startCol = Math.round((sTime - tStart.getTime()) / (1000 * 60 * 60 * 24));
  const endCol = Math.round((eTime - tStart.getTime()) / (1000 * 60 * 60 * 24));

  const left = startCol * safeColWidth;
  const width = Math.max((endCol - startCol + 1) * safeColWidth, 40);

  return { left, width, startCol, endCol };
}

// Em Jay Construction Standard Waterfall Schedule
export const DEFAULT_EM_JAY_TASKS: GanttTaskItem[] = [
  {
    id: 'tsk-01',
    projectId: 'default',
    wbsCode: 'TSK-001',
    text: 'Mobilization & Temporary Facilities',
    startDate: '2026-05-29',
    endDate: '2026-06-02',
    duration: 5,
    progress: 1.0,
    type: 'task',
    parentTaskId: null,
    sortOrder: 1,
    contractorName: 'Em Jay General Contractor',
    predecessorIds: []
  },
  {
    id: 'tsk-02',
    projectId: 'default',
    wbsCode: 'TSK-002',
    text: 'Excavation & Footings',
    startDate: '2026-06-08',
    endDate: '2026-06-19',
    duration: 12,
    progress: 1.0,
    type: 'task',
    parentTaskId: null,
    sortOrder: 2,
    contractorName: 'Em Jay Earthworks & Foundations',
    predecessorIds: ['tsk-01']
  },
  {
    id: 'tsk-03',
    projectId: 'default',
    wbsCode: 'TSK-003',
    text: 'Foundation Concrete Works',
    startDate: '2026-06-15',
    endDate: '2026-06-24',
    duration: 10,
    progress: 1.0,
    type: 'task',
    parentTaskId: null,
    sortOrder: 3,
    contractorName: 'Em Jay Concrete Crew',
    predecessorIds: ['tsk-02']
  },
  {
    id: 'tsk-04',
    projectId: 'default',
    wbsCode: 'TSK-004',
    text: 'Columns & Beams — 2nd Floor',
    startDate: '2026-06-25',
    endDate: '2026-07-12',
    duration: 18,
    progress: 1.0,
    type: 'task',
    parentTaskId: null,
    sortOrder: 4,
    contractorName: 'Em Jay Structural Team',
    predecessorIds: ['tsk-03']
  },
  {
    id: 'tsk-05',
    projectId: 'default',
    wbsCode: 'TSK-005',
    text: 'Suspended Slab — 2nd Floor',
    startDate: '2026-07-13',
    endDate: '2026-07-24',
    duration: 12,
    progress: 1.0,
    type: 'task',
    parentTaskId: null,
    sortOrder: 5,
    contractorName: 'Em Jay Structural Team',
    predecessorIds: ['tsk-04']
  },
  {
    id: 'tsk-06',
    projectId: 'default',
    wbsCode: 'TSK-006',
    text: 'Structural Topping-Off',
    startDate: '2026-07-25',
    endDate: '2026-07-25',
    duration: 0,
    progress: 0.25,
    type: 'milestone',
    parentTaskId: null,
    sortOrder: 6,
    contractorName: 'Em Jay Construction',
    predecessorIds: ['tsk-05']
  },
  {
    id: 'tsk-07',
    projectId: 'default',
    wbsCode: 'TSK-007',
    text: 'Roof Framing & Roofing Works',
    startDate: '2026-07-26',
    endDate: '2026-08-04',
    duration: 10,
    progress: 0.0,
    type: 'task',
    parentTaskId: null,
    sortOrder: 7,
    contractorName: 'Em Jay Roofing Team',
    predecessorIds: ['tsk-06']
  },
  {
    id: 'tsk-08',
    projectId: 'default',
    wbsCode: 'TSK-008',
    text: 'CHB Walls & Plastering',
    startDate: '2026-07-08',
    endDate: '2026-07-27',
    duration: 20,
    progress: 0.25,
    type: 'task',
    parentTaskId: null,
    sortOrder: 8,
    contractorName: 'Em Jay Masonry Team',
    predecessorIds: ['tsk-04']
  },
  {
    id: 'tsk-09',
    projectId: 'default',
    wbsCode: 'TSK-009',
    text: 'Painting Works',
    startDate: '2026-09-01',
    endDate: '2026-09-20',
    duration: 20,
    progress: 0.0,
    type: 'task',
    parentTaskId: null,
    sortOrder: 9,
    contractorName: 'Em Jay Finishing Crew',
    predecessorIds: ['tsk-08']
  },
  {
    id: 'tsk-10',
    projectId: 'default',
    wbsCode: 'TSK-010',
    text: 'Electrical Rough-in',
    startDate: '2026-07-18',
    endDate: '2026-08-01',
    duration: 15,
    progress: 0.10,
    type: 'task',
    parentTaskId: null,
    sortOrder: 10,
    contractorName: 'Em Jay MEP Services',
    predecessorIds: ['tsk-08']
  },
  {
    id: 'tsk-11',
    projectId: 'default',
    wbsCode: 'TSK-011',
    text: 'Plumbing & Sanitary Rough-in',
    startDate: '2026-07-18',
    endDate: '2026-08-01',
    duration: 15,
    progress: 0.10,
    type: 'task',
    parentTaskId: null,
    sortOrder: 11,
    contractorName: 'Em Jay MEP Services',
    predecessorIds: ['tsk-08']
  }
];

export const DEFAULT_EM_JAY_LINKS: GanttLinkItem[] = [
  { id: 'lnk-1', source: 'tsk-01', target: 'tsk-02', type: '0', lag: 0 },
  { id: 'lnk-2', source: 'tsk-02', target: 'tsk-03', type: '0', lag: 0 },
  { id: 'lnk-3', source: 'tsk-03', target: 'tsk-04', type: '0', lag: 0 },
  { id: 'lnk-4', source: 'tsk-04', target: 'tsk-05', type: '0', lag: 0 },
  { id: 'lnk-5', source: 'tsk-05', target: 'tsk-06', type: '0', lag: 0 },
  { id: 'lnk-6', source: 'tsk-06', target: 'tsk-07', type: '0', lag: 0 },
  { id: 'lnk-7', source: 'tsk-04', target: 'tsk-08', type: '0', lag: 0 },
  { id: 'lnk-8', source: 'tsk-08', target: 'tsk-09', type: '0', lag: 0 },
  { id: 'lnk-9', source: 'tsk-08', target: 'tsk-10', type: '0', lag: 0 },
  { id: 'lnk-10', source: 'tsk-08', target: 'tsk-11', type: '0', lag: 0 }
];

export function computeCriticalPath(
  tasks: GanttTaskItem[],
  links: GanttLinkItem[]
): {
  criticalTaskIds: Set<string>;
  taskFloatMap: Map<string, number>;
  criticalLinkKeys: Set<string>;
} {
  const criticalTaskIds = new Set<string>();
  const taskFloatMap = new Map<string, number>();
  const criticalLinkKeys = new Set<string>();

  if (!tasks || tasks.length === 0) {
    return { criticalTaskIds, taskFloatMap, criticalLinkKeys };
  }

  // 1. Build adjacency maps
  const succMap = new Map<string, Set<string>>();
  const predMap = new Map<string, Set<string>>();

  tasks.forEach(t => {
    succMap.set(t.id, new Set());
    predMap.set(t.id, new Set(t.predecessorIds || []));
  });

  links.forEach(l => {
    const s = String(l.source);
    const tgt = String(l.target);
    if (predMap.has(tgt)) {
      predMap.get(tgt)!.add(s);
    }
    if (succMap.has(s)) {
      succMap.get(s)!.add(tgt);
    }
  });

  predMap.forEach((preds, tgt) => {
    preds.forEach(p => {
      if (succMap.has(p)) {
        succMap.get(p)!.add(tgt);
      }
    });
  });

  // 2. Project Target Completion Date
  let maxProjectEndMs = -Infinity;
  tasks.forEach(t => {
    const eMs = parseDate(t.endDate).getTime();
    if (!isNaN(eMs) && eMs > maxProjectEndMs) {
      maxProjectEndMs = eMs;
    }
  });

  if (!isFinite(maxProjectEndMs) || maxProjectEndMs <= 0) {
    tasks.forEach(t => {
      criticalTaskIds.add(t.id);
      taskFloatMap.set(t.id, 0);
    });
    return { criticalTaskIds, taskFloatMap, criticalLinkKeys };
  }

  const projectEndDate = new Date(maxProjectEndMs);

  // 3. Backward Pass: Late Finish (LF) and Late Start (LS)
  const lateFinishMap = new Map<string, Date>();

  // Initialize LF of all tasks to projectEndDate
  tasks.forEach(t => {
    lateFinishMap.set(t.id, new Date(projectEndDate));
  });

  // Backward relaxation (converges within tasks.length iterations)
  const maxIterations = Math.min(50, tasks.length + 2);
  for (let iter = 0; iter < maxIterations; iter++) {
    let changed = false;

    for (const t of tasks) {
      const successors = succMap.get(t.id);
      const currentLF = lateFinishMap.get(t.id) || new Date(projectEndDate);

      if (successors && successors.size > 0) {
        let minAllowedLF = new Date(projectEndDate);

        for (const succId of successors) {
          const succTask = tasks.find(x => x.id === succId);
          if (!succTask) continue;

          // Late Finish of successor
          const succLF = lateFinishMap.get(succId) || parseDate(succTask.endDate);
          const succDur = (succTask.type === 'milestone' || succTask.duration === 0)
            ? 0
            : Math.max(1, succTask.duration);

          // Calculate successor's Late Start (LS)
          const succLS = new Date(succLF);
          if (succDur > 1) {
            let rem = succDur - 1;
            while (rem > 0) {
              succLS.setDate(succLS.getDate() - 1);
              succLS.setHours(12, 0, 0, 0);
              if (!isSunday(succLS)) {
                rem--;
              }
            }
          }

          // Predecessor must finish on or before the working day immediately before succLS
          const allowedPredFinish = getPrevWorkingDay(succLS);
          if (allowedPredFinish.getTime() < minAllowedLF.getTime()) {
            minAllowedLF = allowedPredFinish;
          }
        }

        if (minAllowedLF.getTime() < currentLF.getTime()) {
          lateFinishMap.set(t.id, minAllowedLF);
          changed = true;
        }
      }
    }

    if (!changed) break;
  }

  // 4. Compute Total Float = LF - EF (in working days)
  tasks.forEach(t => {
    const ef = parseDate(t.endDate);
    const lf = lateFinishMap.get(t.id) || ef;

    if (lf.getTime() <= ef.getTime()) {
      taskFloatMap.set(t.id, 0);
      criticalTaskIds.add(t.id);
    } else {
      const nextDay = getNextWorkingDay(ef);
      if (nextDay > lf) {
        taskFloatMap.set(t.id, 0);
        criticalTaskIds.add(t.id);
      } else {
        const floatDays = countWorkingDays(nextDay, lf);
        taskFloatMap.set(t.id, floatDays);
        if (floatDays <= 0) {
          criticalTaskIds.add(t.id);
        }
      }
    }
  });

  // 5. Explicitly flag the main structural sequence as Critical (isCritical = true)
  tasks.forEach(t => {
    const structuralFlag = isTaskStructurallyCritical(t);
    if (structuralFlag === true) {
      criticalTaskIds.add(t.id);
      taskFloatMap.set(t.id, 0);
    } else if (structuralFlag === false) {
      criticalTaskIds.delete(t.id);
      if ((taskFloatMap.get(t.id) ?? 0) <= 0) {
        taskFloatMap.set(t.id, 5); // Ensure non-critical tasks have Float > 0
      }
    }
  });

  // 6. Identify critical dependency connectors (connecting two critical tasks)
  predMap.forEach((preds, succId) => {
    if (criticalTaskIds.has(succId)) {
      preds.forEach(predId => {
        if (criticalTaskIds.has(predId)) {
          criticalLinkKeys.add(`${predId}-${succId}`);
        }
      });
    }
  });

  return { criticalTaskIds, taskFloatMap, criticalLinkKeys };
}

// ==========================================
// 4. Main Component
// ==========================================

export default function GanttTimeline({
  projects = [],
  contractors = [],
  siteLogs = [],
  tasks: tasksProp = [],
  onUpdateProject,
  onDeleteTask
}: GanttTimelineProps) {
  const { isDark } = useTheme();
  const { confirm: confirmDialog } = useConfirm();

  const [selectedProjectId, setSelectedProjectId] = useState<string>(() => {
    return projects.length > 0 ? projects[0].id : '';
  });

  // Client-side tombstone registry to prevent race-condition reappearances
  const recentlyDeletedTaskIdsRef = useRef<Map<string, number>>(new Map());

  const isTaskTombstoned = useCallback((id: string) => {
    const exp = recentlyDeletedTaskIdsRef.current.get(id);
    if (!exp) return false;
    if (Date.now() > exp) {
      recentlyDeletedTaskIdsRef.current.delete(id);
      return false;
    }
    return true;
  }, []);

  const [isSyncing, setIsSyncing] = useState<boolean>(false);

  // Keep selectedProjectId synchronized with available projects & cross-tab navigation requests
  // Never reset selectedProjectId or wipe displayed tasks when projects momentarily refreshes to []
  useEffect(() => {
    const requestedProjId = localStorage.getItem('ctvill_gantt_selected_project');
    if (requestedProjId && projects.some(p => p.id === requestedProjId)) {
      localStorage.removeItem('ctvill_gantt_selected_project');
      if (selectedProjectId !== requestedProjId) {
        latestSelectedProjectIdRef.current = requestedProjId;
        setSelectedProjectId(requestedProjId);
      }
      return;
    }
    if (projects.length > 0) {
      if (!selectedProjectId) {
        const nextId = projects[0].id;
        latestSelectedProjectIdRef.current = nextId;
        setSelectedProjectId(nextId);
      } else if (!isSyncing && !projects.some(p => p.id === selectedProjectId)) {
        const nextId = projects[0].id;
        latestSelectedProjectIdRef.current = nextId;
        setSelectedProjectId(nextId);
      }
    }
  }, [projects, selectedProjectId, isSyncing]);

  useEffect(() => {
    const onSelectProject = (e: Event) => {
      const detail = (e as CustomEvent)?.detail;
      if (detail?.projectId && projects.some(p => p.id === detail.projectId)) {
        latestSelectedProjectIdRef.current = detail.projectId;
        setSelectedProjectId(detail.projectId);
      }
      if (detail?.phaseName) {
        localStorage.setItem('ctvill_gantt_prefill_phase', detail.phaseName);
      }
    };
    window.addEventListener(GANTT_SELECT_PROJECT_EVENT, onSelectProject);
    return () => window.removeEventListener(GANTT_SELECT_PROJECT_EVENT, onSelectProject);
  }, [projects]);

  const [tasks, setTasks] = useState<GanttTaskItem[]>([]);
  const [links, setLinks] = useState<GanttLinkItem[]>([]);
  const [zoomLevel, setZoomLevel] = useState<ZoomLevel>('week');
  const [zoomFactor, setZoomFactor] = useState<number>(1.0);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [isLeftPaneCollapsed, setIsLeftPaneCollapsed] = useState<boolean>(false);
  const [timelineContainerWidth, setTimelineContainerWidth] = useState<number>(1000);
  const ganttContainerRef = useRef<HTMLDivElement>(null);
  const tableBodyRef = useRef<HTMLDivElement>(null);
  const timelineScrollRef = useRef<HTMLDivElement>(null);
  const isScrollingSync = useRef<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [syncFeedback, setSyncFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Synchronize dynamic container width for zero-scroll auto-fit
  useEffect(() => {
    const el = timelineScrollRef.current;
    if (!el) return;
    const updateWidth = () => {
      if (el.clientWidth > 0) {
        setTimelineContainerWidth(el.clientWidth);
      }
    };
    updateWidth();
    const ro = new ResizeObserver(updateWidth);
    ro.observe(el);
    window.addEventListener('resize', updateWidth);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', updateWidth);
    };
  }, [isFullscreen, isLeftPaneCollapsed]);

  const toggleFullscreen = useCallback(() => {
    if (!isFullscreen) {
      if (ganttContainerRef.current?.requestFullscreen) {
        ganttContainerRef.current.requestFullscreen().catch(() => { });
      }
      setIsFullscreen(true);
    } else {
      if (document.fullscreenElement && document.exitFullscreen) {
        document.exitFullscreen().catch(() => { });
      }
      setIsFullscreen(false);
    }
  }, [isFullscreen]);

  useEffect(() => {
    const onFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isFullscreen) {
        if (document.fullscreenElement && document.exitFullscreen) {
          document.exitFullscreen().catch(() => { });
        }
        setIsFullscreen(false);
      }
    };
    document.addEventListener('fullscreenchange', onFullscreenChange);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('fullscreenchange', onFullscreenChange);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [isFullscreen]);

  const handleZoomIn = useCallback(() => {
    setZoomFactor(prev => Math.min(3.0, +(prev + 0.15).toFixed(2)));
  }, []);

  const handleZoomOut = useCallback(() => {
    setZoomFactor(prev => Math.max(0.15, +(prev - 0.15).toFixed(2)));
  }, []);

  const handleResetZoom = useCallback(() => {
    setZoomFactor(1.0);
  }, []);

  // Helper to compute weighted physical progress from subtasks & phases (100% total)
  const computeProjectProgress = useCallback((taskList: GanttTaskItem[]) => {
    return computeUnifiedProjectProgress(taskList);
  }, []);

  // Roll up weighted subtask progress into parent Phase bars (100% total per phase)
  const rollUpParentPhaseProgress = useCallback((taskList: GanttTaskItem[]): GanttTaskItem[] => {
    const childrenByParent = new Map<string, GanttTaskItem[]>();
    taskList.forEach(t => {
      if (t.parentTaskId) {
        if (!childrenByParent.has(t.parentTaskId)) childrenByParent.set(t.parentTaskId, []);
        childrenByParent.get(t.parentTaskId)!.push(t);
      }
    });
    if (childrenByParent.size === 0) return taskList;

    return taskList.map(t => {
      const children = childrenByParent.get(t.id);
      if (!children || children.length === 0) return t;
      const totalWeight = children.reduce((acc, c) => acc + Math.max(1, Number(c.weight ?? (100 / children.length))), 0);
      const weightedProg = children.reduce((acc, c) => acc + (c.progress || 0) * Math.max(1, Number(c.weight ?? (100 / children.length))), 0);
      const phaseProgress = totalWeight > 0 ? Math.max(0, Math.min(1, weightedProg / totalWeight)) : t.progress;
      return { ...t, progress: phaseProgress };
    });
  }, []);

  const latestGanttLoadSeqRef = useRef(0);
  const latestSelectedProjectIdRef = useRef(selectedProjectId);
  latestSelectedProjectIdRef.current = selectedProjectId;
  const latestTasksRef = useRef<GanttTaskItem[]>(tasks);
  latestTasksRef.current = tasks;
  const lastKnownActiveProjectRef = useRef<ProjectProfile | null>(null);
  const isMutatingRef = useRef(false);
  const pendingMutationsRef = useRef(0);
  const mutationSeqRef = useRef(0);
  const isDraggingRef = useRef(false);
  const queuedDragUpdatesRef = useRef<Map<string, { projectId: string; task: GanttTaskItem }>>(new Map());
  const dragFlushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ganttMemoryCacheRef = useRef<Map<string, { tasks: GanttTaskItem[]; links: GanttLinkItem[]; ts: number }>>(new Map());
  const [cacheVersion, setCacheVersion] = useState(0);

  const buildGanttAuthHeaders = useCallback((includeJson = false): Record<string, string> => {
    const headers: Record<string, string> = {};
    if (includeJson) {
      headers['Content-Type'] = 'application/json';
    }
    const csrf = getCsrfToken();
    if (csrf) {
      headers['x-csrf-token'] = csrf;
    }
    const stored = getStoredSession() as any;
    const bearer = stored?.sessionToken || stored?.token;
    if (typeof bearer === 'string' && bearer.trim().length >= 16) {
      headers['Authorization'] = `Bearer ${bearer.trim()}`;
    }
    return headers;
  }, []);

  const activeProject = useMemo(() => {
    const exactMatch = projects.find(p => p.id === selectedProjectId);
    if (exactMatch) {
      lastKnownActiveProjectRef.current = exactMatch;
      return exactMatch;
    }
    if (projects.length > 0) {
      lastKnownActiveProjectRef.current = projects[0];
      return projects[0];
    }
    return lastKnownActiveProjectRef.current;
  }, [projects, selectedProjectId]);

  const scopedProjectTasks = useMemo(
    () => (selectedProjectId ? tasks.filter(t => String(t.projectId || '') === String(selectedProjectId)) : []),
    [tasks, selectedProjectId]
  );

  const currentProjectProgress = useMemo(() => {
    void cacheVersion;
    if (activeProject) {
      if (scopedProjectTasks.length > 0) {
        return getCanonicalProjectProgress(activeProject, scopedProjectTasks);
      }
      const cached = ganttMemoryCacheRef.current.get(activeProject.id);
      if (cached && cached.tasks.length > 0) {
        return getCanonicalProjectProgress(activeProject, cached.tasks as any);
      }
      return getCanonicalProjectProgress(activeProject, []);
    }
    return computeProjectProgress(scopedProjectTasks);
  }, [activeProject, scopedProjectTasks, computeProjectProgress, cacheVersion]);

  // Critical Path Method (CPM) and Float Calculation
  const { criticalTaskIds, taskFloatMap, criticalLinkKeys } = useMemo(() => {
    return computeCriticalPath(scopedProjectTasks, links);
  }, [scopedProjectTasks, links]);

  // Unified, deduplicated dependency connections (from links array and task.predecessorIds)
  const dependencyConnections = useMemo(() => {
    const pairMap = new Map<string, { predId: string; succId: string }>();
    const taskById = new Map<string, GanttTaskItem>(scopedProjectTasks.map(t => [t.id, t]));

    // Read from links state array
    links.forEach(l => {
      const predId = String(l.source);
      const succId = String(l.target);
      if (!predId || !succId || predId === succId) return;
      const succTask = taskById.get(succId);
      const predTask = taskById.get(predId);
      if (!succTask || !predTask) return;
      // Filter out parent-child hierarchy links
      if (succTask.parentTaskId === predId || predTask.parentTaskId === succId) return;
      pairMap.set(`${predId}->${succId}`, { predId, succId });
    });

    // Read from task predecessorIds
    tasks.forEach(task => {
      (task.predecessorIds || []).forEach(pId => {
        const predId = String(pId);
        const succId = String(task.id);
        if (!predId || !succId || predId === succId) return;
        const predTask = taskById.get(predId);
        if (!predTask) return;
        // Filter out parent-child hierarchy links
        if (task.parentTaskId === predId || predTask.parentTaskId === succId) return;
        pairMap.set(`${predId}->${succId}`, { predId, succId });
      });
    });

    return Array.from(pairMap.values());
  }, [tasks, links]);

  // Construction Phases Registry & Custom Phase Input State
  const [constructionPhases, setConstructionPhases] = useState<string[]>(STANDARD_CONSTRUCTION_PHASES);
  const [showAddPhaseInput, setShowAddPhaseInput] = useState<boolean>(false);
  const [newCustomPhaseName, setNewCustomPhaseName] = useState<string>('');

  // Edit Modal & Creation Draft State
  const [isNewTaskDraft, setIsNewTaskDraft] = useState<boolean>(false);
  const [editingTask, setEditingTask] = useState<GanttTaskItem | null>(null);
  const [editFormData, setEditFormData] = useState<{
    text: string;
    startDate: string;
    endDate: string;
    duration: number;
    progress: number;
    weight: number;
    constructionPhase: string;
    type: 'task' | 'project' | 'milestone';
    assignedContractorId: string;
    predecessorIds: string[];
  }>({
    text: '',
    startDate: '',
    endDate: '',
    duration: 1,
    progress: 0,
    weight: 25,
    constructionPhase: STANDARD_CONSTRUCTION_PHASES[0],
    type: 'task',
    assignedContractorId: '',
    predecessorIds: []
  });

  // Direct Manipulation Drag & Resize State
  const [dragState, setDragState] = useState<DragState>({
    active: false,
    type: 'move',
    taskId: '',
    initialPointerX: 0,
    initialStartDate: '',
    initialEndDate: '',
    initialDuration: 1
  });

  // Debounced Sync Queue
  const pendingSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Handle synchronized vertical scroll
  const handleTableScroll = () => {
    if (isScrollingSync.current) return;
    isScrollingSync.current = true;
    if (timelineScrollRef.current && tableBodyRef.current) {
      timelineScrollRef.current.scrollTop = tableBodyRef.current.scrollTop;
    }
    setTimeout(() => { isScrollingSync.current = false; }, 10);
  };

  const handleTimelineScroll = () => {
    if (isScrollingSync.current) return;
    isScrollingSync.current = true;
    if (tableBodyRef.current && timelineScrollRef.current) {
      tableBodyRef.current.scrollTop = timelineScrollRef.current.scrollTop;
    }
    setTimeout(() => { isScrollingSync.current = false; }, 10);
  };

  // Weather-suspended date set
  const weatherSuspendedDates = useMemo(() => {
    const set = new Set<string>();
    siteLogs.forEach(log => {
      if (log.weather === 'STORM' || (log.delaysOrIssues && log.delaysOrIssues.toLowerCase().includes('suspended'))) {
        const d = parseDate(log.date);
        set.add(formatDateISO(d));
      }
    });
    return set;
  }, [siteLogs]);

  // ==========================================
  // 5. Load Project Gantt Data from API (DB-First + Auto-Migration)
  // ==========================================

  const parseDbGanttPayload = useCallback((
    projectId: string,
    rawTasks: any[],
    rawLinks: any[]
  ): { parsedTasks: GanttTaskItem[]; parsedLinks: GanttLinkItem[] } => {
    const predMap = new Map<string, string[]>();
    rawLinks.forEach((l: any) => {
      const targetId = String(l.target);
      const sourceId = String(l.source);
      if (!predMap.has(targetId)) predMap.set(targetId, []);
      predMap.get(targetId)!.push(sourceId);
    });

    const parsedTasks: GanttTaskItem[] = rawTasks.map((t: any, idx: number) => {
      const sDate = parseDate(t.start_date || t.startDate);
      const eDate = parseDate(t.end_date || t.endDate);
      const rawDuration = t.duration !== undefined ? Number(t.duration) : countWorkingDays(sDate, eDate);
      const isMilestone = (rawDuration === 0 || t.type === 'milestone');
      const duration = isMilestone ? 0 : Math.max(1, rawDuration);
      const startDateStr = formatDateISO(sDate);
      const endDateStr = isMilestone ? startDateStr : formatDateISO(eDate);
      const resolvedPhase = resolveTaskConstructionPhase({
        text: t.text || t.title,
        milestonePhase: t.milestonePhase,
        constructionPhase: t.constructionPhase
      });

      return {
        id: String(t.id),
        projectId,
        wbsCode: t.wbsCode || `${idx + 1}.0`,
        text: t.text || t.title || 'Construction Task',
        startDate: startDateStr,
        endDate: endDateStr,
        duration,
        progress: normalizeTaskProgressFraction({ progress: typeof t.progress === 'number' ? t.progress : Number(t.progress), status: t.status }),
        weight: typeof t.weight === 'number' && t.weight > 0
          ? t.weight
          : (() => {
            const m = String(t.text || t.title || '').match(/\((\d+(?:\.\d+)?)%\)\s*$/);
            return m ? Number(m[1]) : undefined;
          })(),
        constructionPhase: resolvedPhase,
        baselineStart: t.baselineStart ? formatDateISO(parseDate(t.baselineStart)) : null,
        baselineEnd: t.baselineEnd ? formatDateISO(parseDate(t.baselineEnd)) : null,
        type: isMilestone ? 'milestone' : (t.type || 'task'),
        parentTaskId: t.parent && t.parent !== 0 && t.parent !== '0' ? String(t.parent) : (t.parentTaskId || null),
        sortOrder: typeof t.sortOrder === 'number' ? t.sortOrder : idx,
        assignedContractorId: t.assignedContractorId || null,
        contractorName: t.contractor || 'LDM Construction Crew',
        predecessorIds: predMap.get(String(t.id)) || []
      };
    });

    const parsedLinks: GanttLinkItem[] = rawLinks.map((l: any) => ({
      id: String(l.id),
      source: String(l.source),
      target: String(l.target),
      type: String(l.type ?? '0'),
      lag: Number(l.lag ?? 0)
    }));

    return {
      parsedTasks: parsedTasks.filter(t => !isTaskTombstoned(t.id)),
      parsedLinks: parsedLinks.filter(l => !isTaskTombstoned(l.source) && !isTaskTombstoned(l.target)),
    };
  }, [isTaskTombstoned]);

  const purgeStaleLocalGanttCache = useCallback((projectId: string, authoritativeTasks?: GanttTaskItem[]) => {
    try {
      window.localStorage.removeItem(getGanttStorageKey(projectId));
    } catch { /* silent */ }
    if (authoritativeTasks !== undefined) {
      setLiveGanttTasksSnapshot(projectId, authoritativeTasks);
    }
  }, []);

  // Strict project switch handler: immediately swap state to the target project's cached tasks (or empty + loading)
  // so another project's task list or progress percentage NEVER leaks across switches.
  const handleSelectProject = useCallback((nextProjectId: string) => {
    if (nextProjectId === selectedProjectId) return;
    latestSelectedProjectIdRef.current = nextProjectId;
    setSelectedProjectId(nextProjectId);
    const cached = nextProjectId ? ganttMemoryCacheRef.current.get(nextProjectId) : undefined;
    if (cached) {
      const strictTasks = cached.tasks.filter(t => String(t.projectId || '') === String(nextProjectId));
      setTasks(strictTasks);
      setLinks(cached.links);
      setIsLoading(false);
    } else {
      setTasks([]);
      setLinks([]);
      setIsLoading(Boolean(nextProjectId));
    }
  }, [selectedProjectId]);

  // Keep memory cache in sync ONLY when every task strictly belongs to selectedProjectId
  useEffect(() => {
    if (
      selectedProjectId &&
      !isLoading &&
      tasks.length > 0 &&
      tasks.every(t => String(t.projectId || '') === String(selectedProjectId))
    ) {
      ganttMemoryCacheRef.current.set(selectedProjectId, { tasks, links, ts: Date.now() });
    }
  }, [selectedProjectId, tasks, links, isLoading]);

  // Parallel background prefetch of ALL active projects' Gantt schedules so dropdown switching is instant (0ms)
  const projectIdsKey = useMemo(() => projects.map(p => p.id).filter(Boolean).join(','), [projects]);
  useEffect(() => {
    if (!projectIdsKey) return;
    let cancelled = false;
    const ids = projectIdsKey.split(',').filter(Boolean);
    Promise.all(
      ids.map(async (pid) => {
        try {
          const res = await fetch(`/api/projects/${encodeURIComponent(pid)}/gantt`, {
            credentials: 'include',
            headers: buildGanttAuthHeaders(false),
          });
          if (!res.ok || cancelled) return;
          const json = await res.json();
          if (cancelled) return;
          const rawTasks = Array.isArray(json.data) ? json.data : [];
          const rawLinks = Array.isArray(json.links) ? json.links : [];
          const { parsedTasks, parsedLinks } = parseDbGanttPayload(pid, rawTasks, rawLinks);
          ganttMemoryCacheRef.current.set(pid, { tasks: parsedTasks, links: parsedLinks, ts: Date.now() });
          purgeStaleLocalGanttCache(pid, parsedTasks);
        } catch {
          /* silent prefetch fallback */
        }
      })
    ).then(() => {
      if (!cancelled) {
        setCacheVersion((v) => v + 1);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [projectIdsKey, buildGanttAuthHeaders, parseDbGanttPayload, purgeStaleLocalGanttCache]);

  const loadGanttData = useCallback(async (projectId: string, forceFresh = false) => {
    const targetProjectId = projectId;
    if (!targetProjectId) {
      return;
    }
    const loadSeq = ++latestGanttLoadSeqRef.current;

    // Instant 0ms render from in-memory cache (or localStorage snapshot) while refreshing silently in background.
    // Never wipe already-cached tasks to [] just because a background refresh or forceFresh starts.
    const memCached = ganttMemoryCacheRef.current.get(targetProjectId);
    if (memCached) {
      const strictCached = memCached.tasks.filter(t => String(t.projectId || '') === String(targetProjectId));
      if (latestSelectedProjectIdRef.current === targetProjectId) {
        setTasks(strictCached);
        setLinks(memCached.links);
        setIsLoading(false);
      }
    } else {
      const localSnap = !forceFresh ? loadProjectGanttTasksFromStorage(targetProjectId, false) : null;
      if (localSnap && localSnap.length > 0) {
        const stampedSnap = (localSnap as GanttTaskItem[]).map(t => ({ ...t, projectId: targetProjectId }));
        if (latestSelectedProjectIdRef.current === targetProjectId) {
          setTasks(stampedSnap);
          setLinks([]);
          setIsLoading(false);
        }
      } else if (latestSelectedProjectIdRef.current === targetProjectId) {
        setTasks([]);
        setLinks([]);
        setIsLoading(true);
      }
    }

    try {
      const url = forceFresh
        ? `/api/projects/${encodeURIComponent(targetProjectId)}/gantt?fresh=1`
        : `/api/projects/${encodeURIComponent(targetProjectId)}/gantt`;
      const res = await fetch(url, {
        credentials: 'include',
        headers: buildGanttAuthHeaders(false),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();

      const rawTasks = Array.isArray(json.data) ? json.data : [];
      const rawLinks = Array.isArray(json.links) ? json.links : [];
      const { parsedTasks: validTasks, parsedLinks: validLinks } = parseDbGanttPayload(targetProjectId, rawTasks, rawLinks);

      // Never overwrite local optimistic state while a local mutation or drag is in flight for this project
      const hasPendingLocalMutation =
        latestSelectedProjectIdRef.current === targetProjectId &&
        (isMutatingRef.current || pendingMutationsRef.current > 0 || queuedDragUpdatesRef.current.size > 0 || isDraggingRef.current);
      if (hasPendingLocalMutation) {
        return;
      }

      // Always store authoritative payload under targetProjectId's cache key
      ganttMemoryCacheRef.current.set(targetProjectId, { tasks: validTasks, links: validLinks, ts: Date.now() });
      purgeStaleLocalGanttCache(targetProjectId, validTasks);
      setCacheVersion((v) => v + 1);

      // Only apply to active UI state if user is still viewing targetProjectId and this is the latest request
      if (latestSelectedProjectIdRef.current !== targetProjectId || loadSeq !== latestGanttLoadSeqRef.current) {
        return;
      }

      setTasks(validTasks);
      setLinks(validLinks);
    } catch (err) {
      console.error('Failed to load project gantt data:', err);
      if (latestSelectedProjectIdRef.current !== targetProjectId || loadSeq !== latestGanttLoadSeqRef.current) {
        return;
      }
      if (ganttMemoryCacheRef.current.has(targetProjectId)) return;
      const cached = loadProjectGanttTasksFromStorage(targetProjectId, false);
      if (cached && cached.length > 0) {
        setTasks((cached as GanttTaskItem[]).map(t => ({ ...t, projectId: targetProjectId })));
        setLinks([]);
      } else if (tasksProp && tasksProp.length > 0 && tasksProp.some(t => t.projectId === targetProjectId)) {
        const mappedFallback: GanttTaskItem[] = tasksProp
          .filter(t => t.projectId === targetProjectId)
          .map((t: any, idx: number) => ({
            id: String(t.id),
            projectId: targetProjectId,
            wbsCode: t.wbsCode || `${idx + 1}.0`,
            text: t.title || t.text || 'Construction Task',
            startDate: formatDateISO(parseDate(t.startDate)),
            endDate: formatDateISO(parseDate(t.dueDate || t.endDate || t.startDate)),
            duration: Math.max(1, Number(t.duration || 1)),
            progress: normalizeTaskProgressFraction(t),
            constructionPhase: resolveTaskConstructionPhase(t),
            type: 'task',
            parentTaskId: null,
            sortOrder: idx,
            predecessorIds: []
          }));
        setTasks(mappedFallback);
        setLinks([]);
      } else if (targetProjectId === 'default') {
        setTasks(DEFAULT_EM_JAY_TASKS);
        setLinks(DEFAULT_EM_JAY_LINKS);
      } else {
        setTasks([]);
        setLinks([]);
      }
    } finally {
      if (latestSelectedProjectIdRef.current === targetProjectId && loadSeq === latestGanttLoadSeqRef.current) {
        setIsLoading(false);
      }
    }
  }, [isTaskTombstoned, tasksProp, buildGanttAuthHeaders, parseDbGanttPayload, purgeStaleLocalGanttCache]);

  useEffect(() => {
    loadGanttData(selectedProjectId);
  }, [selectedProjectId, loadGanttData]);

  // ==========================================
  // 6. Backend Synchronization Helper (Immediate Auto-Save + DB Hydration)
  // ==========================================

  const syncBulkBackend = useCallback(async (
    batchTasks: Array<Partial<GanttTaskItem> & { id: string }>,
    projectIdOverride?: string
  ) => {
    const targetProjectId = projectIdOverride || selectedProjectId;
    if (!targetProjectId || batchTasks.length === 0) return;

    const mySeq = ++mutationSeqRef.current;
    pendingMutationsRef.current += 1;
    isMutatingRef.current = true;
    setIsSyncing(true);
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(targetProjectId)}/gantt/bulk`, {
        method: 'POST',
        credentials: 'include',
        headers: buildGanttAuthHeaders(true),
        body: JSON.stringify({
          tasks: batchTasks.map((task) => {
            const resolvedPhase = task.constructionPhase || resolveTaskConstructionPhase(task);
            return {
              id: task.id,
              text: task.text,
              startDate: task.startDate,
              endDate: task.endDate,
              duration: task.duration,
              progress: task.progress,
              weight: task.weight,
              constructionPhase: resolvedPhase,
              milestonePhase: resolvedPhase,
              type: task.type,
              parentTaskId: task.parentTaskId,
              wbsCode: task.wbsCode,
              sortOrder: task.sortOrder,
              assignedContractorId: task.assignedContractorId,
              predecessorIds: task.predecessorIds
            };
          })
        })
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const resData = await res.json().catch(() => null);

      if (Array.isArray(resData?.data)) {
        const { parsedTasks: dbTasks, parsedLinks: dbLinks } = parseDbGanttPayload(
          targetProjectId,
          resData.data,
          Array.isArray(resData.links) ? resData.links : []
        );

        // Only hydrate cache & UI state if this is the latest settled mutation (prevents rubber-banding)
        const isLatestSettled =
          mySeq === mutationSeqRef.current &&
          pendingMutationsRef.current <= 1 &&
          queuedDragUpdatesRef.current.size === 0 &&
          !isDraggingRef.current;

        if (isLatestSettled) {
          ganttMemoryCacheRef.current.set(targetProjectId, { tasks: dbTasks, links: dbLinks, ts: Date.now() });
          purgeStaleLocalGanttCache(targetProjectId, dbTasks);
          setCacheVersion((v) => v + 1);
          if (latestSelectedProjectIdRef.current === targetProjectId) {
            setTasks(dbTasks);
            setLinks(dbLinks);
          }
        }

        const unifiedProg = computeUnifiedProjectProgress(dbTasks);
        onUpdateProject?.(targetProjectId, {
          progressPercentage: unifiedProg,
          cpmProgress: unifiedProg,
          tasksCount: dbTasks.length
        });
      }
      setSyncFeedback({ type: 'success', message: 'All changes saved' });
      setTimeout(() => setSyncFeedback(null), 2500);
    } catch (err) {
      console.error('syncBulkBackend error:', err);
      setSyncFeedback({ type: 'error', message: 'Unable to save schedule changes. Please try again.' });
      setTimeout(() => setSyncFeedback(null), 4000);
    } finally {
      pendingMutationsRef.current = Math.max(0, pendingMutationsRef.current - 1);
      isMutatingRef.current = pendingMutationsRef.current > 0 || queuedDragUpdatesRef.current.size > 0;
      if (pendingMutationsRef.current === 0) {
        setIsSyncing(false);
      }
    }
  }, [selectedProjectId, onUpdateProject, buildGanttAuthHeaders, parseDbGanttPayload, purgeStaleLocalGanttCache]);

  const syncBackend = useCallback(async (
    action: 'create' | 'update' | 'delete',
    task: Partial<GanttTaskItem> & { id: string },
    projectIdOverride?: string
  ) => {
    const targetProjectId = projectIdOverride || selectedProjectId;
    if (!targetProjectId) return;
    const mySeq = ++mutationSeqRef.current;
    pendingMutationsRef.current += 1;
    isMutatingRef.current = true;
    setIsSyncing(true);
    try {
      const resolvedPhase = task.constructionPhase || resolveTaskConstructionPhase(task);
      const res = await fetch(`/api/projects/${encodeURIComponent(targetProjectId)}/gantt/sync`, {
        method: 'POST',
        credentials: 'include',
        headers: buildGanttAuthHeaders(true),
        body: JSON.stringify({
          action,
          entityType: 'task',
          task: {
            id: task.id,
            text: task.text,
            startDate: task.startDate,
            endDate: task.endDate,
            duration: task.duration,
            progress: task.progress,
            weight: task.weight,
            constructionPhase: resolvedPhase,
            milestonePhase: resolvedPhase,
            type: task.type,
            parentTaskId: task.parentTaskId,
            wbsCode: task.wbsCode,
            sortOrder: task.sortOrder,
            assignedContractorId: task.assignedContractorId,
            predecessorIds: task.predecessorIds
          }
        })
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const resData = await res.json().catch(() => null);

      // Only hydrate authoritative DB response when no newer local mutation or drag is pending
      if (Array.isArray(resData?.data)) {
        const { parsedTasks: dbTasks, parsedLinks: dbLinks } = parseDbGanttPayload(
          targetProjectId,
          resData.data,
          Array.isArray(resData.links) ? resData.links : []
        );
        const isLatestSettled =
          mySeq === mutationSeqRef.current &&
          pendingMutationsRef.current <= 1 &&
          queuedDragUpdatesRef.current.size === 0 &&
          !isDraggingRef.current;

        if (isLatestSettled) {
          ganttMemoryCacheRef.current.set(targetProjectId, { tasks: dbTasks, links: dbLinks, ts: Date.now() });
          purgeStaleLocalGanttCache(targetProjectId, dbTasks);
          setCacheVersion((v) => v + 1);

          if (latestSelectedProjectIdRef.current === targetProjectId) {
            setTasks(dbTasks);
            setLinks(dbLinks);
          }
        }

        const unifiedProg = computeUnifiedProjectProgress(dbTasks);
        onUpdateProject?.(targetProjectId, {
          progressPercentage: unifiedProg,
          cpmProgress: unifiedProg,
          tasksCount: dbTasks.length
        });
      } else if (resData?.result?.projectProgress !== undefined) {
        onUpdateProject?.(targetProjectId, {
          progressPercentage: resData.result.projectProgress,
          cpmProgress: resData.result.projectProgress,
          tasksCount: resData.result.tasksCount
        });
      }
      setSyncFeedback({ type: 'success', message: 'All changes saved' });
      setTimeout(() => setSyncFeedback(null), 2500);
    } catch (err) {
      console.error('syncBackend error:', err);
      setSyncFeedback({ type: 'error', message: 'Unable to save schedule changes. Please try again.' });
      setTimeout(() => setSyncFeedback(null), 4000);
    } finally {
      pendingMutationsRef.current = Math.max(0, pendingMutationsRef.current - 1);
      isMutatingRef.current = pendingMutationsRef.current > 0 || queuedDragUpdatesRef.current.size > 0;
      if (pendingMutationsRef.current === 0) {
        setIsSyncing(false);
      }
    }
  }, [selectedProjectId, onUpdateProject, buildGanttAuthHeaders, parseDbGanttPayload, purgeStaleLocalGanttCache]);

  const queueDebouncedSync = useCallback((
    action: 'create' | 'update' | 'delete',
    task: Partial<GanttTaskItem> & { id: string }
  ) => {
    const targetProjectId = latestSelectedProjectIdRef.current || selectedProjectId;
    if (!targetProjectId) return;

    // For drag/resize updates, accumulate all dragged bars into queuedDragUpdatesRef so dragging bar 2
    // NEVER cancels bar 1's save, then flush them all atomically in one single /gantt/bulk request.
    if (action === 'update') {
      mutationSeqRef.current += 1;
      isMutatingRef.current = true;
      queuedDragUpdatesRef.current.set(task.id, {
        projectId: targetProjectId,
        task: task as GanttTaskItem
      });

      if (dragFlushTimerRef.current) {
        clearTimeout(dragFlushTimerRef.current);
      }
      dragFlushTimerRef.current = setTimeout(() => {
        dragFlushTimerRef.current = null;
        if (isDraggingRef.current) return;
        const entries = Array.from(queuedDragUpdatesRef.current.values());
        queuedDragUpdatesRef.current.clear();
        if (entries.length === 0) {
          isMutatingRef.current = pendingMutationsRef.current > 0;
          return;
        }
        // Group by projectId and flush each project's dragged bars in one atomic bulk call
        const byProject = new Map<string, GanttTaskItem[]>();
        entries.forEach(({ projectId, task: t }) => {
          const list = byProject.get(projectId) || [];
          list.push(t);
          byProject.set(projectId, list);
        });
        byProject.forEach((projTasks, pid) => {
          if (projTasks.length === 1) {
            syncBackend('update', projTasks[0], pid);
          } else {
            syncBulkBackend(projTasks, pid);
          }
        });
      }, 220);
      return;
    }

    if (pendingSyncTimerRef.current) {
      clearTimeout(pendingSyncTimerRef.current);
    }
    pendingSyncTimerRef.current = setTimeout(() => {
      syncBackend(action, task, targetProjectId);
    }, 150);
  }, [selectedProjectId, syncBackend, syncBulkBackend]);

  // ==========================================
  // 6b. Multi-Level Task Tree & Collapsible Subtasks
  // ==========================================
  const [collapsedTaskIds, setCollapsedTaskIds] = useState<Set<string>>(new Set());

  const toggleTaskCollapse = useCallback((taskId: string) => {
    setCollapsedTaskIds(prev => {
      const next = new Set(prev);
      if (next.has(taskId)) {
        next.delete(taskId);
      } else {
        next.add(taskId);
      }
      return next;
    });
  }, []);

  const handleExpandAll = useCallback(() => {
    setCollapsedTaskIds(new Set());
  }, []);

  const handleCollapseAll = useCallback(() => {
    // Collect all task IDs that have children
    const parentIds = new Set<string>();
    tasks.forEach(t => {
      if (t.parentTaskId) {
        parentIds.add(t.parentTaskId);
      }
    });
    setCollapsedTaskIds(parentIds);
  }, [tasks]);

  const { visibleTasks, depthMap, hasChildrenMap, descendantCountMap } = useMemo(() => {
    const allIds = new Set(scopedProjectTasks.map(t => t.id));
    const childMap = new Map<string, GanttTaskItem[]>();
    const rootTasks: GanttTaskItem[] = [];

    // Group tasks into parent-children buckets
    scopedProjectTasks.forEach(t => {
      if (t.parentTaskId && allIds.has(t.parentTaskId)) {
        if (!childMap.has(t.parentTaskId)) childMap.set(t.parentTaskId, []);
        childMap.get(t.parentTaskId)!.push(t);
      } else {
        rootTasks.push(t);
      }
    });

    const dMap = new Map<string, number>();
    const hcMap = new Map<string, boolean>();
    const descCountMap = new Map<string, number>();

    // Recursively count all descendants (children, grandchildren, etc.)
    const countDescendants = (taskId: string): number => {
      const children = childMap.get(taskId) || [];
      let count = children.length;
      for (const child of children) {
        count += countDescendants(child.id);
      }
      descCountMap.set(taskId, count);
      return count;
    };

    tasks.forEach(t => {
      hcMap.set(t.id, (childMap.get(t.id)?.length || 0) > 0);
      countDescendants(t.id);
    });

    // Pre-calculate effective start date for every task (earliest start date among the task itself and all its descendants)
    const effectiveStartTimeMap = new Map<string, number>();

    const getEffectiveStartTime = (taskId: string): number => {
      if (effectiveStartTimeMap.has(taskId)) {
        return effectiveStartTimeMap.get(taskId)!;
      }
      const t = tasks.find(x => x.id === taskId);
      let minTime = t ? getTaskDate(t).getTime() : Infinity;

      const children = childMap.get(taskId) || [];
      for (const child of children) {
        const childTime = getEffectiveStartTime(child.id);
        if (childTime < minTime) {
          minTime = childTime;
        }
      }
      effectiveStartTimeMap.set(taskId, minTime);
      return minTime;
    };

    tasks.forEach(t => {
      getEffectiveStartTime(t.id);
    });

    // WBS Hierarchy Lock:
    // Keep parent WBS rows (e.g., 1.0 GENERAL / MOBILIZATION, 2.0 EARTHWORKS) strictly pinned
    // above their child subtasks (1.1, 1.2, etc.) regardless of date edits or drag-and-drop.
    const parseWbsNumericParts = (code?: string | null, text?: string): number[] | null => {
      const candidate = (code && code.trim()) || (text ? (text.match(/^(\d+(?:\.\d+)*)/)?.[1] || '') : '');
      if (!candidate) return null;
      const parts = candidate
        .split('.')
        .map((seg) => parseInt(seg, 10))
        .filter((n) => Number.isFinite(n));
      return parts.length > 0 ? parts : null;
    };

    const sortByWbsHierarchy = (a: GanttTaskItem, b: GanttTaskItem) => {
      const wbsA = parseWbsNumericParts(a.wbsCode, a.text);
      const wbsB = parseWbsNumericParts(b.wbsCode, b.text);
      if (wbsA && wbsB) {
        const len = Math.max(wbsA.length, wbsB.length);
        for (let i = 0; i < len; i++) {
          const valA = wbsA[i] ?? 0;
          const valB = wbsB[i] ?? 0;
          if (valA !== valB) return valA - valB;
        }
        // Shorter WBS code or .0 header stays strictly above deeper children
        if (wbsA.length !== wbsB.length) return wbsA.length - wbsB.length;
      }
      // Lock explicit sortOrder next so date changes never reorder rows
      const orderA = Number.isFinite(a.sortOrder) ? a.sortOrder : 0;
      const orderB = Number.isFinite(b.sortOrder) ? b.sortOrder : 0;
      if (orderA !== orderB) return orderA - orderB;
      // Final deterministic tiebreaker
      const directA = getTaskDate(a).getTime();
      const directB = getTaskDate(b).getTime();
      return directA - directB;
    };

    rootTasks.sort(sortByWbsHierarchy);

    // Traverse tree in depth-first order to construct properly nested list
    const ordered: { task: GanttTaskItem; depth: number }[] = [];
    const visited = new Set<string>();

    const traverse = (items: GanttTaskItem[], depth: number) => {
      const sortedItems = items.slice().sort(sortByWbsHierarchy);
      sortedItems.forEach(item => {
        if (visited.has(item.id)) return;
        visited.add(item.id);
        dMap.set(item.id, depth);
        ordered.push({ task: item, depth });
        const children = childMap.get(item.id) || [];
        if (children.length > 0) {
          const sortedChildren = children.slice().sort(sortByWbsHierarchy);
          traverse(sortedChildren, depth + 1);
        }
      });
    };

    traverse(rootTasks, 0);

    // Fallback for any unreachable tasks (e.g. self-referencing) sorted by WBS hierarchy
    const unreachable = tasks.filter(t => !visited.has(t.id)).sort(sortByWbsHierarchy);
    unreachable.forEach(t => {
      dMap.set(t.id, 0);
      ordered.push({ task: t, depth: 0 });
    });

    // Build visible list: task is visible if NO ancestor is collapsed
    const visList: GanttTaskItem[] = [];
    ordered.forEach(({ task }) => {
      let isHidden = false;
      let currParentId = task.parentTaskId;

      const ancestorChain = new Set<string>();
      while (currParentId && allIds.has(currParentId) && !ancestorChain.has(currParentId)) {
        ancestorChain.add(currParentId);
        if (collapsedTaskIds.has(currParentId)) {
          isHidden = true;
          break;
        }
        const parentObj = tasks.find(t => t.id === currParentId);
        currParentId = parentObj?.parentTaskId || null;
      }

      if (!isHidden) {
        visList.push(task);
      }
    });

    return {
      visibleTasks: visList,
      depthMap: dMap,
      hasChildrenMap: hcMap,
      descendantCountMap: descCountMap
    };
  }, [tasks, collapsedTaskIds]);

  // ==========================================
  // 7. Timescale & Geometry Math
  // ==========================================

  const columnWidth = useMemo(() => {
    let base = 22;
    switch (zoomLevel) {
      case 'day': base = 42; break;
      case 'week': base = 22; break;
      case 'month': base = 10; break;
      case 'quarter': base = 5; break;
      case 'year': base = 2.5; break;
    }
    return Math.max(1.5, +(base * zoomFactor).toFixed(2));
  }, [zoomLevel, zoomFactor]);

  const ROW_HEIGHT = 54;

  // Determine timeline boundary dates
  const { timelineStart, timelineEnd, totalDays } = useMemo(() => {
    if (tasks.length === 0) {
      const now = new Date();
      const start = new Date(now.getFullYear(), now.getMonth(), 1, 12, 0, 0, 0);
      const end = new Date(now.getFullYear(), now.getMonth() + 3, 0, 12, 0, 0, 0);
      const diff = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;
      return { timelineStart: start, timelineEnd: end, totalDays: Math.max(diff, 60) };
    }

    let minTime = Infinity;
    let maxTime = -Infinity;

    tasks.forEach(t => {
      const s = parseDate(t.startDate).getTime();
      const e = parseDate(t.endDate).getTime();
      if (!isNaN(s) && s < minTime) minTime = s;
      if (!isNaN(e) && e > maxTime) maxTime = e;
      if (t.baselineStart) {
        const bs = parseDate(t.baselineStart).getTime();
        if (!isNaN(bs) && bs < minTime) minTime = bs;
      }
      if (t.baselineEnd) {
        const be = parseDate(t.baselineEnd).getTime();
        if (!isNaN(be) && be > maxTime) maxTime = be;
      }
    });

    if (!isFinite(minTime) || !isFinite(maxTime) || isNaN(minTime) || isNaN(maxTime)) {
      const now = new Date();
      const start = new Date(now.getFullYear(), now.getMonth(), 1, 12, 0, 0, 0);
      const end = new Date(now.getFullYear(), now.getMonth() + 3, 0, 12, 0, 0, 0);
      const diff = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;
      return { timelineStart: start, timelineEnd: end, totalDays: Math.max(diff, 60) };
    }

    const start = new Date(minTime);
    start.setDate(start.getDate() - 3); // 3-day left padding
    start.setHours(12, 0, 0, 0);

    const end = new Date(maxTime);
    end.setDate(end.getDate() + 15); // 15-day right padding for in-canvas task labels and connectors
    end.setHours(12, 0, 0, 0);

    const diff = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;
    return { timelineStart: start, timelineEnd: end, totalDays: Math.max(diff, 60) };
  }, [tasks]);

  const timelineWidth = Math.max(timelineContainerWidth, Math.round(totalDays * columnWidth));

  // Fit Entire Project Timeline to Screen (Zero horizontal scroll)
  const handleFitToScreen = useCallback(() => {
    const containerW = timelineScrollRef.current?.clientWidth || timelineContainerWidth || 1000;
    const availableW = Math.max(300, containerW - 32);
    const targetColW = availableW / Math.max(1, totalDays);

    let base = 10;
    let targetLevel: ZoomLevel = 'month';
    if (targetColW <= 3.5) {
      targetLevel = 'year';
      base = 2.5;
    } else if (targetColW <= 7.5) {
      targetLevel = 'quarter';
      base = 5.0;
    } else if (targetColW <= 16) {
      targetLevel = 'month';
      base = 10.0;
    } else if (targetColW <= 30) {
      targetLevel = 'week';
      base = 22.0;
    } else {
      targetLevel = 'day';
      base = 42.0;
    }
    const factor = +(targetColW / base).toFixed(2);
    setZoomLevel(targetLevel);
    setZoomFactor(Math.max(0.15, Math.min(3.0, factor)));
    if (timelineScrollRef.current) {
      timelineScrollRef.current.scrollLeft = 0;
    }
  }, [timelineContainerWidth, totalDays]);

  // Automatically fit all tasks and milestones across the monitor whenever Full Screen Mode is activated
  useEffect(() => {
    if (isFullscreen) {
      const timer = setTimeout(() => {
        handleFitToScreen();
      }, 150);
      return () => clearTimeout(timer);
    }
  }, [isFullscreen, handleFitToScreen]);

  const dateToPixel = useCallback((date: Date | string): number => {
    const d = parseDate(date);
    const tStart = timelineStart instanceof Date && !isNaN(timelineStart.getTime()) ? timelineStart : new Date();
    const dTime = !isNaN(d.getTime()) ? d.getTime() : tStart.getTime();
    const diffTime = dTime - tStart.getTime();
    const diffDays = diffTime / (1000 * 60 * 60 * 24);
    const colW = columnWidth || 22;
    const px = diffDays * colW;
    return isNaN(px) ? 0 : Math.round(px);
  }, [timelineStart, columnWidth]);

  const pixelToDate = useCallback((pixelX: number): Date => {
    const colW = columnWidth || 22;
    const days = Math.round((pixelX || 0) / colW);
    const tStart = timelineStart instanceof Date && !isNaN(timelineStart.getTime()) ? timelineStart : new Date();
    const result = new Date(tStart);
    result.setDate(result.getDate() + (isNaN(days) ? 0 : days));
    result.setHours(12, 0, 0, 0);
    return result;
  }, [timelineStart, columnWidth]);

  // Today marker line position
  const todayPixel = useMemo(() => {
    return dateToPixel(new Date());
  }, [dateToPixel]);

  // Days list for timeline header
  const daysList = useMemo(() => {
    const list: { date: Date; dateStr: string; isSun: boolean; isWeatherSuspended: boolean }[] = [];
    const curr = new Date(timelineStart);
    for (let i = 0; i < totalDays; i++) {
      const d = new Date(curr);
      const str = formatDateISO(d);
      list.push({
        date: d,
        dateStr: str,
        isSun: isSunday(d),
        isWeatherSuspended: weatherSuspendedDates.has(str)
      });
      curr.setDate(curr.getDate() + 1);
    }
    return list;
  }, [timelineStart, totalDays, weatherSuspendedDates]);

  // Month grouping headers
  const monthHeaders = useMemo(() => {
    const headers: { monthLabel: string; shortLabel: string; leftPixel: number; widthPixel: number }[] = [];
    let currentMonthKey = '';
    let startIdx = 0;

    daysList.forEach((day, idx) => {
      const monthKey = `${day.date.getFullYear()}-${day.date.getMonth()}`;
      if (monthKey !== currentMonthKey) {
        if (currentMonthKey !== '') {
          headers.push({
            monthLabel: daysList[startIdx].date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
            shortLabel: daysList[startIdx].date.toLocaleDateString('en-US', { month: 'short' }),
            leftPixel: startIdx * columnWidth,
            widthPixel: (idx - startIdx) * columnWidth
          });
        }
        currentMonthKey = monthKey;
        startIdx = idx;
      }
    });

    if (startIdx < daysList.length) {
      headers.push({
        monthLabel: daysList[startIdx].date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
        shortLabel: daysList[startIdx].date.toLocaleDateString('en-US', { month: 'short' }),
        leftPixel: startIdx * columnWidth,
        widthPixel: (daysList.length - startIdx) * columnWidth
      });
    }

    return headers;
  }, [daysList, columnWidth]);

  // ==========================================
  // 8. Direct Manipulation: Drag & Resize
  // ==========================================

  const handlePointerDown = (
    e: React.PointerEvent | React.MouseEvent,
    taskId: string,
    type: 'move' | 'resize-left' | 'resize-right'
  ) => {
    e.stopPropagation();
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;

    isDraggingRef.current = true;
    mutationSeqRef.current += 1;
    setDragState({
      active: true,
      type,
      taskId,
      initialPointerX: e.clientX,
      initialStartDate: task.startDate,
      initialEndDate: task.endDate,
      initialDuration: task.duration
    });
  };

  useEffect(() => {
    if (!dragState.active) return;

    const originalUserSelect = document.body.style.userSelect;
    document.body.style.userSelect = 'none';

    const onPointerMove = (e: MouseEvent | PointerEvent) => {
      const deltaX = e.clientX - dragState.initialPointerX;
      const deltaDays = Math.round(deltaX / columnWidth);

      setTasks(prevTasks => {
        const taskIndex = prevTasks.findIndex(t => t.id === dragState.taskId);
        if (taskIndex === -1) return prevTasks;
        const targetTask = { ...prevTasks[taskIndex] };
        const dur = dragState.initialDuration || countWorkingDays(dragState.initialStartDate, dragState.initialEndDate) || 1;

        if (dragState.type === 'move') {
          const origStart = parseDate(dragState.initialStartDate);
          const newStart = new Date(origStart);
          newStart.setDate(newStart.getDate() + deltaDays);
          if (isSunday(newStart)) newStart.setDate(newStart.getDate() + 1);

          const isMilestone = targetTask.type === 'milestone' || dur === 0;
          const newEnd = isMilestone
            ? newStart
            : addWorkingDays(newStart, Math.max(1, dur));

          targetTask.startDate = formatDateISO(newStart);
          targetTask.endDate = formatDateISO(newEnd);
          targetTask.duration = isMilestone ? 0 : dur;
        } else if (dragState.type === 'resize-left') {
          const origStart = parseDate(dragState.initialStartDate);
          const fixedEnd = parseDate(dragState.initialEndDate);
          const newStart = new Date(origStart);
          newStart.setDate(newStart.getDate() + deltaDays);
          if (isSunday(newStart)) newStart.setDate(newStart.getDate() + 1);

          if (newStart <= fixedEnd) {
            const newDur = countWorkingDays(newStart, fixedEnd);
            targetTask.startDate = formatDateISO(newStart);
            targetTask.endDate = dragState.initialEndDate;
            targetTask.duration = Math.max(1, newDur);
          }
        } else if (dragState.type === 'resize-right') {
          const fixedStart = parseDate(dragState.initialStartDate);
          const origEnd = parseDate(dragState.initialEndDate);
          const newEnd = new Date(origEnd);
          newEnd.setDate(newEnd.getDate() + deltaDays);
          if (isSunday(newEnd)) newEnd.setDate(newEnd.getDate() - 1);

          if (newEnd >= fixedStart) {
            const newDur = countWorkingDays(fixedStart, newEnd);
            targetTask.startDate = dragState.initialStartDate;
            targetTask.endDate = formatDateISO(newEnd);
            targetTask.duration = Math.max(1, newDur);
          }
        }

        const updatedList = [...prevTasks];
        updatedList[taskIndex] = targetTask;
        return updatedList;
      });
    };

    const onPointerUp = () => {
      document.body.style.userSelect = originalUserSelect;
      isDraggingRef.current = false;

      const currentTasks = latestTasksRef.current;
      const finalTask = currentTasks.find(t => t.id === dragState.taskId);
      if (finalTask) {
        const targetProjectId = latestSelectedProjectIdRef.current || selectedProjectId;
        const scopedTasks = currentTasks.filter(t => String(t.projectId || '') === String(targetProjectId));
        saveProjectGanttTasks(targetProjectId, scopedTasks);
        ganttMemoryCacheRef.current.set(targetProjectId, { tasks: scopedTasks, links, ts: Date.now() });
        queueDebouncedSync('update', finalTask);
      }

      setDragState(prev => ({ ...prev, active: false }));
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
    window.addEventListener('mousemove', onPointerMove);
    window.addEventListener('mouseup', onPointerUp);

    return () => {
      document.body.style.userSelect = originalUserSelect;
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
      window.removeEventListener('mousemove', onPointerMove);
      window.removeEventListener('mouseup', onPointerUp);
    };
  }, [dragState, columnWidth, queueDebouncedSync]);

  // ==========================================
  // 9. Quick Edit Modal Handlers
  // ==========================================

  const handleOpenEditModal = (task: GanttTaskItem) => {
    setIsNewTaskDraft(false);
    setEditingTask(task);
    setEditFormData({
      text: task.text,
      startDate: task.startDate,
      endDate: task.endDate,
      duration: task.duration,
      progress: Math.round(task.progress * 100),
      weight: typeof task.weight === 'number' ? task.weight : 25,
      constructionPhase: task.constructionPhase || constructionPhases[0] || STANDARD_CONSTRUCTION_PHASES[0],
      type: task.type,
      assignedContractorId: task.assignedContractorId || '',
      predecessorIds: [...task.predecessorIds]
    });
  };

  const handleSaveEditModal = () => {
    if (!editingTask) return;

    const contractor = contractors.find(c => c.id === editFormData.assignedContractorId);
    const rawFormProgress = Number.isFinite(Number(editFormData.progress)) ? Number(editFormData.progress) : 0;
    const progressVal = Math.max(0, Math.min(1, rawFormProgress / 100));
    const sDate = parseDate(editFormData.startDate);
    const isMs = Number(editFormData.duration) === 0 || editFormData.type === 'milestone';
    const eDate = isMs ? sDate : (editFormData.endDate ? parseDate(editFormData.endDate) : addWorkingDays(sDate, Number(editFormData.duration) || 1));
    const dur = isMs ? 0 : Math.max(1, countWorkingDays(sDate, eDate) || Number(editFormData.duration) || 1);
    const selectedPhaseName = editFormData.constructionPhase || STANDARD_CONSTRUCTION_PHASES[0];

    // Multi-Task Bulk Input Support (comma-separated task names during creation)
    const rawNames = isNewTaskDraft
      ? editFormData.text.split(',').map(s => s.trim()).filter(Boolean)
      : [editFormData.text.trim() || 'Construction Task'];
    const taskNames = rawNames.length > 0 ? rawNames : ['Construction Task'];

    if (isNewTaskDraft && taskNames.length > 1) {
      const targetProjectId = selectedProjectId;
      const perTaskWeight = Math.max(1, Math.round((editFormData.weight || 100) / taskNames.length));
      const newBatchTasks: GanttTaskItem[] = [];
      let newlyCreatedPhaseParent: GanttTaskItem | null = null;

      const baseList = scopedProjectTasks.slice();
      // Find or create parent Phase summary row for selectedPhaseName
      let phaseParent = baseList.find(t => !t.parentTaskId && t.text.toLowerCase() === selectedPhaseName.toLowerCase());
      if (!phaseParent) {
        const phaseId = `phase-${Date.now()}`;
        phaseParent = {
          id: phaseId,
          projectId: targetProjectId,
          wbsCode: `${baseList.filter(t => !t.parentTaskId).length + 1}.0`,
          text: selectedPhaseName,
          startDate: formatDateISO(sDate),
          endDate: formatDateISO(eDate),
          duration: dur,
          progress: progressVal,
          weight: 100,
          constructionPhase: selectedPhaseName,
          type: 'project',
          parentTaskId: null,
          sortOrder: baseList.length + 1,
          assignedContractorId: editFormData.assignedContractorId || null,
          contractorName: contractor?.name || 'LDM Construction Crew',
          predecessorIds: []
        };
        newlyCreatedPhaseParent = phaseParent;
        baseList.push(phaseParent);
      }

      const existingChildCount = baseList.filter(t => t.parentTaskId === phaseParent!.id).length;
      const parentWbsPrefix = (phaseParent.wbsCode || '1.0').replace(/\.0$/, '');

      taskNames.forEach((tName, idx) => {
        const newTaskObj: GanttTaskItem = {
          id: `task-${Date.now()}-${idx}`,
          projectId: targetProjectId,
          wbsCode: `${parentWbsPrefix}.${existingChildCount + idx + 1}`,
          text: tName,
          startDate: formatDateISO(sDate),
          endDate: formatDateISO(eDate),
          duration: dur,
          progress: progressVal,
          weight: perTaskWeight,
          constructionPhase: selectedPhaseName,
          type: 'task',
          parentTaskId: phaseParent!.id,
          sortOrder: baseList.length + idx + 1,
          assignedContractorId: editFormData.assignedContractorId || null,
          contractorName: contractor?.name || 'LDM Construction Crew',
          predecessorIds: [...editFormData.predecessorIds]
        };
        newBatchTasks.push(newTaskObj);
        baseList.push(newTaskObj);
      });

      const rolledUp = rollUpParentPhaseProgress(baseList);
      const scheduled = cascadeDownstreamSchedule(rolledUp, links, newBatchTasks[0].id);
      const newProg = computeProjectProgress(scheduled);

      setTasks(scheduled);
      saveProjectGanttTasks(targetProjectId, scheduled);
      ganttMemoryCacheRef.current.set(targetProjectId, { tasks: scheduled, links, ts: Date.now() });
      setCacheVersion((v) => v + 1);
      onUpdateProject?.(targetProjectId, {
        progressPercentage: newProg,
        cpmProgress: newProg,
        tasksCount: scheduled.length
      });

      const atomicBatch = newlyCreatedPhaseParent
        ? [newlyCreatedPhaseParent, ...newBatchTasks]
        : newBatchTasks;
      syncBulkBackend(atomicBatch, targetProjectId);
      setIsNewTaskDraft(false);
      setEditingTask(null);
      return;
    }

    const targetProjectId = selectedProjectId;
    const updatedTask: GanttTaskItem = {
      ...editingTask,
      projectId: targetProjectId,
      text: taskNames[0],
      startDate: formatDateISO(sDate),
      endDate: formatDateISO(eDate),
      duration: dur,
      progress: progressVal,
      weight: Math.max(1, Math.min(100, Number(editFormData.weight) || 25)),
      constructionPhase: selectedPhaseName,
      type: (dur === 0 || editFormData.type === 'milestone') ? 'milestone' : editFormData.type,
      assignedContractorId: editFormData.assignedContractorId || null,
      contractorName: contractor?.name || editingTask.contractorName || 'LDM Construction Crew',
      predecessorIds: editFormData.predecessorIds
    };

    // Update predecessor links list
    const updatedLinks = links.filter(l => l.target !== updatedTask.id);
    editFormData.predecessorIds.forEach(pId => {
      if (pId && pId !== updatedTask.id) {
        updatedLinks.push({
          id: `link-${pId}-${updatedTask.id}`,
          source: pId,
          target: updatedTask.id,
          type: '0',
          lag: 0
        });
      }
    });

    setLinks(updatedLinks);

    if (isNewTaskDraft) {
      const next = rollUpParentPhaseProgress([...scopedProjectTasks, updatedTask]);
      const scheduled = cascadeDownstreamSchedule(next, updatedLinks, updatedTask.id);
      const newProg = computeProjectProgress(scheduled);
      setTasks(scheduled);
      saveProjectGanttTasks(targetProjectId, scheduled);
      ganttMemoryCacheRef.current.set(targetProjectId, { tasks: scheduled, links: updatedLinks, ts: Date.now() });
      setCacheVersion((v) => v + 1);
      onUpdateProject?.(targetProjectId, {
        progressPercentage: newProg,
        cpmProgress: newProg,
        tasksCount: scheduled.length
      });
      syncBackend('create', updatedTask, targetProjectId);
    } else {
      const idx = scopedProjectTasks.findIndex(t => t.id === updatedTask.id);
      const copy = [...scopedProjectTasks];
      if (idx !== -1) copy[idx] = updatedTask;
      const rolledUp = rollUpParentPhaseProgress(copy);
      const scheduled = cascadeDownstreamSchedule(rolledUp, updatedLinks, updatedTask.id);
      const newProg = computeProjectProgress(scheduled);
      setTasks(scheduled);
      saveProjectGanttTasks(targetProjectId, scheduled);
      ganttMemoryCacheRef.current.set(targetProjectId, { tasks: scheduled, links: updatedLinks, ts: Date.now() });
      setCacheVersion((v) => v + 1);
      onUpdateProject?.(targetProjectId, {
        progressPercentage: newProg,
        cpmProgress: newProg,
        tasksCount: scheduled.length
      });
      syncBackend('update', updatedTask, targetProjectId);
    }

    setIsNewTaskDraft(false);
    setEditingTask(null);
  };

  const handleDeleteTask = async (taskId: string) => {
    const targetProjectId = selectedProjectId;
    const task = scopedProjectTasks.find(t => t.id === taskId && String(t.projectId || '') === String(targetProjectId));
    if (!task || !targetProjectId) return;

    const ok = await confirmDialog({
      title: 'Delete Gantt Task',
      message: `Are you sure you want to delete "${task.text}"? Connected dependency lines will be unlinked.`,
      confirmLabel: 'Delete Task',
      variant: 'danger',
    });
    if (!ok) {
      return;
    }

    // Tombstone for 15 seconds to guarantee zero ghost reappearances
    recentlyDeletedTaskIdsRef.current.set(taskId, Date.now() + 15000);

    // Update targetProjectId's cache entry strictly without touching any other project
    const existingCache = ganttMemoryCacheRef.current.get(targetProjectId);
    const baseTasks = existingCache
      ? existingCache.tasks.filter(t => String(t.projectId || '') === String(targetProjectId))
      : scopedProjectTasks;
    const remainingForProject = baseTasks
      .filter(t => t.id !== taskId)
      .map(t => ({
        ...t,
        predecessorIds: t.predecessorIds.filter(id => id !== taskId)
      }));
    const remainingLinksForProject = (existingCache ? existingCache.links : links).filter(
      l => l.source !== taskId && l.target !== taskId
    );
    ganttMemoryCacheRef.current.set(targetProjectId, {
      tasks: remainingForProject,
      links: remainingLinksForProject,
      ts: Date.now()
    });
    setCacheVersion((v) => v + 1);

    const newProg = computeProjectProgress(remainingForProject);
    saveProjectGanttTasks(targetProjectId, remainingForProject);
    onUpdateProject?.(targetProjectId, {
      progressPercentage: newProg,
      cpmProgress: newProg,
      tasksCount: remainingForProject.length
    });

    // Only mutate visible UI state if user is still viewing targetProjectId
    if (latestSelectedProjectIdRef.current === targetProjectId) {
      setTasks(remainingForProject);
      setLinks(remainingLinksForProject);
    }
    setCollapsedTaskIds(prev => {
      const next = new Set(prev);
      next.delete(taskId);
      return next;
    });

    // Notify parent App component to drop task from App state immediately
    onDeleteTask?.(taskId);

    syncBackend('delete', { id: taskId }, targetProjectId);
    if (editingTask && editingTask.id === taskId) {
      setEditingTask(null);
      setIsNewTaskDraft(false);
    }
  };

  const handleAddSubtask = (parentTask: GanttTaskItem) => {
    const parentStart = parseDate(parentTask.startDate);
    const newId = `task-${Date.now()}`;
    const newStart = parentStart;
    const newEnd = addWorkingDays(newStart, 3);
    const existingChildrenCount = tasks.filter(t => t.parentTaskId === parentTask.id).length;

    // Clean WBS generation:
    // e.g. parent "1.0" -> "1.1", "1.2"; parent "1.1" -> "1.1.1"; parent "2" -> "2.1"
    let baseCode = parentTask.wbsCode || '1.0';
    if (baseCode.endsWith('.0')) {
      baseCode = baseCode.slice(0, -2);
    }
    const childWbs = `${baseCode}.${existingChildrenCount + 1}`;

    const newSubtask: GanttTaskItem = {
      id: newId,
      projectId: selectedProjectId,
      wbsCode: childWbs,
      text: `Subtask of ${parentTask.text}`,
      startDate: formatDateISO(newStart),
      endDate: formatDateISO(newEnd),
      duration: 3,
      progress: 0,
      weight: 25,
      constructionPhase: parentTask.constructionPhase || resolveTaskConstructionPhase(parentTask),
      type: 'task',
      parentTaskId: parentTask.id,
      sortOrder: parentTask.sortOrder + 1,
      assignedContractorId: parentTask.assignedContractorId,
      contractorName: parentTask.contractorName,
      predecessorIds: []
    };

    const targetProjectId = selectedProjectId;
    // Auto-expand parent task if it was collapsed
    setCollapsedTaskIds(prev => {
      const next = new Set(prev);
      next.delete(parentTask.id);
      return next;
    });

    const parentIdx = scopedProjectTasks.findIndex(t => t.id === parentTask.id);
    let nextTasks: GanttTaskItem[];
    if (parentIdx === -1) {
      nextTasks = [...scopedProjectTasks, newSubtask];
    } else {
      let insertIdx = parentIdx + 1;
      while (insertIdx < scopedProjectTasks.length && scopedProjectTasks[insertIdx].parentTaskId === parentTask.id) {
        insertIdx++;
      }
      const next = [...scopedProjectTasks];
      next.splice(insertIdx, 0, newSubtask);
      nextTasks = next.map((t, idx) => ({ ...t, sortOrder: idx + 1 }));
    }

    const newProg = computeProjectProgress(nextTasks);
    setTasks(nextTasks);
    saveProjectGanttTasks(targetProjectId, nextTasks);
    ganttMemoryCacheRef.current.set(targetProjectId, { tasks: nextTasks, links, ts: Date.now() });
    setCacheVersion((v) => v + 1);
    onUpdateProject?.(targetProjectId, {
      progressPercentage: newProg,
      cpmProgress: newProg,
      tasksCount: nextTasks.length
    });
    syncBackend('create', newSubtask, targetProjectId);
  };

  const handleAddNewTask = useCallback((prefillPhase?: string) => {
    if (!selectedProjectId) return;
    const now = new Date();
    if (isSunday(now)) now.setDate(now.getDate() + 1);
    const newId = `task-${Date.now()}`;
    const startStr = formatDateISO(now);
    const endStr = formatDateISO(addWorkingDays(now, 5));
    const phaseToUse = prefillPhase || constructionPhases[0] || STANDARD_CONSTRUCTION_PHASES[0];

    const draftTask: GanttTaskItem = {
      id: newId,
      projectId: selectedProjectId,
      wbsCode: `${tasks.length + 1}.0`,
      text: 'New Civil Construction Task',
      startDate: startStr,
      endDate: endStr,
      duration: 5,
      progress: 0,
      constructionPhase: phaseToUse,
      type: 'task',
      parentTaskId: null,
      sortOrder: tasks.length + 1,
      assignedContractorId: contractors[0]?.id || null,
      contractorName: contractors[0]?.name || 'LDM Construction Crew',
      predecessorIds: []
    };

    setIsNewTaskDraft(true);
    setEditingTask(draftTask);
    setEditFormData({
      text: '',
      startDate: draftTask.startDate,
      endDate: draftTask.endDate,
      duration: draftTask.duration,
      progress: 0,
      weight: 25,
      constructionPhase: phaseToUse,
      type: draftTask.type,
      assignedContractorId: draftTask.assignedContractorId || '',
      predecessorIds: []
    });
  }, [selectedProjectId, tasks.length, contractors, constructionPhases]);

  // If navigated from Progress Report "+ Schedule Tasks", pre-open task modal for that phase
  useEffect(() => {
    if (!selectedProjectId || isLoading) return;
    const prefillPhase = localStorage.getItem('ctvill_gantt_prefill_phase');
    if (prefillPhase) {
      localStorage.removeItem('ctvill_gantt_prefill_phase');
      handleAddNewTask(prefillPhase);
    }
  }, [selectedProjectId, isLoading, handleAddNewTask]);

  const handleAddNewMilestone = () => {
    if (!selectedProjectId) return;
    const now = new Date();
    if (isSunday(now)) now.setDate(now.getDate() + 1);
    const newId = `milestone-${Date.now()}`;
    const dateStr = formatDateISO(now);

    const draftMilestone: GanttTaskItem = {
      id: newId,
      projectId: selectedProjectId,
      wbsCode: `${tasks.length + 1}.M`,
      text: 'Milestone Inspection & Sign-off',
      startDate: dateStr,
      endDate: dateStr,
      duration: 0,
      progress: 0,
      type: 'milestone',
      parentTaskId: null,
      sortOrder: tasks.length + 1,
      assignedContractorId: null,
      contractorName: 'LDM Lead PM',
      predecessorIds: []
    };

    setIsNewTaskDraft(true);
    setEditingTask(draftMilestone);
    setEditFormData({
      text: draftMilestone.text,
      startDate: draftMilestone.startDate,
      endDate: draftMilestone.endDate,
      duration: 0,
      progress: 0,
      weight: 10,
      constructionPhase: constructionPhases[0] || STANDARD_CONSTRUCTION_PHASES[0],
      type: 'milestone',
      assignedContractorId: '',
      predecessorIds: []
    });
  };

  type TemplatePresetId = 'residential_2storey' | 'commercial_fitout' | 'condo_renovation' | 'custom_blank';

  interface TemplateTaskBlueprint {
    wbsCode: string;
    text: string;
    offsetDays: number;
    duration: number;
    type: 'task' | 'milestone';
    constructionPhase: string;
    parentIdx?: number;
    predIndices?: number[];
  }

  interface TemplatePresetDef {
    id: TemplatePresetId;
    name: string;
    subtitle: string;
    estimatedDuration: string;
    tasks: TemplateTaskBlueprint[];
  }

  const TEMPLATE_PRESETS: TemplatePresetDef[] = [
    {
      id: 'residential_2storey',
      name: '2-Storey Residential Build',
      subtitle: 'Complete civil, structural, MEPFS, architectural finishes & handover',
      estimatedDuration: '~16 Weeks',
      tasks: [
        { wbsCode: '1.0', text: 'Site Mobilization & Earthworks', offsetDays: 0, duration: 10, type: 'task', constructionPhase: 'Site Preparation & Mobilization' },
        { wbsCode: '1.1', text: 'Perimeter Fencing, Clearing & Layout', offsetDays: 0, duration: 4, type: 'task', constructionPhase: 'Site Preparation & Mobilization', parentIdx: 0 },
        { wbsCode: '1.2', text: 'Foundation Excavation & Soil Poisoning', offsetDays: 4, duration: 6, type: 'task', constructionPhase: 'Earthworks & Excavation', parentIdx: 0, predIndices: [1] },
        { wbsCode: '2.0', text: 'Substructure & Structural Framing', offsetDays: 10, duration: 30, type: 'task', constructionPhase: 'Structural & Concrete Works', predIndices: [0] },
        { wbsCode: '2.1', text: 'Footings, Tie Beams & Ground Slab', offsetDays: 10, duration: 10, type: 'task', constructionPhase: 'Foundation & Footings', parentIdx: 3, predIndices: [2] },
        { wbsCode: '2.2', text: 'Ground Floor Columns & 2F Slab Pouring', offsetDays: 20, duration: 10, type: 'task', constructionPhase: 'Structural & Concrete Works', parentIdx: 3, predIndices: [4] },
        { wbsCode: '2.3', text: '2F Columns, Roof Beams & Steel Trusses', offsetDays: 30, duration: 10, type: 'task', constructionPhase: 'Structural & Concrete Works', parentIdx: 3, predIndices: [5] },
        { wbsCode: '3.0', text: 'Masonry, Roofing & MEPFS Rough-Ins', offsetDays: 40, duration: 24, type: 'task', constructionPhase: 'Masonry & CHB Works', predIndices: [3] },
        { wbsCode: '3.1', text: 'CHB Exterior & Interior Partition Walls', offsetDays: 40, duration: 10, type: 'task', constructionPhase: 'Masonry & CHB Works', parentIdx: 7, predIndices: [6] },
        { wbsCode: '3.2', text: 'Roofing Sheets, Flashing & Waterproofing', offsetDays: 46, duration: 8, type: 'task', constructionPhase: 'Roofing & Waterproofing', parentIdx: 7, predIndices: [6] },
        { wbsCode: '3.3', text: 'Electrical, Plumbing & Sanitary Rough-Ins', offsetDays: 50, duration: 14, type: 'task', constructionPhase: 'MEPFS Rough-Ins', parentIdx: 7, predIndices: [8] },
        { wbsCode: '4.0', text: 'Architectural Finishes & Painting', offsetDays: 64, duration: 24, type: 'task', constructionPhase: 'Architectural Finishes', predIndices: [7] },
        { wbsCode: '4.1', text: 'Plastering, Ceiling Framing & Tiling', offsetDays: 64, duration: 12, type: 'task', constructionPhase: 'Architectural Finishes', parentIdx: 11, predIndices: [10] },
        { wbsCode: '4.2', text: 'Doors, Windows, Cabinetry & Fixtures', offsetDays: 74, duration: 8, type: 'task', constructionPhase: 'Doors, Windows & Glazing', parentIdx: 11, predIndices: [12] },
        { wbsCode: '4.3', text: 'Interior & Exterior Painting Works', offsetDays: 80, duration: 8, type: 'task', constructionPhase: 'Painting & Coatings', parentIdx: 11, predIndices: [12] },
        { wbsCode: '5.0', text: 'QA/QC Punch List & Client Handover', offsetDays: 88, duration: 0, type: 'milestone', constructionPhase: 'Testing, Commissioning & Handover', predIndices: [13, 14] }
      ]
    },
    {
      id: 'commercial_fitout',
      name: 'Commercial / Office Fit-Out',
      subtitle: 'Turnkey office partitions, MEPFS, ceilings, flooring & commissioning',
      estimatedDuration: '~10 Weeks',
      tasks: [
        { wbsCode: '1.0', text: 'Admin Permits & Site Mobilization', offsetDays: 0, duration: 5, type: 'task', constructionPhase: 'Site Preparation & Mobilization' },
        { wbsCode: '1.1', text: 'Building Admin Clearances & Board-Up', offsetDays: 0, duration: 3, type: 'task', constructionPhase: 'Site Preparation & Mobilization', parentIdx: 0 },
        { wbsCode: '1.2', text: 'Demolition & Floor Protection', offsetDays: 3, duration: 2, type: 'task', constructionPhase: 'Site Preparation & Mobilization', parentIdx: 0, predIndices: [1] },
        { wbsCode: '2.0', text: 'Partitions, Ceilings & MEPFS Rough-In', offsetDays: 5, duration: 22, type: 'task', constructionPhase: 'MEPFS Rough-Ins', predIndices: [0] },
        { wbsCode: '2.1', text: 'Drywall Framing & Acoustic Partitions', offsetDays: 5, duration: 10, type: 'task', constructionPhase: 'Masonry & CHB Works', parentIdx: 3, predIndices: [2] },
        { wbsCode: '2.2', text: 'Electrical, Structured Cabling & FDAS', offsetDays: 9, duration: 12, type: 'task', constructionPhase: 'MEPFS Rough-Ins', parentIdx: 3, predIndices: [4] },
        { wbsCode: '2.3', text: 'HVAC Ducting & Fire Sprinkler Relocation', offsetDays: 11, duration: 12, type: 'task', constructionPhase: 'MEPFS Rough-Ins', parentIdx: 3, predIndices: [4] },
        { wbsCode: '2.4', text: 'Acoustic Ceiling Grid & Lighting Trim', offsetDays: 21, duration: 6, type: 'task', constructionPhase: 'Architectural Finishes', parentIdx: 3, predIndices: [5, 6] },
        { wbsCode: '3.0', text: 'Finishes, Glass & Custom Millwork', offsetDays: 27, duration: 20, type: 'task', constructionPhase: 'Architectural Finishes', predIndices: [3] },
        { wbsCode: '3.1', text: 'Carpet Tiles, Vinyl & Floor Finishes', offsetDays: 27, duration: 8, type: 'task', constructionPhase: 'Architectural Finishes', parentIdx: 8, predIndices: [7] },
        { wbsCode: '3.2', text: 'Tempered Glass Partitions & Doors', offsetDays: 33, duration: 8, type: 'task', constructionPhase: 'Doors, Windows & Glazing', parentIdx: 8, predIndices: [9] },
        { wbsCode: '3.3', text: 'Reception Millwork, Pantry & Painting', offsetDays: 35, duration: 12, type: 'task', constructionPhase: 'Painting & Coatings', parentIdx: 8, predIndices: [9] },
        { wbsCode: '4.0', text: 'Testing, Commissioning & Turnover', offsetDays: 47, duration: 5, type: 'task', constructionPhase: 'Testing, Commissioning & Handover', predIndices: [10, 11] },
        { wbsCode: '4.1', text: 'Final Occupancy & Handover Milestone', offsetDays: 52, duration: 0, type: 'milestone', constructionPhase: 'Testing, Commissioning & Handover', predIndices: [12] }
      ]
    },
    {
      id: 'condo_renovation',
      name: 'Condominium Interior Renovation',
      subtitle: 'Stripping, rewiring, waterproofing, tiling, custom cabinetry & fixtures',
      estimatedDuration: '~7 Weeks',
      tasks: [
        { wbsCode: '1.0', text: 'PMO Permits & Unit Protection', offsetDays: 0, duration: 4, type: 'task', constructionPhase: 'Site Preparation & Mobilization' },
        { wbsCode: '1.1', text: 'Stripping, Chipping & Hauling', offsetDays: 2, duration: 4, type: 'task', constructionPhase: 'Site Preparation & Mobilization', parentIdx: 0 },
        { wbsCode: '2.0', text: 'Electrical Rewiring & Plumbing Layout', offsetDays: 6, duration: 10, type: 'task', constructionPhase: 'MEPFS Rough-Ins', predIndices: [1] },
        { wbsCode: '2.1', text: 'Bathroom Waterproofing & Flood Testing', offsetDays: 10, duration: 5, type: 'task', constructionPhase: 'Roofing & Waterproofing', parentIdx: 2, predIndices: [1] },
        { wbsCode: '3.0', text: 'Ceiling, Cove Lighting & Tiling Works', offsetDays: 16, duration: 12, type: 'task', constructionPhase: 'Architectural Finishes', predIndices: [2, 3] },
        { wbsCode: '3.1', text: 'Kitchen & Wardrobe Custom Joinery', offsetDays: 22, duration: 10, type: 'task', constructionPhase: 'Architectural Finishes', parentIdx: 4, predIndices: [4] },
        { wbsCode: '3.2', text: 'Wall Painting, Lighting & Plumbing Trim', offsetDays: 28, duration: 8, type: 'task', constructionPhase: 'Painting & Coatings', parentIdx: 4, predIndices: [4] },
        { wbsCode: '4.0', text: 'Deep Cleaning & Owner Turnover', offsetDays: 36, duration: 0, type: 'milestone', constructionPhase: 'Testing, Commissioning & Handover', predIndices: [5, 6] }
      ]
    },
    {
      id: 'custom_blank',
      name: 'Custom / Blank Quick-Start',
      subtitle: 'Minimal 4-item skeleton schedule ready for custom phases & tasks',
      estimatedDuration: '~4 Weeks',
      tasks: [
        { wbsCode: '1.0', text: 'Phase 1 — Mobilization & Site Setup', offsetDays: 0, duration: 5, type: 'task', constructionPhase: 'Site Preparation & Mobilization' },
        { wbsCode: '2.0', text: 'Phase 2 — Core Construction / Execution', offsetDays: 5, duration: 12, type: 'task', constructionPhase: 'Structural & Concrete Works', predIndices: [0] },
        { wbsCode: '3.0', text: 'Phase 3 — Finishing & QA/QC Inspection', offsetDays: 17, duration: 6, type: 'task', constructionPhase: 'Architectural Finishes', predIndices: [1] },
        { wbsCode: '4.0', text: 'Project Handover & Sign-Off', offsetDays: 23, duration: 0, type: 'milestone', constructionPhase: 'Testing, Commissioning & Handover', predIndices: [2] }
      ]
    }
  ];

  // Multi-Preset Template Modal & More Tools Dropdown State
  const [isTemplateModalOpen, setIsTemplateModalOpen] = useState(false);
  const [selectedTemplatePreset, setSelectedTemplatePreset] = useState<TemplatePresetId>('residential_2storey');
  const [templateStartDate, setTemplateStartDate] = useState<string>(() => formatDateISO(new Date()));
  const [isApplyingTemplate, setIsApplyingTemplate] = useState(false);
  const [isMoreToolsOpen, setIsMoreToolsOpen] = useState(false);
  const moreToolsRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isMoreToolsOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (moreToolsRef.current && !moreToolsRef.current.contains(e.target as Node)) {
        setIsMoreToolsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isMoreToolsOpen]);

  const handleOpenTemplateModal = () => {
    if (!selectedProjectId) return;
    const projStart = activeProject?.startDate ? formatDateISO(parseDate(activeProject.startDate)) : formatDateISO(new Date());
    setTemplateStartDate(projStart);
    setIsTemplateModalOpen(true);
  };

  const handleApplyTemplatePreset = async () => {
    const targetProjectId = selectedProjectId;
    if (!targetProjectId) return;
    const preset = TEMPLATE_PRESETS.find((p) => p.id === selectedTemplatePreset) || TEMPLATE_PRESETS[0];
    setIsApplyingTemplate(true);
    setIsSyncing(true);
    try {
      const baseStart = parseDate(templateStartDate || formatDateISO(new Date()));
      const stamp = Date.now().toString().slice(-5);
      const generatedIds = preset.tasks.map((_, idx) => `tsk-${targetProjectId}-${idx + 1}-${stamp}`);

      const templateTasks: GanttTaskItem[] = preset.tasks.map((bp, idx) => {
        const startD = bp.offsetDays > 0 ? addWorkingDays(baseStart, bp.offsetDays + 1) : addWorkingDays(baseStart, 1);
        const startStr = formatDateISO(startD);
        const endStr = bp.type === 'milestone' || bp.duration === 0
          ? startStr
          : formatDateISO(addWorkingDays(startD, Math.max(1, bp.duration)));

        return {
          id: generatedIds[idx],
          projectId: targetProjectId,
          wbsCode: bp.wbsCode,
          text: bp.text,
          startDate: startStr,
          endDate: endStr,
          duration: bp.type === 'milestone' ? 0 : Math.max(1, bp.duration),
          progress: 0.0,
          constructionPhase: bp.constructionPhase,
          baselineStart: startStr,
          baselineEnd: endStr,
          type: bp.type,
          parentTaskId: bp.parentIdx !== undefined ? generatedIds[bp.parentIdx] : null,
          sortOrder: idx + 1,
          predecessorIds: (bp.predIndices || []).map((pi) => generatedIds[pi]).filter(Boolean)
        };
      });

      const templateLinks: GanttLinkItem[] = [];
      preset.tasks.forEach((bp, idx) => {
        (bp.predIndices || []).forEach((pi, lIdx) => {
          if (generatedIds[pi]) {
            templateLinks.push({
              id: `lnk-${targetProjectId}-${idx + 1}-${lIdx + 1}-${stamp}`,
              source: generatedIds[pi],
              target: generatedIds[idx],
              type: '0',
              lag: 0
            });
          }
        });
      });

      // Single bulk request/transaction to /api/projects/:projectId/gantt/sync with full auth headers
      const res = await fetch(`/api/projects/${encodeURIComponent(targetProjectId)}/gantt/sync`, {
        method: 'POST',
        headers: buildGanttAuthHeaders(true),
        credentials: 'include',
        body: JSON.stringify({
          tasks: templateTasks.map((t) => ({
            ...t,
            start_date: t.startDate,
            end_date: t.endDate,
            milestonePhase: t.constructionPhase,
          })),
          links: templateLinks,
          deletedTaskIds: scopedProjectTasks.map((t) => t.id),
          deletedLinkIds: links.map((l) => l.id)
        })
      });

      const resData = await res.json().catch(() => null);
      if (!res.ok || !resData?.success) {
        const errMsg = resData?.error || `Database sync failed (HTTP ${res.status})`;
        console.error('[Gantt Load Template] Bulk sync failed:', { status: res.status, resData, projectId: targetProjectId });
        throw new Error(errMsg);
      }

      if (resData?.localOnly) {
        console.error('[Gantt Load Template] Project not found in database (localOnly):', { projectId: targetProjectId, resData });
        throw new Error(`Project "${targetProjectId}" was not found in the database. Template could not be saved.`);
      }

      if (!Array.isArray(resData?.data) || resData.data.length === 0) {
        console.error('[Gantt Load Template] Database returned 0 persisted tasks:', { projectId: targetProjectId, resData });
        throw new Error('Database did not persist the template tasks. Please try again.');
      }

      // Hydrate directly from authoritative PostgreSQL response so refresh/project-switch matches 100%
      const { parsedTasks: dbTasks, parsedLinks: dbLinks } = parseDbGanttPayload(
        targetProjectId,
        resData.data,
        Array.isArray(resData.links) ? resData.links : []
      );
      ganttMemoryCacheRef.current.set(targetProjectId, { tasks: dbTasks, links: dbLinks, ts: Date.now() });
      purgeStaleLocalGanttCache(targetProjectId, dbTasks);
      setCacheVersion((v) => v + 1);

      if (latestSelectedProjectIdRef.current === targetProjectId) {
        setTasks(dbTasks);
        setLinks(dbLinks);
      }

      const unifiedProg = computeUnifiedProjectProgress(dbTasks);
      onUpdateProject?.(targetProjectId, {
        progressPercentage: unifiedProg,
        cpmProgress: unifiedProg,
        tasksCount: dbTasks.length
      });

      setIsTemplateModalOpen(false);
      setSyncFeedback({
        type: 'success',
        message: `${preset.name} saved to DB (${dbTasks.length} tasks starting ${templateStartDate}, 0% progress).`
      });
      setTimeout(() => setSyncFeedback(null), 4000);
    } catch (err: any) {
      console.error('Failed to load & persist schedule template:', err);
      setSyncFeedback({
        type: 'error',
        message: err?.message || 'Failed to save schedule template to database.'
      });
      setTimeout(() => setSyncFeedback(null), 5000);
    } finally {
      setIsApplyingTemplate(false);
      setIsSyncing(false);
    }
  };

  // Quick Metrics
  const metrics = useMemo(() => {
    const total = scopedProjectTasks.length;
    const completed = scopedProjectTasks.filter(t => t.progress >= 1).length;
    const milestones = scopedProjectTasks.filter(t => t.type === 'milestone' || t.duration === 0).length;
    return { total, completed, milestones };
  }, [scopedProjectTasks]);

  const totalGridHeight = useMemo(() => {
    return Math.max(600, visibleTasks.length * ROW_HEIGHT);
  }, [visibleTasks.length]);

  const handleScrollToToday = useCallback(() => {
    if (timelineScrollRef.current && todayPixel >= 0) {
      timelineScrollRef.current.scrollTo({
        left: Math.max(0, todayPixel - 200),
        behavior: 'smooth'
      });
    }
  }, [todayPixel]);

  const handleScrollToFirstTask = useCallback(() => {
    if (timelineScrollRef.current && visibleTasks.length > 0) {
      const firstTaskStart = visibleTasks[0].startDate;
      const px = dateToPixel(firstTaskStart);
      timelineScrollRef.current.scrollTo({
        left: Math.max(0, px - 150),
        behavior: 'smooth'
      });
    }
  }, [visibleTasks, dateToPixel]);

  return (
    <div
      ref={ganttContainerRef}
      className={`transition-all duration-300 ${isFullscreen
        ? (isDark ? 'fixed inset-0 z-50 bg-slate-950 p-4 md:p-6 flex flex-col h-screen w-screen overflow-hidden' : 'fixed inset-0 z-50 bg-slate-100 p-4 md:p-6 flex flex-col h-screen w-screen overflow-hidden')
        : 'space-y-4 select-none'
        }`}
    >
      {/* Streamlined 2-Row Gantt Toolbar */}
      <div className={`no-print ${isDark ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200/80 shadow-xs'} border rounded-xl transition-all ${isFullscreen ? 'p-3 mb-2 shrink-0' : 'px-4 py-3 space-y-2.5'}`}>
        {/* ROW 1: Project Selector (Left) + Primary Schedule Actions (Right) */}
        <div className="flex flex-wrap items-center justify-between gap-2.5">
          <div className="flex flex-wrap items-center gap-2.5 min-w-0">
            {projects.length > 0 ? (
              <select
                value={selectedProjectId}
                onChange={(e) => handleSelectProject(e.target.value)}
                aria-label="Select Commercial Project"
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold focus:border-amber-500 focus:outline-none cursor-pointer border max-w-[260px] sm:max-w-xs truncate ${isDark ? 'bg-slate-950 border-slate-700 text-slate-100' : 'bg-white border-slate-300 text-slate-800 shadow-2xs'}`}
              >
                {projects.map(p => {
                  void cacheVersion;
                  const cachedEntry = ganttMemoryCacheRef.current.get(p.id);
                  const projectScopedFallbackTasks = (tasksProp || []).filter(
                    t => String(t.projectId || '') === String(p.id)
                  );
                  const dropdownPct =
                    p.id === selectedProjectId
                      ? currentProjectProgress
                      : cachedEntry
                        ? getCanonicalProjectProgress(p, cachedEntry.tasks as any)
                        : getCanonicalProjectProgress(p, projectScopedFallbackTasks);
                  return (
                    <option key={p.id} value={p.id}>
                      {p.name} ({dropdownPct}%)
                    </option>
                  );
                })}
              </select>
            ) : activeProject ? (
              <span className={`text-xs font-semibold px-3 py-1.5 rounded-lg border truncate max-w-[260px] sm:max-w-xs ${isDark ? 'bg-slate-950 border-slate-700 text-slate-100' : 'bg-white border-slate-300 text-slate-800 shadow-2xs'}`}>
                {activeProject.name} ({currentProjectProgress}%)
              </span>
            ) : (
              <span className={`text-xs font-mono px-2.5 py-1.5 rounded-lg border ${isDark ? 'text-slate-400 bg-slate-950 border-slate-800' : 'text-slate-500 bg-slate-50 border-slate-200'}`}>
                No Commercial Sites Registered
              </span>
            )}

            {activeProject && (
              <div className={`hidden sm:flex items-center gap-2 border rounded-lg px-2.5 py-1 text-[11px] font-mono ${isDark ? 'bg-slate-950/70 border-slate-800 text-slate-300' : 'bg-slate-50 border-slate-200 text-slate-600'}`}>
                <span className="font-bold text-amber-400">{currentProjectProgress}%</span>
                <div className={`w-16 h-1.5 rounded-full overflow-hidden ${isDark ? 'bg-slate-800' : 'bg-slate-200'}`}>
                  <div
                    className="h-full bg-amber-500 rounded-full transition-all duration-300"
                    style={{ width: `${Math.min(100, Math.max(0, currentProjectProgress))}%` }}
                  />
                </div>
                <span className={isDark ? 'text-slate-400' : 'text-slate-500'}>
                  {metrics.completed}/{metrics.total} tasks
                </span>
              </div>
            )}

            {isSyncing && (
              <span className={`text-[11px] font-mono px-2 py-1 rounded-lg flex items-center gap-1.5 border ${isDark ? 'text-indigo-400 bg-indigo-950/60 border-indigo-700' : 'text-indigo-700 bg-indigo-50 border-indigo-200'}`}>
                <RefreshCw className="w-3 h-3 animate-spin" />
                <span>Syncing...</span>
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={!selectedProjectId}
              onClick={() => handleAddNewTask()}
              className={`flex items-center gap-1.5 px-3 py-1.5 font-bold rounded-lg text-xs transition cursor-pointer ${!selectedProjectId ? (isDark ? 'bg-slate-800/60 text-slate-500 cursor-not-allowed border border-slate-800' : 'bg-slate-100 text-slate-400 cursor-not-allowed border border-slate-200') : 'bg-amber-500 hover:bg-amber-400 text-slate-950 shadow-xs'}`}
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add Task</span>
            </button>
            <button
              type="button"
              disabled={!selectedProjectId}
              onClick={handleAddNewMilestone}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition cursor-pointer ${!selectedProjectId ? (isDark ? 'bg-slate-800/60 text-slate-500 cursor-not-allowed border border-slate-800' : 'bg-slate-100 text-slate-400 cursor-not-allowed border border-slate-200') : (isDark ? 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700' : 'bg-white hover:bg-slate-100 text-slate-700 border-slate-300/80 shadow-2xs')}`}
            >
              <span className={isDark ? 'text-amber-400 text-xs' : 'text-amber-600 text-xs'}>◆</span>
              <span>Add Milestone</span>
            </button>
            {selectedProjectId && (
              <button
                type="button"
                onClick={handleOpenTemplateModal}
                disabled={isSyncing}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition cursor-pointer ${isDark ? 'bg-slate-800 hover:bg-slate-700 text-amber-400 border-amber-500/30' : 'bg-amber-50 hover:bg-amber-100 text-amber-800 border-amber-300 shadow-2xs'}`}
                title="Choose a schedule preset & start date"
              >
                <Sparkles className="w-3.5 h-3.5 text-amber-500" />
                <span>Load Template</span>
              </button>
            )}
          </div>
        </div>

        {/* ROW 2: Single Zoom Control + Today + Expand/Collapse + Compact Legend + More Tools Dropdown */}
        <div className={`pt-2.5 border-t flex flex-wrap items-center justify-between gap-2.5 ${isDark ? 'border-slate-800/80' : 'border-slate-200'}`}>
          <div className="flex flex-wrap items-center gap-2">
            {/* Single Zoom Control: Year | Quarter | Month | Week | Day */}
            <div className={`flex items-center border rounded-lg p-0.5 gap-0.5 ${isDark ? 'bg-slate-950 border-slate-800' : 'bg-slate-100/90 border-slate-200'}`}>
              <button
                type="button"
                onClick={handleZoomOut}
                className={`p-1 rounded-md transition cursor-pointer ${isDark ? 'text-slate-400 hover:text-amber-300 hover:bg-slate-800' : 'text-slate-600 hover:text-amber-700 hover:bg-white'}`}
                title="Zoom Out (-)"
              >
                <ZoomOut className="w-3.5 h-3.5" />
              </button>
              <div className={`flex items-center gap-0.5 border-x px-1 ${isDark ? 'border-slate-800/80' : 'border-slate-200'}`}>
                {(['year', 'quarter', 'month', 'week', 'day'] as ZoomLevel[]).map(z => (
                  <button
                    key={z}
                    type="button"
                    onClick={() => { setZoomLevel(z); setZoomFactor(1); }}
                    className={`px-2 py-0.5 text-xs rounded font-mono font-medium transition cursor-pointer capitalize ${zoomLevel === z ? (isDark ? 'bg-amber-500 text-slate-950 font-bold' : 'bg-white text-amber-700 font-bold shadow-2xs') : (isDark ? 'text-slate-400 hover:text-white' : 'text-slate-600 hover:text-slate-900')}`}
                  >
                    {z}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={handleZoomIn}
                className={`p-1 rounded-md transition cursor-pointer ${isDark ? 'text-slate-400 hover:text-amber-300 hover:bg-slate-800' : 'text-slate-600 hover:text-amber-700 hover:bg-white'}`}
                title="Zoom In (+)"
              >
                <ZoomIn className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={handleFitToScreen}
                className={`p-1 rounded-md transition cursor-pointer ${isDark ? 'text-slate-400 hover:text-amber-300 hover:bg-slate-800' : 'text-slate-600 hover:text-amber-700 hover:bg-white'}`}
                title="Fit Timeline to Window"
              >
                <Scan className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Today Button */}
            <button
              type="button"
              onClick={handleScrollToToday}
              className={`px-2.5 py-1.5 rounded-lg text-xs font-mono font-semibold border transition cursor-pointer ${isDark ? 'bg-slate-950 hover:bg-slate-800 text-rose-400 border-slate-800' : 'bg-white hover:bg-slate-50 text-rose-600 border-slate-200 shadow-2xs'}`}
              title="Scroll Timeline to Today"
            >
              Today
            </button>

            {/* Expand / Collapse All */}
            <div className={`flex items-center gap-0.5 border rounded-lg p-0.5 ${isDark ? 'bg-slate-950 border-slate-800' : 'bg-slate-100/90 border-slate-200'}`}>
              <button
                type="button"
                onClick={handleExpandAll}
                className={`px-2 py-1 rounded text-xs font-mono transition flex items-center gap-1 cursor-pointer ${isDark ? 'text-slate-300 hover:text-white hover:bg-slate-800' : 'text-slate-600 hover:text-slate-900 hover:bg-white'}`}
                title="Expand All Phases"
              >
                <ChevronsDown className={`w-3.5 h-3.5 ${isDark ? 'text-amber-400' : 'text-amber-600'}`} />
                <span className="hidden md:inline">Expand</span>
              </button>
              <button
                type="button"
                onClick={handleCollapseAll}
                className={`px-2 py-1 rounded text-xs font-mono transition flex items-center gap-1 cursor-pointer ${isDark ? 'text-slate-300 hover:text-white hover:bg-slate-800' : 'text-slate-600 hover:text-slate-900 hover:bg-white'}`}
                title="Collapse All Phases"
              >
                <ChevronsUp className={`w-3.5 h-3.5 ${isDark ? 'text-slate-400' : 'text-slate-500'}`} />
                <span className="hidden md:inline">Collapse</span>
              </button>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Compact Legend */}
            <div className="hidden xl:flex items-center gap-3 text-[11px] font-medium">
              <span className="flex items-center gap-1.5 text-slate-400"><span className="w-2 h-2 rounded-2xs bg-emerald-600 inline-block" />Task</span>
              <span className="flex items-center gap-1.5 text-slate-400"><span className="w-2 h-2 rounded-2xs bg-red-600 inline-block" />Critical</span>
              <span className="flex items-center gap-1 text-slate-400"><span className="text-amber-400 font-bold">◆</span>Milestone</span>
              <span className="flex items-center gap-1.5 text-slate-400"><span className="w-3 h-[2px] bg-slate-400/80 inline-block" />Baseline</span>
            </div>

            {/* More Tools Dropdown */}
            <div ref={moreToolsRef} className="relative">
              <button
                type="button"
                onClick={() => setIsMoreToolsOpen((prev) => !prev)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition cursor-pointer ${isDark ? 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700' : 'bg-white hover:bg-slate-100 text-slate-700 border-slate-300/80 shadow-2xs'}`}
              >
                <SlidersHorizontal className="w-3.5 h-3.5 text-amber-400" />
                <span>More Tools</span>
                <ChevronDown className={`w-3.5 h-3.5 transition-transform ${isMoreToolsOpen ? 'rotate-180' : ''}`} />
              </button>

              {isMoreToolsOpen && (
                <div className={`absolute right-0 mt-1.5 w-52 rounded-xl border shadow-2xl py-1.5 z-50 text-xs ${isDark ? 'bg-slate-900 border-slate-700 text-slate-200' : 'bg-white border-slate-200 text-slate-700'}`}>
                  <button
                    type="button"
                    onClick={() => {
                      setIsMoreToolsOpen(false);
                      setSyncFeedback({
                        type: 'success',
                        message: 'Link mode enabled: Drag connectors between tasks to define Finish-to-Start relationships'
                      });
                      setTimeout(() => setSyncFeedback(null), 3500);
                    }}
                    className={`w-full px-3 py-2 flex items-center gap-2.5 text-left transition cursor-pointer ${isDark ? 'hover:bg-slate-800' : 'hover:bg-slate-50'}`}
                  >
                    <Link2 className="w-3.5 h-3.5 text-sky-400" />
                    <span>Link Tasks</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setIsMoreToolsOpen(false);
                      const { updatedTasks, shiftedCount } = autoScheduleProject(tasks, links);
                      setTasks(updatedTasks);
                      if (selectedProjectId) {
                        saveProjectGanttTasks(selectedProjectId, updatedTasks);
                        updatedTasks.forEach(t => {
                          const orig = tasks.find(ot => ot.id === t.id);
                          if (orig && (orig.startDate !== t.startDate || orig.endDate !== t.endDate)) {
                            syncBackend('update', t);
                          }
                        });
                      }
                      setSyncFeedback({
                        type: 'success',
                        message: `Auto-schedule completed: Cascaded ${shiftedCount} ${shiftedCount === 1 ? 'dependency' : 'dependencies'}`
                      });
                      setTimeout(() => setSyncFeedback(null), 3500);
                    }}
                    className={`w-full px-3 py-2 flex items-center gap-2.5 text-left transition cursor-pointer ${isDark ? 'hover:bg-slate-800' : 'hover:bg-slate-50'}`}
                  >
                    <Wand2 className="w-3.5 h-3.5 text-amber-400" />
                    <span>Auto-Schedule</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setIsMoreToolsOpen(false);
                      if (!selectedProjectId) return;
                      const rebaselined = tasks.map(t => ({
                        ...t,
                        baselineStart: t.startDate,
                        baselineEnd: t.endDate
                      }));
                      setTasks(rebaselined);
                      saveProjectGanttTasks(selectedProjectId, rebaselined);
                      rebaselined.forEach(t => syncBackend('update', t));
                      setSyncFeedback({
                        type: 'success',
                        message: 'Re-baseline complete: Contract baseline synchronized to current dates'
                      });
                      setTimeout(() => setSyncFeedback(null), 3500);
                    }}
                    className={`w-full px-3 py-2 flex items-center gap-2.5 text-left transition cursor-pointer ${isDark ? 'hover:bg-slate-800' : 'hover:bg-slate-50'}`}
                  >
                    <BookmarkCheck className="w-3.5 h-3.5 text-emerald-400" />
                    <span>Re-baseline</span>
                  </button>

                  <div className={`my-1 border-t ${isDark ? 'border-slate-800' : 'border-slate-100'}`} />

                  <button
                    type="button"
                    onClick={() => {
                      setIsMoreToolsOpen(false);
                      window.print();
                    }}
                    className={`w-full px-3 py-2 flex items-center gap-2.5 text-left transition cursor-pointer ${isDark ? 'hover:bg-slate-800' : 'hover:bg-slate-50'}`}
                  >
                    <Printer className="w-3.5 h-3.5 text-slate-400" />
                    <span>Print</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setIsMoreToolsOpen(false);
                      const headers = ['WBS,Task,Start,End,Duration,Progress,Type\n'];
                      const rows = tasks.map(t =>
                        `"${t.wbsCode}","${t.text.replace(/"/g, '""')}","${t.startDate}","${t.endDate}",${t.duration},${Math.round(t.progress * 100)}%,"${t.type}"`
                      );
                      const blob = new Blob([...headers, ...rows.join('\n')], { type: 'text/csv;charset=utf-8;' });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = url;
                      a.download = `Gantt_Schedule_${activeProject?.name?.replace(/\s+/g, '_') || 'LDM'}.csv`;
                      a.click();
                      URL.revokeObjectURL(url);
                    }}
                    className={`w-full px-3 py-2 flex items-center gap-2.5 text-left transition cursor-pointer ${isDark ? 'hover:bg-slate-800' : 'hover:bg-slate-50'}`}
                  >
                    <Download className="w-3.5 h-3.5 text-slate-400" />
                    <span>Export CSV</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setIsMoreToolsOpen(false);
                      toggleFullscreen();
                    }}
                    className={`w-full px-3 py-2 flex items-center gap-2.5 text-left transition cursor-pointer ${isDark ? 'hover:bg-slate-800' : 'hover:bg-slate-50'}`}
                  >
                    {isFullscreen ? <Minimize2 className="w-3.5 h-3.5 text-slate-400" /> : <Maximize2 className="w-3.5 h-3.5 text-slate-400" />}
                    <span>{isFullscreen ? 'Exit Full Screen' : 'Full Screen'}</span>
                  </button>

                  <div className={`my-1 border-t ${isDark ? 'border-slate-800' : 'border-slate-100'}`} />

                  <button
                    type="button"
                    onClick={() => {
                      setIsMoreToolsOpen(false);
                      handleScrollToFirstTask();
                    }}
                    className={`w-full px-3 py-2 flex items-center gap-2.5 text-left transition cursor-pointer ${isDark ? 'hover:bg-slate-800' : 'hover:bg-slate-50'}`}
                  >
                    <Calendar className="w-3.5 h-3.5 text-slate-400" />
                    <span>Jump to First Task</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setIsMoreToolsOpen(false);
                      loadGanttData(selectedProjectId);
                    }}
                    disabled={isLoading}
                    className={`w-full px-3 py-2 flex items-center gap-2.5 text-left transition cursor-pointer ${isDark ? 'hover:bg-slate-800' : 'hover:bg-slate-50'}`}
                  >
                    <RotateCw className={`w-3.5 h-3.5 text-slate-400 ${isLoading ? 'animate-spin text-amber-400' : ''}`} />
                    <span>Reload from Server</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Compact Floating Save Toast (bottom-right, zero layout shift) */}
        {syncFeedback && (
          <div
            role="status"
            aria-live="polite"
            className={`no-print fixed bottom-5 right-5 z-[9990] px-3.5 py-2 rounded-xl border text-xs font-medium shadow-xl backdrop-blur-md flex items-center gap-2 animate-fadeIn ${syncFeedback.type === 'success' ? (isDark ? 'bg-slate-900/95 border-emerald-500/40 text-emerald-300' : 'bg-white/95 border-emerald-300 text-emerald-800') : (isDark ? 'bg-slate-900/95 border-rose-500/40 text-rose-300' : 'bg-white/95 border-rose-300 text-rose-800')}`}
          >
            {syncFeedback.type === 'success' ? (
              <CheckCircle2 className="w-3.5 h-3.5 shrink-0 text-emerald-400" />
            ) : (
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-rose-400" />
            )}
            <span>{syncFeedback.message}</span>
          </div>
        )}
      </div>

      {/* 3. Dual-Pane Synchronized Gantt Canvas */}
      <div className={`gantt-print-canvas border rounded-2xl overflow-hidden flex flex-col xl:flex-row ${isDark ? 'bg-slate-950 border-slate-800 shadow-2xl' : 'bg-white border-slate-200/90 shadow-sm'
        } ${isFullscreen ? 'flex-1 min-h-0' : 'h-[520px] sm:h-[600px] xl:h-[660px]'
        }`}>
        {/* LEFT PANE: WBS Data Grid (Collapsible to maximize Timeline Canvas) */}
        <div className={`${isLeftPaneCollapsed ? 'w-14 shrink-0' : 'w-full xl:w-[540px] shrink-0'
          } border-r flex flex-col transition-all duration-200 select-none ${isDark ? 'border-slate-800 bg-slate-950' : 'border-slate-200 bg-white'
          }`}>
          {isLeftPaneCollapsed ? (
            <div className={`flex flex-col items-center py-4 h-full justify-between ${isDark ? 'bg-slate-950' : 'bg-slate-50'
              }`}>
              <div className="flex flex-col items-center gap-4">
                <button
                  type="button"
                  onClick={() => setIsLeftPaneCollapsed(false)}
                  className={`p-2 rounded-xl transition cursor-pointer border shadow-xs ${isDark
                    ? 'bg-slate-900 hover:bg-slate-800 text-amber-400 hover:text-amber-300 border-slate-800'
                    : 'bg-white hover:bg-slate-100 text-amber-700 hover:text-amber-800 border-slate-200'
                    }`}
                  title="Expand WBS Task Grid"
                >
                  <PanelLeftOpen className="w-4 h-4" />
                </button>
                <div className={`[writing-mode:vertical-rl] rotate-180 text-[10px] font-mono tracking-widest uppercase font-bold py-2 ${isDark ? 'text-slate-400' : 'text-slate-500'
                  }`}>
                  Task Grid ({visibleTasks.length})
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsLeftPaneCollapsed(false)}
                className={`p-2 rounded-lg transition cursor-pointer ${isDark ? 'text-slate-500 hover:text-slate-300' : 'text-slate-400 hover:text-slate-700'
                  }`}
                title="Open Task Details"
              >
                <Layers className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <>
              {/* Table Header: WBS, TASK, START, END, DUR, % */}
              <div className={`h-[60px] flex items-center px-3 text-[11px] font-mono font-bold uppercase tracking-wider ${isDark
                ? 'bg-slate-900 border-b border-slate-800 text-slate-400'
                : 'bg-[#f1f5f9] border-b border-[#cbd5e1] text-[#334155] font-bold text-xs'
                }`}>
                <button
                  type="button"
                  onClick={() => setIsLeftPaneCollapsed(true)}
                  className={`p-1 -ml-1 mr-1 rounded transition cursor-pointer ${isDark ? 'hover:bg-slate-800 text-slate-400 hover:text-white' : 'hover:bg-slate-200 text-slate-400 hover:text-slate-700'
                    }`}
                  title="Collapse Task Grid (Maximize Timeline Canvas)"
                >
                  <PanelLeftClose className="w-3.5 h-3.5" />
                </button>
                <div className="w-11 text-center">WBS</div>
                <div className="flex-1 px-2 min-w-[210px] truncate">TASK</div>
                <div className="w-14 text-center">START</div>
                <div className="w-14 text-center">END</div>
                <div className="w-9 text-center">DUR</div>
                <div className="w-9 text-center">%</div>
                <div className="w-9 text-center">EDIT</div>
              </div>

              {/* Table Body (Synchronized Scroll) */}
              <div
                ref={tableBodyRef}
                onScroll={handleTableScroll}
                className={`flex-1 overflow-y-auto overflow-x-hidden ${isDark ? 'divide-y divide-slate-900' : 'divide-y divide-[#e2e8f0]'
                  }`}
              >
                {visibleTasks.map((task, taskIndex) => {
                  const isMilestone = task.type === 'milestone' || task.duration === 0;
                  const isCritical = criticalTaskIds.has(task.id);
                  const pct = Math.round(task.progress * 100);
                  const isCompleted = pct >= 100 || String((task as any).status || '').toUpperCase() === 'COMPLETED';
                  const taskEndTs = parseDate(task.endDate).getTime();
                  const todayMidnight = new Date();
                  todayMidnight.setHours(0, 0, 0, 0);
                  const isOverdue = !isCompleted && !isNaN(taskEndTs) && taskEndTs < todayMidnight.getTime();
                  const isRedAlert = !isCompleted && (isOverdue || isCritical);
                  const depth = depthMap.get(task.id) || 0;
                  const hasChildren = hasChildrenMap.get(task.id) || false;
                  const isCollapsed = collapsedTaskIds.has(task.id);
                  const hiddenCount = descendantCountMap.get(task.id) || 0;
                  const isParentSummary = depth === 0;

                  const rowBgClass = isDark
                    ? (depth === 0 ? 'hover:bg-slate-900/80 bg-slate-950/40 border-t border-slate-900/80' : 'hover:bg-slate-900/50 bg-slate-950/80')
                    : (isParentSummary
                      ? 'bg-amber-50/40 text-slate-800 font-bold hover:bg-amber-100/60 border-t border-amber-200/40'
                      : (taskIndex % 2 === 0 ? 'bg-white hover:bg-slate-100/70' : 'bg-slate-50/40 hover:bg-slate-100/70')
                    );

                  return (
                    <div
                      key={task.id}
                      style={{ height: `${ROW_HEIGHT}px` }}
                      onDoubleClick={() => handleOpenEditModal(task)}
                      className={`flex items-center px-3 text-xs font-mono transition group cursor-pointer ${rowBgClass}`}
                    >
                      <div className={`w-11 text-center truncate ${isDark
                        ? (depth === 0 ? 'font-bold text-amber-400/90 text-[11px]' : 'text-slate-400 text-[10px]')
                        : (depth === 0 ? 'font-bold text-amber-700 text-[11px]' : 'text-slate-500 text-[10px]')
                        }`}>
                        {task.wbsCode}
                      </div>

                      {/* Hierarchical Tree Item */}
                      <div
                        className="flex-1 px-2 truncate flex items-center min-w-[210px]"
                        style={{ paddingLeft: `${depth * 16}px` }}
                      >
                        {hasChildren && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleTaskCollapse(task.id);
                            }}
                            className={`p-0.5 -ml-1 mr-1 rounded transition-colors flex items-center shrink-0 cursor-pointer ${isDark
                              ? 'hover:bg-slate-800 text-amber-400 hover:text-amber-300'
                              : 'hover:bg-amber-100/80 text-amber-700 hover:text-amber-800'
                              }`}
                            title={isCollapsed ? `Expand ${hiddenCount} subtask(s)` : 'Collapse subtasks'}
                          >
                            {isCollapsed ? (
                              <ChevronRight className="w-3.5 h-3.5 stroke-[2.5]" />
                            ) : (
                              <ChevronDown className="w-3.5 h-3.5 stroke-[2.5]" />
                            )}
                          </button>
                        )}

                        {/* Left Table Critical Indicators & Milestone Diamond:
                        - Critical Tasks: Prepend small red dot indicator (`text-red-500 font-bold mr-1.5`)
                        - Milestone Rows: Prepend yellow milestone diamond icon `◆` (`text-amber-400 mr-1.5`)
                    */}
                        {isMilestone ? (
                          <span className="text-amber-400 font-bold mr-1.5 select-none shrink-0">◆</span>
                        ) : Math.round(task.progress * 100) >= 100 || String((task as any).status || '').toUpperCase() === 'COMPLETED' ? (
                          <span className="text-emerald-500 font-bold mr-1.5 select-none shrink-0">•</span>
                        ) : isCritical ? (
                          <span className="text-red-500 font-bold mr-1.5 select-none shrink-0">•</span>
                        ) : null}

                        <span
                          className={`truncate ${isDark
                            ? (isMilestone ? 'font-bold text-amber-300' : isCritical ? 'font-semibold text-slate-100' : 'text-slate-300 font-medium')
                            : (isMilestone ? 'font-bold text-amber-800' : isCritical ? 'font-bold text-[#0f172a]' : 'text-[#0f172a] font-semibold')
                            }`}
                          title={task.text}
                        >
                          {task.text}
                        </span>

                        {/* Collapsed Hidden Subtask Counter Badge */}
                        {isCollapsed && hiddenCount > 0 && (
                          <span
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleTaskCollapse(task.id);
                            }}
                            className={`ml-1.5 px-1 py-0.2 text-[9px] font-mono font-bold rounded shrink-0 transition cursor-pointer border ${isDark
                              ? 'bg-amber-500/15 text-amber-400 border-amber-500/30 hover:bg-amber-500/25'
                              : 'bg-amber-100 text-amber-800 border-amber-200 hover:bg-amber-200'
                              }`}
                            title={`Click to expand ${hiddenCount} hidden subtasks`}
                          >
                            +{hiddenCount}
                          </span>
                        )}
                      </div>

                      <div className={`w-14 text-center text-[11px] truncate font-mono ${isDark ? 'text-slate-300' : 'text-slate-600'
                        }`}>
                        {formatDateMMDD(task.startDate)}
                      </div>
                      <div className={`w-14 text-center text-[11px] truncate font-mono ${isDark ? 'text-slate-300' : 'text-slate-600'
                        }`}>
                        {formatDateMMDD(isMilestone ? task.startDate : task.endDate)}
                      </div>
                      <div className={`w-9 text-center text-[11px] font-bold font-mono ${isDark ? 'text-slate-200' : 'text-slate-700'
                        }`}>
                        {isMilestone ? (
                          <span className="text-amber-400 font-bold select-none">◆</span>
                        ) : (
                          task.duration
                        )}
                      </div>
                      <div className={`w-9 text-center text-[11px] font-medium font-mono ${isDark ? 'text-slate-300' : 'text-slate-700'
                        }`}>
                        {pct}
                      </div>
                      <div className="w-9 flex items-center justify-center gap-1">
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); handleOpenEditModal(task); }}
                          className={`p-1 rounded transition cursor-pointer ${isDark
                            ? 'text-amber-400 hover:text-white hover:bg-slate-800'
                            : 'text-amber-600 hover:text-amber-800 hover:bg-amber-100'
                            }`}
                          title="Edit Task Scope & Dates"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); handleDeleteTask(task.id); }}
                          className={`p-1 rounded transition cursor-pointer ${isDark
                            ? 'text-slate-500 hover:text-rose-400 hover:bg-slate-800'
                            : 'text-slate-400 hover:text-rose-600 hover:bg-rose-50'
                            }`}
                          title="Delete Task"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
                {isLoading && visibleTasks.length === 0 && (
                  <div className="p-4 space-y-2.5 animate-pulse">
                    {Array.from({ length: 8 }).map((_, idx) => (
                      <div
                        key={`gantt-skel-${idx}`}
                        className={`h-10 rounded-lg border flex items-center justify-between px-3 ${isDark ? 'bg-slate-900/70 border-slate-800/80' : 'bg-slate-100/80 border-slate-200'}`}
                      >
                        <div className="flex items-center gap-2.5 w-2/3">
                          <div className={`h-3 w-10 rounded ${isDark ? 'bg-slate-800' : 'bg-slate-200'}`} />
                          <div className={`h-3 flex-1 rounded ${isDark ? 'bg-slate-800' : 'bg-slate-200'}`} />
                        </div>
                        <div className={`h-3 w-14 rounded ${isDark ? 'bg-slate-800' : 'bg-slate-200'}`} />
                      </div>
                    ))}
                  </div>
                )}
                {visibleTasks.length === 0 && !isLoading && (
                  <div className="p-8 text-center flex flex-col items-center justify-center min-h-[340px]">
                    <div className={`w-12 h-12 rounded-xl flex items-center justify-center mb-3 ${isDark ? 'bg-slate-900 text-amber-400 border border-slate-800' : 'bg-amber-50 text-amber-600 border border-amber-200'
                      }`}>
                      <Layers className="w-6 h-6" />
                    </div>
                    <h4 className={`text-sm font-bold mb-1 ${isDark ? 'text-white' : 'text-slate-800'}`}>
                      No Tasks in Project Schedule
                    </h4>
                    <p className={`text-xs max-w-xs mb-4 ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                      This commercial site has 0 tasks (0% complete). Start building the schedule manually or initialize from template.
                    </p>
                    <div className="flex flex-wrap items-center justify-center gap-2">
                      <button
                        type="button"
                        onClick={() => handleAddNewTask()}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold rounded-lg text-xs transition cursor-pointer shadow-xs"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>Add First Task</span>
                      </button>
                      <button
                        type="button"
                        onClick={handleOpenTemplateModal}
                        disabled={isSyncing}
                        className={`flex items-center gap-1.5 px-3 py-1.5 font-medium rounded-lg text-xs transition cursor-pointer border ${isDark
                          ? 'bg-slate-900 hover:bg-slate-800 text-amber-400 border-amber-500/30'
                          : 'bg-white hover:bg-slate-50 text-amber-700 border-amber-200 shadow-2xs'
                          }`}
                      >
                        <Sparkles className="w-3.5 h-3.5 text-amber-500" />
                        <span>Load Template</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {/* RIGHT PANE: Interactive Timeline Grid */}
        <div
          ref={timelineScrollRef}
          onScroll={handleTimelineScroll}
          className={`flex-1 overflow-auto relative relative-timeline ${isDark ? 'bg-slate-950/90' : 'bg-white'
            }`}
        >
          <div style={{ width: `${timelineWidth}px`, height: `${totalGridHeight + 60}px` }} className="relative min-h-full">
            {/* Empty Timeline Watermark */}
            {visibleTasks.length === 0 && !isLoading && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10 pt-20">
                <div className={`px-5 py-3 rounded-xl border text-center shadow-xs ${isDark ? 'bg-slate-900/90 border-slate-800 text-slate-400' : 'bg-white/90 border-slate-200 text-slate-500'
                  }`}>
                  <p className="text-xs font-mono font-medium">Timeline canvas empty • 0 tasks scheduled (0% complete)</p>
                </div>
              </div>
            )}
            {/* Timeline Multi-Tier Header */}
            <div className={`sticky top-0 z-30 border-b ${isDark ? 'bg-slate-900 border-slate-800 shadow-md' : 'bg-[#f1f5f9] border-[#cbd5e1] shadow-2xs'
              }`}>
              {/* Tier 1: Month Groups */}
              <div className={`h-7 border-b relative text-xs font-mono font-bold ${isDark ? 'border-slate-800 text-slate-300' : 'border-[#cbd5e1] text-[#0f172a]'
                }`}>
                {monthHeaders.map((m, idx) => {
                  const isNarrow = m.widthPixel < 65;
                  return (
                    <div
                      key={idx}
                      style={{ left: `${m.leftPixel}px`, width: `${m.widthPixel}px` }}
                      className={`absolute top-0 bottom-0 flex items-center px-2 border-r truncate text-[11px] ${isDark ? 'border-slate-800' : 'border-[#cbd5e1]'
                        }`}
                      title={m.monthLabel}
                    >
                      {isNarrow ? m.shortLabel : m.monthLabel}
                    </div>
                  );
                })}
              </div>

              {/* Tier 2: Days Header */}
              <div className="h-8 flex text-[10px] font-mono">
                {daysList.map((d, idx) => (
                  <div
                    key={idx}
                    style={{ width: `${columnWidth}px` }}
                    className={`shrink-0 flex items-center justify-center border-r ${isDark ? 'border-slate-800/80' : 'border-[#cbd5e1]'
                      } ${d.isSun ? (isDark ? 'bg-slate-950/70 text-slate-600 font-bold' : 'bg-slate-200/70 text-[#475569] font-bold') :
                        d.isWeatherSuspended ? (isDark ? 'bg-amber-500/10 text-amber-400 font-bold' : 'bg-amber-100 text-amber-800 font-bold') :
                          (isDark ? 'text-slate-400' : 'text-[#334155] font-semibold')
                      }`}
                  >
                    {columnWidth >= 32 ? (
                      <span>{d.date.getDate()}</span>
                    ) : (d.date.getDay() === 1) ? (
                      <span className="whitespace-nowrap overflow-visible text-[10px] font-medium">
                        {d.date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                      </span>
                    ) : columnWidth >= 24 ? (
                      <span>{d.date.getDate()}</span>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>

            {/* Timeline Background Grid Columns */}
            <div
              style={{ height: `${totalGridHeight}px` }}
              className="absolute top-[60px] left-0 right-0 flex pointer-events-none z-0"
            >
              {daysList.map((d, idx) => (
                <div
                  key={idx}
                  style={{ width: `${columnWidth}px` }}
                  className={`shrink-0 h-full ${isDark ? 'border-r border-slate-900/80' : 'border-r border-[#e2e8f0]'
                    } ${d.isSun ? (isDark ? 'bg-slate-950/40 opacity-70' : 'bg-slate-100/70') :
                      d.isWeatherSuspended ? (isDark ? 'bg-amber-500/5' : 'bg-amber-50/40') : ''
                    }`}
                />
              ))}
            </div>

            {/* Red "Today" Line Marker */}
            {todayPixel >= 0 && todayPixel <= timelineWidth && (
              <div
                style={{ left: `${todayPixel}px`, height: `${totalGridHeight + 60}px` }}
                className="absolute top-0 z-25 pointer-events-none w-0.5 bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.7)]"
              >
                <div className="sticky top-[62px] -ml-6 bg-red-600 text-white font-mono text-[9px] font-extrabold px-1.5 py-0.5 rounded shadow-sm uppercase tracking-wider">
                  TODAY
                </div>
              </div>
            )}

            {/* SVG Dependency Connector Right-Angle Stepped Lines (Professional CPM Standard) */}
            <svg
              className="absolute top-[60px] left-0 pointer-events-none z-10"
              style={{ width: `${timelineWidth}px`, height: `${totalGridHeight}px` }}
            >
              <defs>
                <marker
                  id="cpm-arrow-critical"
                  markerWidth="7"
                  markerHeight="7"
                  refX="6"
                  refY="3.5"
                  orient="auto"
                >
                  <polygon points="0 1, 6 3.5, 0 6" fill="#ef4444" />
                </marker>
                <marker
                  id="cpm-arrow-standard"
                  markerWidth="7"
                  markerHeight="7"
                  refX="6"
                  refY="3.5"
                  orient="auto"
                >
                  <polygon points="0 1, 6 3.5, 0 6" fill="#64748b" />
                </marker>
              </defs>

              {dependencyConnections.map(({ predId, succId }) => {
                const predIndex = visibleTasks.findIndex(t => t.id === predId);
                const succIndex = visibleTasks.findIndex(t => t.id === succId);
                if (predIndex === -1 || succIndex === -1) return null;

                const predTask = visibleTasks[predIndex];
                const succTask = visibleTasks[succIndex];

                const predY = predIndex * ROW_HEIGHT + 28;
                const succY = succIndex * ROW_HEIGHT + 28;

                const isPredMilestone = predTask.type === 'milestone' || predTask.duration === 0;
                const isSuccMilestone = succTask.type === 'milestone' || succTask.duration === 0;

                const predMetrics = computeTaskBarMetrics(predTask.startDate, predTask.endDate, timelineStart, columnWidth);
                const succMetrics = computeTaskBarMetrics(succTask.startDate, succTask.endDate, timelineStart, columnWidth);

                const predX = isPredMilestone
                  ? predMetrics.left + 8
                  : predMetrics.left + predMetrics.width;

                const succX = isSuccMilestone
                  ? succMetrics.left - 8
                  : succMetrics.left;

                if (isNaN(predX) || isNaN(predY) || isNaN(succX) || isNaN(succY)) return null;

                // Predecessor exit -> 90° right-angle turn -> horizontal entry into successor start
                const isCriticalDep = criticalTaskIds.has(predId) && criticalTaskIds.has(succId);
                const strokeColor = isCriticalDep ? '#ef4444' : '#64748b';
                const markerId = isCriticalDep ? 'url(#cpm-arrow-critical)' : 'url(#cpm-arrow-standard)';

                const x1 = predX;
                const y1 = predY;
                const x2 = succX;
                const y2 = succY;
                const xMid = x1 + 12;

                let pathD = '';
                if (x2 >= xMid) {
                  // Standard orthogonal step: (x1, y1) -> (x1 + 12, y1) -> (x1 + 12, y2) -> (x2, y2)
                  pathD = `M ${x1} ${y1} H ${xMid} V ${y2} H ${x2}`;
                } else {
                  // Overlap/loopback right-angle step: (x1, y1) -> (x1 + 12, y1) -> (x1 + 12, midY) -> (x2 - 12, midY) -> (x2 - 12, y2) -> (x2, y2)
                  const midY = (y1 + y2) / 2;
                  pathD = `M ${x1} ${y1} H ${xMid} V ${midY} H ${x2 - 12} V ${y2} H ${x2}`;
                }

                return (
                  <path
                    key={`dep-${predId}-${succId}`}
                    d={pathD}
                    fill="none"
                    stroke={strokeColor}
                    strokeWidth={isCriticalDep ? 2 : 1.5}
                    markerEnd={markerId}
                    className="pointer-events-none transition-all duration-200"
                  />
                );
              })}
            </svg>

            {/* Timeline Task Rows & Double-Bars */}
            <div
              style={{ height: `${totalGridHeight}px` }}
              className="absolute top-[60px] left-0 right-0 z-20 pointer-events-none"
            >
              {visibleTasks.map((task, rowIndex) => {
                const isMilestone = task.type === 'milestone' || task.duration === 0;
                const isCritical = criticalTaskIds.has(task.id);
                const taskFloat = taskFloatMap.get(task.id) ?? 0;
                const { left: barLeft, width: barWidth } = computeTaskBarMetrics(
                  task.startDate,
                  task.endDate,
                  timelineStart,
                  columnWidth
                );
                const pct = Math.round(task.progress * 100);
                const isCompleted = pct >= 100 || String((task as any).status || '').toUpperCase() === 'COMPLETED';
                const taskEndTs = parseDate(task.endDate).getTime();
                const todayMidnight = new Date();
                todayMidnight.setHours(0, 0, 0, 0);
                const isOverdue = !isCompleted && !isNaN(taskEndTs) && taskEndTs < todayMidnight.getTime();
                const isRedAlert = !isCompleted && (isOverdue || isCritical);

                // Baseline coordinates: original baseline schedule span (or current dates fallback)
                const hasBaseline = Boolean(task.baselineStart && task.baselineEnd);
                const { left: bLeft, width: bWidth } = computeTaskBarMetrics(
                  task.baselineStart || task.startDate,
                  task.baselineEnd || task.endDate,
                  timelineStart,
                  columnWidth
                );

                return (
                  <div
                    key={task.id}
                    style={{ height: `${ROW_HEIGHT}px` }}
                    className={`relative group pointer-events-none ${isDark ? 'border-b border-slate-900/90' : 'border-b border-[#e2e8f0]'
                      }`}
                  >
                    {/* Baseline Underline Track (Clearly visible 3px slate-400 track directly beneath each task bar) */}
                    <div
                      style={{ left: `${bLeft}px`, width: `${bWidth}px` }}
                      className="absolute top-[44px] h-[3px] bg-slate-400/80 rounded-full z-10 shadow-2xs pointer-events-none"
                      title={`Baseline: ${formatDateDisplay(task.baselineStart || task.startDate)} - ${formatDateDisplay(task.baselineEnd || task.endDate)}`}
                    />

                    {/* Actual / Forecasted Main Bar or Milestone Diamond */}
                    {isMilestone ? (
                      /* Solid Milestone Diamond (◆) with gold diamond marker (#eab308) */
                      <div
                        style={{ left: `${barLeft - 8}px` }}
                        onDoubleClick={() => handleOpenEditModal(task)}
                        onPointerDown={(e) => handlePointerDown(e, task.id, 'move')}
                        onMouseDown={(e) => handlePointerDown(e, task.id, 'move')}
                        className="absolute top-[18px] flex items-center gap-2 cursor-grab active:cursor-grabbing group/ms z-30 pointer-events-auto select-none"
                        title={`Milestone: ${task.text} (${formatDateShort(task.startDate)}) • 0d Duration (Drag to reschedule)`}
                      >
                        <div
                          className="w-4 h-4 rotate-45 rounded-2xs transition-transform hover:scale-125 shrink-0 bg-[#eab308] border border-amber-200 shadow-md shadow-amber-500/40"
                        />
                        <span className={`text-xs whitespace-nowrap select-none ${isDark ? 'font-medium text-slate-100 drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]' : 'font-semibold text-[#0f172a]'}`}>
                          {task.text}
                        </span>
                      </div>
                    ) : (
                      /* 2. Full-Width Two-Tone Duration Bars (Remove Fixed Pill Stubs)
                         - Spans full width calculated dynamically from calendar columns
                         - Height ~22px, rounded-sm
                         - Critical Path (0 Float):
                           - Completed portion: Solid Red (bg-red-600 / #dc2626) with bold white centered text
                           - Remaining uncompleted: Dark/Muted Red (bg-red-950/80 border border-red-700/60)
                         - Non-Critical (Float > 0):
                           - Completed portion: Solid Green (bg-emerald-600 / #16a34a) with bold white centered text
                           - Remaining uncompleted: Dark/Muted Green (bg-emerald-950/80 border border-emerald-700/60)
                      */
                      <>
                        <div
                          style={{ left: `${barLeft}px`, width: `${barWidth}px` }}
                          onDoubleClick={() => handleOpenEditModal(task)}
                          onPointerDown={(e) => handlePointerDown(e, task.id, 'move')}
                          onMouseDown={(e) => handlePointerDown(e, task.id, 'move')}
                          className={`absolute top-[17px] h-[22px] rounded-sm shadow-md overflow-hidden flex items-center transition-shadow select-none group/bar pointer-events-auto cursor-grab active:cursor-grabbing z-20 ${isRedAlert
                            ? isDark
                              ? 'bg-red-950/80 border border-red-700/60 shadow-red-950/40'
                              : 'bg-red-200 border border-red-500 shadow-xs'
                            : isDark
                              ? 'bg-emerald-950/80 border border-emerald-700/60 shadow-emerald-950/40'
                              : 'bg-emerald-200 border border-emerald-500 shadow-xs'
                            } hover:ring-1 hover:ring-white/40`}
                          title={`${task.text}: ${pct}% complete • ${isCompleted ? 'Completed (100%)' : isOverdue ? 'Overdue' : isCritical ? 'Critical Path (0 Float)' : `On Track (Float: ${taskFloat}d)`}`}
                        >
                          {/* Completed progress portion */}
                          {pct > 0 && (
                            <div
                              style={{
                                width: `${Math.min(100, Math.max(0, pct))}%`,
                                minWidth: '34px'
                              }}
                              className={`h-full flex items-center justify-center shrink-0 pointer-events-none select-none ${isRedAlert ? 'bg-red-600' : 'bg-emerald-600'
                                }`}
                            >
                              <span className="font-mono font-bold text-[10px] sm:text-[11px] text-white px-1 whitespace-nowrap drop-shadow select-none">
                                {pct}%
                              </span>
                            </div>
                          )}

                          {/* 0% progress indicator (slate/upcoming instead of solid emerald completed) */}
                          {pct === 0 && (
                            <div className={`h-full px-2 flex items-center justify-center shrink-0 pointer-events-none select-none ${isRedAlert ? 'bg-red-600' : (isDark ? 'bg-slate-600' : 'bg-slate-500')
                              }`}>
                              <span className="font-mono font-bold text-[10px] text-white select-none">
                                0%
                              </span>
                            </div>
                          )}

                          {/* Left Edge Resize Handle */}
                          <div
                            onPointerDown={(e) => handlePointerDown(e, task.id, 'resize-left')}
                            onMouseDown={(e) => handlePointerDown(e, task.id, 'resize-left')}
                            className="absolute left-0 top-0 bottom-0 w-3 cursor-ew-resize z-30 pointer-events-auto hover:bg-white/60 bg-white/20 transition-all rounded-l-sm"
                            title="Drag left edge to adjust Start Date"
                          />

                          {/* Right Edge Resize Handle */}
                          <div
                            onPointerDown={(e) => handlePointerDown(e, task.id, 'resize-right')}
                            onMouseDown={(e) => handlePointerDown(e, task.id, 'resize-right')}
                            className="absolute right-0 top-0 bottom-0 w-3 cursor-ew-resize z-30 pointer-events-auto hover:bg-white/60 bg-white/20 transition-all rounded-r-sm"
                            title="Drag right edge to adjust End Date"
                          />
                        </div>

                        {/* Task title label immediately to the right of each bar (left + width + 8px) */}
                        <div
                          style={{ left: `${barLeft + barWidth + 8}px` }}
                          className={`absolute top-[17px] h-[22px] flex items-center text-xs whitespace-nowrap pointer-events-none select-none z-20 ${isDark
                            ? 'font-medium text-slate-100 drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]'
                            : 'font-semibold text-[#0f172a]'
                            }`}
                        >
                          {task.text}
                        </div>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* 4. Quick-Edit & Dependency Modal */}
      {editingTask && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 animate-fadeIn"
          onClick={() => setEditingTask(null)}
        >
          <div
            className={`border rounded-2xl w-full max-w-xl shadow-2xl overflow-hidden font-mono text-xs ${isDark ? 'bg-slate-900 border-slate-700' : 'bg-white border-slate-200'
              }`}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className={`flex items-center justify-between px-5 py-4 border-b ${isDark ? 'border-slate-800 bg-slate-950' : 'border-slate-200 bg-slate-50'
              }`}>
              <div className="flex items-center gap-2">
                <Edit3 className={`w-4 h-4 ${isDark ? 'text-amber-400' : 'text-amber-600'}`} />
                <span className={`font-bold text-sm ${isDark ? 'text-white' : 'text-slate-900'}`}>Edit Task Scope & Dependencies</span>
              </div>
              <button
                type="button"
                onClick={() => setEditingTask(null)}
                className={`p-1 rounded-lg transition cursor-pointer ${isDark ? 'text-slate-400 hover:text-white hover:bg-slate-800' : 'text-slate-500 hover:text-slate-800 hover:bg-slate-200'
                  }`}
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Modal Form */}
            <div className="p-5 space-y-4 max-h-[80vh] overflow-y-auto">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className={`uppercase tracking-wider text-[10px] font-bold ${isDark ? 'text-slate-400' : 'text-slate-600'
                    }`}>
                    Task Name & Scope {isNewTaskDraft && '(Supports Comma-Separated Bulk Input)'}
                  </label>
                  {isNewTaskDraft && editFormData.text.includes(',') && (
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-amber-500/15 text-amber-400 border border-amber-500/30 font-semibold">
                      Batch: {editFormData.text.split(',').map(s => s.trim()).filter(Boolean).length} Tasks
                    </span>
                  )}
                </div>
                <input
                  type="text"
                  value={editFormData.text}
                  onChange={(e) => setEditFormData(prev => ({ ...prev, text: e.target.value }))}
                  className={`w-full rounded-xl px-3 py-2 font-medium focus:border-amber-500 focus:outline-none border ${isDark ? 'bg-slate-950 border-slate-700 text-white' : 'bg-white border-slate-300 text-slate-800'
                    }`}
                  placeholder={isNewTaskDraft ? 'e.g. Excavation, Land clearing, Land paving' : 'e.g. Reinforced Footing Concreting'}
                />
                {isNewTaskDraft && (
                  <p className={`text-[10px] mt-1 ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                    Tip: Enter comma-separated task names (e.g., <em>"Excavation, Land clearing, Land paving"</em>) to batch-create all tasks under the selected Construction Phase at once.
                  </p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={`block uppercase tracking-wider text-[10px] mb-1 font-bold ${isDark ? 'text-slate-400' : 'text-slate-600'
                    }`}>
                    Start Date
                  </label>
                  <input
                    type="date"
                    value={editFormData.startDate}
                    onChange={(e) => {
                      const newStart = e.target.value;
                      const s = parseDate(newStart);
                      const eDate = addWorkingDays(s, editFormData.duration);
                      setEditFormData(prev => ({
                        ...prev,
                        startDate: newStart,
                        endDate: formatDateISO(eDate)
                      }));
                    }}
                    className={`w-full rounded-xl px-3 py-2 font-medium focus:border-amber-500 focus:outline-none border ${isDark ? 'bg-slate-950 border-slate-700 text-white' : 'bg-white border-slate-300 text-slate-800'
                      }`}
                  />
                </div>

                <div>
                  <label className={`block uppercase tracking-wider text-[10px] mb-1 font-bold ${isDark ? 'text-slate-400' : 'text-slate-600'
                    }`}>
                    End Date
                  </label>
                  <input
                    type="date"
                    value={editFormData.endDate}
                    onChange={(e) => {
                      const newEnd = e.target.value;
                      const dur = countWorkingDays(editFormData.startDate, newEnd);
                      setEditFormData(prev => ({
                        ...prev,
                        endDate: newEnd,
                        duration: Math.max(1, dur)
                      }));
                    }}
                    className={`w-full rounded-xl px-3 py-2 font-medium focus:border-amber-500 focus:outline-none border ${isDark ? 'bg-slate-950 border-slate-700 text-white' : 'bg-white border-slate-300 text-slate-800'
                      }`}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className={`block uppercase tracking-wider text-[10px] mb-1 font-bold ${isDark ? 'text-slate-400' : 'text-slate-600'
                    }`}>
                    Duration (Working Days, Mon-Sat)
                  </label>
                  <input
                    type="number"
                    min="0"
                    max="365"
                    value={editFormData.duration}
                    onChange={(e) => {
                      const dur = Math.max(0, parseInt(e.target.value, 10) || 0);
                      const s = parseDate(editFormData.startDate);
                      const eDate = dur === 0 ? s : addWorkingDays(s, dur);
                      setEditFormData(prev => ({
                        ...prev,
                        duration: dur,
                        endDate: formatDateISO(eDate),
                        type: dur === 0 ? 'milestone' : prev.type
                      }));
                    }}
                    className={`w-full rounded-xl px-3 py-2 font-medium focus:border-amber-500 focus:outline-none border ${isDark ? 'bg-slate-950 border-slate-700 text-white' : 'bg-white border-slate-300 text-slate-800'
                      }`}
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className={`uppercase tracking-wider text-[10px] font-bold ${isDark ? 'text-slate-400' : 'text-slate-600'
                      }`}>
                      Construction Phase
                    </label>
                    <button
                      type="button"
                      onClick={() => setShowAddPhaseInput(prev => !prev)}
                      className="text-[10px] font-mono font-bold text-amber-400 hover:text-amber-300 flex items-center gap-0.5 cursor-pointer"
                    >
                      <Plus className="w-3 h-3" />
                      <span>Add Phase</span>
                    </button>
                  </div>
                  <select
                    value={editFormData.constructionPhase}
                    onChange={(e) => setEditFormData(prev => ({ ...prev, constructionPhase: e.target.value }))}
                    className={`w-full rounded-xl px-3 py-2 font-medium focus:border-amber-500 focus:outline-none cursor-pointer border ${isDark ? 'bg-slate-950 border-slate-700 text-white' : 'bg-white border-slate-300 text-slate-800'
                      }`}
                  >
                    {constructionPhases.map(phase => (
                      <option key={phase} value={phase}>{phase}</option>
                    ))}
                  </select>
                  {showAddPhaseInput && (
                    <div className="flex items-center gap-1.5 mt-2">
                      <input
                        type="text"
                        value={newCustomPhaseName}
                        onChange={(e) => setNewCustomPhaseName(e.target.value)}
                        placeholder="Custom phase name..."
                        className={`flex-1 rounded-lg px-2.5 py-1 text-xs border focus:border-amber-500 focus:outline-none ${isDark ? 'bg-slate-950 border-slate-700 text-white' : 'bg-white border-slate-300 text-slate-800'
                          }`}
                      />
                      <button
                        type="button"
                        onClick={() => {
                          const clean = newCustomPhaseName.trim();
                          if (clean) {
                            if (!constructionPhases.includes(clean)) {
                              setConstructionPhases(prev => [...prev, clean]);
                            }
                            setEditFormData(prev => ({ ...prev, constructionPhase: clean }));
                            setNewCustomPhaseName('');
                            setShowAddPhaseInput(false);
                          }
                        }}
                        className="px-2.5 py-1 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs cursor-pointer"
                      >
                        Add
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* Subtask / Phase Weight (%) */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className={`uppercase tracking-wider text-[10px] font-bold ${isDark ? 'text-slate-400' : 'text-slate-600'
                    }`}>
                    Phase / Subtask Weight (%) — Weighted Progress Share (e.g. Footing = 80%, Prep = 10%, Pouring = 10%)
                  </label>
                  <span className="font-bold text-emerald-400">{editFormData.weight}% Weight</span>
                </div>
                <div className="flex items-center gap-3">
                  <input
                    type="range"
                    min="1"
                    max="100"
                    value={editFormData.weight}
                    onChange={(e) => setEditFormData(prev => ({ ...prev, weight: parseInt(e.target.value, 10) || 10 }))}
                    className="flex-1 accent-emerald-500 cursor-pointer"
                  />
                  <input
                    type="number"
                    min="1"
                    max="100"
                    value={editFormData.weight}
                    onChange={(e) => setEditFormData(prev => ({ ...prev, weight: Math.max(1, Math.min(100, parseInt(e.target.value, 10) || 10)) }))}
                    className={`w-16 rounded-xl px-2 py-1 text-center font-bold border ${isDark ? 'bg-slate-950 border-slate-700 text-white' : 'bg-white border-slate-300 text-slate-800'
                      }`}
                  />
                </div>
              </div>

              {/* Progress Slider + Numeric Input */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className={`uppercase tracking-wider text-[10px] font-bold ${isDark ? 'text-slate-400' : 'text-slate-600'
                    }`}>
                    Progress Completion (%)
                  </label>
                  <span className={`font-bold ${isDark ? 'text-amber-400' : 'text-amber-600'}`}>{editFormData.progress}%</span>
                </div>
                <div className="flex items-center gap-3">
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={editFormData.progress}
                    onChange={(e) => setEditFormData(prev => ({ ...prev, progress: parseInt(e.target.value, 10) }))}
                    className="flex-1 accent-amber-500 cursor-pointer"
                  />
                  <input
                    type="number"
                    min="0"
                    max="100"
                    value={editFormData.progress}
                    onChange={(e) => setEditFormData(prev => ({ ...prev, progress: Math.max(0, Math.min(100, parseInt(e.target.value, 10) || 0)) }))}
                    className={`w-16 rounded-xl px-2 py-1 text-center font-bold border ${isDark ? 'bg-slate-950 border-slate-700 text-white' : 'bg-white border-slate-300 text-slate-800'
                      }`}
                  />
                </div>
              </div>

              {/* Contractor Assignment */}
              <div>
                <label className={`block uppercase tracking-wider text-[10px] mb-1 font-bold ${isDark ? 'text-slate-400' : 'text-slate-600'
                  }`}>
                  Assigned Contractor / Trade Crew
                </label>
                <select
                  value={editFormData.assignedContractorId}
                  onChange={(e) => setEditFormData(prev => ({ ...prev, assignedContractorId: e.target.value }))}
                  className={`w-full max-w-full truncate rounded-xl px-3 py-2 font-medium focus:border-amber-500 focus:outline-none cursor-pointer border ${isDark ? 'bg-slate-950 border-slate-700 text-white' : 'bg-white border-slate-300 text-slate-800'
                    }`}
                >
                  <option value="">LDM In-House Crew</option>
                  {contractors.map(c => {
                    const safeName = (c.name || '').length > 40 ? `${c.name.slice(0, 40)}…` : c.name;
                    const safeCompany = (c.company || c.specialty || 'Subcontractor');
                    const safeSub = safeCompany.length > 28 ? `${safeCompany.slice(0, 28)}…` : safeCompany;
                    return (
                      <option key={c.id} value={c.id} title={`${c.name} (${safeCompany})`}>
                        {safeName} ({safeSub})
                      </option>
                    );
                  })}
                </select>
              </div>

              {/* Predecessors / Dependencies */}
              <div>
                <label className={`block uppercase tracking-wider text-[10px] mb-1 font-bold flex items-center justify-between ${isDark ? 'text-slate-400' : 'text-slate-600'
                  }`}>
                  <span>Predecessors (Finish-to-Start Dependencies)</span>
                  <span className={`${isDark ? 'text-slate-500' : 'text-slate-400'} font-normal`}>Successor starts after predecessor finishes</span>
                </label>
                <div className={`rounded-xl p-3 max-h-36 overflow-y-auto space-y-1.5 border ${isDark ? 'bg-slate-950 border-slate-800' : 'bg-slate-50 border-slate-200'
                  }`}>
                  {tasks
                    .filter(t => {
                      if (t.id === editingTask.id) return false;
                      // Milestones should only link to parent tasks / milestones, not granular subtasks
                      if (editFormData.type === 'milestone' && t.parentTaskId) return false;
                      return true;
                    })
                    .map(t => {
                      const isChecked = editFormData.predecessorIds.includes(t.id);
                      return (
                        <label
                          key={t.id}
                          className={`flex items-center gap-2 p-1 rounded cursor-pointer transition ${isDark ? 'hover:bg-slate-900 text-slate-300' : 'hover:bg-slate-200/60 text-slate-700'
                            }`}
                        >
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setEditFormData(prev => ({
                                  ...prev,
                                  predecessorIds: [...prev.predecessorIds, t.id]
                                }));
                              } else {
                                setEditFormData(prev => ({
                                  ...prev,
                                  predecessorIds: prev.predecessorIds.filter(id => id !== t.id)
                                }));
                              }
                            }}
                            className="accent-amber-500 rounded cursor-pointer"
                          />
                          <span className={`text-[11px] font-mono font-bold ${isDark ? 'text-amber-400' : 'text-amber-700'
                            }`}>{t.wbsCode}</span>
                          <span className="text-xs truncate">{t.text}</span>
                          <span className={`text-[10px] ml-auto ${isDark ? 'text-slate-500' : 'text-slate-400'
                            }`}>({formatDateShort(t.endDate)})</span>
                        </label>
                      );
                    })}
                </div>
              </div>
            </div>

            {/* Modal Actions */}
            <div className={`px-5 py-4 border-t flex items-center justify-between gap-3 ${isDark ? 'border-slate-800 bg-slate-950' : 'border-slate-200 bg-slate-50'
              }`}>
              {isNewTaskDraft ? (
                <button
                  type="button"
                  onClick={() => { setEditingTask(null); setIsNewTaskDraft(false); }}
                  className={`px-3 py-2 font-medium rounded-xl text-xs border transition cursor-pointer ${isDark
                    ? 'bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white border-slate-700'
                    : 'bg-white hover:bg-slate-100 text-slate-600 border-slate-300 shadow-2xs'
                    }`}
                >
                  Discard Draft
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => handleDeleteTask(editingTask.id)}
                  className={`px-3 py-2 font-bold rounded-xl text-xs border transition cursor-pointer flex items-center gap-1.5 ${isDark
                    ? 'bg-rose-950/80 hover:bg-rose-900 text-rose-300 border-rose-800'
                    : 'bg-rose-50 hover:bg-rose-100 text-rose-700 border-rose-200 shadow-2xs'
                    }`}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Delete Task</span>
                </button>
              )}

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => { setEditingTask(null); setIsNewTaskDraft(false); }}
                  className={`px-4 py-2 font-medium rounded-xl text-xs border transition cursor-pointer ${isDark
                    ? 'bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700'
                    : 'bg-white hover:bg-slate-100 text-slate-700 border-slate-300 shadow-2xs'
                    }`}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSaveEditModal}
                  className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold rounded-xl text-xs transition cursor-pointer shadow-md shadow-amber-500/20"
                >
                  {isNewTaskDraft ? 'Create & Add to Schedule' : 'Save Changes'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {/* Multi-Preset Schedule Template Modal */}
      {isTemplateModalOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-fadeIn">
          <div className={`w-full max-w-xl rounded-2xl border shadow-2xl overflow-hidden ${isDark ? 'bg-slate-900 border-slate-800 text-slate-100' : 'bg-white border-slate-200 text-slate-900'}`}>
            <div className={`px-5 py-4 border-b flex items-center justify-between ${isDark ? 'border-slate-800 bg-slate-950/60' : 'border-slate-200 bg-slate-50'}`}>
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-amber-500/15 border border-amber-500/30 text-amber-400">
                  <Sparkles className="w-4 h-4" />
                </div>
                <div>
                  <h3 className={`text-sm font-bold ${isDark ? 'text-white' : 'text-slate-900'}`}>Load Schedule Template</h3>
                  <p className={`text-xs ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                    Choose a preset &amp; start date — all tasks initialize at 0% progress in one bulk sync.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => !isApplyingTemplate && setIsTemplateModalOpen(false)}
                className={`p-1.5 rounded-lg transition cursor-pointer ${isDark ? 'text-slate-400 hover:text-white hover:bg-slate-800' : 'text-slate-500 hover:text-slate-900 hover:bg-slate-100'}`}
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              {/* Schedule Start Date Picker */}
              <div>
                <label className={`block text-[11px] font-mono font-bold uppercase tracking-wider mb-1.5 ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
                  Schedule Start Date
                </label>
                <input
                  type="date"
                  value={templateStartDate}
                  onChange={(e) => setTemplateStartDate(e.target.value)}
                  className={`w-full rounded-xl px-3.5 py-2 text-xs font-mono border focus:outline-none focus:border-amber-500 ${isDark ? 'bg-slate-950 border-slate-700 text-white' : 'bg-white border-slate-300 text-slate-900'}`}
                />
              </div>

              {/* Preset Selection Grid */}
              <div className="space-y-2">
                <span className={`block text-[11px] font-mono font-bold uppercase tracking-wider ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
                  Construction Schedule Preset
                </span>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {TEMPLATE_PRESETS.map((preset) => {
                    const isSelected = selectedTemplatePreset === preset.id;
                    return (
                      <button
                        key={preset.id}
                        type="button"
                        onClick={() => setSelectedTemplatePreset(preset.id)}
                        className={`text-left p-3.5 rounded-xl border transition cursor-pointer space-y-1 ${isSelected
                          ? isDark
                            ? 'bg-amber-500/10 border-amber-500/60 ring-1 ring-amber-500/40'
                            : 'bg-amber-50 border-amber-400 ring-1 ring-amber-300'
                          : isDark
                            ? 'bg-slate-950/60 border-slate-800 hover:border-slate-700'
                            : 'bg-slate-50 border-slate-200 hover:border-slate-300'
                          }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className={`text-xs font-bold ${isSelected ? (isDark ? 'text-amber-300' : 'text-amber-900') : (isDark ? 'text-white' : 'text-slate-900')}`}>
                            {preset.name}
                          </span>
                          <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded shrink-0 ${isDark ? 'bg-slate-800 text-slate-300' : 'bg-slate-200/80 text-slate-700'}`}>
                            {preset.tasks.length} tasks
                          </span>
                        </div>
                        <p className={`text-[11px] leading-snug ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
                          {preset.subtitle}
                        </p>
                        <div className="text-[10px] font-mono text-amber-400 pt-0.5">
                          Est. {preset.estimatedDuration} • 6-day workweek
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {tasks.length > 0 && (
                <div className={`p-3 rounded-xl border text-[11px] flex items-center gap-2 ${isDark ? 'bg-amber-950/30 border-amber-500/30 text-amber-200' : 'bg-amber-50 border-amber-200 text-amber-800'}`}>
                  <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                  <span>Applying a template replaces the {tasks.length} existing task(s) in this project schedule.</span>
                </div>
              )}
            </div>

            <div className={`px-5 py-3.5 border-t flex items-center justify-end gap-2 ${isDark ? 'border-slate-800 bg-slate-950/60' : 'border-slate-200 bg-slate-50'}`}>
              <button
                type="button"
                disabled={isApplyingTemplate}
                onClick={() => setIsTemplateModalOpen(false)}
                className={`px-4 py-2 rounded-xl text-xs font-medium border transition cursor-pointer ${isDark ? 'bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700' : 'bg-white hover:bg-slate-100 text-slate-700 border-slate-300'}`}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isApplyingTemplate || !templateStartDate}
                onClick={handleApplyTemplatePreset}
                className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-60 text-slate-950 font-bold text-xs transition cursor-pointer flex items-center gap-2 shadow-sm"
              >
                {isApplyingTemplate ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Applying Template...</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>Apply Template</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
