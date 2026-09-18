import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Search, Store, Users, ListOrdered, CalendarDays, ExternalLink, BadgeCheck, Ban, Undo2 } from 'lucide-react'
import { api } from '../../api.js'
import { useAuth } from '../../auth.jsx'
import { useFetch, useQueueWatch, applyUpdate } from '../../lib/hooks.js'
import { category, fmtAddress, fmtDate, fmtTime, fmtMin, num } from '../../lib/format.js'
import { Badge, LiveDot, Select, Skeleton, EmptyState, ErrorState, PageTransition, Button, Segmented, StatCard, cx } from '../../ui/index.jsx'
import { useToast } from '../../ui/Toast.jsx'
import { useAdminStats, series } from './Dashboard.jsx'
import { BarChart } from '../../components/Chart.jsx'

/** Generic admin table page: title, search, columns. */
function TablePage({ title, sub, icon: Icon, rows, columns, loading, error, reload, searchKeys, empty, extra }) {
  const [q, setQ] = useState('')
  const list = useMemo(() => {
    const s = q.trim().toLowerCase()
    return s ? rows.filter((r) => searchKeys.some((k) => String(k(r) ?? '').toLowerCase().includes(s))) : rows
  }, [rows, q, searchKeys])
  return (
    <PageTransition className="stack gap-5">
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div><h1>{title}</h1><p className="sub">{sub}</p></div>
        <div className="row gap-2 wrap">{extra}<div className="input-wrap"><Search aria-hidden /><input type="search" className="input" placeholder={`Search ${title.toLowerCase()}…`} value={q} onChange={(e) => setQ(e.target.value)} aria-label={`Search ${title}`} style={{ width: 240 }} /></div></div>
      </div>
      {error ? <ErrorState onRetry={reload}>We couldn't load {title.toLowerCase()}.</ErrorState> : loading ? <Skeleton h={320} r={16} /> : !list.length ? <EmptyState icon={Icon} title={empty} /> : (
        <div className="table-wrap"><table className="table"><thead><tr>{columns.map((c) => <th key={c.h} style={c.w ? { width: c.w } : undefined}>{c.h}</th>)}</tr></thead><tbody>{list.map((r) => <tr key={r._id}>{columns.map((c) => <td key={c.h}>{c.cell(r)}</td>)}</tr>)}</tbody></table></div>
      )}
      <p className="xs faint">{num(list.length)} of {num(rows.length)}</p>
    </PageTransition>
  )
}

const ShopName = ({ s }) => { const cat = category(s.category); return <span className="row gap-3"><span className={cx('icon-box', s.category)} style={{ width: 32, height: 32 }}><cat.icon aria-hidden style={{ width: 16 }} /></span><span className="stack"><Link to={`/shop/${s._id}`} className="strong" style={{ color: 'inherit' }}>{s.name}</Link><span className="xs muted">{cat.label}</span></span></span> }

const VERIFY = {
  pending: { tone: 'warning', label: 'Pending' },
  approved: { tone: 'success', label: 'Verified' },
  suspended: { tone: 'danger', label: 'Suspended' },
}

export function Shops() {
  const toast = useToast()
  // ?all=1 is admin-only and is the only way pending/suspended shops show up — the public list hides them
  const { data, loading, error, reload, setData } = useFetch('/api/queues', { query: { all: '1' } })
  const rows = data?.queues || []
  useQueueWatch(rows.map((s) => s._id), (u) => setData((d) => d && { queues: d.queues.map((s) => (s._id === u.queueId ? applyUpdate(s, u) : s)) }))
  const pending = rows.filter((s) => s.status === 'pending').length

  async function setStatus(s, status) {
    try {
      const { shop } = await api(`/api/admin/shops/${s._id}`, { method: 'PATCH', body: { status } })
      setData((d) => ({ queues: d.queues.map((x) => (x._id === shop._id ? { ...x, status: shop.status } : x)) }))
      toast.success(`${shop.name} is now ${VERIFY[shop.status].label.toLowerCase()}.`)
    } catch (e) { toast.error(e.message) }
  }

  // newest-looking work first: anything waiting on a decision floats to the top
  const sorted = [...rows].sort((a, b) => (b.status === 'pending') - (a.status === 'pending'))
  return <TablePage title="Shops" sub="Every business on the platform. Approve a new one before customers can find it." icon={Store} rows={sorted} loading={loading} error={error} reload={reload} empty="No shops yet." searchKeys={[(s) => s.name, (s) => s.category, (s) => s.address?.city, (s) => s.status]}
    extra={pending > 0 && <Badge tone="warning" size="lg">{pending} awaiting approval</Badge>}
    columns={[
      { h: 'Shop', cell: (s) => <ShopName s={s} /> },
      { h: 'Address', cell: (s) => <span className="small muted">{fmtAddress(s.address) || '—'}</span> },
      { h: 'Location', cell: (s) => s.location ? <Badge tone="success">On map</Badge> : <Badge tone="warning">No pin</Badge> },
      { h: 'Verification', cell: (s) => { const v = VERIFY[s.status] || VERIFY.approved; return <Badge tone={v.tone}>{v.label}</Badge> } },
      { h: 'Queue', cell: (s) => <Badge tone={s.isOpen ? 'open' : 'closed'}>{s.isOpen ? <><LiveDot />Open</> : 'Closed'}</Badge> },
      { h: '', w: 210, cell: (s) => (
        <span className="row gap-2" style={{ justifyContent: 'flex-end' }}>
          {s.status === 'pending' && <Button variant="primary" size="sm" icon={BadgeCheck} onClick={() => setStatus(s, 'approved')}>Approve</Button>}
          {s.status === 'approved' && <Button variant="ghost" size="sm" icon={Ban} onClick={() => setStatus(s, 'suspended')}>Suspend</Button>}
          {s.status === 'suspended' && <Button variant="secondary" size="sm" icon={Undo2} onClick={() => setStatus(s, 'approved')}>Restore</Button>}
          <Button variant="ghost" size="sm" icon={ExternalLink} to={`/shop/${s._id}`} aria-label={`Open ${s.name}`} />
        </span>
      ) },
    ]} />
}

export function UsersPage({ vendors }) {
  const { user: me } = useAuth()
  const toast = useToast()
  const { data, loading, error, reload, setData } = useFetch('/api/admin/users')
  const rows = (data?.users || []).filter((u) => (vendors ? u.role === 'staff' : true))
  async function setRole(u, role) {
    try { const { user } = await api(`/api/admin/users/${u._id}`, { method: 'PATCH', body: { role } }); setData((d) => ({ users: d.users.map((x) => (x._id === u._id ? user : x)) })); toast.success(`${user.name} is now ${role}.`) } catch (e) { toast.error(e.message) }
  }
  return <TablePage title={vendors ? 'Vendors' : 'Users'} sub={vendors ? 'Accounts that manage a business.' : 'Everyone with a QueueLess account.'} icon={Users} rows={rows} loading={loading} error={error} reload={reload} empty={vendors ? 'No vendors yet.' : 'No users yet.'} searchKeys={[(u) => u.name, (u) => u.email, (u) => u.role]}
    columns={[
      { h: 'Name', cell: (u) => <span className="stack"><b>{u.name}</b><span className="xs muted">{u.email}</span></span> },
      { h: 'Joined', cell: (u) => u.createdAt ? <span className="stack"><span className="small">{fmtDate(u.createdAt)}</span><span className="xs muted">{fmtTime(u.createdAt)}{fmtDate(u.createdAt) === 'Today' ? '' : ` · ${new Date(u.createdAt).getFullYear()}`}</span></span> : <span className="small muted">—</span> },
      { h: 'Role', w: 160, cell: (u) => u._id === me._id ? <Badge tone="primary">{u.role} (you)</Badge> : <Select value={u.role} onChange={(e) => setRole(u, e.target.value)} aria-label={`Role for ${u.name}`} style={{ height: 34 }}><option value="user">user</option><option value="staff">staff</option><option value="admin">admin</option></Select> },
    ]} />
}

export function Queues() {
  const { data, loading, error, reload, setData } = useFetch('/api/queues', { query: { all: '1' } })
  const rows = data?.queues || []
  useQueueWatch(rows.map((s) => s._id), (u) => setData((d) => d && { queues: d.queues.map((s) => (s._id === u.queueId ? applyUpdate(s, u) : s)) }))
  const sorted = [...rows].sort((a, b) => b.waitingCount - a.waitingCount)
  return <TablePage title="Queues" sub="Live queue status across all shops." icon={ListOrdered} rows={sorted} loading={loading} error={error} reload={reload} empty="No queues yet." searchKeys={[(s) => s.name]}
    extra={<Badge tone="primary" size="lg"><LiveDot />{rows.reduce((a, s) => a + s.waitingCount, 0)} waiting now</Badge>}
    columns={[
      { h: 'Shop', cell: (s) => <ShopName s={s} /> },
      { h: 'Serving', cell: (s) => <b className="num">{s.currentNumber != null ? `#${s.currentNumber}` : '–'}</b> },
      { h: 'Waiting', cell: (s) => <b className="num">{s.waitingCount}</b> },
      { h: 'Est. wait', cell: (s) => <span className="small">~{fmtMin(s.etaMinutes)}</span> },
      { h: 'Avg / customer', cell: (s) => <span className="small muted">{fmtMin(s.avgServiceMinutes)}</span> },
      { h: 'Status', cell: (s) => <Badge tone={s.isOpen ? 'open' : 'closed'}>{s.isOpen ? 'Open' : 'Closed'}</Badge> },
    ]} />
}

export function AdminAppointments() {
  const { data, loading, error, reload } = useFetch('/api/appointments')
  const [scope, setScope] = useState('upcoming')
  const all = data?.appointments || []
  const rows = all.filter((a) => scope === 'all' ? true : scope === 'upcoming' ? new Date(a.at) >= new Date() && a.status !== 'cancelled' : new Date(a.at) < new Date() || a.status === 'cancelled')
  return <TablePage title="Appointments" sub="Bookings across all shops." icon={CalendarDays} rows={rows} loading={loading} error={error} reload={reload} empty="No appointments." searchKeys={[(a) => a.user?.name, (a) => a.queue?.name, (a) => a.service, (a) => a.status]}
    extra={<Segmented label="Scope" value={scope} onChange={setScope} options={[{ value: 'upcoming', label: 'Upcoming' }, { value: 'past', label: 'Past' }, { value: 'all', label: 'All' }]} />}
    columns={[
      { h: 'When', cell: (a) => <span className="stack"><b>{fmtDate(a.at)}</b><span className="xs muted">{fmtTime(a.at)}</span></span> },
      { h: 'Customer', cell: (a) => a.user?.name || '—' },
      { h: 'Shop', cell: (a) => <Link to={`/shop/${a.queue?._id}`} style={{ color: 'inherit' }}>{a.queue?.name || '—'}</Link> },
      { h: 'Service', cell: (a) => <span className="small muted">{a.service || '—'}</span> },
      { h: 'Token', cell: (a) => a.token ? <b className="num">#{a.token.number}</b> : <span className="muted">—</span> },
      { h: 'Status', cell: (a) => <Badge tone={a.status}>{a.status.replace('_', ' ')}</Badge> },
    ]} />
}

export function AdminAnalytics() {
  const { data, loading, error, reload } = useAdminStats()
  if (error) return <ErrorState onRetry={reload}>We couldn't load analytics.</ErrorState>
  if (loading && !data) return <Skeleton h={400} r={16} />
  const totalTokens = data.tokensPerDay.reduce((a, b) => a + b.count, 0)
  return (
    <PageTransition className="stack gap-6">
      <div className="page-head" style={{ marginBottom: 0 }}><div><h1>Analytics</h1><p className="sub">Last 7 days across the platform.</p></div><Button variant="secondary" size="sm" onClick={reload}>Refresh</Button></div>
      <div className="grid grid-3">
        <StatCard label="Tokens (7d)" value={totalTokens} sub={`${data.todaysTokens} today`} accent />
        <StatCard label="New users (7d)" value={data.usersPerDay.reduce((a, b) => a + b.count, 0)} sub={`${data.users} total`} />
        <StatCard label="Appointments (7d)" value={data.appointmentsPerDay.reduce((a, b) => a + b.count, 0)} sub={`${data.todaysAppointments} today`} />
      </div>
      <section className="card"><div className="mb-4"><h3>Token activity</h3><p className="small muted">Tokens issued per day.</p></div><BarChart data={series(data.tokensPerDay)} ariaLabel="Tokens per day" format={(v) => `${num(v)} tokens`} /></section>
      <div className="grid grid-2" style={{ alignItems: 'start' }}>
        <section className="card"><div className="mb-4"><h3>User growth</h3><p className="small muted">Sign-ups per day.</p></div><BarChart data={series(data.usersPerDay)} height={140} ariaLabel="New users per day" format={(v) => `${num(v)} users`} /></section>
        <section className="card"><div className="mb-4"><h3>Appointment activity</h3><p className="small muted">Bookings created per day.</p></div><BarChart data={series(data.appointmentsPerDay)} height={140} ariaLabel="Appointments per day" format={(v) => `${num(v)} bookings`} /></section>
      </div>
      <section className="card">
        <div className="mb-4"><h3>Busiest shops right now</h3></div>
        <div className="table-wrap" style={{ border: 0 }}><table className="table"><thead><tr><th>Shop</th><th>Serving</th><th>Waiting</th><th>Status</th></tr></thead><tbody>{data.shops.slice(0, 8).map((s) => <tr key={s._id}><td><ShopName s={s} /></td><td className="num strong">{s.currentNumber != null ? `#${s.currentNumber}` : '–'}</td><td className="num strong">{s.waitingCount}</td><td><Badge tone={s.isOpen ? 'open' : 'closed'}>{s.isOpen ? 'Open' : 'Closed'}</Badge></td></tr>)}</tbody></table></div>
      </section>
    </PageTransition>
  )
}

export function AdminSettings() {
  const { user } = useAuth()
  return (
    <PageTransition className="stack gap-5" style={{ maxWidth: 720 }}>
      <div className="page-head" style={{ marginBottom: 0 }}><div><h1>Settings</h1><p className="sub">Platform configuration.</p></div></div>
      <section className="card stack gap-3">
        <h3>Administrator</h3>
        <div className="between"><span className="muted small">Signed in as</span><b>{user.email}</b></div>
        <div className="divider" />
        <p className="small muted">Admin accounts are granted by registering with the email set in <code>ADMIN_EMAIL</code> on the server, or by promoting a user from the <Link to="/admin/users">Users</Link> page.</p>
      </section>
      <section className="card stack gap-3">
        <h3>Maps</h3>
        <p className="small muted">By default the app uses the free <b>OpenStreetMap</b> provider (CARTO tiles + Nominatim search) — no key needed. To use Google Maps instead, set <code>VITE_GOOGLE_MAPS_API_KEY</code> (and optionally <code>VITE_GOOGLE_MAPS_MAP_ID</code>) in <code>client/.env</code>, restrict the key to your domain, and enable only <b>Maps JavaScript API</b> and <b>Places API (New)</b>.</p>
      </section>
      <section className="card stack gap-3">
        <h3>Queue rules</h3>
        <ul className="small muted stack gap-2" style={{ listStyle: 'disc', paddingLeft: 18 }}>
          <li>Token numbers are per-shop and reset daily (UTC).</li>
          <li>A customer may hold one active token per shop.</li>
          <li>Checked-in appointments become priority tokens and are served next.</li>
          <li>Wait estimates use a rolling average of real service times.</li>
        </ul>
      </section>
    </PageTransition>
  )
}
