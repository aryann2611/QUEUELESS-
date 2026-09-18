import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion'
import { Menu, X, Sun, Moon, Bell, LogOut, User, Search, Home, MapPin, Ticket, CalendarDays, LayoutDashboard, ListOrdered, Store, Wrench, BarChart3, Settings, Users, Building2, PanelLeftClose, PanelLeftOpen, ChevronDown, Zap, IndianRupee, Star } from 'lucide-react'
import { useAuth } from '../auth.jsx'
import { useTheme } from '../lib/theme.jsx'
import { useNotifications } from '../lib/notifications.jsx'
import { roleHome } from '../lib/format.js'
import { Logo, Button, Avatar, Dropdown, MenuItem, cx } from '../ui/index.jsx'
import { useScrolled } from '../lib/motion.js'
import { Drawer } from '../ui/Modal.jsx'
import { SearchPalette, useSearchPalette } from './SearchPalette.jsx'

const PUBLIC_LINKS = [
  { to: '/', label: 'Home', end: true },
  { to: '/#how', label: 'How it Works', hash: true },
  { to: '/nearby', label: 'Nearby' },
  { to: '/#business', label: 'For Businesses', hash: true },
]
const USER_LINKS = [
  { to: '/app', label: 'Home', icon: Home, end: true },
  { to: '/nearby', label: 'Nearby', icon: MapPin },
  { to: '/queue', label: 'My Queue', icon: Ticket },
  { to: '/appointments', label: 'Appointments', icon: CalendarDays },
]

function ThemeToggle() {
  const { resolved, toggle } = useTheme()
  return <Button variant="ghost" icon={resolved === 'dark' ? Sun : Moon} aria-label={resolved === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'} data-tip={resolved === 'dark' ? 'Light mode' : 'Dark mode'} onClick={toggle} />
}

function UserMenu() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  return (
    <Dropdown trigger={(p) => (
      <button type="button" className="btn btn-ghost" style={{ padding: '0 8px 0 4px' }} onClick={p.toggle} aria-haspopup="menu" aria-expanded={p.open} aria-label="Account menu">
        <Avatar name={user.name} size="sm" /><span className="hide-mobile">{user.name.split(' ')[0]}</span><ChevronDown aria-hidden style={{ width: 16, height: 16, color: 'var(--text-3)' }} />
      </button>
    )}>
      <div className="menu-head">{user.email}</div>
      <MenuItem to={roleHome(user.role)} icon={LayoutDashboard}>{user.role === 'user' ? 'Home' : 'Dashboard'}</MenuItem>
      <MenuItem to="/profile" icon={User}>Profile</MenuItem>
      <div className="menu-sep" />
      <MenuItem icon={LogOut} danger onClick={() => { logout(); navigate('/') }}>Log out</MenuItem>
    </Dropdown>
  )
}

/** Top navigation for public + customer pages. */
export function Navbar() {
  const { user } = useAuth()
  const { unread } = useNotifications()
  const [scrolled, setScrolled] = useState(false)
  const [open, setOpen] = useState(false)
  const location = useLocation()
  const palette = useSearchPalette()
  // one read per frame instead of one per scroll event
  const scrolledNow = useScrolled(8)
  useEffect(() => setScrolled(scrolledNow), [scrolledNow])
  useEffect(() => setOpen(false), [location])
  const links = user?.role === 'user' ? USER_LINKS : PUBLIC_LINKS
  const isHashActive = (l) => l.hash ? false : undefined

  return (
    <>
      <header className={cx('navbar', scrolled && 'scrolled')}>
        <div className="container">
          <Logo to={user ? roleHome(user.role) : '/'} />
          <nav className="nav-links" aria-label="Primary">
            {links.map((l) => l.hash
              ? <a key={l.to} href={l.to} className="nav-link">{l.label}</a>
              : <NavLink key={l.to} to={l.to} end={l.end} className={({ isActive }) => cx('nav-link', isActive && 'active')}>
                  {({ isActive }) => <>{l.label}{isActive && <motion.span layoutId="nav-ind" className="nav-ind" transition={{ type: 'spring', stiffness: 500, damping: 40 }} />}</>}
                </NavLink>)}
          </nav>
          <div className="nav-right">
            <Button variant="ghost" icon={Search} aria-label="Search (Ctrl+K)" data-tip="Search  ⌘K" onClick={palette.open} className="hide-mobile hide-compact" />
            <ThemeToggle />
            {user ? (
              <>
                {user.role === 'user' && (
                  <NavLink to="/notifications" className="btn btn-ghost btn-icon hide-mobile" aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`} data-tip="Notifications" style={{ position: 'relative' }}>
                    <Bell aria-hidden />{unread > 0 && <span className="nav-dot">{unread > 9 ? '9+' : unread}</span>}
                  </NavLink>
                )}
                <UserMenu />
              </>
            ) : (
              <>
                <Button variant="ghost" to="/login" className="hide-mobile">Login</Button>
                <Button variant="primary" to="/register">Get Started</Button>
              </>
            )}
            <Button variant="ghost" icon={open ? X : Menu} aria-label="Menu" className="only-mobile" onClick={() => setOpen(true)} />
          </div>
        </div>
      </header>
      <Drawer open={open} onClose={() => setOpen(false)} label="Menu">
        <div className="drawer-stagger">
        <div className="between mb-3"><Logo /><Button variant="ghost" icon={X} aria-label="Close menu" onClick={() => setOpen(false)} /></div>
        {links.map((l) => l.hash
          ? <a key={l.to} href={l.to} className="nav-link" onClick={() => setOpen(false)}>{l.label}</a>
          : <NavLink key={l.to} to={l.to} end={l.end} className={({ isActive }) => cx('nav-link', isActive && 'active')}>{l.icon && <l.icon aria-hidden style={{ width: 18 }} />}{l.label}</NavLink>)}
        {user?.role === 'user' && <NavLink to="/notifications" className="nav-link"><Bell aria-hidden style={{ width: 18 }} />Notifications{unread > 0 && <span className="badge badge-danger" style={{ marginLeft: 'auto' }}>{unread}</span>}</NavLink>}
        {user && <NavLink to="/profile" className="nav-link"><User aria-hidden style={{ width: 18 }} />Profile</NavLink>}
        <button type="button" className="nav-link" onClick={() => { setOpen(false); palette.open() }}><Search aria-hidden style={{ width: 18 }} />Search</button>
        <div className="divider mt-2 mb-2" />
        {!user && <div className="stack gap-2"><Button variant="primary" to="/register" block>Get Started</Button><Button variant="secondary" to="/login" block>Login</Button></div>}
        </div>
      </Drawer>
      <SearchPalette />
    </>
  )
}

/** Mobile bottom navigation for customers. */
export function BottomNav() {
  const { user } = useAuth()
  const { unread } = useNotifications()
  if (!user || user.role !== 'user') return null
  const items = [...USER_LINKS, { to: '/profile', label: 'Profile', icon: User }]
  return (
    <nav className="bottom-nav" aria-label="Mobile">
      {items.map((l) => (
        <NavLink key={l.to} to={l.to} end={l.end} className={({ isActive }) => cx('bottom-link', isActive && 'active')}>
          {({ isActive }) => (
            <>
              {isActive && <motion.span layoutId="bottom-ind" className="b-ind" transition={{ type: 'spring', stiffness: 500, damping: 40 }} />}
              <l.icon aria-hidden strokeWidth={isActive ? 2.4 : 2} />
              <span>{l.label}</span>
              {l.to === '/profile' && unread > 0 && <span className="dot" aria-hidden />}
            </>
          )}
        </NavLink>
      ))}
    </nav>
  )
}

export function Footer() {
  return (
    <footer className="footer">
      <div className="container">
        <div className="footer-top">
          <div className="stack gap-3">
            <Logo />
            <p className="muted small" style={{ maxWidth: 320 }}>Skip the wait. Join queues remotely, track your turn live, and arrive when it matters.</p>
          </div>
          <div className="footer-cols">
            <div><h4>Product</h4><a href="/#how">How it works</a><a href="/nearby">Nearby services</a><a href="/#business">For businesses</a></div>
            <div><h4>Account</h4><a href="/login">Login</a><a href="/register">Get started</a><a href="/register?role=staff">Register a business</a></div>
          </div>
        </div>
        <div className="footer-bottom"><span>© {new Date().getFullYear()} QueueLess</span><span>Skip the wait. Live your time.</span></div>
      </div>
    </footer>
  )
}

/** Public/customer shell */
export function PublicLayout({ footer = true }) {
  return (
    <>
      <Navbar />
      <main className="grow"><RouteFade /></main>
      {footer && <Footer />}
      <BottomNav />
    </>
  )
}

/** Cross-fades the routed page while the chrome stays mounted. Opacity only; pages add their own rise. */
function RouteFade() {
  const { pathname } = useLocation()
  const reduce = useReducedMotion()
  if (reduce) return <Outlet />
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div key={pathname} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}>
        <Outlet />
      </motion.div>
    </AnimatePresence>
  )
}

/* ---------------- Dashboard shell (vendor + admin) ---------------- */
export const VENDOR_NAV = [
  { to: '/vendor', label: 'Overview', icon: LayoutDashboard, end: true },
  { to: '/vendor/queue', label: 'Queue', icon: ListOrdered },
  { to: '/vendor/appointments', label: 'Appointments', icon: CalendarDays },
  { to: '/vendor/shop', label: 'Shop Profile', icon: Store },
  { to: '/vendor/location', label: 'Location', icon: MapPin },
  { to: '/vendor/services', label: 'Services', icon: Wrench },
  { to: '/vendor/analytics', label: 'Analytics', icon: BarChart3 },
  { to: '/vendor/sales', label: 'Sales', icon: IndianRupee },
  { to: '/vendor/reviews', label: 'Reviews', icon: Star },
  { to: '/vendor/settings', label: 'Settings', icon: Settings },
]
export const ADMIN_NAV = [
  { to: '/admin', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/admin/shops', label: 'Shops', icon: Store },
  { to: '/admin/users', label: 'Users', icon: Users },
  { to: '/admin/vendors', label: 'Vendors', icon: Building2 },
  { to: '/admin/queues', label: 'Queues', icon: ListOrdered },
  { to: '/admin/appointments', label: 'Appointments', icon: CalendarDays },
  { to: '/admin/analytics', label: 'Analytics', icon: BarChart3 },
  { to: '/admin/transactions', label: 'Transactions', icon: IndianRupee },
  { to: '/admin/settings', label: 'Settings', icon: Settings },
]

export function DashboardLayout({ nav, title }) {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [collapsed, setCollapsed] = useState(() => { try { return localStorage.getItem('queueless.sidebar') === '1' } catch { return false } })
  const [open, setOpen] = useState(false)
  useEffect(() => setOpen(false), [location])
  useEffect(() => { try { localStorage.setItem('queueless.sidebar', collapsed ? '1' : '0') } catch {} }, [collapsed])
  const current = nav.find((n) => (n.end ? location.pathname === n.to : location.pathname.startsWith(n.to)))

  return (
    <div className="dash">
      <AnimatePresence>{open && <motion.div key="ov" className="overlay" style={{ zIndex: 65, padding: 0 }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setOpen(false)} />}</AnimatePresence>
      <aside className={cx('sidebar', collapsed && 'collapsed', open && 'open')} aria-label={`${title} navigation`}>
        <Logo to={nav[0].to} />
        <div className="side-section">{title}</div>
        <nav className="sidebar-links">
          {nav.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => cx('side-link', isActive && 'active')} data-tip={collapsed ? n.label : undefined}>
              {({ isActive }) => <>{isActive && <motion.span layoutId="side-ind" className="side-ind" transition={{ type: 'spring', stiffness: 500, damping: 40 }} />}<n.icon aria-hidden /><span>{n.label}</span></>}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-foot">
          <NavLink to="/nearby" className="side-link"><MapPin aria-hidden /><span>Customer view</span></NavLink>
          <div className="sidebar-user"><Avatar name={user.name} size="sm" /><span><b>{user.name}</b><small>{user.role === 'admin' ? 'Administrator' : 'Vendor'}</small></span></div>
          <Button variant="ghost" size="sm" icon={collapsed ? PanelLeftOpen : PanelLeftClose} className="side-collapse" aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} onClick={() => setCollapsed((c) => !c)} />
        </div>
      </aside>
      <div className="dash-main">
        <div className="dash-top">
          <Button variant="ghost" icon={Menu} aria-label="Open navigation" className="dash-menu" onClick={() => setOpen(true)} />
          <span className="strong">{current?.label ?? title}</span>
          <div className="nav-right">
            <ThemeToggle />
            <Button variant="ghost" icon={LogOut} aria-label="Log out" data-tip="Log out" onClick={() => { logout(); navigate('/') }} />
          </div>
        </div>
        <main className="dash-content"><RouteFade /></main>
      </div>
    </div>
  )
}

export { Zap }
