import { lazy, Suspense, useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { AuthProvider, RequireAuth, useAuth } from './auth.jsx'
import { ThemeProvider } from './lib/theme.jsx'
import { ToastProvider } from './ui/Toast.jsx'
import { NotificationsProvider } from './lib/notifications.jsx'
import { roleHome } from './lib/format.js'
import { PublicLayout, DashboardLayout, VENDOR_NAV, ADMIN_NAV } from './components/Layout.jsx'
import { Skeleton } from './ui/index.jsx'
import { CursorGlow } from './components/CursorGlow.jsx'
import Landing from './pages/Landing.jsx'
import Login from './pages/Login.jsx'

// code-split: customer, shop discovery, vendor and admin bundles load on demand
const Nearby = lazy(() => import('./pages/Nearby.jsx'))
const Shop = lazy(() => import('./pages/Shop.jsx'))
const Home = lazy(() => import('./pages/user/Home.jsx'))
const Ticket = lazy(() => import('./pages/user/Ticket.jsx'))
const MyQueue = lazy(() => import('./pages/user/Ticket.jsx').then((m) => ({ default: m.MyQueue })))
const Appointments = lazy(() => import('./pages/user/Appointments.jsx'))
const Notifications = lazy(() => import('./pages/user/Notifications.jsx'))
const Profile = lazy(() => import('./pages/user/Profile.jsx'))
const VendorProvider = lazy(() => import('./pages/vendor/VendorContext.jsx').then((m) => ({ default: m.VendorProvider })))
const VOverview = lazy(() => import('./pages/vendor/Overview.jsx'))
const VLiveQueue = lazy(() => import('./pages/vendor/LiveQueue.jsx'))
const VAppointments = lazy(() => import('./pages/vendor/Appointments.jsx'))
const VShopProfile = lazy(() => import('./pages/vendor/ShopProfile.jsx'))
const VLocation = lazy(() => import('./pages/vendor/Location.jsx'))
const VServices = lazy(() => import('./pages/vendor/Services.jsx'))
const VAnalytics = lazy(() => import('./pages/vendor/Analytics.jsx'))
const VSettings = lazy(() => import('./pages/vendor/Settings.jsx'))
const VSales = lazy(() => import('./pages/vendor/Sales.jsx'))
const VReviews = lazy(() => import('./pages/vendor/Reviews.jsx'))
const ADashboard = lazy(() => import('./pages/admin/Dashboard.jsx'))
const AShops = lazy(() => import('./pages/admin/Lists.jsx').then((m) => ({ default: m.Shops })))
const AUsers = lazy(() => import('./pages/admin/Lists.jsx').then((m) => ({ default: m.UsersPage })))
const AVendors = lazy(() => import('./pages/admin/Lists.jsx').then((m) => ({ default: () => <m.UsersPage vendors /> })))
const AQueues = lazy(() => import('./pages/admin/Lists.jsx').then((m) => ({ default: m.Queues })))
const AAppointments = lazy(() => import('./pages/admin/Lists.jsx').then((m) => ({ default: m.AdminAppointments })))
const AAnalytics = lazy(() => import('./pages/admin/Lists.jsx').then((m) => ({ default: m.AdminAnalytics })))
const ASettings = lazy(() => import('./pages/admin/Lists.jsx').then((m) => ({ default: m.AdminSettings })))
const ATransactions = lazy(() => import('./pages/admin/Transactions.jsx'))

const Fallback = () => <div className="container page"><Skeleton h={36} w={260} /><Skeleton h={220} r={16} className="mt-5" /></div>

function ScrollToTop() {
  const { pathname, hash } = useLocation()
  useEffect(() => {
    if (hash) { const el = document.querySelector(hash); if (el) { el.scrollIntoView({ behavior: 'smooth' }); return } }
    window.scrollTo({ top: 0 })
  }, [pathname, hash])
  return null
}

/** Legacy /staff route → new vendor dashboard; "/" for logged-in staff/admin stays public landing. */
function LegacyRedirect() {
  const { user } = useAuth()
  return <Navigate to={user ? roleHome(user.role) : '/login'} replace />
}

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <ToastProvider>
          <BrowserRouter>
            <NotificationsProvider>
              <ScrollToTop />
              <CursorGlow />
              <Suspense fallback={<Fallback />}>
                <Routes>
                  <Route element={<PublicLayout />}>
                    <Route path="/" element={<Landing />} />
                    <Route path="/nearby" element={<Nearby />} />
                    <Route path="/shop/:id" element={<Shop />} />
                  </Route>
                  <Route path="/login" element={<Login />} />
                  <Route path="/register" element={<Login register />} />

                  <Route element={<PublicLayout footer={false} />}>
                    <Route path="/app" element={<RequireAuth><Home /></RequireAuth>} />
                    <Route path="/queue" element={<RequireAuth><MyQueue /></RequireAuth>} />
                    <Route path="/t/:tokenId" element={<RequireAuth><Ticket /></RequireAuth>} />
                    <Route path="/appointments" element={<RequireAuth><Appointments /></RequireAuth>} />
                    <Route path="/notifications" element={<RequireAuth><Notifications /></RequireAuth>} />
                    <Route path="/profile" element={<RequireAuth><Profile /></RequireAuth>} />
                  </Route>

                  <Route path="/vendor" element={<RequireAuth roles={['staff', 'admin']}><DashboardLayout nav={VENDOR_NAV} title="Vendor" /></RequireAuth>}>
                    <Route element={<VendorProvider />}>
                      <Route index element={<VOverview />} />
                      <Route path="queue" element={<VLiveQueue />} />
                      <Route path="appointments" element={<VAppointments />} />
                      <Route path="shop" element={<VShopProfile />} />
                      <Route path="location" element={<VLocation />} />
                      <Route path="services" element={<VServices />} />
                      <Route path="analytics" element={<VAnalytics />} />
                      <Route path="sales" element={<VSales />} />
                      <Route path="reviews" element={<VReviews />} />
                      <Route path="settings" element={<VSettings />} />
                    </Route>
                  </Route>

                  <Route path="/admin" element={<RequireAuth roles={['admin']}><DashboardLayout nav={ADMIN_NAV} title="Admin" /></RequireAuth>}>
                    <Route index element={<ADashboard />} />
                    <Route path="shops" element={<AShops />} />
                    <Route path="users" element={<AUsers />} />
                    <Route path="vendors" element={<AVendors />} />
                    <Route path="queues" element={<AQueues />} />
                    <Route path="appointments" element={<AAppointments />} />
                    <Route path="analytics" element={<AAnalytics />} />
                    <Route path="transactions" element={<ATransactions />} />
                    <Route path="settings" element={<ASettings />} />
                  </Route>

                  <Route path="/staff" element={<LegacyRedirect />} />
                  <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
              </Suspense>
            </NotificationsProvider>
          </BrowserRouter>
        </ToastProvider>
      </AuthProvider>
    </ThemeProvider>
  )
}
