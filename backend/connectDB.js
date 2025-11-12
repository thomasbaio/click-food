const mongoose = require("mongoose");

mongoose.set("strictQuery", true);
// 🔴 importante: niente buffering se il DB non è pronto
mongoose.set("bufferCommands", false);

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

async function connectDB(uri) {
  const mongoUri = uri || process.env.MONGO_URI;
  if (!mongoUri) {
    console.warn("MONGO_URI not set: boot without DB (fallback on file).");
    return null;
  }

  if (mongoose.connection.readyState === 1) {
    console.log("Already connected to MongoDB.", mongoose.connection.name ? `DB: ${mongoose.connection.name}` : "");
    return mongoose.connection;
  }

  if (mongoose.connection.readyState === 2) {
    console.log("Connection to MongoDB in progress…");
    try {
      await new Promise((resolve, reject) => {
        const onOk = () => { cleanup(); resolve(); };
        const onErr = (err) => { cleanup(); reject(err); };
        const cleanup = () => {
          mongoose.connection.off("connected", onOk);
          mongoose.connection.off("error", onErr);
        };
        mongoose.connection.once("connected", onOk);
        mongoose.connection.once("error", onErr);
        setTimeout(() => { cleanup(); resolve(); }, 5000);
      });
    } catch (_) {}
    return mongoose.connection.readyState === 1 ? mongoose.connection : null;
  }

  try {
    // registra i listener una volta
    mongoose.connection.on("error", (e) => console.error("mongo error:", e.message));
    mongoose.connection.on("disconnected", () => console.warn("mongo disconnected"));
    mongoose.connection.on("reconnected", () => console.log("mongo reconnected"));

    const opts = {
      serverSelectionTimeoutMS: Number(process.env.MONGO_TIMEOUT_MS || 5000),
      socketTimeoutMS: 20000,
      connectTimeoutMS: 20000,
      maxPoolSize: Number(process.env.MONGO_POOL || 10),
      autoIndex: process.env.NODE_ENV !== "production",
    };

    console.log("🔌 Connessione a MongoDB:", redact(mongoUri));
    await mongoose.connect(mongoUri, opts);

    console.log(`MongoDB connected (state=${stateLabel()}) DB: ${mongoose.connection.name}`);
    return mongoose.connection;
  } catch (err) {
    console.error("Connecting error MongoDB:", err.message);
    console.warn("Proseguo senza DB (fallback su file).");
    return null;
  }
}

async function closeDB() {
  try {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.connection.close();
      console.log("Connection to MongoDB closed.");
    }
  } catch (e) {
    console.error("Close error MongoDB:", e?.message || e);
  }
}

module.exports = { connectDB, mongoReady, closeDB, stateLabel };
