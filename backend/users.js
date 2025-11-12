
const express = require("express");
const bcrypt = require("bcrypt");
const router = express.Router();

const User = require("./models/user");
const Restaurant = require("./models/restaurant"); // usato solo per /users/restaurants

/**
 * @swagger
 * tags:
 *   name: Users
 *   description: Gestione utenti (registrazione, login, lista, dettaglio, update, delete, cambio password).
 */

// ---------- utils ----------
function normalizeBody(b = {}) {
  return {
    username:   (b.username ?? "").trim(),
    email:      (b.email ?? "").trim(),
    password:    b.password ?? "",
    role:        b.role === "ristoratore" ? "ristoratore" : "cliente",

    // alias accettati
    telefono:    b.telefono ?? b.phone ?? "",
    luogo:       b.luogo ?? b.location ?? "",
    partitaIva:  b.partitaIva ?? b.vat ?? "",
    indirizzo:   b.indirizzo ?? b.address ?? "",

    // altri campi
    nome:        b.nome ?? "",
    cognome:     b.cognome ?? "",
    pagamento:   b.pagamento ?? "",
    preferenza:  b.preferenza ?? "",

    restaurantName: b.restaurantName ?? "",
  };
}

const isObjectId  = (id) => /^[a-f0-9]{24}$/i.test(String(id));
const isNumericId = (id) => /^\d+$/.test(String(id));

async function nextLegacyId() {
  const last = await User.findOne({ legacyId: { $ne: null } })
    .sort({ legacyId: -1 })
    .select("legacyId")
    .lean();
  return (last?.legacyId || 0) + 1;
}

function sanitize(u) {
  if (!u) return u;
  const { password, __v, ...rest } = u;
  return rest;
}
// questo pezzo di codice si occupa di gestire utenti verificando che i campi siano validi
// =====================================================
//                    registrazione
// =====================================================
/**
 * @swagger
 * /users/register:
 *   post:
 *     tags: [Users]
 *     summary: registra un nuovo utente (cliente o ristoratore)
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       201:
 *         description: Utente creato
 *       409:
 *         description: Username o email già in uso
 */
router.post("/register", async (req, res) => {
  try {
    const b = normalizeBody(req.body);
    if (!b.username || !b.email || !b.password) {
      return res.status(400).json({ message: "username, email and password are obligatory" });
    }

    // unicità
    const exists = await User.findOne({
      $or: [{ username: b.username }, { email: b.email }]
    }).lean();
    if (exists) return res.status(409).json({ message: "username or email areday used" });

    // hash password
    let hashed = b.password;
    if (!/^\$2[aby]\$/.test(hashed)) {
      hashed = await bcrypt.hash(String(b.password), 10);
    }

    const legacyId = await nextLegacyId();

    const created = await User.create({
      ...b,
      password: hashed,
      legacyId,
    });

    return res.status(201).json(sanitize(created.toObject()));
  } catch (err) {
    console.error("POST /users/register error:", err);
    res.status(500).json({ message: err.message || "error server" });
  }
});

// compat: alcuni frontend usano POST /users per creare
router.post("/", (req, res) => {
  req.url = "/register";
  router.handle(req, res);
});
// questo pezzo di codice viene usato quando viene creato un utente che fa tutti i controlli 
// per verificare tutti i campi sia corretti poi se tutto giusto 201 se vi somno errori lato
//client 400 4090oppure se errori lato server 500
// =====================================================
//                         loin
// =====================================================
/**
 * @swagger
 * /users/login:
 *   post:
 *     tags: [Users]
 *     summary: effettua il login (bcrypt compat o password in chiaro)
 */
router.post("/login", async (req, res) => {
  try {
    const { username, email, password } = req.body || {};
    if (!password || (!username && !email)) {
      return res.status(400).json({ message: "username/email and password are obligatory" });
    }

    const user = await User.findOne(
      username ? { username } : { email }
    ).lean();

    if (!user) return res.status(401).json({ message: "invalid credentials" });

    const stored = String(user.password || "");

    let ok = false;
    if (/^\$2[aby]\$/.test(stored)) {
      // hash bcrypt
      ok = await bcrypt.compare(String(password), stored);
    } else {
      // fallback legacy plain text
      ok = stored === String(password);
    }

    if (!ok) return res.status(401).json({ message: " Invalid credentials" });

    // (qui potresti generare un JWT, per ora ritorno l'utente senza password)
    return res.json(sanitize(user));
  } catch (err) {
    console.error("POST /users/login error:", err);
    res.status(500).json({ message: "error server" });
  }
});
// questo pezzo di codice si occupa di effettuare la login e vedere 
// se le credenziali utente siano corretti se non corretti alert 401
// se  errore server 500 giusto?
// =====================================================
//                         lista
// =====================================================
router.get("/", async (req, res) => {
  try {
    const { role, q } = req.query || {};
    const and = [];
    if (role) and.push({ role });
    if (q) {
      const rx = new RegExp(String(q), "i");
      and.push({ $or: [{ username: rx }, { email: rx }] });
    }
    const filter = and.length ? { $and: and } : {};
    const users = await User.find(filter).select("-password").lean();
    res.json(users);
  } catch (err) {
    console.error("GET /users error:", err);
    res.status(500).json({ message: "Error loading users" });
  }
});
// si occupa di cercare la lista degli utenti se non riesce per errore del server 
// errore 500 giusto?
// =====================================================
//     /users/restaurants (prima delle rotte con :id)
// =====================================================
router.get("/restaurants", async (_req, res) => {
  try {
    const restaurants = await Restaurant.find().lean();
    if (restaurants?.length) {
      const out = restaurants.map((r) => ({
        nome: r.nome ?? r.name ?? "",
        location: r.luogo || r.location || "",
        telefono: r.telefono || r.phone || "",
        partitaIVA: r.partitaIva || r.vat || "",
        restaurantId: r.restaurantId ?? r.id ?? r._id ?? null,
      }));
      return res.json(out);
    }

    const users = await User.find({ role: "ristoratore" }).lean();
    const out = users.map((u) => ({
      nome: u.restaurantName || `${u.username} Ristorante`,
      location: u.luogo || u.location || "",
      telefono: u.telefono || u.phone || "",
      partitaIVA: u.partitaIva || u.vat || "",
      restaurantId: u.restaurantId ?? u.legacyId ?? u._id ?? null,
    }));
    res.json(out);
  } catch (err) {
    console.error("Error GET /users/restaurants:", err);
    res.status(500).json({ message: "Error in restaurateur recovery" });
  }
});
// questo pezzo fa la stessa cosa del precedente ma per user che sono ristoranti 

// =====================================================
//                        dettaglio
// =====================================================
router.get("/:id", async (req, res) => {
  try {
    const param = String(req.params.id);
    const filter = isObjectId(param)
      ? { _id: param }
      : isNumericId(param)
      ? { legacyId: Number(param) }
      : null;
    if (!filter) return res.status(400).json({ message: "ID not valid" });

    const u = await User.findOne(filter).select("-password").lean();
    if (!u) return res.status(404).json({ message: "User not found" });
    res.json(u);
  } catch (err) {
    console.error("GET /users/:id error:", err);
    res.status(500).json({ message: "Error loading user" });
  }
});
//usato dopo la login verifica se id user valido oppure user non valido  
// =====================================================
//                        aggiunta
// =====================================================
router.put("/:id", async (req, res) => {
  try {
    const param = String(req.params.id);
    const filter = isObjectId(param)
      ? { _id: param }
      : isNumericId(param)
      ? { legacyId: Number(param) }
      : null;
    if (!filter) return res.status(400).json({ message: "ID not valid" });

    const updates = { ...normalizeBody(req.body) };
    delete updates._id;
    delete updates.legacyId;
    delete updates.username; // non permetto cambio username
    delete updates.role;     // cambia ruolo via endpoint dedicato, se mai
    delete updates.password; // password via endpoint dedicato

    const updated = await User.findOneAndUpdate(filter, { $set: updates }, { new: true })
      .select("-password")
      .lean();
    if (!updated) return res.status(404).json({ message: "Utente not found" });
    res.json(updated);
  } catch (err) {
    console.error("PUT /users/:id error:", err);
    res.status(500).json({ message: "error while editing" });
  }
});
// e usato inca so di modifica del profilo del user
// =====================================================
//                   cambio password
// =====================================================
router.put("/:id/password", async (req, res) => {
  try {
    const param = String(req.params.id);
    const filter = isObjectId(param)
      ? { _id: param }
      : isNumericId(param)
      ? { legacyId: Number(param) }
      : null;
    if (!filter) return res.status(400).json({ message: "ID not valid" });

    const { password } = req.body || {};
    if (!password) return res.status(400).json({ message: "password obligatory" });

    const hash = await bcrypt.hash(String(password), 10);
    const updated = await User.findOneAndUpdate(filter, { $set: { password: hash } }, { new: true });
    if (!updated) return res.status(404).json({ message: "Utente not found" });

    res.sendStatus(204);
  } catch (err) {
    console.error("PUT /users/:id/password error:", err);
    res.status(500).json({ message: "Error updating password" });
  }
});
// questo pezzo è usato per evetuale caso di modifica della password da parte del del user 
// =====================================================
//                         cancelazione
// =====================================================
router.delete("/:id", async (req, res) => {
  try {
    const param = String(req.params.id);
    const filter = isObjectId(param)
      ? { _id: param }
      : isNumericId(param)
      ? { legacyId: Number(param) }
      : null;
    if (!filter) return res.status(400).json({ message: "ID not valid" });

    const deleted = await User.findOneAndDelete(filter);
    if (!deleted) return res.status(404).json({ message: "Utente not found" });
    res.sendStatus(204);
  } catch (err) {
    console.error("User deletion error:", err);
    res.status(500).json({ message: "Error while deleting" });
  }
});
// usato invce quando utente decide di cancellare la account dall'applicazione
module.exports = router;
