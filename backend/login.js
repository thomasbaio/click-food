const express = require("express");
const bcrypt = require("bcrypt");
const crypto = require("crypto");
let jwt; try { jwt = require("jsonwebtoken"); } catch {}
const router = express.Router();

const User = require("./models/user"); // assicurati che lo schema includa restaurantId: String

const JWT_SECRET = process.env.JWT_SECRET || null;
const JWT_TTL = process.env.JWT_TTL || "7d";

/**
 * @swagger
 * tags:
 *   name: Users
 *   description: Autenticazione e sessione
 */

/* ----------------------- helpers ----------------------- */

function isNonEmpty(s) {
  return typeof s === "string" && s.trim().length > 0;
}

function escRegex(s = "") { // serve per evitare problemi nelle ricerche regex
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeRole(s) { // uniformare il ruolo
  return String(s || "").trim().toLowerCase();
}

function makeRestaurantId(user) { // crea o restituisce il id al ristorante
  if (user.restaurantId) return String(user.restaurantId);
  if (process.env.DEFAULT_RESTAURANT_ID) return String(process.env.DEFAULT_RESTAURANT_ID);
  if (user.legacyId != null) return `r_${user.legacyId}`;
  return String(user._id);
}

function buildSafeUser(u) {
  return {
    id: u._id,
    username: u.username,
    email: u.email,
    role: u.role,
    restaurantId: u.restaurantId || null,
    telefono: u.telefono || "",
    luogo: u.luogo || "",
    partitaIva: u.partitaIva || "",
    indirizzo: u.indirizzo || "",
    nome: u.nome || "",
    cognome: u.cognome || "",
    pagamento: u.pagamento || "",
    preferenza: u.preferenza || "",
    legacyId: u.legacyId ?? null,
  };
}
//serve per costruire una versione sicura dell'oggetto utente cioe son solo i campi non sensibili come password
/* ----------------------- /login ----------------------- */

/**
 * @swagger
 * /login:
 *   post:
 *     tags: [Users]
 *     summary: Login con email (o username) e password
 *     description: Verifica le credenziali e restituisce un token e i dati utente. Se l'utente è un ristoratore e non ha `restaurantId`, gli viene auto-assegnato e salvato.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             oneOf:
 *               - required: [email, password]
 *               - required: [username, password]
 *             properties:
 *               email: { type: string, format: email }
 *               username: { type: string }
 *               password: { type: string, minLength: 1 }
 *     responses:
 *       200:
 *         description: Login effettuato
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 token: { type: string }
 *                 tokenType: { type: string, enum: [jwt, opaque] }
 *                 user:
 *                   type: object
 *                   properties:
 *                     id: { type: string }
 *                     username: { type: string }
 *                     email: { type: string }
 *                     role: { type: string }
 *                     restaurantId: { type: string, nullable: true }
 *       400:
 *         description: Parametri mancanti
 *       401:
 *         description: Credenziali non valide
 */
router.post("/login", async (req, res) => {
  try {
    const { email, username, password } = req.body || {};

    if (!isNonEmpty(password) || (!isNonEmpty(email) && !isNonEmpty(username))) {
      return res.status(400).json({ error: "Missing credentials" });
    }

    // ricerca case-insensitive per email o username
    const or = [];
    if (isNonEmpty(email)) {
      or.push({ email: new RegExp("^" + escRegex(email.trim()) + "$", "i") });
    }
    if (isNonEmpty(username)) {
      or.push({ username: new RegExp("^" + escRegex(username.trim()) + "$", "i") });
    }
    const user = await User.findOne({ $or: or }).exec(); // usata in mongose per creare doc nella collezione user
    if (!user) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    // verifica password
    const ok = await bcrypt.compare(password, user.password || "");
    if (!ok) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    // auto-assegnazione restaurantId per ristoratori
    const role = normalizeRole(user.role);
    if (["ristoratore", "restauratore", "ristorante", "restaurant"].includes(role) && !user.restaurantId) {
      user.restaurantId = makeRestaurantId(user);
      try { await user.save(); } catch (e) {
        // se fallisce il salvataggio, rispondiamo comunque con il valore calcolato
        console.warn("[login] unable to persist restaurantId:", e?.message || e);
      }
    }

    // token
    let tokenType = "opaque";
    let token = crypto.randomBytes(24).toString("hex");

    if (jwt && JWT_SECRET) { // se sono preesnti nella libreria jwt e jwt_secret 
      tokenType = "jwt"; // allora verrà generato jwt
      token = jwt.sign(
        {
          sub: String(user._id),
          role: user.role,
          restaurantId: user.restaurantId || null,
        },
        JWT_SECRET, // può essere vista come la firma /chiave segreta
        { expiresIn: JWT_TTL }
      );
    }

    // opzionale: aggiorna lastLogin
    try { user.lastLogin = new Date(); await user.save(); } catch {}

    return res.json({
      token,
      tokenType,
      user: buildSafeUser(user),
    });
  } catch (err) {
    console.error("POST /login error:", err);
    return res.status(500).json({ error: "Login error", detail: String(err?.message || err) });
  }
});

module.exports = router;
