import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createHmac } from 'node:crypto';

process.env.JWT_SECRET = 'test-secret';
process.env.NODE_ENV = 'test';
process.env.AUTO_APPROVE_SHOPS = '1';
// a throwaway VAPID pair so the push routes run in their configured shape — generated per run rather
// than hardcoded, so no private key ever lands in the repo
const vapid = (await import('web-push')).default.generateVAPIDKeys();
process.env.VAPID_PUBLIC_KEY = vapid.publicKey;
process.env.VAPID_PRIVATE_KEY = vapid.privateKey;
// rzp_stub_* keys make payments.js mint orders locally, so the whole express flow runs with a known secret
process.env.RAZORPAY_KEY_ID = 'rzp_stub_test';
process.env.RAZORPAY_KEY_SECRET = 'stub-secret';
const { server, io } = await import('../src/app.js');

let mongo, base;

before(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((r) => io.close(r));
  await mongoose.disconnect();
  await mongo.stop();
});

async function api(method, path, { token, body } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { ...(body && { 'content-type': 'application/json' }), ...(token && { authorization: `Bearer ${token}` }) },
    body: body && JSON.stringify(body),
  });
  const ct = res.headers.get('content-type') || '';
  return { status: res.status, body: ct.includes('json') ? await res.json() : await res.arrayBuffer() };
}

async function register(name, role) {
  const { status, body } = await api('POST', '/api/auth/register', { body: { name, email: `${name}@example.com`, password: 'secret1', role } });
  assert.equal(status, 201);
  assert.equal(body.user.passwordHash, undefined);
  return body.token;
}

test('queue flow over HTTP', async () => {
  const [staff, staff2, user1, user2, user3] = await Promise.all(
    [['staff', 'staff'], ['staff2', 'staff'], ['user1'], ['user2'], ['user3']].map((a) => register(...a)));

  let r = await api('POST', '/api/queues', { token: staff, body: { name: 'Dr. Sharma Clinic' } });
  assert.equal(r.status, 201);
  const qid = r.body.queue._id;
  assert.equal(r.body.queue.avgServiceMinutes, 5);

  r = await api('POST', `/api/queues/${qid}/join`, { token: user1 });
  assert.equal(r.status, 201);
  assert.equal(r.body.ticket.number, 1);
  const t1 = r.body.ticket._id;

  r = await api('POST', `/api/queues/${qid}/join`, { token: user2 });
  assert.equal(r.status, 201);
  assert.equal(r.body.ticket.number, 2);
  const t2 = r.body.ticket._id;

  r = await api('GET', `/api/tokens/${t2}`, { token: user2 });
  assert.equal(r.status, 200);
  assert.equal(r.body.ticket.ahead, 1);
  assert.equal(r.body.ticket.etaMinutes, 5);
  assert.equal(r.body.ticket.currentNumber, null);

  r = await api('POST', `/api/queues/${qid}/join`, { token: user2 });
  assert.equal(r.status, 409);

  r = await api('GET', '/api/queues', { token: user1 });
  assert.equal(r.status, 200);
  assert.deepEqual([r.body.queues[0].waitingCount, r.body.queues[0].currentNumber], [2, null]);

  r = await api('POST', `/api/queues/${qid}/next`, { token: staff });
  assert.equal(r.status, 200);
  assert.equal(r.body.current.number, 1);
  assert.equal(r.body.queue.currentNumber, 1);
  assert.equal(r.body.current.user.name, 'user1');
  r = await api('GET', `/api/tokens/${t2}`, { token: user2 });
  assert.equal(r.body.ticket.ahead, 1);
  assert.equal(r.body.ticket.currentNumber, 1);

  r = await api('POST', `/api/queues/${qid}/next`, { token: staff });
  assert.equal(r.body.current.number, 2);
  r = await api('GET', `/api/tokens/${t2}`, { token: user2 });
  assert.equal(r.body.ticket.status, 'serving');
  assert.equal(r.body.ticket.ahead, 0);
  assert.equal(r.body.ticket.etaMinutes, 0);
  r = await api('GET', `/api/tokens/${t1}`, { token: user1 });
  assert.equal(r.body.ticket.status, 'served');

  r = await api('DELETE', `/api/tokens/${t2}`, { token: user2 });
  assert.equal(r.status, 400);

  r = await api('POST', `/api/queues/${qid}/next`, { token: staff });
  assert.equal(r.status, 200);
  assert.equal(r.body.current, null);
  assert.equal(r.body.queue.currentNumber, null);

  const at = new Date(Date.now() + 3600e3).toISOString();
  r = await api('POST', '/api/appointments', { token: user1, body: { queue: qid, at, note: 'follow-up' } });
  assert.equal(r.status, 201);
  const aid = r.body.appointment._id;
  assert.equal(r.body.appointment.queue.name, 'Dr. Sharma Clinic');
  assert.equal(r.body.appointment.user.name, 'user1');
  assert.equal(r.body.appointment.token, null);
  r = await api('POST', '/api/appointments', { token: user1, body: { queue: qid, at } });
  assert.equal(r.status, 409);

  r = await api('PATCH', `/api/appointments/${aid}`, { token: staff, body: { status: 'checked_in' } });
  assert.equal(r.status, 200);
  assert.equal(r.body.appointment.status, 'checked_in');
  assert.equal(r.body.appointment.token.number, 3);
  const t3 = r.body.appointment.token._id;
  r = await api('GET', `/api/queues/${qid}`, { token: staff });
  assert.equal(r.body.waiting[0].number, 3);
  assert.equal(r.body.waiting[0].priority, true);
  assert.equal(r.body.waiting[0].user.name, 'user1');
  r = await api('GET', `/api/queues/${qid}`, { token: user2 });
  assert.equal(r.body.waiting[0].user, undefined);

  r = await api('POST', `/api/queues/${qid}/join`, { token: user3 });
  assert.equal(r.status, 201);
  assert.equal(r.body.ticket.number, 4);
  assert.equal(r.body.ticket.ahead, 1);
  assert.equal(r.body.ticket.priority, false);

  r = await api('POST', `/api/queues/${qid}/next`, { token: staff2 });
  assert.equal(r.status, 403);

  r = await api('GET', '/api/queues');
  assert.equal(r.status, 200);
  r = await api('GET', '/api/tokens/mine');
  assert.equal(r.status, 401);

  r = await api('POST', '/api/auth/login', { body: { email: { $ne: '' }, password: 'secret1' } });
  assert.equal(r.status, 400);
  r = await api('GET', '/api/nope', { token: user1 });
  assert.equal(r.status, 404);

  r = await Promise.all([1, 2, 3].map(() => api('POST', `/api/queues/${qid}/join`, { token: user2 })));
  assert.deepEqual(r.map((x) => x.status).sort(), [201, 409, 409]);
  const at2 = new Date(Date.now() + 7200e3).toISOString();
  r = await Promise.all([user2, user3].map((token) => api('POST', '/api/appointments', { token, body: { queue: qid, at: at2 } })));
  assert.deepEqual(r.map((x) => x.status).sort(), [201, 409]);
  r = await Promise.all([1, 2].map(() => api('POST', `/api/queues/${qid}/next`, { token: staff })));
  assert.deepEqual(r.map((x) => x.status), [200, 200]);
  r = await api('GET', `/api/tokens/${t3}`, { token: user1 });
  assert.equal(r.body.ticket.status, 'served');

  r = await api('POST', '/api/appointments', { token: staff2, body: { queue: qid, at: new Date(Date.now() + 10800e3).toISOString() } });
  assert.equal(r.status, 201);
  r = await api('GET', '/api/appointments', { token: staff2 });
  assert.equal(r.body.appointments.length, 1);

  process.env.ADMIN_EMAIL = 'Admin@Example.com';
  r = await api('POST', '/api/auth/register', { body: { name: 'admin', email: 'Admin@Example.com', password: 'secret1' } });
  assert.equal(r.body.user.role, 'admin');
  r = await api('POST', '/api/auth/register', { body: { name: 'admin', email: 'admin@example.com', password: 'secret1' } });
  assert.deepEqual([r.status, r.body.error], [409, 'already exists']);
  r = await api('GET', '/api/tokens/zzz', { token: user1 });
  assert.deepEqual([r.status, r.body.error], [400, 'invalid _id']);

  // ---- shop profile, services, nearby, admin ----
  const admin = (await api('POST', '/api/auth/login', { body: { email: 'admin@example.com', password: 'secret1' } })).body.token;
  r = await api('PATCH', `/api/queues/${qid}`, { token: staff, body: {
    category: 'medical', phone: '123', address: { street: '12 Mall Road', city: 'Kanpur' }, hours: { open: '08:00' },
    services: [{ name: 'General Consultation', minutes: 10 }, { name: 'Follow-up', minutes: 5 }],
    location: { lat: 26.45, lng: 80.33 } } });
  assert.equal(r.status, 200);
  assert.deepEqual([r.body.queue.category, r.body.queue.address.city, r.body.queue.hours.open, r.body.queue.hours.close], ['medical', 'Kanpur', '08:00', '18:00']);
  assert.deepEqual(r.body.queue.location, { lat: 26.45, lng: 80.33 });
  assert.equal(r.body.queue.services.length, 2);
  r = await api('PATCH', `/api/queues/${qid}`, { token: staff, body: { location: { lat: 999, lng: 0 } } });
  assert.equal(r.status, 400);
  r = await api('PATCH', `/api/queues/${qid}`, { token: staff, body: { category: 'nope' } });
  assert.equal(r.status, 400);

  r = await api('POST', '/api/queues', { token: staff2, body: { name: 'Far Salon', category: 'salon' } });
  const far = r.body.queue._id;
  await api('PATCH', `/api/queues/${far}`, { token: staff2, body: { location: { lat: 26.6, lng: 80.5 } } }); // ~25 km away
  await api('POST', '/api/queues', { token: staff2, body: { name: 'No Location Shop' } });

  r = await api('GET', '/api/queues/nearby?lat=26.451&lng=80.331&radius=5');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.queues.map((q) => q.name), ['Dr. Sharma Clinic']);
  assert.ok(r.body.queues[0].distanceKm < 1);
  assert.equal(typeof r.body.queues[0].waitingCount, 'number');
  r = await api('GET', '/api/shops/nearby?lat=26.451&lng=80.331&radius=50');
  assert.deepEqual(r.body.queues.map((q) => q.name), ['Dr. Sharma Clinic', 'Far Salon']);
  r = await api('GET', '/api/queues/nearby?lat=26.451&lng=80.331&radius=50&category=salon');
  assert.deepEqual(r.body.queues.map((q) => q.name), ['Far Salon']);
  r = await api('GET', '/api/queues/nearby?lat=x');
  assert.equal(r.status, 400);
  r = await api('GET', '/api/queues?q=consult');
  assert.deepEqual(r.body.queues.map((q) => q.name), ['Dr. Sharma Clinic']);

  r = await api('POST', `/api/queues/${qid}/join`, { token: user1, body: { service: 'Follow-up' } });
  assert.equal(r.status, 201);
  assert.equal(r.body.ticket.service, 'Follow-up');
  assert.ok(Array.isArray(r.body.ticket.waitingNumbers));
  r = await api('POST', `/api/queues/${qid}/join`, { token: user2, body: { service: 'Nope' } });
  assert.equal(r.status, 400);
  r = await api('POST', `/api/queues/${qid}/complete`, { token: staff });
  assert.equal(r.status, 200);
  assert.equal(r.body.current, null);
  r = await api('GET', `/api/queues/${qid}/stats`, { token: staff });
  assert.equal(r.status, 200);
  assert.ok(r.body.served >= 1 && r.body.perHour.length === 24);
  r = await api('GET', `/api/queues/${qid}/stats`, { token: user1 });
  assert.equal(r.status, 403);
  r = await api('GET', '/api/tokens/history', { token: user1 });
  assert.ok(r.body.tickets.length >= 1);

  r = await api('GET', '/api/admin/stats', { token: admin });
  assert.equal(r.status, 200);
  assert.ok(r.body.users >= 6 && r.body.businesses === 3 && r.body.tokensPerDay.length === 7);
  r = await api('GET', '/api/admin/stats', { token: staff });
  assert.equal(r.status, 403);
  r = await api('GET', '/api/admin/users', { token: admin });
  assert.ok(r.body.users.length >= 6 && r.body.users[0].passwordHash === undefined);
  r = await api('PATCH', '/api/auth/me', { token: user1, body: { name: 'User One' } });
  assert.equal(r.body.user.name, 'User One');

  // ---- service-aware ETA, multi-counter, arrived/recall, verification, push, stats range ----
  r = await api('PATCH', `/api/queues/${qid}`, { token: staff, body: { counters: 2, graceMinutes: 5, services: [{ name: 'General Consultation', minutes: 10 }, { name: 'Follow-up', minutes: 5 }] } });
  assert.equal(r.status, 200);
  assert.deepEqual([r.body.queue.counters, r.body.queue.graceMinutes], [2, 5]);
  // fresh line: clear every token still active from the earlier rounds, then user2 (Follow-up 5), user3 (General 10) join
  for (const token of [user1, user2, user3]) {
    for (const t of (await api('GET', '/api/tokens/mine', { token })).body.tickets) {
      if (t.status === 'waiting') await api('DELETE', `/api/tokens/${t._id}`, { token });
      else await api('POST', `/api/queues/${qid}/complete`, { token: staff, body: { counter: t.counter ?? 1 } });
    }
  }
  assert.deepEqual((await api('GET', `/api/queues/${qid}`, { token: staff })).body.serving, []);
  r = await api('POST', `/api/queues/${qid}/join`, { token: user2, body: { service: 'Follow-up' } });
  assert.equal(r.status, 201);
  const u2 = r.body.ticket._id;
  r = await api('POST', `/api/queues/${qid}/join`, { token: user3, body: { service: 'General Consultation' } });
  assert.equal(r.status, 201);
  const u3 = r.body.ticket._id;
  assert.equal(r.body.ticket.ahead, 1);
  assert.equal(r.body.ticket.etaMinutes, 3); // 5 min of Follow-up ahead, spread over 2 counters → round(2.5)
  r = await api('GET', `/api/queues/${qid}`);
  assert.equal(r.body.queue.etaMinutes, 8); // (5 + 10) / 2
  // counter 2 calls next → user2 at counter 2; counter 1 calls next → user3 at counter 1
  r = await api('POST', `/api/queues/${qid}/next`, { token: staff, body: { counter: 2 } });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.serving.map((t) => [t._id, t.counter]), [[u2, 2]]);
  r = await api('GET', `/api/tokens/${u2}`, { token: user2 });
  assert.deepEqual([r.body.ticket.status, r.body.ticket.counter, !!r.body.ticket.arriveBy], ['serving', 2, true]);
  r = await api('POST', `/api/queues/${qid}/next`, { token: staff, body: { counter: 1 } });
  assert.equal(r.body.serving.length, 2);
  assert.deepEqual(r.body.serving.map((t) => t.counter).sort(), [1, 2]);
  // arrived stops the grace timer
  r = await api('POST', `/api/queues/${qid}/arrived/${u2}`, { token: staff });
  assert.equal(r.status, 200);
  assert.ok(r.body.serving.find((t) => t._id === u2).arrivedAt);
  r = await api('GET', `/api/tokens/${u2}`, { token: user2 });
  assert.equal(r.body.ticket.arriveBy, null);
  // counter 1 skips user3 (no-show) → recall puts them back at the front with priority
  r = await api('POST', `/api/queues/${qid}/skip`, { token: staff, body: { counter: 1 } });
  assert.equal(r.status, 200);
  assert.equal(r.body.skipped[0]._id, u3);
  assert.equal(r.body.serving.length, 1); // counter 2 still busy, counter 1 free (nobody waiting)
  r = await api('POST', `/api/queues/${qid}/recall/${u3}`, { token: staff });
  assert.equal(r.status, 200);
  assert.deepEqual([r.body.waiting[0]._id, r.body.waiting[0].priority, r.body.skipped.length], [u3, true, 0]);
  // recall clears the push history, so the customer is told they're next again and gets "your turn" when re-called
  const pushed = (await mongoose.model('Token').findById(u3)).pushed;
  assert.ok(pushed.includes('next') && !pushed.includes('turn') && !pushed.includes('skipped'));
  r = await api('POST', `/api/queues/${qid}/recall/${u3}`, { token: staff });
  assert.equal(r.status, 400);
  r = await api('POST', `/api/queues/${qid}/arrived/${u3}`, { token: user3 });
  assert.equal(r.status, 403);
  // lowering "counters" must not strand whoever is being served above the new limit: staff can't see
  // them, they can never be completed, and the grace sweeper would skip the wrong customer in their place
  r = await api('PATCH', `/api/queues/${qid}`, { token: staff, body: { counters: 3 } });
  assert.equal(r.body.queue.counters, 3);
  r = await api('POST', `/api/queues/${qid}/next`, { token: staff, body: { counter: 3 } });
  const stray = r.body.serving.find((t) => t.counter === 3);
  assert.ok(stray, 'counter 3 called someone');
  r = await api('PATCH', `/api/queues/${qid}`, { token: staff, body: { counters: 1 } });
  assert.equal(r.body.serving.filter((t) => t.counter > 1).length, 0);
  assert.ok(r.body.waiting.some((t) => t._id === stray._id && t.priority)); // back at the front, not lost
  assert.ok(r.body.queue.currentNumber === null || r.body.serving.some((t) => t.number === r.body.queue.currentNumber));
  r = await api('GET', `/api/tokens/${stray._id}`, { token: staff });
  assert.equal(r.body.ticket.status, 'waiting');
  await api('PATCH', `/api/queues/${qid}`, { token: staff, body: { counters: 2 } });

  // ---- express slots: paid priority, capped per hour, one token per payment, never for government ----
  const sign = (o, p) => createHmac('sha256', 'stub-secret').update(`${o}|${p}`).digest('hex');
  r = await api('PATCH', `/api/queues/${qid}`, { token: staff, body: { express: { enabled: true, price: 199, perHour: 1 } } });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.queue.express, { price: 199, perHour: 1, slotsLeft: 1 });
  assert.equal(r.body.paymentsEnabled, true);
  r = await api('GET', `/api/queues/${qid}`); // public view shows the offer without slotsLeft… but the state route is one shape
  assert.equal(r.body.queue.express.price, 199);
  // clear user1's spot so they can buy in
  for (const t of (await api('GET', '/api/tokens/mine', { token: user1 })).body.tickets) if (t.status === 'waiting') await api('DELETE', `/api/tokens/${t._id}`, { token: user1 });
  r = await api('POST', `/api/queues/${qid}/express/order`, { token: user1 });
  assert.equal(r.status, 201);
  assert.deepEqual([r.body.amount, r.body.currency, r.body.keyId], [19900, 'INR', 'rzp_stub_test']);
  const order = r.body.orderId;
  // a forged signature is refused and the order stays unused
  r = await api('POST', `/api/queues/${qid}/join`, { token: user1, body: { express: { orderId: order, paymentId: 'pay_x', signature: 'nope' } } });
  assert.equal(r.status, 400);
  // the real one buys a priority token at the front of the line
  r = await api('POST', `/api/queues/${qid}/join`, { token: user1, body: { service: 'Follow-up', express: { orderId: order, paymentId: 'pay_x', signature: sign(order, 'pay_x') } } });
  assert.equal(r.status, 201);
  assert.deepEqual([r.body.ticket.priority, r.body.ticket.express, r.body.ticket.ahead <= 2], [true, true, true]);
  const paidToken = r.body.ticket._id;
  // the same payment cannot be spent twice (user1 leaves first so the "already in queue" check does not mask it)
  await api('DELETE', `/api/tokens/${paidToken}`, { token: user1 });
  r = await api('POST', `/api/queues/${qid}/join`, { token: user1, body: { express: { orderId: order, paymentId: 'pay_x', signature: sign(order, 'pay_x') } } });
  assert.equal(r.status, 409);
  // another user's order cannot be redeemed by someone else
  r = await api('POST', `/api/queues/${qid}/express/order`, { token: user2 });
  assert.equal(r.status, 409); // perHour is 1 and user1's slot was sold this hour: sold out
  // government shops can never enable it
  r = await api('POST', '/api/queues', { token: staff2, body: { name: 'Passport Office', category: 'government' } });
  r = await api('PATCH', `/api/queues/${r.body.queue._id}`, { token: staff2, body: { express: { enabled: true, price: 100 } } });
  assert.equal(r.status, 400);
  await api('PATCH', `/api/queues/${qid}`, { token: staff, body: { express: { enabled: false } } });
  // sales history: the paid token above is the only transaction, visible to the owner and platform-wide to the admin
  r = await api('GET', `/api/queues/${qid}/sales`, { token: staff });
  assert.equal(r.status, 200);
  assert.deepEqual([r.body.count, r.body.amount, r.body.customers, r.body.byDay.length, r.body.transactions[0].paymentId], [1, 19900, 1, 30, 'pay_x']);
  assert.equal(r.body.byDay.reduce((n, d) => n + d.count, 0), 1);
  r = await api('GET', `/api/queues/${qid}/sales`, { token: user1 });
  assert.equal(r.status, 403);
  r = await api('GET', '/api/admin/transactions?days=7', { token: admin });
  assert.deepEqual([r.body.count, r.body.byDay.length, r.body.byShop[0].name, r.body.transactions[0].queue.name], [1, 7, 'Dr. Sharma Clinic', 'Dr. Sharma Clinic']);
  r = await api('GET', '/api/admin/transactions', { token: staff });
  assert.equal(r.status, 403);

  // ---- reviews: only a served visit can be rated, once; owner replies; shop carries the average ----
  r = await api('POST', `/api/queues/${qid}/reviews`, { token: user2, body: { tokenId: t1, rating: 5 } });
  assert.equal(r.status, 404); // not user2's visit
  r = await api('POST', `/api/queues/${qid}/reviews`, { token: user1, body: { tokenId: t1, rating: 6 } });
  assert.equal(r.status, 400);
  r = await api('POST', `/api/queues/${qid}/reviews`, { token: user1, body: { tokenId: t1, rating: 4, comment: ' Quick and kind. ' } });
  assert.equal(r.status, 201);
  assert.deepEqual([r.body.review.rating, r.body.review.comment, r.body.review.user.name, r.body.rating], [4, 'Quick and kind.', 'User One', { avg: 4, count: 1 }]);
  const rid = r.body.review._id;
  r = await api('POST', `/api/queues/${qid}/reviews`, { token: user1, body: { tokenId: t1, rating: 5 } });
  assert.equal(r.status, 409);
  r = await api('GET', `/api/tokens/${t1}`, { token: user1 });
  assert.deepEqual(r.body.ticket.review, { rating: 4, comment: 'Quick and kind.' });
  r = await api('GET', `/api/queues/${qid}`);
  assert.deepEqual(r.body.queue.rating, { avg: 4, count: 1 });
  r = await api('PATCH', `/api/queues/${qid}/reviews/${rid}`, { token: user1, body: { reply: 'thanks' } });
  assert.equal(r.status, 403);
  r = await api('PATCH', `/api/queues/${qid}/reviews/${rid}`, { token: staff, body: { reply: 'Thank you!' } });
  assert.equal(r.body.review.reply.text, 'Thank you!');
  r = await api('GET', `/api/queues/${qid}/reviews`);
  assert.deepEqual([r.body.avg, r.body.count, r.body.byStar[1], r.body.reviews[0].reply.text], [4, 1, { star: 4, count: 1 }, 'Thank you!']);

  // ---- cover photo: an upload is stored as a data URI, handed back as a URL, and saving the profile again keeps it ----
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
  r = await api('PATCH', `/api/queues/${qid}`, { token: staff, body: { image: 'javascript:alert(1)' } });
  assert.equal(r.status, 400);
  r = await api('PATCH', `/api/queues/${qid}`, { token: staff, body: { image: png } });
  assert.equal(r.body.queue.image, `/api/queues/${qid}/cover`);
  r = await api('PATCH', `/api/queues/${qid}`, { token: staff, body: { image: r.body.queue.image, name: 'Dr. Sharma Clinic' } });
  assert.equal(r.body.queue.image, `/api/queues/${qid}/cover`);
  r = await api('GET', `/api/queues/${qid}/cover`);
  assert.equal(r.status, 200);
  assert.equal(r.body.byteLength, 70);
  r = await api('PATCH', `/api/queues/${qid}`, { token: staff, body: { image: '' } });
  r = await api('GET', `/api/queues/${qid}/cover`);
  assert.equal(r.status, 404);

  // stats ranges
  r = await api('GET', `/api/queues/${qid}/stats?days=7`, { token: staff });
  assert.equal(r.status, 200);
  assert.ok(r.body.byDay.length === 7 && r.body.heat.length === 7 && r.body.heat[0].length === 24 && r.body.served >= 1);
  // business verification: pending shops are hidden from the public list/nearby until approved
  process.env.AUTO_APPROVE_SHOPS = '';
  r = await api('POST', '/api/queues', { token: staff2, body: { name: 'New Pending Shop' } });
  assert.equal(r.body.queue.status, 'pending');
  const pending = r.body.queue._id;
  await api('PATCH', `/api/queues/${pending}`, { token: staff2, body: { location: { lat: 26.451, lng: 80.331 } } });
  r = await api('GET', '/api/queues');
  assert.ok(!r.body.queues.some((q) => q._id === pending));
  r = await api('GET', '/api/queues/nearby?lat=26.451&lng=80.331&radius=5');
  assert.ok(!r.body.queues.some((q) => q._id === pending));
  r = await api('GET', `/api/queues/${pending}`, { token: staff2 }); // the owner can still open it
  assert.equal(r.status, 200);
  // ...and reach it from their dashboard, which the public list would hide (leaving them stuck on onboarding)
  r = await api('GET', '/api/queues?mine=1', { token: staff2 });
  assert.ok(r.body.queues.some((q) => q._id === pending));
  r = await api('GET', '/api/queues?mine=1', { token: user1 }); // mine=1 is scoped to the caller, not a back door
  assert.ok(!r.body.queues.some((q) => q._id === pending));
  r = await api('GET', '/api/queues?all=1', { token: staff2 }); // all=1 stays admin-only
  assert.ok(!r.body.queues.some((q) => q._id === pending));
  r = await api('GET', `/api/queues/${pending}`, { token: user1 }); // nobody else can, even with the id
  assert.equal(r.status, 404);
  r = await api('POST', `/api/queues/${pending}/join`, { token: user1 }); // and nobody can join before approval
  assert.equal(r.status, 403);
  r = await api('PATCH', `/api/admin/shops/${pending}`, { token: staff2, body: { status: 'approved' } });
  assert.equal(r.status, 403);
  r = await api('PATCH', `/api/admin/shops/${pending}`, { token: admin, body: { status: 'approved' } });
  assert.equal(r.body.shop.status, 'approved');
  r = await api('GET', '/api/queues/nearby?lat=26.451&lng=80.331&radius=5');
  assert.ok(r.body.queues.some((q) => q._id === pending));
  r = await api('PATCH', `/api/admin/shops/${pending}`, { token: admin, body: { status: 'suspended' } });
  r = await api('POST', `/api/queues/${pending}/join`, { token: user1 });
  assert.equal(r.status, 403);
  r = await api('GET', `/api/queues/${pending}`, { token: user1 });
  assert.equal(r.status, 404);
  r = await api('GET', '/api/queues?all=1', { token: admin });
  assert.ok(r.body.queues.some((q) => q._id === pending));
  r = await api('GET', '/api/admin/stats', { token: admin });
  assert.equal(typeof r.body.pendingShops, 'number');
  // push subscriptions — the client reads publicKey/enabled from /key before it can subscribe at all
  const uid = (t) => JSON.parse(Buffer.from(t.split('.')[1], 'base64url')).id;
  r = await api('GET', '/api/push/key');
  assert.equal(r.status, 200);
  assert.deepEqual([r.body.enabled, r.body.publicKey], [true, process.env.VAPID_PUBLIC_KEY]);
  const Sub = mongoose.model('PushSubscription');
  const sub = { endpoint: 'https://push.example.com/abc', keys: { p256dh: 'p', auth: 'a' } };
  r = await api('POST', '/api/push/subscribe', { token: user1, body: sub });
  assert.equal(r.status, 201);
  assert.equal(String((await Sub.findOne({ endpoint: sub.endpoint })).user), uid(user1));
  // the client posts { subscription } too (that's what PushSubscription.toJSON() hands it) and re-posts on
  // every load to rebind the device to whoever is logged in now — that must move the row, not add a second
  r = await api('POST', '/api/push/subscribe', { token: user2, body: { subscription: sub } });
  assert.equal(r.status, 201);
  assert.equal(await Sub.countDocuments({ endpoint: sub.endpoint }), 1);
  assert.equal(String((await Sub.findOne({ endpoint: sub.endpoint })).user), uid(user2));
  r = await api('POST', '/api/push/subscribe', { token: user1, body: { endpoint: 'http://insecure', keys: { p256dh: 'p', auth: 'a' } } });
  assert.equal(r.status, 400);
  r = await api('DELETE', '/api/push/subscribe', { token: user1, body: { endpoint: sub.endpoint } });
  assert.equal(r.status, 200);
  assert.equal(await Sub.countDocuments({ endpoint: sub.endpoint }), 1); // not user1's device any more
  r = await api('DELETE', '/api/push/subscribe', { token: user2, body: { endpoint: sub.endpoint } });
  assert.equal(r.status, 200);
  assert.equal(await Sub.countDocuments({ endpoint: sub.endpoint }), 0);

  // ---- sweeper guard, whole-number counters, unverified bookings, live role changes ----
  // the grace sweeper names the token it means to skip: if that counter has moved on, or the customer
  // arrived meanwhile, the skip is dropped instead of landing on whoever is standing there now
  const { callNext } = await import('../src/queue.js');
  const Tok = mongoose.model('Token');
  r = await api('POST', `/api/queues/${qid}/next`, { token: staff, body: { counter: 1 } });
  const called = r.body.serving.find((t) => t.counter === 1);
  assert.ok(called, 'someone was called to counter 1');
  assert.equal((await callNext(qid, 'skip', 1, new mongoose.Types.ObjectId())).done, null);
  assert.equal((await Tok.findById(called._id)).status, 'serving');
  await api('POST', `/api/queues/${qid}/arrived/${called._id}`, { token: staff });
  assert.equal((await callNext(qid, 'skip', 1, called._id)).done, null);
  assert.equal((await Tok.findById(called._id)).status, 'serving');
  r = await api('PATCH', `/api/queues/${qid}`, { token: staff, body: { counters: 2.5 } });
  assert.equal(r.status, 400);
  // nobody can book at a shop that isn't live yet
  r = await api('POST', '/api/queues', { token: staff2, body: { name: 'Unverified Shop' } });
  assert.equal(r.body.queue.status, 'pending');
  r = await api('POST', '/api/appointments', { token: user1, body: { queue: r.body.queue._id, at: new Date(Date.now() + 3600e3).toISOString() } });
  assert.equal(r.status, 403);
  // a role changed by an admin applies on the very next request, with the token the user already holds
  r = await api('PATCH', `/api/admin/users/${uid(user3)}`, { token: admin, body: { role: 'staff' } });
  assert.equal(r.body.user.role, 'staff');
  r = await api('POST', '/api/queues', { token: user3, body: { name: 'Promoted Shop' } });
  assert.equal(r.status, 201);
  await api('PATCH', `/api/admin/users/${uid(staff2)}`, { token: admin, body: { role: 'user' } });
  r = await api('POST', '/api/queues', { token: staff2, body: { name: 'Demoted Shop' } });
  assert.equal(r.status, 403);
});
