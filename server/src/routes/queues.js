import { Router } from 'express';
import { Queue, Token, ExpressOrder, Review, CATEGORIES } from '../models.js';
import { paymentsEnabled, publicKeyId, createOrder, verifyPayment } from '../payments.js';
import { sales } from '../sales.js';
import { reviewsFor, refreshRating, pubReview } from '../reviews.js';
import { authRequired, authOptional, requireRole, fail, field, shape, owns } from '../auth.js';
import { approved, joinQueue, callNext, markArrived, recallToken, releaseStranded, ticketFor, queueState, queueStats, summary, broadcastQueue, ACTIVE, expressSlotsLeft } from '../queue.js';

const r = Router();

async function getQueue(req, mustOwn) {
  const queue = await Queue.findById(req.params.id);
  if (!queue) throw fail(404, 'queue not found');
  if (mustOwn && !owns(queue, req.user)) throw fail(403, 'not your queue');
  return queue;
}

const withCounts = (queues) => Promise.all(queues.map(async (q) => summary(q, await Token.find({ queue: q._id, status: 'waiting' }).select('service'))));

// Only approved businesses are listed publicly (owners/admins see their own pending ones via /:id)
const PUBLIC = { status: { $ne: 'suspended' }, $or: [{ status: 'approved' }, { status: { $exists: false } }] };

// Shared list filters: ?q= (name/description/service) and ?category=
function filters(query) {
  const f = { ...PUBLIC };
  if (typeof query.q === 'string' && query.q.trim()) {
    const rx = new RegExp(query.q.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    f.$and = [{ $or: [{ name: rx }, { description: rx }, { 'services.name': rx }, { 'address.city': rx }] }];
  }
  if (CATEGORIES.includes(query.category)) f.category = query.category;
  if (query.open === '1') f.isOpen = true;
  return f;
}

// ?mine=1 -> the caller's own businesses whatever their status (a pending shop is invisible to the
// public list, so its owner would otherwise never be able to reach it); ?all=1 -> everything, admins only.
r.get('/', authOptional, async (req, res) => {
  const scope = req.query.mine === '1' && req.user.id ? { owner: req.user.id }
    : req.query.all === '1' && req.user.role === 'admin' ? {}
    : filters(req.query);
  const queues = await Queue.find(scope).populate('currentToken', 'number');
  res.json({ queues: await withCounts(queues) });
});

// GET /nearby?lat&lng&radius(km, default 5) — server-side geospatial search, sorted by distance
r.get('/nearby', authOptional, async (req, res) => {
  const lat = Number(req.query.lat), lng = Number(req.query.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) throw fail(400, 'lat and lng are required');
  const radiusKm = Math.min(Math.max(Number(req.query.radius) || 5, 0.1), 100);
  const docs = await Queue.aggregate([{
    $geoNear: {
      near: { type: 'Point', coordinates: [lng, lat] },
      distanceField: 'distance',
      maxDistance: radiusKm * 1000,
      spherical: true,
      query: filters(req.query),
    },
  }, { $limit: 100 }]);
  await Queue.populate(docs, { path: 'currentToken', select: 'number' });
  res.json({ queues: await withCounts(docs), center: { lat, lng }, radiusKm });
});

r.post('/', authRequired, requireRole('staff', 'admin'), async (req, res) => {
  const queue = await Queue.create({
    name: field(req, 'name', 'string'),
    description: field(req, 'description', 'string', true),
    avgServiceMinutes: field(req, 'avgServiceMinutes', 'number', true),
    category: CATEGORIES.includes(req.body.category) ? req.body.category : 'other',
    owner: req.user.id,
    ...(req.user.role === 'admin' && { status: 'approved' }),
  });
  res.status(201).json({ queue: summary(queue) });
});

r.get('/:id', authOptional, async (req, res) => {
  const queue = await getQueue(req);
  if (!approved(queue) && !owns(queue, req.user)) throw fail(404, 'queue not found');
  res.json(await queueState(queue, owns(queue, req.user)));
});

r.get('/:id/stats', authRequired, async (req, res) => {
  const queue = await getQueue(req, true);
  const days = [1, 7, 30].includes(Number(req.query.days)) ? Number(req.query.days) : 1;
  res.json(await queueStats(queue._id, days));
});

// Express-slot sales history for the owner (or an admin)
r.get('/:id/sales', authRequired, async (req, res) => {
  const queue = await getQueue(req, true);
  const days = [7, 30, 90].includes(Number(req.query.days)) ? Number(req.query.days) : 30;
  res.json(await sales({ queue: queue._id }, days));
});

r.patch('/:id', authRequired, async (req, res) => {
  const queue = await getQueue(req, true);
  for (const [name, type] of Object.entries({ name: 'string', description: 'string', avgServiceMinutes: 'number', isOpen: 'boolean', phone: 'string', email: 'string', image: 'string', counters: 'number', graceMinutes: 'number' })) {
    const v = field(req, name, type, true);
    if (v !== undefined) queue[name] = v;
  }
  if (queue.isModified('image') && queue.image && !/^https:\/\/\S+$/.test(queue.image) && !(/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(queue.image) && queue.image.length <= 700_000))
    throw fail(400, 'image must be an https URL or an uploaded photo under 500 KB');
  if (req.body.category !== undefined) {
    if (!CATEGORIES.includes(req.body.category)) throw fail(400, 'invalid category');
    queue.category = req.body.category;
  }
  const address = shape(req, 'address', { street: 'string', city: 'string', state: 'string', pincode: 'string' });
  if (address) queue.address = address;
  const hours = shape(req, 'hours', { open: 'string', close: 'string' });
  if (hours) for (const k of ['open', 'close']) if (hours[k]) queue.hours[k] = hours[k];
  if (req.body.services !== undefined) {
    if (!Array.isArray(req.body.services)) throw fail(400, 'services must be an array');
    queue.services = req.body.services.map((s) => {
      if (!s || typeof s.name !== 'string' || !s.name.trim()) throw fail(400, 'each service needs a name');
      return { name: s.name.trim(), minutes: Number.isFinite(s.minutes) && s.minutes >= 0 ? s.minutes : 5 };
    });
  }
  const express = shape(req, 'express', { enabled: 'boolean', price: 'number', perHour: 'number' });
  if (express) {
    if (express.enabled && !paymentsEnabled) throw fail(400, 'payments are not configured on this server');
    if (express.enabled && queue.category === 'government') throw fail(400, 'express slots are not available for government offices');
    if (express.price !== undefined && (!Number.isInteger(express.price) || express.price < 0)) throw fail(400, 'price must be a whole number of rupees');
    if (express.perHour !== undefined && (!Number.isInteger(express.perHour) || express.perHour < 1 || express.perHour > 20)) throw fail(400, 'perHour must be 1–20');
    const next = { ...(queue.express?.toObject?.() ?? queue.express ?? {}), ...express };
    if (next.enabled && !(next.price > 0)) throw fail(400, 'set a price before enabling express slots');
    queue.express = next;
  }
  const location = shape(req, 'location', { lat: 'number', lng: 'number' });
  if (location) {
    if (location.lat === undefined || location.lng === undefined || Math.abs(location.lat) > 90 || Math.abs(location.lng) > 180) throw fail(400, 'location needs lat and lng');
    queue.location = { type: 'Point', coordinates: [location.lng, location.lat] };
  }
  await queue.save();
  // lowering "counters" would otherwise leave customers being served at a counter that no longer exists
  const released = await releaseStranded(queue);
  await broadcastQueue(req.app.get('io'), queue._id, released);
  res.json(await queueState(queue, true));
});

// Express join, step 1: create the Razorpay order the client will pay against.
// Reviews: anyone can read them; only a customer who was served can write one, once per visit
r.get('/:id/reviews', authOptional, async (req, res) => {
  const queue = await getQueue(req, false);
  if (!approved(queue) && !(req.user && owns(queue, req.user))) throw fail(404, 'queue not found');
  res.json(await reviewsFor(queue._id));
});

r.post('/:id/reviews', authRequired, async (req, res) => {
  const queue = await getQueue(req, false);
  const rating = field(req, 'rating', 'number');
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw fail(400, 'rating must be 1-5');
  const comment = (field(req, 'comment', 'string', true) ?? '').trim().slice(0, 500);
  const token = await Token.findOne({ _id: field(req, 'tokenId', 'string'), queue: queue._id, user: req.user.id });
  if (!token) throw fail(404, 'token not found');
  if (token.status !== 'served') throw fail(400, 'you can review a visit once you have been served');
  if (await Review.exists({ token: token._id })) throw fail(409, 'you already reviewed this visit');
  const review = await Review.create({ queue: queue._id, user: req.user.id, token: token._id, rating, comment, service: token.service });
  const summary = await refreshRating(queue._id);
  res.status(201).json({ review: pubReview(await review.populate('user', 'name')), rating: summary });
});

r.patch('/:id/reviews/:rid', authRequired, async (req, res) => {
  const queue = await getQueue(req, true);
  const text = field(req, 'reply', 'string').trim().slice(0, 500);
  const review = await Review.findOneAndUpdate({ _id: req.params.rid, queue: queue._id }, { reply: text ? { text, at: new Date() } : { text: undefined, at: undefined } }, { new: true }).populate('user', 'name');
  if (!review) throw fail(404, 'review not found');
  res.json({ review: pubReview(review) });
});

r.post('/:id/express/order', authRequired, async (req, res) => {
  const queue = await getQueue(req);
  if (!paymentsEnabled || !queue.express?.enabled || !(queue.express.price > 0)) throw fail(404, 'express slots are not offered here');
  if (!approved(queue) || !queue.isOpen) throw fail(400, 'queue is closed');
  if (await Token.exists({ queue: queue._id, user: req.user.id, status: { $in: ACTIVE } })) throw fail(409, 'already in this queue');
  if ((await expressSlotsLeft(queue)) < 1) throw fail(409, 'no express slots left this hour');
  const amount = queue.express.price * 100;
  const order = await createOrder(amount, `ex_${Date.now()}`, { queue: String(queue._id), user: req.user.id });
  await ExpressOrder.create({ orderId: order.id, queue: queue._id, user: req.user.id, amount });
  res.status(201).json({ orderId: order.id, amount, currency: 'INR', keyId: publicKeyId, name: queue.name, description: `Express slot · ${queue.name}` });
});

r.post('/:id/join', authRequired, async (req, res) => {
  const queue = await getQueue(req);
  const service = field(req, 'service', 'string', true) ?? '';
  if (service && !queue.services.some((s) => s.name === service)) throw fail(400, 'unknown service');
  // Express join, step 2: the signed checkout result — verified, matched to an order we created for
  // this user and shop, and consumed atomically so one payment can never buy two tokens.
  let express;
  const pay = shape(req, 'express', { orderId: 'string', paymentId: 'string', signature: 'string' });
  if (pay) {
    if (!verifyPayment(pay.orderId, pay.paymentId, pay.signature)) throw fail(400, 'payment could not be verified');
    const order = await ExpressOrder.findOneAndUpdate({ orderId: pay.orderId, queue: queue._id, user: req.user.id, used: false }, { used: true });
    if (!order) throw fail(409, 'this payment has already been used or does not belong to this queue');
    express = { orderId: pay.orderId, paymentId: pay.paymentId, amount: order.amount };
  }
  const token = await joinQueue(queue, req.user.id, { service, express });
  await broadcastQueue(req.app.get('io'), queue._id);
  res.status(201).json({ ticket: await ticketFor(token) });
});

// Staff actions. Body { counter? } selects which counter is acting (multi-counter shops).
const advance = (mode) => async (req, res) => {
  const counter = field(req, 'counter', 'number', true) ?? 1;
  const { queue, done } = await callNext((await getQueue(req, true))._id, mode, counter);
  await broadcastQueue(req.app.get('io'), queue._id, done ? [done._id] : []);
  res.json(await queueState(queue, true));
};
r.post('/:id/next', authRequired, advance('next'));
r.post('/:id/skip', authRequired, advance('skip'));
r.post('/:id/complete', authRequired, advance('complete'));

r.post('/:id/arrived/:tokenId', authRequired, async (req, res) => {
  const queue = await getQueue(req, true);
  await markArrived(queue._id, req.params.tokenId);
  await broadcastQueue(req.app.get('io'), queue._id);
  res.json(await queueState(queue, true));
});

r.post('/:id/recall/:tokenId', authRequired, async (req, res) => {
  const queue = await getQueue(req, true);
  const token = await recallToken(queue._id, req.params.tokenId);
  await broadcastQueue(req.app.get('io'), queue._id, [token._id]);
  res.json(await queueState(queue, true));
});

export default r;
