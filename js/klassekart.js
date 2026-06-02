/* Klassekart 2.0 — Copyright Benjamin Ensrud, 2026
 * Vanilla JS, no build step. State persists to localStorage.
 *   Phase 1: paste → chart → touch-first drag/drop.
 *   Phase 2: smart auto-arrange rules engine.
 *   Phase 3: multi-class management + history.
 *   Phase 4: present mode + export (PDF / PNG / print).
 */
(function () {
'use strict';

/* ---------------------------------------------------------------- constants */
const SEAT_W = 116, SEAT_H = 78; // must match CSS --seat-w / --seat-h
const GIN = 10;   // gap between desks inside a group (pair / pod)
const GBET = 46;  // horizontal gap between groups
const RGAP = 58;  // vertical gap between rows
const STORAGE_KEY = 'klassekart_v3';
const OLD_KEY = 'klassekart_v2';
const DRAG_THRESHOLD = 6;
const ADJ_DIST = (SEAT_W + GBET) * 1.15; // centre-distance counted as "next to each other"
const GRID_X = SEAT_W + GBET, GRID_Y = SEAT_H + RGAP; // snap step for manual desk editing
const PAIR_DX = SEAT_W + GIN;   // tight horizontal "pair" spacing (desks close together)
const SEP_DX = SEAT_W + GBET;   // separated horizontal spacing (normal gap between desks/pairs)
const PAIR_DY = SEAT_H + GIN;   // tight vertical pairing (stacked desks, e.g. 2×2 pods)
const SEP_DY = SEAT_H + RGAP;   // separated vertical spacing (normal gap between rows)
const PAIR_SNAP = 46;           // how close (board px) before snapping to a neighbour offset

/* ------------------------------------------------------------------- state  */
let store = null;          // { activeClassId, classes: { id: classObj } }
let state = null;          // active class (reference into store.classes)
let boardW = 0, boardH = 0;
let selected = null;       // studentId selected via tap
let drag = null;           // active pointer drag
let suppressClick = false; // ignore the click synthesized after a real drag
let presentMode = false;
let editMode = false;      // manual desk-editing mode
let deskDrag = null;       // active desk move/add in edit mode
let boardScale = 1;        // current CSS scale of the board (set by fitBoard)
let zoom = null;           // null = auto-fit; otherwise an explicit scale factor

let _seq = 0;
function uid() { return 's' + Date.now().toString(36) + (_seq++).toString(36); }
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const $ = (id) => document.getElementById(id);
const pairKey = (a, b) => (a < b ? a + '|' + b : b + '|' + a);

/* ----------------------------------------------------------- persistence    */
function save() {
    if (!store) return;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(store)); }
    catch (e) { console.error('save failed', e); }
}

/* ----------------------------------------------------------- undo / redo    */
/* Snapshots the desk arrangement + placement of the active class. Per-class,
 * session-only (reset when switching class / opening a class). */
let undoStack = [], redoStack = [];
const UNDO_LIMIT = 60;
function snapshot() {
    return JSON.stringify({
        seats: state.seats, assign: state.assign, locked: state.locked,
        room: state.room, roomMode: state.roomMode, roomParams: state.roomParams
    });
}
function pushUndo(snap) {
    if (!state) return;
    undoStack.push(snap || snapshot());
    if (undoStack.length > UNDO_LIMIT) undoStack.shift();
    redoStack.length = 0;
    updateUndoButtons();
}
function resetUndo() { undoStack = []; redoStack = []; updateUndoButtons(); }
function restoreSnapshot(snap) {
    const s = JSON.parse(snap);
    state.seats = s.seats; state.assign = s.assign; state.locked = s.locked;
    state.room = s.room; state.roomMode = s.roomMode; state.roomParams = s.roomParams;
    pruneInvalid();
}
function undo() {
    if (!undoStack.length) { toast('Ingenting å angre', 'err'); return; }
    redoStack.push(snapshot());
    restoreSnapshot(undoStack.pop());
    save(); render(); updateUndoButtons();
    toast('Angret ↩', 'ok');
}
function redo() {
    if (!redoStack.length) { toast('Ingenting å gjenta', 'err'); return; }
    undoStack.push(snapshot());
    restoreSnapshot(redoStack.pop());
    save(); render(); updateUndoButtons();
    toast('Gjentok ↪', 'ok');
}
function updateUndoButtons() {
    const u = $('undoBtn'), r = $('redoBtn');
    if (u) u.disabled = !undoStack.length;
    if (r) r.disabled = !redoStack.length;
}

function normStrength(v) { return v === 'must' || v === 'should' ? v : null; }
function normStudent(s) {
    // front/back are null | 'should' | 'must'; migrate the old boolean needsFront → soft front
    const front = normStrength(s.front) || (s.needsFront ? 'should' : null);
    const back = normStrength(s.back);
    return { id: s.id || uid(), name: s.name, gender: s.gender || null, front, back: front ? null : back, tags: s.tags || [] };
}
function normClass(c) {
    return {
        id: c.id || uid(),
        name: c.name || 'Klasse',
        room: c.room || 'pairs',
        roomMode: c.roomMode === 'custom' ? 'custom' : 'auto',
        roomParams: Object.assign({ rows: null, perRow: null, gapX: null, gapY: null }, c.roomParams || {}),
        students: (c.students || []).map(normStudent),
        seats: c.seats || [],
        assign: c.assign || {},
        locked: c.locked || [],
        rules: c.rules || [],
        prefs: Object.assign({ balanceGender: false, avoidRepeat: false }, c.prefs || {}),
        history: c.history || []
    };
}

function loadStore() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
            const s = JSON.parse(raw);
            if (s && s.classes) {
                store = s;
                for (const id in store.classes) store.classes[id] = normClass(store.classes[id]);
                if (!store.activeClassId || !store.classes[store.activeClassId]) {
                    store.activeClassId = Object.keys(store.classes)[0] || null;
                }
                store.roomTemplates = store.roomTemplates || [];
                return !!store.activeClassId;
            }
        }
        // migrate a Phase-1 single-class state if present
        const old = localStorage.getItem(OLD_KEY);
        if (old) {
            const c = normClass(JSON.parse(old));
            store = { activeClassId: c.id, classes: { [c.id]: c }, roomTemplates: [] };
            save();
            localStorage.removeItem(OLD_KEY);
            return true;
        }
    } catch (e) { console.error('load failed', e); }
    return false;
}

function setActiveClass(id) {
    if (!store.classes[id]) return;
    if (editMode) exitEditMode();
    zoom = null;
    resetUndo();
    store.activeClassId = id;
    state = store.classes[id];
    selected = null;
    save();
    $('classMenuBtn').firstChild.textContent = state.name + ' ';
    render();
}

/* -------------------------------------------------------- seat generators   */
/* opts may carry explicit overrides from a custom arrangement:
 *   cols / perRow  – force the grid width (desks-per-row or groups-per-row)
 *   gapX / gapY    – desk and row spacing (fall back to GBET / RGAP)         */
function genRows(n, opts) {
    opts = opts || {};
    const cols = opts.cols ? clamp(opts.cols, 1, 20) : clamp(Math.round(Math.sqrt(n * 1.7)), 1, 9);
    const gapX = opts.gapX != null ? opts.gapX : GBET;
    const gapY = opts.gapY != null ? opts.gapY : RGAP;
    const pitchX = SEAT_W + gapX, pitchY = SEAT_H + gapY;
    const fullW = cols * SEAT_W + (cols - 1) * gapX;
    const seats = [];
    const rowsN = Math.ceil(n / cols);
    for (let r = 0; r < rowsN; r++) {
        const inRow = Math.min(cols, n - r * cols);
        const rowW = inRow * SEAT_W + (inRow - 1) * gapX;
        const x0 = (fullW - rowW) / 2;
        for (let c = 0; c < inRow; c++) seats.push({ x: x0 + c * pitchX, y: r * pitchY });
    }
    return seats;
}
function genGroups(n, perGroup, gridCols, gridRows, opts) {
    opts = opts || {};
    const gapX = opts.gapX != null ? opts.gapX : GBET;
    const gapY = opts.gapY != null ? opts.gapY : RGAP;
    const groupW = gridCols * SEAT_W + (gridCols - 1) * GIN;
    const groupH = gridRows * SEAT_H + (gridRows - 1) * GIN;
    const groups = Math.ceil(n / perGroup);
    const perRow = opts.perRow ? clamp(opts.perRow, 1, 20)
        : clamp(Math.round(Math.sqrt(groups * (gridRows > 1 ? 1 : 1.3))), 1, gridRows > 1 ? 3 : 4);
    const pitchGroupX = groupW + gapX, pitchGroupY = groupH + gapY;
    const fullW = perRow * groupW + (perRow - 1) * gapX;
    const seats = [];
    let placed = 0;
    const groupRows = Math.ceil(groups / perRow);
    for (let gr = 0; gr < groupRows; gr++) {
        const groupsInRow = Math.min(perRow, groups - gr * perRow);
        const rowW = groupsInRow * groupW + (groupsInRow - 1) * gapX;
        const x0 = (fullW - rowW) / 2;
        for (let gc = 0; gc < groupsInRow; gc++) {
            const gx = x0 + gc * pitchGroupX, gy = gr * pitchGroupY;
            for (let sy = 0; sy < gridRows; sy++)
                for (let sx = 0; sx < gridCols; sx++) {
                    if (placed >= n) continue;
                    seats.push({ x: gx + sx * (SEAT_W + GIN), y: gy + sy * (SEAT_H + GIN) });
                    placed++;
                }
        }
    }
    return seats;
}
function genU(n) {
    const cols = clamp(Math.round(Math.sqrt(n)) + 1, 3, 9);
    const h = Math.max(1, Math.ceil((n - cols) / 2));
    const pitchX = SEAT_W + GBET, pitchY = SEAT_H + RGAP;
    const seats = [];
    for (let r = 0; r < h; r++) seats.push({ x: 0, y: r * pitchY });
    for (let c = 0; c < cols; c++) seats.push({ x: c * pitchX, y: h * pitchY });
    for (let r = h - 1; r >= 0; r--) seats.push({ x: (cols - 1) * pitchX, y: r * pitchY });
    return seats;
}
/* how many desks an explicit rows×perRow grid yields for a preset (unit size:
 * rows = 1 desk/unit, pairs = 2, pods = 4) */
function deskCountFor(preset, rows, perRow) {
    const unit = preset === 'pairs' ? 2 : preset === 'pods' ? 4 : 1;
    return clamp(rows | 0, 1, 20) * clamp(perRow | 0, 1, 20) * unit;
}
function generateSeats(preset, n, params) {
    n = Math.max(0, n | 0);
    params = params || {};
    const gaps = { gapX: params.gapX, gapY: params.gapY };
    const cols = params.perRow || null;
    let seats;
    if (n === 0) seats = [];
    else if (preset === 'rows') seats = genRows(n, Object.assign({ cols }, gaps));
    else if (preset === 'pairs') seats = genGroups(n, 2, 2, 1, Object.assign({ perRow: cols }, gaps));
    else if (preset === 'pods') seats = genGroups(n, 4, 2, 2, Object.assign({ perRow: cols }, gaps));
    else if (preset === 'u') seats = genU(n);
    else seats = genGroups(n, 2, 2, 1, gaps);
    if (seats.length) {
        const minX = Math.min(...seats.map(s => s.x));
        const minY = Math.min(...seats.map(s => s.y));
        seats.forEach(s => { s.x -= minX; s.y -= minY; });
    }
    return seats.map((s, i) => ({ id: 'seat' + i, x: s.x, y: s.y }));
}

/* -------------------------------------------------------- assignment model  */
function seatOfStudent(sid) {
    for (const seatId in state.assign) if (state.assign[seatId] === sid) return seatId;
    return null;
}
function studentById(sid) { return state.students.find(s => s.id === sid); }
function isLocked(sid) { return state.locked.indexOf(sid) !== -1; }

function placeStudent(sid, seatId) {
    if (isLocked(sid)) { toast('Eleven er låst – lås opp først', 'err'); return; }
    const cur = seatOfStudent(sid);
    const occ = state.assign[seatId] || null;
    if (occ && isLocked(occ)) { toast('Plassen er låst', 'err'); return; }
    if (cur === seatId) return; // no-op
    pushUndo();
    if (cur) delete state.assign[cur];
    if (occ && cur) state.assign[cur] = occ; // swap; otherwise occupant returns to pool
    state.assign[seatId] = sid;
    save(); render();
}
function unseat(sid) {
    if (isLocked(sid)) { toast('Eleven er låst – lås opp først', 'err'); return; }
    const cur = seatOfStudent(sid);
    if (!cur) return;
    pushUndo();
    delete state.assign[cur];
    save(); render();
}
function toggleLock(sid) {
    const i = state.locked.indexOf(sid);
    if (i === -1 && !seatOfStudent(sid)) { toast('Plasser eleven før du låser', 'err'); return; }
    pushUndo();
    if (i === -1) state.locked.push(sid); else state.locked.splice(i, 1);
    save(); render();
}

function fillSeats(orderedIds) {
    // keep locked students where they are; fill the rest into remaining seats
    const fixed = {};
    state.locked.forEach(id => { const se = seatOfStudent(id); if (se) fixed[se] = id; });
    state.assign = Object.assign({}, fixed);
    const fixedStudents = new Set(Object.values(fixed));
    const freeSeats = state.seats.filter(s => !(s.id in fixed));
    const queue = orderedIds.filter(id => !fixedStudents.has(id));
    for (let i = 0; i < queue.length && i < freeSeats.length; i++) state.assign[freeSeats[i].id] = queue[i];
}

function shuffleSeating(silent) {
    pushUndo();
    const ids = state.students.map(s => s.id);
    for (let i = ids.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [ids[i], ids[j]] = [ids[j], ids[i]]; }
    fillSeats(ids);
    save(); render();
    if (!silent) toast(state.seats.length < ids.length ? 'Blandet – for få plasser til alle' : 'Blandet! 🎲', 'ok');
}

/* ---------------------------------------------------- room / roster changes */
function regenSeatsPreserve() {
    const seated = [...state.seats].filter(s => state.assign[s.id])
        .sort((a, b) => a.y - b.y || a.x - b.x).map(s => state.assign[s.id]);
    state.seats = generateSeats(state.room, state.students.length, state.roomParams);
    state.assign = {};
    seated.forEach((sid, i) => { if (state.seats[i]) state.assign[state.seats[i].id] = sid; });
}
/* params: { rows, perRow, gapX, gapY } — rows+perRow present ⇒ custom (fixed
 * desk count, decoupled from roster); otherwise auto (desk count = #students). */
function applyRoom(preset, keepSeats, params) {
    params = params || {};
    pushUndo();
    let seated = [];
    if (keepSeats) seated = [...state.seats].filter(s => state.assign[s.id])
        .sort((a, b) => a.y - b.y || a.x - b.x).map(s => state.assign[s.id]);
    const custom = !!(params.rows && params.perRow) && preset !== 'u';
    state.room = preset;
    state.roomMode = custom ? 'custom' : 'auto';
    state.roomParams = {
        rows: custom ? clamp(params.rows, 1, 20) : null,
        perRow: custom ? clamp(params.perRow, 1, 20) : null,
        gapX: params.gapX != null ? params.gapX : null,
        gapY: params.gapY != null ? params.gapY : null
    };
    const n = custom ? deskCountFor(preset, state.roomParams.rows, state.roomParams.perRow)
                     : state.students.length;
    state.seats = generateSeats(preset, n, state.roomParams);
    state.assign = {};
    if (keepSeats) seated.forEach((sid, i) => { if (state.seats[i]) state.assign[state.seats[i].id] = sid; });
    save(); render();
}

function pruneInvalid() {
    const ids = new Set(state.students.map(s => s.id));
    for (const seatId in state.assign) if (!ids.has(state.assign[seatId])) delete state.assign[seatId];
    state.locked = state.locked.filter(id => ids.has(id));
    state.rules = state.rules.filter(r => ids.has(r.a) && (r.b == null || ids.has(r.b)));
}

/* ----------------------------------------------------------- adjacency      */
function computeAdjacency(seats) {
    const adj = {}; const edges = [];
    seats.forEach(s => { adj[s.id] = []; });
    for (let i = 0; i < seats.length; i++) {
        for (let j = i + 1; j < seats.length; j++) {
            const a = seats[i], b = seats[j];
            const dx = (a.x - b.x), dy = (a.y - b.y);
            if (Math.hypot(dx, dy) <= ADJ_DIST) {
                adj[a.id].push(b.id); adj[b.id].push(a.id);
                edges.push([a.id, b.id]);
            }
        }
    }
    return { adj, edges };
}

/* -------------------------------------------------- smart arrange (Phase 2) */
function buildContext() {
    const { adj, edges } = computeAdjacency(state.seats);
    const ys = state.seats.map(s => s.y);
    const minY = ys.length ? Math.min(...ys) : 0;
    const maxY = ys.length ? Math.max(...ys) : 0;
    const seatById = {}; state.seats.forEach(s => seatById[s.id] = s);
    // apart: pairKey -> strongest strength ('must' wins). together: {a,b,strength}
    const apart = new Map(), together = [];
    state.rules.forEach(r => {
        const st = normStrength(r.strength) || 'must'; // old rules had no strength = hard
        if (r.type === 'apart') {
            const k = pairKey(r.a, r.b);
            apart.set(k, apart.get(k) === 'must' || st === 'must' ? 'must' : 'should');
        } else if (r.type === 'together') together.push({ a: r.a, b: r.b, strength: st });
    });
    const genderOf = {}; const placeWants = []; // {id, side:'front'|'back', strength}
    state.students.forEach(s => {
        genderOf[s.id] = s.gender;
        if (s.front) placeWants.push({ id: s.id, side: 'front', strength: s.front });
        if (s.back) placeWants.push({ id: s.id, side: 'back', strength: s.back });
    });
    let prevPairs = new Set();
    if (state.prefs.avoidRepeat && state.history.length) {
        const snap = state.history[0];
        const seatsP = snap.seats || state.seats;
        const { edges: pe } = computeAdjacency(seatsP);
        pe.forEach(([s1, s2]) => {
            const a = snap.assign[s1], b = snap.assign[s2];
            if (a && b) prevPairs.add(pairKey(a, b));
        });
    }
    return { adj, edges, minY, maxY, seatById, apart, together, genderOf, placeWants, prevPairs, prefs: state.prefs };
}

function scoreAssign(assign, ctx) {
    let score = 0;
    const seatOf = {};
    for (const seatId in assign) seatOf[assign[seatId]] = seatId;
    // adjacency-driven costs
    for (const [s1, s2] of ctx.edges) {
        const a = assign[s1], b = assign[s2];
        if (!a || !b) continue;
        const k = pairKey(a, b);
        const apartSt = ctx.apart.get(k);
        if (apartSt) score += apartSt === 'must' ? 1000 : 30;
        if (ctx.prefs.balanceGender && ctx.genderOf[a] && ctx.genderOf[b] && ctx.genderOf[a] === ctx.genderOf[b]) score += 4;
        if (ctx.prefs.avoidRepeat && ctx.prevPairs.has(k)) score += 10;
    }
    // together pairs
    for (const t of ctx.together) {
        const sa = seatOf[t.a], sb = seatOf[t.b];
        const ok = sa && sb && ctx.adj[sa].indexOf(sb) !== -1;
        if (!ok) score += t.strength === 'must' ? 200 : 30;
    }
    // near-front / near-back wishes (distance from the wished edge, weighted by strength)
    for (const w of ctx.placeWants) {
        const se = seatOf[w.id];
        if (!se) { score += w.strength === 'must' ? 200 : 60; continue; }
        const y = ctx.seatById[se].y;
        const dist = w.side === 'front' ? (y - ctx.minY) : (ctx.maxY - y);
        score += dist * (w.strength === 'must' ? 1.0 : 0.25);
    }
    return score;
}

function smartArrange(silent) {
    if (!state.seats.length || !state.students.length) { toast('Ingen elever å plassere', 'err'); return; }
    pushUndo();
    const ctx = buildContext();
    const fixed = {};
    state.locked.forEach(id => { const se = seatOfStudent(id); if (se) fixed[se] = id; });
    const fixedStudents = new Set(Object.values(fixed));
    const freeSeatIds = state.seats.filter(s => !(s.id in fixed)).map(s => s.id);
    const freeStudents = state.students.map(s => s.id).filter(id => !fixedStudents.has(id));

    const RESTARTS = 9, ITERS = 1400;
    let best = null, bestScore = Infinity;

    for (let r = 0; r < RESTARTS; r++) {
        const assign = Object.assign({}, fixed);
        const pool = freeStudents.slice();
        for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
        for (let i = 0; i < freeSeatIds.length; i++) if (i < pool.length) assign[freeSeatIds[i]] = pool[i];
        let curScore = scoreAssign(assign, ctx);
        let T = 6;
        for (let it = 0; it < ITERS; it++) {
            if (freeSeatIds.length < 2) break;
            const p = freeSeatIds[Math.floor(Math.random() * freeSeatIds.length)];
            const q = freeSeatIds[Math.floor(Math.random() * freeSeatIds.length)];
            if (p === q) continue;
            const av = assign[p], bv = assign[q];
            if (av === undefined && bv === undefined) continue;
            if (av === undefined) delete assign[p]; else assign[p] = bv;
            if (bv === undefined) delete assign[q]; else assign[q] = av;
            const sc = scoreAssign(assign, ctx);
            if (sc <= curScore || Math.random() < Math.exp((curScore - sc) / T)) {
                curScore = sc;
            } else { // revert
                if (av === undefined) delete assign[p]; else assign[p] = av;
                if (bv === undefined) delete assign[q]; else assign[q] = bv;
            }
            T *= 0.997;
        }
        if (curScore < bestScore) { bestScore = curScore; best = Object.assign({}, assign); }
    }
    state.assign = best;
    save(); render();
    if (!silent) explainResult(ctx);
}

function explainResult(ctx) {
    const assign = state.assign;
    const seatOf = {}; for (const seatId in assign) seatOf[assign[seatId]] = seatId;
    const adjacentNow = new Set();
    for (const [s1, s2] of ctx.edges) { const a = assign[s1], b = assign[s2]; if (a && b) adjacentNow.add(pairKey(a, b)); }
    const lines = [];
    let problems = 0;

    // "problems" counts only hard (Må) violations — those decide the headline / modal.
    if (ctx.apart.size) {
        let total = 0, satisfied = 0, mustViol = 0;
        ctx.apart.forEach((st, k) => { total++; if (!adjacentNow.has(k)) satisfied++; else if (st === 'must') mustViol++; });
        problems += mustViol;
        lines.push(rowLine(mustViol === 0, `${satisfied}/${total} «hold fra hverandre» oppfylt`));
    }
    if (ctx.together.length) {
        let ok = 0, mustViol = 0;
        ctx.together.forEach(t => {
            const sa = seatOf[t.a], sb = seatOf[t.b];
            const good = sa && sb && ctx.adj[sa].indexOf(sb) !== -1;
            if (good) ok++; else if (t.strength === 'must') mustViol++;
        });
        problems += mustViol;
        lines.push(rowLine(mustViol === 0, `${ok}/${ctx.together.length} «sitte sammen» oppfylt`));
    }
    if (ctx.placeWants.length) {
        const band = (SEAT_H + RGAP) * 1.2;
        let ok = 0, mustViol = 0;
        ctx.placeWants.forEach(w => {
            const se = seatOf[w.id]; let good = false;
            if (se) { const y = ctx.seatById[se].y; good = w.side === 'front' ? (y <= ctx.minY + band) : (y >= ctx.maxY - band); }
            if (good) ok++; else if (w.strength === 'must') mustViol++;
        });
        problems += mustViol;
        lines.push(rowLine(mustViol === 0, `${ok}/${ctx.placeWants.length} «foran/bak» oppfylt`));
    }
    if (ctx.prefs.balanceGender) {
        let same = 0, tot = 0;
        for (const [s1, s2] of ctx.edges) { const a = assign[s1], b = assign[s2]; if (a && b && ctx.genderOf[a] && ctx.genderOf[b]) { tot++; if (ctx.genderOf[a] === ctx.genderOf[b]) same++; } }
        lines.push(rowLine(same === 0, `Kjønnsbalanse: ${tot - same}/${tot} naborelasjoner blandet`));
    }
    if (ctx.prefs.avoidRepeat && ctx.prevPairs.size) {
        let rep = 0; adjacentNow.forEach(k => { if (ctx.prevPairs.has(k)) rep++; });
        lines.push(rowLine(rep === 0, `${rep} gjentatte naboer fra forrige kart`));
    }
    if (!lines.length) lines.push(rowLine(true, 'Plasserte elevene tilfeldig (ingen regler satt enda)'));

    const headline = problems === 0 ? 'Alt gikk opp! 🎯' : 'Beste mulige plassering — noe kolliderte:';
    $('resultsBody').innerHTML = `<p class="results-head">${headline}</p>` + lines.join('');
    if (problems > 0) { openModal('resultsModal'); }
    else toast('Smart plassering ✓ — alle regler oppfylt', 'ok');
}
function rowLine(ok, txt) {
    return `<div class="result-line ${ok ? 'ok' : 'warn'}"><span class="ri">${ok ? '✓' : '⚠'}</span>${escapeHtml(txt)}</div>`;
}

/* ----------------------------------------------------------------- render   */
function render() {
    renderBoard();
    renderPool();
    applySelection();
    updateSelBar();
}
function renderBoard() {
    const board = $('board');
    board.innerHTML = '';
    if (state.seats.length) {
        boardW = Math.max(...state.seats.map(s => s.x + SEAT_W));
        boardH = Math.max(...state.seats.map(s => s.y + SEAT_H));
    } else { boardW = SEAT_W; boardH = SEAT_H; }
    board.style.width = boardW + 'px';
    board.style.height = boardH + 'px';
    for (const seat of state.seats) {
        const seatEl = document.createElement('div');
        seatEl.className = 'seat';
        seatEl.style.left = seat.x + 'px';
        seatEl.style.top = seat.y + 'px';
        seatEl.dataset.seatId = seat.id;
        const sid = state.assign[seat.id];
        if (sid) {
            const stu = studentById(sid);
            if (stu) {
                seatEl.classList.add('occupied');
                if (stu.gender === 'G') seatEl.classList.add('g-boy');
                else if (stu.gender === 'J') seatEl.classList.add('g-girl');
                const tok = document.createElement('div');
                tok.className = 'token';
                tok.dataset.studentId = sid;
                const nm = document.createElement('span');
                nm.className = 'tok-name';
                nm.textContent = stu.name;
                tok.appendChild(nm);
                if (stu.front) tok.appendChild(badge('front' + (stu.front === 'must' ? ' must' : ''), '⬆'));
                if (stu.back) tok.appendChild(badge('back' + (stu.back === 'must' ? ' must' : ''), '⬇'));
                if (isLocked(sid)) tok.appendChild(badge('lock', '🔒'));
                seatEl.appendChild(tok);
            }
        }
        if (editMode) {
            const del = document.createElement('button');
            del.className = 'seat-del'; del.type = 'button'; del.title = 'Fjern pult';
            del.textContent = '✕';
            seatEl.appendChild(del);
        }
        board.appendChild(seatEl);
    }
    fitBoard();
}
function badge(cls, txt) {
    const b = document.createElement('span');
    b.className = 'tok-badge ' + cls;
    b.textContent = txt;
    return b;
}
function renderPool() {
    const list = $('poolList');
    list.innerHTML = '';
    const seated = new Set(Object.values(state.assign));
    const unseated = state.students.filter(s => !seated.has(s.id));
    for (const stu of unseated) {
        const chip = document.createElement('div');
        chip.className = 'chip';
        chip.dataset.studentId = stu.id;
        if (stu.gender === 'G') chip.classList.add('g-boy');
        else if (stu.gender === 'J') chip.classList.add('g-girl');
        chip.textContent = stu.name;
        if (stu.front) chip.appendChild(badge('front', '⬆'));
        if (stu.back) chip.appendChild(badge('back', '⬇'));
        list.appendChild(chip);
    }
    $('poolCount').textContent = unseated.length;
    $('pool').classList.toggle('is-empty', unseated.length === 0);
}
const ZOOM_MIN = 0.2, ZOOM_MAX = 3;
function fitBoard() {
    const stage = $('stage');
    const front = $('boardFront');
    const barPad = editMode ? 104 : 0; // keep the edit toolbar from covering the bottom row
    const availW = stage.clientWidth - 36;
    const availH = stage.clientHeight - front.offsetHeight - 52 - barPad;
    const maxScale = presentMode ? 3 : 1.5;
    let autoScale = Math.min(availW / boardW, availH / boardH, maxScale);
    if (!isFinite(autoScale) || autoScale <= 0) autoScale = 1;
    autoScale = Math.max(autoScale, ZOOM_MIN);
    const scale = zoom != null ? clamp(zoom, ZOOM_MIN, ZOOM_MAX) : autoScale;
    boardScale = scale;
    const board = $('board'), wrap = $('boardWrap');
    board.style.transformOrigin = 'top left';
    board.style.transform = 'scale(' + scale + ')';
    wrap.style.width = (boardW * scale) + 'px';
    wrap.style.height = (boardH * scale) + 'px';
    // scroll slack so a zoomed-in last row can be brought above the edit bar
    wrap.style.marginBottom = editMode ? '108px' : '';
    updateZoomLabel();
}
function setZoom(z) {
    zoom = z == null ? null : clamp(z, ZOOM_MIN, ZOOM_MAX);
    fitBoard();
}
function zoomBy(factor) { setZoom(clamp((boardScale || 1) * factor, ZOOM_MIN, ZOOM_MAX)); }
function updateZoomLabel() {
    const el = $('zoomLabel');
    if (el) el.textContent = Math.round((boardScale || 1) * 100) + '%';
}
function applySelection() {
    document.querySelectorAll('.selected').forEach(el => el.classList.remove('selected'));
    if (!selected) return;
    document.querySelectorAll('[data-student-id]').forEach(el => { if (el.dataset.studentId === selected) el.classList.add('selected'); });
}
function setSelected(sid) { selected = sid; applySelection(); updateSelBar(); }
function updateSelBar() {
    const bar = $('selBar');
    if (!selected || presentMode) { bar.classList.add('hidden'); return; }
    const stu = studentById(selected);
    if (!stu) { bar.classList.add('hidden'); return; }
    $('selName').textContent = stu.name;
    const seated = !!seatOfStudent(selected);
    $('selLockBtn').textContent = isLocked(selected) ? '🔓 Lås opp' : '🔒 Lås plass';
    $('selLockBtn').style.display = seated ? '' : 'none';
    $('selPoolBtn').style.display = seated ? '' : 'none';
    bar.classList.remove('hidden');
}

/* ------------------------------------------------------- drag & drop (ptr)  */
function onPointerDown(e) {
    suppressClick = false;
    if (e.button && e.button !== 0) return;
    if (editMode) { onEditPointerDown(e); return; }
    const el = e.target.closest('.token, .chip');
    if (!el) return;
    drag = { sid: el.dataset.studentId, el, startX: e.clientX, startY: e.clientY, moved: false, ghost: null };
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
}
function onPointerMove(e) {
    if (!drag) return;
    if (!drag.moved) {
        if (Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) < DRAG_THRESHOLD) return;
        if (isLocked(drag.sid)) { drag = null; cleanupDragListeners(); return; }
        drag.moved = true;
        const stu = studentById(drag.sid);
        const ghost = document.createElement('div');
        ghost.className = 'drag-ghost';
        ghost.textContent = stu ? stu.name : '';
        document.body.appendChild(ghost);
        drag.ghost = ghost;
        drag.el.style.opacity = '0.3';
    }
    drag.ghost.style.left = e.clientX + 'px';
    drag.ghost.style.top = e.clientY + 'px';
    highlightDrop(e.clientX, e.clientY);
}
function onPointerUp(e) {
    cleanupDragListeners();
    if (!drag) return;
    if (drag.moved) {
        const target = dropTargetAt(e.clientX, e.clientY);
        clearDropHighlight();
        if (drag.ghost) drag.ghost.remove();
        const sid = drag.sid; drag = null; suppressClick = true;
        if (target && target.type === 'seat') placeStudent(sid, target.seatId);
        else if (target && target.type === 'pool') unseat(sid);
        else render();
    } else { drag = null; }
}
function cleanupDragListeners() {
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('pointercancel', onPointerUp);
}
function dropTargetAt(x, y) {
    const el = document.elementFromPoint(x, y);
    if (!el) return null;
    const seat = el.closest('.seat');
    if (seat) return { type: 'seat', seatId: seat.dataset.seatId };
    if (el.closest('#pool')) return { type: 'pool' };
    return null;
}
function highlightDrop(x, y) {
    clearDropHighlight();
    const t = dropTargetAt(x, y);
    if (!t) return;
    if (t.type === 'seat') { const s = document.querySelector('.seat[data-seat-id="' + t.seatId + '"]'); if (s) s.classList.add('drop-hover'); }
    else if (t.type === 'pool') $('pool').classList.add('drop-hover');
}
function clearDropHighlight() { document.querySelectorAll('.drop-hover').forEach(el => el.classList.remove('drop-hover')); }

/* --------------------------------------------------- manual desk editing    */
function newSeatId() { return 'seat_' + uid(); }
function clientToBoard(cx, cy) {
    const rect = $('board').getBoundingClientRect();
    const s = boardScale || 1;
    return { x: (cx - rect.left) / s, y: (cy - rect.top) / s };
}
function snap(v, step) { return Math.round(v / step) * step; }
/* per-axis snap: lands on the lattice, but if the desk is dragged close to a
 * neighbour in the same row/column it clicks into a tidy pair gap or separation
 * gap — this is how you build "pairs with a gap between" in either direction.
 *   raw      – the raw board coordinate on this axis
 *   crossVal – the (already snapped) coordinate on the other axis
 *   axis     – 'x' or 'y'                                                      */
function snapEditAxis(raw, crossVal, axis, selfId) {
    const horiz = axis === 'x';
    const step = horiz ? GRID_X : GRID_Y;
    const crossStep = horiz ? GRID_Y : GRID_X;
    const pair = horiz ? PAIR_DX : PAIR_DY;
    const sep = horiz ? SEP_DX : SEP_DY;
    let n = snap(raw, step);
    let best = Math.abs(n - raw);
    for (const s of state.seats) {
        if (s.id === selfId) continue;
        const sCross = horiz ? s.y : s.x;
        if (Math.abs(sCross - crossVal) > crossStep * 0.5) continue; // same row/column band
        const sMain = horiz ? s.x : s.y;
        for (const cand of [sMain + pair, sMain - pair, sMain + sep, sMain - sep]) {
            const d = Math.abs(cand - raw);
            if (d <= PAIR_SNAP && d < best) { best = d; n = cand; }
        }
    }
    return n;
}

function enterEditMode() {
    if (!editMode) {
        editMode = true;
        setSelected(null);
        document.body.classList.add('editing');
        $('editBar').classList.remove('hidden');
        render();
        toast('Rediger pulter – dra, trykk for ny, ✕ for å fjerne', 'ok');
    }
}
function exitEditMode() {
    if (editMode) {
        editMode = false;
        document.body.classList.remove('editing');
        $('editBar').classList.add('hidden');
        render();
    }
}

function onEditPointerDown(e) {
    if (e.target.closest('.seat-del')) return; // deletion handled on click
    const seatEl = e.target.closest('.seat');
    const start = { x: e.clientX, y: e.clientY };
    if (seatEl) {
        const seat = state.seats.find(s => s.id === seatEl.dataset.seatId);
        if (!seat) return;
        deskDrag = { type: 'move', seat, el: seatEl, start, originX: seat.x, originY: seat.y, moved: false, before: snapshot() };
    } else if (e.target.closest('#board') || e.target.closest('.stage')) {
        deskDrag = { type: 'add', start, moved: false };
    } else return;
    window.addEventListener('pointermove', onEditMove);
    window.addEventListener('pointerup', onEditUp);
    window.addEventListener('pointercancel', onEditUp);
    e.preventDefault();
}
function onEditMove(e) {
    if (!deskDrag) return;
    const dx = e.clientX - deskDrag.start.x, dy = e.clientY - deskDrag.start.y;
    if (!deskDrag.moved) {
        if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
        deskDrag.moved = true;
    }
    if (deskDrag.type !== 'move') return; // dragging empty space does nothing
    const s = boardScale || 1;
    const bdx = dx / s, bdy = dy / s;
    const rx = deskDrag.originX + bdx, ry = deskDrag.originY + bdy;
    let nx, ny;
    if (e.altKey) { nx = rx; ny = ry; }                              // free nudge
    else {                                                            // lattice + pair snapping (both axes)
        const gx = snap(rx, GRID_X), gy = snap(ry, GRID_Y);
        nx = snapEditAxis(rx, gy, 'x', deskDrag.seat.id);
        ny = snapEditAxis(ry, gx, 'y', deskDrag.seat.id);
    }
    nx = Math.max(0, nx); ny = Math.max(0, ny);
    deskDrag.seat.x = nx; deskDrag.seat.y = ny;
    if (deskDrag.el) { deskDrag.el.style.left = nx + 'px'; deskDrag.el.style.top = ny + 'px'; }
}
function onEditUp(e) {
    window.removeEventListener('pointermove', onEditMove);
    window.removeEventListener('pointerup', onEditUp);
    window.removeEventListener('pointercancel', onEditUp);
    if (!deskDrag) return;
    const d = deskDrag; deskDrag = null;
    if (d.type === 'move' && d.moved) { suppressClick = true; pushUndo(d.before); state.roomMode = 'custom'; save(); render(); }
    else if (d.type === 'add' && !d.moved) { suppressClick = true; addSeatAt(e.clientX, e.clientY); }
}
function addSeatAt(cx, cy) {
    pushUndo();
    const p = clientToBoard(cx, cy);
    let x = Math.max(0, snap(p.x - SEAT_W / 2, GRID_X));
    let y = Math.max(0, snap(p.y - SEAT_H / 2, GRID_Y));
    while (state.seats.some(s => Math.abs(s.x - x) < 4 && Math.abs(s.y - y) < 4)) x += GRID_X; // avoid stacking
    state.seats.push({ id: newSeatId(), x, y });
    state.roomMode = 'custom';
    save(); render();
}
function deleteSeat(seatId) {
    pushUndo();
    state.seats = state.seats.filter(s => s.id !== seatId);
    delete state.assign[seatId]; // any occupant falls back to the pool
    state.roomMode = 'custom';
    save(); render();
}
function alignAllDesks() {
    if (!state.seats.length) return;
    pushUndo();
    const taken = new Set();
    state.seats.forEach(s => {
        let x = Math.max(0, snap(s.x, GRID_X)), y = Math.max(0, snap(s.y, GRID_Y));
        while (taken.has(x + ',' + y)) x += GRID_X; // never stack two desks on one cell
        taken.add(x + ',' + y);
        s.x = x; s.y = y;
    });
    state.roomMode = 'custom';
    save(); render();
    toast('Pultene er justert til rutenettet', 'ok');
}

/* ------------------------------------------------------------- tap to swap  */
function onClick(e) {
    if (suppressClick) { suppressClick = false; return; }
    if (editMode) {
        const del = e.target.closest('.seat-del');
        if (del) { const seatEl = del.closest('.seat'); if (seatEl) deleteSeat(seatEl.dataset.seatId); }
        return;
    }
    const tokenEl = e.target.closest('.token, .chip');
    const seatEl = e.target.closest('.seat');
    const poolEl = e.target.closest('#pool');
    if (tokenEl) {
        const sid = tokenEl.dataset.studentId;
        if (selected === sid) { setSelected(null); return; }
        if (selected) {
            const seatId = tokenEl.closest('.seat') ? tokenEl.closest('.seat').dataset.seatId : null;
            if (seatId) { placeStudent(selected, seatId); setSelected(null); }
            else setSelected(sid);
            return;
        }
        setSelected(sid); return;
    }
    if (seatEl) { if (selected) { placeStudent(selected, seatEl.dataset.seatId); setSelected(null); } return; }
    if (poolEl) { if (selected) { unseat(selected); setSelected(null); } return; }
    if (selected) setSelected(null);
}

/* ------------------------------------------------------------------ toast   */
let toastTimer = null;
function toast(msg, type) {
    const t = $('toast');
    t.textContent = msg;
    t.className = 'toast show' + (type ? ' ' + type : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.className = 'toast'; }, 2200);
}
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

/* ----------------------------------------------------------- screen control */
function showApp() {
    zoom = null;
    resetUndo();
    $('setup').classList.add('hidden');
    $('app').classList.remove('hidden');
    $('classMenuBtn').firstChild.textContent = state.name + ' ';
    requestAnimationFrame(fitBoard);
}
function showSetup() { if (editMode) exitEditMode(); $('app').classList.add('hidden'); $('setup').classList.remove('hidden'); }

/* ----------------------------------------------- preset classes (Klasser/)  */
let presetClasses = [];               // [{ name, file }]
const KLASSER_DIR = 'Klasser';

async function loadPresetManifest() {
    try {
        const res = await fetch(KLASSER_DIR + '/index.json', { cache: 'no-store' });
        if (!res.ok) return [];
        const data = await res.json();
        if (!Array.isArray(data)) return [];
        return data.map(e => typeof e === 'string'
            ? { name: e.replace(/\.[^.]+$/, ''), file: e }
            : { name: e.name || (e.file || '').replace(/\.[^.]+$/, ''), file: e.file })
            .filter(e => e.file);
    } catch (e) { return []; }
}
function populatePresetSelect() {
    const sel = $('presetClassSelect');
    if (!sel) return;
    sel.innerHTML = '<option value="">Velg en ferdig klasse…</option>';
    presetClasses.forEach((p, i) => { const o = document.createElement('option'); o.value = String(i); o.textContent = p.name; sel.appendChild(o); });
    $('setupPresets').classList.toggle('hidden', presetClasses.length === 0);
}
async function onPresetSelected(idx) {
    const p = presetClasses[idx];
    if (!p) return;
    try {
        const res = await fetch(KLASSER_DIR + '/' + encodeURIComponent(p.file), { cache: 'no-store' });
        if (!res.ok) throw new Error('http ' + res.status);
        const names = parseNames(await res.text());
        if (!names.length) { toast('Klassefilen er tom', 'err'); return; }
        $('setupNames').value = names.join('\n');
        $('setupNames').dispatchEvent(new Event('input'));
        if (!$('setupClassName').value.trim()) $('setupClassName').value = p.name;
        toast(`Hentet ${names.length} elever fra ${p.name}`, 'ok');
    } catch (e) { toast('Kunne ikke hente klassen', 'err'); }
}

/* --------------------------------------------------------------- setup flow */
function parseNames(text) { return text.split(/\r?\n/).map(s => s.trim()).filter(Boolean); }

function startNewClass(names, preset, className) {
    const c = normClass({ name: (className && className.trim()) || 'Klasse', room: preset,
        students: names.map(n => ({ name: n })) });
    c.seats = generateSeats(preset, c.students.length);
    store = store || { activeClassId: null, classes: {}, roomTemplates: [] };
    store.roomTemplates = store.roomTemplates || [];
    store.classes[c.id] = c;
    store.activeClassId = c.id;
    state = c;
    fillSeats(state.students.map(s => s.id));
    save(); showApp(); render();
}

/* --------------------------------------------------------------- modals     */
function openModal(id) { $(id).classList.add('show'); }
function closeModal(id) { $(id).classList.remove('show'); }
function closeAllDropdowns() { document.querySelectorAll('.dropdown.open').forEach(d => d.classList.remove('open')); }

/* -- rules modal -- */
function openRulesModal() {
    $('prefBalanceGender').checked = !!state.prefs.balanceGender;
    $('prefAvoidRepeat').checked = !!state.prefs.avoidRepeat;
    fillStudentSelect($('ruleA'));
    fillStudentSelect($('ruleB'));
    renderRulesList();
    openModal('rulesModal');
}
function fillStudentSelect(sel) {
    sel.innerHTML = '';
    state.students.forEach(s => { const o = document.createElement('option'); o.value = s.id; o.textContent = s.name; sel.appendChild(o); });
}
function renderRulesList() {
    const list = $('rulesList');
    list.innerHTML = '';
    if (!state.rules.length) { list.innerHTML = '<div class="empty-line">Ingen regler enda.</div>'; return; }
    // hard (Må) rules first so the important ones read at the top
    const ordered = state.rules.map((r, i) => ({ r, i }))
        .sort((x, y) => (((normStrength(y.r.strength) || 'must') === 'must') - ((normStrength(x.r.strength) || 'must') === 'must')));
    ordered.forEach(({ r, i }) => {
        const a = studentById(r.a), b = studentById(r.b);
        if (!a || !b) return;
        const st = normStrength(r.strength) || 'must';
        const row = document.createElement('div');
        row.className = 'rule-row';
        const icon = r.type === 'apart' ? '🚫' : '🤝';
        const word = r.type === 'apart' ? 'fra hverandre' : 'sammen';
        const chip = `<span class="rule-chip ${st}">${st === 'must' ? 'Må' : 'Bør'}</span>`;
        row.innerHTML = `<span class="rule-text">${chip} ${icon} <strong>${escapeHtml(a.name)}</strong> &amp; <strong>${escapeHtml(b.name)}</strong> – ${word}</span>`;
        const del = document.createElement('button');
        del.className = 'rule-del'; del.textContent = '✕';
        del.addEventListener('click', () => { state.rules.splice(i, 1); save(); renderRulesList(); });
        row.appendChild(del);
        list.appendChild(row);
    });
}

/* -- roster modal -- */
let rosterWork = null;
function openStudentsModal() {
    rosterWork = state.students.map(s => ({ id: s.id, name: s.name, gender: s.gender, front: s.front, back: s.back, tags: s.tags.slice() }));
    renderRoster();
    $('rosterAdd').value = '';
    openModal('studentsModal');
}
function renderRoster() {
    const box = $('roster');
    box.innerHTML = '';
    rosterWork.forEach((s, i) => {
        const row = document.createElement('div');
        row.className = 'roster-row';
        row.innerHTML = `
            <input class="r-name" type="text" value="${escapeHtml(s.name)}">
            <div class="r-gender" role="group">
                <button type="button" data-g="G" class="${s.gender === 'G' ? 'on' : ''}">G</button>
                <button type="button" data-g="J" class="${s.gender === 'J' ? 'on' : ''}">J</button>
                <button type="button" data-g="" class="${!s.gender ? 'on' : ''}">–</button>
            </div>
            <select class="r-place" title="Plassering i rommet">
                <option value="">Fri plass</option>
                <option value="front-should" ${s.front === 'should' ? 'selected' : ''}>Bør foran</option>
                <option value="front-must" ${s.front === 'must' ? 'selected' : ''}>Må foran</option>
                <option value="back-should" ${s.back === 'should' ? 'selected' : ''}>Bør bak</option>
                <option value="back-must" ${s.back === 'must' ? 'selected' : ''}>Må bak</option>
            </select>
            <button type="button" class="r-del">✕</button>`;
        row.querySelector('.r-name').addEventListener('input', e => s.name = e.target.value);
        row.querySelectorAll('.r-gender button').forEach(btn => btn.addEventListener('click', () => {
            s.gender = btn.dataset.g || null;
            row.querySelectorAll('.r-gender button').forEach(b => b.classList.remove('on'));
            btn.classList.add('on');
        }));
        row.querySelector('.r-place').addEventListener('change', e => {
            const v = e.target.value; // '' | 'front-should' | 'front-must' | 'back-should' | 'back-must'
            s.front = v.startsWith('front-') ? v.slice(6) : null;
            s.back = v.startsWith('back-') ? v.slice(5) : null;
        });
        row.querySelector('.r-del').addEventListener('click', () => { rosterWork.splice(i, 1); renderRoster(); });
        box.appendChild(row);
    });
}
function saveRoster() {
    const names = rosterWork.map(s => (s.name || '').trim()).filter(Boolean);
    if (!names.length) { toast('Listen kan ikke være tom', 'err'); return; }
    // commit working copy back to real students, preserving ids
    state.students = rosterWork.filter(s => (s.name || '').trim()).map(s => normStudent({ id: s.id, name: s.name.trim(), gender: s.gender, front: s.front, back: s.back, tags: s.tags }));
    pruneInvalid();
    // auto mode keeps desks == roster; custom mode leaves the fixed arrangement
    // untouched (surplus students fall back to the pool, empty desks remain).
    if (state.roomMode !== 'custom' && state.seats.length !== state.students.length) regenSeatsPreserve();
    save(); render();
    closeModal('studentsModal');
    toast('Elevliste oppdatert', 'ok');
}

/* -- room modal -- */
let roomChoice = null;
function openRoomModal() {
    roomChoice = state.room;
    document.querySelectorAll('#roomPresetList .preset').forEach(p => p.classList.toggle('is-active', p.dataset.preset === state.room));
    $('roomKeepSeats').checked = false;
    const p = state.roomParams || {};
    const custom = state.roomMode === 'custom';
    $('roomRows').value = custom && p.rows ? p.rows : '';
    $('roomPerRow').value = custom && p.perRow ? p.perRow : '';
    $('roomGapY').value = p.gapY != null ? p.gapY : '';
    $('roomGapX').value = p.gapX != null ? p.gapX : '';
    updateRoomConfigUI();
    renderRoomTemplates();
    openModal('roomModal');
}
function updateRoomConfigUI() {
    const isU = roomChoice === 'u';
    const lbl = roomChoice === 'pairs' ? 'Par per rad'
        : roomChoice === 'pods' ? 'Grupper per rad' : 'Pulter per rad';
    $('roomPerRowLabel').textContent = lbl;
    $('roomConfig').classList.toggle('is-disabled', isU);
    $('roomUHint').classList.toggle('hidden', !isU);
    if (isU) { $('roomRows').value = ''; $('roomPerRow').value = ''; }
}

/* ---- saved room arrangements (shared across classes, stored on the store) -- */
function ensureTemplates() { if (store && !store.roomTemplates) store.roomTemplates = []; }
function normalizeSeatList(seats) {
    const out = seats.map(s => ({ x: s.x, y: s.y }));
    if (out.length) {
        const mnX = Math.min(...out.map(s => s.x)), mnY = Math.min(...out.map(s => s.y));
        out.forEach(s => { s.x -= mnX; s.y -= mnY; });
    }
    return out;
}
function saveRoomTemplate() {
    if (!state.seats.length) { toast('Ingen pulter å lagre', 'err'); return; }
    const name = (prompt('Navn på oppsettet:', state.name + ' – ' + state.seats.length + ' pulter') || '').trim();
    if (!name) return;
    ensureTemplates();
    store.roomTemplates.push({ id: uid(), name, count: state.seats.length, seats: normalizeSeatList(state.seats) });
    save();
    renderRoomTemplates();
    toast(`Oppsett «${name}» lagret`, 'ok');
}
function applyRoomTemplate(id) {
    ensureTemplates();
    const t = store.roomTemplates.find(x => x.id === id);
    if (!t) return;
    pushUndo();
    const order = state.students.map(s => s.id);
    state.seats = (t.seats || []).map((s, i) => ({ id: 'seat' + i, x: s.x, y: s.y }));
    state.roomMode = 'custom';
    state.assign = {};
    state.locked = [];
    fillSeats(order);
    save(); render();
    toast(`Oppsett «${t.name}» tatt i bruk`, 'ok');
}
function deleteRoomTemplate(id) {
    ensureTemplates();
    const t = store.roomTemplates.find(x => x.id === id);
    if (t && !confirm(`Slette oppsettet «${t.name}»?`)) return;
    store.roomTemplates = store.roomTemplates.filter(x => x.id !== id);
    save(); renderRoomTemplates();
}
function renderRoomTemplates() {
    ensureTemplates();
    const box = $('roomTplList');
    if (!box) return;
    box.innerHTML = '';
    if (!store.roomTemplates.length) { box.innerHTML = '<div class="empty-line">Ingen lagrede oppsett enda.</div>'; return; }
    store.roomTemplates.forEach(t => {
        const row = document.createElement('div');
        row.className = 'rt-row';
        const n = t.count != null ? t.count : (t.seats ? t.seats.length : 0);
        row.innerHTML = `<span><strong>${escapeHtml(t.name)}</strong> <span class="h-meta">${n} pulter</span></span>`;
        const actions = document.createElement('div');
        actions.className = 'rt-actions';
        const use = document.createElement('button'); use.className = 'btn'; use.textContent = 'Bruk';
        use.addEventListener('click', () => { applyRoomTemplate(t.id); closeModal('roomModal'); });
        const del = document.createElement('button'); del.className = 'rule-del'; del.textContent = '✕';
        del.addEventListener('click', () => deleteRoomTemplate(t.id));
        actions.appendChild(use); actions.appendChild(del);
        row.appendChild(actions);
        box.appendChild(row);
    });
}

/* -- history modal -- */
function openHistoryModal() { renderHistory(); openModal('historyModal'); }
function renderHistory() {
    const box = $('historyList');
    box.innerHTML = '';
    if (!state.history.length) { box.innerHTML = '<div class="empty-line">Ingen lagrede kart enda.</div>'; return; }
    state.history.forEach((h, i) => {
        const row = document.createElement('div');
        row.className = 'history-row';
        const placed = Object.keys(h.assign || {}).length;
        row.innerHTML = `<span><strong>${escapeHtml(h.label || ('Kart ' + (i + 1)))}</strong><br><span class="h-meta">${escapeHtml(h.dateStr || '')} · ${placed} plassert</span></span>`;
        const actions = document.createElement('div');
        actions.className = 'history-actions';
        const restore = document.createElement('button'); restore.className = 'btn'; restore.textContent = 'Gjenopprett';
        restore.addEventListener('click', () => { restoreHistory(i); closeModal('historyModal'); });
        const del = document.createElement('button'); del.className = 'rule-del'; del.textContent = '✕';
        del.addEventListener('click', () => { state.history.splice(i, 1); save(); renderHistory(); });
        actions.appendChild(restore); actions.appendChild(del);
        row.appendChild(actions);
        box.appendChild(row);
    });
}
function saveHistory() {
    const dateStr = new Date().toLocaleString('no-NO', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    state.history.unshift({
        id: uid(),
        label: 'Lagret ' + new Date().toLocaleDateString('no-NO', { day: 'numeric', month: 'short' }),
        dateStr,
        room: state.room,
        seats: state.seats.map(s => ({ id: s.id, x: s.x, y: s.y })),
        assign: Object.assign({}, state.assign)
    });
    if (state.history.length > 30) state.history.length = 30;
    save(); renderHistory();
    toast('Kart lagret i historikk', 'ok');
}
function restoreHistory(i) {
    const h = state.history[i];
    if (!h) return;
    state.room = h.room || state.room;
    state.seats = (h.seats || []).map(s => ({ id: s.id, x: s.x, y: s.y }));
    state.assign = Object.assign({}, h.assign);
    pruneInvalid();
    save(); render();
    toast('Kart gjenopprettet', 'ok');
}

/* ------------------------------------------------------- class management   */
function renderClassDropdown() {
    const dd = $('classDropdown');
    dd.innerHTML = '';
    Object.values(store.classes).forEach(c => {
        const item = document.createElement('button');
        item.className = 'dd-item' + (c.id === store.activeClassId ? ' active' : '');
        item.textContent = c.name;
        item.addEventListener('click', () => { setActiveClass(c.id); closeAllDropdowns(); });
        dd.appendChild(item);
    });
    const sep = document.createElement('div'); sep.className = 'dd-sep'; dd.appendChild(sep);
    const add = document.createElement('button');
    add.className = 'dd-item'; add.textContent = '＋ Ny klasse';
    add.addEventListener('click', () => { closeAllDropdowns(); showSetup(); resetSetupForm(); });
    dd.appendChild(add);
}
function resetSetupForm() {
    $('setupNames').value = '';
    $('setupClassName').value = '';
    $('setupCount').textContent = '0';
    if ($('presetClassSelect')) $('presetClassSelect').value = '';
}
function renameClass() {
    const name = prompt('Klassenavn:', state.name);
    if (name && name.trim()) { state.name = name.trim(); $('classMenuBtn').firstChild.textContent = state.name + ' '; save(); }
}
function deleteClass() {
    if (Object.keys(store.classes).length <= 1) { toast('Kan ikke slette den eneste klassen', 'err'); return; }
    if (!confirm(`Slette klassen «${state.name}»? Dette kan ikke angres.`)) return;
    delete store.classes[store.activeClassId];
    const next = Object.keys(store.classes)[0];
    setActiveClass(next);
    toast('Klasse slettet', 'ok');
}

/* ------------------------------------------------------- backup / restore   */
function exportBackup() {
    const blob = new Blob([JSON.stringify(store, null, 2)], { type: 'application/json' });
    downloadBlob(blob, 'klassekart-sikkerhetskopi.json');
    toast('Sikkerhetskopi lastet ned', 'ok');
}
function importBackup(file) {
    const reader = new FileReader();
    reader.onload = () => {
        try {
            const s = JSON.parse(reader.result);
            if (!s || !s.classes) throw new Error('ugyldig');
            store = s;
            for (const id in store.classes) store.classes[id] = normClass(store.classes[id]);
            store.roomTemplates = store.roomTemplates || [];
            if (!store.classes[store.activeClassId]) store.activeClassId = Object.keys(store.classes)[0];
            state = store.classes[store.activeClassId];
            save(); showApp(); render();
            toast('Sikkerhetskopi gjenopprettet', 'ok');
        } catch (e) { toast('Kunne ikke lese filen', 'err'); }
    };
    reader.readAsText(file);
}
function downloadBlob(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 100);
}

/* ------------------------------------------------------ present mode (P4)   */
function enterPresent() {
    if (editMode) exitEditMode();
    zoom = null;
    presentMode = true;
    setSelected(null);
    document.body.classList.add('present');
    $('presentBar').classList.remove('hidden');
    const el = document.documentElement;
    if (el.requestFullscreen) el.requestFullscreen().catch(() => {});
    requestAnimationFrame(fitBoard);
}
function exitPresent() {
    presentMode = false;
    zoom = null;
    document.body.classList.remove('present');
    $('presentBar').classList.add('hidden');
    if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => {});
    requestAnimationFrame(fitBoard);
}

/* ------------------------------------------------------ export PDF / PNG    */
function seatingBBox() { return { w: boardW, h: boardH }; }

function drawSeatingToCanvas(scale) {
    const pad = 24, headH = 70;
    const cv = document.createElement('canvas');
    const dpr = 2;
    cv.width = (boardW * scale + pad * 2) * dpr;
    cv.height = (boardH * scale + pad * 2 + headH) * dpr;
    const ctx = cv.getContext('2d');
    ctx.scale(dpr, dpr);
    // background
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, cv.width, cv.height);
    // header
    ctx.fillStyle = '#1f2233';
    ctx.font = '700 26px -apple-system, Segoe UI, Roboto, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillText(state.name, pad, 28);
    ctx.fillStyle = '#5b6072';
    ctx.font = '400 14px -apple-system, Segoe UI, Roboto, sans-serif';
    ctx.fillText('Klassekart · ' + new Date().toLocaleDateString('no-NO', { day: 'numeric', month: 'long', year: 'numeric' }), pad, 52);
    // front bar
    const ox = pad, oy = pad + headH;
    ctx.fillStyle = '#2b2f45';
    const fw = 150, fh = 22;
    roundRect(ctx, ox + (boardW * scale - fw) / 2, oy - 30, fw, fh, 6); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.font = '600 11px -apple-system, Segoe UI, Roboto, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('TAVLE / FRONT', ox + (boardW * scale) / 2, oy - 30 + fh / 2 + 1);
    ctx.textAlign = 'left';
    // seats
    for (const seat of state.seats) {
        const x = ox + seat.x * scale, y = oy + seat.y * scale, w = SEAT_W * scale, h = SEAT_H * scale;
        const sid = state.assign[seat.id];
        ctx.lineWidth = 1.5;
        if (sid) { ctx.fillStyle = '#fff'; ctx.strokeStyle = '#cfd3e6'; }
        else { ctx.fillStyle = '#f7f8fc'; ctx.strokeStyle = '#e0e3f0'; }
        roundRect(ctx, x, y, w, h, 8); ctx.fill(); ctx.stroke();
        if (sid) {
            const stu = studentById(sid);
            if (stu) {
                ctx.fillStyle = '#1f2233';
                ctx.font = '600 ' + Math.round(15 * scale) + 'px -apple-system, Segoe UI, Roboto, sans-serif';
                ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                wrapText(ctx, stu.name, x + w / 2, y + h / 2, w - 10, 16 * scale);
                ctx.textAlign = 'left';
            }
        }
    }
    return cv;
}
function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
}
function wrapText(ctx, text, cx, cy, maxW, lh) {
    const words = text.split(' ');
    const lines = []; let line = '';
    for (const w of words) {
        const test = line ? line + ' ' + w : w;
        if (ctx.measureText(test).width > maxW && line) { lines.push(line); line = w; }
        else line = test;
    }
    if (line) lines.push(line);
    const startY = cy - (lines.length - 1) * lh / 2;
    lines.forEach((l, i) => ctx.fillText(l, cx, startY + i * lh));
}
function exportPNG() {
    const cv = drawSeatingToCanvas(1);
    cv.toBlob(blob => { downloadBlob(blob, sanitizeName(state.name) + '.png'); toast('PNG lastet ned', 'ok'); });
}
function exportPDF() {
    if (!window.jspdf) { toast('PDF-bibliotek ikke lastet', 'err'); return; }
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    const pageW = 297, pageH = 210, margin = 12, headH = 22;
    pdf.setFillColor(79, 70, 229); pdf.rect(0, 0, pageW, headH, 'F');
    pdf.setTextColor(255, 255, 255); pdf.setFont('helvetica', 'bold'); pdf.setFontSize(16);
    pdf.text(state.name, pageW / 2, 10, { align: 'center', baseline: 'middle' });
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9);
    pdf.text('Klassekart · ' + new Date().toLocaleDateString('no-NO', { day: 'numeric', month: 'long', year: 'numeric' }), pageW / 2, 17, { align: 'center' });

    const availW = pageW - margin * 2, availH = pageH - headH - margin * 2 - 8;
    const scale = Math.min(availW / boardW, availH / boardH);
    const ox = (pageW - boardW * scale) / 2, oy = headH + margin + 8;
    // front bar
    pdf.setFillColor(43, 47, 69);
    pdf.roundedRect(ox + (boardW * scale - 40) / 2, oy - 7, 40, 5, 1.2, 1.2, 'F');
    pdf.setTextColor(255, 255, 255); pdf.setFontSize(6);
    pdf.text('TAVLE / FRONT', ox + boardW * scale / 2, oy - 4, { align: 'center', baseline: 'middle' });

    for (const seat of state.seats) {
        const x = ox + seat.x * scale, y = oy + seat.y * scale, w = SEAT_W * scale, h = SEAT_H * scale;
        const sid = state.assign[seat.id];
        pdf.setDrawColor(205, 209, 230); pdf.setLineWidth(0.3);
        if (sid) pdf.setFillColor(255, 255, 255); else pdf.setFillColor(247, 248, 252);
        pdf.roundedRect(x, y, w, h, 1.5, 1.5, 'FD');
        if (sid) {
            const stu = studentById(sid);
            if (stu) {
                pdf.setTextColor(31, 34, 51); pdf.setFont('helvetica', 'bold');
                pdf.setFontSize(stu.name.length > 14 ? 8 : 10);
                pdf.text(stu.name, x + w / 2, y + h / 2, { align: 'center', baseline: 'middle', maxWidth: w - 3 });
            }
        }
    }
    pdf.save(sanitizeName(state.name) + ' ' + new Date().toISOString().split('T')[0] + '.pdf');
    toast('PDF lastet ned', 'ok');
}
function sanitizeName(n) { return (n || 'klassekart').replace(/[\/\\:*?"<>|]/g, '_').trim(); }

function printChart() {
    const cv = drawSeatingToCanvas(1);
    const data = cv.toDataURL('image/png');
    const w = window.open('', '_blank');
    if (!w) { toast('Tillat popup for utskrift', 'err'); return; }
    w.document.write('<html><head><title>' + escapeHtml(state.name) + '</title></head><body style="margin:0;text-align:center;">' +
        '<img src="' + data + '" style="max-width:100%;" onload="window.print()"></body></html>');
    w.document.close();
}

/* ---------------------------------------------------------------- main menu */
function buildMainMenu() {
    const dd = $('mainMenu');
    dd.innerHTML = '';
    const items = [
        ['🗂️ Romoppsett', openRoomModal],
        ['✏️ Rediger pulter', enterEditMode],
        ['🕘 Historikk', openHistoryModal],
        ['sep'],
        ['📄 Eksporter PDF', exportPDF],
        ['🖼️ Eksporter PNG', exportPNG],
        ['🖨️ Skriv ut', printChart],
        ['sep'],
        ['💾 Last ned sikkerhetskopi', exportBackup],
        ['📂 Gjenopprett fra fil', () => $('importFile').click()],
        ['sep'],
        ['✏️ Gi klassen nytt navn', renameClass],
        ['🗑️ Slett klasse', deleteClass],
    ];
    items.forEach(([label, fn]) => {
        if (label === 'sep') { const s = document.createElement('div'); s.className = 'dd-sep'; dd.appendChild(s); return; }
        const b = document.createElement('button');
        b.className = 'dd-item'; b.textContent = label;
        b.addEventListener('click', () => { closeAllDropdowns(); fn(); });
        dd.appendChild(b);
    });
}

/* ---------------------------------------------------------------- wiring     */
function wireSetup() {
    const presetBtns = document.querySelectorAll('#presetList .preset');
    let chosen = 'pairs';
    presetBtns.forEach(btn => btn.addEventListener('click', () => {
        presetBtns.forEach(b => b.classList.remove('is-active'));
        btn.classList.add('is-active'); chosen = btn.dataset.preset;
    }));
    const names = $('setupNames');
    const updateCount = () => { $('setupCount').textContent = parseNames(names.value).length; };
    names.addEventListener('input', updateCount); updateCount();
    $('presetClassSelect').addEventListener('change', e => { if (e.target.value !== '') onPresetSelected(parseInt(e.target.value, 10)); });
    $('setupGoBtn').addEventListener('click', () => {
        const list = parseNames(names.value);
        if (!list.length) { toast('Lim inn minst ett elevnavn', 'err'); names.focus(); return; }
        startNewClass(list, chosen, $('setupClassName').value);
    });
}

function wireApp() {
    $('smartBtn').addEventListener('click', () => smartArrange(false));
    $('shuffleBtn').addEventListener('click', () => shuffleSeating(false));
    $('rulesBtn').addEventListener('click', openRulesModal);
    $('studentsBtn').addEventListener('click', openStudentsModal);
    $('presentBtn').addEventListener('click', enterPresent);
    $('backBtn').addEventListener('click', () => { setSelected(null); showSetup(); });
    $('undoBtn').addEventListener('click', undo);
    $('redoBtn').addEventListener('click', redo);

    // class dropdown
    $('classMenuBtn').addEventListener('click', (e) => {
        e.stopPropagation();
        const dd = $('classDropdown');
        const opening = !dd.classList.contains('open');
        closeAllDropdowns();
        if (opening) { renderClassDropdown(); dd.classList.add('open'); }
    });
    // main menu
    $('menuBtn').addEventListener('click', (e) => {
        e.stopPropagation();
        const dd = $('mainMenu');
        const opening = !dd.classList.contains('open');
        closeAllDropdowns();
        if (opening) dd.classList.add('open');
    });
    document.addEventListener('click', closeAllDropdowns);

    // selection action bar
    $('selLockBtn').addEventListener('click', () => { if (selected) { toggleLock(selected); updateSelBar(); } });
    $('selPoolBtn').addEventListener('click', () => { if (selected) { unseat(selected); setSelected(null); } });

    // rules modal
    $('ruleAddBtn').addEventListener('click', () => {
        const a = $('ruleA').value, b = $('ruleB').value, type = $('ruleType').value;
        const strength = $('ruleStrength').value === 'should' ? 'should' : 'must';
        if (!a || !b || a === b) { toast('Velg to forskjellige elever', 'err'); return; }
        const existing = state.rules.find(r => r.type === type && pairKey(r.a, r.b) === pairKey(a, b));
        if (existing) { existing.strength = strength; toast('Regel oppdatert', 'ok'); }
        else state.rules.push({ id: uid(), type, a, b, strength });
        save(); renderRulesList();
    });
    $('prefBalanceGender').addEventListener('change', e => { state.prefs.balanceGender = e.target.checked; save(); });
    $('prefAvoidRepeat').addEventListener('change', e => { state.prefs.avoidRepeat = e.target.checked; save(); });
    $('rulesRunBtn').addEventListener('click', () => { closeModal('rulesModal'); smartArrange(false); });

    // roster modal
    $('rosterAddBtn').addEventListener('click', () => {
        const added = parseNames($('rosterAdd').value);
        if (!added.length) return;
        added.forEach(n => rosterWork.push({ id: uid(), name: n, gender: null, front: null, back: null, tags: [] }));
        $('rosterAdd').value = '';
        renderRoster();
    });
    $('rosterSaveBtn').addEventListener('click', saveRoster);

    // room modal
    document.querySelectorAll('#roomPresetList .preset').forEach(btn => btn.addEventListener('click', () => {
        document.querySelectorAll('#roomPresetList .preset').forEach(b => b.classList.remove('is-active'));
        btn.classList.add('is-active'); roomChoice = btn.dataset.preset;
        updateRoomConfigUI();
    }));
    $('roomApplyBtn').addEventListener('click', () => {
        const preset = roomChoice || state.room;
        const numOrNull = (v, lo, hi) => { const n = parseInt(v, 10); return isNaN(n) ? null : clamp(n, lo, hi); };
        const rows = numOrNull($('roomRows').value, 1, 20);
        const perRow = numOrNull($('roomPerRow').value, 1, 20);
        const custom = preset !== 'u' && rows && perRow;
        const params = {
            rows: custom ? rows : null,
            perRow: custom ? perRow : null,
            gapY: numOrNull($('roomGapY').value, 0, 200),
            gapX: numOrNull($('roomGapX').value, 0, 200)
        };
        applyRoom(preset, $('roomKeepSeats').checked, params);
        closeModal('roomModal');
        toast(custom ? 'Tilpasset oppsett laget' : 'Romoppsett oppdatert', 'ok');
    });

    // history modal
    $('historySaveBtn').addEventListener('click', saveHistory);

    // results modal
    $('resultsRerunBtn').addEventListener('click', () => { closeModal('resultsModal'); smartArrange(false); });

    // desk-edit mode
    $('roomEditBtn').addEventListener('click', () => { closeModal('roomModal'); enterEditMode(); });
    $('editDoneBtn').addEventListener('click', exitEditMode);
    $('editAlignBtn').addEventListener('click', alignAllDesks);
    $('editSaveTplBtn').addEventListener('click', saveRoomTemplate);
    $('roomSaveTplBtn').addEventListener('click', saveRoomTemplate);

    // zoom control
    $('zoomIn').addEventListener('click', () => zoomBy(1.2));
    $('zoomOut').addEventListener('click', () => zoomBy(1 / 1.2));
    $('zoomLabel').addEventListener('click', () => setZoom(null));

    // present bar
    $('pShuffle').addEventListener('click', () => shuffleSeating(true));
    $('pSmart').addEventListener('click', () => smartArrange(true));
    $('pExit').addEventListener('click', exitPresent);

    // backup import
    $('importFile').addEventListener('change', e => { if (e.target.files[0]) importBackup(e.target.files[0]); e.target.value = ''; });

    // generic modal closers
    document.querySelectorAll('[data-close]').forEach(btn => btn.addEventListener('click', () => closeModal(btn.dataset.close)));
    document.querySelectorAll('.modal-overlay').forEach(ov => ov.addEventListener('click', e => { if (e.target === ov) closeModal(ov.id); }));

    // drag/drop + tap on the app screen
    const app = $('app');
    app.addEventListener('pointerdown', onPointerDown);
    app.addEventListener('click', onClick);

    buildMainMenu();
}

function wireGlobal() {
    window.addEventListener('resize', () => { if (state && !$('app').classList.contains('hidden')) fitBoard(); });
    document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement && presentMode) exitPresent(); });
    document.addEventListener('keydown', (e) => {
        const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement && document.activeElement.tagName);
        if (e.key === 'Escape') {
            if (presentMode) { exitPresent(); return; }
            if (editMode) { exitEditMode(); return; }
            const open = document.querySelector('.modal-overlay.show');
            if (open) { closeModal(open.id); return; }
            closeAllDropdowns();
            if (selected) { setSelected(null); return; }
        }
        // undo / redo — work in edit mode too, but not while typing in a field
        if ((e.ctrlKey || e.metaKey) && !e.altKey && /^[zyZY]$/.test(e.key)) {
            if (typing || $('app').classList.contains('hidden')) return;
            e.preventDefault();
            if (e.key === 'y' || e.key === 'Y' || e.shiftKey) redo(); else undo();
            return;
        }
        if (typing) return;
        if ($('app').classList.contains('hidden') || editMode) return;
        if (e.key === 'r' || e.key === 'R') shuffleSeating(false);
        else if (e.key === 's' && !(e.ctrlKey || e.metaKey)) smartArrange(false);
        else if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) { e.preventDefault(); save(); toast('Lagret', 'ok'); }
    });
}

/* ------------------------------------------------------------------ init    */
function init() {
    wireSetup(); wireApp(); wireGlobal();
    loadPresetManifest().then(list => { presetClasses = list; populatePresetSelect(); });
    if (loadStore()) { state = store.classes[store.activeClassId]; showApp(); render(); }
    else { showSetup(); }
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();

})();
