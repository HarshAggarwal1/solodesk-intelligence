import fs from "node:fs/promises";
import path from "node:path";
import pg from "pg";

const { Pool } = pg;
const dataPath = path.resolve(process.cwd(), "data.json");
const usePg = Boolean(process.env.DATABASE_URL);
const pool = usePg ? new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL.includes("localhost") ? false : { rejectUnauthorized: false }
}) : null;

let local = { projects: [], events: [], users: [] };

async function loadLocal() {
  try { local = JSON.parse(await fs.readFile(dataPath, "utf8")); }
  catch { await saveLocal(); }
}
async function saveLocal() {
  await fs.writeFile(dataPath, JSON.stringify(local, null, 2));
}

export async function initStore() {
  if (!usePg) return loadLocal();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      title TEXT NOT NULL,
      client_name TEXT NOT NULL DEFAULT '',
      currency TEXT NOT NULL DEFAULT 'INR',
      hourly_rate NUMERIC NOT NULL DEFAULT 1000,
      brief TEXT NOT NULL DEFAULT '',
      proposal JSONB,
      baseline JSONB,
      change_orders JSONB NOT NULL DEFAULT '[]'::jsonb,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    ALTER TABLE projects ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';
    CREATE TABLE IF NOT EXISTS app_users (id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
    CREATE INDEX IF NOT EXISTS projects_user_id_idx ON projects(user_id);
    CREATE TABLE IF NOT EXISTS project_events (
      id BIGSERIAL PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      event_type TEXT NOT NULL,
      payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}
export async function createUser(user) {
  if (usePg) {
    const r = await pool.query("INSERT INTO app_users(id,email,password_hash) VALUES($1,$2,$3) RETURNING id,email,created_at", [user.id,user.email,user.passwordHash]);
    return {id:r.rows[0].id,email:r.rows[0].email,createdAt:r.rows[0].created_at};
  }
  if (local.users.some(u => u.email === user.email)) throw new Error("EMAIL_EXISTS");
  local.users.push(user); await saveLocal(); return {id:user.id,email:user.email,createdAt:user.createdAt};
}
export async function findUserByEmail(email) {
  if (usePg) { const r=await pool.query("SELECT * FROM app_users WHERE email=$1",[email]); return r.rows[0] ? {id:r.rows[0].id,email:r.rows[0].email,passwordHash:r.rows[0].password_hash} : null; }
  return local.users.find(u=>u.email===email)||null;
}
export async function listProjects(userId) {
  if (usePg) return (await pool.query("SELECT * FROM projects WHERE user_id=$1 ORDER BY updated_at DESC",[userId])).rows.map(mapProject);
  return local.projects.filter(p=>p.userId===userId).map(p=>({...p,status:p.status||'active'})).sort((a,b) => b.updatedAt.localeCompare(a.updatedAt));
}
export async function getProject(id, userId) {
  if (usePg) {
    const r = await pool.query("SELECT * FROM projects WHERE id=$1 AND user_id=$2", [id,userId]);
    return r.rows[0] ? mapProject(r.rows[0]) : null;
  }
  const p = local.projects.find(p => p.id === id && p.userId===userId); return p ? {...p,status:p.status||'active'} : null;
}
export async function createProject(project) {
  if (usePg) {
    const r = await pool.query(
      "INSERT INTO projects(id,user_id,title,client_name,currency,hourly_rate,brief) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *",
      [project.id, project.userId, project.title, project.clientName, project.currency, project.hourlyRate, project.brief]
    );
    await event(project.id, "project_created", { title: project.title });
    return mapProject(r.rows[0]);
  }
  local.projects.push(project); await saveLocal(); await event(project.id, "project_created", {title: project.title}); return project;
}
export async function updateProject(id, userId, patch, eventType = "project_updated", payload = {}) {
  const old = await getProject(id, userId);
  if (!old) return null;
  const next = { ...old, ...patch, updatedAt: new Date().toISOString() };
  if (usePg) {
    await pool.query(
      `UPDATE projects SET title=$2,client_name=$3,currency=$4,hourly_rate=$5,brief=$6,proposal=$7,baseline=$8,change_orders=$9,status=$10,updated_at=NOW() WHERE id=$1 AND user_id=$11`,
      [id,next.title,next.clientName,next.currency,next.hourlyRate,next.brief,
       JSON.stringify(next.proposal), JSON.stringify(next.baseline), JSON.stringify(next.changeOrders || []), next.status || 'active', userId]
    );
  } else {
    local.projects = local.projects.map(p => p.id === id && p.userId===userId ? next : p);
    await saveLocal();
  }
  await event(id, eventType, payload);
  return next;
}
export async function event(projectId, eventType, payload = {}) {
  const e = { id: crypto.randomUUID(), projectId, eventType, payload, createdAt: new Date().toISOString() };
  if (usePg) await pool.query("INSERT INTO project_events(project_id,event_type,payload) VALUES($1,$2,$3)", [projectId,eventType,JSON.stringify(payload)]);
  else { local.events.push(e); await saveLocal(); }
  return e;
}
export async function getEvents(projectId) {
  if (usePg) return (await pool.query("SELECT id,project_id AS \"projectId\",event_type AS \"eventType\",payload,created_at AS \"createdAt\" FROM project_events WHERE project_id=$1 ORDER BY created_at DESC LIMIT 100", [projectId])).rows;
  return local.events.filter(e => e.projectId === projectId).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).slice(0,100);
}
function mapProject(r) {
  return {
    id:r.id, userId:r.user_id, title:r.title, clientName:r.client_name, currency:r.currency,
    hourlyRate:Number(r.hourly_rate), brief:r.brief, proposal:r.proposal,
    baseline:r.baseline, changeOrders:r.change_orders || [], status:r.status || 'active',
    createdAt:r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at,
    updatedAt:r.updated_at instanceof Date ? r.updated_at.toISOString() : r.updated_at
  };
}
