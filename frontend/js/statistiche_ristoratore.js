// ========================= base URL =========================
const isLocal = ["localhost", "127.0.0.1"].includes(location.hostname);
const API_BASE = isLocal
  ? "http://localhost:3000"
  : (window.API_BASE ||
     (location.origin.includes("onrender.com")
        ? "https://restaurant-management-wzhj.onrender.com"
        : location.origin));

// permetti override manuale dell’endpoint ordini se lo conosci (opzionale)
const ORDERS_ENDPOINT = window.ORDERS_ENDPOINT || null; // es: "/api/orders/restaurant"

// ========================= helpers =========================
async function fetchJSON(url, options = {}) {
  try {
    const res = await fetch(url, {
      headers: { "Content-Type": "application/json", ...(options.headers || {}) },
      mode: "cors",
      ...options
    });
    const text = await res.text().catch(() => "");
    // tenta json, altrimenti torna null (es. HTML 404)
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = null; }
    if (!res.ok) {
      // se non è ok ma è HTML o vuoto -> restituisco null e lascio il caller decidere
      return null;
    }
    return data;
  } catch {
    return null;
  }
}
// questa funzione prova a fare il fetch del file json se non riesce ritorna null
// normalizza una risposta “ordini” in array
function asOrdersArray(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return null;
  const keys = ["orders", "data", "results", "items", "list"];
  for (const k of keys) {
    if (Array.isArray(payload[k])) return payload[k];
  }
  return null;
}

// prova una lista di URL e restituisce SEMPRE un array (anche vuoto)
async function findOrders(restaurantId) {
  const qs = `restaurantId=${encodeURIComponent(restaurantId)}`;
  const base = API_BASE.replace(/\/+$/, "");

  const candidates = [];

  // 1) eventuale override manuale
  if (ORDERS_ENDPOINT) {
    const ep = ORDERS_ENDPOINT.replace(/^\//, "");
    candidates.push(`${base}/${ep}?${qs}`, `${base}/${ep}/${encodeURIComponent(restaurantId)}`);
  }

  // 2) endpoint più comuni
  candidates.push(
    `${base}/orders?${qs}`,
    `${base}/api/orders?${qs}`,
    `${base}/v1/orders?${qs}`,
    `${base}/orders/restaurant/${encodeURIComponent(restaurantId)}`,
    `${base}/api/orders/restaurant/${encodeURIComponent(restaurantId)}`,
    `${base}/v1/orders/restaurant/${encodeURIComponent(restaurantId)}`,
    // 3) fallback “tutti” (filtreremo client-side)
    `${base}/orders`,
    `${base}/api/orders`,
    `${base}/v1/orders`,
    // 4) altre varianti viste in progetti simili
    `${base}/myorders`,
    `${base}/api/myorders`,
    `${base}/order`,
    `${base}/api/order`,
    `${base}/orders/list`,
    `${base}/api/orders/list`
  );
  // questi son gli endpoint più comuni dove ricavare i dati

  for (const u of candidates) {
    const raw = await fetchJSON(u);
    const arr = asOrdersArray(raw);
    if (arr) {
      console.info("[STATISTICHE] trovato endpoint ordini:", u);
      return { url: u, orders: arr };
    }
    // se la risposta è un array “puro”
    if (Array.isArray(raw)) {
      console.info("[STATISTICHE] trovato endpoint ordini (array):", u);
      return { url: u, orders: raw };
    }
  }
 

  // nessun endpoint trovato → ritorna array vuoto (niente errori in console)
  return { url: null, orders: [] };
}
// questo ciclo e stato fatto per scansionare tutti gli enpoint e trovare automaticamente
// dove restituisce gli ordini

// meals discovery analogo (sempre ritorna lista ristoranti)
async function findMeals(restaurantId) {
  const base = API_BASE.replace(/\/+$/, "");
  const candidates = [
    `${base}/meals`,
    `${base}/meals/common-meals`,
    `${base}/api/meals`,
    `${base}/v1/meals`
  ];
  for (const u of candidates) {
    const raw = await fetchJSON(u);
    if (!raw) continue;

    if (Array.isArray(raw) && raw[0]?.menu) return raw; // [{restaurantId, menu}]
    if (Array.isArray(raw)) return [{ restaurantId, menu: raw }]; // piatti comuni
    if (raw?.restaurants) return raw.restaurants;
  }
  // non trovato: nessun menu → ritorna contenitore vuoto
  return [{ restaurantId, menu: [] }];
}

// utils
const S = (v) => (v == null ? undefined : String(v));
const money = (n) => `€${Number(n || 0).toFixed(2)}`;
const mealId    = (p) => S(p?.idmeals ?? p?.idMeal ?? p?.id ?? p?._id);
const mealName  = (p) => p?.nome ?? p?.strMeal ?? p?.name ?? p?.title ?? "Unnamed";
const mealPrice = (p) => {
  const n = Number(p?.prezzo ?? p?.price ?? p?.costo ?? 0);
  return Number.isFinite(n) ? n : 0;
};

// normalizza righe d’ordine: [{mealId, qty, price}]
function normalizeOrderLines(order) {
  const out = [];
  const pushId = (id) => out.push({ mealId: S(id), qty: 1, price: undefined });

  (order.meals || []).forEach(pushId);
  (order.dishes || []).forEach(pushId);

  if (Array.isArray(order.items)) {
    for (const it of order.items) {
      if (typeof it === "string" || typeof it === "number") pushId(it);
      else if (it) {
        out.push({
          mealId: S(it.mealId ?? it.id ?? it._id ?? it.productId),
          qty: Number(it.qty ?? it.quantity ?? 1) || 1,
          price: Number(it.price ?? it.prezzo)
        });
      }
    }
  }
  for (const key of ["lines", "products", "cart"]) {
    const arr = order[key];
    if (Array.isArray(arr)) {
      for (const it of arr) {
        out.push({
          mealId: S(it?.mealId ?? it?.id ?? it?._id ?? it?.productId),
          qty: Number(it?.qty ?? it?.quantity ?? 1) || 1,
          price: Number(it?.price ?? it?.prezzo)
        });
      }
    }
  }
  return out.filter(x => x.mealId);
}
// questo pezzo di codice ha come obiettivo di normalizzare la struttura dati
//che servono quindi li trasforma in un formato unico e coerente
// ========================= main =========================
window.addEventListener("load", async () => {
  // auth
  let user = null;
  try { user = JSON.parse(localStorage.getItem("loggedUser") || "null"); } catch {}
  if (!user || user.role !== "ristoratore") {
    alert("Access reserved for restaurateurs");
    location.href = "login.html";
    return;
  }
  const rid = user.restaurantId || user._id || "r_o";

  // DOM
  const totOrdini   = document.getElementById("tot-ordini");
  const totPiatti   = document.getElementById("tot-piatti");
  const totIncasso  = document.getElementById("tot-incasso");
  const topUl       = document.getElementById("piatti-popolari");
  const errorBox    = document.getElementById("stats-error");
  const missingBox  = document.getElementById("missing-orders-route");

  // placeholders
  if (totOrdini)  totOrdini.textContent  = "—";
  if (totPiatti)  totPiatti.textContent  = "—";
  if (totIncasso) totIncasso.textContent = "—";
  if (topUl) topUl.innerHTML = "<li class='muted'>Loading…</li>";
  if (errorBox) errorBox.textContent = "";
  if (missingBox) missingBox.innerHTML = "";

  // 1) carica ordini 
  const { url: usedOrdersUrl, orders: ordersRaw } = await findOrders(rid);

  // 2) carica piatti 
  const restaurants = await findMeals(rid);
  const myMenu = (restaurants.find(r => String(r.restaurantId) === String(rid))?.menu) || [];
  const myMap  = new Map(myMenu.map(p => [mealId(p), p]));
  const myIds  = new Set([...myMap.keys()].filter(Boolean));

  // 3) filtra ordini per i miei piatti se l’endpoint non filtra lato server
  const orders = usedOrdersUrl && (usedOrdersUrl.includes("/restaurant/") || usedOrdersUrl.includes("?restaurantId="))
    ? ordersRaw
    : ordersRaw.filter(o => normalizeOrderLines(o).some(l => myIds.has(l.mealId)));

  // 4) statistiche
  let countOrdersWithMine = 0, totalItems = 0, totalRevenue = 0;
  const soldByName = Object.create(null);

  for (const ord of orders) {
    const lines = normalizeOrderLines(ord);
    let hasMine = false;
    for (const ln of lines) {
      if (!myIds.has(ln.mealId)) continue;
      hasMine = true;
      const m = myMap.get(ln.mealId);
      const qty = Number(ln.qty || 1);
      const price = Number(ln.price ?? mealPrice(m));
      totalItems   += qty;
      totalRevenue += price * qty;
      const name = mealName(m);
      soldByName[name] = (soldByName[name] || 0) + qty;
    }
    if (hasMine) countOrdersWithMine++;
  }

  // 5) aggiorna DOM
  if (totOrdini)  totOrdini.textContent  = String(countOrdersWithMine);
  if (totPiatti)  totPiatti.textContent  = String(totalItems);
  if (totIncasso) totIncasso.textContent = money(totalRevenue);

  if (topUl) {
    const html = Object.entries(soldByName)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([name, qty]) => `<li>${name} — ${qty}×</li>`)
      .join("");
    topUl.innerHTML = html || "<li>No orders received.</li>";
  }

  // se non abbiamo trovato nessun endpoint ordini, mostra un avviso (ma niente errori)
  if (!usedOrdersUrl && missingBox) {
    missingBox.innerHTML = `
      <div style="background:#fff3cd;color:#664d03;border:1px solid #ffecb5;padding:10px;border-radius:6px;">
        <strong>Endpoint ordini non trovato.</strong><br>
        Il backend non espone <code>/orders</code> (né varianti comuni).<br>
        Soluzioni:
        <ol style="margin:6px 0 0 18px;">
          <li>Montare una rotta: <code>GET /orders?restaurantId=:rid</code> oppure <code>GET /orders/restaurant/:rid</code>.</li>
          <li>Oppure definire in frontend <code>window.ORDERS_ENDPOINT = "/PERCORSO_ESATTO"</code>.</li>
        </ol>
      </div>`;
  }
});

// questo pezzo e il pezzo centrale usato per calcolare le statistiche ed gestire eventuali
// errori causati  
