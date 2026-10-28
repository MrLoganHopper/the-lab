import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { QRCodeSVG } from 'qrcode.react';
import { DateTime } from 'luxon';
import './styles.css';

const jsonRequest = async (url, opts={}) => {
  const r = await fetch(url, {
    credentials: 'same-origin',
    ...opts,
    headers: {...(opts.body ? {'Content-Type':'application/json'} : {}), ...(opts.headers || {})}
  });
  const data = await r.json().catch(()=>({}));
  if(!r.ok) {const e = new Error(data.error || 'Something went wrong.'); e.code=data.code; throw e;}
  return data;
};
const t = (str, zone, pattern='h:mm a') => DateTime.fromISO(str).setZone(zone).toFormat(pattern);
const formatDay=(date,zone)=>DateTime.fromISO(date,{zone}).toFormat('cccc, LLLL d');
const errorMessage = {
  google_setup:'Google OAuth credentials are not configured yet. You can try demo mode below.',
  oauth_state:'Your Google connection expired. Please try connecting again.',
  oauth_denied:'Google Calendar access was not granted.',
  oauth_failed:'Could not connect Google Calendar. Check the credentials and redirect URI.'
};

function GoogleCalendarLogo(){
  return <svg className="google-calendar" viewBox="0 0 100 100" role="img" aria-label="Google Calendar">
    <path fill="#4285F4" d="M12 0h65a11 11 0 0 1 11 11v13H12z"/>
    <path fill="#1967D2" d="M77 0h11a12 12 0 0 1 12 12v12H77z"/>
    <path fill="#188038" d="M0 75h24v25H12A12 12 0 0 1 0 88z"/>
    <path fill="#34A853" d="M24 75h53v25H24z"/>
    <path fill="#4285F4" d="M0 24V12A12 12 0 0 1 12 0h12v75H0z"/>
    <path fill="#FBBC04" d="M77 24h23v52H77z"/>
    <path fill="#EA4335" d="M77 75h23L77 100z"/>
    <path fill="white" d="M24 24h53v51H24z"/>
    <text x="50" y="66" textAnchor="middle" fontFamily="Arial, Helvetica, sans-serif" fontSize="43" fill="#1a73e8" fontWeight="500">31</text>
  </svg>;
}
function LabGlyph(){return <svg viewBox="0 0 130 115" className="lab-glyph" aria-hidden="true">
  <path d="M17 20L39 20 45 45 17 38Z" fill="currentColor"/>
  <path d="M16 81L72 81 72 97 16 96Z" fill="currentColor"/>
  <path d="M65 20L80 12 113 94 94 94Z" fill="currentColor"/>
</svg>}
function Brand(){return <div className="brand" aria-label="The Lab Cafe">LΛB</div>}
function PageShell({children, className=''}){return <div className={`app-frame ${className}`}>{children}</div>}
function InlineSpinner(){return <span className="spinner" aria-hidden="true"/>}
function StatusBanner({message,onDismiss}){if(!message)return null;return <div className="alert" role="alert"><span>{message}</span><button onClick={onDismiss} aria-label="Dismiss message">×</button></div>}

function Welcome({config,onDemo,loading,notice,onDismiss}){
  const configured=Boolean(config?.googleConfigured);
  return <PageShell className="welcome-screen">
    <Brand/>
    <h1 className="hero-script hero-welcome"><span>Find</span><strong>Availability</strong></h1>
    <a className="connect-card" href={configured ? '/auth/google/start' : undefined} onClick={e=>{if(!configured){e.preventDefault(); onDismiss('Google OAuth needs credentials. See README.md to connect a real account.');}}} aria-label="Connect Google Calendar">
      <GoogleCalendarLogo/>
      <span className="sr-only">Connect Google Calendar</span>
    </a>
    <p className="connect-label">{configured?'tap to connect google calendar':'google calendar'}</p>
    {config?.demoEnabled && <button className="demo-link" onClick={onDemo} disabled={loading}>{loading?<><InlineSpinner/> Entering demo...</>:'try with a sample calendar →'}</button>}
    <StatusBanner message={notice} onDismiss={()=>onDismiss('')}/>
    <div className="welcome-footer">cardinal gardens <span>·</span> thursday <span>·</span> 10 am to 8 pm</div>
  </PageShell>;
}

function groupSlots(slots){
  const groups=[];
  slots.forEach((slot,i)=>{
    const prior=groups.at(-1);
    const kind=slot.available?'free':slot.reason;
    if(prior && prior.kind===kind && (kind!=='calendar'|| prior.label===slot.label)) {
      prior.slots.push(slot); prior.end=slot.end;
    } else groups.push({kind,label:slot.label,slots:[slot],start:slot.start,end:slot.end,idx:i});
  });
  let colorIndex=0;
  return groups.map(g=>({...g,color: g.kind==='free'?['red','blue','green'][colorIndex++%3]:null}));
}
function SlotTimeline({data,onPick}) {
  const {zone,slots}=data;
  const groups=useMemo(()=>groupSlots(slots),[slots]);
  const halfHeight=28;
  const lineHeight=halfHeight*2;
  return <div className="timeline-layout">
    <div className="clock-gutter" aria-hidden="true">{Array.from({length:11},(_,i)=><div key={i} className="clock-mark" style={{top:i*lineHeight-9}}>{i+10>12?i-2:i+10===12?'12':i+10}</div>)}</div>
    <div className="timeline-track" style={{height:slots.length*halfHeight}}>
      {groups.map((group)=>{
        const top=group.idx*halfHeight+2;
        const height=group.slots.length*halfHeight-4;
        const free=group.kind==='free';
        const title=free ? `${t(group.start,zone)} - ${t(group.end,zone)}` : group.label;
        return <button key={group.start} className={`timeline-block ${free?'open-window':'busy-window'} ${group.color||''} ${height<42?'compact-block':''}`}
          style={{top,height}} disabled={!free} onClick={()=>onPick(group)} title={title}>
          {free ? <span className="block-label"><span className="block-copy">{height>=82?'time no. '+(groups.filter(g=>g.kind==='free').findIndex(g=>g.start===group.start)+1)+' ':''}</span>{t(group.start,zone,'h:mm')} - {t(group.end,zone,'h:mm')}</span>
             : <span className="block-label muted-label">{group.label||'Busy'}</span>}
          {free && height>=55 && <span className="block-remaining">{Math.min(...group.slots.map(s=>s.remaining))} spots left</span>}
        </button>;
      })}
    </div>
  </div>;
}
function TimeSheet({group,zone,slotMinutes,capacity,onClose,onBook,busy}){
  if(!group)return null;
  return <div className="sheet-overlay" role="presentation" onMouseDown={e=>{if(e.target===e.currentTarget)onClose();}}>
    <section className="time-sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title">
      <div className="sheet-handle"/><div className="sheet-heading"><div><p className="eyebrow">THE LAB CAFE</p><h2 id="sheet-title">Choose a time</h2></div><button className="close-button" onClick={onClose} aria-label="Close">×</button></div>
      <p className="sheet-sub">{formatDay(DateTime.fromISO(group.start).setZone(zone).toISODate(),zone)} · Each reservation is {slotMinutes} minutes</p>
      <div className="sheet-slots">{group.slots.map(slot=><button key={slot.start} disabled={busy} className="slot-option" onClick={()=>onBook(slot)}><span>{t(slot.start,zone)}<small> to {t(slot.end,zone)}</small></span><span className="spot-label">{slot.remaining} of {capacity} open {busy?<InlineSpinner/>:'↗'}</span></button>)}</div>
      <p className="sheet-footnote">Choosing a time reserves a spot immediately{'.'}</p>
    </section>
  </div>;
}
function Availability({data,onBack,onRefresh,onBook,submitting,notice,onDismiss,mode}){
  const [group,setGroup]=useState(null);
  const book=async(slot)=>{
    try{await onBook(slot);setGroup(null)}catch{setGroup(null)}
  };
  return <PageShell className="availability-screen">
    <header className="schedule-header"><button className="small-back" onClick={onBack} aria-label="Back">‹</button><div><Brand/><div className="subtitle-script">pick a time</div></div><button className="refresh-button" title="Refresh available times" onClick={onRefresh} aria-label="Refresh times">↻</button></header>
    <div className="date-strip"><span>{formatDay(data.date,data.zone)}</span><span>{mode==='demo'?'sample calendar':'your calendar'} · {data.capacity} seats</span></div>
    <StatusBanner message={notice} onDismiss={()=>onDismiss('')}/>
    {data.slots.every(s=>!s.available)?<p className="all-booked">No free spots overlap your calendar on Thursday. <button onClick={onRefresh}>Check again</button></p>:null}
    <SlotTimeline data={data} onPick={setGroup}/>
    <div className="legend"><span><i className="legend-color"/>available times</span><span><i className="legend-color muted"/>busy or full</span></div>
    <p className="schedule-foot">Tap a colored block to select a reservation.</p>
    <TimeSheet group={group} zone={data.zone} slotMinutes={data.slotMinutes} capacity={data.capacity} onClose={()=>setGroup(null)} onBook={book} busy={submitting}/>
  </PageShell>;
}
function Confirmation({reservation,config,onBack}){
  const zone=config?.zone||'America/Los_Angeles';
  return <PageShell className="confirmation-screen"><Brand/>
    <h1 className="hero-script hero-confirm"><span>See you</span><strong>Soon!</strong></h1>
    <div className="confirm-card"><LabGlyph/></div>
    <p className="confirmation-details">{reservation?`${formatDay(DateTime.fromISO(reservation.start).setZone(zone).toISODate(),zone)} · ${t(reservation.start,zone)} - ${t(reservation.end,zone)}`:'Reservation confirmed'}<br/><span>Cardinal Gardens, USC</span></p>
    <p className="calendar-status">{reservation?.calendarAdded?'✓ added to your google calendar':'✓ demo reservation saved, no google event created'}</p>
    <button className="text-link" onClick={onBack}>view available times ↗</button>
  </PageShell>;
}

function QRPage(){
  const [link,setLink]=useState(location.origin);
  const [addresses,setAddresses]=useState([]);
  useEffect(()=>{jsonRequest('/api/network').then(d=>{
    setAddresses(d.addresses||[]);
    if(['localhost','127.0.0.1'].includes(location.hostname) && d.addresses?.[0]) setLink(`http://${d.addresses[0]}:${location.port||d.frontendPort}`);
  }).catch(()=>{});},[]);
  return <div className="tool-page"><div className="tool-heading"><Brand/><a href="/" className="text-link">← back to booking</a></div><h1 className="tool-script">Scan to reserve.</h1>
    <div className="qr-card"><QRCodeSVG value={link||location.origin} size={240} bgColor="#ffffff" fgColor="#111111" marginSize={2}/></div>
    <p>Point your phone camera here. Your phone and laptop must share Wi-Fi if using a local IP address.</p>
    <label className="field-label" htmlFor="qr-url">QR destination</label><input id="qr-url" className="tool-input" value={link} onChange={e=>setLink(e.target.value)} spellCheck="false"/>
    {addresses.length>0&&<p className="helper">Local addresses: {addresses.join(', ')}</p>}
    <div className="tool-actions"><button onClick={()=>navigator.clipboard?.writeText(link)} className="tool-button">Copy link</button><button onClick={()=>window.print()} className="tool-button secondary">Print QR</button></div>
    <p className="helper">For real Google sign-in on phones, use a public HTTPS tunnel URL and register its exact OAuth redirect URI in Google Cloud.</p>
  </div>;
}
function AdminPage(){
  const [key,setKey]=useState(''); const [date,setDate]=useState(''); const [data,setData]=useState(null); const [error,setError]=useState('');const [loading,setLoading]=useState(false);
  useEffect(()=>{jsonRequest('/api/config').then(c=>setDate(c.date)).catch(()=>{});},[]);
  async function load(e){e.preventDefault();setLoading(true);setError('');try{setData(await jsonRequest(`/api/admin/reservations?date=${encodeURIComponent(date)}`,{headers:{'x-admin-key':key}}));}catch(err){setError(err.message)}finally{setLoading(false)}}
  return <div className="tool-page admin-page"><div className="tool-heading"><Brand/><a href="/" className="text-link">← booking app</a></div><h1 className="tool-script">Guest list.</h1>
    <form onSubmit={load} className="admin-form"><label className="field-label">Admin password<input type="password" className="tool-input" value={key} onChange={e=>setKey(e.target.value)} required/></label><label className="field-label">Cafe date<input type="date" className="tool-input" value={date} onChange={e=>setDate(e.target.value)} required/></label><button className="tool-button" disabled={loading}>{loading?'Checking...':'View reservations'}</button></form>
    <StatusBanner message={error} onDismiss={()=>setError('')}/>
    {data&&<><h2 className="admin-heading">{data.reservations.length} reservations · {data.date}</h2><div className="capacity-list">{data.slots.map(s=><div className="capacity-line" key={s.start}><span>{t(s.start,'America/Los_Angeles')}</span><div className="capacity-track"><div style={{width:`${s.booked/data.capacity*100}%`}}/></div><span>{s.booked}/{data.capacity}</span></div>)}</div>
    <h2 className="admin-heading">Who's coming</h2>{data.reservations.length?data.reservations.map(r=><article className="guest-row" key={r.id}><div><strong>{r.name}</strong><small>{r.email||'Demo guest'}</small></div><div>{t(r.start,'America/Los_Angeles')}<small>{r.status}</small></div></article>):<p>No bookings yet.</p>}</>}
  </div>;
}
function App(){
  const [config,setConfig]=useState(null);
  const [me,setMe]=useState(null);
  const [data,setData]=useState(null);
  const [page,setPage]=useState('welcome');
  const [reservation,setReservation]=useState(null);
  const [loading,setLoading]=useState(false);
  const [notice,setNotice]=useState('');
  const loadAvailability=useCallback(async()=>{
    try{const next=await jsonRequest('/api/availability');setData(next);setNotice('');setPage('availability');}
    catch(e){setNotice(e.message);if(e.message.includes('Calendar'))setPage('welcome');}
  },[]);
  useEffect(()=>{
    if(location.pathname==='/qr'||location.pathname==='/admin')return;
    const error=new URLSearchParams(location.search).get('error');
    if(error)setNotice(errorMessage[error] || 'Google login failed. Please try again.');
    if(location.search)history.replaceState({},'',location.pathname);
    Promise.all([jsonRequest('/api/config'),jsonRequest('/api/me')]).then(([c,m])=>{
      setConfig(c);setMe(m);
      if(m.connected)loadAvailability();
    }).catch(e=>setNotice(e.message));
  },[loadAvailability]);
  async function startDemo(){setLoading(true);try{await jsonRequest('/api/demo',{method:'POST',body:'{}'});setMe(await jsonRequest('/api/me'));await loadAvailability()}catch(e){setNotice(e.message)}finally{setLoading(false)}}
  async function book(slot){setLoading(true);setNotice('');try{
    const result=await jsonRequest('/api/reservations',{method:'POST',body:JSON.stringify({start:slot.start})});
    setReservation(result.reservation);setPage('confirmation');
  }catch(e){await loadAvailability().catch(()=>{});setNotice(e.message);throw e;}finally{setLoading(false)}}
  if(location.pathname==='/qr')return <QRPage/>;
  if(location.pathname==='/admin')return <AdminPage/>;
  if(!config||!me)return <PageShell className="loading-screen"><Brand/><InlineSpinner/></PageShell>;
  if(page==='confirmation')return <Confirmation reservation={reservation} config={config} onBack={()=>{loadAvailability()}}/>;
  if(page==='availability'&&data)return <Availability data={data} mode={me.mode} onBack={()=>setPage('welcome')} onRefresh={loadAvailability} onBook={book} submitting={loading} notice={notice} onDismiss={setNotice}/>;
  return <Welcome config={config} onDemo={startDemo} loading={loading} notice={notice} onDismiss={setNotice}/>;
}

createRoot(document.getElementById('root')).render(<App/>);
