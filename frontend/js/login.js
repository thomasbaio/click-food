
(() => {
  const isLocal = ["localhost", "127.0.0.1"].includes(location.hostname);
  const API_BASE = isLocal
    ? "http://localhost:3000"
    : "https://restaurant-management-wzhj.onrender.com";

  // ---------- helpers ----------
  async function postJson(url, payload) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      mode: "cors",
      body: JSON.stringify(payload),
    });
 
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = null; }

    if (!res.ok) {
      const msg = (data && (data.message || data.error)) || text || `HTTP ${res.status}`;
      const err = new Error(msg);
      err.status = res.status;
      err.statusText = res.statusText;
      err.body = text;
      throw err;
    }
    return { data, raw: text };
  }
// la funzione lavora in modo asincrono ed si gestire il json ed eventuali errori

  function pickUser(obj) {
    if (!obj) return null;
    // layout comuni
    if (obj.user) return obj.user;
    if (obj.data && obj.data.user) return obj.data.user;
    // alcuni backend rispondono direttamente con l'utente
    if (obj.username || obj.email || obj.role) return obj;
    return null;
  }
// la funzione si occupa di estrarre in modo sicuro un oggetto utente

  const normRole = (r) => String(r || "").trim().toLowerCase();

  function ensureRestaurantId(userLike) {
    const role = normRole(userLike.role);
    if (role !== "ristoratore") return userLike;
// la funzione si occupa di recuperare id ristorante per chi ne è abilitato
    let rid =
      userLike.restaurantId ||
      userLike.restaurant?.restaurantId ||
      "";

    // paracadute: se manca ancora, deriviamo dall'id
    if (!rid) {
      const base = String(userLike._id || userLike.id || userLike.legacyId || "").trim();
      rid = base || ""; // se proprio non c'è nulla, rimane stringa vuota
    }

    return { ...userLike, restaurantId: rid };
  }

  // ---------- main ----------
  document.addEventListener("DOMContentLoaded", () => {
    const form    = document.getElementById("login-form");
    const emailEl = document.getElementById("email");     // opzionale
    const userEl  = document.getElementById("username");  // può contenere username o email
    const passEl  = document.getElementById("password");
    if (!form) return;

    form.addEventListener("submit", async (e) => {
      e.preventDefault();

      const rawEmail = (emailEl?.value || "").trim();
      const rawUser  = (userEl?.value  || "").trim();
      const password = (passEl?.value  || "").trim();

      if (!(rawEmail || rawUser) || !password) {
        alert("inserisci email o username e la password.");
        return;
      }

      const payload = {};
      if (rawEmail) payload.email = rawEmail;
      else if (rawUser.includes("@")) payload.email = rawUser;
      else payload.username = rawUser;
      payload.password = password;

      try {
        let resp, data, user;

        // 1) prova /users/login (spesso su prod)
        try {
          resp = await postJson(`${API_BASE}/users/login`, payload);
        } catch (e1) {
          // 2) fallback /login solo se 404 o 405
          if (!(e1.status === 404 || e1.status === 405)) throw e1;
          resp = await postJson(`${API_BASE}/login`, payload);
        }

        data = resp.data ?? null;

        // se il server ha risposto HTML, fallisci con dettaglio
        if (!data && resp.raw && /^\s*<!DOCTYPE html>/i.test(resp.raw)) {
          throw new Error("il server ha risposto HTML invece di json:\n" + resp.raw.slice(0, 200));
        }

        user = pickUser(data);
        if (!user) {
          // mostra anche il JSON grezzo che è arrivato per debug
          throw new Error(
            "risposta non valida dal server (utente mancante). Corpo: " +
            (resp.raw ? resp.raw.slice(0, 300) : JSON.stringify(data))
          );
        }

        // token & tokenType
        if (data.token) localStorage.setItem("authToken", data.token);
        if (data.tokenType) localStorage.setItem("tokenType", data.tokenType);

        // garantisci restaurantId per ristoratori
        const ensured = ensureRestaurantId(user);

        // salva un utente "safe" nel localStorage
        const safeUser = {
          id: ensured._id || ensured.id || ensured.legacyId || null,
          username: ensured.username || "",
          email: ensured.email || "",
          role: ensured.role || "",
          restaurantId: ensured.restaurantId || "",
          // (facoltativi) altri campi utili lato UI:
          telefono: ensured.telefono || "",
          luogo: ensured.luogo || "",
          partitaIva: ensured.partitaIva || "",
          indirizzo: ensured.indirizzo || "",
          preferenza: ensured.preferenza || ""
        };
        localStorage.setItem("loggedUser", JSON.stringify(safeUser));

        alert("Login effettuato!");
        window.location.href = "index.html";
      } catch (err) {
        console.error("[LOGIN]", err);
        const isNetwork = /failed to fetch|NetworkError|CORS/i.test(String(err));
        alert(isNetwork
          ? "impossibile contattare il server. Controlla URL/connessione."
          : `login fallito: ${err.message}`);
      }
    });
  });
})();
// questa parte è la parte che viene usata per fare il login con email o username e poi
// ovviamente la password se utente è un ristorante si preoccupa di recuperare il resturantid
// così da permettere a ristoratori di fare le loro attività personalizzate
