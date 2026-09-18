import { useEffect, useRef, useState } from 'react'
import { Save, Building2, MapPin, Clock, Image as ImageIcon, QrCode as QrCodeIcon, Upload, Trash2, Link as LinkIcon } from 'lucide-react'
import { api } from '../../api.js'
import { useVendor } from './VendorContext.jsx'
import { CATEGORIES } from '../../lib/format.js'
import { Button, Field, Input, Select, Textarea, Alert, PageTransition, cx } from '../../ui/index.jsx'
import { QrPoster } from '../../components/QrCode.jsx'
import { useToast } from '../../ui/Toast.jsx'

/** Shrink a chosen photo to ≤1280px JPEG in the browser so the upload stays small and looks the same everywhere. */
function readCover(file) {
  return new Promise((resolve, reject) => {
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return reject(new Error('Choose a JPG, PNG or WebP photo.'))
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      const scale = Math.min(1, 1280 / Math.max(img.width, img.height))
      const c = document.createElement('canvas')
      c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale)
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height)
      URL.revokeObjectURL(url)
      let q = 0.85, out = c.toDataURL('image/jpeg', q)
      while (out.length > 480_000 && q > 0.4) out = c.toDataURL('image/jpeg', (q -= 0.1))
      out.length > 480_000 ? reject(new Error('That photo is too detailed to shrink — try a smaller one.')) : resolve(out)
    }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("We couldn't read that image.")) }
    img.src = url
  })
}

const Section = ({ icon: Icon, title, desc, children }) => (
  <section className="form-section">
    <div className="form-section-head"><span className="icon-box"><Icon aria-hidden /></span><div><h3>{title}</h3><p className="small muted">{desc}</p></div></div>
    <div className="card stack gap-4">{children}</div>
  </section>
)

export default function ShopProfile() {
  const { shop, shopId, setState } = useVendor()
  const toast = useToast()
  const [f, setF] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [urlMode, setUrlMode] = useState(false)
  const fileRef = useRef(null)
  useEffect(() => { if (shop && !f) setF({ name: shop.name, category: shop.category, description: shop.description || '', phone: shop.phone || '', email: shop.email || '', image: shop.image || '', address: { street: '', city: '', state: '', pincode: '', ...shop.address }, hours: { open: '09:00', close: '18:00', ...shop.hours } }) }, [shop, f])
  if (!f) return null
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })
  const setA = (k) => (e) => setF({ ...f, address: { ...f.address, [k]: e.target.value } })
  const setH = (k) => (e) => setF({ ...f, hours: { ...f.hours, [k]: e.target.value } })

  async function save(e) {
    e.preventDefault(); setBusy(true); setError('')
    try { setState(await api(`/api/queues/${shopId}`, { method: 'PATCH', body: f })); toast.success('Profile saved.') } catch (err) { setError(err.message) } finally { setBusy(false) }
  }

  return (
    <PageTransition>
      <form onSubmit={save} className="stack gap-6" style={{ maxWidth: 880 }}>
        <div className="page-head" style={{ marginBottom: 0 }}><div><h1>Shop profile</h1><p className="sub">What customers see on your page and on the map.</p></div><Button type="submit" variant="primary" icon={Save} loading={busy}>Save changes</Button></div>
        {error && <Alert tone="error">{error}</Alert>}
        <Section icon={Building2} title="Business" desc="Name, category and how to reach you.">
          <div className="grid grid-2">
            <Field label="Name" htmlFor="sp-name"><Input id="sp-name" value={f.name} onChange={set('name')} required /></Field>
            <Field label="Category" htmlFor="sp-cat"><Select id="sp-cat" value={f.category} onChange={set('category')}>{CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}</Select></Field>
          </div>
          <Field label="Description" htmlFor="sp-desc"><Textarea id="sp-desc" value={f.description} onChange={set('description')} placeholder="Tell customers what you offer." /></Field>
          <div className="grid grid-2">
            <Field label="Phone" htmlFor="sp-phone"><Input id="sp-phone" type="tel" value={f.phone} onChange={set('phone')} placeholder="+91 98765 43210" /></Field>
            <Field label="Email" htmlFor="sp-email"><Input id="sp-email" type="email" value={f.email} onChange={set('email')} placeholder="hello@yourshop.com" /></Field>
          </div>
        </Section>
        <Section icon={ImageIcon} title="Cover photo" desc="Shown at the top of your page and on listings. A real photo of your storefront or counter builds trust — landscape, at least 1000px wide.">
          <div className="cover-drop">
            {f.image
              ? <img src={f.image} alt="Cover preview" className="cover-preview-lg" onError={(e) => { e.currentTarget.replaceWith(Object.assign(document.createElement('div'), { className: 'cover-empty', textContent: "This image can't be loaded — pick another." })) }} />
              : <div className="cover-empty"><span className="small">No photo yet. Customers see a plain header until you add one.</span></div>}
            <div className="stack gap-2">
              <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={async (e) => { const file = e.target.files?.[0]; e.target.value = ''; if (!file) return; try { setF({ ...f, image: await readCover(file) }); setUrlMode(false) } catch (err) { toast.error(err.message) } }} />
              <Button type="button" variant="secondary" icon={Upload} onClick={() => fileRef.current?.click()}>{f.image ? 'Replace photo' : 'Upload photo'}</Button>
              <Button type="button" variant="ghost" size="sm" icon={LinkIcon} onClick={() => setUrlMode((v) => !v)}>Use a link instead</Button>
              {f.image && <Button type="button" variant="ghost" size="sm" icon={Trash2} onClick={() => setF({ ...f, image: '' })}>Remove</Button>}
            </div>
          </div>
          {urlMode && <Field label="Image URL" htmlFor="sp-img" hint="Must start with https://"><Input id="sp-img" type="url" value={f.image.startsWith('data:') || f.image.startsWith('/api/') ? '' : f.image} onChange={set('image')} placeholder="https://…" /></Field>}
        </Section>
        <Section icon={MapPin} title="Address" desc="Shown on your page and used for directions.">
          <Field label="Street" htmlFor="sp-street"><Input id="sp-street" value={f.address.street} onChange={setA('street')} /></Field>
          <div className="grid grid-3">
            <Field label="City" htmlFor="sp-city"><Input id="sp-city" value={f.address.city} onChange={setA('city')} /></Field>
            <Field label="State" htmlFor="sp-state"><Input id="sp-state" value={f.address.state} onChange={setA('state')} /></Field>
            <Field label="Pincode" htmlFor="sp-pin"><Input id="sp-pin" value={f.address.pincode} onChange={setA('pincode')} inputMode="numeric" /></Field>
          </div>
          <p className="small muted">Pin the exact map location on the <a href="/vendor/location">Location</a> page.</p>
        </Section>
        <Section icon={Clock} title="Hours" desc="Appointment slots are offered inside these hours.">
          <div className="grid grid-2">
            <Field label="Opening" htmlFor="sp-open"><Input id="sp-open" type="time" value={f.hours.open} onChange={setH('open')} /></Field>
            <Field label="Closing" htmlFor="sp-close"><Input id="sp-close" type="time" value={f.hours.close} onChange={setH('close')} /></Field>
          </div>
        </Section>
        <Section icon={QrCodeIcon} title="Counter QR" desc="Print it and tape it up. One scan opens your queue.">
          <QrPoster value={`${window.location.origin}/shop/${shopId}`} filename={`queueless-${(f.name || 'shop').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}-qr.png`}>
            <p className="small muted">Customers scan this to open your page and take a token without standing in line. It keeps working after you rename the shop.</p>
          </QrPoster>
        </Section>
        <div className={cx('row gap-2')}><Button type="submit" variant="primary" icon={Save} loading={busy}>Save changes</Button></div>
      </form>
    </PageTransition>
  )
}
