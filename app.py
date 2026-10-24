import os, io, sqlite3, json, datetime as dt
import joblib, pandas as pd
from functools import wraps
from flask import Flask, request, session, redirect, url_for, render_template, flash, g, Response
from jinja2 import DictLoader
from werkzeug.security import generate_password_hash, check_password_hash
from train import train, prep, RAW, FEATS

app = Flask(__name__)
app.secret_key = os.environ.get('SECRET_KEY', 'change-me-in-production')
DB = 'nutriscan.db'
LIMITS = {'age_months': (0, 60), 'weight_kg': (1, 30), 'height_cm': (40, 125), 'muac_cm': (5, 25)}
M = joblib.load('model.joblib') if os.path.exists('model.joblib') else None

REC = {
 'normal': ('Normal nutritional status', 'success', [
   'Continue exclusive breastfeeding to 6 months, then complementary foods with continued breastfeeding to 24 months.',
   'Give a diverse diet: staple + legumes + vegetables/fruit + animal-source foods (eggs, fish, milk).',
   'Keep routine growth monitoring and immunisation, vitamin A and deworming schedules.',
   'Reinforce hygiene: handwashing, safe water, latrine use.']),
 'moderate': ('Moderate acute malnutrition risk', 'warning', [
   'Enrol in a supplementary feeding programme (e.g. CSB+/RUSF) per national guidelines.',
   'Increase meal frequency (5-6 small meals/day) and energy-dense foods: groundnut paste, oil, soya, eggs, fish.',
   'Screen for and treat infections (malaria, diarrhoea, respiratory); give zinc with ORS for diarrhoea.',
   'Review every 2 weeks (weight, MUAC); refer if no improvement in 4 weeks or if status worsens.',
   'Counsel caregivers on feeding, hygiene, and household food security / social support.']),
 'severe': ('Severe acute malnutrition risk', 'danger', [
   'URGENT: refer for clinical assessment today (appetite test, oedema check, danger signs).',
   'Uncomplicated SAM with good appetite: outpatient therapeutic programme with RUTF. With complications or poor appetite: inpatient stabilisation centre (NRU).',
   'Give routine antibiotics, treat malaria/HIV/TB screening as per protocol; keep the child warm and avoid fluid overload.',
   'Weekly follow-up until recovery; continue breastfeeding; counsel caregivers.',
   'Link household to nutrition/food-security and social protection services.'])}

def q(sql, a=(), one=False, commit=False):
    db = g.get('db') or sqlite3.connect(DB); db.row_factory = sqlite3.Row; g.db = db
    cur = db.execute(sql, a)
    if commit: db.commit(); return cur.lastrowid
    r = cur.fetchall(); return (r[0] if r else None) if one else r

@app.teardown_appcontext
def close(_):
    db = g.pop('db', None)
    if db: db.close()

def init_db():
    db = sqlite3.connect(DB)
    db.executescript('''CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, username TEXT UNIQUE, pw TEXT, role TEXT DEFAULT 'user', active INTEGER DEFAULT 1);
    CREATE TABLE IF NOT EXISTS records(id INTEGER PRIMARY KEY, user_id INTEGER, created TEXT, child TEXT, age_months REAL, weight_kg REAL, height_cm REAL, muac_cm REAL, bmi REAL, status TEXT, confidence REAL);''')
    if not db.execute("SELECT 1 FROM users WHERE role='admin'").fetchone():
        db.execute("INSERT INTO users(username,pw,role) VALUES(?,?,'admin')", (os.environ.get('ADMIN_USER', 'admin'), generate_password_hash(os.environ.get('ADMIN_PASS', 'admin123'))))
    db.commit(); db.close()

def login_required(admin=False):
    def deco(f):
        @wraps(f)
        def w(*a, **k):
            if 'uid' not in session: return redirect(url_for('login'))
            if admin and session.get('role') != 'admin':
                flash('Admin access required.', 'danger'); return redirect(url_for('home'))
            return f(*a, **k)
        return w
    return deco

def predict(df):
    """df has RAW columns -> adds bmi, status, confidence. MUAC<11.5cm is a WHO SAM criterion and overrides the model."""
    d = prep(df); p = M['model'].predict_proba(d[FEATS]); cls = list(M['model'].classes_)
    d['status'] = [cls[i] for i in p.argmax(1)]; d['confidence'] = p.max(1)
    d['rule_override'] = (d.muac_cm < 11.5) & (d.status != 'severe')
    d.loc[d.rule_override, 'status'] = 'severe'
    return d

def flags(r):
    f = []
    if r.muac_cm < 11.5: f.append('MUAC < 11.5 cm: meets WHO criterion for severe acute malnutrition.')
    elif r.muac_cm < 12.5: f.append('MUAC 11.5-12.4 cm: moderate acute malnutrition range.')
    if r.age_months < 6: f.append('Infant under 6 months: prioritise breastfeeding support and refer for specialist care if at risk.')
    if r.bmi < 12: f.append('Very low BMI-for-age indicator: check weight and height measurements.')
    return f

def validate(row):
    for k, (lo, hi) in LIMITS.items():
        try: v = float(row[k])
        except (TypeError, ValueError, KeyError): return f'{k} is missing or not a number.'
        if not lo <= v <= hi: return f'{k} must be between {lo} and {hi}.'

def save(df, child=None):
    for i, r in df.iterrows():
        q('INSERT INTO records(user_id,created,child,age_months,weight_kg,height_cm,muac_cm,bmi,status,confidence) VALUES(?,?,?,?,?,?,?,?,?,?)',
          (session['uid'], dt.datetime.now().strftime('%Y-%m-%d %H:%M'), child or str(r.get('child', '')), r.age_months, r.weight_kg, r.height_cm, r.muac_cm, r.bmi, r.status, r.confidence), commit=True)

@app.route('/')
@login_required()
def home():
    scope, a = ('', ()) if session['role'] == 'admin' else ('WHERE user_id=?', (session['uid'],))
    counts = {r['status']: r['n'] for r in q(f'SELECT status, COUNT(*) n FROM records {scope} GROUP BY status', a)}
    recent = q(f'SELECT * FROM records {scope} ORDER BY id DESC LIMIT 8', a)
    return render_template('home.html', counts=counts, recent=recent, total=sum(counts.values()))

@app.route('/register', methods=['GET', 'POST'])
def register():
    if request.method == 'POST':
        u, p = request.form['username'].strip(), request.form['password']
        if len(u) < 3 or len(p) < 6: flash('Username 3+ chars and password 6+ chars required.', 'danger')
        elif q('SELECT 1 FROM users WHERE username=?', (u,), one=True): flash('Username taken.', 'danger')
        else:
            q('INSERT INTO users(username,pw) VALUES(?,?)', (u, generate_password_hash(p)), commit=True)
            flash('Account created. Please log in.', 'success'); return redirect(url_for('login'))
    return render_template('auth.html', title='Register')

@app.route('/login', methods=['GET', 'POST'])
def login():
    if request.method == 'POST':
        u = q('SELECT * FROM users WHERE username=?', (request.form['username'].strip(),), one=True)
        if u and u['active'] and check_password_hash(u['pw'], request.form['password']):
            session.update(uid=u['id'], user=u['username'], role=u['role']); return redirect(url_for('home'))
        flash('Invalid credentials or disabled account.', 'danger')
    return render_template('auth.html', title='Login')

@app.route('/logout')
def logout(): session.clear(); return redirect(url_for('login'))

@app.route('/assess', methods=['GET', 'POST'])
@login_required()
def assess():
    res = None
    if request.method == 'POST':
        err = validate(request.form)
        if err: flash(err, 'danger')
        else:
            df = predict(pd.DataFrame([{k: float(request.form[k]) for k in RAW}])); save(df, request.form.get('child', '').strip())
            r = df.iloc[0]; t, c, recs = REC[r.status]
            res = dict(r=r, title=t, cls=c, recs=recs, flags=flags(r), override=bool(r.rule_override))
    return render_template('assess.html', res=res, f=request.form)

@app.route('/bulk', methods=['GET', 'POST'])
@login_required()
def bulk():
    out = None
    if request.method == 'POST':
        try:
            df = pd.read_csv(request.files['file']); miss = [c for c in RAW if c not in df.columns]
            if miss: raise ValueError('Missing columns: ' + ', '.join(miss))
            bad = [i + 2 for i, r in df.iterrows() if validate(r)]
            if bad: raise ValueError(f'Invalid/out-of-range values on CSV rows: {bad[:10]}')
            d = predict(df); save(d)
            ordn = {'severe': 0, 'moderate': 1, 'normal': 2}
            out = dict(rows=d.sort_values('status', key=lambda s: s.map(ordn)).round(2).to_dict('records'), counts=d.status.value_counts().to_dict(), n=len(d),
                       csv=d.round(3).to_csv(index=False))
            session['last_bulk'] = out['csv'][:400000]
        except Exception as e: flash(f'Could not analyse file: {e}', 'danger')
    return render_template('bulk.html', out=out, REC=REC)

@app.route('/bulk/download')
@login_required()
def bulk_dl(): return Response(session.get('last_bulk', ''), mimetype='text/csv', headers={'Content-Disposition': 'attachment; filename=predictions.csv'})

@app.route('/records')
@login_required()
def records():
    scope, a = ('', ()) if session['role'] == 'admin' else ('WHERE r.user_id=?', (session['uid'],))
    return render_template('records.html', rows=q(f'SELECT r.*, u.username FROM records r LEFT JOIN users u ON u.id=r.user_id {scope} ORDER BY r.id DESC LIMIT 500', a))

@app.route('/records/export')
@login_required(admin=True)
def export():
    df = pd.read_sql('SELECT * FROM records', g.get('db') or sqlite3.connect(DB))
    return Response(df.to_csv(index=False), mimetype='text/csv', headers={'Content-Disposition': 'attachment; filename=all_records.csv'})

@app.route('/admin')
@login_required(admin=True)
def admin():
    return render_template('admin.html', users=q('SELECT u.*, (SELECT COUNT(*) FROM records WHERE user_id=u.id) n FROM users u'), info=M['info'] if M else None)

@app.post('/admin/user/<int:uid>/<act>')
@login_required(admin=True)
def user_act(uid, act):
    if uid == session['uid']: flash('You cannot change your own account here.', 'danger')
    elif act == 'toggle': q('UPDATE users SET active=1-active WHERE id=?', (uid,), commit=True)
    elif act == 'role': q("UPDATE users SET role=CASE role WHEN 'admin' THEN 'user' ELSE 'admin' END WHERE id=?", (uid,), commit=True)
    elif act == 'reset': q('UPDATE users SET pw=? WHERE id=?', (generate_password_hash('ChangeMe123'), uid), commit=True); flash('Password reset to ChangeMe123.', 'success')
    elif act == 'delete': q('DELETE FROM users WHERE id=?', (uid,), commit=True)
    return redirect(url_for('admin'))

@app.post('/admin/retrain')
@login_required(admin=True)
def retrain():
    global M
    try:
        f = request.files['file']; path = 'data/malnutrition.csv'
        if f and f.filename:
            df = pd.read_csv(f); miss = [c for c in RAW + ['nutrition_status'] if c not in df.columns]
            if miss: raise ValueError('Missing columns: ' + ', '.join(miss))
            df.to_csv(path, index=False)
        train(path); M = joblib.load('model.joblib'); flash('Model retrained and reloaded.', 'success')
    except Exception as e: flash(f'Retrain failed: {e}', 'danger')
    return redirect(url_for('admin'))

BASE = '''<!doctype html><html><head><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><title>NutriScan</title><style>
:root{--g:#1f7a4d;--bg:#f5f7f6;--c:#fff;--t:#1d2b24;--m:#6a7a72}@media(prefers-color-scheme:dark){:root{--bg:#121a16;--c:#1b2620;--t:#e6efe9;--m:#9fb1a6}}
body{margin:0;font:15px system-ui,sans-serif;background:var(--bg);color:var(--t)}nav{background:var(--g);padding:10px 20px;display:flex;gap:16px;align-items:center;flex-wrap:wrap}nav a{color:#fff;text-decoration:none}nav b{color:#fff;margin-right:auto}
main{max-width:1000px;margin:20px auto;padding:0 16px}.card{background:var(--c);border-radius:10px;padding:18px;margin-bottom:16px;box-shadow:0 1px 3px #0002;overflow-x:auto}
input,button,select{padding:8px;border-radius:6px;border:1px solid #8886;font:inherit;background:var(--c);color:var(--t)}button,.btn{background:var(--g);color:#fff;border:0;cursor:pointer;padding:8px 14px;border-radius:6px;text-decoration:none}
label{display:block;margin:8px 0 3px;color:var(--m)}table{border-collapse:collapse;width:100%}td,th{padding:6px 8px;border-bottom:1px solid #8884;text-align:left}
.success{background:#d8f2e3;color:#14532d}.warning{background:#fff1c9;color:#6b4e00}.danger{background:#ffd9d6;color:#7a1410}.alert{padding:10px 14px;border-radius:8px;margin-bottom:12px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px}.stat{font-size:28px;font-weight:700}.pill{padding:2px 9px;border-radius:99px;font-size:13px}</style></head><body>
<nav><b>NutriScan</b>{% if session.uid %}<a href=/>Dashboard</a><a href=/assess>Assess child</a><a href=/bulk>Bulk analysis</a><a href=/records>Records</a>{% if session.role=='admin' %}<a href=/admin>Admin</a>{% endif %}<a href=/logout>Logout ({{session.user}})</a>{% endif %}</nav>
<main>{% for c,m in get_flashed_messages(with_categories=true) %}<div class="alert {{c}}">{{m}}</div>{% endfor %}{% block body %}{% endblock %}
<p style="color:var(--m);font-size:13px">Decision-support tool only. It does not replace clinical assessment; follow national treatment guidelines.</p></main></body></html>'''
PILL = '{% macro pill(s) %}<span class="pill {{ {"normal":"success","moderate":"warning","severe":"danger"}[s] }}">{{s}}</span>{% endmacro %}'
T = {
 'base.html': BASE,
 'auth.html': '{% extends "base.html" %}{% block body %}<div class=card style="max-width:380px;margin:auto"><h2>{{title}}</h2><form method=post><label>Username</label><input name=username required style=width:100%><label>Password</label><input type=password name=password required style=width:100%><br><br><button>{{title}}</button> <a href="{{ url_for("register" if title=="Login" else "login") }}">{{ "Create account" if title=="Login" else "Back to login" }}</a></form></div>{% endblock %}',
 'home.html': '{% extends "base.html" %}{% block body %}' + PILL + '''<h2>Dashboard</h2><div class=grid><div class=card><div class=stat>{{total}}</div>Assessments</div>{% for s in ["normal","moderate","severe"] %}<div class=card><div class=stat>{{counts.get(s,0)}}</div>{{s|capitalize}}</div>{% endfor %}</div>
<div class=card><h3>Recent assessments</h3><table><tr><th>Date<th>Child<th>Age (m)<th>MUAC<th>Status</tr>{% for r in recent %}<tr><td>{{r.created}}<td>{{r.child}}<td>{{r.age_months|round(1)}}<td>{{r.muac_cm|round(1)}}<td>{{pill(r.status)}}</tr>{% else %}<tr><td colspan=5>No assessments yet.</tr>{% endfor %}</table></div><a class=btn href=/assess>New assessment</a>{% endblock %}''',
 'assess.html': '{% extends "base.html" %}{% block body %}<div class=card><h2>Assess a child</h2><form method=post><label>Child name / ID (optional)</label><input name=child value="{{f.child}}">'
   '{% for k,l in [("age_months","Age (months, 0-60)"),("weight_kg","Weight (kg)"),("height_cm","Height / length (cm)"),("muac_cm","MUAC (cm)")] %}<label>{{l}}</label><input name={{k}} type=number step=any required value="{{f[k]}}">{% endfor %}<br><br><button>Predict &amp; recommend</button></form></div>'
   '{% if res %}<div class="card"><div class="alert {{res.cls}}"><h2 style=margin:0>{{res.title}}</h2>Model confidence: {{(res.r.confidence*100)|round(0)|int}}% &middot; BMI {{res.r.bmi|round(1)}}{% if res.override %} &middot; Status raised to severe by the MUAC &lt; 11.5 cm rule{% endif %}</div>'
   '{% if res.flags %}<h3>Clinical flags</h3><ul>{% for x in res.flags %}<li>{{x}}{% endfor %}</ul>{% endif %}<h3>Recommended interventions</h3><ul>{% for x in res.recs %}<li>{{x}}{% endfor %}</ul></div>{% endif %}{% endblock %}',
 'bulk.html': '{% extends "base.html" %}{% block body %}' + PILL + '''<div class=card><h2>Bulk analysis</h2><p>Upload a CSV with columns <code>age_months, weight_kg, height_cm, muac_cm</code> (optional <code>child</code>).</p><form method=post enctype=multipart/form-data><input type=file name=file accept=.csv required> <button>Analyse</button></form></div>
{% if out %}<div class=card><h3>{{out.n}} children analysed</h3><div class=grid>{% for s in ["severe","moderate","normal"] %}<div class=card><div class=stat>{{out.counts.get(s,0)}}</div>{{s|capitalize}} ({{((out.counts.get(s,0)/out.n)*100)|round(1)}}%)</div>{% endfor %}</div>
<p><a class=btn href=/bulk/download>Download predictions CSV</a></p><table><tr><th>Child<th>Age<th>Weight<th>Height<th>MUAC<th>Status<th>Conf.</tr>{% for r in out.rows[:100] %}<tr><td>{{r.child}}<td>{{r.age_months}}<td>{{r.weight_kg}}<td>{{r.height_cm}}<td>{{r.muac_cm}}<td>{{pill(r.status)}}<td>{{(r.confidence*100)|round(0)|int}}%</tr>{% endfor %}</table>{% if out.n>100 %}<p>Showing first 100 (most severe first); download for all.</p>{% endif %}
<h3>Programme-level actions</h3><ul>{% if out.counts.get("severe") %}<li>{{out.counts.severe}} child(ren) need urgent referral/therapeutic feeding (RUTF).{% endif %}{% if out.counts.get("moderate") %}<li>{{out.counts.moderate}} child(ren) need supplementary feeding and 2-weekly follow-up.{% endif %}<li>Maintain growth monitoring, nutrition education and WASH for all.</ul></div>{% endif %}{% endblock %}''',
 'records.html': '{% extends "base.html" %}{% block body %}' + PILL + '<div class=card><h2>Records</h2>{% if session.role=="admin" %}<p><a class=btn href=/records/export>Export all (CSV)</a></p>{% endif %}<table><tr><th>Date<th>By<th>Child<th>Age<th>Wt<th>Ht<th>MUAC<th>Status</tr>{% for r in rows %}<tr><td>{{r.created}}<td>{{r.username}}<td>{{r.child}}<td>{{r.age_months|round(1)}}<td>{{r.weight_kg|round(1)}}<td>{{r.height_cm|round(1)}}<td>{{r.muac_cm|round(1)}}<td>{{pill(r.status)}}</tr>{% endfor %}</table></div>{% endblock %}',
 'admin.html': '{% extends "base.html" %}{% block body %}<div class=card><h2>Users</h2><table><tr><th>User<th>Role<th>Active<th>Records<th>Actions</tr>{% for u in users %}<tr><td>{{u.username}}<td>{{u.role}}<td>{{"yes" if u.active else "no"}}<td>{{u.n}}<td>{% if u.id!=session.uid %}{% for a,l in [("toggle","Enable/disable"),("role","Toggle admin"),("reset","Reset pw"),("delete","Delete")] %}<form method=post action="/admin/user/{{u.id}}/{{a}}" style=display:inline><button {% if a=="delete" %}onclick="return confirm(\'Delete user?\')"{% endif %}>{{l}}</button></form> {% endfor %}{% endif %}</tr>{% endfor %}</table></div>'
   '<div class=card><h2>Model</h2>{% if info %}<p>Best model: <b>{{info.best}}</b> &middot; test accuracy {{(info.test_accuracy*100)|round(1)}}% &middot; macro-F1 {{info.test_f1_macro|round(3)}} &middot; trained on {{info.n_rows}} rows</p><table><tr><th>Class<th>Precision<th>Recall<th>F1</tr>{% for k,v in info.report.items() %}<tr><td>{{k}}<td>{{v.precision|round(2)}}<td>{{v.recall|round(2)}}<td>{{v["f1-score"]|round(2)}}</tr>{% endfor %}</table>{% endif %}'
   '<form method=post action=/admin/retrain enctype=multipart/form-data><p>Retrain (optionally upload a new CSV with age_months, weight_kg, height_cm, muac_cm, nutrition_status):</p><input type=file name=file accept=.csv> <button>Retrain model</button></form></div>{% endblock %}'}
app.jinja_loader = DictLoader(T)

if __name__ == '__main__':
    init_db(); app.run(debug=False, port=5000)
else:
    init_db()
