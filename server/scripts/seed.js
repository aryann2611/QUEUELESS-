// Demo data: vendors, shops with locations/services, an admin, customers, live queues, a few appointments.
// Run: npm run seed            (same MONGO_URI / embedded db as the server; idempotent — shops are matched by name)
//      npm run seed -- 28.6139 77.2090   (drop the demo city somewhere else: <lat> <lng>)
import bcrypt from 'bcryptjs';
import { User, Queue, Token, Appointment, Review } from '../src/models.js';
import { refreshRating } from '../src/reviews.js';

const argLat = Number(process.argv[2]), argLng = Number(process.argv[3]);
const CENTER = Number.isFinite(argLat) && Number.isFinite(argLng) ? { lat: argLat, lng: argLng }
  : { lat: Number(process.env.SEED_LAT) || 26.4499, lng: Number(process.env.SEED_LNG) || 80.3319 }; // Kanpur
const PASSWORD = 'password';
const CITY = { city: process.env.SEED_CITY || 'Kanpur', state: process.env.SEED_STATE || 'Uttar Pradesh', pin: Number(process.env.SEED_PINCODE) || 208001 };
const img = (id) => `https://images.unsplash.com/${id}?w=1200&q=70&auto=format&fit=crop`;

// dLat/dLng are offsets from CENTER in degrees (~0.01 ≈ 1.1 km). queue = people in line (first one is being served); served = done earlier today.
const SHOPS = [
  // --- medical ---
  { name: 'Dr. Sharma Clinic', category: 'medical', dLat: 0.004, dLng: 0.006, avg: 6, queue: 3, served: 9, grace: 5, express: [199, 2], street: '12 Mall Road', phone: '+91 98765 11111', image: img('photo-1519494026892-80bbd2d6fd0d'),
    description: 'Family physician. Walk-ins welcome, appointments preferred.', services: [['General Consultation', 10], ['Follow-up', 6], ['Emergency', 15]] },
  { name: 'Smile Dental Care', category: 'medical', dLat: -0.03, dLng: 0.03, avg: 18, queue: 2, served: 4, street: '7 Swaroop Nagar', phone: '+91 98765 66666', image: img('photo-1606811841689-23dfddce3e95'),
    description: 'Dental check-ups, cleaning and orthodontics.', services: [['Check-up', 15], ['Cleaning', 25], ['Filling', 30]] },
  { name: 'Kakadeo Eye Care', category: 'medical', dLat: 0.028, dLng: -0.035, avg: 12, queue: 5, served: 11, street: '118/44 Kakadeo', phone: '+91 98765 77777', image: img('photo-1591076482161-42ce6da69f67'),
    description: 'Eye examinations, spectacles and contact lens fitting.', services: [['Eye Examination', 12], ['Contact Lens Fitting', 20], ['Prescription Update', 8]] },
  { name: 'Lifeline Diagnostics', category: 'medical', dLat: -0.012, dLng: -0.024, avg: 8, queue: 7, served: 22, street: 'Kidwai Nagar Crossing', phone: '+91 98765 88888', image: img('photo-1579154204601-01588f351e67'), hours: ['07:00', '20:00'],
    description: 'Blood tests, X-ray, ECG and ultrasound. Reports the same day.', services: [['Blood Test', 5], ['X-ray', 10], ['ECG', 10], ['Ultrasound', 20]] },
  { name: 'Dr. Mehta Child Clinic', category: 'medical', dLat: 0.045, dLng: 0.012, avg: 10, queue: 4, served: 6, street: 'Arya Nagar', phone: '+91 98765 99999', image: img('photo-1631217868264-e5b90bb7e133'), hours: ['10:00', '14:00'],
    description: 'Paediatrician. Vaccinations every morning.', services: [['Consultation', 10], ['Vaccination', 5], ['Growth Check', 8]] },
  { name: 'PetCare Animal Clinic', category: 'medical', dLat: -0.041, dLng: -0.008, avg: 15, queue: 1, served: 3, street: 'Ratanlal Nagar', phone: '+91 98765 12121', image: img('photo-1548767797-d8c844163c4c'),
    description: 'Vet for dogs, cats and birds. Grooming on weekends.', services: [['Vet Consultation', 15], ['Vaccination', 10], ['Grooming', 40]] },
  // --- salon ---
  { name: 'Glow Salon', category: 'salon', dLat: -0.007, dLng: 0.009, avg: 20, queue: 3, served: 5, express: [149, 3], street: '4 Civil Lines', phone: '+91 98765 22222', image: img('photo-1560066984-138dadb4c035'),
    description: 'Unisex salon — cuts, colour, styling.', services: [['Haircut', 25], ['Beard Trim', 15], ['Hair Colour', 60]] },
  { name: 'Urban Cuts Barbershop', category: 'salon', dLat: 0.016, dLng: 0.028, avg: 15, queue: 6, served: 14, street: 'Tilak Nagar Market', phone: '+91 98765 23232', image: img('photo-1503951914875-452162b0f3f1'), hours: ['08:00', '21:00'],
    description: 'Classic barbershop. Fades, shaves and hot towels.', services: [['Haircut', 15], ['Shave', 10], ['Head Massage', 15]] },
  { name: 'Radiance Beauty Studio', category: 'salon', dLat: -0.022, dLng: 0.018, avg: 35, queue: 2, served: 3, street: 'Govind Nagar', phone: '+91 98765 24242', image: img('photo-1522337660859-02fbefca4702'), hours: ['10:00', '20:00'],
    description: 'Facials, waxing, bridal make-up and hair spa.', services: [['Facial', 40], ['Waxing', 30], ['Hair Spa', 45], ['Threading', 10]] },
  { name: 'Blush Nail Bar', category: 'salon', dLat: 0.009, dLng: -0.019, avg: 30, queue: 0, served: 2, street: 'Z Square Mall, 2nd floor', phone: '+91 98765 25252', image: img('photo-1604654894610-df63bc536371'), open: false, hours: ['11:00', '21:00'],
    description: 'Manicure, pedicure and nail art. Closed on Tuesdays.', services: [['Manicure', 30], ['Pedicure', 40], ['Nail Art', 45]] },
  // --- bank ---
  { name: 'City Bank — Main Branch', category: 'bank', dLat: 0.012, dLng: -0.008, avg: 8, queue: 4, served: 31, street: '88 MG Road', phone: '+91 98765 33333', image: img('photo-1541354329998-f4d9a9f9297f'), hours: ['10:00', '16:00'],
    description: 'Account services, loans and lockers.', services: [['Account Services', 8], ['Loan Enquiry', 15], ['Cash Deposit', 4]] },
  { name: 'Union Trust Bank — Civil Lines', category: 'bank', dLat: -0.003, dLng: 0.022, avg: 7, queue: 8, served: 40, street: 'Civil Lines, near GPO', phone: '+91 98765 34343', image: img('photo-1601597111158-2fceff292cdc'), hours: ['10:00', '16:00'],
    description: 'Savings, KYC updates, demand drafts and forex.', services: [['KYC Update', 10], ['Demand Draft', 6], ['Cheque Deposit', 3], ['Forex', 15]] },
  { name: 'Post Office Savings Bank', category: 'bank', dLat: 0.031, dLng: 0.041, avg: 9, queue: 5, served: 18, street: 'Head Post Office, Bada Chauraha', phone: '+91 98765 35353', image: img('photo-1556740758-90de374c12ad'), hours: ['09:30', '17:00'],
    description: 'Savings accounts, recurring deposits, speed post.', services: [['Passbook Update', 5], ['Speed Post', 4], ['New Account', 20]] },
  // --- government ---
  { name: 'RTO Office', category: 'government', dLat: -0.018, dLng: -0.012, avg: 12, queue: 5, served: 26, street: 'Transport Nagar', phone: '+91 98765 44444', image: img('photo-1450101499163-c8848c66ca85'), hours: ['10:00', '17:00'],
    description: 'Driving licence and vehicle registration counter.', services: [['Licence Renewal', 12], ['Vehicle Registration', 20], ['Address Change', 10]] },
  { name: 'Passport Seva Kendra', category: 'government', dLat: 0.02, dLng: -0.03, avg: 14, queue: 9, served: 35, street: 'Mega Mall, Kalyanpur', phone: '+91 98765 45454', image: img('photo-1521295121783-8a321d551ad2'), hours: ['09:00', '16:30'],
    description: 'Passport applications, renewals and police verification queries.', services: [['New Passport', 20], ['Renewal', 12], ['Document Verification', 8]] },
  { name: 'Aadhaar Enrolment Centre', category: 'government', dLat: -0.035, dLng: 0.014, avg: 10, queue: 0, served: 15, street: 'Barra Bypass', phone: '+91 98765 46464', image: img('photo-1521791136064-7986c2920216'), open: false, hours: ['10:00', '15:00'],
    description: 'New enrolments and biometric/mobile updates.', services: [['New Enrolment', 15], ['Biometric Update', 10], ['Mobile Number Update', 5]] },
  { name: 'Electricity Bill Counter', category: 'government', dLat: 0.006, dLng: 0.048, avg: 5, queue: 6, served: 44, street: 'Vijay Nagar Sub-station', phone: '+91 98765 47474', image: img('photo-1473341304170-971dccb5ac1e'), hours: ['09:00', '18:00'],
    description: 'Bill payments, new connections and meter complaints.', services: [['Bill Payment', 3], ['New Connection', 15], ['Meter Complaint', 8]] },
  // --- repair ---
  { name: 'FixIt Mobile Repair', category: 'repair', dLat: 0.02, dLng: 0.02, avg: 15, queue: 2, served: 7, street: '21 Station Road', phone: '+91 98765 55555', image: img('photo-1580910051074-3eb694886505'),
    description: 'Phone and laptop repair while you wait.', services: [['Screen Replacement', 30], ['Battery', 20], ['Diagnosis', 10]] },
  { name: 'QuickFix Laptop Service', category: 'repair', dLat: -0.015, dLng: 0.036, avg: 25, queue: 3, served: 4, street: 'Naveen Market', phone: '+91 98765 56565', image: img('photo-1588508065123-287b28e013da'),
    description: 'Laptop, printer and desktop repairs. Data recovery.', services: [['Diagnosis', 15], ['OS Reinstall', 40], ['Keyboard Replacement', 25]] },
  { name: 'AutoCare Bike Service', category: 'repair', dLat: 0.038, dLng: -0.012, avg: 40, queue: 4, served: 6, street: 'GT Road, Panki', phone: '+91 98765 57575', image: img('photo-1558618666-fcd25c85cd64'), hours: ['08:00', '19:00'],
    description: 'Two-wheeler servicing, puncture repair and washing.', services: [['General Service', 45], ['Puncture', 10], ['Wash & Polish', 20]] },
  // --- other ---
  { name: 'Express Laundry & Dry Clean', category: 'other', dLat: -0.026, dLng: -0.03, avg: 4, queue: 2, served: 12, street: 'Shastri Nagar', phone: '+91 98765 61616', image: img('photo-1517677208171-0bc6725a3e60'), hours: ['08:00', '20:00'],
    description: 'Drop-off counter. Same-day service before noon.', services: [['Drop-off', 3], ['Pick-up', 3], ['Express Order', 5]] },
  { name: 'Master Tailors & Alterations', category: 'other', dLat: 0.001, dLng: -0.044, avg: 12, queue: 3, served: 5, street: 'Naughara, Chowk', phone: '+91 98765 62626', image: img('photo-1558769132-cb1aea458c5e'), hours: ['10:00', '20:00'],
    description: 'Measurements, alterations and school uniforms.', services: [['Measurement', 10], ['Alteration Drop-off', 5], ['Trial', 15]] },
];

// Extra shops scattered within SEED_RADIUS_KM of CENTER, so the map has depth beyond the 22 hand-written
// ones. Fixed-seed RNG: the same names come out every run, so re-seeding matches them instead of
// duplicating them. Set SEED_EXTRA=0 (the default) to get only the named set.
const EXTRA = Number(process.env.SEED_EXTRA) || 0;
const RADIUS_KM = Number(process.env.SEED_RADIUS_KM) || 60;
const AREAS = ['Hazratganj', 'Gomti Nagar', 'Aliganj', 'Indira Nagar', 'Alambagh', 'Chowk', 'Aminabad', 'Mahanagar', 'Rajajipuram', 'Jankipuram', 'Vikas Nagar', 'Chinhat', 'Telibagh', 'Ashiyana', 'Krishna Nagar', 'Charbagh', 'Nishatganj', 'Sarojini Nagar', 'Kakori', 'Malihabad', 'Mohanlalganj', 'Bakshi Ka Talab', 'Barabanki', 'Unnao', 'Nawabganj', 'Itaunja', 'Sitapur Road', 'Hardoi Road', 'Kanpur Road', 'Rae Bareli Road', 'Faizabad Road', 'Sultanpur Road'];
const BRANDS = ['Apex', 'Sunrise', 'Metro', 'Prime', 'Lotus', 'Shree', 'Royal', 'Elite', 'Green', 'Silver', 'Golden', 'Star', 'Sai', 'Krishna', 'Laxmi', 'Modern', 'Classic', 'Swift', 'Trust', 'United', 'National', 'Heritage', 'Zen', 'Urban', 'Central', 'Pioneer', 'Vijay', 'Anand', 'Shanti', 'Aarogya', 'Jeevan', 'Surya', 'Chandra', 'Nova', 'Ganga', 'Om', 'Navin', 'Rapid', 'Care', 'City'];
const KINDS = {
  medical: [['Clinic', 8, 'Walk-ins welcome, appointments preferred.', [['Consultation', 10], ['Follow-up', 6], ['Vaccination', 5]]], ['Dental Care', 18, 'Check-ups, cleaning and orthodontics.', [['Check-up', 15], ['Cleaning', 25], ['Filling', 30]]], ['Eye Care', 12, 'Eye tests, spectacles and lenses.', [['Eye Examination', 12], ['Lens Fitting', 20]]], ['Diagnostics', 8, 'Blood tests and scans, same-day reports.', [['Blood Test', 5], ['X-ray', 10], ['ECG', 10]]], ['Physiotherapy', 30, 'Sports injuries, back pain, post-surgery rehab.', [['Session', 30], ['Assessment', 20]]]],
  salon: [['Salon', 20, 'Cuts, colour and styling.', [['Haircut', 25], ['Beard Trim', 15], ['Hair Colour', 60]]], ['Barbershop', 15, 'Fades, shaves and hot towels.', [['Haircut', 15], ['Shave', 10]]], ['Beauty Studio', 35, 'Facials, waxing and bridal make-up.', [['Facial', 40], ['Waxing', 30], ['Threading', 10]]], ['Spa', 45, 'Massage and wellness.', [['Massage', 45], ['Hair Spa', 45]]]],
  bank: [['Bank', 8, 'Accounts, loans and lockers.', [['Account Services', 8], ['Loan Enquiry', 15], ['Cash Deposit', 4]]], ['Co-operative Bank', 9, 'Savings, KYC and demand drafts.', [['KYC Update', 10], ['Demand Draft', 6]]], ['Post Office', 7, 'Savings, speed post and passbooks.', [['Passbook Update', 5], ['Speed Post', 4]]]],
  government: [['Tehsil Office', 14, 'Certificates and land records.', [['Certificate', 15], ['Records Enquiry', 10]]], ['Aadhaar Centre', 10, 'Enrolment and biometric updates.', [['New Enrolment', 15], ['Biometric Update', 10]]], ['Electricity Office', 5, 'Bills, new connections and complaints.', [['Bill Payment', 3], ['New Connection', 15]]], ['Municipal Office', 12, 'Water, property tax and licences.', [['Tax Payment', 8], ['Licence', 20]]]],
  repair: [['Mobile Repair', 15, 'Phones fixed while you wait.', [['Screen', 30], ['Battery', 20], ['Diagnosis', 10]]], ['Auto Service', 40, 'Two-wheeler servicing and puncture repair.', [['Service', 45], ['Puncture', 10]]], ['Appliance Repair', 25, 'AC, fridge and washing machine.', [['Diagnosis', 15], ['Repair', 40]]], ['Computer Service', 25, 'Laptop and desktop repairs.', [['Diagnosis', 15], ['OS Reinstall', 40]]]],
  other: [['Laundry', 4, 'Drop-off counter, same-day before noon.', [['Drop-off', 3], ['Pick-up', 3]]], ['Tailors', 12, 'Measurements and alterations.', [['Measurement', 10], ['Alteration', 5]]], ['Pet Grooming', 40, 'Baths, trims and nail clipping.', [['Bath', 30], ['Full Groom', 60]]], ['Photo Studio', 10, 'Passport photos and prints.', [['Passport Photo', 5], ['Prints', 10]]]],
};
function extraShops() {
  let x = 20260918; const rnd = () => (x = (x * 1103515245 + 12345) % 2147483648) / 2147483648;
  const cats = Object.keys(KINDS), used = new Set(SHOPS.map((s) => s.name)), out = [];
  for (let i = 0; i < EXTRA; i++) {
    const category = cats[i % cats.length];
    const [kind, avg, description, services] = KINDS[category][Math.floor(rnd() * KINDS[category].length)];
    const area = AREAS[Math.floor(rnd() * AREAS.length)];
    let name = `${BRANDS[Math.floor(rnd() * BRANDS.length)]} ${kind}`;
    if (used.has(name)) name += ` ${area}`;
    if (used.has(name)) name += ` ${i}`;
    used.add(name);
    // uniform over the disc, not clustered at the centre
    const r = RADIUS_KM * Math.sqrt(rnd()), th = rnd() * 2 * Math.PI;
    const images = SHOPS.filter((s) => s.category === category).map((s) => s.image);
    out.push({
      name, category, avg, description, services,
      dLat: (r * Math.cos(th)) / 111, dLng: (r * Math.sin(th)) / (111 * Math.cos((CENTER.lat * Math.PI) / 180)),
      street: `${1 + Math.floor(rnd() * 200)} ${area}`, phone: `+91 9${String(Math.floor(rnd() * 1e9)).padStart(9, '0')}`,
      image: images[i % images.length], open: rnd() > 0.12,
      hours: category === 'bank' || category === 'government' ? ['10:00', '17:00'] : ['09:00', '20:00'],
      queue: Math.floor(rnd() * 7), served: 2 + Math.floor(rnd() * 12),
      counters: category === 'bank' || category === 'government' ? 2 + Math.floor(rnd() * 2) : 1,
    });
  }
  return out;
}

const CUSTOMERS = ['Priya', 'Rahul', 'Neha', 'Vikram', 'Sana', 'Kabir', 'Ananya', 'Rohan', 'Isha', 'Arjun', 'Meera', 'Dev', 'Zara', 'Karan', 'Pooja', 'Aditya'];
const slug = (s) => s.toLowerCase().replace(/[^a-z]+/g, '-').replace(/^-|-$/g, '');

async function upsertUser(name, email, role) {
  return (await User.findOne({ email })) || User.create({ name, email, role, passwordHash: await bcrypt.hash(PASSWORD, 10) });
}

// Paid express slots: two of today's served tokens plus a 60-day history, so the sales pages have something to show.
async function expressHistory(queue, s, i, people) {
  const now = Date.now();
  const [price, perHour] = s.express;
  const paid = (n) => ({ orderId: `order_seed_${n.toString(36)}`, paymentId: `pay_seed_${n.toString(36)}`, amount: price * 100 });
  const todays = await Token.find({ queue: queue._id, status: 'served', 'express.paymentId': { $exists: false } }).sort('createdAt').limit(2);
  await Promise.all(todays.map((t, k) => Token.updateOne({ _id: t._id }, { express: paid(i * 1000 + k), priority: true })));
  const history = [];
  for (let d = 1; d <= 60; d++) {
    const dayStart = new Date(new Date(now - d * 86400000).toISOString().slice(0, 10));
    // closed Sundays; otherwise 0..perHour*3 a day, drifting upward towards today so the trend reads as growth
    const n = dayStart.getUTCDay() === 0 ? 0 : Math.round((((d * 7 + i) % (perHour * 3)) + (d % 3 === 0 ? 1 : 0)) * (1.3 - d / 100));
    for (let k = 0; k < n; k++) {
      const createdAt = new Date(dayStart.getTime() + (10 + ((k * 5 + d) % 8)) * 3600000 + ((k * 17 + d * 3) % 60) * 60000);
      const calledAt = new Date(createdAt.getTime() + 4 * 60000);
      history.push({ queue: queue._id, user: people[(k * 3 + d + i) % people.length]._id, number: k + 1, service: queue.services[(k + d) % queue.services.length].name, status: 'served', priority: true, express: paid(i * 1000 + d * 10 + k + 100), pushed: [], calledAt, doneAt: new Date(calledAt.getTime() + s.avg * 60000), createdAt, updatedAt: createdAt });
    }
  }
  if (history.length) await Token.collection.insertMany(history);
}

// What customers say, by category; rating decides which pool a comment comes from
const PRAISE = {
  medical: ['Doctor listened patiently and explained everything.', 'Clean clinic, hardly any wait thanks to the token.', 'Got called exactly when the app said. Very smooth.', 'Staff were kind with my kid.'],
  salon: ['Loved the cut, exactly what I asked for.', 'Booked from the car and walked straight in.', 'Great vibe and no waiting around.', 'Stylist was quick and careful.'],
  bank: ['Counter staff were helpful and quick.', 'No more standing in line — joined from home.', 'Work done in ten minutes.'],
  government: ['Much better than the old token system.', 'Documents verified without any fuss.', 'Officer was polite and efficient.'],
  repair: ['Fixed while I waited. Fair price.', 'Honest diagnosis, no upselling.', 'Quick turnaround and works perfectly now.'],
  other: ['Friendly service, will come again.', 'Quick and professional.', 'Exactly as promised.'],
};
const GRIPES = ['Waited longer than the estimate said.', 'Service was fine but the place was crowded.', 'Okay experience, could be faster.', 'Had to ask twice before being attended.'];
const REPLIES = ['Thank you! See you next time.', 'Sorry about the wait — we have added a second counter at peak hours.', 'Glad we could help.', 'Thanks for the feedback, we are working on it.'];

// Reviews for roughly half of a shop's served visits, skewed positive, with the occasional owner reply
async function seedReviews(queue, i) {
  const served = await Token.find({ queue: queue._id, status: 'served' }).sort('createdAt');
  const docs = [];
  served.forEach((t, k) => {
    if ((k * 7 + i) % 9 > 4) return;
    const n = k * 13 + i * 3;
    const rating = n % 11 === 0 ? 2 : n % 5 === 0 ? 3 : n % 3 === 0 ? 4 : 5;
    const pool = rating >= 4 ? PRAISE[queue.category] || PRAISE.other : GRIPES;
    const at = new Date((t.doneAt ?? t.createdAt).getTime() + (5 + (n % 40)) * 60000);
    docs.push({ queue: queue._id, user: t.user, token: t._id, rating, service: t.service, comment: n % 4 === 3 ? '' : pool[n % pool.length], createdAt: at, updatedAt: at,
      ...(n % 6 === 1 && { reply: { text: REPLIES[rating >= 4 ? (n % 3 === 0 ? 0 : 2) : (n % 2 ? 1 : 3)], at: new Date(at.getTime() + 3600000 * (2 + (n % 20))) } }) });
  });
  if (docs.length) await Review.collection.insertMany(docs);
  await refreshRating(queue._id);
}

export async function seed() {
  const admin = await upsertUser('Admin', process.env.ADMIN_EMAIL || 'admin@example.com', 'admin');
  const customer = await upsertUser('Aarav Customer', 'user@example.com', 'user');
  const people = await Promise.all(CUSTOMERS.map((n) => upsertUser(n, `${n.toLowerCase()}@example.com`, 'user')));
  const day = new Date().toISOString().slice(0, 10);
  const created = [];
  for (const [i, s] of [...SHOPS, ...extraShops()].entries()) {
    const existing = await Queue.findOne({ name: s.name });
    if (existing) {
      // swap out a stock photo we've since replaced; a vendor's own upload or URL is left alone
      if (existing.image !== s.image && /images\.unsplash\.com/.test(existing.image)) await Queue.updateOne({ _id: existing._id }, { image: s.image });
      if (s.express && !(await Token.exists({ queue: existing._id, 'express.paymentId': { $exists: true } }))) await expressHistory(existing, s, i, people);
      if (!(await Review.exists({ queue: existing._id }))) await seedReviews(existing, i);
      continue;
    }
    const vendor = await upsertUser(`${s.name} Owner`, `${slug(s.name)}@example.com`, 'staff');
    const queue = await Queue.create({
      name: s.name, description: s.description, category: s.category, owner: vendor._id, avgServiceMinutes: s.avg, image: s.image,
      isOpen: s.open !== false, status: 'approved', phone: s.phone, email: vendor.email,
      counters: s.counters ?? (s.category === 'bank' || s.category === 'government' ? 3 : 1), graceMinutes: s.grace ?? 0,
      ...(s.express && { express: { enabled: true, price: s.express[0], perHour: s.express[1] } }),
      address: { street: s.street, city: CITY.city, state: CITY.state, pincode: String(CITY.pin + (i % 25)) },
      hours: { open: s.hours?.[0] ?? '09:00', close: s.hours?.[1] ?? '19:00' },
      services: s.services.map(([name, minutes]) => ({ name, minutes })),
      location: { type: 'Point', coordinates: [CENTER.lng + s.dLng, CENTER.lat + s.dLat] },
    });
    // served earlier today (for analytics), then the live line: first one being served, rest waiting
    let counter = 0;
    const now = Date.now();
    for (let k = 0; k < s.served; k++) {
      const createdAt = new Date(now - (s.served - k) * s.avg * 60000 * 1.4 - 30 * 60000);
      const calledAt = new Date(createdAt.getTime() + s.avg * 60000 * (0.6 + (k % 3) * 0.3));
      const t = await Token.create({ queue: queue._id, user: people[(k * 7 + i) % people.length]._id, number: ++counter, service: queue.services[k % queue.services.length].name, status: k % 9 === 8 ? 'skipped' : 'served', calledAt, doneAt: new Date(calledAt.getTime() + s.avg * 60000) });
      await Token.collection.updateOne({ _id: t._id }, { $set: { createdAt } }); // .collection: Mongoose strips createdAt from $set
    }
    if (s.express) await expressHistory(queue, s, i, people);
    await seedReviews(queue, i);
    // one customer at each counter, the rest waiting
    for (let k = 0; k < s.queue; k++) {
      const atCounter = k < queue.counters;
      const t = await Token.create({ queue: queue._id, user: people[(k + i * 3) % people.length]._id, number: ++counter, service: queue.services[k % queue.services.length].name, status: atCounter ? 'serving' : 'waiting', counter: atCounter ? k + 1 : undefined, calledAt: atCounter ? new Date(now - (3 + k) * 60000) : undefined, arrivedAt: atCounter && k % 2 ? new Date(now - k * 60000) : undefined });
      if (atCounter) queue.currentToken = t._id;
    }
    queue.counter = counter;
    queue.counterDate = day;
    await queue.save();
    created.push(queue.name);
  }
  // a couple of appointments for the demo customer
  const at = (hoursFromNow, minute = 0) => { const d = new Date(Date.now() + hoursFromNow * 3600e3); d.setMinutes(minute, 0, 0); return d; };
  const appts = [['Dr. Sharma Clinic', at(3, 30), 'General Consultation', 'Fever since yesterday'], ['Glow Salon', at(26, 0), 'Haircut', '']];
  for (const [shop, when, service, note] of appts) {
    const q = await Queue.findOne({ name: shop });
    if (q && !(await Appointment.exists({ queue: q._id, user: customer._id, status: 'booked' }))) await Appointment.create({ queue: q._id, user: customer._id, at: when, service, note });
  }
  return { admin: admin.email, customer: customer.email, created, total: await Queue.countDocuments() };
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop())) {
  const { connectDb } = await import('../src/db.js');
  const stop = await connectDb();
  const out = await seed();
  console.log(`Seeded around ${CENTER.lat}, ${CENTER.lng}. ${out.total} shops in the database (${out.created.length} new).\nLogin with password "${PASSWORD}":\n  admin    ${out.admin}\n  customer ${out.customer}\n  vendors  <shop-name>@example.com (e.g. dr-sharma-clinic@example.com, passport-seva-kendra@example.com)`);
  await stop();
}
