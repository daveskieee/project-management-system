/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Router, Request, Response } from 'express';
import { pool } from '../db';
import { authenticateRequest, requireAuth, requireRole } from '../middleware/auth';
import { broadcastChange, invalidateAllDataCache } from '../events';

export const materialsRouter = Router();

materialsRouter.use(authenticateRequest);

export interface ComputedMaterialMetrics {
  remainingStock: number;
  balanceOrder: number;
  stockValue: number;
  status: 'Over-Delivered' | 'Completed' | 'Incomplete';
}

function computeMaterialMetrics(
  ordered: number,
  received: number,
  usedIssued: number,
  unitCost: number
): ComputedMaterialMetrics {
  const safeOrdered = Math.max(0, Number(ordered) || 0);
  const safeReceived = Math.max(0, Number(received) || 0);
  const safeUsed = Math.max(0, Number(usedIssued) || 0);
  const safeUnitCost = Math.max(0, Number(unitCost) || 0);

  const remainingStock = safeReceived - safeUsed;
  const balanceOrder = safeOrdered - safeReceived;
  const stockValue = Math.max(0, remainingStock) * safeUnitCost;
  const status: ComputedMaterialMetrics['status'] =
    balanceOrder < 0 ? 'Over-Delivered' : balanceOrder === 0 ? 'Completed' : 'Incomplete';

  return {
    remainingStock,
    balanceOrder,
    stockValue,
    status,
  };
}

function mapMaterialRow(row: any) {
  const ordered = Number(row.ordered) || 0;
  const received = Number(row.received) || 0;
  const usedIssued = Number(row.used_issued) || 0;
  const unitCost = Number(row.unit_cost) || 0;
  const metrics = computeMaterialMetrics(ordered, received, usedIssued, unitCost);

  return {
    id: row.id,
    projectId: row.project_id,
    projectName: row.project_name,
    week: row.week || 'Week 1',
    date: row.date,
    materialDescription: row.material_description,
    category: row.category || 'General',
    ordered,
    unit: row.unit || 'pcs',
    received,
    used: usedIssued,
    usedIssued,
    remainingStock: metrics.remainingStock,
    balanceOrder: metrics.balanceOrder,
    stockValue: metrics.stockValue,
    status: metrics.status,
    supplier: row.supplier || 'Approved Builders Supply',
    unitCost,
    unitCostPhp: unitCost,
    notes: row.notes || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function resolveProjectName(projectId: string, providedName?: string): Promise<string> {
  const trimmed = (providedName || '').trim();
  if (trimmed) return trimmed;
  try {
    const res = await pool.query(
      'SELECT name FROM commercial_projects WHERE id = $1 LIMIT 1',
      [projectId]
    );
    if (res.rows[0]?.name) return String(res.rows[0].name);
  } catch {
    // Fallback below
  }
  return projectId;
}

// ============================================================================
// GET /api/materials — List Site Material Directory & Delivery Ledger items
// Optional query param: ?projectId=PRJ-xxxx
// ============================================================================
materialsRouter.get('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const projectId = typeof req.query.projectId === 'string' ? req.query.projectId.trim() : '';

    const result = projectId && projectId !== 'ALL'
      ? await pool.query(
          `SELECT m.* FROM site_materials m
           INNER JOIN commercial_projects p ON p.id = m.project_id
           WHERE m.project_id = $1
             AND LOWER(TRIM(m.project_name)) != 'ldm prime residential build'
           ORDER BY m.created_at DESC, m.id DESC`,
          [projectId]
        )
      : await pool.query(
          `SELECT m.* FROM site_materials m
           INNER JOIN commercial_projects p ON p.id = m.project_id
           WHERE LOWER(TRIM(m.project_name)) != 'ldm prime residential build'
           ORDER BY m.created_at DESC, m.id DESC`
        );

    return res.json(result.rows.map(mapMaterialRow));
  } catch (error) {
    console.error('Error fetching site materials:', error);
    return res.status(500).json({ error: 'Failed to load site material ledger.' });
  }
});

// ============================================================================
// POST /api/materials — Create a new material item in Site Directory Ledger
// ============================================================================
materialsRouter.post(
  '/',
  requireRole(['ADMIN', 'ENGINEER', 'FINANCE']),
  async (req: Request, res: Response) => {
    try {
      const {
        id,
        projectId,
        projectName,
        materialDescription,
        category = 'General',
        week = 'Week 1',
        date,
        ordered = 1,
        unit = 'pcs',
        received = 0,
        usedIssued,
        used,
        unitCost,
        unitCostPhp,
        supplier = 'Approved Builders Supply',
        notes = '',
      } = req.body || {};

      const cleanProjectId = typeof projectId === 'string' ? projectId.trim() : '';
      const cleanDesc = typeof materialDescription === 'string' ? materialDescription.trim() : '';

      if (!cleanProjectId) {
        return res.status(400).json({ error: 'Target Project (projectId) is required.' });
      }
      if (!cleanDesc) {
        return res.status(400).json({ error: 'Material Description is required.' });
      }

      const resolvedProjectName = await resolveProjectName(cleanProjectId, projectName);
      const safeOrdered = Math.max(1, Number(ordered) || 1);
      const safeReceived = Math.max(0, Number(received) || 0);
      const safeUsed = Math.max(0, Number(usedIssued ?? used) || 0);
      const safeUnitCost = Math.max(0, Number(unitCost ?? unitCostPhp) || 0);
      const metrics = computeMaterialMetrics(safeOrdered, safeReceived, safeUsed, safeUnitCost);

      const recordId =
        typeof id === 'string' && id.trim()
          ? id.trim()
          : `MAT-DIR-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
      const recordDate =
        typeof date === 'string' && date.trim()
          ? date.trim()
          : new Date().toISOString().split('T')[0];

      const insertRes = await pool.query(
        `INSERT INTO site_materials (
          id, project_id, project_name, week, date, material_description,
          category, ordered, unit, received, used_issued,
          remaining_stock, balance_order, stock_value, status,
          supplier, unit_cost, notes, created_at, updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6,
          $7, $8, $9, $10, $11,
          $12, $13, $14, $15,
          $16, $17, $18, NOW(), NOW()
        ) RETURNING *`,
        [
          recordId,
          cleanProjectId,
          resolvedProjectName,
          String(week || 'Week 1').trim(),
          recordDate,
          cleanDesc,
          String(category || 'General').trim(),
          safeOrdered,
          String(unit || 'pcs').trim(),
          safeReceived,
          safeUsed,
          metrics.remainingStock,
          metrics.balanceOrder,
          metrics.stockValue,
          metrics.status,
          String(supplier || 'Approved Builders Supply').trim(),
          safeUnitCost,
          String(notes || '').trim(),
        ]
      );

      invalidateAllDataCache();
      broadcastChange('materials');

      return res.status(201).json(mapMaterialRow(insertRes.rows[0]));
    } catch (error) {
      console.error('Error creating site material:', error);
      return res.status(500).json({ error: 'Failed to create material ledger item.' });
    }
  }
);

// ============================================================================
// PATCH /api/materials/:id (and PUT alias) — Update material item & recalculate
// ============================================================================
async function handleUpdateMaterial(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const existingRes = await pool.query('SELECT * FROM site_materials WHERE id = $1 LIMIT 1', [id]);
    if (existingRes.rows.length === 0) {
      return res.status(404).json({ error: 'Material ledger item not found.' });
    }

    const existing = existingRes.rows[0];
    const body = req.body || {};

    const nextProjectId =
      typeof body.projectId === 'string' && body.projectId.trim()
        ? body.projectId.trim()
        : existing.project_id;

    let nextProjectName: string;
    if (typeof body.projectName === 'string' && body.projectName.trim()) {
      nextProjectName = body.projectName.trim();
    } else if (nextProjectId !== existing.project_id) {
      nextProjectName = await resolveProjectName(nextProjectId);
    } else {
      nextProjectName = existing.project_name;
    }

    const nextDesc =
      typeof body.materialDescription === 'string' && body.materialDescription.trim()
        ? body.materialDescription.trim()
        : existing.material_description;
    const nextCategory =
      typeof body.category === 'string' && body.category.trim()
        ? body.category.trim()
        : existing.category;
    const nextWeek =
      typeof body.week === 'string' && body.week.trim()
        ? body.week.trim()
        : existing.week;
    const nextDate =
      typeof body.date === 'string' && body.date.trim()
        ? body.date.trim()
        : existing.date;
    const nextUnit =
      typeof body.unit === 'string' && body.unit.trim()
        ? body.unit.trim()
        : existing.unit;
    const nextSupplier =
      typeof body.supplier === 'string'
        ? body.supplier.trim() || 'Approved Builders Supply'
        : existing.supplier;
    const nextNotes =
      typeof body.notes === 'string'
        ? body.notes.trim()
        : (existing.notes || '');

    const nextOrdered =
      body.ordered !== undefined ? Math.max(1, Number(body.ordered) || 1) : Number(existing.ordered) || 1;
    const nextReceived =
      body.received !== undefined ? Math.max(0, Number(body.received) || 0) : Number(existing.received) || 0;
    const rawUsed = body.usedIssued !== undefined ? body.usedIssued : body.used;
    const nextUsed =
      rawUsed !== undefined ? Math.max(0, Number(rawUsed) || 0) : Number(existing.used_issued) || 0;
    const rawUnitCost = body.unitCost !== undefined ? body.unitCost : body.unitCostPhp;
    const nextUnitCost =
      rawUnitCost !== undefined ? Math.max(0, Number(rawUnitCost) || 0) : Number(existing.unit_cost) || 0;

    const metrics = computeMaterialMetrics(nextOrdered, nextReceived, nextUsed, nextUnitCost);

    const updateRes = await pool.query(
      `UPDATE site_materials
       SET project_id = $1,
           project_name = $2,
           week = $3,
           date = $4,
           material_description = $5,
           category = $6,
           ordered = $7,
           unit = $8,
           received = $9,
           used_issued = $10,
           remaining_stock = $11,
           balance_order = $12,
           stock_value = $13,
           status = $14,
           supplier = $15,
           unit_cost = $16,
           notes = $17,
           updated_at = NOW()
       WHERE id = $18
       RETURNING *`,
      [
        nextProjectId,
        nextProjectName,
        nextWeek,
        nextDate,
        nextDesc,
        nextCategory,
        nextOrdered,
        nextUnit,
        nextReceived,
        nextUsed,
        metrics.remainingStock,
        metrics.balanceOrder,
        metrics.stockValue,
        metrics.status,
        nextSupplier,
        nextUnitCost,
        nextNotes,
        id,
      ]
    );

    invalidateAllDataCache();
    broadcastChange('materials');

    return res.json(mapMaterialRow(updateRes.rows[0]));
  } catch (error) {
    console.error('Error updating site material:', error);
    return res.status(500).json({ error: 'Failed to update material ledger item.' });
  }
}

materialsRouter.patch('/:id', requireRole(['ADMIN', 'ENGINEER', 'FINANCE']), handleUpdateMaterial);
materialsRouter.put('/:id', requireRole(['ADMIN', 'ENGINEER', 'FINANCE']), handleUpdateMaterial);

// ============================================================================
// DELETE /api/materials/:id — Delete a material item from Site Directory Ledger
// ============================================================================
materialsRouter.delete(
  '/:id',
  requireRole(['ADMIN', 'ENGINEER', 'FINANCE']),
  async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const deleteRes = await pool.query(
        'DELETE FROM site_materials WHERE id = $1 RETURNING id',
        [id]
      );
      if (deleteRes.rows.length === 0) {
        return res.status(404).json({ error: 'Material ledger item not found.' });
      }

      invalidateAllDataCache();
      broadcastChange('materials');

      return res.json({ deleted: true, id });
    } catch (error) {
      console.error('Error deleting site material:', error);
      return res.status(500).json({ error: 'Failed to delete material ledger item.' });
    }
  }
);
