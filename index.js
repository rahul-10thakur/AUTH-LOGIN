// Task API — PostgreSQL + Supabase Auth (A4)
require('dotenv').config();

const express = require('express');
const swaggerUi = require('swagger-ui-express');
const { createClient } = require('@supabase/supabase-js');
const { Pool } = require('pg');
const openapi = require('./openapi.json');

const app = express();
const port = Number(process.env.PORT || 3000);
const connectionString = process.env.DATABASE_URL || 'postgres://postgres:dev@localhost:5432/tasks';
const pool = new Pool({ connectionString });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
if (!supabaseUrl || !supabaseKey) {
  console.warn('Supabase Auth is not configured. Set SUPABASE_URL and SUPABASE_KEY in .env.');
}
const supabase = supabaseUrl && supabaseKey
  ? createClient(supabaseUrl, supabaseKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
    })
  : null;

app.use(express.json());

async function initializeDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tasks (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      done BOOLEAN NOT NULL DEFAULT FALSE
    )
  `);
  const { rows } = await pool.query('SELECT COUNT(*)::int AS count FROM tasks');
  if (rows[0].count === 0) {
    await pool.query(
      `INSERT INTO tasks (title, done) VALUES
       ($1, $2), ($3, $4), ($5, $6)`,
      ['Buy groceries', false, 'Walk the dog', true, 'Read a book', false]
    );
  }
}

function requireSupabase(res) {
  if (!supabase) {
    res.status(503).json({ error: 'Supabase Auth is not configured. Set SUPABASE_URL and SUPABASE_KEY.' });
    return false;
  }
  return true;
}

// Stage 1 — Sign up and log in.
app.post('/auth/signup', async (req, res) => {
  if (!requireSupabase(res)) return;
  const { email, password } = req.body ?? {};
  if (typeof email !== 'string' || !email.trim() ||
      typeof password !== 'string' || !password) {
    return res.status(400).json({ error: 'email and password are required' });
  }

  const { data, error } = await supabase.auth.signUp({
    email: email.trim(),
    password
  });
  if (error) return res.status(400).json({ error: error.message });
  return res.status(201).json({ user: data.user });
});

app.post('/auth/login', async (req, res) => {
  if (!requireSupabase(res)) return;
  const { email, password } = req.body ?? {};
  if (typeof email !== 'string' || !email.trim() ||
      typeof password !== 'string' || !password) {
    return res.status(400).json({ error: 'email and password are required' });
  }

  const { data, error } = await supabase.auth.signInWithPassword({
    email: email.trim(),
    password
  });
  if (error || !data.session) {
    return res.status(401).json({ error: 'Invalid login credentials' });
  }
  return res.status(200).json({
    user: data.user,
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token,
    token_type: data.session.token_type,
    expires_in: data.session.expires_in
  });
});

// Stage 2–4 — reusable bearer-token verification middleware.
async function authenticateToken(req, res, next) {
  if (!requireSupabase(res)) return;
  const header = req.get('authorization') || '';
  const match = header.match(/^Bearer\s+(\S+)$/i);
  if (!match) return res.status(401).json({ error: 'Access token required' });

  const { data, error } = await supabase.auth.getUser(match[1]);
  if (error || !data.user) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  req.user = data.user;
  req.accessToken = match[1];
  return next();
}

app.get('/public/info', (req, res) => {
  res.status(200).json({ message: 'Welcome stranger! This info is public.' });
});

app.get('/protected/profile', authenticateToken, (req, res) => {
  res.status(200).json({
    id: req.user.id,
    email: req.user.email,
    created_at: req.user.created_at
  });
});

app.get('/protected/dashboard', authenticateToken, (req, res) => {
  res.status(200).json({
    message: 'Welcome to your protected dashboard.',
    user: { id: req.user.id, email: req.user.email }
  });
});

// Supabase access tokens are stateless JWTs. The client must discard its
// tokens after this acknowledgement; this endpoint does not revoke the JWT.
app.post('/auth/logout', authenticateToken, (req, res) => {
  res.status(204).send();
});

// Existing A3 health and task API are preserved.
app.use('/docs', swaggerUi.serve, swaggerUi.setup(openapi));
app.get('/', (req, res) => res.json({
  name: 'Task API', version: '4.0', storage: 'PostgreSQL',
  authentication: 'Supabase Auth',
  endpoints: ['/auth/signup', '/auth/login', '/auth/logout', '/protected/profile', '/protected/dashboard', '/public/info', '/tasks']
}));
app.get('/health', async (req, res) => {
  await pool.query('SELECT 1');
  res.json({ status: 'ok', db: 'ok', supabaseConfigured: Boolean(supabase) });
});

app.get('/tasks', async (req, res) => {
  const conditions = [];
  const params = [];
  if (req.query.done !== undefined) {
    if (req.query.done !== 'true' && req.query.done !== 'false') {
      return res.status(400).json({ error: 'done must be true or false' });
    }
    params.push(req.query.done === 'true');
    conditions.push(`done = $${params.length}`);
  }
  if (req.query.search !== undefined) {
    const word = String(req.query.search).trim();
    if (!word) return res.status(400).json({ error: 'search must not be empty' });
    params.push(`%${word}%`);
    conditions.push(`title ILIKE $${params.length}`);
  }
  const sql = `SELECT * FROM tasks${conditions.length ? ` WHERE ${conditions.join(' AND ')}` : ''} ORDER BY id`;
  const { rows } = await pool.query(sql, params);
  res.json(rows);
});

app.get('/stats', async (req, res) => {
  const { rows } = await pool.query(`
    SELECT COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE done = TRUE)::int AS done
    FROM tasks
  `);
  res.json({ total: rows[0].total, done: rows[0].done, open: rows[0].total - rows[0].done });
});

app.post('/reset', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM tasks');
    await client.query(
      `INSERT INTO tasks (title, done) VALUES ($1, $2), ($3, $4), ($5, $6)`,
      ['Buy groceries', false, 'Walk the dog', true, 'Read a book', false]
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
  const { rows } = await pool.query('SELECT * FROM tasks ORDER BY id');
  res.json(rows);
});

app.post('/tasks', async (req, res) => {
  const { title } = req.body ?? {};
  if (title === undefined || title === null || String(title).trim() === '') {
    return res.status(400).json({ error: 'title is required and cannot be empty' });
  }
  const { rows } = await pool.query(
    'INSERT INTO tasks (title, done) VALUES ($1, $2) RETURNING *',
    [String(title).trim(), false]
  );
  res.status(201).json(rows[0]);
});

app.get('/tasks/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return res.status(404).json({ error: `Task ${req.params.id} not found` });
  const { rows } = await pool.query('SELECT * FROM tasks WHERE id = $1', [id]);
  if (!rows.length) return res.status(404).json({ error: `Task ${id} not found` });
  res.json(rows[0]);
});

app.put('/tasks/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return res.status(404).json({ error: `Task ${req.params.id} not found` });
  const body = req.body ?? {};
  const hasTitle = Object.prototype.hasOwnProperty.call(body, 'title');
  const hasDone = Object.prototype.hasOwnProperty.call(body, 'done');
  if (!hasTitle && !hasDone) return res.status(400).json({ error: 'request body must include title and/or done' });
  if (hasTitle && (body.title === null || String(body.title).trim() === '')) {
    return res.status(400).json({ error: 'title cannot be empty' });
  }
  if (hasDone && typeof body.done !== 'boolean') return res.status(400).json({ error: 'done must be a boolean' });
  const values = [];
  const sets = [];
  if (hasTitle) { values.push(String(body.title).trim()); sets.push(`title = $${values.length}`); }
  if (hasDone) { values.push(body.done); sets.push(`done = $${values.length}`); }
  values.push(id);
  const { rows } = await pool.query(
    `UPDATE tasks SET ${sets.join(', ')} WHERE id = $${values.length} RETURNING *`, values
  );
  if (!rows.length) return res.status(404).json({ error: `Task ${id} not found` });
  res.json(rows[0]);
});

app.delete('/tasks/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return res.status(404).json({ error: `Task ${req.params.id} not found` });
  const result = await pool.query('DELETE FROM tasks WHERE id = $1', [id]);
  if (result.rowCount === 0) return res.status(404).json({ error: `Task ${id} not found` });
  res.status(204).send();
});

if (require.main === module) {
  initializeDatabase()
    .then(() => app.listen(port, () => console.log(`Task API listening on port ${port}; PostgreSQL connected; Supabase Auth ${supabase ? 'configured' : 'not configured'}`)))
    .catch((error) => { console.error('Failed to initialize PostgreSQL:', error); process.exit(1); });
}

module.exports = { app, pool, supabase, authenticateToken, initializeDatabase };
