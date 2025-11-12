// ===================== Base URL =====================
const isLocal = ["localhost", "127.0.0.1"].includes(location.hostname);
const API_BASE = isLocal
  ? "http://localhost:3000"
  : "https://restaurant-management-wzhj.onrender.com";

// ===================== helper fetch JSON =====================
async function fetchJSON(url, options = {}) {
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    mode: "cors",
    ...options
  });

  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }

  if (!res.ok) {
    const msg = (data && (data.message || data.error)) || text || `HTTP ${res.status}`;
    throw new Error(`${url} → ${msg}`);
  }
  return data;
}


async function tryMany(urls) {
  let lastErr = null;
  for (const u of urls) {
    try { return await fetchJSON(u); }
    catch (e) { console.warn("[ORDINI] fallito", u, e.message); lastErr = e; }
  }
  throw lastErr || new Error("nessuna rotta disponibile");
}
// questa parte di codice ci permette di fare il fetche del json di parsare il json
// se fallisce segnala errore al ristorante 
// ===================== utils =====================
function money(n) {
  return `€${Number(n || 0).toFixed(2)}`;
}

// ===================== on load =====================
window.addEventListener("load", async () => {
  const container = document.getElementById("ordine-lista");
  let user = null;
  try { user = JSON.parse(localStorage.getItem("loggedUser") || "null"); } catch {}
  if (!user || user.role !== "ristoratore") {
    alert("Access reserved for restaurateurs.");
    window.location.href = "login.html";
    return;
  }

  try {
    // === 1) carico ordini ===
    const rid = user.restaurantId || user._id || "r_o";
    const orders = await tryMany([
      `${API_BASE}/orders?restaurantId=${encodeURIComponent(rid)}`,
      `${API_BASE}/api/orders?restaurantId=${encodeURIComponent(rid)}`,
      `${API_BASE}/orders/restaurant/${encodeURIComponent(rid)}`,
      `${API_BASE}/api/orders/restaurant/${encodeURIComponent(rid)}`
    ]);

    if (!Array.isArray(orders) || orders.length === 0) {
      container.innerHTML = "<p>no orders found for your restaurant.</p>";
      return;
    }

    // === 2) carico piatti ===
    const mealsData = await tryMany([
      `${API_BASE}/meals`,
      `${API_BASE}/meals/common-meals`,
      `${API_BASE}/api/meals`
    ]);

    // normalizzo struttura
    let restaurants = [];
    if (Array.isArray(mealsData) && mealsData[0]?.menu) {
      restaurants = mealsData; // caso A: lista ristoranti
    } else if (Array.isArray(mealsData) && mealsData[0]) {
      restaurants = [{ restaurantId: rid, menu: mealsData }]; // caso B: piatti comuni
    } else if (mealsData?.restaurants) {
      restaurants = mealsData.restaurants;
    }

    const mieiPiatti = (restaurants.find(r => String(r.restaurantId) === String(rid))?.menu) || [];

    // === 3) filtro ordini ===
    const ordiniFiltrati = orders.filter(o =>
      Array.isArray(o.meals || o.items || o.dishes) &&
      (o.meals || o.items || o.dishes).some(id =>
        mieiPiatti.some(p => String(p.idmeals ?? p.id ?? p._id) === String(id))
      )
    );

    if (ordiniFiltrati.length === 0) {
      container.innerHTML = "<p>No orders with your dishes.</p>";
      return;
    }

    // === 4) render ===
    container.innerHTML = "";
    for (const ordine of ordiniFiltrati) {
      const orderId = ordine.id ?? ordine._id;
      const statoId = `stato-${orderId}`;

      const piatti = (ordine.meals || ordine.items || ordine.dishes || []).map(id => {
        const trovato = mieiPiatti.find(p => String(p.idmeals ?? p.id ?? p._id) === String(id));
        return trovato ? (trovato.nome ?? trovato.strMeal ?? "Dish") : "(not your dish)";
      });

      const div = document.createElement("div");
      div.className = "ordine-box";
      div.style.border = "1px solid #ccc";
      div.style.marginBottom = "15px";
      div.style.padding = "10px";
      div.style.borderRadius = "6px";
      div.style.backgroundColor = "#f9f9f9";

      div.innerHTML = `
        <p><strong>Order ID:</strong> ${orderId}</p>
        <p><strong>Customer:</strong> ${ordine.username ?? ordine.user ?? "—"}</p>
        <p><strong>Status:</strong> <span id="${statoId}">${ordine.status}</span></p>
        <p><strong>Delivery:</strong> ${ordine.delivery ?? "—"}</p>
        <p><strong>Payment:</strong> ${ordine.payment ?? "—"}</p>
        <p><strong>Dishes:</strong><br>${piatti.join("<br>")}</p>
        ${ordine.status !== "consegnato"
          ? `<button onclick="aggiornaStato('${orderId}', '${ordine.status}', '${statoId}')">Advance status</button>`
          : ""
        }
      `;
      container.appendChild(div);
    }

  } catch (err) {
    console.error(err);
    container.innerHTML = `<pre style="white-space:pre-wrap;color:#b00;background:#fee;padding:12px;border:1px solid #fbb;">
Errore: ${err.message}
Suggerimento: controlla che il backend esponga una rotta GET /orders o /api/orders.
    </pre>`;
  }
});
// questo pezzo di codice permmette di caricare prima gliordini poi i singoli piatti da preparare
// ovviamente fa un lavoro di normalizzazione sia per gli ordini che per i piatti ovviamente
// se ci sono degli errori li segnala al ristoarante

// ===================== cambio stato =====================
async function aggiornaStato(id, statoAttuale, domSpanId) {
  const next = {
    "ordinato": "in preparazione",
    "in preparazione": "consegnato"
  }[statoAttuale];

  if (!next) return;

  try {
    const res = await fetch(`${API_BASE}/orders/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: next })
    });

    if (res.ok) {
      const span = document.getElementById(domSpanId || `stato-${id}`);
      if (span) span.textContent = next;
    } else {
      const text = await res.text().catch(() => "");
      alert("error changing status. " + text);
    }
  } catch (err) {
    console.error(err);
    alert("network error while changing status.");
  }
}
// questo pezzo di codice permette di fare aggiornare lo stato del ordine 
// segna eventuali errori se ovviamente avvengono durante esecuzione, chiamala PUT
//aggiorna interfaccia