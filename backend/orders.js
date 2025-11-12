const express = require("express");
const fs = require("fs");
const path = require("path");
const router = express.Router();

let Order = null;
try { Order = require("./models/order"); } catch { Order = null; } // se manca il model, useremo il file

/* ====================== config & costanti ====================== */

// file locali (fallback)
const USERS_FILE  = path.join(__dirname, "users.json");
const MEALS_FILE  = path.join(__dirname, "meals1.json");
const ORDERS_FILE = path.join(__dirname, "orders.json");

// Stati SOLO ASPORTO (flusso: ordinato -> preparazione -> ritirato | annullato)
const VALID_STATES = ["ordinato", "preparazione", "ritirato", "annullato"];
const FINAL_STATES = new Set(["ritirato", "annullato"]);
const NEXT_ALLOWED = {
  ordinato:     ["preparazione", "annullato", "ritirato"], // ritiro immediato consentito
  preparazione: ["ritirato", "annullato"],
  ritirato:     [],
  annullato:    [],
};

/* ====================== helper file fallback ====================== */
function ensureFile(p, def = "[]") {
  try {
    const dir = path.dirname(p);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (!fs.existsSync(p)) fs.writeFileSync(p, def, "utf8");
  } catch {}
}
ensureFile(ORDERS_FILE, "[]");

function safeReadJSON(file) {
  try { if (!fs.existsSync(file)) return null; return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { return null; }
}
function writeJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
}

/* ====================== helper comuni ====================== */
const toStr = (v) => (v == null ? null : String(v).trim());

function mongoReady() {
  try {
    const mongoose = require("mongoose");
    return mongoose?.connection?.readyState === 1;
  } catch { return false; }
}

async function nextOrderId() {
  // prova mongo
  if (Order && mongoReady()) {
    const last = await Order.findOne().sort({ id: -1 }).select("id").lean();
    return (last?.id || 0) + 1;
  }
  // fallback file
  const all = safeReadJSON(ORDERS_FILE) || [];
  const max = all.reduce((m, o) => Math.max(m, Number(o.id) || 0), 0);
  return max + 1;
}
// la funzione estrae id partendo dal username
function inferUserIdFromUsername(username) {
  const data = safeReadJSON(USERS_FILE);
  if (!data || !Array.isArray(data)) return String(username || "");
  const u = data.find(x => (x.username || "").toLowerCase() === String(username || "").toLowerCase());
  return u && (u._id || u.id) ? String(u._id || u.id) : String(username || "");
}
//la funzione in questione legge il meals_files json e lo converte in struttura ordinata annidatà
function flattenFileMeals() {
  const data = safeReadJSON(MEALS_FILE);
  if (!data || !Array.isArray(data)) return [];
  return data.flatMap(r =>
    (r.menu || []).map(p => ({
      restaurantId: String(r.restaurantId || r.id || ""),
      id: String(p.idmeals ?? p.id ?? p._id ?? ""),
      nome: p.nome ?? p.strMeal ?? p.name ?? "Senza nome",
      prezzo: Number(p.prezzo ?? p.price ?? 0) || 0,
    }))
  );
}
// la funzione prende come argomento mealids a partre da meals1.json per ogni piatto viene assegnato al ristornate a cui appartine
function inferRestaurantIdFromMeals(mealIds) {
  const meals = flattenFileMeals();
  const set = new Set((mealIds || []).map(String));
  const hit = meals.find(m => set.has(m.id));
  return hit ? hit.restaurantId : "";
}
// la funzione in questione si occupa di estrarre oggetti facendo prima 
//delle operazioni di sicurezza che poi portano a come risultato alla 
//creazione di un oggetto che il carrello pulito  
function extractItemsFromAny(body) {
  const buckets = []
    .concat(Array.isArray(body.items) ? body.items : [])
    .concat(Array.isArray(body.cart) ? body.cart : [])
    .concat(Array.isArray(body.cartItems) ? body.cartItems : [])
    .concat(Array.isArray(body.meals) ? body.meals : [])
    .concat(Array.isArray(body.dishes) ? body.dishes : []);

  return buckets.map(x => {
    if (typeof x === "string" || typeof x === "number") {
      return { mealId: toStr(x), qty: 1 };
    }
    if (x && typeof x === "object") {
      const mealId = toStr(x.mealId ?? x.idmeals ?? x.idMeal ?? x.id ?? x._id ?? x.productId);
      const qty = Number(x.qty ?? x.quantity ?? 1) || 1;
      const name = x.nome ?? x.strMeal ?? x.name ?? x.title;
      const priceRaw = x.prezzo ?? x.price;
      const price = priceRaw != null ? Number(priceRaw) : undefined;
      return mealId ? { mealId, qty, name, price } : null;
    }
    return null;
  }).filter(Boolean);
}

function collapseItems(items) {
  const map = new Map();
  for (const it of (items || [])) {
    const key = it.mealId;
    if (!map.has(key)) map.set(key, { mealId: key, qty: 0, name: undefined, price: undefined });
    const cur = map.get(key);
    cur.qty += it.qty || 1;
    if (!cur.name && it.name) cur.name = it.name;
    if (cur.price == null && it.price != null && !Number.isNaN(Number(it.price))) {
      cur.price = Number(it.price);
    }
  }
  return [...map.values()];
}
// questa funzione ricava da item  che fa parte del carrelo estrae il prezzzo ed il nome
function enrichItemsFromFile(items) {
  const catalog = flattenFileMeals();
  const byId = new Map(catalog.map(m => [m.id, m]));
  return (items || []).map(it => {
    const m = byId.get(it.mealId);
    return {
      ...it,
      name: it.name ?? m?.nome ?? "Senza nome",
      price: it.price != null ? Number(it.price) : m ? Number(m.prezzo) : 0,
    };
  });
}

// compat schema mongoose: idmeals
function toSchemaItems(items) {
  return (items || []).map(it => {
    const n = Number(it.mealId);
    const idmeals = Number.isFinite(n) ? n : undefined;
    return { idmeals, qty: Number(it.qty || 1), price: Number(it.price || 0), name: it.name, mealId: it.mealId };
  });
}

function computeTotal(items) {
  let tot = 0;
  for (const it of (items || [])) tot += (Number(it.qty || 1) * (Number(it.price || 0)));
  return Number(tot.toFixed(2));
}

/* ------------ normalizzazioni SOLO ASPORTO + compat legacy ------------ */
// la funzione uniforma gli stati d'ordine vecchi o incorenti
function normalizeLegacyState(s) {
  const v = String(s || "").toLowerCase();
  if (v === "consegna") return "preparazione";
  if (v === "consegnato") return "ritirato";
  return v;
}

// la funzione si occupa pulire i dati di un ordine sia username che carta che lo stato che
// passa ad orinato 
function normalizeBody(b) {
  const body = { ...(b || {}) };
  body.username = typeof body.username === "string" ? body.username.trim() : "";
  body.payment  = body.payment || "carta";
  body.status   = normalizeLegacyState(body.status);
  if (!VALID_STATES.includes(body.status)) body.status = "ordinato";

  if (typeof body.userId === "string") body.userId = body.userId.trim();
  if (typeof body.restaurantId === "string") body.restaurantId = body.restaurantId.trim();


//la funzione si occupa di normalizzare m per ritornare il metodo di pagameto del utente
function normalizePaymentMethod(m) {
  const s = String(m || "carta").toLowerCase().replace(/\s+/g, "_").replace(/-/g, "_");
  if (["carta","card","creditcard","credit_card","carta_credito","carta_di_credito"].includes(s)) return "carta";
  if (["online","paypal","stripe"].includes(s)) return "online";
  if (["contanti","cash"].includes(s)) return "contanti";
  return "carta";
}
// la funzione lavora in modalità asincrona ed sio occupa di parire dal id per poi ritornare
// ordine che apprtine a quel id
async function findOrderByAnyId(idParam) {
  // se ho mongo provo id numerico e poi _id
  if (Order && mongoReady()) {
    const asNumber = Number(idParam);
    if (Number.isFinite(asNumber)) {
      const byNumeric = await Order.findOne({ id: asNumber });
      if (byNumeric) return byNumeric;
    }
    try { const byMongo = await Order.findById(idParam); if (byMongo) return byMongo; } catch {}
  }
  // fallback file
  const all = safeReadJSON(ORDERS_FILE) || [];
  return all.find(o => String(o._id || o.id) === String(idParam)) || null;
}

function validateForCreate(payload) {
  const errors = [];
  if (!payload.username) errors.push("missing username");
  if (!payload.items || !payload.items.length) errors.push("no dish in the order");
  if (!payload.userId) errors.push("missing userId");
  if (!payload.restaurantId) errors.push("missing restaurantId");
  return errors;
}

/* ============================ swagger: create ============================ */
/**
 * @swagger
 * /orders:
 *   post:
 *     tags: [Orders]
 *     summary: Crea un nuovo ordine (solo asporto)
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: "#/components/schemas/Order" }
 *           examples:
 *             base:
 *               value:
 *                 username: "thomas"
 *                 userId: "1"
 *                 restaurantId: "r_o"
 *                 items:
 *                   - idmeals: 101
 *                     qty: 2
 *                     price: 7.5
 *                 payment: { method: "carta", paid: false }
 *     responses:
 *       201:
 *         description: Ordine creato
 *       400:
 *         $ref: "#/components/responses/ValidationError"
 *       500:
 *         description: Errore interno
 */
router.post("/", async (req, res) => {
  try {
    const raw = normalizeBody(req.body);

    let items = extractItemsFromAny(raw);
    items = collapseItems(items);
    items = enrichItemsFromFile(items);
    const schemaItems = toSchemaItems(items);

    const meals = items.map(it => String(it.mealId));
    if (!raw.userId) raw.userId = inferUserIdFromUsername(raw.username);
    if (!raw.restaurantId) raw.restaurantId = inferRestaurantIdFromMeals(meals);

    const rawPayment = raw.payment;
    const methodIn   = typeof rawPayment === "object" ? rawPayment.method : rawPayment;
    const method     = normalizePaymentMethod(methodIn);
    const payment    = {
      method,
      paid: typeof rawPayment === "object" ? Boolean(rawPayment.paid) : false,
      transactionId: typeof rawPayment === "object" ? rawPayment.transactionId : undefined,
    };

    // mappa stato legacy se arrivasse (consegna/consegnato)
    const status = normalizeLegacyState(raw.status);
    const payload = {
      id: await nextOrderId(),
      username: raw.username,
      userId: raw.userId,
      restaurantId: raw.restaurantId,
      items: schemaItems,   // idmeals/qty/price (+ name, mealId)
      meals,                // elenco id stringa (compat vecchio)
      total: computeTotal(schemaItems),
      status,
      state: status,        // compat
      payment,
      note: raw.note,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const errors = validateForCreate(payload);
    if (errors.length) return res.status(400).json({ message: "payload not valid", details: errors });

    if (Order && mongoReady()) {
      const created = await Order.create(payload);
      return res.status(201).json(created);
    } else {
      const all = safeReadJSON(ORDERS_FILE) || [];
      const created = { ...payload, _id: String(payload.id) };
      all.push(created);
      writeJSON(ORDERS_FILE, all);
      return res.status(201).json(created);
    }
  } catch (err) {
    console.error("error POST /orders:", err);
    return res.status(500).json({ message: "error during create of the order", detail: String(err?.message || err) });
  }
});

/* ============================ swagger: lista ============================ */
/**
 * @swagger
 * /orders:
 *   get:
 *     tags: [Orders, fetch]
 *     summary: Elenco ordini (filtri opzionali)
 *     parameters:
 *       - in: query
 *         name: username
 *         schema: { type: string }
 *       - in: query
 *         name: restaurantId
 *         schema: { type: string }
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [ordinato, preparazione, ritirato, annullato] }
 *       - in: query
 *         name: state
 *         schema: { type: string, enum: [ordinato, preparazione, ritirato, annullato] }
 *     responses:
 *       200:
 *         description: Elenco ordini
 */
router.get("/", async (req, res) => {
  try {
    const { username, restaurantId, status, state } = req.query;
    const normStatus = status ? normalizeLegacyState(status) : null;
    const normState  = state  ? normalizeLegacyState(state)  : null;

    const q = {};
    if (username) q.username = username;
    if (restaurantId) q.restaurantId = restaurantId;
    if (normStatus) q.$or = [{ status: normStatus }, { state: normStatus }];
    else if (normState) q.$or = [{ status: normState }, { state: normState }];

    if (Order && mongoReady()) {
      const orders = await Order.find(q).sort({ createdAt: -1, id: -1 }).lean();
      return res.json(orders);
    } else {
      const all = safeReadJSON(ORDERS_FILE) || [];
      const rows = all.filter(o =>
        (username ? String(o.username) === String(username) : true) &&
        (restaurantId ? String(o.restaurantId) === String(restaurantId) : true) &&
        (normStatus ? (normalizeLegacyState(o.status) === normStatus || normalizeLegacyState(o.state) === normStatus) : true) &&
        (normState ? (normalizeLegacyState(o.status) === normState || normalizeLegacyState(o.state) === normState) : true)
      );
      return res.json(rows);
    }
  } catch (err) {
    console.error("error GET /orders:", err);
    return res.status(500).json({ message: "error order recovery" });
  }
});
// questo pezzo di codice si occupa di recuperare una lista degli ordini ed puo avere succeso 
//status sarà 200 se invece 500 errore durnate la recoveri giusto?
/* ============================ alias: /orders/list ============================ */
/**
 * @swagger
 * /orders/list:
 *   get:
 *     tags: [Orders, fetch]
 *     summary: Alias della lista ordini (stessa semantica di /orders)
 *     responses:
 *       200:
 *         description: Elenco ordini
 */
router.get("/list", (req, res) => router.handle({ ...req, url: "/orders", originalUrl: "/orders" }, res));

/* ============================ swagger: by restaurant ============================ */
/**
 * @swagger
 * /orders/restaurant/{id}:
 *   get:
 *     tags: [Orders, fetch]
 *     summary: Elenco ordini per ristorante
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Elenco ordini del ristorante
 */
router.get("/restaurant/:id", async (req, res) => {
  const restaurantId = req.params.id;
  try {
    if (Order && mongoReady()) {
      const rows = await Order.find({ restaurantId }).sort({ createdAt: -1, id: -1 }).lean();
      return res.json(rows);
    } else {
      const all = safeReadJSON(ORDERS_FILE) || [];
      const rows = all.filter(o => String(o.restaurantId) === String(restaurantId));
      return res.json(rows);
    }
  } catch (err) {
    console.error("Error GET /orders/restaurant/:id:", err);
    return res.status(500).json({ message: "error order recovery" });
  }
});

/* ============================ swagger: Get by id ============================ */
/**
 * @swagger
 * /orders/{id}:
 *   get:
 *     tags: [Orders]
 *     summary: Dettaglio ordine (accetta id incrementale o _id Mongo)
 *     parameters:
 *       - $ref: '#/components/parameters/IdPath'
 *     responses:
 *       200:
 *         description: Ok
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */
router.get("/:id", async (req, res) => {
  try {
    const order = await findOrderByAnyId(req.params.id);
    if (!order) return res.status(404).json({ message: "order not found" });
    res.json(order);
  } catch (err) {
    console.error("Error GET /orders/:id:", err);
    res.status(500).json({ message: "error loading order" });
  }
});

/* ============================ cambio stato ============================ */
async function updateOrderStateGeneric(idParam, incomingBody, res) {
  const desiredRaw = incomingBody?.status ?? incomingBody?.state ?? incomingBody?.newState ?? "";
  const desired = normalizeLegacyState(desiredRaw);
  const clienteConfermaRitiro = incomingBody?.clienteConfermaRitiro;

  if (!VALID_STATES.includes(desired)) {
    return res.status(400).json({ message: `status not valid: ${desired}` });
  }
// la funzione in questione lavora in modo asincono e si occupa di aggiornare  lo stato del 
  // ordine se lo stato è invalido da errore 400 lato cliente
  // carica ordine (mongo o file)
  let order = await findOrderByAnyId(idParam);
  if (!order) return res.status(404).json({ message: "order not found" });
//questo pezzo di codice parte con lo stato del ordine che ordinato  si preccupa di controlla
// che non visiano invalide transione di stao
  const current = normalizeLegacyState(order.status || order.state || "ordinato");
  const allowedNext = NEXT_ALLOWED[current] || [];
  if (current !== desired && !allowedNext.includes(desired)) {
    return res.status(422).json({ message: `invalid transition from "${current}" a "${desired}"`, allowedNext });
  }

  order.status = desired;
  order.state  = desired;

  if (typeof clienteConfermaRitiro !== "undefined") order.clienteConfermaRitiro = Boolean(clienteConfermaRitiro);
  const s = desired.toLowerCase();
  if (s === "ritirato" && !order.ritiratoAt) order.ritiratoAt = new Date();
  if (s === "ritirato") order.ritiroConfermato = true;
  if (FINAL_STATES.has(s)) order.closedAt = order.closedAt || new Date();
  order.updatedAt = new Date();

  if (Order && mongoReady()) {
    // se era un plain object dal file, riallineo shape minima
    if (!order.save) {
      const idVal = order._id || order.id;
      await Order.updateOne(
        { $or: [{ _id: idVal }, { id: idVal }] },
        { $set: { ...order } }
      );
      const updated = await findOrderByAnyId(idVal);
      return res.json(updated);
    }
    await order.save();
    return res.json(order);
  } else {
    // persist su file
    const all = safeReadJSON(ORDERS_FILE) || [];
    const idx = all.findIndex(o => String(o._id || o.id) === String(idParam));
    if (idx < 0) return res.status(404).json({ message: "order not found" });
    all[idx] = { ...all[idx], ...order };
    writeJSON(ORDERS_FILE, all);
    return res.json(all[idx]);
  }
}
// questo si occupa della trasizione finale che è  ritirato solo se il cliente ha 
// schiacciato il bottone ritirato se non vie neussun ordine visarà un errore 404
/**
 * @swagger
 * /orders/{id}:
 *   put:
 *     tags: [Orders]
 *     summary: Aggiorna stato ordine (accetta body con {status} o {state} o {newState})
 *     parameters:
 *       - $ref: '#/components/parameters/IdPath'
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               status:
 *                 type: string
 *                 enum: [ordinato, preparazione, ritirato, annullato]
 *               clienteConfermaRitiro: { type: boolean }
 *     responses:
 *       200: { description: Stato aggiornato }
 *       400: { $ref: '#/components/responses/ValidationError' }
 *       404: { $ref: '#/components/responses/NotFound' }
 *       422:
 *         description: Transizione di stato non valida
 */
router.put("/:id", async (req, res) => {
  try {
    await updateOrderStateGeneric(req.params.id, req.body, res);
  } catch (err) {
    console.error("error PUT /orders/:id:", err);
    return res.status(500).json({ message: "error update order", detail: String(err?.message || err) });
  }
});

/**
 * @swagger
 * /orders/{id}/state:
 *   put:
 *     tags: [Orders]
 *     summary: Alias per aggiornare lo stato ordine
 *     parameters:
 *       - $ref: '#/components/parameters/IdPath'
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               newState:
 *                 type: string
 *                 enum: [ordinato, preparazione, ritirato, annullato]
 *     responses:
 *       200: { description: Stato aggiornato }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.put("/:id/state", async (req, res) => {
  try {
    await updateOrderStateGeneric(req.params.id, req.body, res);
  } catch (err) {
    console.error("error PUT /orders/:id/state:", err);
    return res.status(500).json({ message: "error update order", detail: String(err?.message || err) });
  }
});

module.exports = router;
