// ========= base url per API =========
const isLocal  = ["localhost", "127.0.0.1"].includes(location.hostname);
const API_BASE = isLocal ? "http://localhost:3000"
                         : "https://restaurant-management-wzhj.onrender.com";

/* ========= fetch helper robusto =========
   - legge come testo
   - controlla content-type
   - tenta json.parse solo se ha senso
   - errori sempre parlanti (no "Unexpected token '<'")
*/
async function apiGet(path) {
  const url  = `${API_BASE}${path}`;
  const ctrl = new AbortController();
  const t    = setTimeout(() => ctrl.abort(), 12000);
  try {
    const res   = await fetch(url, { signal: ctrl.signal, mode: "cors" });
    const ctype = (res.headers.get("content-type") || "").toLowerCase();
    const text  = await res.text(); // sempre testo

    if (!res.ok) {
      // mostra un pezzetto del body (spesso HTML 404)
      const snip = text?.slice(0, 120)?.replace(/\s+/g, " ");
      throw new Error(`HTTP ${res.status} ${res.statusText} – ${snip || "no body"}`);
    }

    // prova a capire se è json
    if (ctype.includes("application/json") || (text && text.trim().startsWith("{")) || (text && text.trim().startsWith("["))) {
      try { return JSON.parse(text); }
      catch {
        throw new Error(`Invalid JSON from ${path}: ${text.slice(0, 80)}…`);
      }
    }

    // risposta 200 ma non json 
    throw new Error(`Unexpected content-type for ${path}: ${ctype || "unknown"}`);
  } finally {
    clearTimeout(t);
  }
}

// ========= utils =========
const money     = n => `€${Number(n || 0).toFixed(2)}`;
const when      = d => { try { return new Date(d).toLocaleString(); } catch { return ""; } };
const normId    = o => o?.id ?? o?._id ?? "";
const normState = o => String(o?.status ?? o?.state ?? o?.stato ?? "ordinato").toLowerCase();

const labelStatus = s => {
  const t = String(s || "").toLowerCase();
  const map = {
    ordinato: "Ordered", preparazione: "Preparing", consegna: "Ready for pickup",
    consegnato: "Delivered", ritirato: "Picked up", annullato: "Canceled",
    withdrawn: "Picked up", delivered: "Delivered", canceled: "Canceled", cancelled: "Canceled"
  };
  return map[t] || (s || "Unknown");
};
const FINAL = new Set(["consegnato","ritirato","annullato","delivered","withdrawn","canceled","cancelled"]);
// si occupa di normalizzare lo stato del ordine  in un formato unico
// ========= meals map =========
function buildMealsMap(rawMeals) {
  const map = new Map();
  const isDish = r => (r?.idmeals || r?.id || r?._id || r?.idMeal);
  const allDishes = Array.isArray(rawMeals)
    ? rawMeals.flatMap(r => Array.isArray(r?.menu) ? r.menu : (isDish(r) ? [r] : []))
    : [];
  for (const p of allDishes) {
    const id = p.idmeals ?? p.idMeal ?? p.id ?? p._id;
    if (id == null) continue;
    const key = String(id);
    const nome = p.nome ?? p.strMeal ?? p.name ?? `Dish #${key}`;
    let prezzo = p.prezzo ?? p.price;
    if (typeof prezzo === "string") prezzo = Number(prezzo);
    map.set(key, { nome, prezzo: Number.isFinite(prezzo) ? Number(prezzo) : 0 });
  }
  return map;
}
//la funzione ha il compito di costruire una mappa che verrà poi usata 
// ========= helpers item/price =========
const getQty  = it => Number(it?.qty ?? it?.quantity ?? it?.quantita ?? it?.q ?? 1) || 1;
const getItemId = it => it?.mealId ?? it?.idmeal ?? it?.idmeals ?? it?.idMeal ?? it?.id ?? it?._id;
const getItemNameFromSnapshot = it => (it?.name ?? it?.nome ?? it?.strMeal) || "";

function extractIdsFromMeals(meals) {
  if (!Array.isArray(meals)) return [];
  return meals.map(m => (typeof m === "object" && m !== null) ? getItemId(m) : m);
}
function firstNumber(...vals){ for(const v of vals){ const n=Number(v); if(Number.isFinite(n)) return n; } return NaN; }
function getLineTotal(it){ return firstNumber(it?.lineTotal,it?.line_total,it?.total,it?.totale,it?.subtotal,it?.importoTotale,it?.amount_total); }
function getOrderSnapshotTotal(ord){ return firstNumber(ord?.total,ord?.totale,ord?.grandTotal,ord?.amount_total,ord?.subtotal,ord?.importoTotale); }
function getUnitPrice(it, cat){
  const fromItem = firstNumber(it?.prezzo,it?.price,it?.unitPrice,it?.prezzoUnitario,it?.costo,it?.cost,it?.amount,it?.importo,it?.unit_amount);
  if (Number.isFinite(fromItem) && fromItem>0) return fromItem;
  const qty=getQty(it), line=getLineTotal(it);
  if (qty>0 && Number.isFinite(line) && line>0) return line/qty;
  const fromCatalog=Number(cat?.prezzo);
  if (Number.isFinite(fromCatalog) && fromCatalog>0) return fromCatalog;
  return 0;
}
// estrazione degli id partendo dai piatti 
// ========= items =========
function renderItemsAndTotal(order, mealsMap) {
  let total = 0; let rows = [];
  const mealsIdsByIndex = extractIdsFromMeals(order.meals);
  const pushRow = (name, qty, unit, lineMaybe) => {
    const line = Number.isFinite(lineMaybe) && lineMaybe > 0 ? lineMaybe : unit * qty;
    total += line;
    rows.push(`<li>${name} &times;${qty} — <span class="muted">unit</span> ${money(unit)} <strong>→ ${money(line)}</strong></li>`);
  };

  if (Array.isArray(order.items) && order.items.length) {
    order.items.forEach((it, idx) => {
      const id  = getItemId(it) ?? mealsIdsByIndex[idx];
      const cat = id != null ? mealsMap.get(String(id)) : null;
      let name  = getItemNameFromSnapshot(it);
      if (!name || ["senza nome","unnamed","dish","piatto"].includes(String(name).trim().toLowerCase()))
        name = cat?.nome || (id != null ? `Dish #${id}` : "Dish");
      const qty=getQty(it), unit=getUnitPrice(it, cat), lineT=getLineTotal(it);
      pushRow(name, qty, unit, lineT);
    });
  } else if (Array.isArray(order.meals) && order.meals.length) {
    order.meals.forEach(m => {
      const id  = (typeof m === "object") ? getItemId(m) : m;
      const qty = (typeof m === "object") ? getQty(m) : 1;
      const cat = id != null ? mealsMap.get(String(id)) : null;
      const name  = cat?.nome || (id != null ? `Dish #${id}` : "Dish");
      const unit  = getUnitPrice(m, cat);
      const lineT = getLineTotal(m);
      pushRow(name, qty, unit, lineT);
    });
  } else {
    const snap = getOrderSnapshotTotal(order);
    if (Number.isFinite(snap) && snap > 0) {
      total = snap;
      rows = [`<li class="muted">(order total provided by backend)</li>`];
    } else {
      return { html: `<ul class="dishes"><li class="muted">—</li></ul>`, total: Number(order.total) || 0 };
    }
  }
  //questo pezzo e utile visualizzare i piatti ed i toale speso dal client 
  const snap = getOrderSnapshotTotal(order);
  if (Number.isFinite(snap) && snap > 0) total = snap;
  return { html: `<ul class="dishes">${rows.join("")}</ul>`, total };
}

/* ====== fallback anti-404 per orders ====== */
async function fetchOrdersWithFallback(username) {
  const qs = username ? `?username=${encodeURIComponent(username)}` : "";
  const candidates = [
    `/orders${qs}`,
    `/api/orders${qs}`,
    `/api/v1/orders${qs}`,
    username ? `/orders/user/${encodeURIComponent(username)}` : null,
    `/order${qs}`,
    `/api/order${qs}`
  ].filter(Boolean);

  let lastErr = null;
  for (const p of candidates) {
    try {
      const data = await apiGet(p);
      if (Array.isArray(data)) return data;
      if (data && typeof data === "object") {
        if (Array.isArray(data.orders)) return data.orders;
        if (Array.isArray(data.active) || Array.isArray(data.completed)) {
          const a = Array.isArray(data.active) ? data.active : [];
          const c = Array.isArray(data.completed) ? data.completed : [];
          return [...a, ...c];
        }
      }
      lastErr = new Error(`unexpected payload from ${p}`);
    } catch (e) {
      lastErr = e;
    }
  }
  console.warn("[orders] fallback: endpoint  not valid. last error:", lastErr?.message);
  return []; // non lanciare, così la pagina resta viva
}
// questo pezzo è utile per il ricoveri da un evetuale errore 404 ed per pescare gli ordini

/* ============ bootstrap pagina ============ */
window.onload = async () => {
  let user = null;
  try { user = JSON.parse(localStorage.getItem("loggedUser") || "null"); } catch {}
  if (!user || user.role !== "cliente") {
    alert("Access reserved for customers");
    window.location.href = "login.html";
    return;
  }

  const attiviList  = document.getElementById("attivi-list");
  const passatiList = document.getElementById("passati-list");
  const setLoading  = msg => {
    attiviList.innerHTML  = `<li>${msg}</li>`;
    passatiList.innerHTML = `<li>${msg}</li>`;
  };
  setLoading("Loading orders...");

  // carica ordini (con fallback) e meals (tollerante agli errori)
  const ordersArr = await fetchOrdersWithFallback(user.username);
  let mealsRaw = [];
  try { mealsRaw = await apiGet(`/meals`); }
  catch (e) { console.warn("[meals] fallback a catalogo vuoto:", e?.message); }

  const mealsMap = buildMealsMap(mealsRaw);
  const safeOrders = Array.isArray(ordersArr) ? ordersArr : [];

  if (safeOrders.length === 0) {
    attiviList.innerHTML  = "<li>No orders.</li>";
    passatiList.innerHTML = "<li>No completed orders.</li>";
    return;
  }

  const attivi  = safeOrders.filter(o => !FINAL.has(normState(o)));
  const passati = safeOrders.filter(o =>  FINAL.has(normState(o)));

  const render = (ordini, container) => {
    if (!ordini.length) {
      container.innerHTML = "<li>-- No orders --</li>";
      return;
    }
    ordini.sort((a,b) => new Date(b.createdAt||0) - new Date(a.createdAt||0));

    container.innerHTML = ordini.map(o => {
      const stato   = normState(o);
      const { html, total } = renderItemsAndTotal(o, mealsMap);

      const created  = o.createdAt ? when(o.createdAt) : "n/a";
      const closedAt = o.closedAt || o.deliveredAt || o.ritiratoAt || o.consegnatoAt;
      const closed   = closedAt ? when(closedAt) : "—";
      const delivery = "Pickup at restaurant";

      const orderTotal = Number(getOrderSnapshotTotal(o)) || total;

      return `
        <li>
          <strong>ID:</strong> ${normId(o)}<br>
          Created: ${created}${FINAL.has(stato) ? ` · Closed: ${closed}` : ""}<br>
          Status: ${labelStatus(stato)}<br>
          Dishes: ${html}
          Total: <strong>${money(orderTotal)}</strong><br>
          ${delivery}
        </li>
      `;
    }).join("");
  };

  render(attivi, attiviList);
  render(passati, passatiList);
};
// questa invece è il cosidetto bootstrap cioè da dove parte tutto effettua tutti i caricamenti
// dei dati che sono richesti gestisce eventuali errori anche
