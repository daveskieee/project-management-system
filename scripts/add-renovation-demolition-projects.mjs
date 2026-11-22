/**
 * LDM Construction PMS — Additive Idempotent Seeder (Direct PostgreSQL)
 * Adds 2 active projects (Biñan Full Interior & Exterior Home Renovation,
 * Sta. Rosa Structural Demolition & Site Clearing) with Progress Billing,
 * Master Gantt schedules, canonical BOM phases, assigned crews, and verified
 * Nov 16–21, 2026 DTR logs — WITHOUT deleting or modifying the 3 existing
 * defense projects (Nuvali, Calamba, Alabang).
 *
 * Usage:
 *   node scripts/add-renovation-demolition-projects.mjs
 */

import 'dotenv/config';
import pg from 'pg';

const { Pool } = pg;

const PROJ_A_ID = 'PRJ-BIN-01';
const PROJ_B_ID = 'PRJ-STR-02';

const TARGET_PROJECT_NAMES = [
  'Biñan Full Interior & Exterior Home Renovation',
  'Sta. Rosa Structural Demolition & Site Clearing',
];

const TARGET_INVOICE_IDS = [
  'INV-2026-009', 'INV-2026-010', 'INV-2026-011', 'INV-2026-012',
  'INV-2026-013', 'INV-2026-014', 'INV-2026-015',
];

const PROJECT_A_WORKERS = [
  { id: 'WRK-BIN-01', name: 'Ar. Lorenzo Bautista', first: 'Lorenzo', last: 'Bautista', position: 'Project Architect / Site Supervisor', rate: 1384.62 },
  { id: 'WRK-BIN-02', name: 'Fidel Mendoza', first: 'Fidel', last: 'Mendoza', position: 'Lead Foreman (Renovation Works)', rate: 1150 },
  { id: 'WRK-BIN-03', name: 'Roderick Salazar', first: 'Roderick', last: 'Salazar', position: 'Master Electrician', rate: 1000 },
  { id: 'WRK-BIN-04', name: 'Kevin Ramos', first: 'Kevin', last: 'Ramos', position: 'Assistant Electrician', rate: 680 },
  { id: 'WRK-BIN-05', name: 'Rolando Pineda', first: 'Rolando', last: 'Pineda', position: 'Skilled Plumber', rate: 900 },
  { id: 'WRK-BIN-06', name: 'Dante Navarro', first: 'Dante', last: 'Navarro', position: 'Ceiling / Drywall Carpenter', rate: 850 },
  { id: 'WRK-BIN-07', name: 'Gilbert Ocampo', first: 'Gilbert', last: 'Ocampo', position: 'Ceiling / Drywall Carpenter', rate: 850 },
  { id: 'WRK-BIN-08', name: 'Marlon Soriano', first: 'Marlon', last: 'Soriano', position: 'Ceiling / Drywall Carpenter', rate: 850 },
  { id: 'WRK-BIN-09', name: 'Jayson Villanueva', first: 'Jayson', last: 'Villanueva', position: 'Construction Helper / Laborer', rate: 580 },
  { id: 'WRK-BIN-10', name: 'Bryan Tolentino', first: 'Bryan', last: 'Tolentino', position: 'Construction Helper / Laborer', rate: 580 },
];

const PROJECT_B_WORKERS = [
  { id: 'WRK-STR-01', name: 'Engr. Noel Hernandez', first: 'Noel', last: 'Hernandez', position: 'Safety Officer (SO2) / Site Supervisor', rate: 1076.92 },
  { id: 'WRK-STR-02', name: 'Efren Dimaculangan', first: 'Efren', last: 'Dimaculangan', position: 'Demolition Foreman', rate: 1200 },
  { id: 'WRK-STR-03', name: 'Rommel De Guzman', first: 'Rommel', last: 'De Guzman', position: 'Jackhammer / Demolition Operator', rate: 800 },
  { id: 'WRK-STR-04', name: 'Crisanto Alvarez', first: 'Crisanto', last: 'Alvarez', position: 'Jackhammer / Demolition Operator', rate: 800 },
  { id: 'WRK-STR-05', name: 'Edgar Caballes', first: 'Edgar', last: 'Caballes', position: 'Jackhammer / Demolition Operator', rate: 800 },
  { id: 'WRK-STR-06', name: 'Arturo Evangelista', first: 'Arturo', last: 'Evangelista', position: 'Oxy-Acetylene Torch Cutter', rate: 950 },
  { id: 'WRK-STR-07', name: 'Rico Bautista', first: 'Rico', last: 'Bautista', position: 'Demolition Laborer / Debris Bagger', rate: 590 },
  { id: 'WRK-STR-08', name: 'Nilo Mercado', first: 'Nilo', last: 'Mercado', position: 'Demolition Laborer / Debris Bagger', rate: 590 },
  { id: 'WRK-STR-09', name: 'Manny Rosales', first: 'Manny', last: 'Rosales', position: 'Demolition Laborer / Debris Bagger', rate: 590 },
  { id: 'WRK-STR-10', name: 'Allan Dizon', first: 'Allan', last: 'Dizon', position: 'Demolition Laborer / Debris Bagger', rate: 590 },
  { id: 'WRK-STR-11', name: 'Jerico Flores', first: 'Jerico', last: 'Flores', position: 'Demolition Laborer / Debris Bagger', rate: 590 },
];

function mapGanttRows(pid, raw) {
  const ids = raw.map((_, idx) => `ldm-tsk-${pid}-${idx + 1}`);
  return raw.map((r, idx) => {
    const pctMatch = String(r.text || '').match(/\((\d+(?:\.\d+)?)%\)\s*$/);
    const parsedWeight = typeof r.weight === 'number' ? r.weight : (pctMatch ? Number(pctMatch[1]) : null);
    return {
      id: ids[idx],
      projectId: pid,
      wbsCode: r.wbs,
      title: r.text,
      text: r.text,
      startDate: r.s,
      endDate: r.e,
      dueDate: r.e,
      baselineStart: r.s,
      baselineEnd: r.e,
      duration: r.dur,
      progress: r.prog,
      weight: parsedWeight,
      type: r.type || (r.p === undefined ? 'project' : 'task'),
      parentTaskId: r.p !== undefined ? ids[r.p] : null,
      category: r.phase,
      milestonePhase: r.phase,
      status: r.prog >= 1 ? 'COMPLETED' : (r.prog > 0 ? 'IN_PROGRESS' : 'TODO'),
      sortOrder: idx + 1,
    };
  });
}

function buildProjectAGantt(pid) {
  // Weighted Progress: RN-01 (12% @ 100%) + RN-02 (16% @ 100%) + RN-03 (25% @ 80%) = 48.00%
  const raw = [
    { wbs: 'RN-01', text: 'Stripping & Selective Demolition (12%)', s: '2026-10-19', e: '2026-10-28', dur: 10, prog: 1.0, phase: 'Site Preparation & Mobilization' },
    { wbs: 'RN-01.1', text: 'Dust Barriers & Site Protection (15%)', s: '2026-10-19', e: '2026-10-20', dur: 18, prog: 1.0, phase: 'Site Preparation & Mobilization', p: 0 },
    { wbs: 'RN-01.2', text: 'Old Tile Chipping & Floor Stripping (40%)', s: '2026-10-20', e: '2026-10-24', dur: 48, prog: 1.0, phase: 'Site Preparation & Mobilization', p: 0 },
    { wbs: 'RN-01.3', text: 'Existing Ceiling Removal (25%)', s: '2026-10-24', e: '2026-10-26', dur: 30, prog: 1.0, phase: 'Site Preparation & Mobilization', p: 0 },
    { wbs: 'RN-01.4', text: 'Sanitary & Electrical Fixture Dismantling (20%)', s: '2026-10-26', e: '2026-10-28', dur: 24, prog: 1.0, phase: 'Site Preparation & Mobilization', p: 0 },

    { wbs: 'RN-02', text: 'Masonry & Waterproofing (16%)', s: '2026-10-29', e: '2026-11-11', dur: 14, prog: 1.0, phase: 'Masonry & CHB Works' },
    { wbs: 'RN-02.1', text: 'Drywall Partitions & Framing (30%)', s: '2026-10-29', e: '2026-11-02', dur: 48, prog: 1.0, phase: 'Masonry & CHB Works', p: 5 },
    { wbs: 'RN-02.2', text: 'Masonry Wall Patching & Re-Plastering (25%)', s: '2026-11-02', e: '2026-11-06', dur: 40, prog: 1.0, phase: 'Masonry & CHB Works', p: 5 },
    { wbs: 'RN-02.3', text: 'Bathroom Cementitious Waterproofing (30%)', s: '2026-11-06', e: '2026-11-09', dur: 48, prog: 1.0, phase: 'Roofing & Waterproofing', p: 5 },
    { wbs: 'RN-02.4', text: '48-Hour Wet Area Flood Test (15%)', s: '2026-11-09', e: '2026-11-11', dur: 24, prog: 1.0, phase: 'Roofing & Waterproofing', p: 5 },

    { wbs: 'RN-03', text: 'MEPF & Ceiling Framing (25%)', s: '2026-11-12', e: '2026-11-28', dur: 17, prog: 0.80, phase: 'MEPFS Rough-Ins' },
    { wbs: 'RN-03.1', text: 'Full Electrical Rewiring & Conduits (35%)', s: '2026-11-12', e: '2026-11-18', dur: 88, prog: 1.0, phase: 'MEPFS Rough-Ins', p: 10 },
    { wbs: 'RN-03.2', text: 'Main Breaker Panel Upgrade (10%)', s: '2026-11-18', e: '2026-11-20', dur: 25, prog: 1.0, phase: 'MEPFS Rough-Ins', p: 10 },
    { wbs: 'RN-03.3', text: 'PPR Waterline Rerouting & Pressure Test (25%)', s: '2026-11-19', e: '2026-11-24', dur: 62, prog: 1.0, phase: 'MEPFS Rough-Ins', p: 10 },
    { wbs: 'RN-03.4', text: 'Metal Furring Grid & Gypsum Board Ceiling (30%)', s: '2026-11-21', e: '2026-11-28', dur: 75, prog: 0.3333, phase: 'Architectural Finishes', p: 10 },

    { wbs: 'RN-04', text: 'Tiling Works (18%)', s: '2026-11-29', e: '2026-12-14', dur: 16, prog: 0.0, phase: 'Architectural Finishes' },
    { wbs: 'RN-04.1', text: 'Floor Screeding & Leveling (20%)', s: '2026-11-29', e: '2026-12-02', dur: 36, prog: 0.0, phase: 'Architectural Finishes', p: 15 },
    { wbs: 'RN-04.2', text: 'Porcelain Floor Tiling 60x60cm (45%)', s: '2026-12-02', e: '2026-12-09', dur: 81, prog: 0.0, phase: 'Architectural Finishes', p: 15 },
    { wbs: 'RN-04.3', text: 'Bathroom Ceramic Wall Tiling 30x60cm (25%)', s: '2026-12-09', e: '2026-12-12', dur: 45, prog: 0.0, phase: 'Architectural Finishes', p: 15 },
    { wbs: 'RN-04.4', text: 'Tile Grouting & Edge Sealing (10%)', s: '2026-12-12', e: '2026-12-14', dur: 18, prog: 0.0, phase: 'Architectural Finishes', p: 15 },

    { wbs: 'RN-05', text: 'Carpentry & Fenestration (17%)', s: '2026-12-15', e: '2026-12-29', dur: 15, prog: 0.0, phase: 'Doors, Windows & Glazing' },
    { wbs: 'RN-05.1', text: 'Modular Kitchen Cabinets Fabrication & Install (40%)', s: '2026-12-15', e: '2026-12-21', dur: 68, prog: 0.0, phase: 'Architectural Finishes', p: 20 },
    { wbs: 'RN-05.2', text: 'Bedroom Closets & Wardrobes (25%)', s: '2026-12-21', e: '2026-12-24', dur: 43, prog: 0.0, phase: 'Architectural Finishes', p: 20 },
    { wbs: 'RN-05.3', text: 'Flush Doors & Hardware Installation (15%)', s: '2026-12-24', e: '2026-12-26', dur: 25, prog: 0.0, phase: 'Doors, Windows & Glazing', p: 20 },
    { wbs: 'RN-05.4', text: 'Aluminum Windows & Sliding Doors (20%)', s: '2026-12-26', e: '2026-12-29', dur: 34, prog: 0.0, phase: 'Doors, Windows & Glazing', p: 20 },

    { wbs: 'RN-06', text: 'Painting & Final Fit-Out (12%)', s: '2026-12-30', e: '2027-01-12', dur: 14, prog: 0.0, phase: 'Painting & Coatings' },
    { wbs: 'RN-06.1', text: 'Wall & Ceiling Skim Coating (25%)', s: '2026-12-30', e: '2027-01-02', dur: 30, prog: 0.0, phase: 'Painting & Coatings', p: 25 },
    { wbs: 'RN-06.2', text: 'Interior Latex & Exterior Elastomeric Painting (45%)', s: '2027-01-02', e: '2027-01-08', dur: 54, prog: 0.0, phase: 'Painting & Coatings', p: 25 },
    { wbs: 'RN-06.3', text: 'Lighting & Plumbing Fixtures Installation (20%)', s: '2027-01-08', e: '2027-01-10', dur: 24, prog: 0.0, phase: 'MEPFS Rough-Ins', p: 25 },
    { wbs: 'RN-06.4', text: 'Deep Cleaning & Homeowner Turn-Over (10%)', s: '2027-01-11', e: '2027-01-12', dur: 12, prog: 0.0, phase: 'Testing, Commissioning & Handover', p: 25 },
  ];
  return mapGanttRows(pid, raw);
}

function buildProjectBGantt(pid) {
  // Weighted Progress: DM-01 (12% @ 100%) + DM-02 (15% @ 100%) + DM-03 (25% @ 100%) + DM-04 (20% @ 15%) = 55.00%
  const raw = [
    { wbs: 'DM-01', text: 'Pre-Demolition & Containment (12%)', s: '2026-11-02', e: '2026-11-07', dur: 6, prog: 1.0, phase: 'Site Preparation & Mobilization' },
    { wbs: 'DM-01.1', text: 'LGU Demolition Permit & Clearance (30%)', s: '2026-11-02', e: '2026-11-03', dur: 36, prog: 1.0, phase: 'Site Preparation & Mobilization', p: 0 },
    { wbs: 'DM-01.2', text: 'Power & Water Utility Disconnection (25%)', s: '2026-11-03', e: '2026-11-04', dur: 30, prog: 1.0, phase: 'Site Preparation & Mobilization', p: 0 },
    { wbs: 'DM-01.3', text: 'G.I. Perimeter Boarding & Shoring (30%)', s: '2026-11-04', e: '2026-11-06', dur: 36, prog: 1.0, phase: 'Site Preparation & Mobilization', p: 0 },
    { wbs: 'DM-01.4', text: 'Safety Dust Netting & Signage Setup (15%)', s: '2026-11-06', e: '2026-11-07', dur: 18, prog: 1.0, phase: 'Site Preparation & Mobilization', p: 0 },

    { wbs: 'DM-02', text: 'Soft Strip & Salvage (15%)', s: '2026-11-08', e: '2026-11-13', dur: 6, prog: 1.0, phase: 'Site Preparation & Mobilization' },
    { wbs: 'DM-02.1', text: 'Doors & Windows Removal (25%)', s: '2026-11-08', e: '2026-11-09', dur: 38, prog: 1.0, phase: 'Site Preparation & Mobilization', p: 5 },
    { wbs: 'DM-02.2', text: 'Roofing Sheets & Truss Dismantling (30%)', s: '2026-11-09', e: '2026-11-11', dur: 45, prog: 1.0, phase: 'Roofing & Waterproofing', p: 5 },
    { wbs: 'DM-02.3', text: 'Old Wiring & Plumbing Fixtures Strip-Out (20%)', s: '2026-11-11', e: '2026-11-12', dur: 30, prog: 1.0, phase: 'MEPFS Rough-Ins', p: 5 },
    { wbs: 'DM-02.4', text: 'Ceilings & Structural Timber Salvaging (25%)', s: '2026-11-12', e: '2026-11-13', dur: 37, prog: 1.0, phase: 'Site Preparation & Mobilization', p: 5 },

    { wbs: 'DM-03', text: 'Upper Superstructure Teardown (25%)', s: '2026-11-14', e: '2026-11-21', dur: 8, prog: 1.0, phase: 'Structural & Concrete Works' },
    { wbs: 'DM-03.1', text: '2nd Floor CHB Walls Demolition (30%)', s: '2026-11-14', e: '2026-11-16', dur: 75, prog: 1.0, phase: 'Masonry & CHB Works', p: 10 },
    { wbs: 'DM-03.2', text: 'Upper Structural Beams Breaking (25%)', s: '2026-11-16', e: '2026-11-18', dur: 63, prog: 1.0, phase: 'Structural & Concrete Works', p: 10 },
    { wbs: 'DM-03.3', text: 'Suspended Slab Concrete Breaking (30%)', s: '2026-11-18', e: '2026-11-20', dur: 75, prog: 1.0, phase: 'Structural & Concrete Works', p: 10 },
    { wbs: 'DM-03.4', text: 'Oxy-Acetylene Rebar Cutting & Clearing (15%)', s: '2026-11-20', e: '2026-11-21', dur: 37, prog: 1.0, phase: 'Structural & Concrete Works', p: 10 },

    { wbs: 'DM-04', text: 'Ground Floor Demolition (20%)', s: '2026-11-22', e: '2026-11-29', dur: 8, prog: 0.15, phase: 'Structural & Concrete Works' },
    { wbs: 'DM-04.1', text: '1st Floor Masonry Walls Demolition (30%)', s: '2026-11-22', e: '2026-11-24', dur: 60, prog: 0.50, phase: 'Masonry & CHB Works', p: 15 },
    { wbs: 'DM-04.2', text: 'Main Structural Columns Teardown (30%)', s: '2026-11-24', e: '2026-11-26', dur: 60, prog: 0.0, phase: 'Structural & Concrete Works', p: 15 },
    { wbs: 'DM-04.3', text: 'Ground Slab Pneumatic Jackhammering (40%)', s: '2026-11-26', e: '2026-11-29', dur: 80, prog: 0.0, phase: 'Structural & Concrete Works', p: 15 },

    { wbs: 'DM-05', text: 'Substructure & Hauling (18%)', s: '2026-11-30', e: '2026-12-06', dur: 7, prog: 0.0, phase: 'Earthworks & Excavation' },
    { wbs: 'DM-05.1', text: 'Footing & Tie Beam Extraction (40%)', s: '2026-11-30', e: '2026-12-02', dur: 72, prog: 0.0, phase: 'Foundation & Footings', p: 19 },
    { wbs: 'DM-05.2', text: 'Debris Segregation & Bagging (20%)', s: '2026-12-02', e: '2026-12-03', dur: 36, prog: 0.0, phase: 'Earthworks & Excavation', p: 19 },
    { wbs: 'DM-05.3', text: 'Dump Truck Hauling to Approved Disposal Site (40%)', s: '2026-12-03', e: '2026-12-06', dur: 72, prog: 0.0, phase: 'Earthworks & Excavation', p: 19 },

    { wbs: 'DM-06', text: 'Site Grading & Turn-over (10%)', s: '2026-12-07', e: '2026-12-11', dur: 5, prog: 0.0, phase: 'Testing, Commissioning & Handover' },
    { wbs: 'DM-06.1', text: 'Escombro Backfilling & Void Filling (35%)', s: '2026-12-07', e: '2026-12-08', dur: 35, prog: 0.0, phase: 'Earthworks & Excavation', p: 23 },
    { wbs: 'DM-06.2', text: 'Compaction & Lot Leveling (35%)', s: '2026-12-08', e: '2026-12-10', dur: 35, prog: 0.0, phase: 'Earthworks & Excavation', p: 23 },
    { wbs: 'DM-06.3', text: 'Perimeter Fence Removal & Final Lot Clearance (30%)', s: '2026-12-10', e: '2026-12-11', dur: 30, prog: 0.0, phase: 'Testing, Commissioning & Handover', p: 23 },
  ];
  return mapGanttRows(pid, raw);
}

function makeBomPhase(id, code, title, subTitle, items) {
  return {
    id,
    code,
    title,
    defaultProfitPct: 20,
    defaultOverheadPct: 5,
    subPhases: [
      {
        id: `${id}-sub-1`,
        title: subTitle,
        items: items.map((it) => ({
          id: it.id,
          scopeOfWork: it.scopeOfWork,
          noOfUnits: it.noOfUnits,
          unit: it.unit,
          unitCost: it.unitCost,
          profitPct: 20,
          overheadPct: 5,
          designCost: 0,
        })),
      },
    ],
  };
}

function buildProjectABom() {
  // Exact sum of 15 items = ₱323,970.00
  return [
    makeBomPhase('bom-bin-1', 'RN-01', 'STRIPPING & SELECTIVE DEMOLITION', 'Debris Containment & Disposal', [
      { id: 'MAT-315', scopeOfWork: 'MAT-315 Heavy-Duty Garbage Sacks (Debris Disposal)', noOfUnits: 250, unit: 'pcs', unitCost: 18 },
    ]),
    makeBomPhase('bom-bin-2', 'RN-02', 'MASONRY & WATERPROOFING', 'Wet-Area Waterproofing System', [
      { id: 'MAT-305', scopeOfWork: 'MAT-305 Cementitious Waterproofing Compound', noOfUnits: 12, unit: 'gal', unitCost: 780 },
    ]),
    makeBomPhase('bom-bin-3', 'RN-03', 'MEPF & CEILING FRAMING', 'Electrical, Plumbing & Gypsum Ceiling System', [
      { id: 'MAT-306', scopeOfWork: 'MAT-306 Gypsum Board (1/2" x 4\' x 8\')', noOfUnits: 45, unit: 'sheets', unitCost: 510 },
      { id: 'MAT-307', scopeOfWork: 'MAT-307 Metal Furring & Carrying Channels (5m)', noOfUnits: 140, unit: 'pcs', unitCost: 145 },
      { id: 'MAT-308', scopeOfWork: 'MAT-308 Blind Rivets (1/8" x 1/2")', noOfUnits: 6, unit: 'boxes', unitCost: 320 },
      { id: 'MAT-309', scopeOfWork: 'MAT-309 Gypsum Screws (1" Black)', noOfUnits: 5, unit: 'boxes', unitCost: 280 },
      { id: 'MAT-311', scopeOfWork: 'MAT-311 PPR Waterline Pipes & Fittings (1/2" & 3/4")', noOfUnits: 65, unit: 'pcs', unitCost: 290 },
      { id: 'MAT-312', scopeOfWork: 'MAT-312 THHN Stranded Wire (#12 & #14) + PVC Conduits', noOfUnits: 8, unit: 'sets', unitCost: 4100 },
    ]),
    makeBomPhase('bom-bin-4', 'RN-04', 'TILING WORKS', 'Porcelain Floor & Bathroom Wall Tiling', [
      { id: 'MAT-301', scopeOfWork: 'MAT-301 Tile Adhesive (25kg Heavy Duty)', noOfUnits: 65, unit: 'bags', unitCost: 340 },
      { id: 'MAT-302', scopeOfWork: 'MAT-302 Tile Grout (2kg Pack)', noOfUnits: 28, unit: 'packs', unitCost: 115 },
      { id: 'MAT-303', scopeOfWork: 'MAT-303 Porcelain Floor Tiles (60cm x 60cm)', noOfUnits: 260, unit: 'pcs', unitCost: 240 },
      { id: 'MAT-304', scopeOfWork: 'MAT-304 Ceramic Bathroom Wall Tiles (30cm x 60cm)', noOfUnits: 180, unit: 'pcs', unitCost: 135 },
    ]),
    makeBomPhase('bom-bin-5', 'RN-05', 'CARPENTRY & FENESTRATION', 'Modular Cabinetry & Woodworks', [
      { id: 'MAT-310', scopeOfWork: 'MAT-310 Marine Plywood (3/4" x 4\' x 8\') for Cabinets', noOfUnits: 24, unit: 'sheets', unitCost: 1480 },
    ]),
    makeBomPhase('bom-bin-6', 'RN-06', 'PAINTING & FINAL FIT-OUT', 'Skim Coat & Architectural Coatings', [
      { id: 'MAT-313', scopeOfWork: 'MAT-313 Skim Coat (20kg)', noOfUnits: 35, unit: 'bags', unitCost: 490 },
      { id: 'MAT-314', scopeOfWork: 'MAT-314 Acrylic Latex & Elastomeric Exterior Paint (16L)', noOfUnits: 16, unit: 'pails', unitCost: 2950 },
    ]),
  ];
}

function buildProjectBBom() {
  // Exact sum of 11 items = ₱191,200.00
  return [
    makeBomPhase('bom-dem-1', 'DM-01', 'PRE-DEMOLITION & CONTAINMENT', 'Perimeter Boarding, Shoring & Dust Screen', [
      { id: 'MAT-401', scopeOfWork: 'MAT-401 Corrugated G.I. Sheets (Gauge 26 x 8\') for Temp Fence', noOfUnits: 45, unit: 'sheets', unitCost: 420 },
      { id: 'MAT-402', scopeOfWork: 'MAT-402 Coco Lumber (2" x 3" x 10\') for Fence Framing & Shoring', noOfUnits: 650, unit: 'bd.ft.', unitCost: 42 },
      { id: 'MAT-403', scopeOfWork: 'MAT-403 Common Wire Nails (3" & 4")', noOfUnits: 25, unit: 'kg', unitCost: 78 },
      { id: 'MAT-404', scopeOfWork: 'MAT-404 Safety Netting / Blue Trapal Dust Screen (2m x 50m)', noOfUnits: 4, unit: 'rolls', unitCost: 2400 },
      { id: 'MAT-410', scopeOfWork: 'MAT-410 Warning Caution Tape & Safety Signage Set', noOfUnits: 10, unit: 'rolls', unitCost: 250 },
    ]),
    makeBomPhase('bom-dem-2', 'DM-02', 'SOFT STRIP & SALVAGE', 'Debris Bagging & Salvage Consumables', [
      { id: 'MAT-405', scopeOfWork: 'MAT-405 Heavy-Duty Polypropylene Debris Sacks', noOfUnits: 600, unit: 'pcs', unitCost: 16 },
    ]),
    makeBomPhase('bom-dem-3', 'DM-03', 'UPPER SUPERSTRUCTURE TEARDOWN', 'Rebar Torch Cutting & Abrasive Discs', [
      { id: 'MAT-406', scopeOfWork: 'MAT-406 Oxygen & Acetylene Gas Refills (Rebar Cutting)', noOfUnits: 6, unit: 'tank pairs', unitCost: 3200 },
      { id: 'MAT-408', scopeOfWork: 'MAT-408 Metal Cut-Off Wheels (14")', noOfUnits: 15, unit: 'pcs', unitCost: 260 },
    ]),
    makeBomPhase('bom-dem-4', 'DM-04', 'GROUND FLOOR DEMOLITION', 'Concrete Sawing & Jackhammer Fuel', [
      { id: 'MAT-407', scopeOfWork: 'MAT-407 Diamond Concrete Cutting Discs (14")', noOfUnits: 8, unit: 'pcs', unitCost: 2850 },
      { id: 'MAT-409', scopeOfWork: 'MAT-409 Diesel Fuel (Jackhammer GenSet & Backhoe/Dump Trucks)', noOfUnits: 850, unit: 'liters', unitCost: 62 },
    ]),
    makeBomPhase('bom-dem-5', 'DM-05', 'SUBSTRUCTURE & HAULING', 'Footing Extraction & Disposal Logistics', [
      { id: 'MAT-411-PREP', scopeOfWork: 'Footing Extraction & Disposal (Fuel & Sacks Covered Above)', noOfUnits: 0, unit: 'lot', unitCost: 0 },
    ]),
    makeBomPhase('bom-dem-6', 'DM-06', 'SITE GRADING & TURN-OVER', 'Escombro Backfill & Lot Leveling', [
      { id: 'MAT-411', scopeOfWork: 'MAT-411 Selected Filling Material / Escombro (Leveling/Grading)', noOfUnits: 35, unit: 'cu.m.', unitCost: 650 },
    ]),
  ];
}

function sumBomMaterials(phases) {
  return phases.reduce((sum, ph) =>
    sum + ph.subPhases.reduce((s2, sp) =>
      s2 + sp.items.reduce((s3, it) => s3 + Number(it.noOfUnits) * Number(it.unitCost), 0), 0), 0);
}

async function run() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL?.includes('localhost') ? false : { rejectUnauthorized: false },
  });

  try {
    console.log('\n====================================================================');
    console.log(' LDM Construction PMS — Additive Renovation & Demolition Seeder');
    console.log('====================================================================\n');

    // 1. Idempotent cleanup of ONLY these 2 additive projects & their 21 workers (never touch Nuvali, Calamba, Alabang)
    console.log('1. Checking for prior runs of these 2 additive projects (Nuvali, Calamba, Alabang untouched)...');
    const oldProjsRes = await pool.query(
      `SELECT id FROM commercial_projects WHERE name = ANY($1::text[]) OR id = ANY($2::text[])`,
      [TARGET_PROJECT_NAMES, [PROJ_A_ID, PROJ_B_ID]]
    );
    const oldProjIds = oldProjsRes.rows.map(r => r.id);
    if (oldProjIds.length > 0) {
      await pool.query(`DELETE FROM payroll_items WHERE payroll_run_id IN (SELECT id FROM payroll_runs WHERE project_id = ANY($1::text[]))`, [oldProjIds]).catch(() => {});
      await pool.query(`DELETE FROM payroll_runs WHERE project_id = ANY($1::text[])`, [oldProjIds]).catch(() => {});
      await pool.query(`DELETE FROM attendance_logs WHERE project_id = ANY($1::text[])`, [oldProjIds]).catch(() => {});
      await pool.query(`DELETE FROM cash_advances WHERE project_id = ANY($1::text[])`, [oldProjIds]).catch(() => {});
      await pool.query(`DELETE FROM project_worker_assignments WHERE project_id = ANY($1::text[])`, [oldProjIds]).catch(() => {});
      await pool.query(`DELETE FROM task_links WHERE "projectId" = ANY($1::text[])`, [oldProjIds]).catch(() => {});
      await pool.query(`DELETE FROM project_tasks WHERE "projectId" = ANY($1::text[])`, [oldProjIds]).catch(() => {});
      await pool.query(`DELETE FROM project_bom_phases WHERE project_id = ANY($1::text[])`, [oldProjIds]).catch(() => {});
      await pool.query(`DELETE FROM commercial_projects WHERE id = ANY($1::text[])`, [oldProjIds]);
      console.log(`   Removed ${oldProjIds.length} prior copy/copies of these 2 projects.`);
    }

    await pool.query(`DELETE FROM installment_ledgers WHERE id = ANY($1::text[])`, [TARGET_INVOICE_IDS]).catch(() => {});
    await pool.query(`DELETE FROM client_packages WHERE "packageType" = ANY($1::text[])`, [TARGET_PROJECT_NAMES]).catch(() => {});
    await pool.query(
      `DELETE FROM users WHERE role = 'CLIENT' AND email IN ('castillo.binan@client.ldmconstruction.ph', 'southville.starosa@client.ldmconstruction.ph')`
    ).catch(() => {});

    const allWorkers = [...PROJECT_A_WORKERS, ...PROJECT_B_WORKERS];
    const allWorkerIds = allWorkers.map(w => w.id);
    const allWorkerNames = allWorkers.map(w => w.name);
    await pool.query(`DELETE FROM attendance_logs WHERE worker_id = ANY($1::text[])`, [allWorkerIds]).catch(() => {});
    await pool.query(`DELETE FROM project_worker_assignments WHERE worker_id = ANY($1::text[])`, [allWorkerIds]).catch(() => {});
    await pool.query(`DELETE FROM workers WHERE id = ANY($1::text[]) OR name = ANY($2::text[])`, [allWorkerIds, allWorkerNames]).catch(() => {});
    await pool.query(`DELETE FROM contractors WHERE id = ANY($1::text[]) OR name = ANY($2::text[])`, [allWorkerIds, allWorkerNames]).catch(() => {});

    // 2. Insert the 2 new active projects
    console.log('\n2. Inserting 2 new active construction projects...');
    const projectsToInsert = [
      {
        id: PROJ_A_ID,
        name: 'Biñan Full Interior & Exterior Home Renovation',
        clientName: 'Engr. & Mrs. Castillo',
        description: 'Complete interior gut-out, kitchen/bathroom remodel, floor retiling, ceiling replacement, electrical rewiring, and exterior repainting of an existing 90 sq.m. house.',
        location: 'Biñan, Laguna',
        budget: 980000,
        fundsCollected: 637000,
        progress: 48,
        startDate: '2026-10-19',
        endDate: '2027-01-12',
        lat: 14.3389,
        lon: 121.0803,
        workers: PROJECT_A_WORKERS,
        gantt: buildProjectAGantt(PROJ_A_ID),
        bom: buildProjectABom(),
        email: 'castillo.binan@client.ldmconstruction.ph',
        installments: [
          { id: 'INV-2026-009', dueDate: '2026-10-17', paymentDate: '2026-10-17', amount: 392000, status: 'PAID' },
          { id: 'INV-2026-010', dueDate: '2026-11-17', paymentDate: '2026-11-17', amount: 245000, status: 'PAID' },
          { id: 'INV-2026-011', dueDate: '2026-12-17', paymentDate: null, amount: 245000, status: 'PENDING' },
          { id: 'INV-2026-012', dueDate: '2027-01-12', paymentDate: null, amount: 98000, status: 'PENDING' },
        ],
      },
      {
        id: PROJ_B_ID,
        name: 'Sta. Rosa Structural Demolition & Site Clearing',
        clientName: 'Southville Commercial Properties Inc.',
        description: 'Complete teardown of an existing 2-storey old concrete/timber structure (110 sq.m. footprint), utility disconnection, slab breaking, debris hauling, and lot grading.',
        location: 'Sta. Rosa, Laguna',
        budget: 465000,
        fundsCollected: 372000,
        progress: 55,
        startDate: '2026-11-02',
        endDate: '2026-12-11',
        lat: 14.3122,
        lon: 121.1114,
        workers: PROJECT_B_WORKERS,
        gantt: buildProjectBGantt(PROJ_B_ID),
        bom: buildProjectBBom(),
        email: 'southville.starosa@client.ldmconstruction.ph',
        installments: [
          { id: 'INV-2026-013', dueDate: '2026-11-01', paymentDate: '2026-11-01', amount: 232500, status: 'PAID' },
          { id: 'INV-2026-014', dueDate: '2026-11-20', paymentDate: '2026-11-20', amount: 139500, status: 'PAID' },
          { id: 'INV-2026-015', dueDate: '2026-12-11', paymentDate: null, amount: 93000, status: 'PENDING' },
        ],
      },
    ];

    const tkUserRes = await pool.query(`SELECT id FROM users WHERE role = 'TIMEKEEPER' LIMIT 1`);
    const tkUserId = tkUserRes.rows[0]?.id || 'usr-timekeeper';

    for (const p of projectsToInsert) {
      await pool.query(
        `INSERT INTO commercial_projects
         (id, name, client_name, description, location, budget, funds_collected, progress_percentage,
          status, target_handover_date, start_date, assigned_workers_count, tasks_count, milestones_count,
          latitude, longitude, assigned_contractor_ids, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'IN_PROGRESS', $9::date, $10::date, $11, $12, 6, $13, $14, $15::text[], NOW())`,
        [
          p.id, p.name, p.clientName, p.description, p.location, p.budget, p.fundsCollected, p.progress,
          p.endDate, p.startDate, p.workers.length, p.gantt.length, p.lat, p.lon, p.workers.map(w => w.id),
        ]
      );
      console.log(`   + ${p.name} (${p.id}) — Budget ₱${p.budget.toLocaleString()} | Collected ₱${p.fundsCollected.toLocaleString()}`);

      // 3. Insert Gantt Tasks (ensuring weight column exists)
      await pool.query(`ALTER TABLE project_tasks ADD COLUMN IF NOT EXISTS weight DOUBLE PRECISION`).catch(() => {});
      for (const t of p.gantt) {
        await pool.query(
          `INSERT INTO project_tasks
           (id, "projectId", "wbsCode", title, text, description, "startDate", "endDate", "dueDate",
            "baselineStart", "baselineEnd", duration, progress, weight, type, "parentTaskId", category,
            "milestonePhase", status, priority, "sortOrder", "createdAt", "updatedAt")
           VALUES ($1, $2, $3, $4, $5, '', $6::timestamptz, $7::timestamptz, $8::timestamptz,
                   $9::timestamptz, $10::timestamptz, $11, $12, $13, $14, $15, $16, $17, $18::"TaskStatus", 'MEDIUM', $19, NOW(), NOW())`,
          [
            t.id, t.projectId, t.wbsCode, t.title, t.text, t.startDate, t.endDate, t.dueDate,
            t.baselineStart, t.baselineEnd, t.duration, t.progress, t.weight, t.type, t.parentTaskId,
            t.category, t.milestonePhase, t.status, t.sortOrder,
          ]
        );
      }

      // 4. Insert Canonical BOM Phases
      await pool.query(
        `INSERT INTO project_bom_phases (project_id, phases, updated_at)
         VALUES ($1, $2::jsonb, NOW())
         ON CONFLICT (project_id) DO UPDATE SET phases = EXCLUDED.phases, updated_at = NOW()`,
        [p.id, JSON.stringify(p.bom)]
      );

      // 5. Insert Progress Billing & Receipts (Client AR)
      const clientUid = `cli-${p.id.toLowerCase()}`;
      const pkgId = `pkg-${p.id.toLowerCase()}`;
      await pool.query(
        `INSERT INTO users (id, email, name, role, "passwordHash", project_ids, "createdAt", "updatedAt")
         VALUES ($1, $2, $3, 'CLIENT', 'CLIENT_NOPASS', $4::text[], NOW(), NOW())
         ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, project_ids = EXCLUDED.project_ids`,
        [clientUid, p.email, p.clientName, [p.id]]
      );
      await pool.query(
        `INSERT INTO client_packages (id, "userId", price, "packageType", "paymentMethod", "createdAt", "updatedAt")
         VALUES ($1, $2, $3, $4, 'INSTALLMENT', NOW(), NOW())
         ON CONFLICT (id) DO UPDATE SET price = EXCLUDED.price, "packageType" = EXCLUDED."packageType"`,
        [pkgId, clientUid, p.budget, p.name]
      );
      for (const inst of p.installments) {
        const amtPaid = inst.status === 'PAID' ? inst.amount : 0;
        await pool.query(
          `INSERT INTO installment_ledgers (id, "clientPackageId", "dueDate", "amountDue", "amountPaid", status, "paymentDate", "createdAt", "updatedAt")
           VALUES ($1, $2, $3::timestamptz, $4, $5, $6::"PaymentStatus", $7::timestamptz, NOW(), NOW())
           ON CONFLICT (id) DO UPDATE SET "amountDue" = EXCLUDED."amountDue", "amountPaid" = EXCLUDED."amountPaid", status = EXCLUDED.status`,
          [inst.id, pkgId, inst.dueDate, inst.amount, amtPaid, inst.status, inst.paymentDate]
        );
      }

      // 6. Insert Assigned Crew (workers + contractors + project_worker_assignments)
      for (const w of p.workers) {
        const otRate = Math.round(((w.rate / 8) * 1.25) * 100) / 100;
        await pool.query(
          `INSERT INTO workers
           (id, first_name, last_name, name, position, trade, daily_rate, hourly_ot_rate, status, assigned_project_id, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $5, $6, $7, 'Active', $8, NOW(), NOW())`,
          [w.id, w.first, w.last, w.name, w.position, w.rate, otRate, p.id]
        );
        await pool.query(
          `INSERT INTO contractors
           (id, name, company, specialty, "roleTitle", "dailyRate", "activeManpower", "employmentType",
            status, "allocationStatus", active_project_site, "activeProjectSite", rating, "createdAt", "updatedAt")
           VALUES ($1, $2, 'LDM Construction', $3, $3, $4, 1, 'INTERNAL', 'ACTIVE', 'ASSIGNED', $5, $5, 4.8, NOW(), NOW())`,
          [w.id, w.name, w.position, w.rate, p.name]
        );
        await pool.query(
          `INSERT INTO project_worker_assignments (id, project_id, worker_id, assigned_at, status)
           VALUES ($1, $2, $3, NOW(), 'Active')`,
          [`pwa-${p.id}-${w.id}`, p.id, w.id]
        );
      }

      // 7. Insert Verified DTR Logs (Nov 16–21, 2026)
      const dates = ['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20', '2026-11-21'];
      for (let dIdx = 0; dIdx < dates.length; dIdx++) {
        for (let wIdx = 0; wIdx < p.workers.length; wIdx++) {
          const w = p.workers[wIdx];
          const st = (dIdx === 3 && wIdx === p.workers.length - 1) ? 'Late' : 'Present';
          const ot = (dIdx === 4 && wIdx % 3 === 0) ? 2 : 0;
          await pool.query(
            `INSERT INTO attendance_logs
             (id, project_id, worker_id, logged_by_user_id, date, status, overtime_hours, is_locked, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5::date, $6, $7, false, NOW(), NOW())`,
            [`dtr-${p.id}-${w.id}-${dates[dIdx]}`, p.id, w.id, tkUserId, dates[dIdx], st, ot]
          );
        }
      }
    }

    // 8. Append new project IDs to PM & Timekeeper users.project_ids so all 5 projects are visible
    const allProjsRes = await pool.query(`
      SELECT p.id, p.name, p.budget, p.funds_collected, p.assigned_workers_count,
        COALESCE((SELECT jsonb_array_length(b.phases) FROM project_bom_phases b WHERE b.project_id = p.id), 0) AS bom_phases,
        COALESCE(
          (SELECT ROUND(
            SUM((CASE WHEN t.status = 'COMPLETED' THEN 100.0 WHEN t.progress > 1.0 THEN LEAST(100.0, t.progress) ELSE t.progress * 100.0 END) * GREATEST(COALESCE(t.duration, 1), 1))
            / NULLIF(SUM(GREATEST(COALESCE(t.duration, 1), 1)), 0)
          ) FROM project_tasks t WHERE t."projectId" = p.id AND NOT EXISTS (SELECT 1 FROM project_tasks c WHERE c."parentTaskId" = t.id)),
          p.progress_percentage
        ) AS live_progress
      FROM commercial_projects p
      ORDER BY p.created_at ASC
    `);
    const allIds = allProjsRes.rows.map(r => r.id);
    await pool.query(
      `UPDATE users SET project_ids = $1::text[] WHERE role IN ('ENGINEER', 'PROJECT_MANAGER', 'TIMEKEEPER')`,
      [allIds]
    );

    const totalContract = allProjsRes.rows.reduce((s, r) => s + Number(r.budget || 0), 0);
    const totalCollected = allProjsRes.rows.reduce((s, r) => s + Number(r.funds_collected || 0), 0);

    console.log('\n====================================================================');
    console.log(' ADDITIVE SEED COMPLETE — LIVE POSTGRESQL PORTFOLIO VERIFICATION');
    console.log('====================================================================');
    console.log(`  Total Active Projects  : ${allProjsRes.rows.length} (Expected: 5)`);
    console.log(`  Total Contract Value   : ₱${totalContract.toLocaleString()} (Expected: ₱14,895,000)`);
    console.log(`  Total Client Collected : ₱${totalCollected.toLocaleString()}`);
    console.log(`  Biñan BOM Materials    : ₱${sumBomMaterials(buildProjectABom()).toLocaleString()} (15 items across 6 phases)`);
    console.log(`  Sta. Rosa BOM Materials: ₱${sumBomMaterials(buildProjectBBom()).toLocaleString()} (11 items across 6 phases)`);
    console.log(`  Nov 16–21 DTR Seeded   : ${(PROJECT_A_WORKERS.length + PROJECT_B_WORKERS.length) * 6} verified logs (60 Biñan + 66 Sta. Rosa)`);
    for (const r of allProjsRes.rows) {
      console.log(`    - [${r.id}] ${r.name} | Budget: ₱${Number(r.budget).toLocaleString()} | Collected: ₱${Number(r.funds_collected).toLocaleString()} | Progress: ${r.live_progress}% | BOM Phases: ${r.bom_phases} | Crew: ${r.assigned_workers_count}`);
    }
    console.log('====================================================================\n');
  } finally {
    await pool.end();
  }
}

run().catch((err) => {
  console.error('ADDITIVE SEED FAILED:', err);
  process.exit(1);
});
