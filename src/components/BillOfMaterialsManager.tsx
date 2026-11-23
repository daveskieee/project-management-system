/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  Calculator, Building2, User, MapPin, Plus, Trash2, ChevronDown, ChevronRight,
  Printer, RefreshCw, Check, Sparkles, Layers, FileSpreadsheet, ArrowRight,
  Download, Eye, EyeOff, Save, CheckCircle2, AlertCircle, Share2
} from 'lucide-react';
import { ProjectProfile } from '../types';
import { openEnterprisePrintWindow, escapePrintHtml } from '../utils/printEngine';
import { exportToCsv } from '../utils/exportUtils';
import { useTheme } from '../context/ThemeContext';
import { useConfirm } from '../context/ConfirmDialogContext';
import { GANTT_TASKS_STORAGE_PREFIX, GANTT_TASKS_UPDATED_EVENT } from '../utils/ganttProgress';
import { logAuditEvent } from '../utils/auditLogger';
import { secureFetch } from '../utils/apiClient';
import {
  calculateProjectBomProfitSync,
  BOM_PROFIT_SYNC_EVENT,
  notifyBomProfitSync,
} from '../utils/bomProfitSync';

export type BomUnit = 'pcs' | 'days' | 'lot' | 'cu.m.' | 'sq.m.' | 'bags' | 'kg' | 'bd.ft.' | 'l.m.' | 'sets' | 'rolls' | 'sheets' | 'lengths';

export interface BomLineItem {
  id: string;
  scopeOfWork: string;
  noOfUnits: number;
  unit: BomUnit | string;
  unitCost: number;
  profitPct: number;      // e.g. 20 for 20%
  overheadPct: number;    // e.g. 5 for 5%
  designCost: number;     // e.g. 0 or specific design fee
}

export interface BomSubPhase {
  id: string;
  title: string;
  items: BomLineItem[];
}

export interface BomPhase {
  id: string;
  code: string;           // e.g. "A", "B", "C"
  title: string;          // e.g. "EARTHWORKS"
  defaultProfitPct: number;
  defaultOverheadPct: number;
  subPhases: BomSubPhase[];
  isExpanded?: boolean;
}

export type ProjectTypology =
  | '2-Storey Residential Unit'
  | '1-Storey / Bungalow'
  | 'Renovation / Fit-Out'
  | 'Demolition / Excavation'
  | 'Commercial Building';

export const STANDARD_BOM_PHASES_TEMPLATE: Omit<BomPhase, 'id' | 'subPhases'>[] = [
  { code: 'A', title: 'GENERAL REQUIREMENTS', defaultProfitPct: 15, defaultOverheadPct: 5 },
  { code: 'B', title: 'EARTHWORKS', defaultProfitPct: 20, defaultOverheadPct: 5 },
  { code: 'C', title: 'CONCRETE WORKS', defaultProfitPct: 20, defaultOverheadPct: 5 },
  { code: 'D', title: 'REINFORCING BAR', defaultProfitPct: 20, defaultOverheadPct: 5 },
  { code: 'E', title: 'FORMWORKS', defaultProfitPct: 20, defaultOverheadPct: 5 },
  { code: 'F', title: 'MASONRY WORKS', defaultProfitPct: 20, defaultOverheadPct: 5 },
  { code: 'G', title: 'ROOF WORKS', defaultProfitPct: 20, defaultOverheadPct: 5 },
  { code: 'H', title: 'FINISHING / TILING WORKS', defaultProfitPct: 20, defaultOverheadPct: 5 },
  { code: 'I', title: 'CEILING WORKS', defaultProfitPct: 20, defaultOverheadPct: 5 },
  { code: 'J', title: 'PAINTING WORKS', defaultProfitPct: 20, defaultOverheadPct: 5 },
  { code: 'K', title: 'DOORS AND WINDOWS', defaultProfitPct: 20, defaultOverheadPct: 5 },
  { code: 'L', title: 'CABINET WORKS', defaultProfitPct: 20, defaultOverheadPct: 5 },
  { code: 'M', title: 'ELECTRICAL WORKS', defaultProfitPct: 20, defaultOverheadPct: 5 },
  { code: 'N', title: 'PLUMBING WORKS', defaultProfitPct: 20, defaultOverheadPct: 5 },
  { code: 'O', title: 'FENCING WORKS', defaultProfitPct: 20, defaultOverheadPct: 5 },
];

export const OPTIONAL_BOM_PHASES: Omit<BomPhase, 'id' | 'subPhases'>[] = [
  { code: 'P', title: 'GARAGE WORKS', defaultProfitPct: 20, defaultOverheadPct: 5 },
  { code: 'Q', title: 'BALCONY', defaultProfitPct: 20, defaultOverheadPct: 5 },
  { code: 'R', title: 'OFFICE AREA', defaultProfitPct: 20, defaultOverheadPct: 5 },
];

// Generates default pre-populated engineering data based on Santos-New-Estimate
export function generateDefaultBomPhases(typology: ProjectTypology): BomPhase[] {
  const isRenovation = typology === 'Renovation / Fit-Out';
  const isDemolition = typology === 'Demolition / Excavation';

  return STANDARD_BOM_PHASES_TEMPLATE.map((tpl, pIdx) => {
    const pId = `phase-${tpl.code.toLowerCase()}-${Date.now()}-${pIdx}`;
    let subPhases: BomSubPhase[] = [];

    if (tpl.code === 'A') {
      subPhases = [
        {
          id: `sub-${tpl.code}-1`,
          title: 'Mobilization & Statutory Permits',
          items: [
            { id: `item-a-1`, scopeOfWork: 'Mobilization & Demobilization of Tools and Equipment', noOfUnits: 1, unit: 'lot', unitCost: 35000, profitPct: tpl.defaultProfitPct, overheadPct: tpl.defaultOverheadPct, designCost: 0 },
            { id: `item-a-2`, scopeOfWork: 'Building Permit Processing, Structural Sign-offs & Blueprints', noOfUnits: 1, unit: 'lot', unitCost: 45000, profitPct: tpl.defaultProfitPct, overheadPct: tpl.defaultOverheadPct, designCost: 15000 },
            { id: `item-a-3`, scopeOfWork: 'Temporary Facilities, Power & Water Tapping, Jobsite Billboard', noOfUnits: 1, unit: 'lot', unitCost: 28000, profitPct: tpl.defaultProfitPct, overheadPct: tpl.defaultOverheadPct, designCost: 0 }
          ]
        }
      ];
    } else if (tpl.code === 'B') {
      subPhases = [
        {
          id: `sub-${tpl.code}-1`,
          title: 'Site Clearing & Layout',
          items: [
            { id: `item-b-1`, scopeOfWork: 'Site Clearing, Grubbing & Topsoil Stripping', noOfUnits: isDemolition ? 350 : 180, unit: 'sq.m.', unitCost: 65, profitPct: tpl.defaultProfitPct, overheadPct: tpl.defaultOverheadPct, designCost: 0 },
            { id: `item-b-2`, scopeOfWork: 'Batterboard Installation, Staking & Leveling (2"x2"x8\' Lumber, Nails)', noOfUnits: 1, unit: 'lot', unitCost: 14500, profitPct: tpl.defaultProfitPct, overheadPct: tpl.defaultOverheadPct, designCost: 0 },
          ]
        },
        {
          id: `sub-${tpl.code}-2`,
          title: 'Excavation & Earth Preparation',
          items: [
            { id: `item-b-3`, scopeOfWork: 'Structural Excavation for Footings & Tie Beams', noOfUnits: isRenovation ? 15 : 68, unit: 'cu.m.', unitCost: 450, profitPct: tpl.defaultProfitPct, overheadPct: tpl.defaultOverheadPct, designCost: 0 },
            { id: `item-b-4`, scopeOfWork: 'Backfill, Compaction & Sub-grade Preparation', noOfUnits: isRenovation ? 10 : 42, unit: 'cu.m.', unitCost: 380, profitPct: tpl.defaultProfitPct, overheadPct: tpl.defaultOverheadPct, designCost: 0 },
            { id: `item-b-5`, scopeOfWork: 'Gravel Bedding (G-1 Gravel Bedding 50mm thk)', noOfUnits: isRenovation ? 5 : 18, unit: 'cu.m.', unitCost: 1650, profitPct: tpl.defaultProfitPct, overheadPct: tpl.defaultOverheadPct, designCost: 0 }
          ]
        }
      ];
    } else if (tpl.code === 'C') {
      subPhases = [
        {
          id: `sub-${tpl.code}-1`,
          title: 'Structural Concrete Pouring (Class A 3,000 PSI)',
          items: [
            { id: `item-c-1`, scopeOfWork: 'Column Footings & Wall Footings Concrete Pouring', noOfUnits: 18, unit: 'cu.m.', unitCost: 5800, profitPct: tpl.defaultProfitPct, overheadPct: tpl.defaultOverheadPct, designCost: 0 },
            { id: `item-c-2`, scopeOfWork: 'Ground Floor Slab & Tie Beams (3,000 PSI)', noOfUnits: 24, unit: 'cu.m.', unitCost: 5900, profitPct: tpl.defaultProfitPct, overheadPct: tpl.defaultOverheadPct, designCost: 0 },
            { id: `item-c-3`, scopeOfWork: 'Second Floor Suspended Slab & Roof Beams', noOfUnits: 22, unit: 'cu.m.', unitCost: 6100, profitPct: tpl.defaultProfitPct, overheadPct: tpl.defaultOverheadPct, designCost: 0 }
          ]
        }
      ];
    } else if (tpl.code === 'D') {
      subPhases = [
        {
          id: `sub-${tpl.code}-1`,
          title: 'Reinforcing Steel Bars (Grade 40/60)',
          items: [
            { id: `item-d-1`, scopeOfWork: 'Deformed Reinforcing Steel Bars 16mm Dia. x 6.0m (Footings & Columns)', noOfUnits: 180, unit: 'lengths', unitCost: 485, profitPct: tpl.defaultProfitPct, overheadPct: tpl.defaultOverheadPct, designCost: 0 },
            { id: `item-d-2`, scopeOfWork: 'Deformed Reinforcing Steel Bars 12mm Dia. x 6.0m (Beams & Slabs)', noOfUnits: 240, unit: 'lengths', unitCost: 285, profitPct: tpl.defaultProfitPct, overheadPct: tpl.defaultOverheadPct, designCost: 0 },
            { id: `item-d-3`, scopeOfWork: 'Deformed Reinforcing Steel Bars 10mm Dia. x 6.0m (Stirrups & Ties)', noOfUnits: 320, unit: 'lengths', unitCost: 195, profitPct: tpl.defaultProfitPct, overheadPct: tpl.defaultOverheadPct, designCost: 0 },
            { id: `item-d-4`, scopeOfWork: '#16 G.I. Tie Wire (35kg/roll)', noOfUnits: 6, unit: 'rolls', unitCost: 2850, profitPct: tpl.defaultProfitPct, overheadPct: tpl.defaultOverheadPct, designCost: 0 }
          ]
        }
      ];
    } else if (tpl.code === 'E') {
      subPhases = [
        {
          id: `sub-${tpl.code}-1`,
          title: 'Formworks & Shoring Systems',
          items: [
            { id: `item-e-1`, scopeOfWork: 'Phenolic Board 1/2" x 4\' x 8\' (High-Reuse Form Face)', noOfUnits: 45, unit: 'sheets', unitCost: 1150, profitPct: tpl.defaultProfitPct, overheadPct: tpl.defaultOverheadPct, designCost: 0 },
            { id: `item-e-2`, scopeOfWork: 'Good Lumber Framing (2"x3" & 2"x4" Coco Lumber)', noOfUnits: 1450, unit: 'bd.ft.', unitCost: 32, profitPct: tpl.defaultProfitPct, overheadPct: tpl.defaultOverheadPct, designCost: 0 },
            { id: `item-e-3`, scopeOfWork: 'Assorted Common Wire Nails (CWN 2", 3", 4")', noOfUnits: 80, unit: 'kg', unitCost: 85, profitPct: tpl.defaultProfitPct, overheadPct: tpl.defaultOverheadPct, designCost: 0 },
            { id: `item-e-4`, scopeOfWork: 'Adjustable Steel Props & Scaffolding Rental System', noOfUnits: 1, unit: 'lot', unitCost: 35000, profitPct: tpl.defaultProfitPct, overheadPct: tpl.defaultOverheadPct, designCost: 0 }
          ]
        }
      ];
    } else if (tpl.code === 'F') {
      subPhases = [
        {
          id: `sub-${tpl.code}-1`,
          title: 'Concrete Hollow Block (CHB) Laying & Plastering',
          items: [
            { id: `item-f-1`, scopeOfWork: '6" CHB for Exterior Perimeter & Load-Bearing Walls', noOfUnits: 2200, unit: 'pcs', unitCost: 22, profitPct: tpl.defaultProfitPct, overheadPct: tpl.defaultOverheadPct, designCost: 0 },
            { id: `item-f-2`, scopeOfWork: '4" CHB for Interior Partitions', noOfUnits: 1800, unit: 'pcs', unitCost: 18, profitPct: tpl.defaultProfitPct, overheadPct: tpl.defaultOverheadPct, designCost: 0 },
            { id: `item-f-3`, scopeOfWork: 'Portland Cement (Type 1 - 40kg Bags)', noOfUnits: 250, unit: 'bags', unitCost: 270, profitPct: tpl.defaultProfitPct, overheadPct: tpl.defaultOverheadPct, designCost: 0 },
            { id: `item-f-4`, scopeOfWork: 'Screened Sand (Fine Washed White/River Sand)', noOfUnits: 28, unit: 'cu.m.', unitCost: 1400, profitPct: tpl.defaultProfitPct, overheadPct: tpl.defaultOverheadPct, designCost: 0 },
            { id: `item-f-5`, scopeOfWork: 'Plain Cement Plaster Finish with Skim Coat Preparation', noOfUnits: 550, unit: 'sq.m.', unitCost: 120, profitPct: tpl.defaultProfitPct, overheadPct: tpl.defaultOverheadPct, designCost: 0 }
          ]
        }
      ];
    } else if (tpl.code === 'G') {
      subPhases = [
        {
          id: `sub-${tpl.code}-1`,
          title: 'Roof Framing & Pre-Painted Long Span Roofing',
          items: [
            { id: `item-g-1`, scopeOfWork: 'Structural Steel C-Purlins & Angle Bars (Welded Roof Trusses)', noOfUnits: 1, unit: 'lot', unitCost: 85000, profitPct: tpl.defaultProfitPct, overheadPct: tpl.defaultOverheadPct, designCost: 0 },
            { id: `item-g-2`, scopeOfWork: 'Rib-Type Pre-painted Roofing Sheet 0.50mm thk', noOfUnits: 140, unit: 'sq.m.', unitCost: 620, profitPct: tpl.defaultProfitPct, overheadPct: tpl.defaultOverheadPct, designCost: 0 },
            { id: `item-g-3`, scopeOfWork: 'Double-Sided Aluminum Foil Roof Thermal Insulation', noOfUnits: 140, unit: 'sq.m.', unitCost: 110, profitPct: tpl.defaultProfitPct, overheadPct: tpl.defaultOverheadPct, designCost: 0 },
            { id: `item-g-4`, scopeOfWork: 'Spanish Gutter, Ridge Roll & Flashing Details', noOfUnits: 48, unit: 'l.m.', unitCost: 450, profitPct: tpl.defaultProfitPct, overheadPct: tpl.defaultOverheadPct, designCost: 0 }
          ]
        }
      ];
    } else if (tpl.code === 'H') {
      subPhases = [
        {
          id: `sub-${tpl.code}-1`,
          title: 'Flooring & Wall Tiling Works',
          items: [
            { id: `item-h-1`, scopeOfWork: '60cm x 60cm Glazed Porcelain Floor Tiles (Living, Dining, Kitchen)', noOfUnits: 110, unit: 'sq.m.', unitCost: 750, profitPct: tpl.defaultProfitPct, overheadPct: tpl.defaultOverheadPct, designCost: 0 },
            { id: `item-h-2`, scopeOfWork: '30cm x 60cm Non-Skid Ceramic Floor & Wall Tiles (Bathrooms)', noOfUnits: 45, unit: 'sq.m.', unitCost: 650, profitPct: tpl.defaultProfitPct, overheadPct: tpl.defaultOverheadPct, designCost: 0 },
            { id: `item-h-3`, scopeOfWork: 'Heavy Duty Tile Adhesive & Water-Resistant Tile Grout', noOfUnits: 25, unit: 'bags', unitCost: 380, profitPct: tpl.defaultProfitPct, overheadPct: tpl.defaultOverheadPct, designCost: 0 }
          ]
        }
      ];
    } else if (tpl.code === 'I') {
      subPhases = [
        {
          id: `sub-${tpl.code}-1`,
          title: 'Ceiling Framing & Board Installation',
          items: [
            { id: `item-i-1`, scopeOfWork: '9mm Moisture-Resistant Gypsum Board on Metal Furring (Drop Ceiling)', noOfUnits: 120, unit: 'sq.m.', unitCost: 520, profitPct: tpl.defaultProfitPct, overheadPct: tpl.defaultOverheadPct, designCost: 0 },
            { id: `item-i-2`, scopeOfWork: 'Fiber Cement Board 4.5mm (Eaves & Toilet Ceilings)', noOfUnits: 35, unit: 'sq.m.', unitCost: 480, profitPct: tpl.defaultProfitPct, overheadPct: tpl.defaultOverheadPct, designCost: 0 }
          ]
        }
      ];
    } else if (tpl.code === 'J') {
      subPhases = [
        {
          id: `sub-${tpl.code}-1`,
          title: 'Architectural Painting (3-Coat Premium System)',
          items: [
            { id: `item-j-1`, scopeOfWork: 'Exterior Concrete Primer & Permacoat Latex Paint (3 Coats)', noOfUnits: 350, unit: 'sq.m.', unitCost: 195, profitPct: tpl.defaultProfitPct, overheadPct: tpl.defaultOverheadPct, designCost: 0 },
            { id: `item-j-2`, scopeOfWork: 'Interior Wall Semi-Gloss Low-VOC Latex Finish with Full Skim Coat', noOfUnits: 420, unit: 'sq.m.', unitCost: 185, profitPct: tpl.defaultProfitPct, overheadPct: tpl.defaultOverheadPct, designCost: 0 },
            { id: `item-j-3`, scopeOfWork: 'Ceiling Flat Latex Coating System', noOfUnits: 155, unit: 'sq.m.', unitCost: 165, profitPct: tpl.defaultProfitPct, overheadPct: tpl.defaultOverheadPct, designCost: 0 }
          ]
        }
      ];
    } else if (tpl.code === 'K') {
      subPhases = [
        {
          id: `sub-${tpl.code}-1`,
          title: 'Custom Doors, Jambs & Tempered Glass Windows',
          items: [
            { id: `item-k-1`, scopeOfWork: 'Main Entry Solid Wood Panel Door with Heavy Duty Smart Lockset', noOfUnits: 1, unit: 'sets', unitCost: 28500, profitPct: tpl.defaultProfitPct, overheadPct: tpl.defaultOverheadPct, designCost: 0 },
            { id: `item-k-2`, scopeOfWork: 'Molded Bedroom Doors with Stainless Lever Handles', noOfUnits: 4, unit: 'sets', unitCost: 6500, profitPct: tpl.defaultProfitPct, overheadPct: tpl.defaultOverheadPct, designCost: 0 },
            { id: `item-k-3`, scopeOfWork: 'Powder-Coated Aluminum Sliding Glass Windows (6mm Tempered)', noOfUnits: 1, unit: 'lot', unitCost: 95000, profitPct: tpl.defaultProfitPct, overheadPct: tpl.defaultOverheadPct, designCost: 0 }
          ]
        }
      ];
    } else if (tpl.code === 'L') {
      subPhases = [
        {
          id: `sub-${tpl.code}-1`,
          title: 'Modular Cabinetry & Countertops',
          items: [
            { id: `item-l-1`, scopeOfWork: 'Modular Kitchen Base & Overhead Cabinets (Marine Plywood / HPL)', noOfUnits: 6.5, unit: 'l.m.', unitCost: 9500, profitPct: tpl.defaultProfitPct, overheadPct: tpl.defaultOverheadPct, designCost: 0 },
            { id: `item-l-2`, scopeOfWork: 'Natural Granite / Quartz Kitchen Countertop & Splashboard', noOfUnits: 6.5, unit: 'l.m.', unitCost: 6800, profitPct: tpl.defaultProfitPct, overheadPct: tpl.defaultOverheadPct, designCost: 0 },
            { id: `item-l-3`, scopeOfWork: 'Master Bedroom Built-in Wardrobe Closet (Floor-to-Ceiling)', noOfUnits: 1, unit: 'sets', unitCost: 38000, profitPct: tpl.defaultProfitPct, overheadPct: tpl.defaultOverheadPct, designCost: 0 }
          ]
        }
      ];
    } else if (tpl.code === 'M') {
      subPhases = [
        {
          id: `sub-${tpl.code}-1`,
          title: 'Electrical Rough-in, Wiring & Fixtures',
          items: [
            { id: `item-m-1`, scopeOfWork: 'Main Distribution Panel Board with Circuit Breakers', noOfUnits: 1, unit: 'sets', unitCost: 16500, profitPct: tpl.defaultProfitPct, overheadPct: tpl.defaultOverheadPct, designCost: 0 },
            { id: `item-m-2`, scopeOfWork: 'THHN Copper Wires (3.5mm² & 2.0mm² Phelps Dodge) in PVC Conduits', noOfUnits: 1, unit: 'lot', unitCost: 65000, profitPct: tpl.defaultProfitPct, overheadPct: tpl.defaultOverheadPct, designCost: 0 },
            { id: `item-m-3`, scopeOfWork: 'Designer Switches, Duplex Outlets & Modern LED Recessed Downlights', noOfUnits: 1, unit: 'lot', unitCost: 45000, profitPct: tpl.defaultProfitPct, overheadPct: tpl.defaultOverheadPct, designCost: 0 }
          ]
        }
      ];
    } else if (tpl.code === 'N') {
      subPhases = [
        {
          id: `sub-${tpl.code}-1`,
          title: 'Potable Waterline, Sanitary Drainage & Fixtures',
          items: [
            { id: `item-n-1`, scopeOfWork: 'PPR Hot & Cold Waterline Pipework & Fittings', noOfUnits: 1, unit: 'lot', unitCost: 32000, profitPct: tpl.defaultProfitPct, overheadPct: tpl.defaultOverheadPct, designCost: 0 },
            { id: `item-n-2`, scopeOfWork: 'PVC Sanitary, Sewer & Storm Drainage Piping Network', noOfUnits: 1, unit: 'lot', unitCost: 38000, profitPct: tpl.defaultProfitPct, overheadPct: tpl.defaultOverheadPct, designCost: 0 },
            { id: `item-n-3`, scopeOfWork: 'Dual-Flush Water Closets, Lavatories, Rain Showers & Floor Drains', noOfUnits: 3, unit: 'sets', unitCost: 14500, profitPct: tpl.defaultProfitPct, overheadPct: tpl.defaultOverheadPct, designCost: 0 }
          ]
        }
      ];
    } else if (tpl.code === 'O') {
      subPhases = [
        {
          id: `sub-${tpl.code}-1`,
          title: 'Perimeter Fence & Steel Gate',
          items: [
            { id: `item-o-1`, scopeOfWork: 'Concrete Perimeter Fence with Plaster & Paint Finish', noOfUnits: 32, unit: 'l.m.', unitCost: 2800, profitPct: tpl.defaultProfitPct, overheadPct: tpl.defaultOverheadPct, designCost: 0 },
            { id: `item-o-2`, scopeOfWork: 'Vehicular Sliding Gate & Pedestrian Gate with Primer & Enamel', noOfUnits: 1, unit: 'lot', unitCost: 42000, profitPct: tpl.defaultProfitPct, overheadPct: tpl.defaultOverheadPct, designCost: 0 }
          ]
        }
      ];
    }

    return {
      id: pId,
      code: tpl.code,
      title: tpl.title,
      defaultProfitPct: tpl.defaultProfitPct,
      defaultOverheadPct: tpl.defaultOverheadPct,
      subPhases,
      isExpanded: true
    };
  });
}

// Compute straight percentage math formulas
export function calculateLineItemCosts(item: BomLineItem) {
  const units = Math.max(0, Number(item.noOfUnits) || 0);
  const uCost = Math.max(0, Number(item.unitCost) || 0);
  const directTotalCost = units * uCost;

  const profitPct = Math.max(0, Number(item.profitPct) || 0);
  const overheadPct = Math.max(0, Number(item.overheadPct) || 0);
  const designCost = Math.max(0, Number(item.designCost) || 0);

  // Strict Straight Percentage Math:
  // Profit Cost = Direct Total Cost * (Profit Allocation % / 100)
  const profitCost = directTotalCost * (profitPct / 100);

  // Overhead Cost = Direct Total Cost * (Overhead % / 100)
  const overheadCost = directTotalCost * (overheadPct / 100);

  // Total Markup = Profit Cost + Overhead Cost + Design Cost
  const totalMarkup = profitCost + overheadCost + designCost;

  // Total Cost (Final) = Direct Total Cost + Total Markup
  const finalTotalCost = directTotalCost + totalMarkup;

  // Marked-up unit cost (for client presentation)
  const markedUpUnitCost = units > 0 ? finalTotalCost / units : 0;

  return {
    directTotalCost,
    profitCost,
    overheadCost,
    totalMarkup,
    finalTotalCost,
    markedUpUnitCost
  };
}

interface BillOfMaterialsManagerProps {
  projects?: any[];
  onNotify?: (msg: string) => void;
  onNavigateToGantt?: (projectId?: string) => void;
}

export default function BillOfMaterialsManager({
  projects = [],
  onNotify,
  onNavigateToGantt
}: BillOfMaterialsManagerProps) {
  const { isDark } = useTheme();
  const { prompt: promptDialog, toast } = useConfirm();

  // Available projects from props or local storage
  const activeProjectsList: ProjectProfile[] = useMemo(() => {
    if (projects && projects.length > 0) return projects;
    try {
      const raw = localStorage.getItem('ctvill_projects') || localStorage.getItem('ctvill_cached_projects');
      if (raw) return JSON.parse(raw);
    } catch { }
    return [];
  }, [projects]);

  // Selected project state
  const [selectedProjectId, setSelectedProjectId] = useState<string>(() => {
    return activeProjectsList[0]?.id || 'PRJ-DEFAULT';
  });

  const activeProject = useMemo(() => {
    return activeProjectsList.find(p => p.id === selectedProjectId) || activeProjectsList[0] || null;
  }, [activeProjectsList, selectedProjectId]);

  // Project Header Meta
  const [projectTitle, setProjectTitle] = useState<string>(() => activeProjectsList[0]?.name || 'Untitled Project');
  const [ownerName, setOwnerName] = useState<string>(() => activeProjectsList[0]?.clientName || '');
  const [siteLocation, setSiteLocation] = useState<string>(() => activeProjectsList[0]?.location || '');
  const [projectType, setProjectType] = useState<'' | ProjectTypology>('');
  const [pendingTemplateApply, setPendingTemplateApply] = useState<ProjectTypology | null>(null);
  const [showTemplatePickerModal, setShowTemplatePickerModal] = useState<boolean>(false);
  const [pendingDeleteTarget, setPendingDeleteTarget] = useState<
    | { type: 'phase'; phaseId: string; title: string }
    | { type: 'subphase'; phaseId: string; subPhaseId: string; title: string }
    | null
  >(null);
  const templateSelectRef = useRef<HTMLSelectElement>(null);
  const [floorAreaSqm, setFloorAreaSqm] = useState<number>(155);
  const [estimateRefNo, setEstimateRefNo] = useState<string>(() => `EST-LDM-${new Date().getFullYear()}-001`);
  const [estimateDate, setEstimateDate] = useState<string>(() => new Date().toISOString().split('T')[0]);

  // Client Presentation Mode Toggle
  const [isClientMode, setIsClientMode] = useState<boolean>(false);
  const [syncGanttLoading, setSyncGanttLoading] = useState<boolean>(false);

  // Sync Project Meta when active project changes
  useEffect(() => {
    if (activeProject) {
      setProjectTitle(activeProject.name || 'Untitled Project');
      setOwnerName(activeProject.clientName || 'Private Client');
      setSiteLocation(activeProject.location || '');
      if ((activeProject as any).floorAreaSqm) {
        setFloorAreaSqm(Number((activeProject as any).floorAreaSqm) || 155);
      }
    }
  }, [activeProject]);

  // Normalize any flat or partial BOM phase records into canonical BomPhase -> BomSubPhase -> BomLineItem shape
  const normalizeBomPhases = useCallback((raw: any): BomPhase[] => {
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((p): p is Record<string, any> => Boolean(p && typeof p === 'object'))
      .map((p, pIdx) => {
        const defaultProfitPct = Number(p.defaultProfitPct ?? 20) || 20;
        const defaultOverheadPct = Number(p.defaultOverheadPct ?? 5) || 5;
        const title = String(p.title ?? p.name ?? `Phase ${pIdx + 1}`);
        const code = String(p.code ?? String.fromCharCode(65 + (pIdx % 26)));
        const mapItem = (it: any, iIdx: number): BomLineItem => {
          const unitCost = Number(
            it?.unitCost ??
              ((Number(it?.materialUnitCost || 0) + Number(it?.laborUnitCost || 0)) || 0)
          ) || 0;
          return {
            id: String(it?.id ?? `item-${pIdx}-${iIdx}`),
            scopeOfWork: String(it?.scopeOfWork ?? it?.description ?? 'Scope Item'),
            noOfUnits: Number(it?.noOfUnits ?? it?.qty ?? 1) || 0,
            unit: String(it?.unit ?? 'lot'),
            unitCost,
            profitPct: Number(it?.profitPct ?? defaultProfitPct) || 0,
            overheadPct: Number(it?.overheadPct ?? defaultOverheadPct) || 0,
            designCost: Number(it?.designCost ?? 0) || 0,
          };
        };

        let subPhases: BomSubPhase[] = [];
        if (Array.isArray(p.subPhases) && p.subPhases.length > 0) {
          subPhases = p.subPhases
            .filter((sp: any) => Boolean(sp && typeof sp === 'object'))
            .map((sp: any, sIdx: number) => ({
              id: String(sp.id ?? `sub-${pIdx}-${sIdx}`),
              title: String(sp.title ?? sp.name ?? 'Work Package'),
              items: Array.isArray(sp.items) ? sp.items.filter(Boolean).map(mapItem) : [],
            }));
        } else if (Array.isArray(p.items)) {
          subPhases = [
            {
              id: `sub-${String(p.id ?? pIdx)}-1`,
              title,
              items: p.items.filter(Boolean).map(mapItem),
            },
          ];
        }

        return {
          id: String(p.id ?? `phase-${pIdx}`),
          code,
          title,
          defaultProfitPct,
          defaultOverheadPct,
          subPhases,
        };
      });
  }, []);

  // BOM Phases State — strictly start blank ([]) when no saved BOM exists for the project
  const storageKey = `ldm_bom_${selectedProjectId}`;
  const [phases, setPhases] = useState<BomPhase[]>(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) return normalizeBomPhases(parsed);
      }
    } catch { }
    return [];
  });

  // Dedicated accordion expansion state decoupled from fetched phases/refetches (keyed strictly by stable phase.id)
  const [expandedPhaseIds, setExpandedPhaseIds] = useState<Set<string>>(() => new Set());
  const prevSelectedProjectIdRef = useRef<string>(selectedProjectId);

  // Only reset expandedPhaseIds when selectedProjectId actually changes (never on activeProject reference or phases refetch)
  useEffect(() => {
    if (prevSelectedProjectIdRef.current !== selectedProjectId) {
      prevSelectedProjectIdRef.current = selectedProjectId;
      setExpandedPhaseIds(new Set());
    }
  }, [selectedProjectId]);

  // Re-load BOM when switching project (hydrate from server-persisted BOM phases if localStorage is empty)
  const loadedBomProjectIdRef = useRef<string>('');
  useEffect(() => {
    const isProjectSwitch = loadedBomProjectIdRef.current !== selectedProjectId;
    if (!isProjectSwitch && phases.length > 0) {
      return;
    }
    try {
      const saved = localStorage.getItem(`ldm_bom_${selectedProjectId}`);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          const normalized = normalizeBomPhases(parsed);
          loadedBomProjectIdRef.current = selectedProjectId;
          setPhases(normalized);
          localStorage.setItem(`ldm_bom_${selectedProjectId}`, JSON.stringify(normalized));
          return;
        }
      }
    } catch { }
    const serverPhases = Array.isArray((activeProject as any)?.bomPhases) ? (activeProject as any).bomPhases : [];
    if (serverPhases.length > 0) {
      const normalized = normalizeBomPhases(serverPhases);
      loadedBomProjectIdRef.current = selectedProjectId;
      setPhases(normalized);
      try {
        localStorage.setItem(`ldm_bom_${selectedProjectId}`, JSON.stringify(normalized));
      } catch { }
      return;
    }
    if (isProjectSwitch) {
      loadedBomProjectIdRef.current = selectedProjectId;
      setPhases([]);
      setProjectType('');
    }
  }, [selectedProjectId, activeProject, normalizeBomPhases, phases.length]);

  const [materialSyncTick, setMaterialSyncTick] = useState(0);

  useEffect(() => {
    const onSync = () => setMaterialSyncTick((t) => t + 1);
    window.addEventListener(BOM_PROFIT_SYNC_EVENT, onSync);
    return () => window.removeEventListener(BOM_PROFIT_SYNC_EVENT, onSync);
  }, []);

  // Auto-save BOM changes to localStorage + persist to PostgreSQL
  const saveBomToStorage = useCallback((newPhases: BomPhase[]) => {
    setPhases(newPhases);
    try {
      localStorage.setItem(`ldm_bom_${selectedProjectId}`, JSON.stringify(newPhases));
      notifyBomProfitSync();
    } catch { }
    if (selectedProjectId) {
      fetch(`/api/projects/${encodeURIComponent(selectedProjectId)}/bom`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phases: newPhases }),
      }).catch(() => { /* silent offline fallback */ });
    }
  }, [selectedProjectId]);

  const bomProfitSync = useMemo(() => {
    void materialSyncTick;
    return calculateProjectBomProfitSync({
      projectId: selectedProjectId,
      projectName: activeProject?.name || projectTitle,
      phases,
    });
  }, [selectedProjectId, activeProject?.name, projectTitle, phases, materialSyncTick]);

  // Opt-in template application (confirms via in-app modal if phases already exist)
  const executeApplyTemplate = (templateType: ProjectTypology) => {
    const freshPhases = generateDefaultBomPhases(templateType);
    saveBomToStorage(freshPhases);
    setExpandedPhaseIds(new Set(freshPhases.map(p => p.id)));
    setPendingTemplateApply(null);
    onNotify?.(`Applied "${templateType}" Bill of Materials template with ${freshPhases.length} WBS phases.`);
  };

  const handleApplySelectedTemplate = () => {
    if (!projectType) {
      onNotify?.('Please choose a template preset from the dropdown first.');
      templateSelectRef.current?.focus();
      return;
    }
    if (phases.length > 0) {
      setPendingTemplateApply(projectType);
      return;
    }
    executeApplyTemplate(projectType);
  };

  // Add a new blank WBS Phase from scratch
  const handleAddPhase = () => {
    const nextCodeChar = String.fromCharCode(65 + (phases.length % 26));
    const newPhase: BomPhase = {
      id: `phase-custom-${Date.now()}`,
      code: nextCodeChar,
      title: phases.length === 0 ? 'General Requirements & Mobilization' : `Custom Phase ${nextCodeChar}`,
      defaultProfitPct: 20,
      defaultOverheadPct: 5,
      isExpanded: true,
      subPhases: [
        {
          id: `sub-custom-${Date.now()}`,
          title: 'Initial Scope of Work',
          items: [
            {
              id: `item-custom-${Date.now()}`,
              scopeOfWork: 'Enter material or labor scope description',
              noOfUnits: 1,
              unit: 'lot',
              unitCost: 0,
              profitPct: 20,
              overheadPct: 5,
              designCost: 0,
            },
          ],
        },
      ],
    };
    saveBomToStorage([...phases, newPhase]);
    onNotify?.(`Added Phase ${nextCodeChar} to "${projectTitle}".`);
  };

  // Phase collapse/expand toggle (pure local UI state — never triggers DB refetch or collapses on SSE)
  const togglePhaseExpand = (phaseId: string) => {
    setExpandedPhaseIds(prev => {
      const next = new Set(prev);
      if (next.has(phaseId)) {
        next.delete(phaseId);
      } else {
        next.add(phaseId);
      }
      return next;
    });
  };

  // Batch-apply Profit % to all items in phase
  const handleBatchProfitChange = (phaseId: string, newProfit: number) => {
    const val = Math.max(0, Math.min(100, Number(newProfit) || 0));
    saveBomToStorage(phases.map(p => {
      if (p.id !== phaseId) return p;
      return {
        ...p,
        defaultProfitPct: val,
        subPhases: p.subPhases.map(sp => ({
          ...sp,
          items: sp.items.map(item => ({ ...item, profitPct: val }))
        }))
      };
    }));
  };

  // Batch-apply Overhead % to all items in phase
  const handleBatchOverheadChange = (phaseId: string, newOverhead: number) => {
    const val = Math.max(0, Math.min(100, Number(newOverhead) || 0));
    saveBomToStorage(phases.map(p => {
      if (p.id !== phaseId) return p;
      return {
        ...p,
        defaultOverheadPct: val,
        subPhases: p.subPhases.map(sp => ({
          ...sp,
          items: sp.items.map(item => ({ ...item, overheadPct: val }))
        }))
      };
    }));
  };

  // Add Item inside Sub-Phase
  const handleAddItem = (phaseId: string, subPhaseId: string) => {
    saveBomToStorage(phases.map(p => {
      if (p.id !== phaseId) return p;
      return {
        ...p,
        subPhases: p.subPhases.map(sp => {
          if (sp.id !== subPhaseId) return sp;
          const newItem: BomLineItem = {
            id: `item-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
            scopeOfWork: 'New Construction Line Item / Material Work',
            noOfUnits: 1,
            unit: 'pcs',
            unitCost: 1000,
            profitPct: p.defaultProfitPct,
            overheadPct: p.defaultOverheadPct,
            designCost: 0
          };
          return {
            ...sp,
            items: [...sp.items, newItem]
          };
        })
      };
    }));
  };

  // Add Sub-Phase inside Phase
  const handleAddSubPhase = async (phaseId: string) => {
    const subTitle = await promptDialog({
      title: 'Add Sub-Phase',
      message: 'Enter a descriptive title for the new BOM sub-phase.',
      placeholder: 'e.g., Site Clearing or Masonry Wall Laying',
      confirmLabel: 'Add Sub-Phase',
    });
    if (!subTitle || !subTitle.trim()) return;

    saveBomToStorage(phases.map(p => {
      if (p.id !== phaseId) return p;
      const newSub: BomSubPhase = {
        id: `sub-${Date.now()}`,
        title: subTitle.trim(),
        items: [
          {
            id: `item-${Date.now()}`,
            scopeOfWork: 'Scope of Work Description',
            noOfUnits: 1,
            unit: 'lot',
            unitCost: 5000,
            profitPct: p.defaultProfitPct,
            overheadPct: p.defaultOverheadPct,
            designCost: 0
          }
        ]
      };
      return {
        ...p,
        isExpanded: true,
        subPhases: [...p.subPhases, newSub]
      };
    }));
  };

  // Delete Line Item
  const handleDeleteItem = (phaseId: string, subPhaseId: string, itemId: string) => {
    saveBomToStorage(phases.map(p => {
      if (p.id !== phaseId) return p;
      return {
        ...p,
        subPhases: p.subPhases.map(sp => {
          if (sp.id !== subPhaseId) return sp;
          return {
            ...sp,
            items: sp.items.filter(i => i.id !== itemId)
          };
        })
      };
    }));
  };

  // Delete Sub-Phase (triggers styled in-app confirmation modal)
  const handleDeleteSubPhase = (phaseId: string, subPhaseId: string) => {
    const targetPhase = phases.find(p => p.id === phaseId);
    const targetSub = targetPhase?.subPhases.find(sp => sp.id === subPhaseId);
    setPendingDeleteTarget({
      type: 'subphase',
      phaseId,
      subPhaseId,
      title: targetSub?.title || 'this sub-phase',
    });
  };

  // Delete Entire Phase (triggers styled in-app confirmation modal)
  const handleDeletePhase = (phaseId: string) => {
    const targetPhase = phases.find(p => p.id === phaseId);
    setPendingDeleteTarget({
      type: 'phase',
      phaseId,
      title: targetPhase ? `Phase ${targetPhase.code}: ${targetPhase.title}` : 'this phase',
    });
  };

  const handleConfirmDeleteTarget = () => {
    if (!pendingDeleteTarget) return;
    if (pendingDeleteTarget.type === 'phase') {
      const nextPhases = phases.filter(p => p.id !== pendingDeleteTarget.phaseId);
      saveBomToStorage(nextPhases);
      if (nextPhases.length === 0) setProjectType('');
      onNotify?.(`Removed ${pendingDeleteTarget.title} from BOM.`);
    } else {
      saveBomToStorage(
        phases.map(p => {
          if (p.id !== pendingDeleteTarget.phaseId) return p;
          return {
            ...p,
            subPhases: p.subPhases.filter(sp => sp.id !== pendingDeleteTarget.subPhaseId),
          };
        })
      );
      onNotify?.(`Removed sub-phase "${pendingDeleteTarget.title}".`);
    }
    setPendingDeleteTarget(null);
  };

  // Update Line Item Field
  const handleUpdateItem = (
    phaseId: string,
    subPhaseId: string,
    itemId: string,
    field: keyof BomLineItem,
    value: any
  ) => {
    saveBomToStorage(phases.map(p => {
      if (p.id !== phaseId) return p;
      return {
        ...p,
        subPhases: p.subPhases.map(sp => {
          if (sp.id !== subPhaseId) return sp;
          return {
            ...sp,
            items: sp.items.map(item => {
              if (item.id !== itemId) return item;
              return {
                ...item,
                [field]: value
              };
            })
          };
        })
      };
    }));
  };

  // Add an Optional Phase (Garage, Balcony, Office Area)
  const handleAddOptionalPhase = (tpl: typeof OPTIONAL_BOM_PHASES[0]) => {
    if (phases.some(p => p.code === tpl.code)) {
      toast(`Phase ${tpl.code}. ${tpl.title} already exists in this estimate.`, 'warning');
      return;
    }
    const newPhase: BomPhase = {
      id: `phase-${tpl.code.toLowerCase()}-${Date.now()}`,
      code: tpl.code,
      title: tpl.title,
      defaultProfitPct: tpl.defaultProfitPct,
      defaultOverheadPct: tpl.defaultOverheadPct,
      isExpanded: true,
      subPhases: [
        {
          id: `sub-${tpl.code}-1`,
          title: `${tpl.title} Execution`,
          items: [
            {
              id: `item-${tpl.code}-1`,
              scopeOfWork: `${tpl.title} Structural Framing & Finishing`,
              noOfUnits: 1,
              unit: 'lot',
              unitCost: 45000,
              profitPct: tpl.defaultProfitPct,
              overheadPct: tpl.defaultOverheadPct,
              designCost: 0
            }
          ]
        }
      ]
    };
    saveBomToStorage([...phases, newPhase]);
    onNotify?.(`Added Phase ${tpl.code}. ${tpl.title} to estimate.`);
  };

  // ---------------------------------------------------------------------------
  // ROLL-UP SUMMARY CALCULATIONS
  // ---------------------------------------------------------------------------
  const summaryCalculations = useMemo(() => {
    let grandDirectCost = 0;
    let grandProfitCost = 0;
    let grandOverheadCost = 0;
    let grandDesignCost = 0;
    let grandTotalCost = 0;
    let totalLineItemsCount = 0;

    const safePhasesList = Array.isArray(phases) ? phases.filter(Boolean) : [];
    const phaseSummaries = safePhasesList.map(phase => {
      let phaseDirect = 0;
      let phaseProfit = 0;
      let phaseOverhead = 0;
      let phaseDesign = 0;
      let phaseTotal = 0;

      const subList = Array.isArray(phase?.subPhases) ? phase.subPhases : [];
      subList.forEach(sp => {
        const itemList = Array.isArray(sp?.items) ? sp.items : [];
        itemList.forEach(item => {
          if (!item) return;
          totalLineItemsCount++;
          const computed = calculateLineItemCosts(item);
          phaseDirect += computed.directTotalCost;
          phaseProfit += computed.profitCost;
          phaseOverhead += computed.overheadCost;
          phaseDesign += Number(item.designCost) || 0;
          phaseTotal += computed.finalTotalCost;
        });
      });

      grandDirectCost += phaseDirect;
      grandProfitCost += phaseProfit;
      grandOverheadCost += phaseOverhead;
      grandDesignCost += phaseDesign;
      grandTotalCost += phaseTotal;

      return {
        phaseId: phase.id,
        code: phase.code,
        title: phase.title,
        phaseDirect,
        phaseProfit,
        phaseOverhead,
        phaseDesign,
        phaseTotalMarkup: phaseProfit + phaseOverhead + phaseDesign,
        phaseTotal
      };
    });

    const grandTotalMarkup = grandProfitCost + grandOverheadCost + grandDesignCost;
    const safeArea = Math.max(1, Number(floorAreaSqm) || 1);
    const costPerSqm = grandTotalCost / safeArea;

    return {
      phaseSummaries,
      grandDirectCost,
      grandProfitCost,
      grandOverheadCost,
      grandDesignCost,
      grandTotalMarkup,
      grandTotalCost,
      costPerSqm,
      totalLineItemsCount
    };
  }, [phases, floorAreaSqm]);

  // ---------------------------------------------------------------------------
  // PRINT ENGINE: CLIENT QUOTATION (HIDES PROFIT/MARKUP) & INTERNAL BOM
  // ---------------------------------------------------------------------------
  const handlePrintQuotation = (hideInternalMarkup: boolean = true) => {
    const tableHeaders = hideInternalMarkup
      ? ['ITEM #', 'SCOPE OF WORK / MATERIAL SPECIFICATIONS', 'QTY', 'UNIT', 'UNIT PRICE (₱)', 'TOTAL COST (₱)']
      : ['ITEM #', 'SCOPE OF WORK', 'QTY', 'UNIT', 'DIRECT UNIT (₱)', 'DIRECT TOTAL (₱)', 'PROFIT %', 'PROFIT (₱)', 'OVERHEAD %', 'TOTAL (₱)'];

    let itemCounter = 1;
    let rowsHtml = '';

    phases.forEach(phase => {
      // Phase Header Row
      const colSpan = hideInternalMarkup ? 6 : 10;
      rowsHtml += `
        <tr style="background:#0f172a;color:#f8fafc;font-weight:bold;font-size:11px;letter-spacing:0.5px;">
          <td colspan="${colSpan}" style="padding:6px 10px;">PHASE ${phase.code}. ${escapePrintHtml(phase.title)}</td>
        </tr>
      `;

      phase.subPhases.forEach(sp => {
        // Sub-phase header row
        rowsHtml += `
          <tr style="background:#f1f5f9;font-weight:600;font-size:10px;color:#334155;">
            <td colspan="${colSpan}" style="padding:4px 10px;border-left:3px solid #f59e0b;">${escapePrintHtml(sp.title)}</td>
          </tr>
        `;

        sp.items.forEach(item => {
          const c = calculateLineItemCosts(item);
          const itemNum = `${phase.code}.${itemCounter++}`;

          if (hideInternalMarkup) {
            rowsHtml += `
              <tr style="border-bottom:1px solid #e2e8f0;font-size:10px;">
                <td style="padding:4px 8px;font-family:monospace;color:#64748b;">${itemNum}</td>
                <td style="padding:4px 8px;">${escapePrintHtml(item.scopeOfWork)}</td>
                <td style="padding:4px 8px;text-align:right;font-family:monospace;">${item.noOfUnits.toLocaleString()}</td>
                <td style="padding:4px 8px;text-align:center;">${escapePrintHtml(item.unit)}</td>
                <td style="padding:4px 8px;text-align:right;font-family:monospace;">₱${c.markedUpUnitCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                <td style="padding:4px 8px;text-align:right;font-weight:bold;font-family:monospace;">₱${c.finalTotalCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
              </tr>
            `;
          } else {
            rowsHtml += `
              <tr style="border-bottom:1px solid #e2e8f0;font-size:9.5px;">
                <td style="padding:4px 6px;font-family:monospace;color:#64748b;">${itemNum}</td>
                <td style="padding:4px 6px;">${escapePrintHtml(item.scopeOfWork)}</td>
                <td style="padding:4px 6px;text-align:right;font-family:monospace;">${item.noOfUnits.toLocaleString()}</td>
                <td style="padding:4px 6px;text-align:center;">${escapePrintHtml(item.unit)}</td>
                <td style="padding:4px 6px;text-align:right;font-family:monospace;">₱${item.unitCost.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                <td style="padding:4px 6px;text-align:right;font-family:monospace;">₱${c.directTotalCost.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                <td style="padding:4px 6px;text-align:center;font-family:monospace;">${item.profitPct}%</td>
                <td style="padding:4px 6px;text-align:right;font-family:monospace;">₱${c.profitCost.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                <td style="padding:4px 6px;text-align:center;font-family:monospace;">${item.overheadPct}%</td>
                <td style="padding:4px 6px;text-align:right;font-weight:bold;font-family:monospace;">₱${c.finalTotalCost.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
              </tr>
            `;
          }
        });
      });
    });

    // Summary block html
    const summaryBlockHtml = `
      <div style="margin-top:20px;border-top:2px solid #0f172a;padding-top:12px;">
        <table style="width:100%;font-size:11px;border-collapse:collapse;">
          ${!hideInternalMarkup ? `
            <tr>
              <td style="padding:4px;color:#64748b;">Direct Labor & Material Subtotal:</td>
              <td style="padding:4px;text-align:right;font-weight:bold;font-family:monospace;">₱${summaryCalculations.grandDirectCost.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
            </tr>
            <tr>
              <td style="padding:4px;color:#64748b;">Total Contractor Profit Allocation:</td>
              <td style="padding:4px;text-align:right;font-weight:bold;font-family:monospace;">₱${summaryCalculations.grandProfitCost.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
            </tr>
            <tr>
              <td style="padding:4px;color:#64748b;">Total Overhead & Administrative Expenses:</td>
              <td style="padding:4px;text-align:right;font-weight:bold;font-family:monospace;">₱${summaryCalculations.grandOverheadCost.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
            </tr>
          ` : ''}
          <tr style="background:#f8fafc;font-size:13px;font-weight:bold;border-top:2px solid #0f172a;border-bottom:2px solid #0f172a;">
            <td style="padding:8px;color:#0f172a;">TOTAL ESTIMATED CONTRACT PROJECT COST:</td>
            <td style="padding:8px;text-align:right;color:#0f172a;font-family:monospace;">₱${summaryCalculations.grandTotalCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
          </tr>
          <tr>
            <td style="padding:4px;color:#64748b;">Total Floor Area: ${floorAreaSqm} sqm</td>
            <td style="padding:4px;text-align:right;color:#64748b;font-family:monospace;">Unit Cost: ₱${summaryCalculations.costPerSqm.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} / sqm</td>
          </tr>
        </table>
      </div>
    `;

    const bodyHtml = `
      <div style="margin-bottom:12px;font-size:10px;color:#475569;display:flex;justify-content:space-between;border-bottom:1px solid #cbd5e1;padding-bottom:8px;">
        <div>
          <strong>CLIENT:</strong> ${escapePrintHtml(ownerName)}<br/>
          <strong>PROJECT:</strong> ${escapePrintHtml(projectTitle)} (${escapePrintHtml(projectType)})<br/>
          <strong>LOCATION:</strong> ${escapePrintHtml(siteLocation)}
        </div>
        <div style="text-align:right;">
          <strong>ESTIMATE REF:</strong> ${escapePrintHtml(estimateRefNo)}<br/>
          <strong>DATE:</strong> ${escapePrintHtml(estimateDate)}<br/>
          <strong>ESTIMATOR:</strong> LDM Engineering & Estimating Desk
        </div>
      </div>

      <table style="width:100%;border-collapse:collapse;margin-top:8px;">
        <thead>
          <tr style="background:#1e293b;color:#f8fafc;font-size:10px;text-align:left;">
            ${tableHeaders.map((h, i) => `<th style="padding:6px 8px;border:1px solid #334155;text-align:${i >= (hideInternalMarkup ? 2 : 2) ? 'right' : 'left'};">${h}</th>`).join('')}
          </tr>
        </thead>
        <tbody>
          ${rowsHtml}
        </tbody>
      </table>

      ${summaryBlockHtml}
    `;

    openEnterprisePrintWindow({
      title: hideInternalMarkup
        ? 'Official Bill of Materials & Turnkey Construction Quotation'
        : 'Detailed Engineering Bill of Materials (BOM) & Cost Ledger',
      subtitle: `${projectTitle} — ${projectType} | ${siteLocation}`,
      docRef: estimateRefNo,
      orientation: hideInternalMarkup ? 'portrait' : 'landscape',
      projectMeta: {
        name: projectTitle,
        location: siteLocation,
        client: ownerName,
        period: `Floor Area: ${floorAreaSqm} sqm (₱${Math.round(summaryCalculations.costPerSqm).toLocaleString()}/sqm)`
      },
      kpiSummary: [
        { label: 'Total Estimated Cost', value: `₱${summaryCalculations.grandTotalCost.toLocaleString(undefined, { minimumFractionDigits: 2 })}` },
        { label: 'Floor Area', value: `${floorAreaSqm} sqm` },
        { label: 'Unit Cost / sqm', value: `₱${Math.round(summaryCalculations.costPerSqm).toLocaleString()}/sqm` },
        { label: 'Active WBS Phases', value: `${phases.length} Phases` }
      ],
      signatures: [
        { role: 'Prepared By', name: 'Engr. Carlos Mendoza', title: 'Cost Engineer / Estimator' },
        { role: 'Checked & Approved', name: 'Engr. Ricardo Ramos', title: 'Head of Engineering & Projects' },
        { role: 'Client Conforme', name: ownerName, title: 'Owner / Authorized Representative' }
      ],
      bodyHtml
    });
  };

  // ---------------------------------------------------------------------------
  // SYNC BOM PHASES TO MASTER GANTT CHART (Strictly Scoped to Target projectId)
  // ---------------------------------------------------------------------------
  const [syncConfirmModal, setSyncConfirmModal] = useState<{
    existingTasks: any[];
    tasksWithProgressCount: number;
  } | null>(null);
  const [syncCompletedModal, setSyncCompletedModal] = useState<{
    phasesCount: number;
    tasksCount: number;
    preservedCount: number;
  } | null>(null);

  const normalizeMatchKey = (val: string | undefined | null) =>
    String(val || '')
      .toLowerCase()
      .replace(/^phase\s+[a-z0-9]+[:\s-]*/i, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();

  const fetchExistingProjectGanttTasks = async (targetProjectId: string): Promise<any[]> => {
    try {
      const res = await secureFetch(`/api/projects/${encodeURIComponent(targetProjectId)}/gantt`);
      if (res.ok) {
        const json = await res.json();
        if (Array.isArray(json?.data) && json.data.length > 0) {
          return json.data.map((t: any) => ({
            ...t,
            projectId: targetProjectId,
            startDate: t.startDate || (t.start_date ? String(t.start_date).split(' ')[0] : undefined),
            endDate: t.endDate || (t.end_date ? String(t.end_date).split(' ')[0] : undefined),
            parentTaskId: t.parentTaskId ?? (t.parent && t.parent !== 0 && t.parent !== '0' ? String(t.parent) : null),
            contractorName: t.contractorName || t.contractor || undefined,
          }));
        }
      }
    } catch {
      // Fallback to project-scoped localStorage cache below
    }
    try {
      const storageKey = `${GANTT_TASKS_STORAGE_PREFIX}${targetProjectId}`;
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          return parsed.filter((t: any) => !t.projectId || t.projectId === targetProjectId);
        }
      }
    } catch {
      // Ignore parse errors
    }
    return [];
  };

  const executeSyncToMasterGantt = async (existingTasks: any[]) => {
    if (!selectedProjectId) return;
    const targetProjectId = selectedProjectId;
    setSyncConfirmModal(null);
    setSyncGanttLoading(true);
    try {
      const storageKey = `${GANTT_TASKS_STORAGE_PREFIX}${targetProjectId}`;
      const now = new Date();
      let cumulativeStart = new Date(now);

      // Index existing tasks strictly belonging to targetProjectId so we preserve progress, status, assignee & dates
      const scopedExisting = existingTasks.filter((t) => !t.projectId || t.projectId === targetProjectId);
      const matchedExistingIds = new Set<string>();
      let preservedCount = 0;

      const findMatchingExisting = (wbsCode: string, text: string, type: 'project' | 'task') => {
        const normText = normalizeMatchKey(text);
        const match = scopedExisting.find((et) => {
          if (matchedExistingIds.has(String(et.id))) return false;
          const etNorm = normalizeMatchKey(et.text || et.title);
          const sameWbs = wbsCode && et.wbsCode && String(et.wbsCode).trim() === String(wbsCode).trim();
          const sameName = normText && etNorm && (etNorm === normText || etNorm.includes(normText) || normText.includes(etNorm));
          if (sameName) return true;
          if (sameWbs && (et.type === type || (!et.parentTaskId && type === 'project'))) return true;
          return false;
        });
        if (match) matchedExistingIds.add(String(match.id));
        return match;
      };

      const newGanttTasks: any[] = [];
      let sortCounter = 1;

      phases.forEach((phase, pIdx) => {
        const phaseWbs = `${pIdx + 1}.0`;
        const phaseTitleText = `Phase ${phase.code}: ${phase.title}`;
        const existingParent = findMatchingExisting(phaseWbs, phaseTitleText, 'project');

        const phaseParentId = existingParent?.id
          ? String(existingParent.id)
          : `gantt-phase-${targetProjectId}-${phase.code.toLowerCase()}-${pIdx + 1}`;
        const phaseSummary = summaryCalculations.phaseSummaries.find(ps => ps.phaseId === phase.id);
        const phaseDurationDays = Math.max(3, Math.min(30, Math.round((phaseSummary?.phaseDirect || 50000) / 15000)));

        const phaseStartStr = existingParent?.startDate || cumulativeStart.toISOString().split('T')[0];
        const phaseEnd = new Date(cumulativeStart);
        phaseEnd.setDate(phaseEnd.getDate() + phaseDurationDays);
        const phaseEndStr = existingParent?.endDate || phaseEnd.toISOString().split('T')[0];

        const existingParentProgress = typeof existingParent?.progress === 'number' ? existingParent.progress : 0;
        if (existingParent && existingParentProgress > 0) preservedCount++;

        // Parent WBS Task (type = 'project') — preserves existing progress, status, assignee & dates
        newGanttTasks.push({
          id: phaseParentId,
          projectId: targetProjectId,
          wbsCode: phaseWbs,
          text: phaseTitleText,
          startDate: phaseStartStr,
          endDate: phaseEndStr,
          duration: Number(existingParent?.duration) > 0 ? Number(existingParent.duration) : phaseDurationDays,
          progress: existingParentProgress,
          status: existingParent?.status || (existingParentProgress >= 1 ? 'COMPLETED' : existingParentProgress > 0 ? 'IN_PROGRESS' : 'TODO'),
          weight: Math.max(1, Math.round(((phaseSummary?.phaseTotal || 1) / (summaryCalculations.grandTotalCost || 1)) * 100)),
          constructionPhase: phase.title,
          type: 'project',
          parentTaskId: null,
          sortOrder: sortCounter++,
          assignedContractorId: existingParent?.assignedContractorId || '',
          contractorName: existingParent?.contractorName || existingParent?.contractor || 'LDM Construction Crew',
          predecessorIds: pIdx > 0 ? [`${pIdx}.0`] : []
        });

        // Child Tasks for each Sub-Phase
        let subCounter = 1;
        phase.subPhases.forEach((sp) => {
          const childWbs = `${pIdx + 1}.${subCounter}`;
          const existingChild = findMatchingExisting(childWbs, sp.title, 'task');
          const childDuration = Math.max(2, Math.round(phaseDurationDays / Math.max(1, phase.subPhases.length)));
          const childStart = new Date(cumulativeStart);
          const childEnd = new Date(childStart);
          childEnd.setDate(childEnd.getDate() + childDuration);

          const existingChildProgress = typeof existingChild?.progress === 'number' ? existingChild.progress : 0;
          if (existingChild && existingChildProgress > 0) preservedCount++;

          newGanttTasks.push({
            id: existingChild?.id
              ? String(existingChild.id)
              : `gantt-sub-${targetProjectId}-${phase.code.toLowerCase()}-${subCounter}`,
            projectId: targetProjectId,
            wbsCode: childWbs,
            text: sp.title,
            startDate: existingChild?.startDate || childStart.toISOString().split('T')[0],
            endDate: existingChild?.endDate || childEnd.toISOString().split('T')[0],
            duration: Number(existingChild?.duration) > 0 ? Number(existingChild.duration) : childDuration,
            progress: existingChildProgress,
            status: existingChild?.status || (existingChildProgress >= 1 ? 'COMPLETED' : existingChildProgress > 0 ? 'IN_PROGRESS' : 'TODO'),
            weight: Math.max(1, Math.round(100 / Math.max(1, phase.subPhases.length))),
            constructionPhase: phase.title,
            type: 'task',
            parentTaskId: phaseParentId,
            sortOrder: sortCounter++,
            assignedContractorId: existingChild?.assignedContractorId || '',
            contractorName: existingChild?.contractorName || existingChild?.contractor || 'LDM In-House Trade Gang',
            predecessorIds: []
          });
          subCounter++;
        });

        // Advance cumulative calendar
        cumulativeStart.setDate(cumulativeStart.getDate() + Math.max(2, Math.round(phaseDurationDays * 0.75)));
      });

      // Keep any unmatched existing tasks in THIS project that already have recorded progress (> 0%)
      scopedExisting.forEach((et) => {
        if (!matchedExistingIds.has(String(et.id)) && typeof et.progress === 'number' && et.progress > 0) {
          preservedCount++;
          newGanttTasks.push({
            ...et,
            projectId: targetProjectId,
            sortOrder: sortCounter++,
          });
        }
      });

      // Persist strictly to Neon PostgreSQL for targetProjectId only (never touches other projects)
      try {
        await secureFetch(`/api/projects/${encodeURIComponent(targetProjectId)}/gantt/sync`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tasks: newGanttTasks,
            links: [],
            deletedTaskIds: [],
            deletedLinkIds: [],
          }),
        });
      } catch (apiErr) {
        console.warn('Background Gantt DB sync fallback to local cache:', apiErr);
      }

      // Save strictly into targetProjectId's Gantt storage key (never touches global projects list or other project keys)
      localStorage.setItem(storageKey, JSON.stringify(newGanttTasks));
      window.dispatchEvent(new CustomEvent(GANTT_TASKS_UPDATED_EVENT, { detail: { projectId: targetProjectId, tasks: newGanttTasks } }));

      logAuditEvent({
        entityType: 'CIVIL_WORKS',
        entityId: targetProjectId,
        action: 'BOM_GANTT_SYNC',
        actorName: 'Engr. Dan Ramos',
        actorRole: 'Operations Manager',
        details: `Synchronized ${phases.length} WBS phases (${newGanttTasks.length} tasks, preserved ${preservedCount} in-progress items) from BOM Quotation Builder to Master Gantt Chart for ${projectTitle}.`
      });

      onNotify?.(`⚡ Synced ${newGanttTasks.length} BOM tasks for "${projectTitle}" (${preservedCount} existing progress item(s) preserved).`);
      setSyncCompletedModal({
        phasesCount: phases.length,
        tasksCount: newGanttTasks.length,
        preservedCount,
      });
    } catch (err) {
      console.error(err);
      onNotify?.('❌ Error syncing BOM phases to Master Gantt.');
    } finally {
      setSyncGanttLoading(false);
    }
  };

  const handleSyncToMasterGantt = async () => {
    if (!selectedProjectId) {
      onNotify?.('⚠️ Please select an active project first before syncing to Master Gantt.');
      return;
    }

    setSyncGanttLoading(true);
    const existingTasks = await fetchExistingProjectGanttTasks(selectedProjectId);
    setSyncGanttLoading(false);

    if (existingTasks.length > 0) {
      const tasksWithProgressCount = existingTasks.filter(
        (t) => typeof t.progress === 'number' && t.progress > 0
      ).length;
      setSyncConfirmModal({ existingTasks, tasksWithProgressCount });
      return;
    }

    await executeSyncToMasterGantt([]);
  };

  // Export CSV
  const handleExportCsv = () => {
    const headers = ['Phase', 'Sub-Phase', 'Scope of Work', 'Units', 'Unit', 'Unit Cost (PHP)', 'Direct Cost (PHP)', 'Profit %', 'Profit Cost (PHP)', 'Overhead %', 'Overhead Cost (PHP)', 'Design (PHP)', 'Total Markup (PHP)', 'Final Cost (PHP)'];
    const rows: (string | number)[][] = [];

    phases.forEach(phase => {
      phase.subPhases.forEach(sp => {
        sp.items.forEach(item => {
          const c = calculateLineItemCosts(item);
          rows.push([
            `Phase ${phase.code}. ${phase.title}`,
            sp.title,
            item.scopeOfWork,
            item.noOfUnits,
            item.unit,
            item.unitCost,
            c.directTotalCost,
            item.profitPct,
            c.profitCost,
            item.overheadPct,
            c.overheadCost,
            item.designCost,
            c.totalMarkup,
            c.finalTotalCost
          ]);
        });
      });
    });

    exportToCsv(`BOM_Quotation_${projectTitle.replace(/\s+/g, '_')}`, headers, rows);
  };

  return (
    <div className="space-y-5 font-sans">

      {/* 1. TOP HEADER & PROJECT SELECTOR BANNER */}
      <div className={`p-4 sm:p-5 rounded-2xl border shadow-sm transition-colors ${isDark ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'
        }`}>
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b pb-4 mb-4 border-slate-800/60">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="w-2 h-2 rounded-full bg-amber-400"></span>
              <span className="text-[10px] font-mono text-amber-400 font-bold uppercase tracking-wider">
                ENGINEERING BILL OF MATERIALS &amp; CLIENT QUOTATION BUILDER
              </span>
            </div>
            <h2 className="text-xl sm:text-2xl font-black text-white tracking-tight flex items-center gap-2">
              <Calculator className="w-6 h-6 text-amber-400" />
              <span>Bill of Materials (BOM) &amp; Quotation</span>
            </h2>
            <p className="text-xs text-slate-400 mt-1">
              Detailed construction estimate engine matching the Santos spreadsheet specification. Automatic straight-percentage markups, collapsible WBS phases, and live Gantt chart sync.
            </p>
          </div>

          {/* Action Toolbar */}
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setIsClientMode(!isClientMode)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 border transition cursor-pointer ${isClientMode
                ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                : 'bg-slate-800 text-slate-300 border-slate-700 hover:text-white'
                }`}
              title="Toggle client-friendly view (hides profit, overhead, and markup breakdown columns)"
            >
              {isClientMode ? <EyeOff className="w-3.5 h-3.5 text-amber-400" /> : <Eye className="w-3.5 h-3.5" />}
              <span>{isClientMode ? 'Client Mode: Active (Markup Hidden)' : 'Internal Engineering Mode'}</span>
            </button>

            <button
              type="button"
              onClick={() => handlePrintQuotation(true)}
              className="px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs flex items-center gap-1.5 transition cursor-pointer shadow-xs"
              title="Print clean client quotation where internal profits & markups are combined into unit costs"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>🖨️ Print Client Quotation</span>
            </button>

            <button
              type="button"
              onClick={() => handlePrintQuotation(false)}
              className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-medium flex items-center gap-1.5 transition cursor-pointer"
              title="Print full engineering BOM with internal profit & overhead columns"
            >
              <Printer className="w-3.5 h-3.5 text-amber-400" />
              <span>Internal BOM</span>
            </button>

            <button
              type="button"
              onClick={handleExportCsv}
              className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-medium flex items-center gap-1.5 transition cursor-pointer"
            >
              <Download className="w-3.5 h-3.5 text-cyan-400" />
              <span>Export CSV</span>
            </button>

            <button
              type="button"
              disabled={syncGanttLoading}
              onClick={handleSyncToMasterGantt}
              className="px-3.5 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs flex items-center gap-1.5 transition cursor-pointer shadow-xs"
            >
              <Sparkles className="w-3.5 h-3.5 text-slate-950" />
              <span>{syncGanttLoading ? 'Syncing...' : '⚡ Sync Phases to Master Gantt'}</span>
            </button>
          </div>
        </div>

        {/* Project Meta Selectors Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
          <div>
            <label className="block text-[10px] font-mono text-slate-400 uppercase font-bold mb-1">
              Select PMS Project *
            </label>
            <div className="relative">
              <Building2 className="w-4 h-4 text-slate-500 absolute left-3 top-2.5" />
              <select
                value={selectedProjectId}
                onChange={(e) => setSelectedProjectId(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded-xl pl-9 pr-3 py-2 text-white font-medium focus:border-amber-500 focus:outline-none"
              >
                {activeProjectsList.map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-[10px] font-mono text-slate-400 uppercase font-bold mb-1">
              Project Template Preset
            </label>
            <div className="flex items-center gap-1.5">
              <select
                ref={templateSelectRef}
                value={projectType}
                onChange={(e) => setProjectType(e.target.value as '' | ProjectTypology)}
                className="flex-1 min-w-0 bg-slate-950 border border-amber-500/40 text-amber-300 font-bold rounded-xl px-2.5 py-2 focus:border-amber-500 focus:outline-none cursor-pointer"
              >
                <option value="">Blank / Custom (No Template)</option>
                <option value="2-Storey Residential Unit">2-Storey Residential Unit</option>
                <option value="1-Storey / Bungalow">1-Storey / Bungalow</option>
                <option value="Renovation / Fit-Out">Renovation / Fit-Out</option>
                <option value="Demolition / Excavation">Demolition / Excavation</option>
                <option value="Commercial Building">Commercial Building</option>
              </select>
              <button
                type="button"
                onClick={() => {
                  if (projectType) {
                    handleApplySelectedTemplate();
                  } else {
                    setShowTemplatePickerModal(true);
                  }
                }}
                className="px-2.5 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-[11px] shrink-0 transition-colors cursor-pointer"
                title={projectType ? 'Apply selected template preset to this project' : 'Browse available template presets'}
              >
                {projectType ? 'Apply' : 'Browse'}
              </button>
            </div>
          </div>

          <div>
            <label className="block text-[10px] font-mono text-slate-400 uppercase font-bold mb-1">
              Owner / Client Name
            </label>
            <div className="relative">
              <User className="w-4 h-4 text-slate-500 absolute left-3 top-2.5" />
              <input
                type="text"
                value={ownerName}
                onChange={(e) => setOwnerName(e.target.value)}
                placeholder="Client Name"
                className="w-full bg-slate-950 border border-slate-700 rounded-xl pl-9 pr-3 py-2 text-white focus:border-amber-500 focus:outline-none"
              />
            </div>
          </div>

          <div>
            <label className="block text-[10px] font-mono text-slate-400 uppercase font-bold mb-1">
              Site Location
            </label>
            <div className="relative">
              <MapPin className="w-4 h-4 text-slate-500 absolute left-3 top-2.5" />
              <input
                type="text"
                value={siteLocation}
                onChange={(e) => setSiteLocation(e.target.value)}
                placeholder="Location"
                className="w-full bg-slate-950 border border-slate-700 rounded-xl pl-9 pr-3 py-2 text-white focus:border-amber-500 focus:outline-none"
              />
            </div>
          </div>
        </div>

        {/* Secondary Parameters Bar */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3 pt-3 border-t border-slate-800/60 text-xs">
          <div>
            <label className="block text-[10px] font-mono text-slate-400 uppercase font-bold mb-1">Total Floor Area (sqm)</label>
            <input
              type="number"
              min={1}
              value={floorAreaSqm}
              onChange={(e) => setFloorAreaSqm(Math.max(1, Number(e.target.value) || 1))}
              className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-1.5 text-white font-mono font-bold focus:border-amber-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-[10px] font-mono text-slate-400 uppercase font-bold mb-1">Cost / Floor Area (₱/sqm)</label>
            <div className="bg-slate-950 border border-emerald-500/30 rounded-xl px-3 py-1.5 text-emerald-400 font-mono font-bold text-sm">
              ₱{Math.round(summaryCalculations.costPerSqm).toLocaleString()} / sqm
            </div>
          </div>
          <div>
            <label className="block text-[10px] font-mono text-slate-400 uppercase font-bold mb-1">Estimate Ref. No.</label>
            <input
              type="text"
              value={estimateRefNo}
              onChange={(e) => setEstimateRefNo(e.target.value)}
              className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-1.5 text-white font-mono focus:border-amber-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-[10px] font-mono text-slate-400 uppercase font-bold mb-1">Estimate Date</label>
            <input
              type="date"
              value={estimateDate}
              onChange={(e) => setEstimateDate(e.target.value)}
              className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-1.5 text-white font-mono focus:border-amber-500 focus:outline-none"
            />
          </div>
        </div>
      </div>

      {/* 2. OVERALL COST ANALYSIS KPI CARDS */}
      {isClientMode ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
          <div className="bg-slate-900/80 border border-emerald-500/40 p-3.5 rounded-xl sm:col-span-2">
            <span className="text-[10px] font-mono text-emerald-400 uppercase block font-bold">TOTAL ESTIMATED CONTRACT PRICE</span>
            <span className="text-xl sm:text-2xl font-black font-mono text-emerald-400 mt-1 block">
              ₱{summaryCalculations.grandTotalCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
            <span className="text-[10px] text-slate-400 font-mono mt-0.5 block">
              Turnkey Design &amp; Build Scope &bull; {summaryCalculations.totalLineItemsCount} Deliverable Items
            </span>
          </div>

          <div className="bg-slate-900/80 border border-slate-800 p-3.5 rounded-xl">
            <span className="text-[10px] font-mono text-cyan-400 uppercase block font-bold">ESTIMATED COST PER SQM</span>
            <span className="text-xl font-bold font-mono text-cyan-300 mt-1 block">
              ₱{(floorAreaSqm > 0 ? Math.round(summaryCalculations.grandTotalCost / floorAreaSqm) : 0).toLocaleString()}
            </span>
            <span className="text-[10px] text-slate-500 font-mono">Gross Floor Area Base</span>
          </div>

          <div className="bg-slate-900/80 border border-slate-800 p-3.5 rounded-xl">
            <span className="text-[10px] font-mono text-amber-400 uppercase block font-bold">PROJECT SPECS &amp; WBS</span>
            <span className="text-xl font-bold font-mono text-white mt-1 block">
              {floorAreaSqm} SQM
            </span>
            <span className="text-[10px] text-slate-400 font-mono">{phases.length} Architectural WBS Phases</span>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
          <div className="bg-slate-900/80 border border-slate-800 p-3 rounded-xl">
            <span className="text-[10px] font-mono text-slate-400 uppercase block font-bold">Direct Labor &amp; Mat</span>
            <span className="text-base font-bold font-mono text-white mt-1 block">
              ₱{summaryCalculations.grandDirectCost.toLocaleString(undefined, { maximumFractionDigits: 0 })}
            </span>
            <span className="text-[10px] text-slate-500 font-mono">Net Materials Base</span>
          </div>

          <div className={`bg-slate-900/80 border p-3 rounded-xl ${bomProfitSync.isIntact ? 'border-emerald-500/30' : 'border-rose-500/40'}`}>
            <div className="flex items-center justify-between gap-1">
              <span className="text-[10px] font-mono text-amber-400 uppercase block font-bold">Total Profit Pool</span>
              <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded border font-bold ${bomProfitSync.isIntact
                ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                : 'bg-rose-500/15 text-rose-300 border-rose-500/30'
                }`}>
                {bomProfitSync.profitMarginPct}% {bomProfitSync.isIntact ? 'Intact' : 'Impacted'}
              </span>
            </div>
            <span className={`text-base font-bold font-mono mt-1 block ${bomProfitSync.isIntact ? 'text-amber-400' : 'text-rose-400'}`}>
              ₱{bomProfitSync.remainingProfit.toLocaleString(undefined, { maximumFractionDigits: 0 })}
            </span>
            <span className="text-[10px] text-slate-400 font-mono">
              {bomProfitSync.totalOverrun > 0
                ? `Base ₱${bomProfitSync.baselineProfit.toLocaleString()} • -₱${bomProfitSync.totalOverrun.toLocaleString()} overrun`
                : `Base ₱${bomProfitSync.baselineProfit.toLocaleString()} • 0 overruns`}
            </span>
          </div>

          <div className="bg-slate-900/80 border border-slate-800 p-3 rounded-xl">
            <span className="text-[10px] font-mono text-blue-400 uppercase block font-bold">Total Overhead</span>
            <span className="text-base font-bold font-mono text-blue-400 mt-1 block">
              ₱{summaryCalculations.grandOverheadCost.toLocaleString(undefined, { maximumFractionDigits: 0 })}
            </span>
            <span className="text-[10px] text-slate-500 font-mono">Site Ops &amp; Admin</span>
          </div>

          <div className="bg-slate-900/80 border border-slate-800 p-3 rounded-xl">
            <span className="text-[10px] font-mono text-purple-400 uppercase block font-bold">Total Markup</span>
            <span className="text-base font-bold font-mono text-purple-400 mt-1 block">
              ₱{summaryCalculations.grandTotalMarkup.toLocaleString(undefined, { maximumFractionDigits: 0 })}
            </span>
            <span className="text-[10px] text-slate-500 font-mono">Profit + OH + Design</span>
          </div>

          <div className="bg-slate-900/80 border border-emerald-500/30 p-3 rounded-xl sm:col-span-2">
            <span className="text-[10px] font-mono text-emerald-400 uppercase block font-bold">GRAND TOTAL PROJECT COST</span>
            <span className="text-lg font-black font-mono text-emerald-400 mt-0.5 block">
              ₱{summaryCalculations.grandTotalCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
            <span className="text-[10px] text-slate-400 font-mono">
              {summaryCalculations.totalLineItemsCount} Line Items across {phases.length} WBS Phases
            </span>
          </div>
        </div>
      )}

      {/* 3. OPTIONAL PHASE QUICK-ADD PILLS */}
      <div className="flex items-center gap-2 flex-wrap text-xs bg-slate-900/40 border border-slate-800/80 p-2.5 rounded-xl">
        <span className="text-[10px] font-mono text-slate-400 uppercase font-bold flex items-center gap-1">
          <Plus className="w-3.5 h-3.5 text-amber-400" />
          <span>Add Optional Phases:</span>
        </span>
        {OPTIONAL_BOM_PHASES.map(tpl => {
          const exists = phases.some(p => p.code === tpl.code);
          return (
            <button
              key={tpl.code}
              type="button"
              disabled={exists}
              onClick={() => handleAddOptionalPhase(tpl)}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-mono font-bold flex items-center gap-1 transition ${exists
                ? 'bg-slate-800/50 text-slate-500 border border-slate-800 cursor-not-allowed'
                : 'bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/30 cursor-pointer'
                }`}
            >
              <span>+ Phase {tpl.code}: {tpl.title}</span>
              {exists && <Check className="w-3 h-3 text-emerald-400" />}
            </button>
          );
        })}
      </div>

      {/* 4. EXPANDABLE WBS PHASES & MATERIAL LINE ITEMS ACCORDION */}
      <div className="space-y-4">
        {phases.length === 0 ? (
          <div className={`rounded-2xl border p-10 text-center space-y-4 ${isDark ? 'bg-slate-900/70 border-slate-800' : 'bg-white border-slate-200'
            }`}>
            <div className="w-12 h-12 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-amber-400 flex items-center justify-center mx-auto">
              <FileSpreadsheet className="w-6 h-6" />
            </div>
            <div className="space-y-1">
              <h3 className={`text-base font-bold ${isDark ? 'text-white' : 'text-slate-900'}`}>
                No Bill of Materials Phases Yet
              </h3>
              <p className="text-xs text-slate-400 max-w-md mx-auto leading-relaxed">
                <strong className={isDark ? 'text-slate-200' : 'text-slate-800'}>{projectTitle}</strong> starts with a blank BOM (₱0.00). Build your custom WBS phases from scratch or apply a standard template preset above.
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-3 pt-1">
              <button
                type="button"
                onClick={handleAddPhase}
                className="px-4 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs flex items-center gap-1.5 shadow-md shadow-amber-500/20 cursor-pointer transition-colors"
              >
                <Plus className="w-4 h-4" />
                <span>+ Add First Phase</span>
              </button>
              <button
                type="button"
                onClick={() => setShowTemplatePickerModal(true)}
                className={`px-4 py-2.5 rounded-xl border font-semibold text-xs flex items-center gap-1.5 cursor-pointer transition-colors ${isDark
                    ? 'bg-slate-950 hover:bg-slate-800 border-slate-700 text-slate-200'
                    : 'bg-slate-50 hover:bg-slate-100 border-slate-300 text-slate-700'
                  }`}
              >
                <Layers className="w-4 h-4 text-amber-400" />
                <span>Apply a Template Preset</span>
              </button>
            </div>
          </div>
        ) : (
          phases.map((phase, pIdx) => {
            const phaseSummary = summaryCalculations.phaseSummaries.find(ps => ps.phaseId === phase.id);

            return (
              <div
                key={phase.id}
                className={`rounded-2xl border overflow-hidden shadow-md transition-colors ${isDark ? 'bg-slate-900/90 border-slate-800' : 'bg-white border-slate-200'
                  }`}
              >
                {/* Phase Header Bar */}
                <div className="p-3.5 sm:p-4 bg-slate-950/80 border-b border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-3">
                  <div
                    onClick={() => togglePhaseExpand(phase.id)}
                    className="flex items-center gap-2.5 cursor-pointer select-none"
                  >
                    <button
                      type="button"
                      className="w-6 h-6 rounded-md bg-slate-800 flex items-center justify-center text-slate-300 hover:text-white"
                    >
                      {expandedPhaseIds.has(phase.id) ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                    </button>
                    <div>
                      <span className="text-[10px] font-mono text-amber-400 uppercase font-bold tracking-wider">
                        PHASE {phase.code}
                      </span>
                      <h3 className="text-sm sm:text-base font-bold text-white tracking-tight">
                        {phase.title}
                      </h3>
                    </div>
                  </div>

                  {/* Phase Batch Controls & Subtotals */}
                  <div className="flex flex-wrap items-center gap-3">
                    {!isClientMode && (
                      <div className="flex items-center gap-2 bg-slate-900 border border-slate-700/80 px-2.5 py-1 rounded-lg text-xs font-mono">
                        <span className="text-slate-400 text-[10px]">Phase Profit:</span>
                        <input
                          type="number"
                          min={0}
                          max={100}
                          value={phase.defaultProfitPct}
                          onChange={(e) => handleBatchProfitChange(phase.id, Number(e.target.value))}
                          className="w-12 bg-slate-950 border border-slate-700 rounded px-1.5 py-0.5 text-center text-amber-400 font-bold"
                        />
                        <span className="text-slate-400 text-[10px]">%</span>
                        <span className="text-slate-600">|</span>
                        <span className="text-slate-400 text-[10px]">Overhead:</span>
                        <input
                          type="number"
                          min={0}
                          max={100}
                          value={phase.defaultOverheadPct}
                          onChange={(e) => handleBatchOverheadChange(phase.id, Number(e.target.value))}
                          className="w-12 bg-slate-950 border border-slate-700 rounded px-1.5 py-0.5 text-center text-blue-400 font-bold"
                        />
                        <span className="text-slate-400 text-[10px]">%</span>
                      </div>
                    )}

                    <div className="text-right font-mono">
                      <span className="text-[10px] text-slate-400 block">Phase Total</span>
                      <span className="text-sm sm:text-base font-black text-emerald-400">
                        ₱{(phaseSummary?.phaseTotal || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </span>
                    </div>

                    <button
                      type="button"
                      onClick={() => handleAddSubPhase(phase.id)}
                      className="px-2.5 py-1.5 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 border border-amber-500/30 text-xs font-bold flex items-center gap-1 cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>+ Add Sub-Phase</span>
                    </button>

                    {!isClientMode && (
                      <button
                        type="button"
                        onClick={() => handleDeletePhase(phase.id)}
                        className="p-1.5 rounded-lg bg-slate-900 hover:bg-rose-950/70 text-slate-400 hover:text-rose-400 border border-slate-700 hover:border-rose-500/40 transition-colors cursor-pointer"
                        title={`Delete Phase ${phase.code}`}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>

                {/* Sub-Phases & Items Content */}
                {expandedPhaseIds.has(phase.id) && (
                  <div className="p-3 sm:p-4 space-y-4">
                    {phase.subPhases.map((sp) => (
                      <div key={sp.id} className="bg-slate-950/40 border border-slate-800 rounded-xl overflow-hidden">

                        {/* Sub-Phase Title Row */}
                        <div className="px-3.5 py-2 bg-slate-900/60 border-b border-slate-800 flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="w-1.5 h-1.5 rounded-full bg-amber-400"></span>
                            <span className="text-xs font-bold text-white">{sp.title}</span>
                            <span className="text-[10px] font-mono text-slate-400">({sp.items.length} item{sp.items.length === 1 ? '' : 's'})</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => handleAddItem(phase.id, sp.id)}
                              className="text-[11px] font-mono text-amber-400 hover:text-amber-300 font-bold flex items-center gap-1 cursor-pointer"
                            >
                              <Plus className="w-3 h-3" />
                              <span>Add Item</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteSubPhase(phase.id, sp.id)}
                              className="text-slate-500 hover:text-red-400 p-1 cursor-pointer"
                              title="Delete Sub-Phase"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>

                        {/* Items Table */}
                        <div className="overflow-x-auto">
                          <table className="w-full text-left text-xs border-collapse">
                            <thead>
                              <tr className="bg-slate-950 text-slate-400 font-mono text-[10px] uppercase border-b border-slate-800">
                                <th className="py-2.5 px-3 min-w-[200px]">Scope of Work / Material</th>
                                <th className="py-2.5 px-2 w-20 text-center">No. of Units</th>
                                <th className="py-2.5 px-2 w-20 text-center">Unit</th>
                                <th className="py-2.5 px-2 w-28 text-right">{isClientMode ? 'Unit Price (₱)' : 'Unit Cost (₱)'}</th>
                                {!isClientMode && <th className="py-2.5 px-2 w-28 text-right">Direct Cost (₱)</th>}
                                {!isClientMode && <th className="py-2.5 px-2 w-20 text-center">Profit %</th>}
                                {!isClientMode && <th className="py-2.5 px-2 w-24 text-right">Profit (₱)</th>}
                                {!isClientMode && <th className="py-2.5 px-2 w-20 text-center">Overhead %</th>}
                                {!isClientMode && <th className="py-2.5 px-2 w-24 text-right">Total Markup</th>}
                                <th className="py-2.5 px-3 w-32 text-right">Total Cost (₱)</th>
                                <th className="py-2.5 px-2 w-10"></th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-800/60 font-sans">
                              {sp.items.map((item) => {
                                const c = calculateLineItemCosts(item);
                                const syncStatus = bomProfitSync.lineItemStatuses[item.id];

                                return (
                                  <tr key={item.id} className="hover:bg-slate-900/40 transition-colors">
                                    {/* Scope */}
                                    <td className="py-2 px-3">
                                      <input
                                        type="text"
                                        value={item.scopeOfWork}
                                        onChange={(e) => handleUpdateItem(phase.id, sp.id, item.id, 'scopeOfWork', e.target.value)}
                                        className="w-full bg-transparent border-0 text-white text-xs focus:ring-1 focus:ring-amber-500 rounded px-1 py-0.5"
                                      />
                                      {syncStatus && (syncStatus.isBudgetFulfilled || syncStatus.overrunAmount > 0 || syncStatus.actualMaterialSpend > 0) && (
                                        <div className="flex items-center gap-1.5 mt-1 px-1 flex-wrap">
                                          {syncStatus.overrunAmount > 0 ? (
                                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-rose-500/15 border border-rose-500/30 text-[10px] font-mono font-bold text-rose-300">
                                              <AlertCircle className="w-2.5 h-2.5" />
                                              Overrun: -₱{Math.round(syncStatus.overrunAmount).toLocaleString()} from Profit
                                            </span>
                                          ) : syncStatus.isBudgetFulfilled ? (
                                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-emerald-500/15 border border-emerald-500/30 text-[10px] font-mono font-bold text-emerald-300">
                                              <CheckCircle2 className="w-2.5 h-2.5" />
                                              Budget Fulfilled
                                            </span>
                                          ) : (
                                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-sky-500/10 border border-sky-500/20 text-[10px] font-mono text-sky-300">
                                              Mat. Spend: ₱{Math.round(syncStatus.actualMaterialSpend).toLocaleString()} / ₱{Math.round(syncStatus.allocatedCost).toLocaleString()}
                                            </span>
                                          )}
                                        </div>
                                      )}
                                    </td>

                                    {/* No of Units */}
                                    <td className="py-2 px-2 text-center">
                                      <input
                                        type="number"
                                        min={0}
                                        step="any"
                                        value={item.noOfUnits}
                                        onChange={(e) => handleUpdateItem(phase.id, sp.id, item.id, 'noOfUnits', Math.max(0, parseFloat(e.target.value) || 0))}
                                        className="w-16 bg-slate-900 border border-slate-700/80 rounded px-1.5 py-0.5 text-center text-xs font-mono text-white focus:border-amber-500 focus:outline-none"
                                      />
                                    </td>

                                    {/* Unit */}
                                    <td className="py-2 px-2 text-center">
                                      <select
                                        value={item.unit}
                                        onChange={(e) => handleUpdateItem(phase.id, sp.id, item.id, 'unit', e.target.value)}
                                        className="bg-slate-900 border border-slate-700/80 rounded px-1.5 py-0.5 text-[11px] font-mono text-slate-300 focus:border-amber-500 focus:outline-none cursor-pointer"
                                      >
                                        <option value="pcs">pcs</option>
                                        <option value="days">days</option>
                                        <option value="lot">lot</option>
                                        <option value="cu.m.">cu.m.</option>
                                        <option value="sq.m.">sq.m.</option>
                                        <option value="bags">bags</option>
                                        <option value="kg">kg</option>
                                        <option value="bd.ft.">bd.ft.</option>
                                        <option value="l.m.">l.m.</option>
                                        <option value="sets">sets</option>
                                        <option value="sheets">sheets</option>
                                        <option value="lengths">lengths</option>
                                        <option value="rolls">rolls</option>
                                      </select>
                                    </td>

                                    {/* Unit Cost */}
                                    <td className="py-2 px-2 text-right">
                                      {isClientMode ? (
                                        <span className="font-mono text-slate-300">
                                          ₱{c.markedUpUnitCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                        </span>
                                      ) : (
                                        <input
                                          type="number"
                                          min={0}
                                          step="any"
                                          value={item.unitCost}
                                          onChange={(e) => handleUpdateItem(phase.id, sp.id, item.id, 'unitCost', Math.max(0, parseFloat(e.target.value) || 0))}
                                          className="w-24 bg-slate-900 border border-slate-700/80 rounded px-1.5 py-0.5 text-right text-xs font-mono text-white focus:border-amber-500 focus:outline-none"
                                        />
                                      )}
                                    </td>

                                    {/* Direct Total Cost */}
                                    {!isClientMode && (
                                      <td className="py-2 px-2 text-right font-mono text-slate-300">
                                        ₱{c.directTotalCost.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                                      </td>
                                    )}

                                    {/* Profit % */}
                                    {!isClientMode && (
                                      <td className="py-2 px-2 text-center">
                                        <input
                                          type="number"
                                          min={0}
                                          max={100}
                                          value={item.profitPct}
                                          onChange={(e) => handleUpdateItem(phase.id, sp.id, item.id, 'profitPct', Math.max(0, Math.min(100, parseFloat(e.target.value) || 0)))}
                                          className="w-14 bg-slate-900 border border-slate-700/80 rounded px-1 py-0.5 text-center text-xs font-mono text-amber-400 focus:border-amber-500 focus:outline-none"
                                        />
                                      </td>
                                    )}

                                    {/* Profit Cost */}
                                    {!isClientMode && (
                                      <td className="py-2 px-2 text-right font-mono text-amber-300">
                                        ₱{c.profitCost.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                                      </td>
                                    )}

                                    {/* Overhead % */}
                                    {!isClientMode && (
                                      <td className="py-2 px-2 text-center">
                                        <input
                                          type="number"
                                          min={0}
                                          max={100}
                                          value={item.overheadPct}
                                          onChange={(e) => handleUpdateItem(phase.id, sp.id, item.id, 'overheadPct', Math.max(0, Math.min(100, parseFloat(e.target.value) || 0)))}
                                          className="w-14 bg-slate-900 border border-slate-700/80 rounded px-1 py-0.5 text-center text-xs font-mono text-blue-400 focus:border-amber-500 focus:outline-none"
                                        />
                                      </td>
                                    )}

                                    {/* Total Markup */}
                                    {!isClientMode && (
                                      <td className="py-2 px-2 text-right font-mono text-purple-300">
                                        ₱{c.totalMarkup.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                                      </td>
                                    )}

                                    {/* Final Total Cost */}
                                    <td className="py-2 px-3 text-right font-mono font-bold text-emerald-400">
                                      ₱{c.finalTotalCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                    </td>

                                    {/* Delete Item */}
                                    <td className="py-2 px-2 text-center">
                                      <button
                                        type="button"
                                        onClick={() => handleDeleteItem(phase.id, sp.id, item.id)}
                                        className="text-slate-600 hover:text-red-400 p-1 cursor-pointer transition-colors"
                                        title="Delete Item"
                                      >
                                        <Trash2 className="w-3 h-3" />
                                      </button>
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Styled In-App Template Preset Picker Modal */}
      {showTemplatePickerModal && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
          <div className="w-full max-w-lg bg-slate-900 border border-amber-500/40 rounded-2xl shadow-2xl p-6 space-y-4">
            <div className="flex items-start justify-between gap-3 border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-amber-500/15 border border-amber-500/30 text-amber-400">
                  <Layers className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">Choose a BOM Template Preset</h3>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    Pre-populate <strong className="text-slate-200">{projectTitle}</strong> with standard WBS construction phases.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowTemplatePickerModal(false)}
                className="text-slate-400 hover:text-white px-2 py-1 rounded-lg hover:bg-slate-800 text-xs font-bold cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="space-y-2.5 max-h-80 overflow-y-auto pr-1 custom-scrollbar">
              {(
                [
                  { type: '2-Storey Residential Unit' as ProjectTypology, phasesCount: STANDARD_BOM_PHASES_TEMPLATE.length, desc: 'Full ground-up residential build including structural, MEP, roofing & architectural finishes.' },
                  { type: '1-Storey / Bungalow' as ProjectTypology, phasesCount: STANDARD_BOM_PHASES_TEMPLATE.length, desc: 'Single-level residential build with scaled foundation, framing, and finishing scope.' },
                  { type: 'Renovation / Fit-Out' as ProjectTypology, phasesCount: STANDARD_BOM_PHASES_TEMPLATE.length, desc: 'Interior commercial or residential fit-out with partitions, ceilings, electrical & painting.' },
                  { type: 'Demolition / Excavation' as ProjectTypology, phasesCount: STANDARD_BOM_PHASES_TEMPLATE.length, desc: 'Site clearing, structural demolition, hauling, shoring, and earthwork preparation.' },
                  { type: 'Commercial Building' as ProjectTypology, phasesCount: STANDARD_BOM_PHASES_TEMPLATE.length, desc: 'Multi-trade commercial construction template with heavy structural and MEP allocations.' },
                ]
              ).map((tpl) => (
                <div
                  key={tpl.type}
                  className="bg-slate-950/80 border border-slate-800 hover:border-amber-500/50 rounded-xl p-3.5 flex items-center justify-between gap-3 transition-colors"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-white">{tpl.type}</span>
                      <span className="px-1.5 py-0.5 rounded bg-amber-500/15 border border-amber-500/30 text-amber-300 text-[9px] font-mono font-bold">
                        {tpl.phasesCount} PHASES
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-400 mt-1">{tpl.desc}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setProjectType(tpl.type);
                      setShowTemplatePickerModal(false);
                      if (phases.length > 0) {
                        setPendingTemplateApply(tpl.type);
                      } else {
                        executeApplyTemplate(tpl.type);
                      }
                    }}
                    className="px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 text-[11px] font-bold shrink-0 cursor-pointer transition-colors"
                  >
                    Apply Template
                  </button>
                </div>
              ))}
            </div>

            <div className="flex justify-end pt-1">
              <button
                type="button"
                onClick={() => setShowTemplatePickerModal(false)}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold cursor-pointer transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Styled In-App Confirmation Modal for Deleting a Phase or Sub-Phase */}
      {pendingDeleteTarget && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
          <div className="w-full max-w-md bg-slate-900 border border-rose-500/50 rounded-2xl shadow-2xl p-6 space-y-4">
            <div className="flex items-start gap-3">
              <div className="p-2.5 rounded-xl bg-rose-500/15 border border-rose-500/40 text-rose-400 shrink-0">
                <Trash2 className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-white">
                  {pendingDeleteTarget.type === 'phase' ? 'Delete BOM Phase?' : 'Delete Sub-Phase?'}
                </h3>
                <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                  Are you sure you want to delete <strong className="text-white">{pendingDeleteTarget.title}</strong> and all of its line items? This action cannot be undone.
                </p>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setPendingDeleteTarget(null)}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold cursor-pointer transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmDeleteTarget}
                className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold cursor-pointer transition-colors"
              >
                Delete {pendingDeleteTarget.type === 'phase' ? 'Phase' : 'Sub-Phase'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Styled In-App Confirmation Modal Before Overwriting Existing BOM With a Template Preset */}
      {pendingTemplateApply && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
          <div className="w-full max-w-md bg-slate-900 border border-amber-500/40 rounded-2xl shadow-2xl p-6 space-y-4">
            <div className="flex items-start gap-3">
              <div className="p-2.5 rounded-xl bg-amber-500/15 border border-amber-500/30 text-amber-400 shrink-0">
                <AlertCircle className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-white">Apply Template Preset?</h3>
                <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                  Replace the existing <strong className="text-white">{phases.length} BOM phase(s)</strong> for{' '}
                  <span className="text-amber-400 font-semibold">{projectTitle}</span> with the{' '}
                  <strong className="text-white">&ldquo;{pendingTemplateApply}&rdquo;</strong> template?
                </p>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setPendingTemplateApply(null)}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold cursor-pointer transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => executeApplyTemplate(pendingTemplateApply)}
                className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold cursor-pointer transition-colors"
              >
                Apply Template
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Styled In-App Confirmation Modal Before Syncing Into Project With Existing Gantt Tasks */}
      {syncConfirmModal && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
          <div className="w-full max-w-md bg-slate-900 border border-amber-500/40 rounded-2xl shadow-2xl p-6 space-y-4">
            <div className="flex items-start gap-3">
              <div className="p-2.5 rounded-xl bg-amber-500/15 border border-amber-500/30 text-amber-400 shrink-0">
                <AlertCircle className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-white">Confirm BOM → Master Gantt WBS Sync</h3>
                <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                  <strong className="text-white">{projectTitle}</strong> already has{' '}
                  <span className="text-amber-400 font-semibold">{syncConfirmModal.existingTasks.length} existing Gantt task(s)</span>
                  {syncConfirmModal.tasksWithProgressCount > 0 && (
                    <> ({syncConfirmModal.tasksWithProgressCount} with active progress &gt; 0%)</>
                  )}.
                </p>
              </div>
            </div>

            <div className="p-3 rounded-xl bg-slate-950/80 border border-slate-800 text-[11px] text-slate-300 space-y-1">
              <div className="font-semibold text-emerald-400">Safe Merge Guarantees:</div>
              <ul className="list-disc list-inside space-y-0.5 text-slate-400">
                <li>Scoped strictly to <span className="font-mono text-slate-200">{selectedProjectId}</span> (other projects are untouched).</li>
                <li>Existing <strong>progress %</strong>, <strong>status</strong>, <strong>assigned crew</strong>, and <strong>dates</strong> are preserved for matching phases/tasks.</li>
              </ul>
            </div>

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setSyncConfirmModal(null)}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold cursor-pointer transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => executeSyncToMasterGantt(syncConfirmModal.existingTasks)}
                className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold cursor-pointer transition-colors"
              >
                Confirm &amp; Sync WBS
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Styled Post-Sync Navigation Modal */}
      {syncCompletedModal && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
          <div className="w-full max-w-md bg-slate-900 border border-emerald-500/40 rounded-2xl shadow-2xl p-6 space-y-4">
            <div className="flex items-start gap-3">
              <div className="p-2.5 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 shrink-0">
                <CheckCircle2 className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-white">BOM WBS Synced to Master Gantt</h3>
                <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                  Synced <strong className="text-white">{syncCompletedModal.phasesCount} WBS phases</strong> ({syncCompletedModal.tasksCount} tasks) for{' '}
                  <span className="text-emerald-400 font-semibold">{projectTitle}</span>
                  {syncCompletedModal.preservedCount > 0 && (
                    <> while preserving <strong>{syncCompletedModal.preservedCount}</strong> existing progress record(s)</>
                  )}.
                </p>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setSyncCompletedModal(null)}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold cursor-pointer transition-colors"
              >
                Stay in BOM
              </button>
              {onNavigateToGantt && (
                <button
                  type="button"
                  onClick={() => {
                    setSyncCompletedModal(null);
                    onNavigateToGantt(selectedProjectId);
                  }}
                  className="px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-bold cursor-pointer transition-colors flex items-center gap-1.5"
                >
                  <span>Open Master Gantt</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
