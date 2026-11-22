/**
 * LDM Construction PMS — Reusable Panel Defense Seeding Script
 * Populates realistic, interconnected Philippine construction data with zero
 * test/mock wording across Projects, Master Gantt, Workforce, DTR, Payroll,
 * Field Reports, QA/QC Punch List, and Audit Trails.
 *
 * Usage:
 *   node scripts/seed-defense-data.mjs
 */

import 'dotenv/config';
import pg from 'pg';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const { Pool } = pg;

const ACCOUNTS = {
  ADMIN_OM: { email: 'om@ldmconstruction.ph', password: 'admin123' },
  PM: { email: 'pm@ldmconstruction.ph', password: 'pm123' },
  TIMEKEEPER: { email: 'timekeeper@ldmconstruction.ph', password: 'tk123' },
  FINANCE: { email: 'finance@ldmconstruction.ph', password: 'finance123' },
};

class RoleClient {
  constructor(creds) {
    this.creds = creds;
    this.cookies = new Map();
    this.csrfToken = '';
    this.bearer = '';
    this.user = null;
  }

  _storeCookies(res) {
    const setCookies = typeof res.headers.getSetCookie === 'function'
      ? res.headers.getSetCookie()
      : (res.headers.get('set-cookie') ? [res.headers.get('set-cookie')] : []);
    for (const raw of setCookies) {
      if (!raw) continue;
      const [pair] = raw.split(';');
      const eqIdx = pair.indexOf('=');
      if (eqIdx > 0) {
        this.cookies.set(pair.slice(0, eqIdx).trim(), pair.slice(eqIdx + 1).trim());
      }
    }
  }

  async req(method, path, body = undefined) {
    const headers = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const cookieStr = Array.from(this.cookies.entries()).map(([k, v]) => `${k}=${v}`).join('; ');
    if (cookieStr) headers['Cookie'] = cookieStr;
    if (this.csrfToken) headers['x-csrf-token'] = this.csrfToken;
    if (this.bearer) headers['Authorization'] = `Bearer ${this.bearer}`;

    const res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    this._storeCookies(res);
    const text = await res.text();
    let data = null;
    try { data = JSON.parse(text); } catch { data = text; }
    return { status: res.status, ok: res.ok, data };
  }

  async login() {
    const csrf1 = await this.req('GET', '/api/auth/csrf');
    if (csrf1.data?.csrfToken) this.csrfToken = csrf1.data.csrfToken;
    const loginRes = await this.req('POST', '/api/auth/login', this.creds);
    if (!loginRes.ok) {
      throw new Error(`Login failed for ${this.creds.email}: HTTP ${loginRes.status} ${JSON.stringify(loginRes.data)}`);
    }
    if (loginRes.data?.csrfToken) this.csrfToken = loginRes.data.csrfToken;
    if (loginRes.data?.sessionToken || loginRes.data?.token) {
      this.bearer = loginRes.data.sessionToken || loginRes.data.token;
    }
    this.user = loginRes.data?.user || loginRes.data;
    const csrf2 = await this.req('GET', '/api/auth/csrf');
    if (csrf2.data?.csrfToken) this.csrfToken = csrf2.data.csrfToken;
    return this.user;
  }
}

function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

const DEFENSE_PROJECT_NAMES = [
  'Nuvali 2-Storey Modern Residence',
  'Calamba Commercial Office Fit-Out',
  'Alabang Executive Condo Renovation',
];

async function cleanExistingData() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL?.includes('localhost') ? false : { rejectUnauthorized: false },
  });
  try {
    console.log('1. Purging ALL legacy, test, and prior seed records (preserving core system user accounts)...');
    // Purge ALL commercial_projects so ONLY the 3 clean presentation projects (₱13.45M total) remain
    const targetProjsRes = await pool.query(`SELECT id FROM commercial_projects`);
    const targetProjIds = targetProjsRes.rows.map(r => r.id);

    if (targetProjIds.length > 0) {
      await pool.query(`DELETE FROM payroll_items WHERE payroll_run_id IN (SELECT id FROM payroll_runs WHERE project_id = ANY($1::text[]))`, [targetProjIds]).catch(() => {});
      await pool.query(`DELETE FROM payroll_runs WHERE project_id = ANY($1::text[])`, [targetProjIds]).catch(() => {});
      await pool.query(`DELETE FROM attendance_logs WHERE project_id = ANY($1::text[])`, [targetProjIds]).catch(() => {});
      await pool.query(`DELETE FROM cash_advances WHERE project_id = ANY($1::text[])`, [targetProjIds]).catch(() => {});
      await pool.query(`DELETE FROM project_worker_assignments WHERE project_id = ANY($1::text[])`, [targetProjIds]).catch(() => {});
      await pool.query(`DELETE FROM task_links WHERE "projectId" = ANY($1::text[])`, [targetProjIds]).catch(() => {});
      await pool.query(`DELETE FROM project_tasks WHERE "projectId" = ANY($1::text[])`, [targetProjIds]).catch(() => {});
      await pool.query(`DELETE FROM "TaskLink" WHERE "projectId" = ANY($1::text[])`, [targetProjIds]).catch(() => {});
      await pool.query(`DELETE FROM "ProjectTask" WHERE "projectId" = ANY($1::text[])`, [targetProjIds]).catch(() => {});
      await pool.query(`DELETE FROM punch_list_defects WHERE slot_id = ANY($1::text[])`, [targetProjIds]).catch(() => {});
      await pool.query(`DELETE FROM project_bom_phases WHERE project_id = ANY($1::text[])`, [targetProjIds]).catch(() => {});
      await pool.query(`DELETE FROM commercial_projects WHERE id = ANY($1::text[])`, [targetProjIds]).catch(() => {});
    }

    // Purge legacy/orphaned financial & compliance records (Sereno ₱1 test, PRJ-0650, Rodolfo alonte, Brent, Paul, Lizter, etc.)
    await pool.query(`DELETE FROM installment_ledgers`).catch(() => {});
    await pool.query(`DELETE FROM client_packages`).catch(() => {});
    await pool.query(`DELETE FROM users WHERE role = 'CLIENT'`).catch(() => {});
    await pool.query(`DELETE FROM subcontractor_payables`).catch(() => {});
    await pool.query(`DELETE FROM daily_manpower_audits`).catch(() => {});
    await pool.query(`DELETE FROM payroll_items`).catch(() => {});
    await pool.query(`DELETE FROM payroll_runs`).catch(() => {});
    await pool.query(`DELETE FROM government_permits`).catch(() => {});
    await pool.query(`DELETE FROM change_orders`).catch(() => {});
    await pool.query(`DELETE FROM project_bom_phases`).catch(() => {});

    // Purge legacy subcontractors & test workers (Rodolfo alonte, Brent, Paul, Lizter, etc.)
    const defenseWorkerNames = WORKERS_CATALOG.map(w => w.name);
    const targetWorkersRes = await pool.query(`
      SELECT id FROM workers
      WHERE name ILIKE '%[STRESS_TEST]%'
         OR name ILIKE '%Sample%'
         OR name ILIKE '%Dummy%'
         OR name ILIKE '%Rodolfo%'
         OR name ILIKE '%Brent%'
         OR name ILIKE '%Paul%'
         OR name ILIKE '%Lizter%'
         OR name = ANY($1::text[])
    `, [defenseWorkerNames]);
    const targetWorkerIds = targetWorkersRes.rows.map(r => r.id);
    if (targetWorkerIds.length > 0) {
      await pool.query(`DELETE FROM attendance_logs WHERE worker_id = ANY($1::text[])`, [targetWorkerIds]).catch(() => {});
      await pool.query(`DELETE FROM cash_advances WHERE worker_id = ANY($1::text[])`, [targetWorkerIds]).catch(() => {});
      await pool.query(`DELETE FROM project_worker_assignments WHERE worker_id = ANY($1::text[])`, [targetWorkerIds]).catch(() => {});
      await pool.query(`DELETE FROM workers WHERE id = ANY($1::text[])`, [targetWorkerIds]).catch(() => {});
      await pool.query(`DELETE FROM contractors WHERE id = ANY($1::text[])`, [targetWorkerIds]).catch(() => {});
    }
    await pool.query(`
      DELETE FROM contractors
      WHERE name ILIKE '%[STRESS_TEST]%'
         OR name ILIKE '%Rodolfo%'
         OR name ILIKE '%Brent%'
         OR name ILIKE '%Paul%'
         OR name ILIKE '%Lizter%'
         OR name = ANY($1::text[])
    `, [defenseWorkerNames]).catch(() => {});

    // Clean stress test & legacy audit logs
    await pool.query(`DELETE FROM process_audit_logs WHERE details ILIKE '%[STRESS_TEST]%' OR details ILIKE '%Sereno%' OR details ILIKE '%Brent%' OR details ILIKE '%Lizter%'`).catch(() => {});
    console.log(`   Purged ${targetProjIds.length} prior/legacy project(s), ${targetWorkerIds.length} prior/legacy worker(s), and all legacy payables/ledgers.`);
  } finally {
    await pool.end();
  }
}

const WORKERS_CATALOG = [
  // Project 1: Nuvali 2-Storey Modern Residence (6 workers - Full Crew)
  { name: 'Engr. Danilo Mendoza', position: 'Project Manager / Site Engineer', rate: 1500, siteIdx: 0 },
  { name: 'Ramon Dela Cruz', position: 'Site Foreman (Civil & Structural)', rate: 1100, siteIdx: 0 },
  { name: 'Billy Alipala', position: 'Lead Electrical & Mechanical Engineer', rate: 1350, siteIdx: 0, dualSiteIdx: 1 },
  { name: 'Ar. Camille Navarro', position: 'Project Architect & Interior Lead', rate: 1400, siteIdx: 0 },
  { name: 'Jomar Santos', position: 'Master Carpenter & Formworks', rate: 920, siteIdx: 0 },
  { name: 'Arnel Magbanua', position: 'Senior Masonry & Tile Artisan', rate: 880, siteIdx: 0 },

  // Project 2: Calamba Commercial Office Fit-Out (5 dedicated + Billy Alipala dual-site MEP)
  { name: 'Engr. Paolo Bautista', position: 'Project Manager / Civil Engineer', rate: 1480, siteIdx: 1 },
  { name: 'Ernesto Villanueva', position: 'Site Foreman (Commercial Fit-Out)', rate: 1080, siteIdx: 1 },
  { name: 'Ar. Miguel Tolentino', position: 'Commercial Fit-Out Architect', rate: 1380, siteIdx: 1 },
  { name: 'Dennis Soriano', position: 'Drywall & Acoustic Partition Installer', rate: 850, siteIdx: 1 },
  { name: 'Reynaldo Aquino', position: 'Finishing Painter & Coating Specialist', rate: 820, siteIdx: 1 },

  // Project 3: Alabang Executive Condo Renovation (2 assigned -> leaves PM, MEP, Architect open for AI Auto-Optimize demo!)
  { name: 'Nestor Pascual', position: 'Site Foreman (Interior Works)', rate: 1050, siteIdx: 2 },
  { name: 'Mark Anthony Reyes', position: 'General Construction Laborer', rate: 680, siteIdx: 2 },

  // Unassigned Pool (5 qualified workers ready for AI Crew Assistant & Auto-Optimize Crew live demo)
  { name: 'Engr. Jerome Castillo', position: 'MEP Electrical & Plumbing Engineer', rate: 1300, siteIdx: null },
  { name: 'Joel Sarmiento', position: 'Project Manager / Resident Engineer', rate: 1450, siteIdx: null },
  { name: 'Ar. Bianca Mercado', position: 'Interior Architect & CAD Specialist', rate: 1320, siteIdx: null },
  { name: 'Carlo Evangelista', position: 'HVAC & Plumbing Technician', rate: 950, siteIdx: null },
  { name: 'Lito Pangilinan', position: 'Master Steelman & Welder', rate: 900, siteIdx: null },

  // Corporate Executives (2 — intentionally excluded from field dispatch by AI Crew Assistant)
  { name: 'Victorino Reglos', position: 'Chief Executive Officer (CEO)', rate: 2500, siteIdx: null },
  { name: 'Elena Manalo', position: 'Chief Operating Officer (COO)', rate: 2200, siteIdx: null },
];

function buildProject1Gantt(pid) {
  // Nuvali 2-Storey Modern Residence (~65% progress, on-track)
  const raw = [
    { wbs: '1.0', text: 'Site Mobilization & Earthworks', s: '2026-08-10', e: '2026-08-22', dur: 12, prog: 1.0, phase: 'Site Preparation & Mobilization' },
    { wbs: '1.1', text: 'Perimeter Board-Up, Clearing & Staking', s: '2026-08-10', e: '2026-08-15', dur: 6, prog: 1.0, phase: 'Site Preparation & Mobilization', p: 0 },
    { wbs: '1.2', text: 'Foundation Excavation & Soil Poisoning', s: '2026-08-17', e: '2026-08-22', dur: 6, prog: 1.0, phase: 'Earthworks & Excavation', p: 0 },
    { wbs: '2.0', text: 'Substructure & Structural Framing', s: '2026-08-24', e: '2026-10-10', dur: 42, prog: 1.0, phase: 'Structural & Concrete Works' },
    { wbs: '2.1', text: 'Footings, Tie Beams & Ground Slab Pouring', s: '2026-08-24', e: '2026-09-09', dur: 15, prog: 1.0, phase: 'Foundation & Footings', p: 3 },
    { wbs: '2.2', text: 'Ground Floor Columns & 2F Suspended Slab', s: '2026-09-10', e: '2026-09-26', dur: 15, prog: 1.0, phase: 'Structural & Concrete Works', p: 3 },
    { wbs: '2.3', text: '2F Columns, Roof Beams & Steel Trusses', s: '2026-09-28', e: '2026-10-10', dur: 12, prog: 1.0, phase: 'Structural & Concrete Works', p: 3 },
    { wbs: '3.0', text: 'Masonry, Roofing & MEPFS Rough-Ins', s: '2026-10-12', e: '2026-11-28', dur: 42, prog: 0.78, phase: 'Masonry & CHB Works' },
    { wbs: '3.1', text: 'CHB Exterior & Interior Partition Walls', s: '2026-10-12', e: '2026-10-29', dur: 16, prog: 1.0, phase: 'Masonry & CHB Works', p: 7 },
    { wbs: '3.2', text: 'Pre-Painted Long-Span Roofing & Flashing', s: '2026-10-30', e: '2026-11-12', dur: 12, prog: 1.0, phase: 'Roofing & Waterproofing', p: 7 },
    { wbs: '3.3', text: 'Electrical Panel Board & Plumbing Rough-In', s: '2026-11-13', e: '2026-11-28', dur: 14, prog: 0.65, phase: 'MEPFS Rough-Ins', p: 7 },
    { wbs: '4.0', text: 'Architectural Finishes & Painting', s: '2026-11-30', e: '2027-01-23', dur: 46, prog: 0.15, phase: 'Architectural Finishes' },
    { wbs: '4.1', text: 'Interior Plastering, Skimcoat & Floor Tiling', s: '2026-11-30', e: '2026-12-22', dur: 20, prog: 0.25, phase: 'Architectural Finishes', p: 11 },
    { wbs: '4.2', text: 'Aluminum Windows, Doors & Custom Cabinetry', s: '2026-12-23', e: '2027-01-12', dur: 16, prog: 0.0, phase: 'Doors, Windows & Glazing', p: 11 },
    { wbs: '4.3', text: 'Exterior & Interior Architectural Painting', s: '2027-01-13', e: '2027-01-23', dur: 10, prog: 0.0, phase: 'Painting & Coatings', p: 11 },
    { wbs: '5.0', text: 'Final QA/QC Inspection & Homeowner Turnover', s: '2027-01-30', e: '2027-01-30', dur: 0, prog: 0.0, type: 'milestone', phase: 'Testing, Commissioning & Handover' },
  ];
  return mapGanttPayload(pid, raw);
}

function buildProject2Gantt(pid) {
  // Calamba Commercial Office Fit-Out (~40% progress, 3 realistic overdue tasks ending Nov 12–19, 2026)
  const raw = [
    { wbs: '1.0', text: 'Building Admin Clearances & Mobilization', s: '2026-09-01', e: '2026-09-12', dur: 11, prog: 1.0, phase: 'Site Preparation & Mobilization' },
    { wbs: '1.1', text: 'PEZA & Building Admin Fit-Out Permits', s: '2026-09-01', e: '2026-09-07', dur: 6, prog: 1.0, phase: 'Site Preparation & Mobilization', p: 0 },
    { wbs: '1.2', text: 'Site Board-Up & Existing Floor Protection', s: '2026-09-08', e: '2026-09-12', dur: 5, prog: 1.0, phase: 'Site Preparation & Mobilization', p: 0 },
    { wbs: '2.0', text: 'Partitions, Ceilings & MEPFS Works', s: '2026-09-14', e: '2026-11-19', dur: 56, prog: 0.55, phase: 'MEPFS Rough-Ins' },
    { wbs: '2.1', text: 'Drywall Partition Framing & Acoustic Insulation', s: '2026-09-14', e: '2026-11-12', dur: 20, prog: 0.80, phase: 'Masonry & CHB Works', p: 3 },
    { wbs: '2.2', text: 'MEPFS Rough-In & Conduit Installation', s: '2026-10-05', e: '2026-11-17', dur: 22, prog: 0.55, phase: 'MEPFS Rough-Ins', p: 3 },
    { wbs: '2.3', text: 'HVAC Ducting & Fire Sprinkler Relocation', s: '2026-10-19', e: '2026-11-19', dur: 18, prog: 0.40, phase: 'MEPFS Rough-Ins', p: 3 },
    { wbs: '2.4', text: 'Acoustic Ceiling Grid & LED Troffer Trim', s: '2026-11-23', e: '2026-12-03', dur: 10, prog: 0.0, phase: 'Architectural Finishes', p: 3 },
    { wbs: '3.0', text: 'Flooring, Glass Partitions & Millwork', s: '2026-12-04', e: '2026-12-17', dur: 12, prog: 0.0, phase: 'Architectural Finishes' },
    { wbs: '3.1', text: 'Modular Carpet Tiles & Executive Vinyl Flooring', s: '2026-12-04', e: '2026-12-10', dur: 6, prog: 0.0, phase: 'Architectural Finishes', p: 8 },
    { wbs: '3.2', text: 'Frameless Tempered Glass Conference Partitions', s: '2026-12-10', e: '2026-12-15', dur: 5, prog: 0.0, phase: 'Doors, Windows & Glazing', p: 8 },
    { wbs: '3.3', text: 'Reception Counter Millwork & Final Painting', s: '2026-12-12', e: '2026-12-17', dur: 5, prog: 0.0, phase: 'Painting & Coatings', p: 8 },
    { wbs: '4.0', text: 'FDAS Testing, Commissioning & Client Handover', s: '2026-12-20', e: '2026-12-20', dur: 0, prog: 0.0, type: 'milestone', phase: 'Testing, Commissioning & Handover' },
  ];
  return mapGanttPayload(pid, raw);
}

function buildProject3Gantt(pid) {
  // Alabang Executive Condo Renovation (~15% progress, early mobilization stage)
  const raw = [
    { wbs: '1.0', text: 'PMO Permits & Site Protection', s: '2026-11-02', e: '2026-11-14', dur: 12, prog: 1.0, phase: 'Site Preparation & Mobilization' },
    { wbs: '1.1', text: 'Condo Admin Work Permit & Elevator Padding', s: '2026-11-02', e: '2026-11-07', dur: 6, prog: 1.0, phase: 'Site Preparation & Mobilization', p: 0 },
    { wbs: '1.2', text: 'Existing Tile Stripping & Debris Hauling', s: '2026-11-09', e: '2026-11-14', dur: 6, prog: 1.0, phase: 'Site Preparation & Mobilization', p: 0 },
    { wbs: '2.0', text: 'MEP Rewiring & Wet-Area Waterproofing', s: '2026-11-16', e: '2026-12-05', dur: 18, prog: 0.25, phase: 'MEPFS Rough-Ins' },
    { wbs: '2.1', text: 'Electrical Panel Upgrade & Cove Lighting Wiring', s: '2026-11-16', e: '2026-11-28', dur: 12, prog: 0.35, phase: 'MEPFS Rough-Ins', p: 3 },
    { wbs: '2.2', text: 'Master Bath Waterproofing & 48h Flood Check', s: '2026-11-26', e: '2026-12-05', dur: 9, prog: 0.0, phase: 'Roofing & Waterproofing', p: 3 },
    { wbs: '3.0', text: 'Ceiling, Porcelain Tiling & Bespoke Joinery', s: '2026-12-07', e: '2027-01-08', dur: 28, prog: 0.0, phase: 'Architectural Finishes' },
    { wbs: '3.1', text: 'Gypsum Dropped Ceiling & Shadow Line Molding', s: '2026-12-07', e: '2026-12-16', dur: 9, prog: 0.0, phase: 'Architectural Finishes', p: 6 },
    { wbs: '3.2', text: 'Large-Format Porcelain Floor & Bath Tiling', s: '2026-12-16', e: '2026-12-26', dur: 10, prog: 0.0, phase: 'Architectural Finishes', p: 6 },
    { wbs: '3.3', text: 'Modular Kitchen & Walk-In Closet Installation', s: '2026-12-28', e: '2027-01-06', dur: 9, prog: 0.0, phase: 'Architectural Finishes', p: 6 },
    { wbs: '3.4', text: 'Low-VOC Wall Painting & Architectural Fixtures', s: '2027-01-04', e: '2027-01-12', dur: 8, prog: 0.0, phase: 'Painting & Coatings', p: 6 },
    { wbs: '4.0', text: 'Deep Cleaning & Executive Unit Turnover', s: '2027-01-15', e: '2027-01-15', dur: 0, prog: 0.0, type: 'milestone', phase: 'Testing, Commissioning & Handover' },
  ];
  return mapGanttPayload(pid, raw);
}

function mapGanttPayload(pid, raw) {
  const ids = raw.map((_, idx) => `ldm-tsk-${pid}-${idx + 1}`);
  return raw.map((r, idx) => ({
    id: ids[idx],
    wbsCode: r.wbs,
    text: r.text,
    startDate: r.s,
    endDate: r.e,
    start_date: r.s,
    end_date: r.e,
    baselineStart: r.s,
    baselineEnd: r.e,
    duration: r.dur,
    progress: r.prog,
    type: r.type || 'task',
    parentTaskId: r.p !== undefined ? ids[r.p] : null,
    sortOrder: idx + 1,
    milestonePhase: r.phase,
    constructionPhase: r.phase,
  }));
}

async function run() {
  console.log('\n====================================================================');
  console.log(' LDM Construction PMS — Panel Defense Data Seeder');
  console.log(` Target API: ${BASE_URL}`);
  console.log('====================================================================\n');

  await cleanExistingData();

  // Authenticate all 4 real role sessions
  const clients = {
    ADMIN_OM: new RoleClient(ACCOUNTS.ADMIN_OM),
    PM: new RoleClient(ACCOUNTS.PM),
    TIMEKEEPER: new RoleClient(ACCOUNTS.TIMEKEEPER),
    FINANCE: new RoleClient(ACCOUNTS.FINANCE),
  };
  for (const c of Object.values(clients)) await c.login();

  // 2. Seed 3 Realistic Active Construction Projects
  console.log('\n2. Seeding 3 active Philippine construction projects...');
  const projectDefs = [
    {
      name: 'Nuvali 2-Storey Modern Residence',
      clientName: 'Engr. & Mrs. Villanueva',
      description: 'Turnkey 2-storey modern residential build with structural framing, MEPFS, and custom architectural finishes',
      location: 'Sta. Rosa, Laguna',
      budget: 6800000,
      startDate: '2026-08-10',
      targetHandoverDate: '2027-01-30',
      status: 'IN_PROGRESS',
    },
    {
      name: 'Calamba Commercial Office Fit-Out',
      clientName: 'Laguna TechHub Holdings Corp.',
      description: 'Executive office interior fit-out including acoustic partitions, MEPFS rough-in, HVAC, and glass conference rooms',
      location: 'Calamba, Laguna',
      budget: 4250000,
      startDate: '2026-09-01',
      targetHandoverDate: '2026-12-20',
      status: 'IN_PROGRESS',
    },
    {
      name: 'Alabang Executive Condo Renovation',
      clientName: 'Dr. Rafael Mendoza',
      description: 'Full condominium interior renovation with electrical rewiring, waterproofing, porcelain tiling, and bespoke joinery',
      location: 'Muntinlupa City',
      budget: 2400000,
      startDate: '2026-11-02',
      targetHandoverDate: '2027-01-15',
      status: 'IN_PROGRESS',
    },
  ];

  const seededProjects = [];
  for (const def of projectDefs) {
    const res = await clients.ADMIN_OM.req('POST', '/api/projects', def);
    if (!res.ok || !res.data?.id) {
      throw new Error(`Failed creating project "${def.name}": HTTP ${res.status} ${JSON.stringify(res.data)}`);
    }
    seededProjects.push({ ...def, id: String(res.data.id) });
    console.log(`   + ${def.name} (${res.data.id}) — Budget ₱${def.budget.toLocaleString()}`);
  }

  // Sync PM & Timekeeper project_ids to the 3 freshly seeded projects so scoped GET /api/projects returns all 3
  const scopePool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL?.includes('localhost') ? false : { rejectUnauthorized: false },
  });
  try {
    const newIds = seededProjects.map(p => p.id);
    await scopePool.query(
      `UPDATE users SET project_ids = $1::text[] WHERE role IN ('ENGINEER', 'PROJECT_MANAGER', 'TIMEKEEPER')`,
      [newIds]
    );
  } finally {
    await scopePool.end();
  }
  // Re-login PM so req.user.projectIds reflects the 3 newly created projects
  await clients.PM.login();

  // 3. Seed Master Gantt Schedules (16 + 13 + 12 = 41 realistic tasks)
  console.log('\n3. Seeding Master Gantt schedules (Nov 2026 timeline + 3 overdue tasks on Calamba)...');
  const ganttBuilders = [buildProject1Gantt, buildProject2Gantt, buildProject3Gantt];
  let totalGanttTasks = 0;
  for (let i = 0; i < seededProjects.length; i++) {
    const proj = seededProjects[i];
    const tasks = ganttBuilders[i](proj.id);
    const syncRes = await clients.PM.req('POST', `/api/projects/${encodeURIComponent(proj.id)}/gantt/sync`, {
      tasks,
      links: [],
    });
    if (!syncRes.ok) {
      throw new Error(`Gantt sync failed for ${proj.name}: HTTP ${syncRes.status} ${JSON.stringify(syncRes.data)}`);
    }
    const count = syncRes.data?.data?.length || tasks.length;
    totalGanttTasks += count;
    console.log(`   + ${proj.name}: ${count} tasks synced (progress: ${syncRes.data?.result?.projectProgress ?? 0}%)`);
  }

  // 4. Seed 20 Realistic Filipino Construction Personnel & Assign Crews
  console.log('\n4. Seeding 20 Filipino construction personnel & assigning site crews...');
  const seededWorkers = [];
  for (const w of WORKERS_CATALOG) {
    const parts = w.name.split(' ');
    const hourlyOtRate = round2((w.rate / 8) * 1.25);
    const res = await clients.ADMIN_OM.req('POST', '/api/workers', {
      first_name: parts.slice(0, -1).join(' ') || w.name,
      last_name: parts[parts.length - 1] || w.name,
      name: w.name,
      position: w.position,
      trade: w.position,
      daily_rate: w.rate,
      hourly_ot_rate: hourlyOtRate,
      status: 'Active',
    });
    const wid = res.data?.id || res.data?.worker?.id || res.data?.workers?.[0]?.id;
    if (!res.ok || !wid) {
      throw new Error(`Failed creating worker "${w.name}": HTTP ${res.status} ${JSON.stringify(res.data)}`);
    }
    seededWorkers.push({ ...w, id: String(wid), hourlyOtRate });
  }
  console.log(`   + Created ${seededWorkers.length} workers (including 5 unassigned pool + 2 executives).`);

  // Assign crews as PM
  const projWorkersMap = [[], [], []];
  for (const w of seededWorkers) {
    if (w.siteIdx !== null && seededProjects[w.siteIdx]) {
      const targetProj = seededProjects[w.siteIdx];
      const assignRes = await clients.PM.req('PUT', `/api/projects/${encodeURIComponent(targetProj.id)}/workers`, {
        workerId: w.id,
        action: 'add',
        allocationSource: 'Manual',
      });
      if (!assignRes.ok) {
        throw new Error(`Failed assigning ${w.name}: HTTP ${assignRes.status} ${JSON.stringify(assignRes.data)}`);
      }
      projWorkersMap[w.siteIdx].push(w);
    }
  }

  // Record intentional dual-site shared MEP Engineer (Billy Alipala) on Calamba in project_worker_assignments + audit log
  const billy = seededWorkers.find(w => w.name === 'Billy Alipala');
  if (billy) {
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_URL?.includes('localhost') ? false : { rejectUnauthorized: false },
    });
    try {
      const calambaId = seededProjects[1].id;
      await pool.query(`
        UPDATE commercial_projects
        SET assigned_contractor_ids = array_append(assigned_contractor_ids, $1),
            assigned_workers_count = COALESCE(array_length(assigned_contractor_ids, 1), 0) + 1
        WHERE id = $2 AND NOT ($1 = ANY(COALESCE(assigned_contractor_ids, ARRAY[]::text[])))
      `, [billy.id, calambaId]);
      await pool.query(`
        INSERT INTO project_worker_assignments (id, project_id, worker_id, assigned_at, status)
        VALUES ($1, $2, $3, CURRENT_TIMESTAMP, 'ACTIVE')
        ON CONFLICT (project_id, worker_id) DO UPDATE SET status = 'ACTIVE'
      `, [`PWA-${calambaId}-${billy.id}`, calambaId, billy.id]);
      await pool.query(`
        INSERT INTO process_audit_logs (id, "entityType", "entityId", action, "actorName", "actorRole", details, "createdAt")
        VALUES ($1, 'WORKFORCE', $2, 'CONFLICT_OVERRIDE_ASSIGNMENT', 'Engr. Marco Santos', 'PROJECT_MANAGER', $3, CURRENT_TIMESTAMP)
      `, [
        `AUD-OVRD-${Date.now().toString().slice(-6)}`,
        billy.id,
        `Dual-site conflict override approved for Billy Alipala (Lead Electrical & Mechanical Engineer) across Nuvali 2-Storey Modern Residence and Calamba Commercial Office Fit-Out — Reason: Split-Shift Supervision for panel board termination.`
      ]);
      projWorkersMap[1].push(billy);
    } finally {
      await pool.end();
    }
  }
  console.log(`   + Nuvali crew: ${projWorkersMap[0].length} | Calamba crew: ${projWorkersMap[1].length} (incl. dual-site MEP) | Alabang crew: ${projWorkersMap[2].length} (open slots for AI demo)`);

  // 5. Dynamic DTR Attendance (Prior Week Nov 9–14 Finalized + Current Week Nov 16–21 Ready for Live Calculation)
  console.log('\n5. Seeding DTR Attendance (Nov 9–14 finalized archive + Nov 16–21 active cycle) & Cash Advances...');
  const priorWeekDates = ['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14'];
  const currentWeekDates = ['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20', '2026-11-21'];

  // Prior week DTR for Project 1 (Nuvali) -> Finalize into Payroll Archive
  for (let dIdx = 0; dIdx < priorWeekDates.length; dIdx++) {
    const records = projWorkersMap[0].map((w, wIdx) => ({
      workerId: w.id,
      status: dIdx === 5 && wIdx === 5 ? 'HALF_DAY' : 'PRESENT',
      overtimeHours: dIdx === 2 && wIdx <= 2 ? 2 : 0,
    }));
    const r = await clients.TIMEKEEPER.req('POST', '/api/attendance', {
      projectId: seededProjects[0].id,
      date: priorWeekDates[dIdx],
      records,
    });
    if (!r.ok) throw new Error(`Prior week DTR failed on ${priorWeekDates[dIdx]}: ${r.status} ${JSON.stringify(r.data)}`);
  }

  const finalizeRes = await clients.FINANCE.req('POST', '/api/payroll/finalize', {
    projectId: seededProjects[0].id,
    periodStart: priorWeekDates[0],
    periodEnd: priorWeekDates[5],
  });
  console.log(`   + Finalized Prior Week Payroll Archive (Nov 9–14, 2026) for Nuvali: HTTP ${finalizeRes.status}`);

  // Current week DTR (Nov 16–21, 2026) for Project 1 (Nuvali) & Project 2 (Calamba) — left unfinalized for live defense demo
  let dtrEntriesSeeded = 0;
  for (let pIdx = 0; pIdx <= 1; pIdx++) {
    const proj = seededProjects[pIdx];
    const crew = projWorkersMap[pIdx];
    for (let dIdx = 0; dIdx < currentWeekDates.length; dIdx++) {
      const records = crew.map((w, wIdx) => {
        const isHalf = dIdx === 5 && wIdx === crew.length - 1;
        const isOt = (dIdx === 1 && wIdx === 1) || (dIdx === 3 && wIdx === 2);
        return {
          workerId: w.id,
          status: isHalf ? 'HALF_DAY' : 'PRESENT',
          overtimeHours: isOt ? 2 : (dIdx === 4 && wIdx === 4 ? 1 : 0),
        };
      });
      const r = await clients.TIMEKEEPER.req('POST', '/api/attendance', {
        projectId: proj.id,
        date: currentWeekDates[dIdx],
        records,
      });
      if (!r.ok) throw new Error(`Current week DTR failed on ${proj.name} ${currentWeekDates[dIdx]}: ${r.status} ${JSON.stringify(r.data)}`);
      dtrEntriesSeeded += records.length;
    }
  }
  console.log(`   + Seeded ${dtrEntriesSeeded} verified DTR entries for Nov 16–21, 2026 across Nuvali & Calamba.`);

  // 2 Realistic Cash Advances (Vale) on Project 1
  const vales = [
    { worker: projWorkersMap[0][4], amount: 500, reason: 'Mid-week family subsistence advance' },
    { worker: projWorkersMap[0][5], amount: 1000, reason: 'Medical prescription & transport advance' },
  ];
  for (const v of vales) {
    const r = await clients.FINANCE.req('POST', '/api/workers/cash-advances', {
      workerId: v.worker.id,
      projectId: seededProjects[0].id,
      amount: v.amount,
      reason: v.reason,
    });
    if (!r.ok) throw new Error(`Cash advance failed for ${v.worker.name}: HTTP ${r.status}`);
  }
  console.log(`   + Recorded 2 Cash Advances (Vale): ₱500 (${vales[0].worker.name}) and ₱1,000 (${vales[1].worker.name}).`);

  // 6. Field Activity Logs & QA/QC Punch List Items
  console.log('\n6. Seeding Daily Site Logs & QA/QC Punch List items...');
  const siteLogs = [
    {
      weather: 'PARTLY_CLOUDY',
      temperature: '31°C',
      activeHeadcount: projWorkersMap[0].length,
      equipmentOnSite: '1-Bagger Concrete Mixer, Plate Compactor, Laser Level',
      toolboxTopic: 'Working at Heights & Roof Harness Inspection',
      workCompleted: 'Completed long-span roofing flashing at Nuvali Residence; continued electrical panel board termination and sanitary stack rough-in.',
      delaysOrIssues: 'Minor 30-minute afternoon drizzle; work shifted to interior conduit layout.',
      supervisorName: 'Engr. Marco Santos',
    },
    {
      weather: 'SUNNY',
      temperature: '33°C',
      activeHeadcount: projWorkersMap[1].length,
      equipmentOnSite: 'Scissor Lift, Rotary Hammer Drills, Stud Crimpers',
      toolboxTopic: 'Electrical Lockout/Tagout & Conduit Routing Safety',
      workCompleted: 'Completed 80% of drywall partition framing at Calamba Commercial Office; coordinated HVAC diffuser relocation with MEP team.',
      delaysOrIssues: 'Awaiting PEZA admin delivery pass for fire sprinkler riser fittings (critical path recovery scheduled).',
      supervisorName: 'Engr. Marco Santos',
    },
    {
      weather: 'SUNNY',
      temperature: '30°C',
      activeHeadcount: projWorkersMap[2].length,
      equipmentOnSite: 'Chipping Gun, Vacuum Dust Extractor, Floor Protection Boards',
      toolboxTopic: 'Condo PMO Noise Compliance & Debris Hauling Protocol',
      workCompleted: 'Completed existing tile stripping and debris hauling at Alabang Executive Condo; commenced electrical cove lighting rewiring.',
      delaysOrIssues: 'None — mobilizing MEP Engineer and Architect next week.',
      supervisorName: 'Engr. Marco Santos',
    },
  ];
  for (const log of siteLogs) {
    await clients.PM.req('POST', '/api/site-logs', log);
  }

  const punchItems = [
    {
      slotId: seededProjects[0].id,
      contractorId: projWorkersMap[0][2]?.id,
      title: 'Panel Board Circuit Labeling & Grounding Continuity Verification',
      description: 'Verify megger insulation resistance and complete permanent circuit directory labels on main 200A breaker panel prior to energization.',
      severity: 'MEDIUM',
      category: 'ELECTRICAL',
      targetDate: '2026-11-28',
    },
    {
      slotId: seededProjects[1].id,
      contractorId: projWorkersMap[1][3]?.id,
      title: 'Acoustic Sealant Gap at Conference Room Partition Top Track',
      description: 'Apply continuous acoustic caulking along upper runner track at Executive Boardroom partition to meet STC-50 sound attenuation spec.',
      severity: 'HIGH',
      category: 'ARCHITECTURAL',
      targetDate: '2026-11-26',
    },
    {
      slotId: seededProjects[1].id,
      contractorId: billy?.id,
      title: 'RFI-014: HVAC Supply Duct Clearance Above Dropped Ceiling',
      description: 'Confirm 120mm clearance between 12x10 supply duct and fire sprinkler branch line along Gridline B-4 before closing ceiling grid.',
      severity: 'HIGH',
      category: 'MEPFS',
      targetDate: '2026-11-25',
    },
    {
      slotId: seededProjects[2].id,
      contractorId: projWorkersMap[2][0]?.id,
      title: 'Master Bathroom 48-Hour Flood Test Readiness',
      description: 'Inspect elastomeric waterproofing membrane upturn (300mm minimum at shower walls) before commencing 48-hour ponding verification.',
      severity: 'MEDIUM',
      category: 'PLUMBING',
      targetDate: '2026-12-04',
    },
  ];
  let punchCount = 0;
  for (const item of punchItems) {
    const r = await clients.PM.req('POST', '/api/punch-lists', item);
    if (r.ok) punchCount++;
  }

  // 7. Commercial Change Orders & Scope Variations
  console.log('\n7. Seeding Commercial Change Orders & Government Permits...');
  const changeOrdersSeed = [
    {
      orderNumber: 'CO-2026-001',
      title: 'Upgrade Main Facade Glazing to Double-Glazed Low-E Tempered Glass',
      contractorName: 'Laguna Architectural Glass & Aluminum Corp.',
      requestedAmount: 285000,
      status: 'APPROVED',
      approvedAmount: 268000,
      approvedBy: 'Operations Manager (Admin)',
      justification: '[Nuvali 2-Storey Modern Residence] Client-requested thermal insulation upgrade for west-facing 2F master bedroom and living area curtain wall panels.',
    },
    {
      orderNumber: 'CO-2026-002',
      title: 'Additional 15kVA Standby Automatic Transfer Switch & Sub-Feeder',
      contractorName: 'Calabarzon MEPFS Systems Inc.',
      requestedAmount: 195000,
      status: 'APPROVED',
      approvedAmount: 195000,
      approvedBy: 'Engr. Marco Santos',
      justification: '[Nuvali 2-Storey Modern Residence] Addition of generator-ready ATS circuit and concealed underground PVC conduit run to service utility area.',
    },
    {
      orderNumber: 'CO-2026-003',
      title: 'Executive Boardroom Acoustic Baffle Ceiling & Dedicated VRF Cassette',
      contractorName: 'South Metro HVAC & Interiors',
      requestedAmount: 420000,
      status: 'PENDING',
      justification: '[Calamba Commercial Office Fit-Out] Tenant revision requiring STC-50 acoustic ceiling baffles and independent 3TR inverter cassette unit for 16-seat boardroom.',
    },
    {
      orderNumber: 'CO-2026-004',
      title: 'Structural Floor Slab Carbon-Fiber Strengthening for Server Room Load',
      contractorName: 'SolidFoundations Engineering',
      requestedAmount: 1150000,
      status: 'PENDING',
      justification: '[Calamba Commercial Office Fit-Out] Executive sign-off required: CFRP structural reinforcement for high-density UPS battery bank and server rack bay.',
    },
    {
      orderNumber: 'CO-2026-005',
      title: 'Custom Engineered White Oak Millwork & Concealed Kitchen Pantry Doors',
      contractorName: 'Alabang Fine Joinery & Millwork',
      requestedAmount: 165000,
      status: 'PENDING',
      justification: '[Alabang Executive Condo Renovation] Owner upgrade from laminated MDF cabinetry to moisture-resistant marine plywood with natural white oak veneer.',
    },
  ];
  let coCount = 0;
  for (const co of changeOrdersSeed) {
    const createRes = await clients.PM.req('POST', '/api/change-orders', {
      orderNumber: co.orderNumber,
      title: co.title,
      contractorName: co.contractorName,
      requestedAmount: co.requestedAmount,
      justification: co.justification,
    });
    if (createRes.ok && createRes.data?.id) {
      coCount++;
      if (co.status === 'APPROVED') {
        await clients.ADMIN_OM.req('PATCH', `/api/change-orders/${createRes.data.id}`, {
          status: 'APPROVED',
          approvedAmount: co.approvedAmount,
          approvedBy: co.approvedBy,
        });
      }
    }
  }

  // 8. Government Permits & Legal Compliance (OBO, BFP, DOLE, LGU, PMO)
  const permitsSeed = [
    {
      projectName: 'Nuvali 2-Storey Modern Residence',
      permitName: 'LGU Building Permit',
      permitType: 'LGU_BUILDING_PERMIT',
      issuingAgency: 'City of Sta. Rosa — Office of the Building Official (OBO)',
      referenceNo: 'OBO-SR-2026-04182',
      status: 'APPROVED',
      applicationDate: '2026-07-10',
      approvalDate: '2026-08-05',
      expiryDate: '2027-08-05',
      notes: 'Full residential building permit approved with structural, architectural, and sanitary plans stamped.',
    },
    {
      projectName: 'Nuvali 2-Storey Modern Residence',
      permitName: 'DOLE Construction Safety & Health Program (CSHP)',
      permitType: 'DOLE_CSHP',
      issuingAgency: 'DOLE Region IV-A (CALABARZON)',
      referenceNo: 'DOLE-R4A-CSHP-2026-1194',
      status: 'APPROVED',
      applicationDate: '2026-07-18',
      approvalDate: '2026-08-02',
      expiryDate: '2027-02-28',
      notes: 'Approved CSHP with designated SO2 Safety Officer and weekly toolbox compliance.',
    },
    {
      projectName: 'Nuvali 2-Storey Modern Residence',
      permitName: 'Electrical & Mechanical Installation Permit',
      permitType: 'ELECTRICAL_PERMIT',
      issuingAgency: 'City of Sta. Rosa — OBO Electrical Division',
      referenceNo: 'OBO-EL-2026-0881',
      status: 'APPROVED',
      applicationDate: '2026-08-12',
      approvalDate: '2026-08-26',
      expiryDate: '2027-08-26',
      notes: 'Covers 200A main service entrance, load schedule, and grounding system.',
    },
    {
      projectName: 'Calamba Commercial Office Fit-Out',
      permitName: 'BFP Fire Safety Evaluation Clearance (FSEC)',
      permitType: 'BFP_FSEC',
      issuingAgency: 'Bureau of Fire Protection — Calamba City Fire Station',
      referenceNo: 'BFP-CLB-FSEC-2026-309',
      status: 'APPROVED',
      applicationDate: '2026-09-04',
      approvalDate: '2026-09-19',
      expiryDate: '2027-03-19',
      notes: 'Fire sprinkler head layout and FDAS smoke detector zoning cleared for 3F commercial unit.',
    },
    {
      projectName: 'Calamba Commercial Office Fit-Out',
      permitName: 'Architectural Fit-Out Clearances',
      permitType: 'LGU_FITOUT_PERMIT',
      issuingAgency: 'Calamba City OBO & Building Property Management',
      referenceNo: 'OBO-CLB-FO-2026-772',
      status: 'UNDER_RENEWAL',
      applicationDate: '2026-09-01',
      approvalDate: '2026-09-12',
      expiryDate: '2026-12-05',
      notes: 'Extension filed for night-shift MEP ceiling closure and weekend delivery gate pass.',
    },
    {
      projectName: 'Alabang Executive Condo Renovation',
      permitName: 'Barangay Construction Clearance',
      permitType: 'BARANGAY_CLEARANCE',
      issuingAgency: 'Barangay Ayala Alabang, Muntinlupa City',
      referenceNo: 'BAA-CLR-2026-514',
      status: 'APPROVED',
      applicationDate: '2026-10-20',
      approvalDate: '2026-10-25',
      expiryDate: '2027-04-25',
      notes: 'Cleared for interior renovation hauling hours (Mon–Sat, 08:00–17:00).',
    },
    {
      projectName: 'Alabang Executive Condo Renovation',
      permitName: 'Sanitary & Plumbing Clearance',
      permitType: 'SANITARY_PERMIT',
      issuingAgency: 'Muntinlupa City OBO & Condo PMO Engineering',
      referenceNo: 'OBO-MUNT-SP-2026-903',
      status: 'PENDING',
      applicationDate: '2026-11-12',
      expiryDate: '2027-05-12',
      notes: 'Under technical review for master bath waterproofing flood-test schedule and riser tie-in.',
    },
  ];
  let permitCount = 0;
  for (const pmt of permitsSeed) {
    // Brief delay so PMT-<ms> IDs remain unique
    await new Promise(r => setTimeout(r, 20));
    const r = await clients.PM.req('POST', '/api/permits', pmt);
    if (r.ok) permitCount++;
  }
  console.log(`   + Seeded ${coCount} Commercial Change Orders and ${permitCount} Government Permits.`);

  // 9. Progress Billing & Receipts (Client AR Installments), Subcontractor Payables (AP), & BOM Phases
  console.log('\n8. Seeding Progress Billing & Receipts, Subcontractor Payables (project_id linked), and BOM Phases...');
  const finPool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL?.includes('localhost') ? false : { rejectUnauthorized: false },
  });
  let invCount = 0;
  let totalCollectedSeeded = 0;
  try {
    const clientBillingPlan = [
      {
        proj: seededProjects[0],
        email: 'villanueva.nuvali@client.ldmconstruction.ph',
        installments: [
          { id: 'INV-2026-001', dueDate: '2026-08-15', paymentDate: '2026-08-15', amount: 2040000, status: 'PAID' },
          { id: 'INV-2026-002', dueDate: '2026-10-18', paymentDate: '2026-10-18', amount: 1700000, status: 'PAID' },
          { id: 'INV-2026-003', dueDate: '2026-12-05', paymentDate: null, amount: 1360000, status: 'PENDING' },
        ],
      },
      {
        proj: seededProjects[1],
        email: 'treasury.techhub@client.ldmconstruction.ph',
        installments: [
          { id: 'INV-2026-004', dueDate: '2026-09-12', paymentDate: '2026-09-12', amount: 1275000, status: 'PAID' },
          { id: 'INV-2026-005', dueDate: '2026-11-04', paymentDate: '2026-11-04', amount: 850000, status: 'PAID' },
          { id: 'INV-2026-006', dueDate: '2026-12-10', paymentDate: null, amount: 1062500, status: 'PENDING' },
        ],
      },
      {
        proj: seededProjects[2],
        email: 'rmendoza.alabang@client.ldmconstruction.ph',
        installments: [
          { id: 'INV-2026-007', dueDate: '2026-11-02', paymentDate: '2026-11-02', amount: 720000, status: 'PAID' },
          { id: 'INV-2026-008', dueDate: '2026-12-15', paymentDate: null, amount: 600000, status: 'PENDING' },
        ],
      },
    ];

    for (const plan of clientBillingPlan) {
      const userId = `cli-${plan.proj.id.toLowerCase()}`;
      const pkgId = `pkg-${plan.proj.id.toLowerCase()}`;
      await finPool.query(
        `INSERT INTO users (id, email, name, role, "passwordHash", project_ids, "createdAt", "updatedAt")
         VALUES ($1, $2, $3, 'CLIENT', 'CLIENT_NOPASS', $4::text[], NOW(), NOW())
         ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, project_ids = EXCLUDED.project_ids`,
        [userId, plan.email, plan.proj.clientName, [plan.proj.id]]
      );
      await finPool.query(
        `INSERT INTO client_packages (id, "userId", price, "packageType", "paymentMethod", "createdAt", "updatedAt")
         VALUES ($1, $2, $3, $4, 'INSTALLMENT', NOW(), NOW())
         ON CONFLICT (id) DO UPDATE SET price = EXCLUDED.price, "packageType" = EXCLUDED."packageType"`,
        [pkgId, userId, plan.proj.budget, plan.proj.name]
      );
      let projPaid = 0;
      for (const inst of plan.installments) {
        const amtPaid = inst.status === 'PAID' ? inst.amount : 0;
        if (inst.status === 'PAID') {
          projPaid += inst.amount;
          totalCollectedSeeded += inst.amount;
        }
        await finPool.query(
          `INSERT INTO installment_ledgers (id, "clientPackageId", "dueDate", "amountDue", "amountPaid", status, "paymentDate", "createdAt", "updatedAt")
           VALUES ($1, $2, $3::timestamptz, $4, $5, $6::"PaymentStatus", $7::timestamptz, NOW(), NOW())
           ON CONFLICT (id) DO UPDATE SET "amountDue" = EXCLUDED."amountDue", "amountPaid" = EXCLUDED."amountPaid", status = EXCLUDED.status`,
          [inst.id, pkgId, inst.dueDate, inst.amount, amtPaid, inst.status, inst.paymentDate]
        );
        invCount++;
      }
      await finPool.query(
        `UPDATE commercial_projects SET funds_collected = $1 WHERE id = $2`,
        [projPaid, plan.proj.id]
      );
    }
  } finally {
    await finPool.end();
  }
  console.log(`   + Seeded ${invCount} Progress Billing installments (Total Collected: ₱${totalCollectedSeeded.toLocaleString()}).`);

  // 5 Specialty Subcontractor Payables strictly linked via projectId (3 Paid / Disbursed + 2 Approved ready for live Disburse demo)
  const subconPayablesSeed = [
    {
      id: 'SPY-2026-001',
      projectId: seededProjects[0].id,
      projectSite: seededProjects[0].name,
      payeeContractorName: 'South Luzon Ready-Mix & Pumping Corp.',
      tradeSpecialty: 'Ready-Mix Concrete Supply & Boom Pumping',
      verifiedHeadcount: 14,
      claimedHeadcount: 14,
      billedDays: 5,
      ratePerDay: 137000,
      billedAmount: 685000,
      approvedAmount: 685000,
      disbursedAmount: 685000,
      disbursementDate: '2026-10-14',
      paymentMethod: 'Bank Wire',
      referenceNo: 'BDO-WT-2026-8841',
      status: 'PAID',
      remarks: '3500 PSI structural concrete pour for 2F suspended slab & roof beams. 14/14 crew headcount verified on-site.',
    },
    {
      id: 'SPY-2026-002',
      projectId: seededProjects[0].id,
      projectSite: seededProjects[0].name,
      payeeContractorName: 'Calabarzon Steel & Roofing Fabricators',
      tradeSpecialty: 'Structural Steel Trusses & Long-Span Roofing',
      verifiedHeadcount: 10,
      claimedHeadcount: 10,
      billedDays: 6,
      ratePerDay: 70000,
      billedAmount: 420000,
      approvedAmount: 420000,
      disbursedAmount: 420000,
      disbursementDate: '2026-11-06',
      paymentMethod: 'Bank Wire',
      referenceNo: 'BPI-WT-2026-4412',
      status: 'PAID',
      remarks: 'Fabrication and erection of steel roof trusses, purlins, and pre-painted 0.6mm rib-type roofing sheets.',
    },
    {
      id: 'SPY-2026-003',
      projectId: seededProjects[1].id,
      projectSite: seededProjects[1].name,
      payeeContractorName: 'MetroCool HVAC Systems Inc.',
      tradeSpecialty: 'VRF Air-Conditioning & Insulated Ductwork',
      verifiedHeadcount: 8,
      claimedHeadcount: 8,
      billedDays: 6,
      ratePerDay: 90000,
      billedAmount: 540000,
      approvedAmount: 540000,
      disbursedAmount: 540000,
      disbursementDate: '2026-11-11',
      paymentMethod: 'Bank Wire',
      referenceNo: 'MBTC-WT-2026-7190',
      status: 'PAID',
      remarks: 'Supply and installation of inverter VRF indoor cassettes, refrigerant copper piping, and galvanized supply ducts.',
    },
    {
      id: 'SPY-2026-004',
      projectId: seededProjects[1].id,
      projectSite: seededProjects[1].name,
      payeeContractorName: 'Calamba FirePro & FDAS Engineering',
      tradeSpecialty: 'Fire Sprinkler Piping & Addressable FDAS',
      verifiedHeadcount: 6,
      claimedHeadcount: 6,
      billedDays: 5,
      ratePerDay: 53000,
      billedAmount: 265000,
      approvedAmount: 265000,
      paymentMethod: 'Check',
      referenceNo: 'CHK-2026-1048',
      status: 'APPROVED',
      remarks: 'Sprinkler branch line relocation and smoke detector loop cabling verified 100% matched. Ready for disbursement.',
    },
    {
      id: 'SPY-2026-005',
      projectId: seededProjects[2].id,
      projectSite: seededProjects[2].name,
      payeeContractorName: 'Alabang Glass & Aluminum Works',
      tradeSpecialty: 'Architectural Glazing & Frameless Shower Enclosures',
      verifiedHeadcount: 5,
      claimedHeadcount: 5,
      billedDays: 4,
      ratePerDay: 46250,
      billedAmount: 185000,
      approvedAmount: 185000,
      paymentMethod: 'Bank Wire',
      referenceNo: 'BDO-WT-2026-9102',
      status: 'APPROVED',
      remarks: 'Tempered 12mm frameless shower enclosure & powder-coated balcony sliding glass fabrication approved for release.',
    },
  ];
  let subconCount = 0;
  for (const sp of subconPayablesSeed) {
    const r = await clients.FINANCE.req('POST', '/api/subcontractor-payables', sp);
    if (r.ok) subconCount++;
  }
  console.log(`   + Seeded ${subconCount} Subcontractor Payables (3 Paid / Disbursed, 2 Approved ready for live disbursement).`);

  // Seed realistic BOM Phases for all 3 projects so Finance Dashboard shows live BOM phases instead of 0 BOM PHASES (BLANK)
  const bomTemplates = [
    {
      project: seededProjects[0],
      phases: [
        { id: 'bom-nuv-1', code: 'DIV 01', name: 'Preliminaries, Mobilization & LGU Permits', items: [{ id: 'i1', description: 'Temporary Board-Up, Field Office & OBO/BFP Permits', unit: 'lot', qty: 1, materialUnitCost: 185000, laborUnitCost: 95000 }] },
        { id: 'bom-nuv-2', code: 'DIV 02', name: 'Earthworks, Excavation & Foundation', items: [{ id: 'i2', description: 'Footing Excavation, Soil Poisoning & Gravel Bedding', unit: 'cu.m', qty: 85, materialUnitCost: 2400, laborUnitCost: 1100 }] },
        { id: 'bom-nuv-3', code: 'DIV 03', name: 'Structural Concrete, Rebars & Steel Trusses', items: [{ id: 'i3', description: '3500 PSI Ready-Mix Concrete & Grade 60 Deformed Bars', unit: 'lot', qty: 1, materialUnitCost: 1650000, laborUnitCost: 620000 }] },
        { id: 'bom-nuv-4', code: 'DIV 04', name: 'Masonry, Plastering & Long-Span Roofing', items: [{ id: 'i4', description: 'CHB 6" Exterior / 4" Interior Walls & Pre-Painted Roofing', unit: 'sq.m', qty: 420, materialUnitCost: 1850, laborUnitCost: 850 }] },
        { id: 'bom-nuv-5', code: 'DIV 05', name: 'MEPFS Rough-In, Panel Board & Sanitary', items: [{ id: 'i5', description: '200A Panel Board, THHN Wiring & PPR Plumbing Lines', unit: 'lot', qty: 1, materialUnitCost: 580000, laborUnitCost: 290000 }] },
        { id: 'bom-nuv-6', code: 'DIV 06', name: 'Architectural Finishes, Glazing & Painting', items: [{ id: 'i6', description: 'Porcelain Tiles, Low-E Aluminum Windows & Elastomeric Paint', unit: 'lot', qty: 1, materialUnitCost: 920000, laborUnitCost: 410000 }] },
      ],
    },
    {
      project: seededProjects[1],
      phases: [
        { id: 'bom-cal-1', code: 'DIV 01', name: 'Building Admin Clearances & Site Protection', items: [{ id: 'c1', description: 'Fit-Out Bond, Floor Protection & Temporary Power', unit: 'lot', qty: 1, materialUnitCost: 120000, laborUnitCost: 65000 }] },
        { id: 'bom-cal-2', code: 'DIV 02', name: 'Drywall Partitions & Acoustic Insulation', items: [{ id: 'c2', description: '12mm Gypsum Board on Metal Studs w/ Rockwool STC-50', unit: 'sq.m', qty: 260, materialUnitCost: 1950, laborUnitCost: 820 }] },
        { id: 'bom-cal-3', code: 'DIV 03', name: 'Acoustic Ceiling Grid & LED Lighting', items: [{ id: 'c3', description: '600x600 Acoustic Boards & 40W Recessed LED Troffers', unit: 'sq.m', qty: 310, materialUnitCost: 1650, laborUnitCost: 680 }] },
        { id: 'bom-cal-4', code: 'DIV 04', name: 'VRF HVAC, Fire Sprinklers & Structured Cabling', items: [{ id: 'c4', description: 'Inverter VRF Cassettes, FDAS Loops & Cat6A Data Drops', unit: 'lot', qty: 1, materialUnitCost: 1180000, laborUnitCost: 460000 }] },
        { id: 'bom-cal-5', code: 'DIV 05', name: 'Modular Carpet, Glass Partitions & Reception Millwork', items: [{ id: 'c5', description: '12mm Tempered Glass Conference Walls & Executive Flooring', unit: 'lot', qty: 1, materialUnitCost: 780000, laborUnitCost: 310000 }] },
      ],
    },
    {
      project: seededProjects[2],
      phases: [
        { id: 'bom-ala-1', code: 'DIV 01', name: 'PMO Clearances, Stripping & Debris Hauling', items: [{ id: 'a1', description: 'Condo Work Permit, Tile Chipping & Night-Shift Hauling', unit: 'lot', qty: 1, materialUnitCost: 85000, laborUnitCost: 95000 }] },
        { id: 'bom-ala-2', code: 'DIV 02', name: 'Waterproofing & Large-Format Porcelain Tiling', items: [{ id: 'a2', description: 'Elastomeric Wet-Area Membrane & 600x1200 Porcelain Slabs', unit: 'sq.m', qty: 115, materialUnitCost: 3400, laborUnitCost: 1350 }] },
        { id: 'bom-ala-3', code: 'DIV 03', name: 'Electrical Cove Lighting & Plumbing Fixtures', items: [{ id: 'a3', description: 'Dimmer Circuits, Warm LED Cove Strips & Kohler Sanitaryware', unit: 'lot', qty: 1, materialUnitCost: 440000, laborUnitCost: 195000 }] },
        { id: 'bom-ala-4', code: 'DIV 04', name: 'Bespoke White Oak Millwork & Low-VOC Painting', items: [{ id: 'a4', description: 'Modular Kitchen, Walk-In Closet & Low-VOC Interior Paint', unit: 'lot', qty: 1, materialUnitCost: 690000, laborUnitCost: 265000 }] },
      ],
    },
  ];
  let bomSeededProjects = 0;
  for (const tpl of bomTemplates) {
    const r = await clients.FINANCE.req('PUT', `/api/projects/${tpl.project.id}/bom`, { phases: tpl.phases });
    if (r.ok) bomSeededProjects++;
  }
  console.log(`   + Seeded persisted BOM Phases across ${bomSeededProjects} projects (Nuvali: 6, Calamba: 5, Alabang: 4).`);

  // Final Live Health Verification across modules
  const [vProj, vWork, vRoster, vRuns, vCos, vPermits, vSubcon] = await Promise.all([
    clients.PM.req('GET', '/api/projects'),
    clients.PM.req('GET', '/api/contractors-list'),
    clients.TIMEKEEPER.req('GET', `/api/attendance/roster?projectId=${encodeURIComponent(seededProjects[0].id)}&status=Active`),
    clients.FINANCE.req('GET', '/api/payroll/runs'),
    clients.PM.req('GET', '/api/change-orders'),
    clients.PM.req('GET', '/api/permits'),
    clients.FINANCE.req('GET', '/api/subcontractor-payables'),
  ]);

  const liveProjects = Array.isArray(vProj.data) ? vProj.data : [];
  const totalContract = liveProjects.reduce((s, p) => s + Number(p.budget || 0), 0);
  const totalCollectedLive = liveProjects.reduce((s, p) => s + Number(p.fundsCollected || 0), 0);
  const totalPaidSpendLive = liveProjects.reduce((s, p) => s + Number(p.paidExpenses || 0), 0);

  console.log('\n====================================================================');
  console.log(' PANEL DEFENSE SEED COMPLETE — SUMMARY');
  console.log('====================================================================');
  console.log(`  Active Projects Seeded : ${liveProjects.length} | Total Contract Value: ₱${totalContract.toLocaleString()}`);
  for (const lp of liveProjects) {
    console.log(`    - ${lp.name} (${lp.id}): Budget ₱${Number(lp.budget).toLocaleString()} | Collected ₱${Number(lp.fundsCollected).toLocaleString()} | Paid Spend ₱${Number(lp.paidExpenses).toLocaleString()} (Labor ₱${Number(lp.paidLaborExpenses).toLocaleString()} + Subcon ₱${Number(lp.paidSubcontractorExpenses).toLocaleString()}) | BOM Phases: ${lp.bomPhasesCount}`);
  }
  console.log(`  Master Gantt Tasks     : ${totalGanttTasks} tasks across 3 projects`);
  console.log(`  Workforce Personnel    : ${seededWorkers.length} (13 assigned incl. 1 dual-site MEP, 5 unassigned pool, 2 executives)`);
  console.log(`  DTR Entries (Nov 16-21): ${dtrEntriesSeeded} verified entries ready for live Calculate Draft`);
  console.log(`  Payroll Archive        : 1 finalized run (Nov 9–14, 2026) | Total runs in DB: ${Array.isArray(vRuns.data) ? vRuns.data.length : 1}`);
  console.log(`  Progress Billing (AR)  : ${invCount} invoices | Total Collected: ₱${totalCollectedLive.toLocaleString()}`);
  console.log(`  Subcontractor AP       : ${Array.isArray(vSubcon.data) ? vSubcon.data.length : subconCount} invoices | Total Paid Spend: ₱${totalPaidSpendLive.toLocaleString()}`);
  console.log(`  Cash Advances (Vale)   : 2 active advances (₱500 & ₱1,000)`);
  console.log(`  Change Orders & Permits: ${Array.isArray(vCos.data) ? vCos.data.length : coCount} change orders, ${Array.isArray(vPermits.data) ? vPermits.data.length : permitCount} government permits`);
  console.log(`  Live API Smoke Check   : Projects=${vProj.status}, Workforce=${vWork.status}, DTR Roster=${vRoster.status} (${Array.isArray(vRoster.data) ? vRoster.data.length : 0} crew), Payroll Runs=${vRuns.status}`);
  console.log('====================================================================\n');
}

run().catch((err) => {
  console.error('SEED FAILED:', err);
  process.exit(1);
});
