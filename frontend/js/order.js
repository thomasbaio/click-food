
(() => {
  "use strict";

  /* -------- auth: cliente -------- */
  const user = JSON.parse(localStorage.getItem("loggedUser") || "null");
  if (!user || user.role !== "cliente") {
    alert("you must be logged in as a customer to place an order.");
    location.href = "login.html";
    throw new Error("user not logged in as customer");
  }
// dice al eventuale persona che vuole effettuare un ordine che prima deve essere loggato
  /* -------- API base -------- */
  const isLocal = ["localhost", "127.0.0.1"].includes(location.hostname);
  const DEFAULT_API_BASE = isLocal ? "http://localhost:3000" : location.origin;
  const API_BASE = localStorage.getItem("API_BASE") || DEFAULT_API_BASE;

  /* -------- draft (bozza d’ordine) -------- */
  const DRAFT_KEY = "order_draft_v1";
  const getDraft = () => {
    try { return JSON.parse(localStorage.getItem(DRAFT_KEY) || "null"); }
    catch { return null; }
  };
  const setDraft = (d) => localStorage.setItem(DRAFT_KEY, JSON.stringify(d || null));
  const clearDraft = () => localStorage.removeItem(DRAFT_KEY);

  function addItemToDraft(item) {
    let draft = getDraft();
    if (!draft) {
      draft = {
        userId: user._id || user.id || user.username || "",
        restaurantId: item.restaurantId || "",
        items: [],
        createdAt: new Date().toISOString()
      };
    }
    //permette di fare la bozza dell'ordine

    // vincolo: un solo ristorante per bozza
    if (draft.restaurantId && item.restaurantId && draft.restaurantId !== item.restaurantId) {
      const ok = confirm("your current order contains dishes from another restaurant. Replace it with this one?");
      if (!ok) return false;
      draft = {
        userId: draft.userId,
        restaurantId: item.restaurantId || "",
        items: [],
        createdAt: new Date().toISOString()
      };
    }
    if (!draft.restaurantId) draft.restaurantId = item.restaurantId || "";

    // merge quantità se stesso piatto
    const idx = draft.items.findIndex(x => String(x.dishId) === String(item.dishId));
    if (idx >= 0) {
      draft.items[idx].qty = Number(draft.items[idx].qty || 0) + Number(item.qty || 0);
    } else {
      draft.items.push(item);
    }
    setDraft(draft);
    return true;
  }
// usato per auemtare la quantità di un piatto se ordinato più di una volta
  // unisce righe con stesso dishId sommando le qty (usata dal riepilogo)
  function mergeItemsByDishId(items) {
    const by = new Map();
    for (const it of (items || [])) {
      const id = String(it.dishId);
      const prev = by.get(id);
      const qty  = Number(it.qty) || 0;
      if (prev) {
        by.set(id, { ...prev, qty: (Number(prev.qty) || 0) + qty });
      } else {
        by.set(id, { ...it, qty });
      }
    }
    return [...by.values()];
  }

  /* -------- helpers UI/DOM -------- */
  const qs  = (s) => document.querySelector(s);
  const qsa = (s) => Array.from(document.querySelectorAll(s));
  const fmt = (n) => `€${(Number(n || 0)).toFixed(2)}`;
  const getParam = (k) => new URLSearchParams(location.search).get(k) || "";

  function isValidImgPath(s) {
    if (typeof s !== "string") return false;
    const t = s.trim(); if (!t || t === "#" || t === "-") return false;
    return /^https?:\/\//i.test(t) || t.startsWith("//") || t.startsWith("/");
  }
  function firstImage(p) {
    const src = p || {}, raw = src.raw || {};
    const cands = [
      src.immagine, src.foto, src.strMealThumb, src.image, src.thumb, src.picture, src.img,
      raw.immagine, raw.foto, raw.strMealThumb, raw.image, raw.thumb, raw.picture, raw.img,
    ];
    for (let u of cands) {
      if (!isValidImgPath(u)) continue;
      u = String(u).trim();
      return u.startsWith("//") ? "https:" + u : u;
    }
    return "";
  }
  //permette di estrarre immagine del piatto nel carello
  function pickImageURL(p) {
    const u = firstImage(p);
    if (isValidImgPath(u)) return u.startsWith("/") ? location.origin + u : u;
    const label = encodeURIComponent((p.nome || p.strMeal || p.name || "Food").split(" ")[0]);
    return `https://placehold.co/160x120?text=${label}`;
  }
  //permette di estrarre url dall'immagine
  function normalizeKey(nome, cat) {
    const strip = (s) => String(s || "")
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .toLowerCase().trim().replace(/\s+/g, " ");
    return `${strip(nome)}|${strip(cat)}`;
  }
  // si occupa di normalizzare la chiave quindi pulire la struttura dati
  async function buildFileImageMap() {
    try {
      const res = await fetch(`${API_BASE}/meals/common-meals?source=file`, { headers: { Accept: "application/json" } });
      if (!res.ok) throw new Error(String(res.status));
      const arr = await res.json();
      const map = new Map();
      (Array.isArray(arr) ? arr : []).forEach(m => {
        const url = firstImage(m);
        if (!isValidImgPath(url)) return;
        const nome = m.nome ?? m.strMeal ?? m.name ?? "";
        const cat  = m.tipologia ?? m.strCategory ?? m.category ?? "";
        const key = normalizeKey(nome, cat);
        if (!map.has(key)) map.set(key, url);
      });
      return map;
    } catch { return new Map(); }
  }
  // lavora in modalità asincrona si occupa di costruire mappa per recuperare immagine del 
  // piatto nel carrrello 
  function ensureImageFallback(meal, imgMap) {
    if (!meal) return meal;
    const has = isValidImgPath(meal.immagine) || isValidImgPath(firstImage(meal));
    if (has) return meal;
    const key = normalizeKey(meal.name || meal.nome, meal.category || meal.tipologia);
    const url = imgMap.get(key);
    if (isValidImgPath(url)) meal.immagine = url;
    return meal;
  }
// questa funzione invece usata per se immagine per recuperare ll meals il piatto nel carrello
  function normalizeMeal(raw, restaurantIdFallback) {
    let id = raw.idmeals ?? raw.idMeal ?? raw.id ?? raw._id ?? null;
    if (id != null) id = String(id);
    const name = raw.nome ?? raw.strMeal ?? raw.name ?? "No name";
    const category = raw.tipologia ?? raw.category ?? raw.strCategory ?? "";
    let price = raw.prezzo ?? raw.price ?? 0;
    if (typeof price === "string") { const n = Number(price.replace(",", ".")); price = Number.isFinite(n) ? n : 0; }
    const restaurantId = raw.restaurantId ?? restaurantIdFallback ?? "";
    const ingredients = Array.isArray(raw.ingredients) ? raw.ingredients.filter(Boolean) : [];
    const description = raw.descrizione ?? raw.description ?? raw.strInstructions ?? "";
    const immagine = firstImage(raw);
    return { id, name, price:Number(price), category, restaurantId, ingredients, description, immagine, raw };
  }
// si occupa di normalizzare la struttura dati di melas quindi pulendo e togliendo tutte le 
  // informazioni che non sono utili per meals
  async function fetchMeals() {
    for (const path of ["/meals", "/api/meals"]) {
      try {
        const res = await fetch(`${API_BASE}${path}`, { headers: { Accept: "application/json" } });
        if (res.ok) return await res.json();
      } catch {}
    }
    throw new Error("cannot load meals");
  }
// lavora in modo asicrono permette di fare operazione fetch su meals
  async function loadMealById(dishId, restaurantIdHint) {
    const [data, imgMap] = await Promise.all([fetchMeals(), buildFileImageMap()]);
    let list = [];
    if (Array.isArray(data) && data.some(r => Array.isArray(r.menu))) {
      for (const r of data) {
        const rid = r.restaurantId ?? r.idRestaurant ?? r.id ?? r._id ?? "";
        for (const m of (r.menu || [])) list.push(normalizeMeal(m, rid));
      }
    } else if (Array.isArray(data)) {
      list = data.map(m => normalizeMeal(m));
    }
    const found =
      list.find(x => String(x.id) === String(dishId)) ||
      list.find(x => String(x.raw?.idmeals) === String(dishId)) ||
      list.find(x => String(x.raw?._id) === String(dishId));
    if (!found) throw new Error("dish not found");
    ensureImageFallback(found, imgMap);
    if (restaurantIdHint && !found.restaurantId) found.restaurantId = String(restaurantIdHint);
    return found;
  }
  // questa funzione permette operazione di scaricare i piatti li normalizza 
  // trova il piatto richiesto tramite id ed gestisce la foto da allegare

  /* =================== SINGOLO PIATTO =================== */
  let currentMeal = null;
  let qty = 1;
  const FEES = 0;

  // helper: passa l’ordine alla pagina di pagamento
  function goToPayment(order) {
    localStorage.setItem("pendingOrder", JSON.stringify(order));
    const d = getDraft();
    if (!d || d.restaurantId === order.restaurantId) clearDraft();
    location.href = "payment.html";
  }

  function renderDish() {
    const root = qs("#dish");
    if (!root || !currentMeal) return;
    root.innerHTML = `
      <img src="${pickImageURL(currentMeal)}" alt="Photo of ${currentMeal.name}" loading="lazy">
      <div style="flex:1;">
        <h2 style="margin:0 0 6px;">${currentMeal.name}</h2>
        ${currentMeal.category ? `<div class="muted" style="margin-bottom:6px;">${currentMeal.category}</div>` : ""}
        ${currentMeal.ingredients?.length ? `<div class="muted" style="margin-bottom:6px;">Ingredients: ${currentMeal.ingredients.join(", ")}</div>` : ""}
        ${currentMeal.description ? `<div class="muted" style="margin-bottom:6px;">${currentMeal.description}</div>` : ""}
        <div class="line"><span class="muted">Unit price</span> <strong>${fmt(currentMeal.price)}</strong></div>
        <label style="display:inline-flex;align-items:center;gap:8px;margin-top:8px;">
          Quantity
          <input id="qty" class="qty-input" type="number" min="1" max="99" step="1" value="${qty}">
        </label>
      </div>
    `;
    const qtyInput = qs("#qty");
    qtyInput?.addEventListener("input", () => {
      const v = Math.max(1, Math.min(99, Number(qtyInput.value || 1)));
      qty = v; qtyInput.value = String(v); renderSummary();
    });
//questa funzione permette al utente che sta ordinndo di vedere una anteprima del piatto tramite
    // immagine po dice il prezzo e la quantita che sta ordinando

    // pulsante "Add to the order"
    const form = qs("#order-form");
    if (form && !qs("#btn-add-to-draft")) {
      const addBtn = document.createElement("button");
      addBtn.id = "btn-add-to-draft";
      addBtn.type = "button";
      addBtn.textContent = "Add to the order";
      addBtn.style.marginRight = "8px";
      addBtn.addEventListener("click", onAddToDraftAndBackHome);
      form.insertBefore(addBtn, form.querySelector('button[type="submit"]') || null);
    }
  }

  // riepilogo: include bozza + piatto corrente
  function renderSummary() {
    const sum = qs("#summary");
    if (!sum) return;

    const draft = getDraft();
    const sameRestaurantDraft =
      draft && draft.items && currentMeal &&
      String(draft.restaurantId || "") === String(currentMeal.restaurantId || "");

    let lines = [];
    let subtotal = 0;

    if (sameRestaurantDraft) {
      const merged = mergeItemsByDishId([
        ...draft.items,
        {
          dishId: String(currentMeal.id),
          name: currentMeal.name,
          price: Number(currentMeal.price),
          qty,
          restaurantId: currentMeal.restaurantId || "",
          imageUrl: pickImageURL(currentMeal)
        }
      ]);

      merged.forEach(it => {
        const lineTot = Number(it.price) * Number(it.qty);
        subtotal += lineTot;
        lines.push(
          `<div class="line"><span>${it.name} × ${it.qty}</span><span>€${lineTot.toFixed(2)}</span></div>`
        );
      });
    } else {
      if (draft && draft.items && draft.items.length) {
        lines.push(`<div class="muted">you have an in-progress order for another restaurant. it won't be included.</div>`);
      }
      if (currentMeal) {
        const curTot = Number(currentMeal.price) * Number(qty);
        subtotal += curTot;
        lines.push(
          `<div class="line"><span>${currentMeal.name} × ${qty}</span><span>€${curTot.toFixed(2)}</span></div>`
        );
      }
    }

    sum.innerHTML = lines.join("") || "";

    const s = qs("#subtotal"), f = qs("#fees"), t = qs("#total");
    if (s) s.textContent = `€${subtotal.toFixed(2)}`;
    if (f) f.textContent = `€0.00`;
    if (t) t.textContent = `€${subtotal.toFixed(2)}`;
  }
//la funzione permette di tornare continuare ad ordinare al cliente solo se 
// e tine memoriazzato il piatto che è adesso nel carrello 
  function onAddToDraftAndBackHome() {
    if (!currentMeal) return;
    const item = {
      dishId: String(currentMeal.id),
      name: currentMeal.name,
      price: Number(currentMeal.price),
      qty,
      restaurantId: currentMeal.restaurantId || "",
      imageUrl: pickImageURL(currentMeal)
    };

    const ok = addItemToDraft(item);
    if (!ok) return;
    location.href = "index.html"; // torna al menu per aggiungere altro
  }

  // "Confirm order" ora passa a payment con pendingOrder
  async function submitSingleOrder(e) {
    e.preventDefault();
    if (!currentMeal) { alert("Dish not loaded."); return; }

    const fd = new FormData(e.target);
    const delivery = fd.get("delivery") || "pickup";
    const payment  = fd.get("payment")  || "carta_credito";

    const items = [{
      dishId: String(currentMeal.id),
      name: currentMeal.name,
      price: Number(currentMeal.price),
      qty,
      restaurantId: currentMeal.restaurantId || "",
      imageUrl: pickImageURL(currentMeal)
    }];

    const subtotal = items.reduce((s, it) => s + it.price * it.qty, 0);
    const order = {
      userId: user._id || user.id || user.username || "",
      username: user.username,                 // compat con payment.html esistente
      role: user.role,
      restaurantId: items[0].restaurantId,
      items,                                   // nuovo formato
      meals: items.map(i => i.dishId),         // compat vecchio (solo gli ID)
      delivery, payment,
      subtotal: Number(subtotal.toFixed(2)),
      fees: 0,
      total: Number(subtotal.toFixed(2)),
      status: "ordinato",
      createdAt: new Date().toISOString()
    };

    goToPayment(order);
  }

  /* ============== builder: più piatti e somme  ============== */
  function renderBuilderList(container, groups) {
    container.innerHTML = "";
    groups.forEach(g => {
      const sect = document.createElement("fieldset");
      sect.className = "restaurant-section";
      const legend = document.createElement("legend");
      legend.textContent = g.name;
      sect.appendChild(legend);

      g.items.forEach(m => {
        const row = document.createElement("div");
        row.className = "meal-item";
        row.innerHTML = `
          <div class="meal-row" style="display:flex;gap:10px;align-items:center;justify-content:space-between;">
            <div style="display:flex;gap:10px;align-items:center;flex:1;">
              <img src="${pickImageURL(m)}" alt="${m.name}" width="80" height="60"
                   style="object-fit:cover;border-radius:8px;background:#f3f4f6" onerror="this.style.display='none'">
              <div>
                <div><strong>${m.name}</strong> ${m.category ? `<em class="muted">(${m.category})</em>` : ""}</div>
                <div class="muted">${fmt(m.price)}</div>
              </div>
            </div>
            <label class="muted" style="display:flex;align-items:center;gap:6px;">
              Qty
              <input type="number" class="qty" data-id="${m.id}" data-price="${m.price}"
                     data-rid="${m.restaurantId}" min="0" max="99" step="1" value="0" style="width:70px">
            </label>
          </div>`;
        sect.appendChild(row);
      });
 
      container.appendChild(sect);
    });
  }
// permette di fare vedere al cliente se ha ordinato più di un piatto facendo vedere 
  // immagine del piatto che ha ordinato attualmente
  function recomputeBuilderTotal(container) {
    const inputs = container.querySelectorAll("input.qty");
    let total = 0;
    inputs.forEach(inp => {
      const q = Math.max(0, Math.min(99, Number(inp.value || 0)));
      const p = Number(inp.dataset.price || 0);
      if (q > 0 && Number.isFinite(p)) total += q * p;
    });
    const totalEl = qs("#total");
    if (totalEl) totalEl.textContent = `Total: ${fmt(total)}`;
    const sumBox = qs("#summary");
    if (sumBox) {
      const lines = [];
      inputs.forEach(inp => {
        const q = Number(inp.value || 0);
        if (q > 0) {
          const row = inp.closest(".meal-row");
          const name = row?.querySelector("strong")?.textContent || "Dish";
          const price = Number(inp.dataset.price || 0);
          lines.push(`<div class="line"><span>${name} × ${q}</span><span>${fmt(q*price)}</span></div>`);
        }
      });
      sumBox.innerHTML = lines.join("") || "";
      const s = qs("#subtotal"), f = qs("#fees"), t = qs("#total");
      const subtotal = total;
      if (s) s.textContent = fmt(subtotal);
      if (f) f.textContent = fmt(0);
      if (t) t.textContent = fmt(subtotal);
    }
  }
  //la funzione usata per recuperare il totale del ordine

  function hydrateBuilderFromDraft(container) {
    const draft = getDraft();
    if (!draft || !Array.isArray(draft.items) || !draft.items.length) return;
    draft.items.forEach(it => {
      const inp = container.querySelector(`input.qty[data-id="${CSS.escape(String(it.dishId))}"]`);
      if (inp) {
        const prev = Number(inp.value || 0);
        inp.value = String(prev + Number(it.qty || 0));
      }
    });
    recomputeBuilderTotal(container);
  }
//estrarre la bozza del ordine

  async function buildGroupsForBuilder() {
    const [data, imgMap] = await Promise.all([fetchMeals(), buildFileImageMap()]);
    const groupsMap = new Map(); // rid -> { name, items[] }
    function ensure(rid, name) {
      const k = String(rid || "");
      if (!groupsMap.has(k)) {
        groupsMap.set(k, { name: name || (k ? `Restaurant ${k}` : "Restaurant"), items: [] });
      } else if (name && /^Restaurant /.test(groupsMap.get(k).name)) {
        groupsMap.get(k).name = name;
      }
      return groupsMap.get(k);
    }
    if (Array.isArray(data) && data.some(r => Array.isArray(r.menu))) {
      for (const r of data) {
        const rid = r.restaurantId ?? r.idRestaurant ?? r.id ?? r._id ?? "";
        const rname = r.nome ?? r.name ?? r.restaurantName ?? "";
        const g = ensure(rid, rname);
        for (const m of (r.menu || [])) {
          const nm = normalizeMeal(m, rid);
          ensureImageFallback(nm, imgMap);
          g.items.push(nm);
        }
      }
    } else if (Array.isArray(data)) {
      for (const m of data) {
        const nm = normalizeMeal(m);
        ensureImageFallback(nm, imgMap);
        const g = ensure(nm.restaurantId, "");
        g.items.push(nm);
      }
    }
    return Array.from(groupsMap.values()).filter(g => g.items.length);
  }
//lavora in modalità asincrona ha come obiettivo di costruire un gruppo che contiene costruttori
// che fa dei controlli di sicurezza sul resturant prima di effettura qualsiasi operazione
  // "Confirm order" del builder porta a payment
  async function submitBuilderOrder(e, container) {
    e.preventDefault();
    const inputs = container.querySelectorAll("input.qty");
    const items = [];
    let restaurantId = null;

    inputs.forEach(inp => {
      const q = Math.max(0, Math.min(99, Number(inp.value || 0)));
      if (q <= 0) return;
      const price = Number(inp.dataset.price || 0);
      const dishId = String(inp.dataset.id || "");
      const rid = String(inp.dataset.rid || "");
      const row = inp.closest(".meal-row");
      const name = row?.querySelector("strong")?.textContent || "Dish";
      const img = row?.querySelector("img")?.getAttribute("src") || "";

      if (!restaurantId) restaurantId = rid;
      if (restaurantId && rid && restaurantId !== rid) {
        restaurantId = "__MIXED__";
      }

      items.push({ dishId, name, price, qty: q, restaurantId: rid, imageUrl: img });
    });

    if (!items.length) {
      alert("select at least one dish (set Qty > 0).");
      return;
    }
    if (restaurantId === "__MIXED__") {
      alert("please select dishes from a single restaurant.");
      return;
    }

    const subtotal = items.reduce((s, it) => s + it.price * it.qty, 0);
    const order = {
      userId: user._id || user.id || user.username || "",
      username: user.username,
      role: user.role,
      restaurantId: restaurantId || "",
      items,
      meals: items.map(i => i.dishId),
      delivery: "pickup",
      payment: "carta_credito",
      subtotal: Number(subtotal.toFixed(2)),
      fees: 0,
      total: Number(subtotal.toFixed(2)),
      status: "ordinato",
      createdAt: new Date().toISOString()
    };

    goToPayment(order);
  }

  /* ============================ boot ============================ */
  window.addEventListener("DOMContentLoaded", async () => {
    const dishId = getParam("dishId");
    const rid    = getParam("restaurantId");

    // ——— modalità singolo piatto (con dishId)
    if (dishId) {
      try {
        currentMeal = await loadMealById(dishId, rid);
        renderDish();
        renderSummary(); // riepilogo include bozza
        qs("#order-form")?.addEventListener("submit", submitSingleOrder);
      } catch (e) {
        console.error(e);
        (qs("#dish") || qs("#meals-list"))?.insertAdjacentHTML(
          "beforeend",
          `<p class="muted">Dish not available. <a href="ricerca_piatti.html">Back to dishes</a></p>`
        );
        qs("#order-form")?.addEventListener("submit", (ev) => ev.preventDefault());
      }
      return;
    }
// questa parte di codice ci fa il riepilogo della bozza e se il piatto non è disponibile stampa
// l'alert    
    // ——— modalità builder (senza dishId)
    const listEl = qs("#meals-list");
    if (listEl) {
      try {
        const groups = await buildGroupsForBuilder();
        if (!groups.length) {
          listEl.innerHTML = `<p>no dishes available.</p>`;
          return;
        }
        renderBuilderList(listEl, groups);
        hydrateBuilderFromDraft(listEl);
// avvias che nella bozza non ci sono piatti quini disponible ordine

        listEl.addEventListener("input", (e) => {
          if (e.target && e.target.classList.contains("qty")) {
            const v = Math.max(0, Math.min(99, Number(e.target.value || 0)));
            e.target.value = String(v);
            recomputeBuilderTotal(listEl);
          }
        });
        recomputeBuilderTotal(listEl);
// usato ricalcolare in modo automatico il totale del ordine 

        const form = qs("#order-form");
        form?.addEventListener("submit", (e) => submitBuilderOrder(e, listEl));
      } catch (err) {
        console.error("error loading dishes:", err);
        alert(`error loading dishes.\nBase URL: ${API_BASE}\nDetails: ${err.message}`);
      }
      return;
    }

    // nuova pagina ma senza dishId
    const dishBox = qs("#dish");
    if (dishBox) {
      dishBox.innerHTML = `
        <div>
          <h2>No dish selected</h2>
          <p class="muted">open a dish and press "Order".</p>
          <p><a href="ricerca_piatti.html">go to dishes</a></p>
        </div>
      `;
      qs("#order-form")?.addEventListener("submit", (e) => {
        e.preventDefault();
        alert("Select a dish first.");
      });
    }
  });
})();
