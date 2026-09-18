import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { Server } from 'socket.io';
import { verifyToken } from './auth.js';
import authRoutes from './routes/auth.js';
import queueRoutes from './routes/queues.js';
import tokenRoutes from './routes/tokens.js';
import appointmentRoutes from './routes/appointments.js';
import adminRoutes from './routes/admin.js';
import pushRoutes from './routes/push.js';
import { startGraceSweeper } from './queue.js';

export const app = express();
app.set('trust proxy', Number(process.env.TRUST_PROXY) || 0);
export const server = createServer(app);
export const io = new Server(server);
app.set('io', io);

// ponytail: CSP off — the app loads fonts, map tiles and photos from several origins; add a policy listing them when hardening further
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '1mb' })); // room for an uploaded cover photo (base64, capped at ~500 KB by the route)
// brute-force guard on credentials; per IP (set TRUST_PROXY=1 behind a reverse proxy so the real client IP is used)
const authLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false, skip: () => process.env.NODE_ENV === 'test', message: { error: 'too many attempts, try again in 15 minutes' } });
app.use('/api/auth/login', authLimit);
app.use('/api/auth/register', authLimit);
app.use('/api/auth', authRoutes);
app.use('/api/queues', queueRoutes);
app.use('/api/shops', queueRoutes); // alias: a shop is a queue
app.use('/api/tokens', tokenRoutes);
app.use('/api/appointments', appointmentRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/push', pushRoutes);
app.get('/healthz', (req, res) => res.json({ ok: true }));
app.use('/api', (req, res) => res.status(404).json({ error: 'not found' }));

const dist = fileURLToPath(new URL('../../client/dist', import.meta.url));
if (existsSync(dist)) {
  app.use(express.static(dist));
  app.get('/{*splat}', (req, res) => res.sendFile(path.join(dist, 'index.html')));
}

app.use((err, req, res, next) => {
  const status = err.status
    || (err.name === 'ValidationError' || err.name === 'CastError' ? 400 : err.code === 11000 ? 409 : 500);
  if (status === 500) console.error(err);
  const msg = status === 500 ? 'internal error'
    : err.code === 11000 ? 'already exists'
    : err.name === 'CastError' ? `invalid ${err.path}`
    : err.code === 'ENOENT' ? 'not found'
    : err.message;
  res.status(status).json({ error: msg });
});

// Guests may connect (to watch public queues); a bad token is rejected.
io.use((socket, next) => {
  const { token } = socket.handshake.auth ?? {};
  try {
    socket.user = token ? verifyToken(token) : null;
    next();
  } catch {
    next(new Error('unauthorized'));
  }
});

if (process.env.NODE_ENV !== 'test') startGraceSweeper(io);

io.on('connection', (socket) => {
  if (socket.user) socket.join(`user:${socket.user.id}`);
  socket.on('queue:watch', (id) => typeof id === 'string' && socket.join(`queue:${id}`));
  socket.on('queue:unwatch', (id) => typeof id === 'string' && socket.leave(`queue:${id}`));
});
