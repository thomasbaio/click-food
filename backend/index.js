cconst express = require('express'); 
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const mongoose = require('mongoose');
const swaggerUi = require('swagger-ui-express');
const swaggerJsdoc = require('swagger-jsdoc');
require('dotenv').config();

mongoose.set('strictQuery', true);
// 🔴 importante: evita i "buffering timed out"
mongoose.set('bufferCommands', false);

const app = express();
const PORT = process.env.PORT || 3000;

app.set('trust proxy', 1);
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// -------------------- rotte API (lazy require) --------------------
function safeRequire(relPath) {
  try { return require(relPath); }
  catch (e) { console.warn(`Optional module "${relPath}" not loaded: ${e.message}`); return null; }
}
const mealsRoutes = require('./meals');
const userRoutes = require('./users');
const orderRoutes = safeRequire('./orders');
const restaurantRoutes = safeRequire('./restaurant');

// -------------------- health checks --------------------
app.get('/healthz', (_req, res) => res.send('ok'));
app.get('/health', (_req, res) => {
  const mstate = mongoose.connection?.readyState ?? 0;
  const map = {0:'disconnected',1:'connected',2:'connecting',3:'disconnecting'};
  res.json({ ok: true, mongo: map[mstate], time: new Date().toISOString() });
});

// -------------------- frontend static --------------------
const FRONTEND_DIR = path.join(__dirname, '..', 'frontend');
const hasFrontend = fs.existsSync(FRONTEND_DIR);
if (hasFrontend) {
  console.log('FRONTEND_DIR:', FRONTEND_DIR);
  app.use(express.static(FRONTEND_DIR));
  app.get('/', (_req, res) => res.sendFile(path.join(FRONTEND_DIR, 'index.html')));
} else {
  app.get('/', (_req, res) => res.send('OK'));
}

// -------------------- swagger --------------------
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
  apis: [path.join(__dirname, '*.js')],
});
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, { explorer: true }));

// -------------------- mount API --------------------
app.use('/users', userRoutes);
if (orderRoutes) app.use('/orders', orderRoutes);
if (restaurantRoutes) app.use('/restaurant', restaurantRoutes);
app.use('/meals', mealsRoutes);

// catch-all verso SPA solo se serviamo noi il frontend
if (hasFrontend) {
  app.get(/^(?!\/(meals|orders|users|restaurant|healthz?|api-docs)(\/|$)).*/, (_req, res) => {
    res.sendFile(path.join(FRONTEND_DIR, 'index.html'));
  });
}

// -------------------- boot DB-first + listen --------------------
(async () => {
  try {
    const uri = process.env.MONGO_URI;
    if (!uri) {
      console.warn('MONGO_URI not set: I continue without DB (file fallback).');
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
    console.error('Error connected Mongo:', err?.message || err);
    console.warn('Continuing without DB (file fallback).');
  }

  // ascolta SOLO dopo il tentativo di connessione
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server listening on :${PORT}`);
    console.log(`Swagger UI: ${PUBLIC_BASE}/api-docs`);
  });
})();

// -------------------- error handler --------------------
app.use((err, _req, res, _next) => {
  console.error('Unhandled error:', err);
  res.status(500).send('Internal error');
});
