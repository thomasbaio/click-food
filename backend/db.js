require("dotenv").config();
const path = require("path");
const express = require("express");
const cors = require("cors");

const connectDB = require("./connectDB");      

// routers
const mealsRouter = require("./meals");        // /meals
const loginRouter = require("./login");        // POST /login
const registerRouter = require("./register");  // POST /register
const usersRouter = require("./user");         // /users (legacy compat)
const restaurantsRouter = require("./restaurant"); // /restaurants (NON modificato)
const ordersRouter = require("./order");       // /orders

const { setupSwagger } = require("./swagger"); // swagger UI + /api-docs.json

const app = express();

// fidati del proxy
app.set("trust proxy", 1);

// middlewares base
app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

// static (opzionale)
app.use(express.static(path.join(__dirname, "public")));

// Swagger ui + jsom spec
setupSwagger(app);

// redirect comodo alla doc
app.get("/", (_req, res) => res.redirect("/api-docs"));

/**
 * @swagger
 * /health:
 *   get:
 *     tags: [database]
 *     summary: Stato server/DB
 *     responses:
 *       200:
 *         description: Ok
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok: { type: boolean, example: true }
 *                 dbConnected: { type: boolean, example: true }
 *                 time: { type: string, format: date-time, example: "2025-09-19T12:00:00Z" }
 */
app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    dbConnected: typeof connectDB.mongoReady === "function" ? connectDB.mongoReady() : false,
    time: new Date().toISOString(),
  });
});

/* ================== API rotte ================== */
// rotte root-level
app.use(loginRouter);               // POST /login
app.use(registerRouter);            // POST /register

// gruppi con prefisso
app.use("/users", usersRouter);
app.use("/restaurants", restaurantsRouter);
app.use("/orders", ordersRouter);
app.use("/meals", mealsRouter);
/* =============================================== */

// 404 API 
app.use((req, res, next) => {
  const API_PREFIXES = ["/meals", "/orders", "/users", "/restaurants", "/login", "/register", "/health"];
  if (API_PREFIXES.some((p) => req.path.startsWith(p))) {
    return res.status(404).json({ message: "Not Found" });
  }
  next();
});

// error handler JSON
app.use((err, _req, res, _next) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ message: err?.message || "Internal Server Error" });
});

// avvio server + connessione DB (non blocca se MONGO_URI manca)
const PORT = process.env.PORT || 3000;
const serverStart = async () => {
  try {
    await connectDB(process.env.MONGO_URI); // parte anche senza MONGO_URI
  } catch (e) {
    console.warn("DB connection failed, continuing with file fallback. Reason:", e?.message || e);
  }

  const srv = app.listen(PORT, () => {
    console.log(`HTTP server → http://localhost:${PORT}`);
    console.log(`Swagger UI  → http://localhost:${PORT}/api-docs`);
    console.log(`OpenAPI JSON→ http://localhost:${PORT}/api-docs.json`);
  });

  // shutdown pulito (se disponibile closeDB)
  const shutdown = async (signal) => {
    console.log(`\n${signal} received. Shutting down…`);
    try {
      if (typeof connectDB.closeDB === "function") {
        await connectDB.closeDB();
      }
      srv.close(() => process.exit(0));
    } catch (e) {
      console.error("Error during shutdown:", e?.message || e);
      process.exit(1);
    }
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
};

serverStart();

