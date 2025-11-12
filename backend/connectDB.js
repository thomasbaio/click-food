const mongoose = require("mongoose");

mongoose.set("strictQuery", true);

const STATE = ["disconnected", "connected", "connecting", "disconnecting"];

function mongoReady() {
  return mongoose?.connection?.readyState === 1;
}

function stateLabel() {
  return STATE[mongoose?.connection?.readyState ?? 0];
}

function redact(uri = "") {
  return uri.replace(/\/\/([^:@]+):([^@]+)@/, "//$1:***@");
}

/**
 * connette a mongodb se presente la MONGO_URI.
 * - Idempotente: se già connesso/connecting, non duplica le connessioni.
 * - Non lancia eccezioni: logga e restituisce null in caso di errore.
 * - Usa autoIndex solo in dev.
 */
async function connectDB(uri) {
  const mongoUri = uri || process.env.MONGO_URI;
  if (!mongoUri) {
    console.warn(" MONGO_URI not set: boot without DB (fallback on file).");
    return null;
  }

  // già connesso
  if (mongoose.connection.readyState === 1) {
    console.log(" already connected to mongodb .", mongoose.connection.name ? `DB: ${mongoose.connection.name}` : "");
    return mongoose.connection;
  }

  // fase di connessione
  if (mongoose.connection.readyState === 2) {
    console.log("connection mongodb in corso…");
    await new Promise((resolve, reject) => {
      const onOk = () => { cleanup(); resolve(); };
      const onErr = (err) => { cleanup(); reject(err); };
      const cleanup = () => {
        mongoose.connection.off("connected", onOk);
        mongoose.connection.off("error", onErr);
      };
      mongoose.connection.once("connected", onOk);
      mongoose.connection.once("error", onErr);
      // timeout di sicurezza
      setTimeout(() => { cleanup(); resolve(); }, 5000);
    }).catch(() => null);
    return mongoose.connection.readyState === 1 ? mongoose.connection : null;
  }

  // connetti
  try {
    const opts = {
      serverSelectionTimeoutMS: Number(process.env.MONGO_TIMEOUT_MS || 5000),
      maxPoolSize: Number(process.env.MONGO_POOL || 10),
      autoIndex: process.env.NODE_ENV !== "production",
    };

    // log essenziale
    console.log("🔌 Connessione a MongoDB:", redact(mongoUri));
    await mongoose.connect(mongoUri, opts);

    // event logging minimale
    mongoose.connection.on("error", (e) => console.error("mongo error:", e.message));
    mongoose.connection.on("disconnected", () => console.warn("mongo disconnected"));
    mongoose.connection.on("reconnected", () => console.log(" mongo reconnected"));

    console.log(`mongodb connected (state=${stateLabel()}) DB: ${mongoose.connection.name}`);
    return mongoose.connection;
  } catch (err) {
    console.error(" connecting error mongodb:", err.message);
    console.warn(" proseguo senza DB (fallback su file).");
    return null;
  }
}

/** chiude la connessione in modo sicuro */
async function closeDB() {
  try {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.connection.close();
      console.log("connected close to mongodb .");
    }
  } catch (e) {
    console.error("close erroe mongodb:", e?.message || e);
  }
}

module.exports = connectDB;
module.exports.mongoReady = mongoReady;
module.exports.closeDB = closeDB;
module.exports.stateLabel = stateLabel;
