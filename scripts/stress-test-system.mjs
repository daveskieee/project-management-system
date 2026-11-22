/**
 * Live Multi-Role E2E & Load Stress-Test Suite for LDM Construction PMS
 * Usage:
 *   node scripts/stress-test-system.mjs
 *   node scripts/stress-test-system.mjs --keep
 */

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const KEEP_DATA = process.argv.includes('--keep');
const TAG = '[STRESS_TEST]';

const ACCOUNTS = {
  ADMIN_OM: { label: 'Admin / OM', email: 'om@ldmconstruction.ph', password: 'admin123' },
  PM: { label: 'Project Manager', email: 'pm@ldmconstruction.ph', password: 'pm123' },
  TIMEKEEPER: { label: 'Site Timekeeper', email: 'timekeeper@ldmconstruction.ph', password: 'tk123' },
  FINANCE: { label: 'Finance', email: 'finance@ldmconstruction.ph', password: 'finance123' },
};

const metrics = {
  projectList: [],
  ganttBulkLoad: [],
  ganttRead: [],
  workforceDir: [],
  dtrRoster: [],
  payrollCalc: [],
};

const results = [];
function record(category, name, passed, details = '') {
  results.push({ category, name, passed: Boolean(passed), details });
  const icon = passed ? 'PASS' : 'FAIL';
  console.log(`[${icon}] [${category}] ${name}${details ? ` — ${details}` : ''}`);
}

class RoleClient {
  constructor(roleKey, creds) {
    this.roleKey = roleKey;
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
        const k = pair.slice(0, eqIdx).trim();
        const v = pair.slice(eqIdx + 1).trim();
        this.cookies.set(k, v);
      }
    }
  }

  _cookieHeader() {
    return Array.from(this.cookies.entries()).map(([k, v]) => `${k}=${v}`).join('; ');
  }

  async req(method, path, body = undefined) {
    const headers = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const cookieStr = this._cookieHeader();
    if (cookieStr) headers['Cookie'] = cookieStr;
    if (this.csrfToken) headers['x-csrf-token'] = this.csrfToken;
    if (this.bearer) headers['Authorization'] = `Bearer ${this.bearer}`;

    const t0 = performance.now();
    const res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const ms = +(performance.now() - t0).toFixed(1);
    this._storeCookies(res);
    const text = await res.text();
    let data = null;
    try { data = JSON.parse(text); } catch { data = text; }
    return { status: res.status, ok: res.ok, data, ms };
  }

  async login() {
    const csrfRes = await this.req('GET', '/api/auth/csrf');
    if (csrfRes.data?.csrfToken) this.csrfToken = csrfRes.data.csrfToken;
    const loginRes = await this.req('POST', '/api/auth/login', {
      email: this.creds.email,
      password: this.creds.password,
    });
    if (!loginRes.ok) {
      throw new Error(`Login failed for ${this.creds.email}: HTTP ${loginRes.status} ${JSON.stringify(loginRes.data)}`);
    }
    if (loginRes.data?.csrfToken) this.csrfToken = loginRes.data.csrfToken;
    if (loginRes.data?.sessionToken || loginRes.data?.token) {
      this.bearer = loginRes.data.sessionToken || loginRes.data.token;
    }
    this.user = loginRes.data?.user || loginRes.data;
    // Refresh CSRF after login
    const csrf2 = await this.req('GET', '/api/auth/csrf');
    if (csrf2.data?.csrfToken) this.csrfToken = csrf2.data.csrfToken;
    return this.user;
  }
}

function summarizeMs(arr) {
  if (!arr.length) return { avg: 0, max: 0, count: 0 };
  const sum = arr.reduce((a, b) => a + b, 0);
  return { avg: +(sum / arr.length).toFixed(1), max: +Math.max(...arr).toFixed(1), count: arr.length };
}

function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

const createdProjectIds = [];
const createdWorkerIds = [];
const createdAdvanceIds = [];

async function cleanup(clients) {
  if (KEEP_DATA) {
    console.log(`\n[--keep] Preserving ${createdProjectIds.length} stress-test projects and ${createdWorkerIds.length} workers for browser inspection.`);
    return;
  }
  console.log(`\nCleaning up ${createdAdvanceIds.length} advances, ${createdWorkerIds.length} workers, ${createdProjectIds.length} projects...`);
  for (const advId of createdAdvanceIds) {
    await clients.FINANCE.req('DELETE', `/api/workers/cash-advances/${encodeURIComponent(advId)}`).catch(() => {});
  }
  for (const wId of createdWorkerIds) {
    await clients.ADMIN_OM.req('DELETE', `/api/workers/${encodeURIComponent(wId)}`).catch(() => {});
  }
  // Sweep any stray [STRESS_TEST] workers from interrupted runs
  const allW = await clients.ADMIN_OM.req('GET', '/api/workers').catch(() => null);
  if (allW?.ok && Array.isArray(allW.data)) {
    for (const w of allW.data) {
      if (String(w.name || '').includes(TAG)) {
        await clients.ADMIN_OM.req('DELETE', `/api/workers/${encodeURIComponent(w.id)}`).catch(() => {});
      }
    }
  }
  for (const pId of createdProjectIds) {
    await clients.ADMIN_OM.req('DELETE', `/api/projects/${encodeURIComponent(pId)}`).catch(() => {});
  }
  console.log('Cleanup complete.');
}

async function run() {
  console.log(`\n====================================================================`);
  console.log(` LDM Construction PMS — Live Multi-Role E2E & Load Stress-Test`);
  console.log(` Target: ${BASE_URL} | Cleanup: ${KEEP_DATA ? 'DISABLED (--keep)' : 'AUTO'}`);
  console.log(`====================================================================\n`);

  const clients = {
    ADMIN_OM: new RoleClient('ADMIN_OM', ACCOUNTS.ADMIN_OM),
    PM: new RoleClient('PM', ACCOUNTS.PM),
    TIMEKEEPER: new RoleClient('TIMEKEEPER', ACCOUNTS.TIMEKEEPER),
    FINANCE: new RoleClient('FINANCE', ACCOUNTS.FINANCE),
  };

  try {
    // 0. Authenticate all 4 real role sessions
    for (const [key, client] of Object.entries(clients)) {
      const u = await client.login();
      record('AUTH', `${ACCOUNTS[key].label} session login`, Boolean(u), `email=${ACCOUNTS[key].email}, role=${u?.role || 'OK'}`);
    }

    // ------------------------------------------------------------------
    // 1. SCALE & VOLUME BENCHMARK: 15 Projects, 60 Workers, 225+ Gantt Tasks
    // ------------------------------------------------------------------
    console.log('\n--- 1. Scale & Volume Seeding (15 Projects, 60 Workers, 225 Gantt Tasks) ---');
    const nowStamp = Date.now().toString().slice(-5);

    for (let i = 1; i <= 15; i++) {
      const idx = String(i).padStart(2, '0');
      const res = await clients.ADMIN_OM.req('POST', '/api/projects', {
        name: `${TAG} Commercial Fit-Out Site ${idx}-${nowStamp}`,
        clientName: `${TAG} Client Corp ${idx}`,
        description: 'Stress test commercial build & architectural fit-out',
        location: i % 2 === 0 ? 'BGC, Taguig City' : 'Makati CBD',
        budget: 5000000 + i * 500000,
        startDate: '2026-11-01',
        targetHandoverDate: '2027-03-30',
        status: 'IN_PROGRESS',
      });
      if (!res.ok || !res.data?.id) {
        throw new Error(`Failed to create project ${i}: HTTP ${res.status} ${JSON.stringify(res.data)}`);
      }
      createdProjectIds.push(String(res.data.id));
    }
    record('SCALE', 'Seed 15 concurrent commercial projects', createdProjectIds.length === 15, `${createdProjectIds.length}/15 created`);

    // 60 Workers across trades (PM, Foreman, MEP, Architect, Laborers, CEO/COO)
    const tradeBlueprints = [
      { position: 'Project Manager / Site Engineer', rate: 1500 },
      { position: 'Site Foreman', rate: 1100 },
      { position: 'Lead Electrical & Mechanical Engineers', rate: 1350 },
      { position: 'Project Architect', rate: 1400 },
      { position: 'Master Carpenter & Mason', rate: 900 },
      { position: 'Finishing Painter & Tiler', rate: 850 },
      { position: 'General Construction Laborer', rate: 750 },
      { position: 'Chief Executive Officer (CEO)', rate: 2500 },
      { position: 'Chief Operating Officer (COO)', rate: 2200 },
    ];

    for (let i = 1; i <= 60; i++) {
      const bp = i <= 2
        ? tradeBlueprints[7 + (i - 1)] // 2 corporate execs (CEO/COO)
        : tradeBlueprints[(i - 3) % 7];
      const idx = String(i).padStart(2, '0');
      const dailyRate = bp.rate;
      const hourlyOtRate = round2((dailyRate / 8) * 1.25);
      const res = await clients.ADMIN_OM.req('POST', '/api/workers', {
        first_name: `${TAG} Worker`,
        last_name: `${idx}-${nowStamp}`,
        name: `${TAG} Worker ${idx}-${nowStamp}`,
        position: bp.position,
        trade: bp.position,
        daily_rate: dailyRate,
        hourly_ot_rate: hourlyOtRate,
        status: 'Active',
      });
      const createdWorkerId = res.data?.id || res.data?.worker?.id || res.data?.workers?.[0]?.id;
      if (!res.ok || !createdWorkerId) {
        throw new Error(`Failed to create worker ${i}: HTTP ${res.status} ${JSON.stringify(res.data)}`);
      }
      createdWorkerIds.push(String(createdWorkerId));
    }
    record('SCALE', 'Seed 60 multi-trade workers', createdWorkerIds.length === 60, `${createdWorkerIds.length}/60 created`);

    // Bulk-load 15 Gantt tasks per project (225 tasks total) as PM
    let totalTasksInserted = 0;
    for (let pIdx = 0; pIdx < createdProjectIds.length; pIdx++) {
      const pid = createdProjectIds[pIdx];
      const tasks = [];
      for (let t = 1; t <= 15; t++) {
        const dayOffset = (t - 1) * 3;
        const sDate = new Date(2026, 10, 2 + dayOffset);
        const eDate = new Date(2026, 10, 4 + dayOffset);
        const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        tasks.push({
          id: `st-tsk-${pid}-${t}-${nowStamp}`,
          wbsCode: `${t}.0`,
          text: `${TAG} WBS Task ${t} (Site ${pIdx + 1})`,
          startDate: fmt(sDate),
          endDate: fmt(eDate),
          duration: t === 15 ? 0 : 3,
          progress: 0,
          type: t === 15 ? 'milestone' : 'task',
          sortOrder: t,
          milestonePhase: 'Structural & Concrete Works',
        });
      }
      const syncRes = await clients.PM.req('POST', `/api/projects/${encodeURIComponent(pid)}/gantt/sync`, {
        tasks,
        links: [],
      });
      metrics.ganttBulkLoad.push(syncRes.ms);
      if (!syncRes.ok || !Array.isArray(syncRes.data?.data) || syncRes.data.data.length < 15) {
        throw new Error(`Gantt bulk sync failed for ${pid}: HTTP ${syncRes.status} ${JSON.stringify(syncRes.data)}`);
      }
      totalTasksInserted += syncRes.data.data.length;
    }
    record('SCALE', 'Bulk-load 225 Gantt tasks (15 × 15 projects)', totalTasksInserted === 225, `${totalTasksInserted} tasks persisted in PostgreSQL`);

    // Benchmark reads under load
    for (let k = 0; k < 5; k++) {
      const pRes = await clients.PM.req('GET', '/api/projects');
      if (pRes.ok) metrics.projectList.push(pRes.ms);
      const gRes = await clients.PM.req('GET', `/api/projects/${encodeURIComponent(createdProjectIds[k])}/gantt`);
      if (gRes.ok) metrics.ganttRead.push(gRes.ms);
      const wRes = await clients.PM.req('GET', '/api/contractors-list');
      if (wRes.ok) metrics.workforceDir.push(wRes.ms);
    }

    // ------------------------------------------------------------------
    // 2. FULL OPERATIONAL & FINANCIAL LIFECYCLE (ZERO MATH TOLERANCE)
    // ------------------------------------------------------------------
    console.log('\n--- 2. Full Operational & Financial Lifecycle ---');
    const primaryProjectId = createdProjectIds[0];
    const secondaryProjectId = createdProjectIds[1];

    // PM assigns 4 workers to Project 1 (indices 2..5: PM, Foreman, MEP, Architect) + 1 worker to Project 2 (index 6)
    const assignedToProj1 = [
      { id: createdWorkerIds[2], rate: 1500, label: 'PM' },
      { id: createdWorkerIds[3], rate: 1100, label: 'Foreman' },
      { id: createdWorkerIds[4], rate: 1350, label: 'MEP' },
      { id: createdWorkerIds[5], rate: 1400, label: 'Architect' },
    ];
    const conflictWorker = { id: createdWorkerIds[6], rate: 900, label: 'Laborer (Conflict Override)' };
    const unassignedWorkerId = createdWorkerIds[10]; // Never assigned to any project

    for (const w of assignedToProj1) {
      const r = await clients.PM.req('PUT', `/api/projects/${encodeURIComponent(primaryProjectId)}/workers`, {
        workerId: w.id,
        action: 'add',
        allocationSource: 'Manual',
      });
      if (!r.ok) throw new Error(`PM assign failed for ${w.id}: HTTP ${r.status} ${JSON.stringify(r.data)}`);
    }

    // Assign conflictWorker to Project 2 first, then override-assign to Project 1
    const rInit = await clients.PM.req('PUT', `/api/projects/${encodeURIComponent(secondaryProjectId)}/workers`, {
      workerId: conflictWorker.id,
      action: 'add',
      allocationSource: 'Manual',
    });
    const rOverride = await clients.PM.req('PUT', `/api/projects/${encodeURIComponent(primaryProjectId)}/workers`, {
      workerId: conflictWorker.id,
      action: 'add',
      allocationSource: 'Manual',
      manualOverrideNote: 'Critical-Path Recovery',
      isLockedByAdmin: true,
    });
    record(
      'PM',
      'Assign crew + Dual-Site Conflict Override',
      rInit.ok && rOverride.ok,
      `5 workers assigned to ${primaryProjectId} (conflict override applied)`
    );

    // Verify Gantt reload persistence on Project 1
    const ganttReload = await clients.PM.req('GET', `/api/projects/${encodeURIComponent(primaryProjectId)}/gantt`);
    record(
      'PM',
      'Gantt template tasks persist across reload',
      ganttReload.ok && Array.isArray(ganttReload.data?.data) && ganttReload.data.data.length === 15,
      `${ganttReload.data?.data?.length || 0} tasks loaded from DB`
    );

    // Verify Timekeeper DTR Roster strictly returns ONLY the 5 assigned workers (never unassignedWorkerId)
    const rosterRes = await clients.TIMEKEEPER.req('GET', `/api/attendance/roster?projectId=${encodeURIComponent(primaryProjectId)}&status=Active`);
    metrics.dtrRoster.push(rosterRes.ms);
    const rosterIds = Array.isArray(rosterRes.data) ? rosterRes.data.map((w) => String(w.id)) : [];
    const rosterClean = rosterRes.ok && !rosterIds.includes(unassignedWorkerId) && assignedToProj1.every((w) => rosterIds.includes(w.id));
    record(
      'TIMEKEEPER',
      'DTR Roster excludes Unassigned workers & matches assigned site crew',
      rosterClean,
      `rosterCount=${rosterIds.length}, unassignedIncluded=${rosterIds.includes(unassignedWorkerId)}`
    );

    // Timekeeper attempts to log DTR for Unassigned worker -> MUST BE REJECTED
    const badDtrRes = await clients.TIMEKEEPER.req('POST', '/api/attendance', {
      projectId: primaryProjectId,
      date: '2026-11-16',
      records: [{ workerId: unassignedWorkerId, status: 'PRESENT', overtimeHours: 0 }],
    });
    record(
      'TIMEKEEPER',
      'Reject DTR submission for Unassigned worker',
      !badDtrRes.ok && (badDtrRes.status === 400 || badDtrRes.status === 403),
      `HTTP ${badDtrRes.status}`
    );

    // Timekeeper logs a full 6-day workweek (Mon Nov 16 - Sat Nov 21, 2026)
    // Worker 0 (rate 1500): 6 PRESENT, 0 OT -> 6.0 days, 0h OT
    // Worker 1 (rate 1100): 5 PRESENT (2h OT on Mon & Wed = 4h OT) + 1 HALF_DAY -> 5.5 days, 4h OT
    // Worker 2 (rate 1350): 4 PRESENT (2h OT on Tue = 2h OT) + 1 HALF_DAY + 1 ABSENT -> 4.5 days, 2h OT
    // Worker 3 (rate 1400): 6 PRESENT, 0 OT (with ₱500 Vale) -> 6.0 days, 0h OT, Vale 500
    // Worker 4 (conflictWorker, rate 900): 5 PRESENT (1h OT on Fri) + 1 ABSENT -> 5.0 days, 1h OT
    const cycleDates = ['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20', '2026-11-21'];
    const allCycleWorkers = [...assignedToProj1, conflictWorker];
    const scheduleMatrix = [
      // Mon..Sat per worker
      [
        { status: 'PRESENT', ot: 0 }, { status: 'PRESENT', ot: 0 }, { status: 'PRESENT', ot: 0 },
        { status: 'PRESENT', ot: 0 }, { status: 'PRESENT', ot: 0 }, { status: 'PRESENT', ot: 0 },
      ],
      [
        { status: 'PRESENT', ot: 2 }, { status: 'PRESENT', ot: 0 }, { status: 'PRESENT', ot: 2 },
        { status: 'PRESENT', ot: 0 }, { status: 'PRESENT', ot: 0 }, { status: 'HALF_DAY', ot: 0 },
      ],
      [
        { status: 'PRESENT', ot: 0 }, { status: 'PRESENT', ot: 2 }, { status: 'PRESENT', ot: 0 },
        { status: 'PRESENT', ot: 0 }, { status: 'HALF_DAY', ot: 0 }, { status: 'ABSENT', ot: 0 },
      ],
      [
        { status: 'PRESENT', ot: 0 }, { status: 'PRESENT', ot: 0 }, { status: 'PRESENT', ot: 0 },
        { status: 'PRESENT', ot: 0 }, { status: 'PRESENT', ot: 0 }, { status: 'PRESENT', ot: 0 },
      ],
      [
        { status: 'PRESENT', ot: 0 }, { status: 'PRESENT', ot: 0 }, { status: 'PRESENT', ot: 0 },
        { status: 'PRESENT', ot: 0 }, { status: 'PRESENT', ot: 1 }, { status: 'ABSENT', ot: 0 },
      ],
    ];

    let dtrDaysOk = 0;
    for (let dIdx = 0; dIdx < cycleDates.length; dIdx++) {
      const dateStr = cycleDates[dIdx];
      const records = allCycleWorkers.map((w, wIdx) => ({
        workerId: w.id,
        status: scheduleMatrix[wIdx][dIdx].status,
        overtimeHours: scheduleMatrix[wIdx][dIdx].ot,
      }));
      const postRes = await clients.TIMEKEEPER.req('POST', '/api/attendance', {
        projectId: primaryProjectId,
        date: dateStr,
        records,
      });
      if (postRes.ok) dtrDaysOk++;
      else console.error(`DTR post failed on ${dateStr}:`, postRes.status, postRes.data);
    }
    record('TIMEKEEPER', 'Log full 6-day workweek DTR (Present, Half-Day, OT, Absent)', dtrDaysOk === 6, `${dtrDaysOk}/6 days saved`);

    // Finance adds ₱500 cash advance (Vale) for Worker 3
    const valeAmount = 500;
    const advRes = await clients.FINANCE.req('POST', '/api/workers/cash-advances', {
      workerId: allCycleWorkers[3].id,
      projectId: primaryProjectId,
      amount: valeAmount,
      reason: `${TAG} Weekly Vale Test`,
    });
    const advId = advRes.data?.id || advRes.data?.advance?.id || advRes.data?.cashAdvance?.id;
    if (advRes.ok && advId) createdAdvanceIds.push(String(advId));
    record('FINANCE', 'Record ₱500 Cash Advance (Vale) for worker', advRes.ok, `HTTP ${advRes.status}`);

    // Finance calculates Weekly Site Payroll Draft
    const payRes = await clients.FINANCE.req('POST', '/api/payroll/calculate', {
      projectId: primaryProjectId,
      periodStart: cycleDates[0],
      periodEnd: cycleDates[5],
    });
    metrics.payrollCalc.push(payRes.ms);

    // Independent Ground-Truth Centavo Math Check
    let expectedTotalBase = 0;
    let expectedTotalOt = 0;
    let expectedTotalGross = 0;
    let expectedTotalVale = 0;
    let expectedTotalNet = 0;
    let mathMismatches = [];

    const draftObj = payRes.data?.draft || payRes.data || {};
    const apiItems = Array.isArray(draftObj.items) ? draftObj.items : [];
    for (let wIdx = 0; wIdx < allCycleWorkers.length; wIdx++) {
      const w = allCycleWorkers[wIdx];
      const sched = scheduleMatrix[wIdx];
      const days = sched.reduce((s, x) => s + (x.status === 'PRESENT' ? 1 : x.status === 'HALF_DAY' ? 0.5 : 0), 0);
      const otHrs = sched.reduce((s, x) => s + x.ot, 0);
      const otRate = round2((w.rate / 8) * 1.25);
      const base = round2(days * w.rate);
      const otPay = round2(otHrs * otRate);
      const gross = round2(base + otPay);
      const vale = wIdx === 3 && advRes.ok ? valeAmount : 0;
      const net = round2(Math.max(0, gross - vale));

      expectedTotalBase = round2(expectedTotalBase + base);
      expectedTotalOt = round2(expectedTotalOt + otPay);
      expectedTotalGross = round2(expectedTotalGross + gross);
      expectedTotalVale = round2(expectedTotalVale + vale);
      expectedTotalNet = round2(expectedTotalNet + net);

      const row = apiItems.find((it) => String(it.workerId) === String(w.id));
      if (!row) {
        mathMismatches.push(`${w.label} missing from payroll items`);
        continue;
      }
      const actBase = round2(row.basePay);
      const actOt = round2(row.otPay);
      const actGross = round2(row.grossPay);
      const actNet = round2(row.netPay);
      if ([actBase, actOt, actGross, actNet].some((v) => Number.isNaN(v))) {
        mathMismatches.push(`${w.label} produced NaN`);
      } else if (
        Math.abs(actBase - base) > 0.01 ||
        Math.abs(actOt - otPay) > 0.01 ||
        Math.abs(actGross - gross) > 0.01 ||
        Math.abs(actNet - net) > 0.01
      ) {
        mathMismatches.push(`${w.label}: expected Net ₱${net} (Base ₱${base}, OT ₱${otPay}), got Net ₱${actNet} (Base ₱${actBase}, OT ₱${actOt})`);
      }
    }

    const actualGrossTotal = round2(draftObj.totalGross ?? draftObj.totalGrossPay ?? draftObj.summary?.totalGross ?? NaN);
    const actualNetTotal = round2(draftObj.totalNet ?? draftObj.totalNetPay ?? draftObj.summary?.totalNet ?? NaN);
    const totalsExact =
      payRes.ok &&
      mathMismatches.length === 0 &&
      Math.abs(actualGrossTotal - expectedTotalGross) <= 0.01 &&
      Math.abs(actualNetTotal - expectedTotalNet) <= 0.01;

    record(
      'FINANCE',
      'Weekly Payroll Engine centavo-level accuracy (Zero Math Tolerance)',
      totalsExact,
      `Expected Gross ₱${expectedTotalGross.toFixed(2)} / Net ₱${expectedTotalNet.toFixed(2)} | Actual Gross ₱${actualGrossTotal.toFixed(2)} / Net ₱${actualNetTotal.toFixed(2)}${mathMismatches.length ? ' | MISMATCHES: ' + mathMismatches.join('; ') : ''}`
    );

    // ------------------------------------------------------------------
    // 3. STRICT RBAC SECURITY PENETRATION CHECKS (MUST RETURN 403)
    // ------------------------------------------------------------------
    console.log('\n--- 3. Strict RBAC Security Penetration Checks ---');
    const rbacChecks = [
      {
        name: 'OM blocked from PM worker allocation (PUT /api/projects/:id/workers)',
        exec: () => clients.ADMIN_OM.req('PUT', `/api/projects/${encodeURIComponent(primaryProjectId)}/workers`, { workerId: unassignedWorkerId, action: 'add' }),
      },
      {
        name: 'OM blocked from PM reallocation (POST /api/workforce/reallocate)',
        exec: () => clients.ADMIN_OM.req('POST', '/api/workforce/reallocate', { workerId: unassignedWorkerId, toProjectId: primaryProjectId }),
      },
      {
        name: 'OM blocked from submitting DTR (POST /api/attendance)',
        exec: () => clients.ADMIN_OM.req('POST', '/api/attendance', { projectId: primaryProjectId, date: '2026-11-16', records: [{ workerId: assignedToProj1[0].id, status: 'PRESENT', overtimeHours: 0 }] }),
      },
      {
        name: 'Finance blocked from submitting DTR (POST /api/attendance)',
        exec: () => clients.FINANCE.req('POST', '/api/attendance', { projectId: primaryProjectId, date: '2026-11-16', records: [{ workerId: assignedToProj1[0].id, status: 'PRESENT', overtimeHours: 0 }] }),
      },
      {
        name: 'PM blocked from finalizing payroll (POST /api/payroll/finalize)',
        exec: () => clients.PM.req('POST', '/api/payroll/finalize', { projectId: primaryProjectId, periodStart: cycleDates[0], periodEnd: cycleDates[5] }),
      },
      {
        name: 'Timekeeper blocked from finalizing payroll (POST /api/payroll/finalize)',
        exec: () => clients.TIMEKEEPER.req('POST', '/api/payroll/finalize', { projectId: primaryProjectId, periodStart: cycleDates[0], periodEnd: cycleDates[5] }),
      },
      {
        name: 'PM blocked from editing worker wage rates (PATCH /api/workers/:id)',
        exec: () => clients.PM.req('PATCH', `/api/workers/${encodeURIComponent(assignedToProj1[0].id)}`, { daily_rate: 9999 }),
      },
      {
        name: 'Timekeeper blocked from editing worker wage rates (PATCH /api/workers/:id)',
        exec: () => clients.TIMEKEEPER.req('PATCH', `/api/workers/${encodeURIComponent(assignedToProj1[0].id)}`, { daily_rate: 9999 }),
      },
    ];

    for (const chk of rbacChecks) {
      const r = await chk.exec();
      record('RBAC', chk.name, r.status === 403, `HTTP ${r.status}`);
    }

    // ------------------------------------------------------------------
    // 4. SUMMARY & BENCHMARK REPORT
    // ------------------------------------------------------------------
    console.log('\n====================================================================');
    console.log(' API LATENCY BENCHMARK (Under 15 Projects / 60 Workers / 225 Tasks)');
    console.log('====================================================================');
    const benchTable = [
      ['Project List (GET /api/projects)', summarizeMs(metrics.projectList)],
      ['Gantt Bulk Load (POST /gantt/sync x15)', summarizeMs(metrics.ganttBulkLoad)],
      ['Gantt Read (GET /gantt)', summarizeMs(metrics.ganttRead)],
      ['Workforce Directory (GET /contractors-list)', summarizeMs(metrics.workforceDir)],
      ['DTR Roster (GET /attendance/roster)', summarizeMs(metrics.dtrRoster)],
      ['Payroll Calculation (POST /payroll/calculate)', summarizeMs(metrics.payrollCalc)],
    ];
    for (const [label, s] of benchTable) {
      console.log(`  ${label.padEnd(46)} avg: ${String(s.avg).padStart(6)} ms | max: ${String(s.max).padStart(6)} ms (n=${s.count})`);
    }

    const passedCount = results.filter((r) => r.passed).length;
    const failedCount = results.length - passedCount;
    console.log('\n====================================================================');
    console.log(` TOTAL ASSERTIONS: ${passedCount}/${results.length} PASSED (${failedCount} FAILED)`);
    console.log('====================================================================\n');

    if (failedCount > 0) process.exitCode = 1;
  } finally {
    await cleanup(clients);
  }
}

run().catch((err) => {
  console.error('FATAL STRESS TEST ERROR:', err);
  process.exit(1);
});
