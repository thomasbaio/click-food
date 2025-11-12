// ================= Base URL =================
const isLocal = ["localhost", "127.0.0.1"].includes(location.hostname);
const isFile  = location.protocol === "file:";
const PROD    = "https://restaurant-management-wzhj.onrender.com";

const API_BASE = isLocal ? "http://localhost:3000"
               : isFile  ? PROD
               : location.origin;

console.log("[register] API_BASE:", API_BASE);

// ================= cache elementi =================
const form   = document.getElementById("register-form");
const roleEl = document.getElementById("role");

const extraCliente = document.getElementById("cliente-extra");
const extraRist    = document.getElementById("ristoratore-extra");

// base
const usernameEl = document.getElementById("username");
const emailEl    = document.getElementById("email");
const passEl     = document.getElementById("password");

// cliente
const preferenzaEl = document.getElementById("preferenza");

// ristoratore
const pivaEl  = document.getElementById("piva");
const telEl   = document.getElementById("telefono");
const luogoEl = document.getElementById("luogo");
const viaEl   = document.getElementById("via");
const rnameEl = document.getElementById("restaurantName");

// ================= ui per ruoli =================
function refreshRoleUI() {
  const role = roleEl?.value;
  const isCliente = role === "cliente";
  const isRisto   = role === "ristoratore";

  if (extraCliente) extraCliente.style.display = isCliente ? "block" : "none";
  if (extraRist)    extraRist.style.display    = isRisto   ? "block" : "none";

  if (preferenzaEl) preferenzaEl.required = false;

  [rnameEl, pivaEl, telEl, luogoEl, viaEl].forEach(el => {
    if (el) el.required = !!isRisto;
  });
}
roleEl?.addEventListener("change", refreshRoleUI);
refreshRoleUI();

// ================= validazione =================
function validateForm() {
  if (!usernameEl?.value.trim()) return "Username is required.";
  if (!emailEl?.value.trim())    return "Email is required.";
  if (!passEl?.value || passEl.value.length < 6) return "Password must be at least 6 characters.";

  if (roleEl?.value === "ristoratore") {
    if (!rnameEl?.value.trim()) return "Restaurant name is required for restaurants.";
    if (!telEl?.value.trim())   return "Phone number is required for restaurants.";
  }
  return null;
}

// ================= helper fetch con timeout =================
async function doPost(path, payload, { timeout = 12000 } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
      mode: "cors"
    });
    return res;
  } finally {
    clearTimeout(t);
  }
}

// prova più endpoint: continua se 404, altrimenti gestisci risposta
async function smartRegister(payload) {
  const candidates = [
    "/users/register",
    "/api/users/register",
    "/users",              // molti backend fanno POST /users per creare
    "/api/users",
    "/auth/register",
    "/register"
  ];

  let lastErrTxt = "";
  for (const path of candidates) {
    try {
      const res = await doPost(path, payload);
      if (res.status === 404) {
        console.warn(`[register] 404 on ${path}, trying next...`);
        lastErrTxt = `404 on ${path}`;
        continue;
      }
      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        throw new Error(`HTTP ${res.status} ${res.statusText}${txt ? " – " + txt : ""}`);
      }
      const data = await res.json().catch(() => ({}));
      return { ok: true, data, path };
    } catch (e) {
      // abort -> timeout
      if (e.name === "AbortError") {
        throw new Error("network timeout while contacting server.");
      }
      // altri errori (CORS, 5xx, ecc.)
      throw e;
    }
  }
  throw new Error(`no matching register endpoint (tried: ${candidates.join(", ")}). Last: ${lastErrTxt}`);
}

// ================= submit =================
form?.addEventListener("submit", async (e) => {
  e.preventDefault();

  if (!navigator.onLine) {
    alert("sei offline. connettiti a Internet e riprova.");
    return;
  }

  const err = validateForm();
  if (err) { alert(err); return; }

  const role = roleEl?.value || "cliente";
  const payload = {
    username: usernameEl.value.trim(),
    email:    emailEl.value.trim(),
    password: passEl.value,
    role
  };

  if (role === "cliente") {
    const pref = (preferenzaEl?.value || "").trim();
    if (pref) payload.preferenza = pref;
  } else {
    payload.partitaIva     = pivaEl?.value?.trim()   || "";
    payload.telefono       = telEl?.value?.trim()    || "";
    payload.luogo          = luogoEl?.value?.trim()  || "";
    payload.indirizzo      = viaEl?.value?.trim()    || "";
    payload.restaurantName = rnameEl?.value?.trim()  || "";
  }

  const submitBtn = form.querySelector('button[type="submit"]');
  const prevTxt = submitBtn?.textContent;
  if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = "registrazione…"; }

  try {
    const { ok, data, path } = await smartRegister(payload);
    console.log("registration ok via", path, data);
    alert("registrazione completata! ora puoi effettuare il login.");
    location.href = "login.html";
  } catch (e2) {
    console.error("registration error:", e2);
    alert(`errore di registrazione:\n${e2.message || e2}`);
  } finally {
    if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = prevTxt; }
  }
});

