import { useEffect, useMemo, useState } from 'react';
import { authenticateTelegram, createTrip, fetchTrip, fetchTripHistory, isDemoMode, joinTrip, saveLocation, updateTripDeadline, updateTripStatus } from './lib/api';
import { MapPanel } from './components/MapPanel';
import type { Trip, TripStatus, User } from './types';

function App() {
  const [user, setUser] = useState<User | null>(null);
  const [trip, setTrip] = useState<Trip | null>(null);
  const [inviteCode, setInviteCode] = useState('');
  const [minutes, setMinutes] = useState('30');
  const [destination, setDestination] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [now, setNow] = useState(() => Date.now());
  const [history, setHistory] = useState<Trip[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [editMinutes, setEditMinutes] = useState('');

  useEffect(() => {
    window.Telegram?.WebApp?.ready();
    window.Telegram?.WebApp?.expand();
    authenticateTelegram().then(async (authenticatedUser) => {
      setUser(authenticatedUser);
      setHistory(isDemoMode ? readDemoHistory() : await fetchTripHistory(authenticatedUser.id));
    }).catch((cause: Error) => setError(cause.message));
  }, []);

  useEffect(() => {
    if (!trip || isDemoMode) return;
    const timer = window.setInterval(() => fetchTrip(trip.id).then(setTrip).catch(() => undefined), 5000);
    return () => window.clearInterval(timer);
  }, [trip?.id]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const remaining = useMemo(() => trip ? formatRemaining(trip.deadlineAt, now) : '', [trip, now]);

  async function run(action: () => Promise<void>) {
    setBusy(true); setError(''); setNotice('');
    try { await action(); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Something went wrong.'); } finally { setBusy(false); }
  }

  function handleCreate() {
    if (!user || !navigator.geolocation || !destination.trim()) { setError('Enter a destination and allow location access to create a trip.'); return; }
    run(async () => {
      const position = await new Promise<GeolocationPosition>((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, () => reject(new Error('Location permission was not granted. Try again or allow location in your browser settings.')), { enableHighAccuracy: true, timeout: 15000 }));
      const deadline = new Date(Date.now() + Math.max(5, Number(minutes) || 30) * 60_000).toISOString();
      const created = isDemoMode
        ? { id: crypto.randomUUID(), inviteCode: Math.random().toString(36).slice(2, 8).toUpperCase(), status: 'ACTIVE' as const, deadlineAt: deadline, createdAt: new Date().toISOString(), ownerId: user.id, startLatitude: position.coords.latitude, startLongitude: position.coords.longitude, destination: destination.trim(), members: [{ userId: user.id, displayName: user.displayName, joinedAt: new Date().toISOString() }], locations: [] }
        : await createTrip(user.id, deadline, position.coords.latitude, position.coords.longitude, destination.trim());
      setTrip(created);
      if (isDemoMode) setHistory(saveDemoHistory([created, ...history]));
      setNotice('Trip created. Invite up to three people to watch.');
    });
  }

  function handleJoin() {
    if (!user) return;
    run(async () => { const joined = await joinTrip(user.id, inviteCode); setTrip(joined); setHistory((current) => [joined, ...current.filter((item) => item.id !== joined.id)]); setNotice('You joined the safety trip.'); });
  }

  function changeStatus(status: TripStatus) {
    if (!trip) return;
    run(async () => {
      if (!isDemoMode) await updateTripStatus(trip.id, status);
      setTrip({ ...trip, status });
      setHistory((current) => current.map((item) => item.id === trip.id ? { ...item, status } : item));
      window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred(status === 'EMERGENCY' ? 'warning' : 'success');
    });
  }

  function shareLocation() {
    if (!trip || !user || !navigator.geolocation) { setError('Location is not available in this browser.'); return; }
    run(() => new Promise<void>((resolve, reject) => navigator.geolocation.getCurrentPosition(async (position) => {
      const { latitude, longitude, accuracy } = position.coords;
      if (!isDemoMode) await saveLocation(trip.id, user.id, latitude, longitude, accuracy);
      setTrip({ ...trip, locations: [{ userId: user.id, latitude, longitude, accuracy, updatedAt: new Date().toISOString() }, ...trip.locations.filter((point) => point.userId !== user.id)] });
      setNotice('Your latest location is now shared.'); resolve();
    }, () => reject(new Error('Location permission was not granted.')), { enableHighAccuracy: true, timeout: 10000 })));
  }

  if (!user) return <main className="shell"><div className="loading">Connecting to Telegram…</div></main>;
  return <main className="shell">
    <header className="topbar"><div><span className="eyebrow">SAFEROUTE</span><h1>Stay connected.</h1></div><div className="avatar">{user.displayName.slice(0, 1).toUpperCase()}</div></header>
    <nav className="app-nav"><button className={!showHistory ? 'nav-active' : ''} onClick={() => setShowHistory(false)}>Current trip</button><button className={showHistory ? 'nav-active' : ''} onClick={() => { setShowHistory(true); setTrip(null); }}>History <span>{history.length}</span></button></nav>
    {isDemoMode && <div className="demo-banner">Demo mode · add Telegram and Nhost configuration to sync real trips.</div>}
    {error && <div className="alert error">{error}</div>}
    {notice && <div className="alert success">{notice}</div>}
    {showHistory ? <section className="history-page"><div className="section-heading"><div><span className="eyebrow">YOUR JOURNEYS</span><h2>Trip history</h2></div><button className="small-button" onClick={() => run(async () => { setHistory(isDemoMode ? readDemoHistory() : user ? await fetchTripHistory(user.id) : []); })}>Refresh</button></div>{history.length === 0 ? <div className="card empty-state">No trips yet. Trips you create or join will appear here.</div> : history.map((item) => <button className="history-item" key={item.id} onClick={() => { setTrip(item); setShowHistory(false); }}><span className={`history-indicator ${item.status.toLowerCase()}`} /><span className="history-info"><strong>{item.status === 'COMPLETED' ? 'Safe arrival' : item.status === 'EMERGENCY' ? 'Emergency trip' : 'Active trip'}</strong><small>{new Date(item.createdAt).toLocaleString()} · code {item.inviteCode}</small></span><span className="history-chevron">›</span></button>)}</section> : !trip ? <section className="landing">
      <div className="hero-card"><span className="hero-icon">⌁</span><h2>A safer journey for two.</h2><p>Create a private trip, share the code, and let someone know when you arrive.</p></div>
      <div className="card"><label htmlFor="destination">Where are you going?</label><input id="destination" placeholder="Destination" value={destination} onChange={(event) => setDestination(event.target.value)} /><label>Trip deadline</label><div className="input-row"><input type="number" min="5" max="1440" value={minutes} onChange={(event) => setMinutes(event.target.value)} /><span>minutes</span></div><button disabled={busy || !destination.trim()} onClick={handleCreate}>{busy ? 'Getting location…' : 'Create a trip'}</button></div>
      <div className="divider"><span>or join a trip</span></div>
      <div className="card"><label htmlFor="invite">Invite code</label><input id="invite" placeholder="e.g. SAFE42" value={inviteCode} onChange={(event) => setInviteCode(event.target.value.toUpperCase())} maxLength={8} /><button className="secondary" disabled={busy || inviteCode.length < 4} onClick={handleJoin}>Join trip</button></div>
    </section> : <TripDashboard trip={trip} remaining={remaining} editMinutes={editMinutes} setEditMinutes={setEditMinutes} onEditDeadline={() => run(async () => { const deadlineAt = new Date(Date.now() + Math.max(5, Number(editMinutes) || 30) * 60_000).toISOString(); if (!isDemoMode) await updateTripDeadline(trip.id, deadlineAt); const updated = { ...trip, deadlineAt }; setTrip(updated); setHistory((current) => isDemoMode ? saveDemoHistory(current.map((item) => item.id === trip.id ? updated : item)) : current.map((item) => item.id === trip.id ? updated : item)); setNotice('Trip deadline updated.'); })} onStatus={changeStatus} onShareLocation={shareLocation} />}
  </main>;
}

function TripDashboard({ trip, remaining, editMinutes, setEditMinutes, onEditDeadline, onStatus, onShareLocation }: { trip: Trip; remaining: string; editMinutes: string; setEditMinutes: (value: string) => void; onEditDeadline: () => void; onStatus: (status: TripStatus) => void; onShareLocation: () => void }) {
  const isEmergency = trip.status === 'EMERGENCY';
  return <section className="dashboard">
    <div className={`status-card ${isEmergency ? 'emergency' : ''}`}><div><span className="eyebrow">TRIP STATUS</span><h2>{isEmergency ? 'Emergency mode' : trip.status === 'COMPLETED' ? 'Trip completed' : 'Trip is active'}</h2><p>{isEmergency ? 'Your companion can see that you need attention.' : trip.status === 'COMPLETED' ? 'Everyone has been notified of your safe arrival.' : `Deadline in ${remaining}`}</p></div><span className="status-dot" /></div>
    {trip.status === 'ACTIVE' && <div className="card edit-deadline"><span className="eyebrow">EDIT TRIP</span><h3>Change deadline</h3><div className="deadline-edit-row"><input aria-label="New trip deadline in minutes" type="number" min="5" max="1440" placeholder="30" value={editMinutes} onChange={(event) => setEditMinutes(event.target.value)} /><span>minutes from now</span><button className="small-button" onClick={onEditDeadline}>Update</button></div></div>}
    <div className="code-card"><span className="eyebrow">INVITE UP TO THREE WATCHERS</span><strong>{trip.inviteCode}</strong><p>{trip.destination ? `Destination: ${trip.destination}` : 'Destination not set'}</p><button onClick={() => { const link = `https://t.me/SafeRoute_for_friends_Bot?startapp=${encodeURIComponent(trip.inviteCode)}`; const share = `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(`Watch my SafeRoute trip to ${trip.destination ?? 'my destination'}`)}`; const tg = window.Telegram?.WebApp; if (tg?.openTelegramLink) tg.openTelegramLink(share); else window.open(share, '_blank', 'noopener,noreferrer'); }}>Invite Telegram contact</button><button className="secondary" onClick={() => navigator.clipboard.writeText(`https://t.me/SafeRoute_for_friends_Bot?startapp=${trip.inviteCode}`)}>Copy invite link</button></div>
    <div className="card map-card"><div className="section-heading"><div><span className="eyebrow">SHARED LOCATION</span><h3>{trip.locations.length ? `${trip.locations.length} location${trip.locations.length > 1 ? 's' : ''} shared` : 'No location shared yet'}</h3></div><button className="small-button" onClick={onShareLocation}>Share mine</button></div><MapPanel locations={trip.locations} /></div>
    <div className="member-list card"><span className="eyebrow">COMPANION</span>{trip.members.map((member) => <div className="member" key={member.userId}><span className="avatar small">{member.displayName.slice(0, 1).toUpperCase()}</span><span>{member.displayName}</span><span className="online">Connected</span></div>)}</div>
    {trip.status === 'ACTIVE' && <div className="actions"><button className="danger" onClick={() => onStatus('EMERGENCY')}>Emergency</button><button className="secondary" onClick={() => onStatus('COMPLETED')}>I arrived safely</button></div>}
  </section>;
}

function formatRemaining(deadline: string, now: number) { const ms = Math.max(0, new Date(deadline).getTime() - now); const minutes = Math.floor(ms / 60_000); return `${minutes}m ${Math.floor((ms % 60_000) / 1000)}s`; }

const DEMO_HISTORY_KEY = 'safe-route-demo-history';
function readDemoHistory(): Trip[] { try { return JSON.parse(localStorage.getItem(DEMO_HISTORY_KEY) ?? '[]') as Trip[]; } catch { return []; } }
function saveDemoHistory(trips: Trip[]): Trip[] { localStorage.setItem(DEMO_HISTORY_KEY, JSON.stringify(trips)); return trips; }

export default App;
