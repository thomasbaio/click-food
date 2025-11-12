const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const mongoose = require('mongoose');
const swaggerUi = require('swagger-ui-express');
const swaggerJsdoc = require('swagger-jsdoc');
require('dotenv').config();

mongoose.set('strictQuery', true);
// evita operazioni in buffer quando il DB non è pronto
mongoose.set('bufferCommands', false);

const app = express();
const PORT = process.env.PORT || 3000;

app.set('trust proxy', 1);

// Se vuoi restringere le origini in produzione, scommenta e imposta la tua origin
// const allowed = new Set([process.env.PUBLIC_BASE_URL, process.env.RENDER_EXTERNAL_URL].filter(Boolean));
// app.use(cors({ origin: (o, cb) => cb(null, !o || allowed.has(o)) }));
app.use(cors());

app.use(express.json({ limit: '10mb' }));

/* -------------------- util -------------------- */
function safeRequire(relPath) {
  try { return require(relPath); }
  catch (e) { console.warn(`Optional module "${relPath}" not loaded: ${e.message}`); return null; }
}
function mongoState() {
  const s = mongoose.connection?.readyState ?? 0;
  const map = { 0: 'disconnected', 1: 'connected', 2: 'connecting', 3: 'disconnecting' };
  return { code: s, label: map[s] || 'unknown' };
}

/* -------------------- rotte API -------------------- */
const mealsRoutes = require('./meals');
const userRoutes = require('./users');
const orderRoutes = safeRequire('./orders');
const restaurantRoutes = safeRequire('./restaurant');

/* -------------------- health checks -------------------- */
app.get('/healthz', (_req, res) => res.send('ok'));
app.get('/health', (_req, res) => {
  const m = mongoState();
  res.json({ ok: true, mongo: m.label, mongoCode: m.code, time: new Date().toISOString() });
});
app.get('/health/db', (_req, res) => res.json(mongoState()));

/* -------------------- frontend static -------------------- */
const FRONTEND_DIR = path.join(__dirname, '..', 'frontend');
const hasFrontend = fs.existsSync(FRONTEND_DIR);
if (hasFrontend) {
  console.log('FRONTEND_DIR:', FRONTEND_DIR);
  app.use(express.static(FRONTEND_DIR));
  app.get('/', (_req, res) => res.sendFile(path.join(FRONTEND_DIR, 'index.html')));
} else {
  app.get('/', (_req, res) => res.send('OK'));
}

/* -------------------- swagger -------------------- */
const PUBLIC_BASE =
  process.env.PUBLIC_BASE_URL ||
  process.env.RENDER_EXTERNAL_URL ||
  `http://localhost:${PORT}`;

const swaggerSpec = swaggerJsdoc({
  definition: {
    openapi: '3.0.3',
    info: { title: 'Restaurant Management API', version: '1.0.0' },
    servers: [{ url: PUBLIC_BASE }, { url: `http://localhost:${PORT}` }],
  },
  apis: [path.join(__dirname, '*.js')], // aggiungi pattern extra se hai sottocartelle
});

app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, { explorer: true }));

/* -------------------- mount API -------------------- */
app.use('/users', userRoutes);
if (orderRoutes) app.use('/orders', orderRoutes);
if (restaurantRoutes) app.use('/restaurant', restaurantRoutes);
app.use('/meals', mealsRoutes);

// 404 per API sconosciute (prima del catch-all SPA)
app.use(/^\/(meals|orders|users|restaurant)(\/|$)/, (_req, res) => {
  res.status(404).json({ message: 'Not found' });
});

/* -------------------- catch-all verso SPA -------------------- */
if (hasFrontend) {
  app.get(/^(?!\/(meals|orders|users|restaurant|healthz?|api-docs)(\/|$)).*/, (_req, res) => {
    res.sendFile(path.join(FRONTEND_DIR, 'index.html'));
  });
}

/* -------------------- boot DB-first + listen -------------------- */
(async () => {
  try {
    const uri = process.env.MONGO_URI;
    if (!uri) {
      console.warn('MONGO_URI not set: running without DB (file fallback).');
    } else {
      console.log('Connecting to MongoDB…');
      await mongoose.connect(uri, {
        serverSelectionTimeoutMS: Number(process.env.MONGO_TIMEOUT_MS || 8000),
        connectTimeoutMS: 20000,
        socketTimeoutMS: 20000,
        maxPoolSize: Number(process.env.MONGO_POOL || 10),
        autoIndex: process.env.NODE_ENV !== 'production',
      });
      console.log('Mongo connected');
    }
  } catch (err) {
    console.error('Mongo connection error:', err?.message || err);
    console.warn('Continuing without DB (file fallback).');
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server listening on :${PORT}`);
    console.log(`Public base: ${PUBLIC_BASE}`);
    console.log(`Swagger UI:   ${PUBLIC_BASE}/api-docs`);
  });
})();

/* -------------------- graceful shutdown -------------------- */
async function shutdown(signal) {
  try {
    console.log(`${signal} received. Shutting down…`);
    if (mongoose.connection?.readyState) {
      await mongoose.connection.close();
      console.log('Mongo connection closed.');
    }
  } catch (e) {
    console.warn('Error during shutdown:', e?.message || e);
  } finally {
    process.exit(0);
  }
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));

/* -------------------- error handler -------------------- */
app.use((err, _req, res, _next) => {
  console.error('Unhandled error:', err);
  res.status(500).send('Internal error');
});
