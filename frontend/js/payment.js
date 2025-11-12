
// ====== configurazione api base ======
const isLocalhost = ["localhost", "127.0.0.1"].includes(location.hostname);
const DEFAULT_API_BASE = isLocalhost
  ? "http://localhost:3000"
  : "https://restaurant-management-wzhj.onrender.com";
// Consenti override dalla console/localStorage
const API_BASE = localStorage.getItem("API_BASE") || DEFAULT_API_BASE;

// ====== storage keys ======
const PENDING_KEY = "pendingOrder";
const FALLBACK_KEY = "orders_local_fallback";
const LAST_ORDER_KEY = "lastOrder";              // usato da conferma.html
const LAST_ORDER_KEY_COMPAT = "lastConfirmedOrder"; // compat vecchio

// ====== utili ======
function parseExpiryToDate(expStr) {
  const [y, m] = (expStr || "").split("-").map(Number);
  if (!y || !m) return null;
  return new Date(y, m - 1, 1, 23, 59, 59);
}
function toStringArray(arr) {
  return (Array.isArray(arr) ? arr : [])
    .map(x => (x == null ? "" : String(x).trim()))
    .filter(s => s.length > 0);
}
function calcTotal(items) {
  if (!Array.isArray(items) || items.length === 0) return 0;
  return items.reduce((s, it) => s + (Number(it.price) || 0) * (Number(it.qty) || 1), 0);
}
function maskCardNumber(num) {
  const s = (num || "").replace(/\s+/g, "");
  return s ? s.replace(/\d(?=\d{4})/g, "•") : "";
}
// questo pezzo di codice parsa i dati calcola il totale e normalizza unala array di stringhe
//ed maschera il numero della carta 
// ---- fallback: ricava restaurantId dai /meals ----
async function inferRestaurantIdFromAPI(mealIds) {
  if (!Array.isArray(mealIds) || mealIds.length === 0) return null;

  const paths = ["/meals", "/api/meals"];
  let data = null;
  for (const p of paths) {
    try {
      const res = await fetch(`${API_BASE}${p}`, { headers: { Accept: "application/json" } });
      if (!res.ok) continue;
      data = await res.json();
      break;
    } catch {}
  }
  if (!data) return null;

  const wanted = new Set(mealIds.map(String));

  // atteso: [{restaurantId, menu:[{idmeals|id|_id, ...}]}, ...]
  if (Array.isArray(data)) {
    for (const r of data) {
      const rid = String(r?.restaurantId ?? r?.id ?? r?._id ?? "");
      const menu = Array.isArray(r?.menu) ? r.menu : [];
      for (const p of menu) {
        const pid = String(p?.idmeals ?? p?.id ?? p?._id ?? "");
        if (pid && wanted.has(pid)) return rid || null;
      }
    }
  } else if (data && typeof data === "object") {
    const stack = [data];
    while (stack.length) {
      const cur = stack.pop();
      if (!cur || typeof cur !== "object") continue;
      if (Array.isArray(cur.menu)) {
        const rid = String(cur.restaurantId ?? cur.id ?? cur._id ?? "");
        for (const p of cur.menu) {
          const pid = String(p?.idmeals ?? p?.id ?? p?._id ?? "");
          if (pid && wanted.has(pid)) return rid || null;
        }
      }
      for (const v of Object.values(cur)) {
        if (v && typeof v === "object") stack.push(v);
        if (Array.isArray(v)) v.forEach(x => x && typeof x === "object" && stack.push(x));
      }
    }
  }
  return null;
}

// invece questa parte cerca di ricavare il restuarant id dal piatti 

// ====== invio robusto: prova più endpoint, altrimenti salva locale ======
async function postOrderWithFallback(payload) {
  for (const path of ["/orders", "/api/orders"]) {
    try {
      const res = await fetch(`${API_BASE}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(payload)
      });
      if (res.ok) {
        try { return await res.json(); } catch { return payload; }
      }
    } catch {}
  }
  // fallback: salva localmente
  const arr = JSON.parse(localStorage.getItem(FALLBACK_KEY) || "[]");
  arr.push(payload);
  localStorage.setItem(FALLBACK_KEY, JSON.stringify(arr));
  return payload; // continuiamo come se avessimo confermato
}

document.getElementById("payment-form").addEventListener("submit", async function (e) {
  e.preventDefault();

  const number = document.getElementById("card-number").value.trim();
  const holder = document.getElementById("card-holder").value.trim();
  const expiry = document.getElementById("expiry").value;
  const cvv = document.getElementById("cvv").value.trim();

  // --- validazioni carta ---
  if (!/^\d{16}$/.test(number)) { alert("invalid card number (16 digits)."); return; }
  if (!holder) { alert("please enter the cardholder name."); return; }
  const expDate = parseExpiryToDate(expiry);
  if (!expDate) { alert("invalid expiration date."); return; }
  const now = new Date();
  if (expDate < new Date(now.getFullYear(), now.getMonth(), 1)) {
    alert("the card has expired."); return;
  }
  if (!/^\d{3}$/.test(cvv)) { alert("invalid CVV (3 digits)."); return; }

  // --- ordine in sospeso ---
  const ordine = JSON.parse(localStorage.getItem(PENDING_KEY) || "null");
  if (!ordine) { alert("no pending order to pay."); return; }

  // --- utente ---
  const user = JSON.parse(localStorage.getItem("loggedUser") || "null") || {};
  const username = user?.username || ordine?.username;
  if (!username) { alert("unable to determine the order's user (missing username)."); return; }

  // --- meals + total (compat con formati diversi) ---
  let meals = [];
  let total = 0;

  if (Array.isArray(ordine.meals) && ordine.meals.length) {
    meals = toStringArray(ordine.meals);
  } else if (Array.isArray(ordine.items) && ordine.items.length) {
    meals = toStringArray(
      ordine.items.map(it => it.dishId ?? it.idmeals ?? it.id ?? it._id)
    );
  }
  if (!Number.isFinite(Number(ordine.total))) {
    total = Array.isArray(ordine.items) ? calcTotal(ordine.items) : 0;
  } else {
    total = Number(ordine.total) || 0;
  }

  if (!meals.length) { alert("the order has no dishes."); return; }

  // --- restaurantId: pendingOrder -> items -> inferenza da /meals ---
  let restaurantId =
    ordine.restaurantId ||
    (Array.isArray(ordine.items) && ordine.items[0]?.restaurantId) ||
    null;

  if (!restaurantId) {
    try { restaurantId = await inferRestaurantIdFromAPI(meals); }
    catch {}
  }
  if (!restaurantId) { alert("unable to determine restaurantId for this order."); return; }
// questo pezzo di codice cerca di estrarre i piatti ed il totale se fallisce a dei vari alert
  // per qualsiasi cosa succeda
  // --- payload per backend (essenziale e compatibile) ---
  const payload = {
    username,
    restaurantId,
    meals,                    // array di stringhe (ids)
    total,
    payment: "carta_credito",
    status: "ordinato",
    createdAt: new Date().toISOString(),
    // info aggiuntive utili lato conferma
    items: Array.isArray(ordine.items) ? ordine.items : undefined
  };
  //payload che un oggetto viene inviato al backend con specificato payment e lo stato 

  // --- info pagamento (solo per conferma, NON si invia cvv) ---
  const masked = maskCardNumber(number);
  const paymentInfo = { type: "card", holder, maskedNumber: masked, expiry };

  try {
    const confirmed = await postOrderWithFallback(payload);

    const lastOrder = {
      ...confirmed,
      paymentInfo,
      paidAt: new Date().toISOString(),
      status: "pagato"
    };

    // salva per conferma.html (due chiavi per compatibilità)
    localStorage.setItem(LAST_ORDER_KEY, JSON.stringify(lastOrder));
    localStorage.setItem(LAST_ORDER_KEY_COMPAT, JSON.stringify(lastOrder));
    localStorage.removeItem(PENDING_KEY);

    // vai sempre alla pagina di conferma (anche se il backend non aveva /orders)
    window.location.href = "conferma.html";
  } catch (err) {
    // Non blocchiamo l’utente con un 404: salviamo localmente e confermiamo.
    console.error("payment fallback error:", err);
    const fallback = { ...payload, paymentInfo, paidAt: new Date().toISOString(), status: "pagato" };
    const arr = JSON.parse(localStorage.getItem(FALLBACK_KEY) || "[]");
    arr.push(fallback);
    localStorage.setItem(FALLBACK_KEY, JSON.stringify(arr));
    localStorage.setItem(LAST_ORDER_KEY, JSON.stringify(fallback));
    localStorage.setItem(LAST_ORDER_KEY_COMPAT, JSON.stringify(fallback));
    localStorage.removeItem(PENDING_KEY);
    window.location.href = "conferma.html";
  }
});
