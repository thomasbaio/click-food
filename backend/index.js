const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const mongoose = require('mongoose');
const swaggerUi = require('swagger-ui-express');
const swaggerJsdoc = require('swagger-jsdoc');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

app.set('trust proxy', 1);
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// -------------------- mongodb --------------------
(async () => {
  try {
    if (!process.env.MONGO_URI) {
      console.warn('MONGO_URI not set: I continue without DB');
    } else {
      await mongoose.connect(process.env.MONGO_URI);
      console.log('Mongo connected');
    }
  } catch (err) {
    console.error('Error connected Mongo:', err.message);
  }
})();

// -------------------- rotte API --------------------
function safeRequire(relPath) {
  try {
    return require(relPath);
  } catch (e) {
    console.warn(` Optional module "${relPath}" not loaded: ${e.message}`);
    return null;
  }
}

const mealsRoutes = require('./meals');
const userRoutes = require('./users');
const orderRoutes = safeRequire('./orders');
const restaurantRoutes = safeRequire('./restaurant');

// health checks 
app.get('/healthz', (_req, res) => res.send('ok'));
app.get('/health', (_req, res) =>
  res.json({
    ok: true,
    mongo: mongoose.connection?.readyState === 1 ? 'connected' : 'not_connected',
    time: new Date().toISOString(),
  })
);

// -------------------- frontend --------------------
const FRONTEND_DIR = path.join(__dirname, '..', 'frontend');
const hasFrontend = fs.existsSync(FRONTEND_DIR);
if (hasFrontend) {
  console.log('FRONTEND_DIR:', FRONTEND_DIR);
  app.use(express.static(FRONTEND_DIR));
  app.get('/', (_req, res) => res.sendFile(path.join(FRONTEND_DIR, 'index.html')));
} else {
  app.get('/', (_req, res) => res.send('OK'));
}

// -------------------- mount API --------------------
app.use('/users', userRoutes);
if (orderRoutes) app.use('/orders', orderRoutes);
if (restaurantRoutes) app.use('/restaurant', restaurantRoutes);
app.use('/meals', mealsRoutes);

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
  apis: [path.join(__dirname, '*.js')], // puoi aggiungere pattern extra
});

app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, { explorer: true }));

// catch-all verso SPA solo se il frontend è servito da qui
if (hasFrontend) {
  app.get(/^(?!\/(meals|orders|users|restaurant|healthz?|api-docs)(\/|$)).*/, (_req, res) => {
    res.sendFile(path.join(FRONTEND_DIR, 'index.html'));
  });
}

// -------------------- error handler --------------------
app.use((err, _req, res, _next) => {
  console.error(' Unhandled error:', err);
  res.status(500).send('Internal error');
});

// -------------------- listen --------------------
app.listen(PORT, '0.0.0.0', () => {
  console.log(` Server listening on :${PORT}`);
  console.log(` Swagger UI: ${PUBLIC_BASE}/api-docs`);
});
