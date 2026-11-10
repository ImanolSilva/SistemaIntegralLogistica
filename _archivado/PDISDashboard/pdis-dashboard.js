const pdisConfig = {
  apiKey: "AIzaSyD1-ZhYGtJzJFY4WfSUS_lbnzLhzWfT1D8",
  authDomain: "sistemaintegrall.firebaseapp.com",
  projectId: "sistemaintegrall",
  storageBucket: "sistemaintegrall.firebasestorage.app",
  messagingSenderId: "302291844621",
  appId: "1:302291844621:web:6ebf1845790bdeabfc1f44"
};
if (!firebase.apps.length) firebase.initializeApp(pdisConfig);
const pdisStorage = firebase.storage();
const filesBox = document.getElementById('pdis-files');
const resultsBox = document.getElementById('pdis-results');
const kpis = document.getElementById('pdis-kpis');
const safe = value => String(value ?? '').replace(/[&<>]/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;' }[char]));
const key = value => String(value || 'Sin Estado').trim().toLowerCase();

async function loadPdisDashboard() {
  filesBox.innerHTML = '<div class="pdis-empty"><i class="bi bi-arrow-repeat spin"></i><strong>Consultando archivos y resultados...</strong></div>';
  try {
    const list = await pdisStorage.ref('uploads').listAll();
    const files = await Promise.all(list.items.filter(item => /pdis|rechazos/i.test(item.name)).map(async ref => {
      const metadata = await ref.getMetadata();
      return { ref, name: ref.name, version: metadata.customMetadata?.version || '1', date: new Date(metadata.customMetadata?.originalUploadDate || metadata.timeCreated), size: metadata.size };
    }));
    files.sort((a, b) => b.date - a.date);
    const rows = [];
    for (const file of files) {
      try {
        const response = await fetch(await file.ref.getDownloadURL());
        const workbook = XLSX.read(await response.arrayBuffer(), { type: 'array' });
        if (workbook.Sheets.Rechazos) rows.push(...XLSX.utils.sheet_to_json(workbook.Sheets.Rechazos, { defval: '' }));
      } catch (error) { console.warn('No se pudo analizar', file.name, error); }
    }
    const status = { 'sin estado': 0, 'sí encontrada': 0, 'no encontrada': 0, 'encontrada en exhibición': 0, 'encontrada merma': 0 };
    const bosses = {};
    let pieces = 0;
    rows.forEach(row => { pieces += Number(row.Piezas) || 0; const state = key(row.Status); status[state] = (status[state] || 0) + 1; const boss = String(row.Jefatura || 'Sin asignar'); bosses[boss] = (bosses[boss] || 0) + 1; });
    const topBosses = Object.entries(bosses).sort((a, b) => b[1] - a[1]).slice(0, 5);
    const latest = files[0];
    kpis.innerHTML = `<div class="pdis-kpi"><i class="bi bi-file-earmark-text"></i><div><strong>${rows.length.toLocaleString('es-MX')}</strong><span>Reportes consolidados</span></div></div><div class="pdis-kpi"><i class="bi bi-box-seam"></i><div><strong>${pieces.toLocaleString('es-MX')}</strong><span>Piezas registradas</span></div></div><div class="pdis-kpi"><i class="bi bi-files"></i><div><strong>${files.length}</strong><span>Archivos analizados · ${latest ? latest.date.toLocaleDateString('es-MX') : '—'}</span></div></div>`;
    const states = [['sí encontrada', 'Sí encontrada', 'ok'], ['no encontrada', 'No encontrada', 'bad'], ['encontrada en exhibición', 'En exhibición', 'info'], ['encontrada merma', 'En merma', 'warn'], ['sin estado', 'Sin estado', 'neutral']];
    resultsBox.innerHTML = `<div class="pdis-result-grid">${states.map(([state, label, cls]) => `<div class="result-pill ${cls}"><span>${label}</span><strong>${(status[state] || 0).toLocaleString('es-MX')}</strong></div>`).join('')}</div><div class="pdis-analysis-grid"><div><h4><i class="bi bi-bar-chart-fill"></i> Reportes por jefatura</h4>${topBosses.length ? topBosses.map(([name, count]) => `<div class="boss-row"><span>${safe(name)}</span><strong>${count}</strong></div>`).join('') : '<div class="pdis-muted">Sin datos de jefatura.</div>'}</div><div><h4><i class="bi bi-info-circle"></i> Lectura rápida</h4><p class="pdis-reading">Se analizaron <strong>${rows.length.toLocaleString('es-MX')}</strong> reportes de <strong>${files.length}</strong> archivos.</p></div></div>`;
    filesBox.innerHTML = files.length ? files.map(file => `<article class="pdis-file-row"><div class="pdis-file-icon"><i class="bi bi-file-earmark-spreadsheet-fill"></i></div><div class="pdis-file-main"><strong>${safe(file.name)}</strong><span>${file.date.toLocaleDateString('es-MX')} · ${(Number(file.size || 0) / 1024).toFixed(1)} KB</span></div><span class="pdis-version">v${safe(file.version)}</span></article>`).join('') : '<div class="pdis-empty"><i class="bi bi-folder2-open"></i><strong>No hay archivos PDIS todavía</strong><span>Sube el primer archivo desde el Gestor PDIS.</span></div>';
  } catch (error) { resultsBox.innerHTML = '<div class="pdis-empty error"><i class="bi bi-exclamation-triangle"></i><strong>No se pudieron calcular los resultados</strong><span>Revisa la sesión y los permisos de Firebase Storage.</span></div>'; console.error(error); }
}
firebase.auth().onAuthStateChanged(user => { if (user) loadPdisDashboard(); else window.location.href = '../../Login/login.html'; });
document.getElementById('refresh-pdis').addEventListener('click', loadPdisDashboard);
document.getElementById('logout-btn').addEventListener('click', () => firebase.auth().signOut());
