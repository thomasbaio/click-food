// =========================
// configurazione API base
// =========================
const isLocal = ["localhost", "127.0.0.1"].includes(location.hostname);
const API_BASE = isLocal ? "http://localhost:3000" : location.origin;

// =========================
// helpers immagini
// =========================
function isValidImgPath(s) {
  if (typeof s !== "string") return false;
  const t = s.trim();
  if (!t || t === "-" || t === "#") return false;
  return /^https?:\/\//i.test(t) || t.startsWith("//") || t.startsWith("/");
}

function firstImage(p) {
  const src = p || {};
  const raw = src._raw || src.raw || {};
  const candidates = [
    src.immagine, src.foto, src.strMealThumb, src.image, src.thumb, src.picture, src.img,
    raw.immagine, raw.foto, raw.strMealThumb, raw.image, raw.thumb, raw.picture, raw.img,
  ];
  for (let u of candidates) {
    if (!isValidImgPath(u)) continue;
    u = String(u).trim();
    if (u.startsWith("//")) return "https:" + u;
    return u;
  }
  return "";
}

function pickImageURL(p) {
  const u = firstImage(p);
  if (isValidImgPath(u)) {
    if (u.startsWith("/")) return `${location.origin}${u}`;
    return u;
  }
  const label = encodeURIComponent((p.nome || "Food").split(" ")[0]);
  return `https://placehold.co/90x90?text=${label}`;
}
//questo pezzo di codice verifica che immagine sia valida poi normalizzata poi viene presa giusto?
// =========================
// normalizzazione e chiavi
// =========================
function normalizeRestaurant(r) {
  const id = r.restaurantId ?? r.id ?? r._id ?? r.ownerUserId ?? null;
  const nome = r.nomeRistorante ?? r.nome ?? r.name ?? r.restaurantName ?? "";
  const luogo = r.luogo ?? r.citta ?? r.location ?? r.city ?? "";
  const indirizzo = r.indirizzo ?? r.address ?? "";
  const telefono = r.telefono ?? r.phone ?? r.phoneNumber ?? "";
  const menu = Array.isArray(r.menu) ? r.menu : [];
  return { id, nome, luogo, indirizzo, telefono, menu, _raw: r };
}

function normalizeMeal(m, restaurantIdFallback) {
  let id = m.idmeals ?? m.idMeal ?? m.id;
  if (!id && typeof m._id === "string") id = m._id;

  const nome = m.nome ?? m.strMeal ?? m.name ?? "No name";
  const tipologia = m.tipologia ?? m.strCategory ?? m.category ?? "";
  const prezzoRaw = m.prezzo ?? m.price ?? m.cost ?? null;
  const prezzo = (prezzoRaw !== null && !isNaN(Number(prezzoRaw))) ? Number(prezzoRaw) : undefined;
  const descrizione = m.descrizione ?? m.description ?? m.desc ?? m.details ?? m.strInstructions ?? "";

  let ingredienti = [];
  if (Array.isArray(m.ingredienti)) {
    ingredienti = m.ingredienti.filter(Boolean);
  } else if (Array.isArray(m.ingredients)) {
    ingredienti = m.ingredients.filter(Boolean);
  } else {
    const list = [];
    for (let i = 1; i <= 20; i++) {
      const ing = m[`strIngredient${i}`];
      const qty = m[`strMeasure${i}`];
      if (ing && String(ing).trim()) {
        list.push(qty ? `${String(ing).trim()} (${String(qty).trim()})` : String(ing).trim());
      }
    }
    ingredienti = list;
  }

  const immagine = firstImage({ ...m, _raw: m });
  const restaurantId = m.restaurantId ?? restaurantIdFallback ?? null;

  return { _raw: m, id, nome, tipologia, prezzo, descrizione, ingredienti, immagine, restaurantId };
}

function normalizeKey(nome, cat) {
  const strip = (s) =>
    String(s || "")
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .toLowerCase().trim().replace(/\s+/g, " ");
  return `${strip(nome)}|${strip(cat)}`;
}
// invece questo pezzio di codice normalizza il ristorante la scrittura in modo unico 
//normalizza anche la struttura dati del piatto prendede immagine ed infine normalizza la chiave
// =========================
/* utilità semplici */
// =========================
const money = (n) => `€${Number(n || 0).toFixed(2)}`;

function includesCI(hay, needle) {
  if (!needle) return true;
  if (!hay) return false;
  return String(hay).toLowerCase().includes(String(needle).toLowerCase());
}

// =========================
// mappe ausiliarie (API)
// =========================
async function buildCommonMealMap() {
  try {
    const r = await fetch(`${API_BASE}/meals/common-meals?source=file`, { mode: "cors" });
    if (!r.ok) throw new Error(r.status);
    const list = await r.json();
    const map = new Map();
    for (const m of Array.isArray(list) ? list : []) {
      const key = normalizeKey(m.nome ?? m.strMeal ?? m.name ?? "", m.tipologia ?? m.strCategory ?? m.category ?? "");
      const img = firstImage(m);
      const desc = m.descrizione ?? m.description ?? m.desc ?? m.details ?? m.strInstructions ?? "";
      if (!map.has(key)) map.set(key, { img, desc });
    }
    return map;
  } catch {
    return new Map();
  }
}

async function buildRestaurantUsersMap() {
  try {
    const r = await fetch(`${API_BASE}/users/restaurants`, { mode: "cors" });
    if (!r.ok) return new Map();
    const arr = await r.json();
    const map = new Map();
    for (const u of Array.isArray(arr) ? arr : []) {
      const id = String(u.restaurantId ?? u.id ?? u._id ?? "");
      map.set(id, {
        nome: u.nome ?? u.name ?? "",
        luogo: u.luogo ?? u.location ?? u.city ?? "",
        indirizzo: u.indirizzo ?? u.address ?? "",
        telefono: u.telefono ?? u.phone ?? u.phoneNumber ?? "",
      });
    }
    return map;
  } catch {
    return new Map();
  }
}

function applyFallbackFromMap(piatto, map) {
  const key = normalizeKey(piatto.nome, piatto.tipologia);
  const hit = map.get(key);
  if (!hit) return piatto;
  if (!isValidImgPath(piatto.immagine)) piatto.immagine = hit.img || piatto.immagine;
  if (!piatto.descrizione && hit.desc) piatto.descrizione = hit.desc;
  return piatto;
}

function enrichRestaurantWithUsersMap(r, map) {
  const info = map.get(String(r.id || ""));
  if (!info) return r;
  return {
    ...r,
    nome: r.nome || info.nome,
    luogo: r.luogo || info.luogo,
    indirizzo: r.indirizzo || info.indirizzo,
    telefono: r.telefono || info.telefono,
  };
}
// invece in questo pezzo di codice come prima funzione costruisce una maappa per i piatti poi ne
//costruisce un altra per i ristoranti poi con la funzione successiava utilizza la mappa ed il piatto
//per risalire al piatto ed con la funzione ancora successiava applica la mappa per rialire al ristorante 

// =========================
// ruolo e azioni
// =========================
function getLoggedUser() {
  try { return JSON.parse(localStorage.getItem("loggedUser")) || null; }
  catch { return null; }
}

// cancellazione solo per ristoratore del proprio ristorante
async function handleDeleteAsRestaurant(piatto) {
  const user = getLoggedUser();
  if (!user || user.role !== "ristoratore") {
    alert("only restaurateurs can delete dishes.");
    return;
  }
  if (!piatto.restaurantId || String(piatto.restaurantId) !== String(user.restaurantId || "")) {
    alert("you can delete only dishes from your own restaurant.");
    return;
  }
  if (!confirm(`delete dish "${piatto.nome}"? this action cannot be undone.`)) return;

  try {
    const res = await fetch(`${API_BASE}/meals/${encodeURIComponent(piatto.id)}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" }
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(`HTTP ${res.status} ${res.statusText}${txt ? " – " + txt : ""}`);
    }
    window.cercaPiatti();
  } catch (err) {
    console.error("delete error:", err);
    alert("error deleting the dish: " + err.message);
  }
}
//questa fuzioni per mettono al ristoratore di cercare il piatto ed eliminarlo solo loro posso toglirlo 
// dal loro menù
// =========================
// rendering
// =========================
function mealCardHTML(piatto, risto) {
  const imgSrc = pickImageURL(piatto);
  const priceHTML = (typeof piatto.prezzo === "number" && isFinite(piatto.prezzo))
    ? `<div><strong>Price:</strong> ${money(piatto.prezzo)}</div>` : "";
  const tipoHTML = piatto.tipologia ? `<div><strong>Type:</strong> <em>${piatto.tipologia}</em></div>` : "";
  const ingHTML = (piatto.ingredienti && piatto.ingredienti.length)
    ? `<div><strong>Ingredients:</strong> ${piatto.ingredienti.join(", ")}</div>` : "";
  const descHTML = piatto.descrizione ? `<div class="muted" style="margin-top:4px;">${piatto.descrizione}</div>` : "";

  // azioni condizionate dal ruolo
  const user = getLoggedUser();
  const role = user?.role;
  const delBtn = role === "ristoratore"
    ? `<button class="btn danger" data-act="delete" data-id="${piatto.id}">Delete</button>` : "";
  const actions = delBtn
    ? `<div class="actions" style="margin-top:8px; display:flex; gap:8px;">${delBtn}</div>` : "";

  return `
    <div style="display:flex; gap:12px; align-items:flex-start;">
      <img src="${imgSrc}" alt="${piatto.nome}" style="width:90px;height:90px;object-fit:cover;border-radius:8px;" referrerpolicy="no-referrer" loading="lazy">
      <div style="flex:1; min-width:0;">
        <div style="font-weight:700;">${piatto.nome}</div>
        ${tipoHTML}
        ${priceHTML}
        ${ingHTML}
        ${descHTML}
        ${actions}
      </div>
    </div>
  `;
}

function renderGroupedByRestaurant(items, targetUL) {
  const groups = new Map();
  for (const it of items) {
    const rid = String(it.risto.id || "");
    if (!groups.has(rid)) groups.set(rid, { risto: it.risto, items: [] });
    groups.get(rid).items.push(it.piatto);
  }

  const ordered = [...groups.values()].sort((a, b) =>
    (a.risto.nome || "").localeCompare(b.risto.nome || "")
  );

  targetUL.innerHTML = "";
  for (const g of ordered) {
    const liHeader = document.createElement("li");
    liHeader.style.listStyle = "none";
    liHeader.style.margin = "12px 0 6px";
    liHeader.innerHTML = `
      <div class="box" style="border-radius:10px; padding:8px 10px; border:1px solid #e4e4e4;">
        <strong>${g.risto.nome || "Restaurant"}</strong>
        <div class="muted" style="margin-top:2px;">
          ${[g.risto.indirizzo, g.risto.luogo].filter(Boolean).join(", ") || "—"}
          ${g.risto.telefono ? ` • ${g.risto.telefono}` : ""}
        </div>
      </div>
    `;
    targetUL.appendChild(liHeader);

    for (const p of g.items) {
      const li = document.createElement("li");
      li.style.margin = "10px 0 18px";
      li.style.listStyle = "disc";
      li.innerHTML = mealCardHTML(p, g.risto);
      targetUL.appendChild(li);
    }
  }
}
//la prima funzione è usata per prendere immagine il prezzo la tipologia ed gli ingredineti poi viè
// un pulsate che può essere usato solo dal ristorante cioè la delete dopo viè il rendering della 
// immagine dopo la funzione succcesiova mostra render del ristorante che fa il piatto 
// =========================
/* main search */
// =========================
let __ricercaPiattiIndex = new Map();

window.cercaPiatti = async function () {
  const ul = document.getElementById("risultati-piatti");
  if (!ul) return;
  ul.innerHTML = "<li>Searching...</li>";

  const qNome = (document.getElementById("nome")?.value || "").trim();
  const qTipo = (document.getElementById("tipologia")?.value || "").trim();
  const qPMstr = (document.getElementById("prezzo")?.value || "").trim();
  const qPM = qPMstr ? Number(qPMstr) : null;

  try {
    const [mealsRes, commonMap, usersMap] = await Promise.all([
      fetch(`${API_BASE}/meals`, { mode: "cors" }),
      buildCommonMealMap(),
      buildRestaurantUsersMap(),
    ]);
    if (!mealsRes.ok)
      throw new Error(`HTTP ${mealsRes.status} ${mealsRes.statusText}`);

    const data = await mealsRes.json();

    const ristoranti = (Array.isArray(data) ? data : [])
      .map(normalizeRestaurant)
      .map((r) => enrichRestaurantWithUsersMap(r, usersMap));

    const all = [];
    for (const r of ristoranti) {
      for (const m of r.menu) {
        const p = normalizeMeal(m, r.id);
        applyFallbackFromMap(p, commonMap);
        all.push({ piatto: p, risto: r });
      }
    }

    const filtered = all.filter(({ piatto }) => {
      if (!includesCI(piatto.nome, qNome)) return false;
      if (!includesCI(piatto.tipologia, qTipo)) return false;
      if (
        qPM !== null &&
        typeof piatto.prezzo === "number" &&
        isFinite(piatto.prezzo) &&
        piatto.prezzo > qPM
      ) return false;
      return true;
    });

    if (!filtered.length) {
      ul.innerHTML = "<li>no dishes found.</li>";
      __ricercaPiattiIndex = new Map();
      return;
    }

    __ricercaPiattiIndex = new Map(
      filtered.map(it => [String(it.piatto.id), it])
    );

    renderGroupedByRestaurant(filtered, ul);
  } catch (err) {
    console.error("dish search error:", err);
    ul.innerHTML = `<li style="color:#b00020;">error during search. see console for details.</li>`;
  }
};
// questa è una parte fondamentale che usata per la ricerca del piatto con le tre categorie di ricerca
// che sono nome prezzo ed tipologia ovviamente chiama le funzioni per risalire ai piatti o al piatto
// e gestisce anche in caso di errore nella ricerca
// =========================
// ux + delega eventi
// =========================
document.addEventListener("DOMContentLoaded", () => {
  ["nome", "tipologia", "prezzo"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener("keydown", (e) => {
      if (e.key === "Enter") window.cercaPiatti();
    });
  });

  const ul = document.getElementById("risultati-piatti");
  if (ul) {
    ul.addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-act]");
      if (!btn) return;
      const id = btn.getAttribute("data-id");
      const act = btn.getAttribute("data-act");
      const item = __ricercaPiattiIndex.get(String(id));
      if (!item) return;

      if (act === "delete") handleDeleteAsRestaurant(item.piatto);
    });
  }
});

// questa parte usata per intercettare  al click del bottone di ricerca o di delette ed la funzione
// precedente dice abilità piatti per il nome o prer prezzo o la tipologia che compare nel campo