
const express = require("express");
const router = express.Router();

const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");
const Meal = require("./models/meal");

/**
 * @swagger
 * tags:
 *   name: Meals
 *   description: Gestione piatti per ristorante (DB con fallback su file)
 */

/* --------------------------- helpers --------------------------- */

function mongoReady() {
  return mongoose?.connection?.readyState === 1; // 1 = connected
}

// risolve il percorso di meals1.json in modo robusto
function resolveMealsFile() {
  const candidates = [
    process.env.MEALS_FILE,
    path.join(__dirname, "meals1.json"),
    path.join(process.cwd(), "meals1.json"),
    path.join(__dirname, "..", "meals1.json"),
    path.join(__dirname, "../..", "meals1.json"),
  ].filter(Boolean);

  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return p;
    } catch {}
  }
  return candidates[candidates.length - 1] || "meals1.json"; // ciclo usato per cercare il documento valido  spesso usato in node-js
}

function readFileMeals() { // scopo leggere in modo sicuro il file meals.json è una funzione robusta
  const filePath = resolveMealsFile(); //la instrada nel percorso corretto
  try {// gestione sicure se filepath vuoto non esiste file invece se esiste legge il contenuto ed lo converte in un array 
    if (!filePath || !fs.existsSync(filePath)) {
      return { data: [], filePath, error: null, exists: false };
    }
    const raw = fs.readFileSync(filePath, "utf8");
    const data = JSON.parse(raw || "[]"); //converte il json in un arrray
    return { data, filePath, error: null, exists: true };
  } catch (err) { // in caso di un eventuale errore durante le operazioni
    return { data: [], filePath, error: String(err?.message || err), exists: false };
  }
}

function writeFileMeals(data, filePath) {
  const out = Array.isArray(data) ? data : [];//controllo di sicurezza
  fs.writeFileSync(filePath, JSON.stringify(out, null, 2), "utf8"); // operazione di scittura vera e propria
}

function looksLikeMeal(o) { //serve per capire se un certo oggetto assomiglia a un piatto
  if (!o || typeof o !== "object") return false;// contollo se o non esiste oppure il suo tipo è un oggeto
  return ( // oggetto contine almeno una di queste proprietà
    "nome" in o || "name" in o || "strMeal" in o ||
    "tipologia" in o || "category" in o || "strCategory" in o
  );
}

// sia lista flat di piatti usato per normalizzare la truttura dati dei piatti letti nel file
function flattenFileMeals(data) { 
  if (!Array.isArray(data)) return [];//controllo di sicurezza che restituisce array vuoto

  if (data.length && looksLikeMeal(data[0])) {//controlla che array data non sia vuoto e che il primo elemento somiglia un piatto
    return data.map((m) => ({ ...m }));
  }
// se invece i piatti sono annidari dentro i ristornati , funzione srotols in unico array aggiungeno il com resturantid
  const out = [];
  for (const r of data) {//scorre i ristoranti
    const menu = Array.isArray(r?.menu) ? r.menu : [];//usa il menu solo se menu è un array
    for (const m of menu) { //scorrei nìmenu
      out.push({ ...m, restaurantId: r.restaurantId ?? r.id ?? r._id });
    }
  }
  return out;
}

/* ----------------- normalizzazione ingredienti ----------------- */

function normalizeIngredients(obj) {// estrae la lista degli ingredienti
  if (Array.isArray(obj?.ingredienti)) {
    return obj.ingredienti.filter(Boolean).map((x) => String(x).trim()).filter(Boolean);
  }
  const list = [];
  for (let i = 1; i <= 20; i++) {
    const ing = obj?.[`strIngredient${i}`];
    const meas = obj?.[`strMeasure${i}`];
    if (ing && String(ing).trim()) {
      list.push(meas ? `${meas} ${ing}`.trim() : String(ing).trim());
    }
  }
  if (!list.length && Array.isArray(obj?.ingredients)) {
    return obj.ingredients.filter(Boolean).map((x) => String(x).trim()).filter(Boolean);
  }
  return list;
}

function withIngredients(m) {//crea oggetto completo con tutti i campi uniformi
  const clone = { ...m };

  if (Array.isArray(clone.ingredienti)) { //se oggetto a proprietà 
    const arr = clone.ingredienti.filter(Boolean).map((x) => String(x).trim()).filter(Boolean);
    clone.ingredienti = arr;
    clone.ingredients = arr.slice();
    clone.ingredient = arr.join(", ");
    return clone;
  }

  if (Array.isArray(clone.ingredients)) {
    const arr = clone.ingredients.filter(Boolean).map((x) => String(x).trim()).filter(Boolean);
    clone.ingredienti = arr;
    clone.ingredients = arr.slice();
    clone.ingredient = arr.join(", ");
    return clone;
  }

  const list = [];
  for (let i = 1; i <= 20; i++) {
    const ing = clone[`strIngredient${i}`];
    const meas = clone[`strMeasure${i}`];
    if (ing && String(ing).trim()) {
      list.push(meas ? `${meas} ${ing}`.trim() : String(ing).trim());
    }
    delete clone[`strIngredient${i}`];
    delete clone[`strMeasure${i}`];
  }
  clone.ingredienti = list;
  clone.ingredients = list.slice();
  clone.ingredient = list.join(", ");
  return clone;
}
// funizioni normalizeIngredient e withIngredients servono per uniformare la struttura dati degli ingredienti
//queste funzioni leggono tutti i formati posssibili, li puliscono i vlori e creano un array
//di ingredienti coerente, aggiungendo anche una versione testuale unica
/* ------------------------------ utils ------------------------------ */

function isHex24(s) { // controlla se una stringa id esadecimale a 24 caratteri
  return typeof s === "string" && /^[0-9a-fA-F]{24}$/.test(s);
}

function pickUpdatableFields(body) {
  const b = body || {};
  const ingrArr = normalizeIngredients(b)
    .filter(Boolean)
    .map((x) => String(x).trim())
    .filter(Boolean);
  const ingrStr = ingrArr.join(", ");

  const update = { //costruito oggetto dinamico update ed contine i campi validi e non quelli vuoti
    ...(b.restaurantId != null ? { restaurantId: b.restaurantId } : {}),
    ...(b.nome || b.name || b.strMeal ? { nome: b.nome || b.name || b.strMeal } : {}),
    ...(b.tipologia || b.category || b.strCategory
      ? { tipologia: b.tipologia || b.category || b.strCategory }
      : {}),
    ...(b.prezzo != null ? { prezzo: Number(b.prezzo) } : {}),
    ...(b.foto || b.image || b.strMealThumb ? { foto: b.foto || b.image || b.strMealThumb } : {}),
    ...(ingrArr.length
      ? { ingredienti: ingrArr, ingredients: ingrArr.slice(), ingredient: ingrStr }
      : {}),
    ...(b.origine ? { origine: b.origine } : {}),
  };
  if (typeof b.isCommon === "boolean") update.isCommon = b.isCommon;
  return update; //infine ritorna update 
}

/* ----------------------- helpers “comuni” backend ----------------------- */

const norm = (s) => String(s || "").trim().toLowerCase();
const nameOf = (m) => norm(m.name || m.nome || m.strMeal);//serve pre estrarre il nome
const imgOf  = (m) => norm(m.image || m.immagine || m.strMealThumb);//stessa cosa ma con immagine

function ingredientsOf(m) { //scopo di assegnare la lista di ingredienti giusta ad m
  if (Array.isArray(m.ingredients)) return m.ingredients.filter(Boolean);
  if (Array.isArray(m.ingredienti)) return m.ingredienti.filter(Boolean);
  const out = [];
  for (let i = 1; i <= 20; i++) {
    const v = m["strIngredient" + i];
    if (v && String(v).trim()) out.push(String(v).trim());
  }
  return out;
}

// scegli la copia “migliore”: immagine > più ingredienti > descrizione più lunga
function chooseBetter(a, b) {
  const ai = imgOf(a) ? 1 : 0,  bi = imgOf(b) ? 1 : 0;
  if (ai !== bi) return ai > bi ? a : b;

  const ac = ingredientsOf(a).length, bc = ingredientsOf(b).length;
  if (ac !== bc) return ac > bc ? a : b;

  const ad = (a.description || a.descrizione || a.strInstructions || "").trim().length;
  const bd = (b.description || b.descrizione || b.strInstructions || "").trim().length;
  if (ad !== bd) return ad > bd ? a : b;

  return a;
}

function dedupeByName(list) { //scopo di rimuovere i duplicati dello stesso piatto 
  const map = new Map();
  for (const m of list) {
    const n = nameOf(m);
    if (!n) continue;
    map.set(n, map.has(n) ? chooseBetter(map.get(n), m) : m);
  }
  return [...map.values()];
}

// carica solo i piatti “comuni” dal file (no menu dei ristoranti)
function loadCommonFromFile() {
  const { data } = readFileMeals();
  if (!data) return [];

  // se esiste una proprietà "common" usala
  if (Array.isArray(data.common)) {
    return data.common.map(withIngredients);
  }

  // se l'array top-level è già una lista di piatti, considerali comuni
  if (Array.isArray(data) && data.length && looksLikeMeal(data[0])) {
    return data.map(withIngredients);
  }

  // altrimenti (lista ristoranti con menu) → nessun “comune” nel file
  return [];
}

/* ------------------------------- ROUTES ------------------------------- */

/**
 * @swagger
 * /meals/common-meals:
 *   get:
 *     tags: [Meals]
 *     summary: lista dei piatti comuni (merge DB + file), senza piatti dei ristoranti, con deduplica
 *     parameters:
 *       - in: query
 *         name: source
 *         description: sorgente da cui leggere
 *         schema:
 *           type: string
 *           enum: [all, db, file]
 *           default: all
 *       - in: query
 *         name: excludeMyMenu
 *         description: restaurantId del chiamante; esclude i piatti già presenti nel suo menu (per nome)
 *         schema:
 *           type: string
 *       - in: query
 *         name: dedup
 *         description: modalità di deduplica (attualmente per nome)
 *         schema:
 *           type: string
 *           enum: [global, off]
 *           default: global
 *     responses:
 *       200:
 *         description: elenco piatti comuni (deduplicati e filtrati)
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 */
router.get("/common-meals", async (req, res) => {
  try {
    const source = String(req.query.source || "all").toLowerCase();
    const dedupMode = String(req.query.dedup || "global").toLowerCase();
    const excludeMyMenu = String(req.query.excludeMyMenu || "").trim();

    // --- file: solo “comuni” dal file (no menu dei ristoranti) ---
    let fileMeals = [];
    const { filePath, exists, error } = readFileMeals();
    if (source !== "db") {
      if (error && source === "file") {
        return res.status(500).json({ error: "Unable to read common dishes file", detail: error });
      }
      fileMeals = loadCommonFromFile();
    }
    res.setHeader("X-Meals-File", filePath || "");
    res.setHeader("X-Meals-File-Exists", String(!!exists));
    res.setHeader("X-Meals-File-Count", String(fileMeals.length));

    // --- DB: prendi solo candidati “comuni” ed escludi sempre quelli con restaurantId ---
    let dbMeals = [];
    if (source !== "file" && mongoReady()) {
      const base = {
        $or: [
          { isCommon: true },
          { origine: "comune" },
          { restaurantId: { $exists: false } },
          { restaurantId: null },
          { restaurantId: "" },
        ],
      };
      dbMeals = await Meal.find(base).lean();
      dbMeals = dbMeals
        .filter((m) => !m.restaurantId) // sicurezza: niente piatti dei ristoranti
        .map(withIngredients);
      res.setHeader("X-Meals-DB-Count", String(dbMeals.length));
    } else if (source === "db" && !mongoReady()) {
      return res.status(503).json({ error: "Database not connected" });
    }

    // --- merge e deduplica ---
    let merged = [...dbMeals, ...fileMeals];
    if (dedupMode !== "off") merged = dedupeByName(merged);

    // --- escludi piatti già nel mio menu (per nome) ---
    if (excludeMyMenu) {
      let myNames = new Set();
      if (mongoReady()) {
        const mine = await Meal.find({ restaurantId: excludeMyMenu })
          .select("nome name strMeal")
          .lean();
        myNames = new Set(mine.map((x) => nameOf(x)));
      } else {
        // fallback file: cerca nel formato annidato
        const { data } = readFileMeals();
        if (Array.isArray(data)) {
          for (const r of data) {
            const rid = r?.restaurantId ?? r?.id ?? r?._id;
            if (String(rid) === String(excludeMyMenu)) {
              const menu = Array.isArray(r.menu) ? r.menu : [];
              myNames = new Set(menu.map((x) => nameOf(x)));
              break;
            }
          }
        }
      }
      merged = merged.filter((m) => !myNames.has(nameOf(m)));
    }

    // ordinamento per nome
    merged.sort((a, b) => nameOf(a).localeCompare(nameOf(b)));

    return res.json(merged);
  } catch (err) {
    console.error("Errore /meals/common-meals:", err);
    return res
      .status(500)
      .json({ error: "Error in reading common dishes", detail: String(err?.message || err) });
  }
});

/**
 * @swagger
 * /meals:
 *   post:
 *     tags: [Meals]
 *     summary: crea un nuovo piatto (DB, fallback su file)
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [restaurantId, nome]
 *             properties:
 *               restaurantId: { oneOf: [{type: string},{type: number}] }
 *               nome: { type: string, description: "Alias supportati: name, strMeal" }
 *               tipologia: { type: string, description: "Alias: category, strCategory" }
 *               prezzo: { type: number }
 *               foto: { type: string, description: "Alias: image, strMealThumb" }
 *               ingredients:
 *                 type: array
 *                 items: { type: string }
 *               isCommon: { type: boolean }
 *               origine: { type: string }
 *     responses:
 *       201:
 *         description: Piatto creato
 *       400:
 *         description: Richiesta non valida
 *       503:
 *         description: Database non connesso (se richiesto)
 */
router.post("/", async (req, res) => {
  try {
    const b = req.body || {};
    if (!b.restaurantId) {
      return res.status(400).json({ error: "RestaurantId missing" });
    }

    const ingrArr = normalizeIngredients(b)
      .filter(Boolean)
      .map((x) => String(x).trim())
      .filter(Boolean);
    const ingrStr = ingrArr.join(", ");

    const newMeal = { //oggetto nuovo piatto 
      restaurantId: b.restaurantId,
      nome: b.nome || b.name || b.strMeal || "Senza nome",
      tipologia: b.tipologia || b.category || b.strCategory || "Altro",
      prezzo: Number(b.prezzo ?? 0),
      foto: b.foto || b.image || b.strMealThumb || "",
      ingredienti: ingrArr,
      ingredients: ingrArr.slice(),
      ingredient: ingrStr,
      origine: b.origine || "personalizzato",
      isCommon: typeof b.isCommon === "boolean" ? b.isCommon : b.origine === "comune",
    };

    for (let i = 1; i <= 20; i++) { // pulisce da campi inutili 
      delete newMeal[`strIngredient${i}`];
      delete newMeal[`strMeasure${i}`];
    }

    if (mongoReady()) { // inserisce nel database
      if (newMeal.idmeals == null) {
        const maxDoc = await Meal.findOne({ idmeals: { $ne: null } })
          .sort({ idmeals: -1 })
          .select("idmeals")
          .lean()
          .catch(() => null);
        const maxId = Number(maxDoc?.idmeals) || 0;
        newMeal.idmeals = maxId + 1;
      }
      newMeal.idmeals = Number(newMeal.idmeals);

      const created = await Meal.create(newMeal);
      return res.status(201).json(created);
    }

    // fallback file
    const { data, filePath } = readFileMeals();
    const restaurants = Array.isArray(data) ? data : [];

    let rest = restaurants.find((r) => String(r.restaurantId) === String(newMeal.restaurantId));
    if (!rest) {
      rest = { restaurantId: newMeal.restaurantId, menu: [] };
      restaurants.push(rest);
    }
    if (!Array.isArray(rest.menu)) rest.menu = [];

    const allMeals = restaurants.flatMap((r) => (Array.isArray(r.menu) ? r.menu : []));
    const maxId = allMeals.reduce((acc, m) => Math.max(acc, Number(m.idmeals || 0)), 0);
    newMeal.idmeals = maxId + 1;

    rest.menu.push(newMeal);
    writeFileMeals(restaurants, filePath);

    return res.status(201).json(newMeal);
  } catch (err) {
    console.error("POST /meals error:", err);
    return res.status(500).json({ error: "Error saving dish", detail: String(err?.message || err) });
  }
});

/**
 * @swagger
 * /meals/{id}:
 *   put:
 *     tags: [Meals]
 *     summary: aggiorna un piatto per ID (ObjectId o idmeals numerico)
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { type: object }
 *     responses:
 *       200: { description: Piatto aggiornato }
 *       404: { description: Piatto non trovato }
 */
router.put("/:id", async (req, res) => {
  try {
    const raw = String(req.params.id);
    const update = pickUpdatableFields(req.body);

    // DB
    if (mongoReady()) {
      if (isHex24(raw)) {
        const doc = await Meal.findByIdAndUpdate(raw, update, { new: true }).lean();
        if (doc) return res.json(withIngredients(doc));
      }
      const idNum = Number(raw);
      if (Number.isFinite(idNum)) {
        const doc = await Meal.findOneAndUpdate({ idmeals: idNum }, update, { new: true }).lean();
        if (doc) return res.json(withIngredients(doc));
      }
    }

    // file (solo id numerico)
    const idNum = Number(raw);
    if (!Number.isFinite(idNum)) {
      return res.status(400).json({ error: "Id not valid" });
    }

    const { data, filePath } = readFileMeals();
    const restaurants = Array.isArray(data) ? data : [];

    for (const r of restaurants) {
      if (!Array.isArray(r.menu)) continue;
      const idx = r.menu.findIndex((m) => Number(m.idmeals) === idNum);
      if (idx >= 0) {
        const merged = { ...r.menu[idx], ...update, idmeals: idNum };
        r.menu[idx] = withIngredients(merged);
        writeFileMeals(restaurants, filePath);
        return res.json(r.menu[idx]);
      }
    }
    return res.status(404).json({ error: "Dish not found" });
  } catch (err) {
    console.error("PUT /meals/:id error:", err);
    return res.status(500).json({ error: "Error updating dish", detail: String(err?.message || err) });
  }
});

/**
 * @swagger
 * /meals/{id}:
 *   get:
 *     tags: [Meals]
 *     summary: ottiene un piatto per ID (ObjectId o idmeals numerico)
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Piatto trovato }
 *       404: { description: Piatto non trovato }
 */
router.get("/:id", async (req, res) => {
  try {
    const raw = String(req.params.id);

    // DB
    if (mongoReady()) {
      if (isHex24(raw)) {
        const doc = await Meal.findById(raw).lean();
        if (doc) return res.json(withIngredients(doc));
      }
      const idNum = Number(raw);
      if (Number.isFinite(idNum)) {
        const doc = await Meal.findOne({ idmeals: idNum }).lean();
        if (doc) return res.json(withIngredients(doc));
      }
    }

    // file
    const idNum = Number(raw);
    if (!Number.isFinite(idNum)) {
      return res.status(400).json({ error: "Id not valid" });
    }

    const { data } = readFileMeals();
    for (const r of Array.isArray(data) ? data : []) {
      const meal = (r.menu || []).find((m) => Number(m.idmeals) === idNum);
      if (meal) return res.json(withIngredients(meal));
    }
    return res.status(404).json({ error: "Dish not found" });
  } catch (err) {
    console.error("GET /meals/:id error:", err);
    return res.status(500).json({ error: "Error loading dish", detail: String(err?.message || err) });
  }
});

/**
 * @swagger
 * /meals/{id}:
 *   delete:
 *     tags: [Meals]
 *     summary: elimina un piatto (ObjectId o idmeals numerico)
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Piatto eliminato }
 *       404: { description: Piatto non trovato }
 */
router.delete("/:id", async (req, res) => {
  try {
    const raw = String(req.params.id);

    // db
    if (mongoReady()) {
      if (isHex24(raw)) {
        const del = await Meal.deleteOne({ _id: raw });
        if (del.deletedCount > 0) return res.json({ ok: true, deleted: 1 });
      }
      const n = Number(raw);
      if (Number.isFinite(n)) {
        const del = await Meal.deleteOne({ idmeals: n });
        if (del.deletedCount > 0) return res.json({ ok: true, deleted: 1 });
      }
    }

    // file
    const id = Number(raw);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ error: "Id not valid" });
    }

    const { data, filePath } = readFileMeals();
    const restaurants = Array.isArray(data) ? data : [];

    let removed = 0;
    for (const r of restaurants) {
      if (!Array.isArray(r.menu)) continue;
      const idx = r.menu.findIndex((m) => Number(m.idmeals) === id);
      if (idx >= 0) {
        r.menu.splice(idx, 1);
        removed = 1;
        break;
      }
    }

    if (removed) {
      writeFileMeals(restaurants, filePath);
      return res.json({ ok: true, deleted: 1 });
    } else {
      return res.status(404).json({ error: "Dish not found" });
    }
  } catch (err) {
    console.error("DELETE /meals/:id error:", err);
    return res
      .status(500)
      .json({ error: "Error during deleting dish", detail: String(err?.message || err) });
  }
});

/**
 * @swagger
 * /meals/{restaurantId}/{id}:
 *   delete:
 *     tags: [Meals]
 *     summary: elimina un piatto specificando anche il restaurantId (compatibilità menu annidato)
 *     parameters:
 *       - in: path
 *         name: restaurantId
 *         required: true
 *         schema: { type: string }
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Piatto eliminato }
 *       404: { description: Piatto/ristorante non trovato }
 */
router.delete("/:restaurantId/:id", async (req, res) => {
  try {
    const rid = String(req.params.restaurantId);
    const raw = String(req.params.id);

    if (mongoReady()) {
      if (isHex24(raw)) {
        const del = await Meal.deleteOne({ _id: raw, restaurantId: rid });
        if (del.deletedCount > 0) return res.json({ ok: true, deleted: 1 });
      }
      const n = Number(raw);
      if (Number.isFinite(n)) {
        const del = await Meal.deleteOne({ restaurantId: rid, idmeals: n });
        if (del.deletedCount > 0) return res.json({ ok: true, deleted: 1 });
      }
    }

    // file (id numerico)
    const id = Number(raw);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ error: "Id not valid" });
    }

    const { data, filePath } = readFileMeals();
    const restaurants = Array.isArray(data) ? data : [];
    const rest = restaurants.find((r) => String(r.restaurantId) === rid);
    if (!rest || !Array.isArray(rest.menu)) {
      return res.status(404).json({ error: "Restaurant or menu not found" });
    }
    const idx = rest.menu.findIndex((m) => Number(m.idmeals) === id);
    if (idx < 0) return res.status(404).json({ error: "Dish not found" });

    rest.menu.splice(idx, 1);
    writeFileMeals(restaurants, filePath);
    return res.json({ ok: true, deleted: 1 });
  } catch (err) {
    console.error("DELETE /meals/:restaurantId/:id error:", err);
    return res
      .status(500)
      .json({ error: "Error during deleting dish", detail: String(err?.message || err) });
  }
});

/**
 * @swagger 
 * /meals:
 *   get:
 *     tags: [Meals]
 *     summary: restituisce i menu per ristorante (DB, fallback su file)
 *     parameters:
 *       - in: query
 *         name: restaurantId
 *         schema: { type: string }
 *         description: Se presente, filtra per ristorante
 *     responses:
 *       200:
 *         description: array di ristoranti con il rispettivo menu
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   restaurantId: { type: string }
 *                   menu:
 *                     type: array
 *                     items: { type: object }
 */
router.get("/", async (req, res) => {
  try {
    const wantedRid = req.query.restaurantId ? String(req.query.restaurantId) : null;

    // db
    if (mongoReady()) {
      const query = wantedRid ? { restaurantId: wantedRid } : {};
      const docs = await Meal.find(query).lean();
      const meals = docs.map(withIngredients);

      const byRid = {};
      for (const m of meals) {
        const rid = String(m.restaurantId || "");
        if (!byRid[rid]) byRid[rid] = { restaurantId: rid, menu: [] };
        byRid[rid].menu.push(m);
      }
      return res.json(Object.values(byRid));
    }

    // file
    const { data } = readFileMeals();

    if (Array.isArray(data) && data.length && (data[0].menu || data[0].restaurantId)) {
      const shaped = data.map((r) => ({
        restaurantId: r.restaurantId ?? r.id ?? r._id ?? "",
        menu: Array.isArray(r.menu) ? r.menu.map(withIngredients) : [],
      }));
      return res.json(wantedRid ? shaped.filter((r) => String(r.restaurantId) === wantedRid) : shaped);
    }

    const flat = flattenFileMeals(data).map(withIngredients);
    const byRid = {};
    for (const m of flat) {
      const rid = String(m.restaurantId || "");
      if (wantedRid && rid !== wantedRid) continue;
      if (!byRid[rid]) byRid[rid] = { restaurantId: rid, menu: [] };
      byRid[rid].menu.push(m);
    }
    return res.json(Object.values(byRid));
  } catch (err) {
    console.error("GET /meals error:", err);
    res
      .status(500)
      .json({ error: "Error during the loading of the menu", detail: String(err?.message || err) });
  }
});

module.exports = router;
