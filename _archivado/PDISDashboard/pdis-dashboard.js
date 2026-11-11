"use strict";
/* Dashboard PDIS — análisis de los archivos PDIS/rechazos guardados en Storage (uploads/). */

const pdisConfig = { apiKey: 'AIzaSyD1-ZhYGtJzJFY4WfSUS_lbnzLhzWfT1D8', authDomain: 'sistemaintegrall.firebaseapp.com', projectId: 'sistemaintegrall', storageBucket: 'sistemaintegrall.firebasestorage.app', messagingSenderId: '302291844621', appId: '1:302291844621:web:6ebf1845790bdeabfc1f44' };
if (!firebase.apps.length) firebase.initializeApp(pdisConfig);
const storage = firebase.storage();

// ── CONSTANTES ───────────────────────────────────────────────────────────────
const REF = 90;    // referencia de localización
const WARN = 75;   // umbral de atención
const PAGE_SIZE = 20;
const NO_BOSS = 'Sin jefatura';
const C = { ok: '#0E9F6E', warn: '#D97706', bad: '#DC2626', rosa: '#E6007E', vino: '#8E1A5B', pend: '#B9A9B3', txt: '#2B2027', txt2: '#6D5B66', txt3: '#9B8994', grid: 'rgba(91,35,69,0.07)' };
const ESTADOS = {
    buen: { label: 'Buen estado',   desc: 'Encontrada en buen estado o en exhibición', color: C.ok,   icon: 'bi-check-circle-fill' },
    mal:  { label: 'Mal estado',    desc: 'Encontrada con daño o como merma',         color: C.warn, icon: 'bi-exclamation-circle-fill' },
    no:   { label: 'No encontrada', desc: 'Se buscó y no se localizó',                color: C.bad,  icon: 'bi-x-circle-fill' },
    pend: { label: 'Pendiente',     desc: 'Aún sin estado capturado',                 color: C.pend, icon: 'bi-hourglass-split' },
};
const KEYS = Object.keys(ESTADOS);
const MESES = { ene: 0, feb: 1, mar: 2, abr: 3, may: 4, jun: 5, jul: 6, ago: 7, sep: 8, sept: 8, oct: 9, nov: 10, dic: 11 };

// ── ESTADO ───────────────────────────────────────────────────────────────────
const State = {
    files: [], rows: [], filtered: [], charts: {},
    det: { search: '', status: '', sortKey: 'fechaSort', sortDir: 'desc', page: 1 },
    aud: { sortKey: 'total', sortDir: 'desc' },
};
const $ = id => document.getElementById(id);
const F = { file: $('filter-file'), boss: $('filter-boss'), auditor: $('filter-auditor'), status: $('filter-status') };

if (window.Chart) { Chart.defaults.font.family = "'Inter', sans-serif"; Chart.defaults.color = C.txt2; }

// ── HELPERS ──────────────────────────────────────────────────────────────────
const esc = v => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const clean = v => String(v ?? '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const fmt = n => Number(n).toLocaleString('es-MX');
const pctTxt = p => (p ?? 0).toFixed(1) + '%';
const uniq = a => [...new Set(a)];
const toNum = v => { const n = parseFloat(String(v ?? '').replace(/,/g, '')); return isNaN(n) ? 0 : n; };
const truncate = (s, n) => { s = String(s); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
const countBy = (a, fn) => a.reduce((acc, x) => { const k = fn(x); acc[k] = (acc[k] || 0) + 1; return acc; }, {});
const fmtDate = d => d.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' });
const fmtDateTime = d => d.toLocaleString('es-MX', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const toneOf = p => p == null ? 'none' : p >= REF ? 'good' : p >= WARN ? 'warn' : 'bad';
const toneColor = p => ({ good: C.ok, warn: C.warn, bad: C.bad })[toneOf(p)] || C.txt3;

function pick(row, ...names) {
    const wanted = names.map(n => clean(n).replace(/\s+/g, ''));
    const key = Object.keys(row).find(k => wanted.includes(clean(k).replace(/\s+/g, '')));
    return key ? row[key] : '';
}

function statusOf(v) {
    const s = clean(v);
    if (!s) return 'pend';
    if (s.includes('mal estado') || s.includes('merma')) return 'mal';
    if (s.includes('buen estado') || s.includes('si encontrada') || s.includes('exhibicion')) return 'buen';
    if (s.includes('no encontr')) return 'no';
    return 'pend';
}

function parseFecha(v) {
    if (v == null || v === '') return null;
    if (typeof v === 'number') return new Date(Math.round((v - 25569) * 86400 * 1000));
    const s = clean(v);
    const m = s.match(/(\d{1,2})[\s/-]+([a-z]{3,4})\.?[\s/-]+(\d{4})(?:[,\s]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
    if (m && MESES[m[2]] != null) return new Date(+m[3], MESES[m[2]], +m[1], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
    const n = s.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (n) return new Date(+n[3], +n[2] - 1, +n[1]);
    const d = new Date(v);
    return isNaN(d) ? null : d;
}

function normRow(r, file) {
    const fecha = parseFecha(pick(r, 'Fecha y Hora Rechazo', 'Fecha', 'Fecha Rechazo'));
    return {
        remision: String(pick(r, 'Remisión', 'Remision')).trim(),
        sku: String(pick(r, 'Sku', 'SKU')).trim(),
        desc: String(pick(r, 'Descripción Sku', 'Descripcion Sku', 'Descripción', 'Descripcion')).trim(),
        seccion: String(pick(r, 'Sección', 'Seccion') || '—').trim(),
        jefatura: String(pick(r, 'Jefatura') || '').trim() || NO_BOSS,
        piezas: toNum(pick(r, 'Piezas')),
        usuario: String(pick(r, 'Usuario de Rechazo', 'Usuario')).trim(),
        auditor: String(pick(r, 'Auditor')).trim(),
        comentarios: String(pick(r, 'Comentarios')).trim(),
        statusRaw: String(pick(r, 'Status', 'Estado')).trim(),
        estado: statusOf(pick(r, 'Status', 'Estado')),
        fecha, fechaSort: fecha ? fecha.getTime() : 0,
        file: file.name,
    };
}

function agg(rows) {
    const c = countBy(rows, r => r.estado);
    const buen = c.buen || 0, mal = c.mal || 0, no = c.no || 0, pend = c.pend || 0;
    const total = rows.length, revisados = total - pend;
    return { total, buen, mal, no, pend, revisados, piezas: rows.reduce((s, r) => s + r.piezas, 0),
        loc: revisados ? (buen + mal) / revisados * 100 : null, avance: total ? revisados / total * 100 : 0 };
}

function groupAgg(rows, fn) {
    const g = {};
    rows.forEach(r => { const k = fn(r) || '—'; (g[k] || (g[k] = [])).push(r); });
    return Object.keys(g).map(k => ({ key: k, rows: g[k], ...agg(g[k]) }));
}

function sortBy(arr, key, dir) {
    const m = dir === 'asc' ? 1 : -1;
    return arr.sort((a, b) => {
        const x = a[key], y = b[key];
        if (typeof x === 'number' && typeof y === 'number') return (x - y) * m;
        return String(x ?? '').localeCompare(String(y ?? ''), 'es', { numeric: true }) * m;
    });
}

function animateNumber(el, target, isPct) {
    if (!el) return;
    const start = performance.now(), dur = 700;
    const step = now => {
        const p = Math.min((now - start) / dur, 1), e = 1 - Math.pow(1 - p, 3);
        el.textContent = isPct ? (target * e).toFixed(1) + '%' : fmt(Math.round(target * e));
        if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
}

const loading = on => { $('globalLoading').style.display = on ? 'flex' : 'none'; };

// ── CARGA ────────────────────────────────────────────────────────────────────
async function getFiles() {
    const list = await storage.ref('uploads').listAll();
    const files = await Promise.all(list.items.filter(x => /pdis|rechazos/i.test(x.name)).map(async ref => {
        const m = await ref.getMetadata();
        return { ref, name: ref.name, version: m.customMetadata?.version || '1', date: new Date(m.customMetadata?.originalUploadDate || m.timeCreated), size: m.size };
    }));
    return files.sort((a, b) => b.date - a.date);
}

async function readRows(files) {
    const rows = [];
    for (const file of files) {
        try {
            const res = await fetch(await file.ref.getDownloadURL());
            const book = XLSX.read(await res.arrayBuffer(), { type: 'array' });
            const sheet = book.Sheets.Rechazos || book.Sheets[book.SheetNames[0]];
            const json = sheet ? XLSX.utils.sheet_to_json(sheet, { defval: '' }) : [];
            file.count = json.length;
            json.forEach(r => rows.push(normRow(r, file)));
        } catch (e) { console.warn('No se pudo leer', file.name, e); file.error = true; }
    }
    return rows;
}

async function loadPdisDashboard() {
    loading(true);
    try {
        State.files = await getFiles();
        State.rows = await readRows(State.files);
        applyFilters();
    } catch (e) {
        console.error(e);
        $('data-content').style.display = 'none';
        $('no-data-state').style.display = 'block';
        $('no-data-title').textContent = 'No se pudo cargar el Dashboard';
        $('no-data-text').textContent = e.code || e.message || 'Firebase Storage no respondió.';
        $('hero-scope').textContent = 'No fue posible leer los archivos PDIS.';
    } finally { loading(false); }
}

// ── FILTROS ──────────────────────────────────────────────────────────────────
function fillSelect(el, items, placeholder) {
    const cur = el.value;
    el.innerHTML = `<option value="">${placeholder}</option>` + items.map(i => `<option value="${esc(i.value)}">${esc(i.label)}</option>`).join('');
    el.value = items.some(i => i.value === cur) ? cur : '';
    el.classList.toggle('is-set', !!el.value);
}

function refreshOptions() {
    fillSelect(F.file, State.files.map(f => ({ value: f.name, label: `${f.name} · ${fmtDate(f.date)}` })), 'Todos los archivos');
    const r1 = State.rows.filter(r => !F.file.value || r.file === F.file.value);
    fillSelect(F.boss, uniq(r1.map(r => r.jefatura)).sort((a, b) => (a === NO_BOSS) - (b === NO_BOSS) || a.localeCompare(b, 'es')).map(v => ({ value: v, label: v })), 'Todas las jefaturas');
    const r2 = r1.filter(r => !F.boss.value || r.jefatura === F.boss.value);
    fillSelect(F.auditor, uniq(r2.map(r => r.auditor).filter(Boolean)).sort((a, b) => a.localeCompare(b, 'es')).map(v => ({ value: v, label: v })), 'Todos los auditores');
    fillSelect(F.status, KEYS.map(k => ({ value: k, label: ESTADOS[k].label })), 'Todos los estados');
}

function applyFilters() {
    refreshOptions();
    State.filtered = State.rows.filter(r =>
        (!F.file.value || r.file === F.file.value) && (!F.boss.value || r.jefatura === F.boss.value) &&
        (!F.auditor.value || r.auditor === F.auditor.value) && (!F.status.value || r.estado === F.status.value));
    State.det.page = 1;
    renderActiveFilters();
    renderFiles();
    renderHero();
    if (!State.rows.length) {
        $('no-data-state').style.display = 'block';
        $('data-content').style.display = 'none';
        return;
    }
    $('no-data-state').style.display = 'none';
    $('data-content').style.display = 'block';
    const tot = agg(State.filtered);
    renderKPIs(tot);
    renderInsights(tot);
    renderSemaforo(tot);
    renderChartEstado(tot);
    renderChartJefatura();
    renderChartSecciones();
    renderChartAuditores();
    renderChartTendencia();
    renderBossCards();
    renderAuditores();
    renderDetalle();
}

Object.values(F).forEach(el => el.addEventListener('change', applyFilters));
$('btn-reset').addEventListener('click', () => { Object.values(F).forEach(el => { el.value = ''; }); applyFilters(); });
$('refresh-pdis').addEventListener('click', loadPdisDashboard);

function toggleFilter(el, value) { el.value = el.value === value ? '' : value; applyFilters(); }

function renderActiveFilters() {
    const box = $('filter-active');
    const defs = [[F.file, 'Archivo'], [F.boss, 'Jefatura'], [F.auditor, 'Auditor'], [F.status, 'Estado']];
    const pills = defs.map(([el, lbl], i) => el.value ? `<span class="db-filter-pill">${lbl}: ${esc(el.options[el.selectedIndex]?.text || el.value)} <button type="button" data-i="${i}" aria-label="Quitar filtro">✕</button></span>` : '').filter(Boolean);
    box.innerHTML = pills.length ? `<span>Filtros activos:</span>${pills.join('')}` : '';
    box.classList.toggle('show', pills.length > 0);
    box.querySelectorAll('button').forEach(b => b.addEventListener('click', () => { defs[+b.dataset.i][0].value = ''; applyFilters(); }));
}

// ── HERO ─────────────────────────────────────────────────────────────────────
function renderHero() {
    const rows = State.filtered, tot = agg(rows);
    animateNumber($('wb-archivos'), uniq(rows.map(r => r.file)).length);
    animateNumber($('wb-jefaturas'), uniq(rows.map(r => r.jefatura).filter(j => j !== NO_BOSS)).length);
    animateNumber($('wb-secciones'), uniq(rows.map(r => r.seccion)).length);
    animateNumber($('wb-auditores'), uniq(rows.map(r => r.auditor).filter(Boolean)).length);

    const last = State.files[0];
    $('wb-fecha').textContent = last ? `Último archivo: ${last.name} · ${fmtDateTime(last.date)} · v${last.version}` : 'Sin archivos cargados';

    const parts = [];
    if (F.file.value) parts.push(`archivo <strong>${esc(F.file.value)}</strong>`);
    if (F.boss.value) parts.push(`jefatura <strong>${esc(F.boss.value)}</strong>`);
    if (F.auditor.value) parts.push(`auditor <strong>${esc(F.auditor.value)}</strong>`);
    if (F.status.value) parts.push(`estado <strong>${esc(ESTADOS[F.status.value].label)}</strong>`);
    const scope = parts.length ? `Viendo ${parts.join(' · ')}.` : 'Viendo <strong>todos los archivos</strong> PDIS.';
    $('hero-scope').innerHTML = rows.length
        ? `${scope} Hay <strong>${fmt(tot.total)}</strong> registros: <strong>${fmt(tot.buen + tot.mal)}</strong> localizados, <strong>${fmt(tot.no)}</strong> no encontrados y <strong>${fmt(tot.pend)}</strong> pendientes de revisar.`
        : (State.rows.length ? `${scope} No hay registros con estos filtros.` : 'Todavía no hay archivos PDIS para analizar.');

    const pct = tot.loc ?? 0, tone = toneOf(tot.loc), circ = 2 * Math.PI * 50;
    const fill = $('gauge-fill');
    fill.style.strokeDashoffset = circ * (1 - Math.min(pct, 100) / 100);
    fill.style.stroke = ({ good: '#6EE7B7', warn: '#FCD34D', bad: '#FCA5A5' })[tone] || '#fff';
    $('gauge-meta').setAttribute('transform', `rotate(${REF * 3.6} 60 60)`);
    animateNumber($('gauge-value'), pct, true);
    const st = $('gauge-status');
    st.dataset.tone = tone;
    st.innerHTML = tot.loc == null ? 'Sin revisiones' : tone === 'good' ? '<i class="bi bi-check-circle-fill"></i> Buen nivel' : tone === 'warn' ? '<i class="bi bi-exclamation-circle-fill"></i> Requiere atención' : '<i class="bi bi-x-octagon-fill"></i> Crítico';
    $('gauge-ref').textContent = REF + '%';
    $('gauge-gap').textContent = tot.loc == null ? 'sin registros revisados' : `${fmt(tot.buen + tot.mal)} de ${fmt(tot.revisados)} revisados`;
}

// ── KPIs ─────────────────────────────────────────────────────────────────────
function renderKPIs(t) {
    const share = n => t.total ? pctTxt(n / t.total * 100) : '0.0%';
    animateNumber($('kpi-total'), t.total);
    $('kpi-total-sub').innerHTML = `${fmt(t.piezas)} piezas · ${fmt(uniq(State.filtered.map(r => r.sku)).length)} SKUs`;
    animateNumber($('kpi-avance'), t.avance, true);
    requestAnimationFrame(() => { $('kpi-avance-bar').style.width = t.avance + '%'; });
    $('kpi-avance-sub').innerHTML = `<b>${fmt(t.revisados)}</b> de ${fmt(t.total)} registros con estado`;
    animateNumber($('kpi-buen'), t.buen);
    $('kpi-buen-sub').innerHTML = `<b>${share(t.buen)}</b> del total`;
    animateNumber($('kpi-mal'), t.mal);
    $('kpi-mal-sub').innerHTML = `<b>${share(t.mal)}</b> del total`;
    animateNumber($('kpi-no'), t.no);
    $('kpi-no-sub').innerHTML = `<b>${share(t.no)}</b> del total`;
    animateNumber($('kpi-pend'), t.pend);
    $('kpi-pend-sub').innerHTML = t.pend ? `<b>${share(t.pend)}</b> falta por buscar` : '<b>Todo revisado</b>';
}

// ── HALLAZGOS ────────────────────────────────────────────────────────────────
function renderInsights(t) {
    const rows = State.filtered, items = [];
    const bosses = groupAgg(rows, r => r.jefatura).filter(b => b.key !== NO_BOSS);
    const revBosses = bosses.filter(b => b.loc != null);

    if (!t.total) items.push({ tone: 'info', icon: 'bi-funnel', title: 'Sin registros', text: 'No hay registros con los filtros seleccionados.' });
    else if (t.loc == null) items.push({ tone: 'warn', icon: 'bi-hourglass-split', title: 'Sin revisiones', text: `Los <strong>${fmt(t.total)}</strong> registros siguen pendientes de búsqueda.` });
    else items.push({ tone: toneOf(t.loc), icon: 'bi-bullseye', title: 'Localización global',
        text: `Se localizó el <strong>${pctTxt(t.loc)}</strong> de lo revisado (${fmt(t.buen + t.mal)} de ${fmt(t.revisados)}). Referencia: ${REF}%.` });

    if (t.total) items.push({ tone: t.avance >= 100 ? 'good' : t.avance >= 50 ? 'info' : 'warn', icon: 'bi-list-check', title: 'Avance de revisión',
        text: t.pend ? `Falta revisar <strong>${fmt(t.pend)}</strong> registros (${pctTxt(t.pend / t.total * 100)}).` : 'Todos los registros ya tienen estado capturado.' });

    const pendBoss = [...bosses].sort((a, b) => b.pend - a.pend)[0];
    if (pendBoss && pendBoss.pend > 0) items.push({ tone: 'warn', icon: 'bi-person-exclamation', title: 'Más pendientes',
        text: `<strong>${esc(pendBoss.key)}</strong> tiene <strong>${fmt(pendBoss.pend)}</strong> registros sin revisar (${pctTxt(pendBoss.pend / pendBoss.total * 100)} de los suyos).` });

    if (revBosses.length > 1) {
        const s = [...revBosses].sort((a, b) => b.loc - a.loc), best = s[0], worst = s[s.length - 1];
        if (best.loc !== worst.loc) {
            items.push({ tone: 'good', icon: 'bi-trophy-fill', title: 'Mejor jefatura', text: `<strong>${esc(best.key)}</strong> localiza el <strong>${pctTxt(best.loc)}</strong> de lo revisado.` });
            items.push({ tone: toneOf(worst.loc), icon: 'bi-graph-down-arrow', title: 'Menor localización', text: `<strong>${esc(worst.key)}</strong> con <strong>${pctTxt(worst.loc)}</strong>; ${fmt(worst.no)} no encontradas.` });
        }
    }

    if (t.no > 0) {
        const sec = groupAgg(rows.filter(r => r.estado === 'no'), r => r.seccion).sort((a, b) => b.total - a.total)[0];
        items.push({ tone: 'bad', icon: 'bi-grid-3x3-gap-fill', title: 'Sección más afectada',
            text: `Sección <strong>${esc(sec.key)}</strong> concentra <strong>${fmt(sec.total)}</strong> de las ${fmt(t.no)} no encontradas (${pctTxt(sec.total / t.no * 100)}).` });
    }
    if (t.mal > 0) items.push({ tone: 'warn', icon: 'bi-bandaid-fill', title: 'Mal estado / merma',
        text: `<strong>${fmt(t.mal)}</strong> artículos se encontraron dañados o como merma: el ${pctTxt(t.mal / Math.max(t.buen + t.mal, 1) * 100)} de lo localizado.` });

    const auds = groupAgg(rows.filter(r => r.auditor && r.estado !== 'pend'), r => r.auditor).sort((a, b) => b.total - a.total);
    if (auds.length) items.push({ tone: 'info', icon: 'bi-person-check-fill', title: 'Auditor más activo',
        text: `<strong>${esc(auds[0].key)}</strong> ha revisado <strong>${fmt(auds[0].total)}</strong> registros y localizó ${fmt(auds[0].buen + auds[0].mal)}.` });

    const sinBoss = rows.filter(r => r.jefatura === NO_BOSS).length;
    if (sinBoss) items.push({ tone: 'info', icon: 'bi-database-exclamation', title: 'Datos incompletos', text: `<strong>${fmt(sinBoss)}</strong> registros no tienen jefatura asignada en el archivo.` });

    $('insights-list').innerHTML = items.slice(0, 8).map(it => `
        <li class="db-insight" data-tone="${it.tone}">
            <span class="db-insight-icon"><i class="bi ${it.icon}"></i></span>
            <div><div class="db-insight-title">${it.title}</div><div class="db-insight-text">${it.text}</div></div>
        </li>`).join('');
}

// ── SEMÁFORO ─────────────────────────────────────────────────────────────────
function renderSemaforo(t) {
    const bosses = groupAgg(State.filtered, r => r.jefatura).filter(b => b.key !== NO_BOSS && b.loc != null);
    const c = countBy(bosses, b => toneOf(b.loc));
    $('sem-good').textContent = c.good || 0; $('sem-warn').textContent = c.warn || 0; $('sem-bad').textContent = c.bad || 0;
    $('sem-good-lbl').textContent = `Localización ≥ ${REF}%`; $('sem-warn-lbl').textContent = `Entre ${WARN}% y ${REF}%`; $('sem-bad-lbl').textContent = `Menos de ${WARN}%`;
    const base = t.total || 1;
    $('split-bar').innerHTML = KEYS.map(k => `<span style="width:${t[k] / base * 100}%;background:${ESTADOS[k].color}" title="${ESTADOS[k].label}: ${fmt(t[k])}"></span>`).join('');
    $('split-legend').innerHTML = '<strong style="width:100%;font-size:.7rem;color:var(--txt)">Composición de registros</strong>' +
        KEYS.map(k => `<span><i style="background:${ESTADOS[k].color}"></i>${ESTADOS[k].label} <b>${fmt(t[k])}</b> (${pctTxt(t[k] / base * 100)})</span>`).join('');
}

// ── GRÁFICAS ─────────────────────────────────────────────────────────────────
const tooltipStyle = { backgroundColor: '#2B2027', titleColor: '#fff', bodyColor: 'rgba(255,255,255,.85)', padding: 10, cornerRadius: 10, titleFont: { weight: '800' }, boxPadding: 4 };
const legendStyle = { position: 'top', align: 'end', labels: { boxWidth: 10, boxHeight: 10, useBorderRadius: true, borderRadius: 3, font: { size: 11, weight: '700' } } };
const pointer = (e, els) => { if (e.native?.target) e.native.target.style.cursor = els.length ? 'pointer' : 'default'; };

function resetChart(name) { if (State.charts[name]) { State.charts[name].destroy(); State.charts[name] = null; } }
function chartEmpty(canvas, msg) {
    const wrap = canvas.parentElement; let el = wrap.querySelector('.db-chart-empty');
    if (msg) { canvas.style.display = 'none'; if (!el) { el = document.createElement('div'); el.className = 'db-chart-empty'; wrap.appendChild(el); } el.textContent = msg; return true; }
    canvas.style.display = ''; if (el) el.remove(); return false;
}

function renderChartEstado(t) {
    resetChart('estado');
    $('donut-total').textContent = fmt(t.total);
    State.charts.estado = new Chart($('chart-estado'), {
        type: 'doughnut',
        data: { labels: KEYS.map(k => ESTADOS[k].label), datasets: [{ data: KEYS.map(k => t[k]), backgroundColor: KEYS.map(k => ESTADOS[k].color), borderColor: '#fff', borderWidth: 3, hoverOffset: 8 }] },
        options: { responsive: true, maintainAspectRatio: false, cutout: '72%', plugins: { legend: { display: false }, tooltip: { ...tooltipStyle, callbacks: { label: c => ` ${fmt(c.parsed)} registros (${pctTxt(t.total ? c.parsed / t.total * 100 : 0)})` } } } }
    });
    $('estado-legend').innerHTML = KEYS.map(k => `
        <li data-status="${k}" title="Ver estos registros en el detalle">
            <span class="dot" style="background:${ESTADOS[k].color}"></span>
            <span class="lbl">${ESTADOS[k].label}<small>${ESTADOS[k].desc}</small></span>
            <span class="val">${fmt(t[k])}<small>${pctTxt(t.total ? t[k] / t.total * 100 : 0)}</small></span>
        </li>`).join('');
    $('estado-legend').querySelectorAll('li').forEach(li => li.addEventListener('click', () => {
        State.det.status = li.dataset.status; State.det.page = 1; renderDetalle();
        $('table-detalle').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }));
}

function renderChartJefatura() {
    const canvas = $('chart-jefatura'); resetChart('jefatura');
    const bosses = groupAgg(State.filtered, r => r.jefatura).sort((a, b) => (b.loc ?? -1) - (a.loc ?? -1) || b.total - a.total).slice(0, 15);
    if (chartEmpty(canvas, bosses.length ? '' : 'Sin datos por jefatura')) return;
    $('wrap-jefatura').style.height = Math.max(240, bosses.length * 34 + 60) + 'px';
    State.charts.jefatura = new Chart(canvas, {
        type: 'bar',
        data: { labels: bosses.map(b => b.key), datasets: KEYS.map(k => ({ label: ESTADOS[k].label, data: bosses.map(b => b.total ? +(b[k] / b.total * 100).toFixed(2) : 0), backgroundColor: ESTADOS[k].color, borderSkipped: false, barPercentage: .72 })) },
        options: {
            indexAxis: 'y', responsive: true, maintainAspectRatio: false,
            onClick: (_e, els) => { if (els[0]) toggleFilter(F.boss, bosses[els[0].index].key); }, onHover: pointer,
            plugins: { legend: legendStyle, tooltip: { ...tooltipStyle, mode: 'index', intersect: false, callbacks: {
                label: c => ` ${c.dataset.label}: ${bosses[c.dataIndex][KEYS[c.datasetIndex]]} (${pctTxt(c.parsed.x)})`,
                footer: items => { const b = bosses[items[0].dataIndex]; return `Localización: ${b.loc == null ? '—' : pctTxt(b.loc)} · ${fmt(b.total)} registros`; } } } },
            scales: { x: { stacked: true, min: 0, max: 100, ticks: { callback: v => v + '%', font: { size: 10 } }, grid: { color: C.grid } },
                      y: { stacked: true, ticks: { font: { size: 11, weight: '700' }, color: C.txt }, grid: { display: false } } }
        }
    });
}

function renderChartSecciones() {
    const canvas = $('chart-secciones'); resetChart('secciones');
    const noRows = State.filtered.filter(r => r.estado === 'no');
    const secs = groupAgg(noRows, r => r.seccion).sort((a, b) => b.total - a.total).slice(0, 10);
    if (chartEmpty(canvas, secs.length ? '' : 'No hay registros no encontrados 🎉')) return;
    $('wrap-secciones').style.height = Math.max(240, secs.length * 34 + 40) + 'px';
    State.charts.secciones = new Chart(canvas, {
        type: 'bar',
        data: { labels: secs.map(s => 'Sección ' + s.key), datasets: [{ data: secs.map(s => s.total), backgroundColor: secs.map((_, i) => i < 3 ? C.bad : C.bad + '80'), borderRadius: 5, borderSkipped: false, barPercentage: .7 }] },
        options: {
            indexAxis: 'y', responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: false }, tooltip: { ...tooltipStyle, callbacks: { label: c => ` ${fmt(c.parsed.x)} no encontradas (${pctTxt(c.parsed.x / noRows.length * 100)})` } } },
            scales: { x: { beginAtZero: true, ticks: { precision: 0, font: { size: 10 } }, grid: { color: C.grid } }, y: { ticks: { font: { size: 11, weight: '700' }, color: C.txt }, grid: { display: false } } }
        }
    });
}

function renderChartAuditores() {
    const canvas = $('chart-auditores'); resetChart('auditores');
    const auds = groupAgg(State.filtered.filter(r => r.auditor && r.estado !== 'pend'), r => r.auditor).sort((a, b) => b.total - a.total).slice(0, 10);
    if (chartEmpty(canvas, auds.length ? '' : 'Aún no hay auditores con estados capturados')) return;
    $('wrap-auditores').style.height = Math.max(240, auds.length * 34 + 60) + 'px';
    State.charts.auditores = new Chart(canvas, {
        type: 'bar',
        data: { labels: auds.map(a => a.key), datasets: ['buen', 'mal', 'no'].map(k => ({ label: ESTADOS[k].label, data: auds.map(a => a[k]), backgroundColor: ESTADOS[k].color, borderSkipped: false, barPercentage: .7 })) },
        options: {
            indexAxis: 'y', responsive: true, maintainAspectRatio: false,
            onClick: (_e, els) => { if (els[0]) toggleFilter(F.auditor, auds[els[0].index].key); }, onHover: pointer,
            plugins: { legend: legendStyle, tooltip: { ...tooltipStyle, mode: 'index', intersect: false } },
            scales: { x: { stacked: true, beginAtZero: true, ticks: { precision: 0, font: { size: 10 } }, grid: { color: C.grid } }, y: { stacked: true, ticks: { font: { size: 11, weight: '700' }, color: C.txt }, grid: { display: false } } }
        }
    });
}

function renderChartTendencia() {
    const canvas = $('chart-tendencia'); resetChart('tendencia');
    const dated = State.filtered.filter(r => r.fecha);
    const days = groupAgg(dated, r => { const d = r.fecha; return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }).sort((a, b) => a.key.localeCompare(b.key));
    if (chartEmpty(canvas, days.length ? '' : 'Los registros no tienen fecha de rechazo legible')) return;
    const labels = days.map(d => { const [y, m, dd] = d.key.split('-'); return fmtDate(new Date(+y, +m - 1, +dd)); });
    State.charts.tendencia = new Chart(canvas, {
        type: 'bar',
        data: { labels, datasets: [
            { type: 'line', label: 'Localización %', data: days.map(d => d.loc == null ? null : +d.loc.toFixed(1)), yAxisID: 'y1', borderColor: C.vino, backgroundColor: C.vino, borderWidth: 2.5, pointRadius: 3, pointBackgroundColor: '#fff', pointBorderWidth: 2, tension: .35, spanGaps: true, order: 0 },
            ...KEYS.map(k => ({ label: ESTADOS[k].label, data: days.map(d => d[k]), backgroundColor: ESTADOS[k].color, stack: 's', yAxisID: 'y', order: 1, maxBarThickness: 40 })),
        ] },
        options: {
            responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
            plugins: { legend: legendStyle, tooltip: { ...tooltipStyle, callbacks: { label: c => c.dataset.yAxisID === 'y1' ? ` Localización: ${c.parsed.y == null ? '—' : pctTxt(c.parsed.y)}` : ` ${c.dataset.label}: ${fmt(c.parsed.y)}` } } },
            scales: {
                x: { stacked: true, ticks: { font: { size: 10, weight: '600' }, maxRotation: 0, autoSkip: true }, grid: { display: false } },
                y: { stacked: true, beginAtZero: true, title: { display: true, text: 'Registros', font: { size: 10, weight: '700' } }, ticks: { precision: 0, font: { size: 10 } }, grid: { color: C.grid } },
                y1: { min: 0, max: 100, position: 'right', title: { display: true, text: 'Localización', font: { size: 10, weight: '700' } }, ticks: { callback: v => v + '%', font: { size: 10 } }, grid: { display: false } }
            }
        }
    });
}

// ── TARJETAS POR JEFATURA ────────────────────────────────────────────────────
function renderBossCards() {
    // Ignora el filtro de jefatura para poder comparar y alternar entre ellas
    const rows = State.rows.filter(r => (!F.file.value || r.file === F.file.value) && (!F.auditor.value || r.auditor === F.auditor.value) && (!F.status.value || r.estado === F.status.value));
    const bosses = groupAgg(rows, r => r.jefatura).sort((a, b) => (a.key === NO_BOSS) - (b.key === NO_BOSS) || (b.loc ?? -1) - (a.loc ?? -1) || b.total - a.total);
    const box = $('boss-cards');
    if (!bosses.length) { box.innerHTML = '<div class="db-empty" style="grid-column:1/-1">Sin datos por jefatura</div>'; return; }
    box.innerHTML = bosses.map((b, i) => {
        const tone = b.key === NO_BOSS ? 'none' : b.loc == null ? 'none' : toneOf(b.loc);
        const status = b.loc == null ? 'Sin revisar' : ({ good: 'Buen nivel', warn: 'Atención', bad: 'Crítico' })[tone] || 'Sin asignar';
        const worst = groupAgg(b.rows.filter(r => r.estado === 'no'), r => r.seccion).sort((x, y) => y.total - x.total)[0];
        const foot = b.pend ? `<i class="bi bi-hourglass-split"></i> <strong>${fmt(b.pend)}</strong> pendientes de revisar (${pctTxt(100 - b.avance)})`
            : worst ? `<i class="bi bi-exclamation-triangle-fill"></i> Más no encontradas: <strong>Sección ${esc(worst.key)}</strong> (${fmt(worst.total)})`
            : `<i class="bi bi-check-circle-fill"></i> Todo revisado y localizado`;
        return `<button type="button" class="db-area${F.boss.value === b.key ? ' is-active' : ''}" data-tone="${tone}" data-boss="${esc(b.key)}">
            <div class="db-area-head">
                <span class="db-area-rank">${b.key === NO_BOSS ? '?' : i + 1}</span>
                <div><div class="db-area-name">${esc(b.key)}</div><div class="db-area-meta">${fmt(b.total)} registros · ${uniq(b.rows.map(r => r.seccion)).length} secciones · ${pctTxt(b.avance)} revisado</div></div>
                <div class="db-area-pct"><strong>${b.loc == null ? '—' : pctTxt(b.loc)}</strong><small>${status}</small></div>
            </div>
            <div class="db-area-bar"><span style="width:${Math.min(b.loc ?? 0, 100)}%"></span><i style="left:${REF}%"></i></div>
            <div class="db-area-stats">
                <div class="db-area-stat"><b style="color:var(--ok)">${fmt(b.buen)}</b><small>Buen</small></div>
                <div class="db-area-stat sobr"><b>${fmt(b.mal)}</b><small>Mal</small></div>
                <div class="db-area-stat falt"><b>${fmt(b.no)}</b><small>No enc.</small></div>
                <div class="db-area-stat"><b>${fmt(b.pend)}</b><small>Pend.</small></div>
            </div>
            <div class="db-area-foot">${foot}</div>
        </button>`;
    }).join('');
    box.querySelectorAll('.db-area').forEach(el => el.addEventListener('click', () => toggleFilter(F.boss, el.dataset.boss)));
}

// ── TABLA AUDITORES ──────────────────────────────────────────────────────────
function renderAuditores() {
    const auds = groupAgg(State.filtered.filter(r => r.auditor && r.estado !== 'pend'), r => r.auditor)
        .map(a => ({ ...a, name: a.key, locSort: a.loc ?? -1 }));
    sortBy(auds, State.aud.sortKey === 'loc' ? 'locSort' : State.aud.sortKey, State.aud.sortDir);
    $('aud-count').textContent = `${fmt(auds.length)} auditores con actividad`;
    $('tbody-auditores').innerHTML = auds.map((a, i) => `<tr>
            <td><span class="db-area-rank" style="width:26px;height:26px;font-size:.7rem">${i + 1}</span></td>
            <td><strong>${esc(a.name)}</strong></td>
            <td class="num">${fmt(a.total)}</td>
            <td class="num" style="color:var(--ok);font-weight:700">${fmt(a.buen)}</td>
            <td class="num ${a.mal ? 'sobr' : 'zero'}">${fmt(a.mal)}</td>
            <td class="num ${a.no ? 'falt' : 'zero'}">${fmt(a.no)}</td>
            <td class="num">${fmt(a.piezas)}</td>
            <td class="num">${a.loc == null ? '—' : `<span class="badge-pct ${toneOf(a.loc)}">${pctTxt(a.loc)}</span>`}</td>
        </tr>`).join('') || '<tr><td colspan="8" class="empty">Aún no hay auditores con estados capturados</td></tr>';
    markSort('table-auditores', State.aud);
}

// ── TABLA DETALLE ────────────────────────────────────────────────────────────
function renderDetalle() {
    const rows = State.filtered, counts = countBy(rows, r => r.estado);
    $('det-chips').innerHTML = [['', 'Todos', rows.length], ...KEYS.map(k => [k, ESTADOS[k].label, counts[k] || 0])]
        .map(([k, l, n]) => `<button class="db-chip${State.det.status === k ? ' active' : ''}" data-status="${k}">${l} <span>${fmt(n)}</span></button>`).join('');
    $('det-chips').querySelectorAll('.db-chip').forEach(ch => ch.addEventListener('click', () => { State.det.status = ch.dataset.status; State.det.page = 1; renderDetalle(); }));

    const q = clean(State.det.search);
    const list = rows.filter(r => (!State.det.status || r.estado === State.det.status) &&
        (!q || clean([r.remision, r.sku, r.desc, r.seccion, r.jefatura, r.usuario, r.auditor, r.comentarios].join(' ')).includes(q)));
    sortBy(list, State.det.sortKey, State.det.sortDir);
    const pages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
    State.det.page = Math.min(State.det.page, pages);
    const start = (State.det.page - 1) * PAGE_SIZE;
    $('det-count').textContent = `${fmt(list.length)} de ${fmt(rows.length)} registros`;
    $('tbody-detalle').innerHTML = list.slice(start, start + PAGE_SIZE).map(r => `<tr>
            <td><span class="db-mono">${esc(r.remision || '—')}</span></td>
            <td><span class="db-mono">${esc(r.sku || '—')}</span></td>
            <td><span class="pdis-desc" title="${esc(r.desc)}">${esc(r.desc || '—')}</span>${r.comentarios ? `<span class="sub" title="${esc(r.comentarios)}"><i class="bi bi-chat-left-text"></i> ${esc(truncate(r.comentarios, 40))}</span>` : ''}</td>
            <td>${esc(r.seccion)}</td>
            <td>${r.jefatura === NO_BOSS ? `<span class="db-noarea"><i class="bi bi-exclamation-triangle-fill"></i>${NO_BOSS}</span>` : esc(r.jefatura)}</td>
            <td class="num">${fmt(r.piezas)}</td>
            <td>${r.fecha ? fmtDateTime(r.fecha) : '—'}</td>
            <td>${esc(r.usuario || '—')}</td>
            <td>${esc(r.auditor || '—')}</td>
            <td><span class="db-status ${r.estado}" title="${esc(r.statusRaw || 'Sin estado')}"><i class="bi ${ESTADOS[r.estado].icon}"></i>${ESTADOS[r.estado].label}</span></td>
        </tr>`).join('') || '<tr><td colspan="10" class="empty">Ningún registro coincide con la búsqueda</td></tr>';
    markSort('table-detalle', State.det);
    renderPager(list.length, pages);
}

function renderPager(total, pages) {
    const p = State.det.page, pager = $('det-pager');
    if (total <= PAGE_SIZE) { pager.innerHTML = `<span>Mostrando ${fmt(total)} registros</span>`; return; }
    const nums = [];
    for (let i = 1; i <= pages; i++) if (i === 1 || i === pages || Math.abs(i - p) <= 1) nums.push(i); else if (nums[nums.length - 1] !== '…') nums.push('…');
    pager.innerHTML = `<span>Mostrando ${fmt(start1(p))}–${fmt(Math.min(p * PAGE_SIZE, total))} de ${fmt(total)}</span>
        <div class="db-pager-btns">
            <button data-page="${p - 1}" ${p === 1 ? 'disabled' : ''} aria-label="Anterior"><i class="bi bi-chevron-left"></i></button>
            ${nums.map(n => n === '…' ? '<button disabled>…</button>' : `<button data-page="${n}" class="${n === p ? 'active' : ''}">${n}</button>`).join('')}
            <button data-page="${p + 1}" ${p === pages ? 'disabled' : ''} aria-label="Siguiente"><i class="bi bi-chevron-right"></i></button>
        </div>`;
    pager.querySelectorAll('[data-page]').forEach(b => b.addEventListener('click', () => { State.det.page = +b.dataset.page; renderDetalle(); }));
}
const start1 = p => (p - 1) * PAGE_SIZE + 1;

let searchTimer;
$('det-search').addEventListener('input', e => { clearTimeout(searchTimer); searchTimer = setTimeout(() => { State.det.search = e.target.value; State.det.page = 1; renderDetalle(); }, 180); });

function bindSort(tableId, st, rerender) {
    document.querySelectorAll(`#${tableId} thead th[data-sort]`).forEach(th => th.addEventListener('click', () => {
        const key = th.dataset.sort;
        if (st.sortKey === key) st.sortDir = st.sortDir === 'asc' ? 'desc' : 'asc';
        else { st.sortKey = key; st.sortDir = th.classList.contains('num') || key === 'fechaSort' ? 'desc' : 'asc'; }
        if ('page' in st) st.page = 1;
        rerender();
    }));
}
function markSort(tableId, st) {
    document.querySelectorAll(`#${tableId} thead th[data-sort]`).forEach(th => {
        th.classList.toggle('sort-asc', th.dataset.sort === st.sortKey && st.sortDir === 'asc');
        th.classList.toggle('sort-desc', th.dataset.sort === st.sortKey && st.sortDir === 'desc');
    });
}
bindSort('table-detalle', State.det, renderDetalle);
bindSort('table-auditores', State.aud, renderAuditores);

// ── ARCHIVOS ─────────────────────────────────────────────────────────────────
function renderFiles() {
    $('files-count').textContent = `${fmt(State.files.length)} archivos`;
    $('pdis-files').innerHTML = State.files.length ? State.files.map(f => {
        const t = agg(State.rows.filter(r => r.file === f.name));
        return `<div class="db-file${F.file.value === f.name ? ' is-active' : ''}" style="cursor:pointer" data-file="${esc(f.name)}" title="Ver solo este archivo">
            <span class="db-file-icon pdis"><i class="bi bi-file-earmark-spreadsheet-fill"></i></span>
            <div style="min-width:0">
                <div class="db-file-name">${esc(f.name)} <span class="db-tag">v${esc(f.version)}</span></div>
                <div class="db-file-meta">${fmtDateTime(f.date)} · ${(Number(f.size || 0) / 1024).toFixed(1)} KB${f.error ? ' · <span style="color:var(--bad)">no se pudo leer</span>' : ''}</div>
            </div>
            <div class="db-file-stats">${fmt(t.total)} registros<br>${pctTxt(t.avance)} revisado</div>
            <span class="db-badge-loc">${t.loc == null ? '<span class="badge-pct">—</span>' : `<span class="badge-pct ${toneOf(t.loc)}">${pctTxt(t.loc)}</span>`}</span>
        </div>`;
    }).join('') : '<div class="db-file-empty">No hay archivos PDIS todavía. Súbelos desde el Gestor de PDIS.</div>';
    $('pdis-files').querySelectorAll('[data-file]').forEach(el => el.addEventListener('click', () => toggleFilter(F.file, el.dataset.file)));
}

// ── EXPORTAR ─────────────────────────────────────────────────────────────────
$('btn-export').addEventListener('click', () => {
    const rows = State.filtered;
    if (!rows.length) return;
    const t = agg(rows), wb = XLSX.utils.book_new();
    const r1 = n => Math.round(n * 10) / 10;
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
        ['Dashboard PDIS — Sistema Liverpool'], ['Generado', fmtDateTime(new Date())],
        ['Archivo', F.file.value || 'Todos'], ['Jefatura', F.boss.value || 'Todas'], ['Auditor', F.auditor.value || 'Todos'], ['Estado', F.status.value ? ESTADOS[F.status.value].label : 'Todos'], [],
        ['Indicador', 'Valor'], ['Registros', t.total], ['Piezas', t.piezas], ['Revisados', t.revisados], ['Avance %', r1(t.avance)],
        ['Buen estado', t.buen], ['Mal estado / merma', t.mal], ['No encontradas', t.no], ['Pendientes', t.pend], ['Localización %', r1(t.loc ?? 0)], ['Referencia %', REF],
    ]), 'Resumen');
    const sheet = (list, name) => XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(list), name);
    sheet(groupAgg(rows, r => r.jefatura).sort((a, b) => (b.loc ?? -1) - (a.loc ?? -1)).map(b => ({ Jefatura: b.key, Registros: b.total, 'Buen estado': b.buen, 'Mal estado': b.mal, 'No encontradas': b.no, Pendientes: b.pend, 'Avance %': r1(b.avance), 'Localización %': b.loc == null ? '' : r1(b.loc) })), 'Jefaturas');
    sheet(groupAgg(rows.filter(r => r.auditor && r.estado !== 'pend'), r => r.auditor).sort((a, b) => b.total - a.total).map(a => ({ Auditor: a.key, Revisados: a.total, 'Buen estado': a.buen, 'Mal estado': a.mal, 'No encontradas': a.no, Piezas: a.piezas, 'Localización %': a.loc == null ? '' : r1(a.loc) })), 'Auditores');
    sheet(rows.map(r => ({ Archivo: r.file, Remisión: r.remision, SKU: r.sku, Descripción: r.desc, Sección: r.seccion, Jefatura: r.jefatura, Piezas: r.piezas, 'Fecha rechazo': r.fecha ? fmtDateTime(r.fecha) : '', 'Usuario rechazo': r.usuario, Auditor: r.auditor, 'Status original': r.statusRaw, Estado: ESTADOS[r.estado].label, Comentarios: r.comentarios })), 'Detalle');
    XLSX.writeFile(wb, `pdis_${new Date().toISOString().slice(0, 10)}.xlsx`);
});

// ── AUTH ─────────────────────────────────────────────────────────────────────
$('logout-btn').addEventListener('click', () => firebase.auth().signOut());
firebase.auth().onAuthStateChanged(user => {
    if (!user) { window.location.href = '../../Login/login.html'; return; }
    const h = new Date().getHours(), greet = h < 12 ? 'Buenos días' : h < 19 ? 'Buenas tardes' : 'Buenas noches';
    $('hero-greeting').textContent = `${greet}, ${user.displayName || user.email?.split('@')[0] || 'usuario'}`;
    loadPdisDashboard();
});
