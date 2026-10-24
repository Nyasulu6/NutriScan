const main = document.querySelector('#main');
const nav = document.querySelector('#nav');
let user;
let downloadRows = [];
let callback = null;
const path = location.pathname.replace(/\/$/, '') || '/';
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const rounded = (value, digits = 1) => Number(value).toFixed(digits);
const pill = status => `<span class="pill ${escape(status)}">${escape(status)}</span>`;
const intro = (label, title, text = '') => `<div class="intro"><div class="eyebrow">${label}</div><h1>${title}</h1>${text ? `<p>${text}</p>` : ''}</div>`;
const notice = () => '<div id="notice" class="notice" role="status" aria-live="polite"></div>';
function message(text, error = false) {
  const el = document.querySelector('#notice');
  if (el) { el.textContent = text; el.className = `notice ${error ? 'error' : 'success'}`; }
}
async function api(route, data) {
  const response = await fetch(`/api${route}`, { method: data ? 'POST' : 'GET', headers: data ? { 'Content-Type': 'application/json' } : {}, body: data ? JSON.stringify(data) : undefined });
  let payload;
  try { payload = await response.json(); } catch { throw new Error('The service is unavailable. Please try again shortly.'); }
  if (!response.ok) {
    if (response.status === 401 && !route.startsWith('/auth')) { location.assign('/login'); }
    throw new Error(payload.error || 'The request could not be completed.');
  }
  return payload;
}
function busyForm(form, handler) {
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const button = form.querySelector('[type=submit]');
    const label = button.textContent;
    button.disabled = true; button.textContent = 'Please wait…';
    message('');
    try { await handler(new FormData(form)); }
    catch (error) { message(error.message || 'The request failed. Please try again.', true); }
    finally { button.disabled = false; button.textContent = label; }
  });
}
function navigation() {
  nav.innerHTML = user ? [['/', 'Dashboard'], ['/assess', 'Assess child'], ['/bulk', 'Bulk analysis'], ['/records', 'Records'], ...(user.roles.includes('admin') ? [['/admin', 'Admin']] : [])].map(([href, title]) => `<a href="${href}" ${path === href ? 'aria-current="page"' : ''}>${title}</a>`).join('') + '<button id="logout" class="link-button" type="button">Sign out</button>' : '<a href="/login">Sign in</a><a href="/register">Create account</a>';
  document.querySelector('#logout')?.addEventListener('click', async event => {
    event.target.disabled = true;
    try { await api('/auth', { action: 'logout' }); location.assign('/login'); }
    catch (error) { event.target.disabled = false; message(error.message, true); }
  });
}
function auth(mode = 'login') {
  const titles = { login: 'Sign in', signup: 'Create account', recover: 'Reset your password', reset: 'Set a new password', invite: 'Accept your invitation' };
  const title = titles[mode];
  document.title = `${title} · NutriScan`;
  main.innerHTML = `<div class="auth-layout"><section class="auth-copy"><div class="eyebrow">Child nutrition assessment</div><h1>Better information.<br>More informed care.</h1><div class="rule"></div><p>Assess nutritional status, review recommendations, and keep a clear record of each child’s progress.</p><p class="help">NutriScan accounts now use email addresses. Create an account to use this version.</p></section><section class="card"><h2>${title}</h2>${notice()}<form id="auth-form">${mode === 'signup' ? '<label for="name">Your name</label><input id="name" name="name" maxlength="100" autocomplete="name" required>' : ''}${!['reset', 'invite'].includes(mode) ? '<label for="email">Email address</label><input id="email" type="email" name="email" autocomplete="email" maxlength="254" required>' : ''}${mode !== 'recover' ? `<label for="password">Password</label><input id="password" type="password" name="password" minlength="6" maxlength="256" autocomplete="${mode === 'login' ? 'current-password' : 'new-password'}" required>` : ''}<button class="full" type="submit">${title}</button></form><p class="help">${mode === 'login' ? '<a href="/register">Create account</a> &nbsp; · &nbsp; <a href="/recover">Forgot password?</a>' : '<a href="/login">Back to sign in</a>'}</p></section></div>`;
  busyForm(document.querySelector('#auth-form'), async form => {
    const result = await api('/auth', { ...Object.fromEntries(form), action: mode, ...(callback ? { token: callback.token } : {}) });
    if (['login', 'reset', 'invite'].includes(mode)) { location.assign('/'); return; }
    message(result.message);
  });
}
function table(rows, detailed = false) {
  if (!rows.length) return '<div class="empty"><h3>No assessments yet</h3><p>Start with a child’s measurements to create your first record.</p><a class="button" href="/assess">New assessment</a></div>';
  return `<div class="table-wrap"><table><thead><tr><th>Date</th><th>Child / ID</th><th>Age (m)</th>${detailed ? '<th>Weight (kg)</th><th>Height (cm)</th>' : ''}<th>MUAC (cm)</th><th>Status</th>${detailed ? '<th>Confidence</th>' : ''}</tr></thead><tbody>${rows.map(row => `<tr><td>${escape(new Date(row.created).toLocaleDateString())}</td><td>${escape(row.child || '—')}</td><td>${rounded(row.age_months)}</td>${detailed ? `<td>${rounded(row.weight_kg)}</td><td>${rounded(row.height_cm)}</td>` : ''}<td>${rounded(row.muac_cm)}</td><td>${pill(row.status)}</td>${detailed ? `<td>${rounded(row.confidence * 100, 0)}%</td>` : ''}</tr>`).join('')}</tbody></table></div>`;
}
function stats(counts) {
  const map = Object.fromEntries(counts.map(c => [c.status, Number(c.count)]));
  return `<div class="stats">${[['total', Object.values(map).reduce((a, b) => a + b, 0), 'Assessments'], ['normal', map.normal || 0, 'Normal'], ['moderate', map.moderate || 0, 'Moderate risk'], ['severe', map.severe || 0, 'Severe risk']].map(([key, number, label]) => `<div class="stat"><span>${label}</span><strong>${number}</strong>${key === 'total' ? '<span>Recorded to date</span>' : pill(key)}</div>`).join('')}</div>`;
}
async function dashboard() {
  document.title = 'Dashboard · NutriScan';
  main.innerHTML = intro('Nutrition overview', 'Dashboard', `Welcome, ${escape(user.name || user.email)}.`) + notice() + '<p class="loading" role="status">Loading assessments…</p>';
  const data = await api('/records');
  main.innerHTML = intro('Nutrition overview', 'Dashboard', `Welcome, ${escape(user.name || user.email)}. ${user.roles.includes('admin') ? 'Showing assessments across all accounts.' : 'Your assessments at a glance.'}`) + notice() + stats(data.counts) + `<section class="card"><div class="row spaced"><h2>Recent assessments</h2><a class="button" href="/assess">New assessment</a></div>${table(data.rows.slice(0, 8))}<a href="/records">View records →</a></section>`;
}
function assessment() {
  document.title = 'Assess a child · NutriScan';
  const fields = [['age_months', 'Age (months)', 0, 60], ['weight_kg', 'Weight (kg)', 1, 30], ['height_cm', 'Height / length (cm)', 40, 125], ['muac_cm', 'MUAC (cm)', 5, 25]];
  main.innerHTML = intro('Individual assessment', 'Assess a child', 'Enter current measurements to predict nutritional status and review recommendations.') + notice() + `<div class="split"><section class="card"><h2>Child’s measurements</h2><form id="assessment"><label for="child">Child name / ID <span class="muted">(optional)</span></label><input id="child" name="child" maxlength="150"><div class="fields">${fields.map(([key, label, min, max]) => `<div><label for="${key}">${label}</label><input id="${key}" name="${key}" type="number" min="${min}" max="${max}" step="any" required><span class="help">${min}–${max}</span></div>`).join('')}</div><button type="submit">Predict &amp; recommend</button></form></section><aside class="aside"><h3>Before you assess</h3><p>Confirm the child’s age and check that weight, height, and upper arm circumference use the units shown.</p><p>MUAC below 11.5 cm raises the result to severe risk, following the original NutriScan rule.</p><p>For infants under 6 months, prioritise breastfeeding support and specialist assessment when at risk.</p></aside></div><div id="result" aria-live="polite"></div>`;
  busyForm(document.querySelector('#assessment'), async form => {
    const { rows } = await api('/assess', Object.fromEntries(form));
    const row = rows[0];
    document.querySelector('#result').innerHTML = `<section class="card result ${row.status}">${pill(row.status)}<h2 style="margin-top:16px">${escape(row.title)}</h2><p>Model confidence: <b>${rounded(row.confidence * 100, 0)}%</b> · BMI: <b>${rounded(row.bmi)}</b></p>${row.rule_override ? '<p class="notice">Status raised to severe by the MUAC &lt; 11.5 cm rule. Confidence refers to the original model prediction.</p>' : ''}${row.flags.length ? `<h3>Clinical flags</h3><ul>${row.flags.map(flag => `<li>${escape(flag)}</li>`).join('')}</ul>` : ''}<h3>Recommended interventions</h3><ul>${row.recommendations.map(rec => `<li>${escape(rec)}</li>`).join('')}</ul><p class="help">Saved to your records.</p></section>`;
    document.querySelector('#result').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
}
// RFC 4180-style quoted fields, including commas, quotes and embedded newlines.
function parseCSV(text) {
  text = text.replace(/^\uFEFF/, '');
  const rows = []; let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') { field += '"'; i++; }
      else if (quoted || !field.length) quoted = !quoted;
      else throw new Error('Invalid quote in CSV.');
    } else if (c === ',' && !quoted) { row.push(field); field = ''; }
    else if ((c === '\n' || c === '\r') && !quoted) {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); if (row.some(v => v.trim())) rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (quoted) throw new Error('CSV has an unclosed quoted field.');
  row.push(field); if (row.some(v => v.trim())) rows.push(row);
  const headers = rows.shift()?.map(v => v.trim()) || [];
  for (const key of ['age_months', 'weight_kg', 'height_cm', 'muac_cm']) if (!headers.includes(key)) throw new Error(`Missing column: ${key}`);
  if (new Set(headers).size !== headers.length) throw new Error('CSV column names must be unique.');
  return rows.map((values, index) => {
    if (values.length !== headers.length) throw new Error(`CSV row ${index + 2} has the wrong number of columns.`);
    return Object.fromEntries(headers.map((header, i) => [header, values[i]]));
  });
}
function download(rows, filename) {
  const columns = ['child', 'created', 'age_months', 'weight_kg', 'height_cm', 'muac_cm', 'bmi', 'status', 'confidence'];
  const cell = value => {
    let text = String(value ?? '');
    if (/^[\s]*[=+@-]/.test(text)) text = `'${text}`;
    return `"${text.replaceAll('"', '""')}"`;
  };
  const csv = '\uFEFF' + [columns.join(','), ...rows.map(row => columns.map(col => cell(row[col])).join(','))].join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function bulk() {
  document.title = 'Bulk analysis · NutriScan';
  main.innerHTML = intro('Group assessment', 'Bulk analysis', 'Analyse up to 500 children at a time from a CSV file.') + notice() + '<section class="card"><h2>Upload measurements</h2><p>Required columns: <code>age_months, weight_kg, height_cm, muac_cm</code>. Add an optional <code>child</code> column for names or IDs.</p><form id="bulk-form"><label for="file">CSV file (maximum 1 MB)</label><input id="file" name="file" type="file" accept=".csv,text/csv" required><button type="submit">Analyse &amp; save</button></form></section><div id="bulk-result"></div>';
  busyForm(document.querySelector('#bulk-form'), async form => {
    const file = form.get('file');
    if (!file || file.size > 1_000_000) throw new Error('Choose a CSV file smaller than 1 MB.');
    const rows = parseCSV(await file.text());
    if (!rows.length || rows.length > 500) throw new Error('Use between 1 and 500 rows per file.');
    const data = await api('/assess', { rows });
    const order = { severe: 0, moderate: 1, normal: 2 };
    downloadRows = data.rows.sort((a, b) => order[a.status] - order[b.status]);
    const counts = ['normal', 'moderate', 'severe'].map(status => ({ status, count: data.rows.filter(row => row.status === status).length }));
    const severe = counts.find(c => c.status === 'severe').count;
    const moderate = counts.find(c => c.status === 'moderate').count;
    document.querySelector('#bulk-result').innerHTML = stats(counts) + `<section class="card"><div class="row spaced"><h2>${data.rows.length} assessments saved</h2><button id="download" type="button">Download predictions CSV</button></div>${table(downloadRows.slice(0, 100), true)}${data.rows.length > 100 ? '<p class="help">Showing the first 100, most severe first. Download the CSV for all results.</p>' : ''}<h3>Programme-level actions</h3><ul>${severe ? `<li>${severe} child(ren) need urgent referral / therapeutic feeding.</li>` : ''}${moderate ? `<li>${moderate} child(ren) need supplementary feeding and 2-weekly follow-up.</li>` : ''}<li>Maintain growth monitoring, nutrition education, and WASH for all.</li></ul></section>`;
    document.querySelector('#download').onclick = () => download(downloadRows, 'predictions.csv');
    message('All assessments saved.');
  });
}
async function recordsPage() {
  document.title = 'Records · NutriScan';
  main.innerHTML = intro('Assessment history', 'Records') + notice() + '<p class="loading" role="status">Loading records…</p>';
  const data = await api('/records');
  main.innerHTML = intro('Assessment history', 'Records', `Showing the most recent 500 assessments ${user.roles.includes('admin') ? 'across all accounts' : 'from your account'}.`) + notice() + `<section class="card"><div class="row spaced"><h2>Saved assessments</h2><button id="export" type="button">${user.roles.includes('admin') ? 'Export all records' : 'Download shown records'}</button></div>${table(data.rows, true)}</section>`;
  document.querySelector('#export').onclick = async event => {
    event.target.disabled = true;
    try { const rows = user.roles.includes('admin') ? (await api('/records/export')).rows : data.rows; download(rows, 'nutriscan-records.csv'); }
    catch (error) { message(error.message, true); }
    finally { event.target.disabled = false; }
  };
  if (path === '/records/export' && user.roles.includes('admin')) document.querySelector('#export').click();
}
async function adminPage() {
  document.title = 'Administration · NutriScan';
  if (!user.roles.includes('admin')) { main.innerHTML = intro('Access restricted', 'Admin access required') + '<p><a href="/">Return to dashboard</a></p>'; return; }
  main.innerHTML = intro('Administration', 'Users & model') + notice() + '<p class="loading" role="status">Loading administration…</p>';
  const { users, info } = await api('/admin');
  main.innerHTML = intro('Administration', 'Users & model') + notice() + `<section class="card"><h2>Accounts</h2><p class="help">Showing up to 1,000 accounts. Password resets send a recovery email.</p><div class="table-wrap"><table><thead><tr><th>User</th><th>Role</th><th>Active</th><th>Actions</th></tr></thead><tbody>${users.map(u => `<tr><td>${escape(u.name || u.email)}</td><td>${u.roles.includes('admin') ? 'Admin' : 'User'}</td><td>${u.active ? 'Yes' : 'No'}</td><td>${u.id === user.id ? 'Current account' : `<div class="row">${[['toggle', 'Enable / disable'], ['role', 'Toggle admin'], ['reset', 'Send reset email'], ['delete', 'Delete']].map(([action, title]) => `<button type="button" class="small ${action === 'delete' ? 'danger' : 'secondary'}" data-user="${escape(u.id)}" data-action="${action}">${title}</button>`).join('')}</div>`}</td></tr>`).join('')}</tbody></table></div></section><section class="card"><h2>Trained model</h2><p><b>${escape(info.best)}</b> · Test accuracy ${rounded(info.test_accuracy * 100)}% · Macro F1 ${rounded(info.test_f1_macro, 3)} · ${info.n_rows} training rows</p><div class="table-wrap"><table><thead><tr><th>Class</th><th>Precision</th><th>Recall</th><th>F1</th></tr></thead><tbody>${Object.entries(info.report).map(([status, report]) => `<tr><td>${pill(status)}</td><td>${rounded(report.precision, 3)}</td><td>${rounded(report.recall, 3)}</td><td>${rounded(report['f1-score'], 3)}</td></tr>`).join('')}</tbody></table></div><p class="help">This deployment uses the original fitted logistic regression model. Retraining runs through the Python training workflow, followed by model export and redeployment. In-browser retraining is unavailable.</p></section>`;
  document.querySelectorAll('[data-user]').forEach(button => button.onclick = async () => {
    const action = button.dataset.action;
    if (['delete', 'role', 'toggle'].includes(action) && !confirm(`${button.textContent} for this account?`)) return;
    button.disabled = true;
    try { await api('/admin/user', { id: button.dataset.user, action }); await adminPage(); message(action === 'reset' ? 'Password recovery email sent.' : 'Account updated.'); }
    catch (error) { message(error.message, true); button.disabled = false; }
  });
}
async function start() {
  try {
    const params = new URLSearchParams(location.hash.slice(1));
    for (const [key, type] of [['confirmation_token', 'confirm'], ['recovery_token', 'reset'], ['invite_token', 'invite']]) {
      if (params.has(key)) { callback = { type, token: params.get(key) }; history.replaceState(null, '', location.pathname + location.search); break; }
    }
    if (callback?.type === 'confirm') { await api('/auth', { action: 'confirm', token: callback.token }); location.replace('/'); return; }
    if (callback) { navigation(); auth(callback.type); return; }
    user = (await api('/session')).user;
    navigation();
    if (path === '/register') { auth('signup'); return; }
    if (path === '/recover') { auth('recover'); return; }
    if (path === '/login') { if (user) location.replace('/'); else auth(); return; }
    const routes = ['/', '/assess', '/bulk', '/bulk/download', '/records', '/records/export', '/admin', '/logout'];
    if (!routes.includes(path)) { main.innerHTML = intro('NutriScan', 'Page not found', 'This address does not match a NutriScan page.') + '<a class="button" href="/">Go to homepage</a>'; return; }
    if (!user) { auth(); return; }
    if (path === '/logout') { await api('/auth', { action: 'logout' }); location.replace('/login'); return; }
    if (path === '/') await dashboard();
    else if (path === '/assess') assessment();
    else if (path.startsWith('/bulk')) { bulk(); if (path.endsWith('/download')) message('Upload your CSV to generate a new download. Saved assessments are also available under Records.'); }
    else if (path.startsWith('/records')) await recordsPage();
    else if (path === '/admin') await adminPage();
  } catch (error) {
    const loading = document.querySelector('.loading');
    if (loading) loading.remove();
    if (!document.querySelector('#notice')) main.innerHTML = intro('NutriScan', 'Unable to complete the request') + notice() + '<p><a href="/">Try again</a></p>';
    message(error.message || 'Please try again shortly.', true);
  }
}
start();
