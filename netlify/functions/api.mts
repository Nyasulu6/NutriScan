import type { Config } from '@netlify/functions';
import { getUser, refreshSession, login, signup, logout, confirmEmail, recoverPassword, acceptInvite, requestPasswordRecovery, verifyRequestOrigin, AuthError, admin } from '@netlify/identity';
import { eq, desc, count } from 'drizzle-orm';
import { database } from '../../db/index.js';
import { records } from '../../db/schema.js';
import { predict, validate, modelInfo } from '../../lib/predict.js';

function json(data: unknown, status = 200) {
  return Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
}
async function body(req: Request) {
  const text = await req.text();
  if (text.length > 1_000_000) throw new Error('Upload is too large. Use up to 500 rows per file.');
  try { return JSON.parse(text); } catch { throw new Error('Invalid JSON request.'); }
}
export default async (req: Request) => {
  const path = new URL(req.url).pathname.replace(/^\/(?:\.netlify\/functions\/api|api)/, '').replace(/\/$/, '') || '/';
  try {
    if (!['GET', 'POST'].includes(req.method)) return json({ error: 'Method not allowed.' }, 405);
    if (req.method === 'POST') verifyRequestOrigin(req);
    if (path === '/auth' && req.method === 'POST') {
      const data = await body(req);
      const { action, email, password } = data;
      if (['login', 'signup', 'recover'].includes(action) && (typeof email !== 'string' || email.length > 254 || !email.includes('@'))) return json({ error: 'Enter a valid email address.' }, 400);
      if (['login', 'signup', 'reset', 'invite'].includes(action) && (typeof password !== 'string' || password.length < 6 || password.length > 256)) return json({ error: 'Use a password between 6 and 256 characters.' }, 400);
      if (['confirm', 'reset', 'invite'].includes(action) && (typeof data.token !== 'string' || !data.token || data.token.length > 4096)) return json({ error: 'Invalid confirmation link.' }, 400);
      if (action === 'login') {
        const account = await login(email, password);
        if (account.appMetadata?.active === false) { await logout(); return json({ error: 'Your account is disabled. Contact your administrator.' }, 403); }
        return json({ ok: true });
      }
      if (action === 'signup') { await signup(email, password, { full_name: String(data.name || '').slice(0, 100) }); return json({ ok: true, message: 'Account created. Check your email to confirm your account, then sign in.' }); }
      if (action === 'logout') { await logout(); return json({ ok: true }); }
      if (action === 'recover') { await requestPasswordRecovery(email); return json({ ok: true, message: 'Check your email for a password reset link.' }); }
      if (action === 'confirm') { await confirmEmail(data.token); return json({ ok: true }); }
      if (action === 'reset') { await recoverPassword(data.token, password); return json({ ok: true }); }
      if (action === 'invite') { await acceptInvite(data.token, password); return json({ ok: true }); }
      return json({ error: 'Unknown account action.' }, 400);
    }
    await refreshSession();
    const user = await getUser();
    if (path === '/session' && req.method === 'GET') return json({ user: user?.appMetadata?.active === false ? null : user ? { id: user.id, name: user.name, email: user.email, roles: user.roles || [] } : null });
    if (!user) return json({ error: 'Please sign in to continue.' }, 401);
    if (user.appMetadata?.active === false) return json({ error: 'Your account is disabled. Contact your administrator.' }, 403);
    const isAdmin = user.roles?.includes('admin');
    if (path.startsWith('/admin')) {
      if (!isAdmin) return json({ error: 'Admin access required.' }, 403);
      if (path === '/admin' && req.method === 'GET') {
        const users = await admin.listUsers({ perPage: 1000 });
        return json({ users: users.map(u => ({ id: u.id, email: u.email, name: u.name, roles: u.roles || [], active: u.appMetadata?.active !== false })), info: modelInfo() });
      }
      if (path === '/admin/user' && req.method === 'POST') {
        const { id, action } = await body(req);
        if (typeof id !== 'string' || id === user.id) return json({ error: 'You cannot change your own account here.' }, 400);
        const target = await admin.getUser(id);
        if (action === 'toggle') await admin.updateUser(id, { app_metadata: { ...target.appMetadata, active: target.appMetadata?.active === false } });
        else if (action === 'role') await admin.updateUser(id, { app_metadata: { ...target.appMetadata, roles: target.roles?.includes('admin') ? target.roles.filter(r => r !== 'admin') : [...(target.roles || []), 'admin'] } });
        else if (action === 'reset') { if (target.email) await requestPasswordRecovery(target.email); }
        else if (action === 'delete') await admin.deleteUser(id);
        else return json({ error: 'Unknown user action.' }, 400);
        return json({ ok: true });
      }
    }
    if (path === '/assess' && req.method === 'POST') {
      const data = await body(req);
      const rows = Array.isArray(data.rows) ? data.rows : [data];
      if (!rows.length || rows.length > 500) return json({ error: 'Submit between 1 and 500 assessments.' }, 400);
      const results = rows.map((row: unknown, index: number) => {
        try { return predict(validate(row)); } catch (error) { throw new Error(`Row ${index + 1}: ${(error as Error).message}`); }
      });
      const saved = await database().insert(records).values(results.map((r: ReturnType<typeof predict>) => ({ userId: user.id, child: r.child, age_months: r.age_months, weight_kg: r.weight_kg, height_cm: r.height_cm, muac_cm: r.muac_cm, bmi: r.bmi, status: r.status, confidence: r.confidence }))).returning({ id: records.id, created: records.created });
      return json({ rows: results.map((r: ReturnType<typeof predict>, i: number) => ({ ...r, ...saved[i] })) }, 201);
    }
    if (path === '/records' && req.method === 'GET') {
      const scope = isAdmin ? undefined : eq(records.userId, user.id);
      const db = database();
      const [rows, counts] = await Promise.all([
        db.select().from(records).where(scope).orderBy(desc(records.id)).limit(500),
        db.select({ status: records.status, count: count() }).from(records).where(scope).groupBy(records.status),
      ]);
      return json({ rows, counts });
    }
    if (path === '/records/export' && req.method === 'GET') {
      if (!isAdmin) return json({ error: 'Admin access required.' }, 403);
      const rows = await database().select().from(records).orderBy(desc(records.id));
      return json({ rows });
    }
    return json({ error: 'Endpoint not found.' }, 404);
  } catch (error) {
    if (error instanceof AuthError) return json({ error: error.status === 401 ? 'Invalid email or password, or your session has expired.' : 'Account request failed. Check your details and confirmation link, then try again.' }, error.status && error.status >= 400 && error.status < 500 ? error.status : 503);
    if (error instanceof Error && /must be|Row \d|assessment is required|Invalid JSON|Upload is too large|Child name/.test(error.message)) return json({ error: error.message }, 400);
    return json({ error: 'The service is temporarily unavailable. Please try again shortly.' }, 503);
  }
};
export const config: Config = { path: ['/api', '/api/*'] };
