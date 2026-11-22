/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { broadcastChange, invalidateAllDataCache } from '../events';
import { requireAuth, requireRole, checkUserProjectAccess, hasProjectManagementAccess } from '../middleware/auth';

const GANTT_CACHE_TTL_MS = 60_000;
const ganttCache = new Map<string, { data: any[]; links: any[]; ts: number }>();

export function invalidateGanttCache(projectId?: string) {
  if (projectId) {
    ganttCache.delete(projectId);
  } else {
    ganttCache.clear();
  }
}

export function createGanttRouter(prisma: PrismaClient) {
  const router = Router();

  // Apply authentication to all Gantt routes
  router.use(requireAuth);

  function formatGanttDate(date: Date | string | null | undefined): string {
    if (!date) return '';
    const d = new Date(date);
    if (isNaN(d.getTime())) return '';
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd} ${hh}:${min}`;
  }

  // Helper to add working days (Mon-Sat, skipping Sundays)
  function addWorkingDays(startDate: Date, days: number): Date {
    const result = new Date(startDate);
    let added = 0;
    while (added < days) {
      result.setDate(result.getDate() + 1);
      if (result.getDay() !== 0) { // Skip Sunday (0)
        added++;
      }
    }
    return result;
  }

  /**
   * GET /api/projects/:projectId/gantt
   * Returns { data: tasks, links: links } formatted for Gantt engine
   */
  router.get('/:projectId/gantt', async (req: Request, res: Response) => {
    try {
      const { projectId } = req.params;
      if (!projectId) {
        return res.json({ data: [], links: [] });
      }

      if (!hasProjectManagementAccess(req.user) && !checkUserProjectAccess(req.user, projectId)) {
        return res.status(403).json({ error: 'Forbidden: You do not have access to this project.' });
      }

      // Fast-path in-memory cache hit (<5ms)
      const cached = ganttCache.get(projectId);
      if (cached && Date.now() - cached.ts < GANTT_CACHE_TTL_MS && req.query.fresh !== '1') {
        return res.json({ data: cached.data, links: cached.links });
      }

      const existingProject = await prisma.commercialProject.findUnique({ where: { id: projectId } });
      if (!existingProject) {
        return res.json({ data: [], links: [] });
      }

      let tasks = await prisma.projectTask.findMany({
        where: { projectId },
        include: { assignedContractor: true },
        orderBy: { sortOrder: 'asc' }
      });

      let links = await prisma.taskLink.findMany({
        where: { projectId }
      });

      // If no tasks exist, return empty lists without injecting sample data
      // Tasks and schedule milestones can be added manually or imported by the user.

      // Format payload directly for gantt.parse({ data, links })
      const data = tasks.map(t => {
        const isMilestone = t.type === 'milestone' || t.duration === 0;
        return {
          id: t.id,
          text: t.text,
          start_date: formatGanttDate(t.startDate),
          end_date: formatGanttDate(t.endDate),
          duration: t.duration,
          progress: typeof t.progress === 'number' ? t.progress : 0,
          weight: typeof (t as any).weight === 'number' ? (t as any).weight : null,
          status: t.status || ((typeof t.progress === 'number' && t.progress >= 1.0) ? 'COMPLETED' : (typeof t.progress === 'number' && t.progress > 0) ? 'IN_PROGRESS' : 'TODO'),
          parent: t.parentTaskId || 0,
          type: isMilestone ? 'milestone' : t.type || 'task',
          wbsCode: t.wbsCode || '',
          milestonePhase: t.milestonePhase || '',
          assignedContractorId: t.assignedContractorId || '',
          contractor: t.assignedContractor?.name || (t.assignedContractorId ? 'Assigned Contractor' : 'CTVill In-House Crew'),
          baselineStart: t.baselineStart ? formatGanttDate(t.baselineStart) : null,
          baselineEnd: t.baselineEnd ? formatGanttDate(t.baselineEnd) : null,
          sortOrder: t.sortOrder
        };
      });

      const formattedLinks = links.map(l => ({
        id: l.id,
        source: l.sourceId,
        target: l.targetId,
        type: l.type || '0',
        lag: l.lagDays || 0
      }));

      ganttCache.set(projectId, {
        data,
        links: formattedLinks,
        ts: Date.now(),
      });

      res.json({
        data,
        links: formattedLinks
      });
    } catch (error) {
      console.error('Error fetching Gantt data:', error);
      res.status(500).json({ error: 'Failed to retrieve Gantt chart data' });
    }
  });

  /**
   * POST /api/projects/:projectId/gantt/sync
   * Unified sync handler supporting:
   * 1. Granular events: { action: 'create' | 'update' | 'delete', entityType: 'task' | 'link', data: any }
   * 2. Batch payload: { tasks: [...], links: [...], deletedTaskIds: [...], deletedLinkIds: [...] }
   */
  router.post('/:projectId/gantt/sync', requireRole(['ADMIN', 'OPERATIONS_MANAGER', 'PROJECT_MANAGER', 'ENGINEER']), async (req: Request, res: Response) => {
    try {
      const { projectId } = req.params;
      const { action, entityType, data, tasks = [], links = [], deletedTaskIds = [], deletedLinkIds = [] } = req.body;

      if (!projectId) {
        return res.status(400).json({ error: 'Project ID is required' });
      }

      if (!hasProjectManagementAccess(req.user) && !checkUserProjectAccess(req.user, projectId)) {
        return res.status(403).json({ error: 'Forbidden: You do not have access to this project.' });
      }

      const existingProject = await prisma.commercialProject.findUnique({ where: { id: projectId } });
      if (!existingProject) {
        // Project exists only in client/demo storage — acknowledge cleanly without failing UI
        return res.json({ success: true, localOnly: true, result: { tasksCount: tasks.length } });
      }

      const effectiveEntityType = entityType || (req.body.task ? 'task' : req.body.link ? 'link' : undefined);
      const effectiveData = data || req.body.task || req.body.link;

      // Handle Single Granular Action (DataProcessor / Drag & Drop Event)
      if (action && effectiveEntityType) {
        const opResult = await prisma.$transaction(async (tx) => {
          if (effectiveEntityType === 'task') {
            const taskId = String(effectiveData?.id || '');
            if (action === 'delete') {
              if (taskId) {
                // Delete connected dependency links first (strictly scoped to projectId)
                await tx.taskLink.deleteMany({
                  where: {
                    projectId,
                    OR: [{ sourceId: taskId }, { targetId: taskId }]
                  }
                });
                await tx.projectTask.deleteMany({
                  where: { id: taskId, projectId }
                });
              }
            } else if (action === 'create') {
              const id = taskId || `task-${Date.now()}`;
              const startRaw = effectiveData?.startDate || effectiveData?.start_date;
              const endRaw = effectiveData?.endDate || effectiveData?.end_date;
              const parsedStart = startRaw ? new Date(startRaw) : new Date();
              const startDate = isNaN(parsedStart.getTime()) ? new Date() : parsedStart;
              const isMilestone = effectiveData?.type === 'milestone' || parseInt(String(effectiveData?.duration ?? 1), 10) === 0;
              const duration = isMilestone ? 0 : Math.max(1, parseInt(String(effectiveData?.duration ?? 1), 10));
              const parsedEnd = endRaw ? new Date(endRaw) : addWorkingDays(startDate, duration);
              const endDate = isMilestone ? startDate : (isNaN(parsedEnd.getTime()) ? addWorkingDays(startDate, duration) : parsedEnd);
              let progress = Math.max(0, Math.min(1, parseFloat(String(effectiveData?.progress ?? 0)) || 0));
              let status = effectiveData?.status;
              if (status === 'COMPLETED' && (!effectiveData?.progress || progress < 1.0)) {
                progress = 1.0;
              } else if (progress >= 1.0) {
                status = 'COMPLETED';
              } else if (status === undefined) {
                status = progress > 0 ? 'IN_PROGRESS' : 'TODO';
              }
              const rawParentId = effectiveData?.parent && effectiveData.parent !== 0 && effectiveData.parent !== '0'
                ? String(effectiveData.parent)
                : (effectiveData?.parentTaskId ? String(effectiveData.parentTaskId) : null);
              let safeParentId: string | null = null;
              if (rawParentId && rawParentId !== id) {
                const parentExists = await tx.projectTask.findFirst({ where: { id: rawParentId, projectId }, select: { id: true } });
                if (parentExists) safeParentId = rawParentId;
              }
              let safeContractorId: string | null = null;
              if (effectiveData?.assignedContractorId) {
                const cExists = await tx.contractor.findUnique({ where: { id: String(effectiveData.assignedContractorId) }, select: { id: true } });
                if (cExists) safeContractorId = String(effectiveData.assignedContractorId);
              }
              const type = (duration === 0 || effectiveData?.type === 'milestone') ? 'milestone' : (effectiveData?.type || 'task');

              await tx.projectTask.create({
                data: {
                  id,
                  projectId,
                  text: effectiveData?.text || 'New Construction Task',
                  title: effectiveData?.text || 'New Construction Task',
                  startDate,
                  endDate,
                  duration,
                  progress,
                  ...(typeof effectiveData?.weight === 'number' ? { weight: effectiveData.weight } : {}),
                  status,
                  type,
                  parentTaskId: safeParentId,
                  wbsCode: effectiveData?.wbsCode || null,
                  milestonePhase: effectiveData?.milestonePhase || effectiveData?.constructionPhase || null,
                  assignedContractorId: safeContractorId,
                  sortOrder: Number(effectiveData?.sortOrder ?? 0)
                }
              });

              // Predecessors linking (strictly scoped to projectId)
              if (Array.isArray(effectiveData?.predecessorIds) && effectiveData.predecessorIds.length > 0) {
                for (let idx = 0; idx < effectiveData.predecessorIds.length; idx++) {
                  const predId = effectiveData.predecessorIds[idx];
                  if (!predId || predId === id) continue;
                  const predExists = await tx.projectTask.findFirst({ where: { id: String(predId), projectId }, select: { id: true } });
                  if (predExists) {
                    await tx.taskLink.create({
                      data: {
                        id: `link-${predId}-${id}-${Date.now()}-${idx}`,
                        projectId,
                        sourceId: String(predId),
                        targetId: id,
                        type: '0',
                        lagDays: 0
                      }
                    });
                  }
                }
              }
            } else if (action === 'update') {
              if (taskId) {
                const existingOwner = await tx.projectTask.findUnique({ where: { id: taskId }, select: { projectId: true } });
                if (existingOwner && existingOwner.projectId !== projectId) {
                  // Never overwrite a task owned by a different project
                  return null;
                }
                const startRaw = effectiveData?.startDate || effectiveData?.start_date;
                const endRaw = effectiveData?.endDate || effectiveData?.end_date;
                const parsedStart = startRaw ? new Date(startRaw) : new Date();
                const startDate = isNaN(parsedStart.getTime()) ? new Date() : parsedStart;
                const isMilestone = effectiveData?.type === 'milestone' || (effectiveData?.duration !== undefined && parseInt(String(effectiveData.duration), 10) === 0);
                const duration = isMilestone ? 0 : (effectiveData?.duration !== undefined ? Math.max(1, parseInt(String(effectiveData.duration), 10) || 1) : 1);
                const parsedEnd = endRaw ? new Date(endRaw) : addWorkingDays(startDate, duration);
                const endDate = isMilestone ? startDate : (isNaN(parsedEnd.getTime()) ? addWorkingDays(startDate, duration) : parsedEnd);
                const hasExplicitProgress = effectiveData?.progress !== undefined;
                let progress = hasExplicitProgress ? Math.max(0, Math.min(1, parseFloat(String(effectiveData.progress)) || 0)) : undefined;
                let derivedStatus = effectiveData?.status;
                if (derivedStatus === 'COMPLETED' && (progress === undefined || progress < 1.0)) {
                  progress = 1.0;
                } else if (progress !== undefined && progress >= 1.0) {
                  derivedStatus = 'COMPLETED';
                } else if (progress !== undefined && progress < 1.0 && derivedStatus === 'COMPLETED') {
                  derivedStatus = progress > 0 ? 'IN_PROGRESS' : 'TODO';
                } else if (derivedStatus === undefined && progress !== undefined) {
                  derivedStatus = progress > 0 ? 'IN_PROGRESS' : 'TODO';
                }
                const rawParentId = effectiveData?.parent !== undefined
                  ? (effectiveData.parent && effectiveData.parent !== 0 && effectiveData.parent !== '0' ? String(effectiveData.parent) : null)
                  : (effectiveData?.parentTaskId !== undefined ? effectiveData.parentTaskId : undefined);
                let safeParentId: string | null | undefined = rawParentId === undefined ? undefined : null;
                if (rawParentId && rawParentId !== taskId) {
                  const parentExists = await tx.projectTask.findFirst({ where: { id: String(rawParentId), projectId }, select: { id: true } });
                  if (parentExists) safeParentId = String(rawParentId);
                }
                let safeContractorId: string | null | undefined = effectiveData?.assignedContractorId === undefined ? undefined : null;
                if (effectiveData?.assignedContractorId) {
                  const cExists = await tx.contractor.findUnique({ where: { id: String(effectiveData.assignedContractorId) }, select: { id: true } });
                  if (cExists) safeContractorId = String(effectiveData.assignedContractorId);
                }
                const type = (duration === 0 || effectiveData?.type === 'milestone') ? 'milestone' : (effectiveData?.type || 'task');

                await tx.projectTask.upsert({
                  where: { id: taskId },
                  update: {
                    ...(effectiveData?.text !== undefined ? { text: effectiveData.text, title: effectiveData.text } : {}),
                    ...(startRaw && !isNaN(parsedStart.getTime()) ? { startDate } : {}),
                    ...(endRaw && !isNaN(parsedEnd.getTime()) ? { endDate } : {}),
                    ...(effectiveData?.duration !== undefined ? { duration } : {}),
                    ...(progress !== undefined ? { progress } : {}),
                    ...(effectiveData?.weight !== undefined && effectiveData?.weight !== null ? { weight: Number(effectiveData.weight) } : {}),
                    ...(derivedStatus !== undefined ? { status: derivedStatus } : {}),
                    ...(effectiveData?.type !== undefined ? { type } : {}),
                    ...(safeParentId !== undefined ? { parentTaskId: safeParentId } : {}),
                    ...(effectiveData?.wbsCode !== undefined ? { wbsCode: effectiveData.wbsCode } : {}),
                    ...(effectiveData?.milestonePhase !== undefined || effectiveData?.constructionPhase !== undefined
                      ? { milestonePhase: effectiveData.milestonePhase || effectiveData.constructionPhase || null }
                      : {}),
                    ...(safeContractorId !== undefined ? { assignedContractorId: safeContractorId } : {}),
                    ...(effectiveData?.sortOrder !== undefined ? { sortOrder: Number(effectiveData.sortOrder) } : {}),
                    updatedAt: new Date()
                  },
                  create: {
                    id: taskId,
                    projectId,
                    text: effectiveData?.text || 'New Construction Task',
                    title: effectiveData?.text || 'New Construction Task',
                    startDate,
                    endDate,
                    duration,
                    progress: progress ?? 0,
                    status: derivedStatus || (progress !== undefined && progress >= 1.0 ? 'COMPLETED' : progress !== undefined && progress > 0 ? 'IN_PROGRESS' : 'TODO'),
                    type,
                    parentTaskId: safeParentId || null,
                    wbsCode: effectiveData?.wbsCode || null,
                    milestonePhase: effectiveData?.milestonePhase || effectiveData?.constructionPhase || null,
                    assignedContractorId: safeContractorId || null,
                    sortOrder: Number(effectiveData?.sortOrder ?? 0)
                  }
                });

                // Update predecessor links if explicitly supplied
                if (Array.isArray(effectiveData?.predecessorIds)) {
                  await tx.taskLink.deleteMany({
                    where: { targetId: taskId, projectId }
                  });
                  for (let idx = 0; idx < effectiveData.predecessorIds.length; idx++) {
                    const predId = effectiveData.predecessorIds[idx];
                    if (predId && predId !== taskId) {
                      const predExists = await tx.projectTask.findFirst({ where: { id: String(predId), projectId }, select: { id: true } });
                      if (predExists) {
                        await tx.taskLink.create({
                          data: {
                            id: `link-${predId}-${taskId}-${Date.now()}-${idx}`,
                            projectId,
                            sourceId: String(predId),
                            targetId: taskId,
                            type: '0',
                            lagDays: 0
                          }
                        });
                      }
                    }
                  }
                }
              }
            }
          } else if (effectiveEntityType === 'link') {
            const linkId = String(effectiveData?.id || '');
            if (action === 'delete') {
              if (linkId) {
                await tx.taskLink.deleteMany({
                  where: { id: linkId, projectId }
                });
              }
            } else if (action === 'create') {
              const id = linkId || `link-${Date.now()}`;
              const source = effectiveData?.source || effectiveData?.sourceId;
              const target = effectiveData?.target || effectiveData?.targetId;
              if (source && target) {
                await tx.taskLink.create({
                  data: {
                    id,
                    projectId,
                    sourceId: String(source),
                    targetId: String(target),
                    type: String(effectiveData.type ?? '0'),
                    lagDays: parseInt(String(effectiveData.lag ?? effectiveData.lagDays ?? 0), 10)
                  }
                });
              }
            } else if (action === 'update') {
              const source = effectiveData?.source || effectiveData?.sourceId;
              const target = effectiveData?.target || effectiveData?.targetId;
              if (linkId && source && target) {
                await tx.taskLink.updateMany({
                  where: { id: linkId, projectId },
                  data: {
                    sourceId: String(source),
                    targetId: String(target),
                    type: String(effectiveData.type ?? '0'),
                    lagDays: parseInt(String(effectiveData.lag ?? effectiveData.lagDays ?? 0), 10)
                  }
                });
              }
            }
          }

          // Recalculate summary metrics for commercial_projects using leaf tasks
          const allTasks = await tx.projectTask.findMany({ where: { projectId } });
          const parentIds = new Set(allTasks.map(t => t.parentTaskId).filter(Boolean));
          const leafTasks = allTasks.filter(t => !parentIds.has(t.id));
          const targetTasks = leafTasks.length > 0 ? leafTasks : allTasks;
          let avgProgress = 0;
          if (targetTasks.length > 0) {
            const totalDuration = targetTasks.reduce((acc, curr) => acc + Math.max(1, curr.duration || 1), 0);
            const weightedProgress = targetTasks.reduce((acc, curr) => {
              let p = 0;
              if (curr.status === 'COMPLETED') {
                p = 1.0;
              } else {
                const raw = typeof curr.progress === 'number' ? curr.progress : 0;
                p = raw > 1.0 ? Math.min(1.0, raw / 100) : Math.max(0, Math.min(1.0, raw));
              }
              return acc + (p * Math.max(1, curr.duration || 1));
            }, 0);
            avgProgress = totalDuration > 0 ? Math.round((weightedProgress / totalDuration) * 100) : 0;
          }
          const existingProj = await tx.commercialProject.findUnique({ where: { id: projectId } });
          const isCompletedProj = existingProj?.status === 'COMPLETED' || existingProj?.status === 'HANDED_OVER';
          const finalProgress = isCompletedProj ? 100 : avgProgress;
          const shouldAdvanceStatus = finalProgress > 0 && (!existingProj?.status || existingProj.status === 'PLANNING');
          await tx.commercialProject.update({
            where: { id: projectId },
            data: {
              progressPercentage: finalProgress,
              tasksCount: allTasks.length,
              ...(shouldAdvanceStatus ? { status: 'IN_PROGRESS' } : {})
            }
          }).catch(() => { });

          const freshTasks = await tx.projectTask.findMany({
            where: { projectId },
            include: { assignedContractor: true },
            orderBy: { sortOrder: 'asc' }
          });
          const freshLinks = await tx.taskLink.findMany({ where: { projectId } });

          return {
            action,
            entityType: effectiveEntityType,
            id: effectiveData?.id,
            projectProgress: avgProgress,
            tasksCount: freshTasks.length,
            data: freshTasks.map(t => {
              const isMilestone = t.type === 'milestone' || t.duration === 0;
              return {
                id: t.id,
                text: t.text,
                start_date: formatGanttDate(t.startDate),
                end_date: formatGanttDate(t.endDate),
                duration: t.duration,
                progress: typeof t.progress === 'number' ? t.progress : 0,
                weight: typeof (t as any).weight === 'number' ? (t as any).weight : null,
                status: t.status || ((typeof t.progress === 'number' && t.progress >= 1.0) ? 'COMPLETED' : (typeof t.progress === 'number' && t.progress > 0) ? 'IN_PROGRESS' : 'TODO'),
                parent: t.parentTaskId || 0,
                type: isMilestone ? 'milestone' : t.type || 'task',
                wbsCode: t.wbsCode || '',
                milestonePhase: t.milestonePhase || '',
                assignedContractorId: t.assignedContractorId || '',
                contractor: t.assignedContractor?.name || (t.assignedContractorId ? 'Assigned Contractor' : 'LDM Construction Crew'),
                baselineStart: t.baselineStart ? formatGanttDate(t.baselineStart) : null,
                baselineEnd: t.baselineEnd ? formatGanttDate(t.baselineEnd) : null,
                sortOrder: t.sortOrder
              };
            }),
            links: freshLinks.map(l => ({
              id: l.id,
              source: l.sourceId,
              target: l.targetId,
              type: l.type || '0',
              lag: l.lagDays || 0
            }))
          };
        });

        if (!opResult) {
          return res.status(409).json({
            error: 'Task belongs to a different project and cannot be modified under this projectId.'
          });
        }

        ganttCache.set(projectId, {
          data: opResult.data,
          links: opResult.links,
          ts: Date.now(),
        });
        broadcastChange('tasks');
        broadcastChange('projects');
        invalidateAllDataCache();

        return res.json({
          success: true,
          message: `Successfully processed ${action} on ${effectiveEntityType}.`,
          result: opResult,
          data: opResult.data,
          links: opResult.links,
          syncedAt: new Date().toISOString()
        });
      }

      // Handle Bulk / Full State Batch Sync (Auto-Migration & Full Schedule Save)
      const result = await prisma.$transaction(async (tx) => {
        // 1. Delete removed links
        if (Array.isArray(deletedLinkIds) && deletedLinkIds.length > 0) {
          await tx.taskLink.deleteMany({
            where: {
              id: { in: deletedLinkIds },
              projectId
            }
          });
        }

        // 2. Delete removed tasks
        if (Array.isArray(deletedTaskIds) && deletedTaskIds.length > 0) {
          await tx.projectTask.deleteMany({
            where: {
              id: { in: deletedTaskIds },
              projectId
            }
          });
        }

        // 3. Batch-resolve existing task owners & contractors in 2 queries (eliminating N+1 roundtrips)
        const orderedIncomingTasks = [...tasks].sort((a: any, b: any) => {
          const aHasParent = Boolean(a.parentTaskId || (a.parent && a.parent !== 0 && a.parent !== '0'));
          const bHasParent = Boolean(b.parentTaskId || (b.parent && b.parent !== 0 && b.parent !== '0'));
          if (aHasParent !== bHasParent) return aHasParent ? 1 : -1;
          return Number(a.sortOrder ?? 0) - Number(b.sortOrder ?? 0);
        });

        const incomingIds = orderedIncomingTasks.map((t: any) => String(t.id)).filter(Boolean);
        const incomingContractorIds = Array.from(
          new Set(orderedIncomingTasks.map((t: any) => (t.assignedContractorId ? String(t.assignedContractorId) : '')).filter(Boolean))
        );

        const [existingTasksRows, existingProjectTaskRows, validContractorsRows] = await Promise.all([
          incomingIds.length > 0
            ? tx.projectTask.findMany({ where: { id: { in: incomingIds } }, select: { id: true, projectId: true } })
            : Promise.resolve([]),
          tx.projectTask.findMany({ where: { projectId }, select: { id: true } }),
          incomingContractorIds.length > 0
            ? tx.contractor.findMany({ where: { id: { in: incomingContractorIds } }, select: { id: true } })
            : Promise.resolve([])
        ]);

        const ownerByTaskId = new Map<string, string>(existingTasksRows.map(r => [r.id, r.projectId]));
        const knownProjectTaskIds = new Set<string>(existingProjectTaskRows.map(r => r.id));
        const validContractorIds = new Set<string>(validContractorsRows.map(r => r.id));

        const tasksToCreate: any[] = [];
        const tasksToUpdate: Array<{ id: string; data: any }> = [];

        for (let idx = 0; idx < orderedIncomingTasks.length; idx++) {
          const t = orderedIncomingTasks[idx];
          if (!t.id) continue;
          const taskIdStr = String(t.id);

          // Never overwrite a task belonging to a different project
          const existingOwnerProjectId = ownerByTaskId.get(taskIdStr);
          if (existingOwnerProjectId && existingOwnerProjectId !== projectId) {
            continue;
          }

          const startRaw = t.start_date || t.startDate;
          const endRaw = t.end_date || t.endDate;
          const parsedStart = startRaw ? new Date(startRaw) : new Date();
          const startDate = isNaN(parsedStart.getTime()) ? new Date() : parsedStart;
          const duration = Math.max(0, parseInt(String(t.duration ?? 1), 10) || 0);
          const parsedEnd = endRaw ? new Date(endRaw) : addWorkingDays(startDate, duration || 1);
          const endDate = isNaN(parsedEnd.getTime()) ? addWorkingDays(startDate, duration || 1) : parsedEnd;

          const rawParentId =
            t.parent && t.parent !== 0 && t.parent !== '0'
              ? String(t.parent)
              : t.parentTaskId
                ? String(t.parentTaskId)
                : null;
          const safeParentId =
            rawParentId && rawParentId !== taskIdStr && knownProjectTaskIds.has(rawParentId)
              ? rawParentId
              : null;

          const safeContractorId =
            t.assignedContractorId && validContractorIds.has(String(t.assignedContractorId))
              ? String(t.assignedContractorId)
              : null;

          const rawProg = parseFloat(String(t.progress ?? 0)) || 0;
          const progress = Math.max(0, Math.min(1, rawProg > 1 ? rawProg / 100 : rawProg));
          const status = progress >= 1.0
            ? 'COMPLETED'
            : (t.status === 'COMPLETED' && progress < 1.0)
              ? (progress > 0 ? 'IN_PROGRESS' : 'TODO')
              : (t.status || (progress > 0 ? 'IN_PROGRESS' : 'TODO'));
          const type = (duration === 0 || t.type === 'milestone') ? 'milestone' : (t.type || 'task');

          const parsedBaselineStart = t.baselineStart ? new Date(t.baselineStart) : startDate;
          const parsedBaselineEnd = t.baselineEnd ? new Date(t.baselineEnd) : endDate;
          const baselineStart = isNaN(parsedBaselineStart.getTime()) ? startDate : parsedBaselineStart;
          const baselineEnd = isNaN(parsedBaselineEnd.getTime()) ? endDate : parsedBaselineEnd;

          knownProjectTaskIds.add(taskIdStr);

          const baseFields = {
            text: t.text || t.title || 'Untitled Construction Task',
            title: t.text || t.title || 'Untitled Construction Task',
            startDate,
            endDate,
            baselineStart,
            baselineEnd,
            duration,
            progress,
            ...(t.weight !== undefined && t.weight !== null ? { weight: Number(t.weight) } : {}),
            status,
            type,
            parentTaskId: safeParentId,
            wbsCode: t.wbsCode || null,
            milestonePhase: t.milestonePhase || t.constructionPhase || null,
            assignedContractorId: safeContractorId,
            sortOrder: typeof t.sortOrder === 'number' ? t.sortOrder : idx
          };

          if (existingOwnerProjectId === projectId) {
            tasksToUpdate.push({ id: taskIdStr, data: { ...baseFields, updatedAt: new Date() } });
          } else {
            tasksToCreate.push({ id: taskIdStr, projectId, ...baseFields });
          }
        }

        // Batch-create roots first, then children, so parentTaskId FK constraints are always satisfied in 1-2 SQL statements
        const rootCreates = tasksToCreate.filter(r => !r.parentTaskId);
        const childCreates = tasksToCreate.filter(r => Boolean(r.parentTaskId));
        if (rootCreates.length > 0) {
          await tx.projectTask.createMany({ data: rootCreates, skipDuplicates: true });
        }
        if (childCreates.length > 0) {
          await tx.projectTask.createMany({ data: childCreates, skipDuplicates: true });
        }
        if (tasksToUpdate.length > 0) {
          await Promise.all(
            tasksToUpdate.map((upd) => tx.projectTask.update({ where: { id: upd.id }, data: upd.data }))
          );
        }

        // 4. Upsert explicit links & task predecessorIds
        const normalizedLinks: Array<{ id: string; source: string; target: string; type: string; lag: number }> = [];
        for (const l of links) {
          if (!l.source || !l.target) continue;
          normalizedLinks.push({
            id: String(l.id || `link-${l.source}-${l.target}`),
            source: String(l.source),
            target: String(l.target),
            type: String(l.type !== undefined ? l.type : '0'),
            lag: parseInt(String(l.lag ?? l.lagDays ?? 0), 10) || 0,
          });
        }
        for (const t of orderedIncomingTasks) {
          if (Array.isArray(t.predecessorIds)) {
            for (const predId of t.predecessorIds) {
              if (!predId || String(predId) === String(t.id)) continue;
              const linkKey = `link-${predId}-${t.id}`;
              if (!normalizedLinks.some(nl => nl.source === String(predId) && nl.target === String(t.id))) {
                normalizedLinks.push({
                  id: linkKey,
                  source: String(predId),
                  target: String(t.id),
                  type: '0',
                  lag: 0,
                });
              }
            }
          }
        }
        const validLinksToCreate = normalizedLinks
          .filter(l => knownProjectTaskIds.has(l.source) && knownProjectTaskIds.has(l.target))
          .map(l => ({
            id: l.id,
            projectId,
            sourceId: l.source,
            targetId: l.target,
            type: l.type,
            lagDays: l.lag
          }));
        if (validLinksToCreate.length > 0) {
          await tx.taskLink.createMany({ data: validLinksToCreate, skipDuplicates: true });
        }

        // 5. Recalculate average progress & return fresh DB state
        const freshTasks = await tx.projectTask.findMany({
          where: { projectId },
          include: { assignedContractor: true },
          orderBy: { sortOrder: 'asc' }
        });
        const freshLinks = await tx.taskLink.findMany({ where: { projectId } });

        let avgProgress = 0;
        if (freshTasks.length > 0) {
          const parentIds = new Set(freshTasks.map(t => t.parentTaskId).filter(Boolean));
          const leafTasks = freshTasks.filter(t => !parentIds.has(t.id));
          const targetTasks = leafTasks.length > 0 ? leafTasks : freshTasks;
          const totalDuration = targetTasks.reduce((acc, curr) => acc + Math.max(1, curr.duration || 1), 0);
          const weightedProgress = targetTasks.reduce((acc, curr) => {
            let p = 0;
            if (curr.status === 'COMPLETED') {
              p = 1.0;
            } else {
              const raw = typeof curr.progress === 'number' ? curr.progress : 0;
              p = raw > 1.0 ? Math.min(1.0, raw / 100) : Math.max(0, Math.min(1.0, raw));
            }
            return acc + p * Math.max(1, curr.duration || 1);
          }, 0);
          avgProgress = totalDuration > 0 ? Math.round((weightedProgress / totalDuration) * 100) : 0;
        }

        const existingProj = await tx.commercialProject.findUnique({ where: { id: projectId } });
        const isCompletedProj = existingProj?.status === 'COMPLETED' || existingProj?.status === 'HANDED_OVER';
        const finalProgress = isCompletedProj ? 100 : avgProgress;

        // Always persist computed progress & task count (including 0 when all tasks are cleared)
        await tx.commercialProject.update({
          where: { id: projectId },
          data: {
            progressPercentage: finalProgress,
            tasksCount: freshTasks.length
          }
        }).catch(() => { });

        return {
          tasksCount: freshTasks.length,
          linksCount: freshLinks.length,
          projectProgress: avgProgress,
          data: freshTasks.map(t => {
            const isMilestone = t.type === 'milestone' || t.duration === 0;
            return {
              id: t.id,
              text: t.text,
              start_date: formatGanttDate(t.startDate),
              end_date: formatGanttDate(t.endDate),
              duration: t.duration,
              progress: typeof t.progress === 'number' ? t.progress : 0,
              weight: typeof (t as any).weight === 'number' ? (t as any).weight : null,
              status: t.status || ((typeof t.progress === 'number' && t.progress >= 1.0) ? 'COMPLETED' : (typeof t.progress === 'number' && t.progress > 0) ? 'IN_PROGRESS' : 'TODO'),
              parent: t.parentTaskId || 0,
              type: isMilestone ? 'milestone' : t.type || 'task',
              wbsCode: t.wbsCode || '',
              milestonePhase: t.milestonePhase || '',
              assignedContractorId: t.assignedContractorId || '',
              contractor: t.assignedContractor?.name || (t.assignedContractorId ? 'Assigned Contractor' : 'LDM Construction Crew'),
              baselineStart: t.baselineStart ? formatGanttDate(t.baselineStart) : null,
              baselineEnd: t.baselineEnd ? formatGanttDate(t.baselineEnd) : null,
              sortOrder: t.sortOrder
            };
          }),
          links: freshLinks.map(l => ({
            id: l.id,
            source: l.sourceId,
            target: l.targetId,
            type: l.type || '0',
            lag: l.lagDays || 0
          }))
        };
      }, { maxWait: 15000, timeout: 30000 });

      ganttCache.set(projectId, {
        data: result.data,
        links: result.links,
        ts: Date.now(),
      });
      invalidateAllDataCache();
      broadcastChange('gantt', { projectId });
      broadcastChange('tasks');
      broadcastChange('projects');

      res.json({
        success: true,
        message: `Successfully synchronized ${result.tasksCount} tasks and ${result.linksCount} links.`,
        result,
        data: result.data,
        links: result.links,
        syncedAt: new Date().toISOString()
      });
    } catch (error) {
      console.error('Error synchronizing Gantt data:', error);
      res.status(500).json({ error: 'Failed to synchronize Gantt schedule' });
    }
  });

  /**
   * POST /api/projects/:projectId/gantt/bulk
   * Atomic batch create/update endpoint for multi-task creation and rapid drag/resize flushes.
   * Commits all tasks in a single PostgreSQL transaction and broadcasts cache invalidation ONCE.
   */
  router.post('/:projectId/gantt/bulk', requireRole(['ADMIN', 'OPERATIONS_MANAGER', 'PROJECT_MANAGER', 'ENGINEER']), async (req: Request, res: Response) => {
    try {
      const { projectId } = req.params;
      const incomingTasks: any[] = Array.isArray(req.body?.tasks) ? req.body.tasks : [];

      if (!projectId) {
        return res.status(400).json({ error: 'Project ID is required' });
      }
      if (!hasProjectManagementAccess(req.user) && !checkUserProjectAccess(req.user, projectId)) {
        return res.status(403).json({ error: 'Forbidden: You do not have access to this project.' });
      }
      if (incomingTasks.length === 0) {
        return res.status(400).json({ error: 'At least one task is required for bulk sync.' });
      }

      const existingProject = await prisma.commercialProject.findUnique({ where: { id: projectId } });
      if (!existingProject) {
        return res.json({ success: true, localOnly: true, result: { tasksCount: incomingTasks.length } });
      }

      const result = await prisma.$transaction(async (tx) => {
        const orderedIncoming = [...incomingTasks].sort((a, b) => {
          const aHasParent = Boolean(a.parentTaskId || (a.parent && a.parent !== 0 && a.parent !== '0'));
          const bHasParent = Boolean(b.parentTaskId || (b.parent && b.parent !== 0 && b.parent !== '0'));
          if (aHasParent !== bHasParent) return aHasParent ? 1 : -1;
          return Number(a.sortOrder ?? 0) - Number(b.sortOrder ?? 0);
        });

        const incomingIds = orderedIncoming.map((t) => String(t.id || '')).filter(Boolean);
        const incomingContractorIds = Array.from(
          new Set(orderedIncoming.map((t) => (t.assignedContractorId ? String(t.assignedContractorId) : '')).filter(Boolean))
        );

        const [existingTasksRows, existingProjectTaskRows, validContractorsRows] = await Promise.all([
          incomingIds.length > 0
            ? tx.projectTask.findMany({ where: { id: { in: incomingIds } }, select: { id: true, projectId: true } })
            : Promise.resolve([]),
          tx.projectTask.findMany({ where: { projectId }, select: { id: true } }),
          incomingContractorIds.length > 0
            ? tx.contractor.findMany({ where: { id: { in: incomingContractorIds } }, select: { id: true } })
            : Promise.resolve([])
        ]);

        const ownerByTaskId = new Map<string, string>(existingTasksRows.map((r) => [r.id, r.projectId]));
        const knownProjectTaskIds = new Set<string>(existingProjectTaskRows.map((r) => r.id));
        const validContractorIds = new Set<string>(validContractorsRows.map((r) => r.id));

        const tasksToCreate: any[] = [];
        const tasksToUpdate: Array<{ id: string; data: any }> = [];

        for (let idx = 0; idx < orderedIncoming.length; idx++) {
          const t = orderedIncoming[idx];
          const taskIdStr = String(t.id || `task-${Date.now()}-${idx}`);

          // Strictly forbid overwriting tasks owned by another project
          const existingOwnerProjectId = ownerByTaskId.get(taskIdStr);
          if (existingOwnerProjectId && existingOwnerProjectId !== projectId) {
            continue;
          }

          const startRaw = t.start_date || t.startDate;
          const endRaw = t.end_date || t.endDate;
          const parsedStart = startRaw ? new Date(startRaw) : new Date();
          const startDate = isNaN(parsedStart.getTime()) ? new Date() : parsedStart;
          const isMilestone = t.type === 'milestone' || (t.duration !== undefined && parseInt(String(t.duration), 10) === 0);
          const duration = isMilestone ? 0 : Math.max(1, parseInt(String(t.duration ?? 1), 10) || 1);
          const parsedEnd = endRaw ? new Date(endRaw) : addWorkingDays(startDate, duration || 1);
          const endDate = isMilestone ? startDate : (isNaN(parsedEnd.getTime()) ? addWorkingDays(startDate, duration || 1) : parsedEnd);

          const rawParentId =
            t.parent && t.parent !== 0 && t.parent !== '0'
              ? String(t.parent)
              : t.parentTaskId
                ? String(t.parentTaskId)
                : null;
          const safeParentId =
            rawParentId && rawParentId !== taskIdStr && knownProjectTaskIds.has(rawParentId)
              ? rawParentId
              : null;

          const safeContractorId =
            t.assignedContractorId && validContractorIds.has(String(t.assignedContractorId))
              ? String(t.assignedContractorId)
              : null;

          const rawProg = parseFloat(String(t.progress ?? 0)) || 0;
          const progress = Math.max(0, Math.min(1, rawProg > 1 ? rawProg / 100 : rawProg));
          const status = progress >= 1.0
            ? 'COMPLETED'
            : (t.status === 'COMPLETED' && progress < 1.0)
              ? (progress > 0 ? 'IN_PROGRESS' : 'TODO')
              : (t.status || (progress > 0 ? 'IN_PROGRESS' : 'TODO'));
          const type = isMilestone ? 'milestone' : (t.type || 'task');

          knownProjectTaskIds.add(taskIdStr);

          const baseFields = {
            text: t.text || t.title || 'New Construction Task',
            title: t.text || t.title || 'New Construction Task',
            startDate,
            endDate,
            duration,
            progress,
            ...(t.weight !== undefined && t.weight !== null ? { weight: Number(t.weight) } : {}),
            status,
            type,
            parentTaskId: safeParentId,
            wbsCode: t.wbsCode || null,
            milestonePhase: t.milestonePhase || t.constructionPhase || null,
            assignedContractorId: safeContractorId,
            sortOrder: typeof t.sortOrder === 'number' ? t.sortOrder : idx
          };

          if (existingOwnerProjectId === projectId) {
            tasksToUpdate.push({ id: taskIdStr, data: { ...baseFields, updatedAt: new Date() } });
          } else {
            tasksToCreate.push({ id: taskIdStr, projectId, ...baseFields });
          }
        }

        const rootCreates = tasksToCreate.filter((r) => !r.parentTaskId);
        const childCreates = tasksToCreate.filter((r) => Boolean(r.parentTaskId));
        if (rootCreates.length > 0) {
          await tx.projectTask.createMany({ data: rootCreates, skipDuplicates: true });
        }
        if (childCreates.length > 0) {
          await tx.projectTask.createMany({ data: childCreates, skipDuplicates: true });
        }
        if (tasksToUpdate.length > 0) {
          await Promise.all(
            tasksToUpdate.map((upd) => tx.projectTask.update({ where: { id: upd.id }, data: upd.data }))
          );
        }

        // Batch-create predecessor links for newly created tasks
        const linksToCreate: Array<{ id: string; projectId: string; sourceId: string; targetId: string; type: string; lagDays: number }> = [];
        for (const t of orderedIncoming) {
          const targetId = String(t.id || '');
          if (!targetId || !Array.isArray(t.predecessorIds)) continue;
          for (const predId of t.predecessorIds) {
            const sourceId = String(predId || '');
            if (!sourceId || sourceId === targetId) continue;
            if (knownProjectTaskIds.has(sourceId) && knownProjectTaskIds.has(targetId)) {
              linksToCreate.push({
                id: `link-${sourceId}-${targetId}`,
                projectId,
                sourceId,
                targetId,
                type: '0',
                lagDays: 0
              });
            }
          }
        }
        if (linksToCreate.length > 0) {
          await tx.taskLink.createMany({ data: linksToCreate, skipDuplicates: true });
        }

        const [freshTasks, freshLinks] = await Promise.all([
          tx.projectTask.findMany({
            where: { projectId },
            include: { assignedContractor: true },
            orderBy: { sortOrder: 'asc' }
          }),
          tx.taskLink.findMany({ where: { projectId } })
        ]);

        let avgProgress = 0;
        if (freshTasks.length > 0) {
          const parentIds = new Set(freshTasks.map((t) => t.parentTaskId).filter(Boolean));
          const leafTasks = freshTasks.filter((t) => !parentIds.has(t.id));
          const targetTasks = leafTasks.length > 0 ? leafTasks : freshTasks;
          const totalDuration = targetTasks.reduce((acc, curr) => acc + Math.max(1, curr.duration || 1), 0);
          const weightedProgress = targetTasks.reduce((acc, curr) => {
            let p = 0;
            if (curr.status === 'COMPLETED') {
              p = 1.0;
            } else {
              const raw = typeof curr.progress === 'number' ? curr.progress : 0;
              p = raw > 1.0 ? Math.min(1.0, raw / 100) : Math.max(0, Math.min(1.0, raw));
            }
            return acc + p * Math.max(1, curr.duration || 1);
          }, 0);
          avgProgress = totalDuration > 0 ? Math.round((weightedProgress / totalDuration) * 100) : 0;
        }

        const isCompletedProj = existingProject.status === 'COMPLETED' || existingProject.status === 'HANDED_OVER';
        const finalProgress = isCompletedProj ? 100 : avgProgress;
        await tx.commercialProject.update({
          where: { id: projectId },
          data: {
            progressPercentage: finalProgress,
            tasksCount: freshTasks.length
          }
        }).catch(() => {});

        return {
          tasksCount: freshTasks.length,
          linksCount: freshLinks.length,
          projectProgress: finalProgress,
          data: freshTasks.map((t) => {
            const isMilestone = t.type === 'milestone' || t.duration === 0;
            return {
              id: t.id,
              text: t.text,
              start_date: formatGanttDate(t.startDate),
              end_date: formatGanttDate(t.endDate),
              duration: t.duration,
              progress: typeof t.progress === 'number' ? t.progress : 0,
              weight: typeof (t as any).weight === 'number' ? (t as any).weight : null,
              status: t.status || ((typeof t.progress === 'number' && t.progress >= 1.0) ? 'COMPLETED' : (typeof t.progress === 'number' && t.progress > 0) ? 'IN_PROGRESS' : 'TODO'),
              parent: t.parentTaskId || 0,
              type: isMilestone ? 'milestone' : t.type || 'task',
              wbsCode: t.wbsCode || '',
              milestonePhase: t.milestonePhase || '',
              assignedContractorId: t.assignedContractorId || '',
              contractor: t.assignedContractor?.name || (t.assignedContractorId ? 'Assigned Contractor' : 'LDM Construction Crew'),
              baselineStart: t.baselineStart ? formatGanttDate(t.baselineStart) : null,
              baselineEnd: t.baselineEnd ? formatGanttDate(t.baselineEnd) : null,
              sortOrder: t.sortOrder
            };
          }),
          links: freshLinks.map((l) => ({
            id: l.id,
            source: l.sourceId,
            target: l.targetId,
            type: l.type || '0',
            lag: l.lagDays || 0
          }))
        };
      }, { maxWait: 15000, timeout: 30000 });

      ganttCache.set(projectId, {
        data: result.data,
        links: result.links,
        ts: Date.now(),
      });
      invalidateAllDataCache();
      broadcastChange('gantt', { projectId });
      broadcastChange('tasks');
      broadcastChange('projects');

      return res.json({
        success: true,
        message: `Atomically saved ${incomingTasks.length} Gantt task(s).`,
        result,
        data: result.data,
        links: result.links,
        syncedAt: new Date().toISOString()
      });
    } catch (error) {
      console.error('Error in bulk Gantt sync:', error);
      return res.status(500).json({ error: 'Failed to bulk-save Gantt tasks' });
    }
  });

  return router;
}
