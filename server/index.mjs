import express from 'express';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import { DateTime } from 'luxon';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { timingSafeEqual } from 'node:crypto';
import { initDb, generateId, hashId, countAt, reserveAtomically } from './db.mjs';
import { cafeThursday, makeSlots, classifySlots, overlapsInterval } from './scheduling.mjs';
import { oauthConfigured, authorizationUrl, exchangeCode, getCalendarEvents, createCalendarEvent, deleteCalendarEvent, demoBusy } from './calendar.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
dotenv.config({path:path.join(root,'.env')});
const PORT = Number(process.env.PORT || 3001);
const ZONE = process.env.TIME_ZONE || 'America/Los_Angeles';
const CAPACITY = Number(process.env.CAPACITY || 10);
const SLOT_MINUTES = Number(process.env.SLOT_MINUTES || 30);
const DEMO = process.env.DEMO_MODE !== 'false';
const ADMIN_KEY = process.env.ADMIN_KEY || '';
if (!Number.isInteger(CAPACITY) || CAPACITY < 1 || CAPACITY > 1000) throw Error('Invalid CAPACITY');
makeSlots(cafeThursday(DateTime.now(), ZONE),ZONE,SLOT_MINUTES);
const db = initDb(process.env.DB_PATH || path.join(root, 'data', 'lab-cafe.sqlite'));
const app = express();
app.set('trust proxy', 'loopback');
app.disable('x-powered-by');
app.use(express.json({limit:'32kb'}));
app.use(cookieParser());
app.use((req,res,next)=>{
  res.set('Cache-Control','no-store');
  next();
});

function cookieOptions(req) {
  // The same browser gets a first-party session on the LAN, localhost, and HTTPS tunnel.
  const secure = req.secure || req.headers['x-forwarded-proto']?.split(',')[0]?.trim()==='https';
  return {httpOnly:true, sameSite:'lax', secure, path:'/', maxAge:7*24*3600*1000};
}
function newSession(req,res) {
  const raw = generateId();
  const now = new Date();
  const expiration = new Date(now.getTime()+7*24*3600*1000).toISOString();
  db.prepare('INSERT INTO sessions(id_hash,created_at,expires_at) VALUES(?,?,?)').run(hashId(raw),now.toISOString(),expiration);
  res.cookie('lab_session',raw,cookieOptions(req));
  return db.prepare('SELECT * FROM sessions WHERE id_hash=?').get(hashId(raw));
}
function session(req) {
  const raw = req.cookies?.lab_session;
  if (typeof raw !== 'string' || raw.length > 200) return null;
  return db.prepare('SELECT * FROM sessions WHERE id_hash=? AND expires_at>?').get(hashId(raw),new Date().toISOString());
}
function ensureSession(req,res) { return session(req) || newSession(req,res); }
function userOr401(req,res) {
  const s = session(req);
  if (!s || !s.user_key || !['google','demo'].includes(s.mode)) { res.status(401).json({error:'Connect your calendar or enter demo mode first.'}); return null; }
  return s;
}
function sameOrigin(req,res,next) {
  const origin = req.get('origin');
  const host = req.get('host');
  // Browsers send Origin on JSON mutations. Requiring JSON also blocks HTML form CSRF.
  if (origin && new URL(origin).host !== host) return res.status(403).json({error:'Origin mismatch'});
  if (req.method !== 'GET' && !req.is('application/json')) return res.status(415).json({error:'JSON request required'});
  next();
}
function safeError(res,err, status=502) {
  console.error('[Lab API]',err?.message || err);
  return res.status(status).json({error:'Calendar connection failed. Please reconnect or try again.'});
}
function slotDate() { return cafeThursday(DateTime.now(),ZONE); }
async function busyFor(s) {
  const date = slotDate();
  if (s.mode === 'demo') return demoBusy(date,ZONE);
  return getCalendarEvents(JSON.parse(s.tokens),date,ZONE);
}

app.get('/api/config',(req,res)=>{
  const date=slotDate();
  res.json({date,zone:ZONE,capacity:CAPACITY,slotMinutes:SLOT_MINUTES,demoEnabled:DEMO,googleConfigured:oauthConfigured(),location:'Cardinal Gardens, USC',eventName:'the lab cafe'});
});
app.get('/api/network',(req,res)=>{
  const addresses=[];
  for(const iface of Object.values(os.networkInterfaces())) for(const item of iface||[]) if(item.family==='IPv4' && !item.internal && !addresses.includes(item.address)) addresses.push(item.address);
  res.json({addresses,frontendPort:5173,serverPort:PORT});
});
app.get('/api/me',(req,res)=>{
  const s=session(req);
  res.json({connected:Boolean(s?.user_key),mode:s?.user_key?s.mode:null,name:s?.display_name||null,email:s?.email||null});
});
app.post('/api/demo',sameOrigin,(req,res)=>{
  if(!DEMO) return res.status(403).json({error:'Demo mode is disabled'});
  let s=ensureSession(req,res);
  const visitorId=`demo:${generateId()}`;
  db.prepare('UPDATE sessions SET mode=?,user_key=?,display_name=?,email=?,tokens=NULL WHERE id_hash=?')
    .run('demo',visitorId,'Demo guest',null,s.id_hash);
  res.json({ok:true,mode:'demo'});
});
app.get('/auth/google/start',(req,res)=>{
  if(!oauthConfigured()) return res.redirect('/?error=google_setup');
  const s=ensureSession(req,res);
  const state=generateId();
  db.prepare('UPDATE sessions SET oauth_state=?,oauth_expires_at=? WHERE id_hash=?')
    .run(hashId(state),Date.now()+10*60*1000,s.id_hash);
  res.redirect(authorizationUrl(state));
});
app.get('/auth/google/callback',async(req,res)=>{
  const s=session(req);
  const received=typeof req.query.state === 'string'? req.query.state : '';
  const valid=s?.oauth_state && received && hashId(received)===s.oauth_state && s.oauth_expires_at>Date.now();
  if(!valid) return res.redirect('/?error=oauth_state');
  db.prepare('UPDATE sessions SET oauth_state=NULL,oauth_expires_at=NULL WHERE id_hash=?').run(s.id_hash);
  if(req.query.error) return res.redirect('/?error=oauth_denied');
  try {
    if(typeof req.query.code !== 'string') throw new Error('No OAuth code');
    const result=await exchangeCode(req.query.code);
    db.prepare('UPDATE sessions SET mode=?,user_key=?,display_name=?,email=?,tokens=? WHERE id_hash=?')
      .run('google',result.userKey,result.displayName,result.email,JSON.stringify(result.tokens),s.id_hash);
    res.redirect('/?connected=1');
  } catch(e) {console.error('[OAuth callback]',e?.message);res.redirect('/?error=oauth_failed');}
});
app.post('/api/logout',sameOrigin,(req,res)=>{
  const s=session(req);
  if(s) db.prepare('DELETE FROM sessions WHERE id_hash=?').run(s.id_hash);
  res.clearCookie('lab_session',{path:'/'});
  res.json({ok:true});
});
app.get('/api/availability',async(req,res)=>{
  const s=userOr401(req,res);if(!s)return;
  try {
    const date=slotDate();
    const busy=await busyFor(s);
    const slots=classifySlots(makeSlots(date,ZONE,SLOT_MINUTES),busy,(a,b)=>countAt(db,a,b),CAPACITY);
    res.json({date,zone:ZONE,slotMinutes:SLOT_MINUTES,capacity:CAPACITY,busy,slots});
  } catch(e){ safeError(res,e); }
});
app.get('/api/reservations/mine',(req,res)=>{
  const s=userOr401(req,res);if(!s)return;
  const rows=db.prepare("SELECT id,start_time AS start,end_time AS end,status,mode FROM reservations WHERE user_key=? AND status='confirmed' ORDER BY start_time DESC LIMIT 50").all(s.user_key);
  res.json({reservations:rows});
});
app.post('/api/reservations',sameOrigin,async(req,res)=>{
  const s=userOr401(req,res);if(!s)return;
  const start=typeof req.body.start==='string'?req.body.start:'';
  const date=slotDate();
  const candidate=makeSlots(date,ZONE,SLOT_MINUTES).find(x=>x.start===start);
  if(!candidate) return res.status(400).json({error:'Choose a valid time from the current Thursday schedule.'});
  if(Date.parse(candidate.start)<Date.now()) return res.status(400).json({error:'That time has passed.'});
  try {
    const busy=await busyFor(s);
    if(overlapsInterval(candidate.start,candidate.end,busy)) return res.status(409).json({error:'Your calendar is busy at that time. Please choose another slot.',code:'BUSY'});
    const id=generateId();
    const result=reserveAtomically(db,{id,userKey:s.user_key,name:s.display_name,email:s.email,mode:s.mode,start:candidate.start,end:candidate.end,capacity:CAPACITY});
    if(result.error==='FULL')return res.status(409).json({error:'This time just filled up. Please pick another.',code:'FULL'});
    if(result.error==='DUPLICATE')return res.status(409).json({error:'You already have a reservation that overlaps this time.',code:'DUPLICATE'});
    let eventId=null;
    try {
      if(s.mode==='google')eventId=await createCalendarEvent(JSON.parse(s.tokens),candidate.start,candidate.end,ZONE);
      db.prepare("UPDATE reservations SET status='confirmed',google_event_id=? WHERE id=? AND status='pending'").run(eventId,id);
    } catch(e) {
      db.prepare("DELETE FROM reservations WHERE id=? AND status='pending'").run(id);
      throw e;
    }
    res.status(201).json({reservation:{id,start:candidate.start,end:candidate.end,mode:s.mode,calendarAdded:!!eventId,location:'Cardinal Gardens, USC'}});
  } catch(e){safeError(res,e);}
});
app.post('/api/reservations/:id/cancel',sameOrigin,async(req,res)=>{
  const s=userOr401(req,res);if(!s)return;
  const b=db.prepare("SELECT * FROM reservations WHERE id=? AND user_key=? AND status='confirmed'").get(req.params.id,s.user_key);
  if(!b)return res.status(404).json({error:'Reservation not found'});
  try {
    if(b.google_event_id && s.mode==='google') await deleteCalendarEvent(JSON.parse(s.tokens),b.google_event_id);
    db.prepare("UPDATE reservations SET status='cancelled' WHERE id=? AND status='confirmed'").run(b.id);
    res.json({ok:true});
  } catch(e){safeError(res,e);}
});
app.get('/api/admin/reservations',(req,res)=>{
  if(!ADMIN_KEY)return res.status(503).json({error:'Set ADMIN_KEY in .env first.'});
  const supplied=req.get('x-admin-key')||'';
  const a=Buffer.from(supplied),b=Buffer.from(ADMIN_KEY);
  if(a.length!==b.length || !timingSafeEqual(a,b))return res.status(401).json({error:'Incorrect admin password'});
  const date=typeof req.query.date==='string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date)?req.query.date:slotDate();
  const rows=db.prepare("SELECT id,display_name AS name,email,start_time AS start,end_time AS end,mode,status,created_at AS createdAt FROM reservations WHERE substr(start_time,1,10)>=? AND status IN ('confirmed','pending') ORDER BY start_time,created_at").all(DateTime.fromISO(date,{zone:ZONE}).startOf('day').toUTC().toISO().slice(0,10)).filter(r=>DateTime.fromISO(r.start).setZone(ZONE).toISODate()===date);
  const slots=makeSlots(date,ZONE,SLOT_MINUTES).map(slot=>({...slot,booked:rows.filter(r=>r.start<slot.end&&r.end>slot.start).length}));
  res.json({date,capacity:CAPACITY,reservations:rows,slots});
});
const dist=path.join(root,'dist');
if(existsSync(path.join(dist,'index.html'))){
  app.use(express.static(dist));
  app.get('*',(req,res)=>res.sendFile(path.join(dist,'index.html')));
}
app.use((err,req,res,next)=>{
  console.error('[Unhandled]',err.message);
  res.status(500).json({error:'Server error. Please retry.'});
});
app.listen(PORT,'0.0.0.0',()=>{
  console.log(`\nThe Lab Cafe API: http://localhost:${PORT}`);
  console.log(`Google OAuth: ${oauthConfigured()?'configured':'not configured (demo works)'} | demo: ${DEMO?'on':'off'}`);
  console.log(`Bookings DB: ${process.env.DB_PATH || path.join(root,'data','lab-cafe.sqlite')}\n`);
});
