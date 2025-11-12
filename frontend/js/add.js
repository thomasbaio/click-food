
const API_BASE =
  (location.hostname === 'localhost' || location.hostname === '127.0.0.1')
    ? 'http://localhost:3000'
    : 'https://restaurant-management-wzhj.onrender.com';

console.log('add.js loaded:', document.currentScript?.src);
console.log('API_BASE ->', API_BASE);

// ===== helpers =====
async function safeJson(res) {
  const ct = res.headers.get('content-type') || '';
  const text = await res.text();
  if (!ct.includes('application/json')) {
    const snippet = text.slice(0, 200).replace(/\s+/g, ' ');
    throw new Error(`non-JSON response (${res.status}) → ${snippet}`);
  }
  try { return JSON.parse(text); }
  catch (e) { throw new Error(`JSON parse error (${res.status}): ${e.message}`); }
}
// lafunzione che precede si occupa di aprie in modo sicuro il json che meals1json

function readUser() {
  try { return JSON.parse(localStorage.getItem("loggedUser") || "null"); }
  catch { return null; }
}

function isRistoratore(u) {
  const role = String(u?.role ?? "").trim().toLowerCase();
  return ["ristoratore","restauratore","restaurant","ristorante"].includes(role);
}
// la funzione che precede si occupa di leggere il file json

function showBanner(container, html) {
  if (!container) return;
  const div = document.createElement("div");
  div.className = "alert info";
  div.style.margin = "8px 0";
  div.innerHTML = html;
  container.parentElement?.insertBefore(div, container);
  return div;
}
// la funzione si occupa di creare un elemento html il div
// =================== gestione ingredienti manuali ===================
const ingredientInput = document.getElementById("ingredient-input");
const ingredientList  = document.getElementById("ingredient-list");
const addBtn          = document.getElementById("add-ingredient-btn");

let ingredients = [];

if (addBtn) {
  addBtn.addEventListener("click", () => {
    const ing = (ingredientInput.value || "").trim();
    if (ing && !ingredients.map(x => x.toLowerCase()).includes(ing.toLowerCase())) {
      ingredients.push(ing);
      updateIngredientList();
      ingredientInput.value = "";
    }
  });
}

function updateIngredientList() {
  if (!ingredientList) return;
  ingredientList.innerHTML = ingredients.map((ing, i) => `
    <li style="margin-bottom: 5px;">
      ${ing}
      <button type="button" onclick="removeIngredient(${i})" style="margin-left: 10px;" aria-label="remove ingredient"></button>
    </li>
  `).join("");
}

window.removeIngredient = function(index) {
  ingredients.splice(index, 1);
  updateIngredientList();
};
// questo pezzo si occupa di gestire gli ingredienti di ogni piatto
// ed elimina anche gli ingredienti 
// =================== submit: piatto personalizzato ===================
const mealForm = document.getElementById("meal-form");
if (mealForm) {
  mealForm.addEventListener("submit", async function (e) {
    e.preventDefault();

    const user = readUser();
    if (!isRistoratore(user)) {
      alert("solo i ristoratori possono creare piatti personalizzati.");
      return;
    }
    if (!user?.restaurantId) {
      alert("per salvare nel tuo menu imposta prima il Restaurant ID nel profilo.");
      return;
    }

    const nome        = document.getElementById("name").value.trim();
    const prezzoRaw   = document.getElementById("price").value;
    const prezzo      = Number(prezzoRaw);
    const descrizione = (document.getElementById("description").value || "").trim();
    const tipologia   = document.getElementById("preferenza").value;
    const immagine    = (document.getElementById("image").value || "").trim();

    if (!nome || !Number.isFinite(prezzo) || prezzo <= 0) {
      alert("inserisci un nome e un prezzo valido (> 0).");
      return;
    }

    const newMeal = {
      restaurantId: user.restaurantId,
      nome,
      prezzo,
      descrizione,
      tipologia,
      ingredients,
      immagine,
      origine: "personalizzato"
    };

    try {
      const res = await fetch(`${API_BASE}/meals`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newMeal)
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`HTTP ${res.status} - ${errText || 'Save error'}`);
      }

      alert("piatto salvato nel tuo menu!");
      window.location.href = "index.html";
    } catch (err) {
      console.error("Network/save error:", err);
      alert(String(err.message || err));
    }
  });
}
// questo pezzo permette di aggiungere una piatto personalizzato 
// dagli utenti che sono dei ristoratori però
// =================== piatti comuni (cards + "Aggiungi al mio menu") ===================
window.addEventListener('DOMContentLoaded', async () => {
  const container = document.getElementById("common-meals-container");
  if (!container) return;

  const user = readUser();

  // 1) guard SOLO sul ruolo (non su restaurantId)
  if (!isRistoratore(user)) {
    container.innerHTML = "<p>Only restaurateurs can view common dishes.</p>";
    return;
  }

  // se manca restaurantId, avvisa ma NON bloccare la visualizzazione
  if (!user?.restaurantId) {
    showBanner(container, "suggerimento: per <b>aggiungere</b> un piatto comune al tuo menu devi prima impostare il <b>Restaurant ID</b> nel profilo.");
  }

  // 2) carica l’elenco provando più endpoint
  async function loadCommon() {
    const tries = [
      `${API_BASE}/meals/common-meals`,
      `${API_BASE}/meals/common`,
      `${API_BASE}/meals?common=1`
    ];
    let lastErr = null;
    for (const url of tries) {
      try {
        const res = await fetch(url);
        if (!res.ok) {
          lastErr = new Error(`HTTP ${res.status}`);
          continue;
        }
        const data = await safeJson(res);
        return Array.isArray(data) ? data : [];
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr || new Error("common meals not available");
  }

  try {
    container.innerHTML = "<p>Loading...</p>";
    const commonMeals = await loadCommon();
    if (!commonMeals.length) {
      container.innerHTML = `<p class="muted">nessun piatto comune disponibile.</p>`;
      return;
    }

    container.innerHTML = "";
    commonMeals.forEach(raw => {
      // normalizzazione campi
      const nome        = raw.strMeal         || raw.nome        || raw.name || "No name";
      const categoria   = raw.strCategory     || raw.tipologia   || raw.category || "-";
      const istruzioni  = raw.strInstructions || raw.descrizione || "-";
      const img         = raw.strMealThumb    || raw.immagine    || raw.image || "";

      let ings = [];
      if (typeof raw.strIngredient1 !== "undefined") {
        for (let i = 1; i <= 20; i++) {
          const ing = raw["strIngredient" + i];
          if (ing && String(ing).trim()) ings.push(ing.trim());
        }
      } else if (Array.isArray(raw.ingredients)) {
        ings = raw.ingredients;
      }

      const card = document.createElement("div");
      card.style.border = "1px solid #ccc";
      card.style.marginBottom = "10px";
      card.style.padding = "10px";
      card.style.borderRadius = "8px";

      card.innerHTML = `
        <strong>${nome}</strong> <small>(${categoria})</small><br>
        ${img ? `<img src="${img}" alt="${nome}" width="150" style="margin:6px 0;border-radius:6px;object-fit:cover;">` : ""}
        <div style="font-size: 12px; color:#444;"><em>${istruzioni}</em></div>
        <div style="font-size: 12px; margin-top:4px;"><small>Ingredients: ${ings.join(", ") || "-"}</small></div>
        <button type="button" class="add-btn" style="margin-top:8px;">Add to my menu</button>
      `;

      card.querySelector(".add-btn").addEventListener("click", async () => {
        const u = readUser();
        if (!u?.restaurantId) {
          alert("per aggiungere al tuo menu imposta prima il Restaurant ID nel profilo.");
          return;
        }
        const nuovoPiatto = {
          restaurantId: u.restaurantId,
          nome,
          prezzo: Number(raw.prezzo || 10),
          descrizione: istruzioni,
          tipologia: categoria,
          immagine: img,
          origine: "comune",
          ingredients: ings
        };

        try {
          const addRes = await fetch(`${API_BASE}/meals`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(nuovoPiatto)
          });

          if (!addRes.ok) {
            const addTxt = await addRes.text();
            throw new Error(`HTTP ${addRes.status} - ${addTxt || 'Save error'}`);
          }

          alert("piatto aggiunto al tuo menu!");
          window.location.href = "index.html";
        } catch (err) {
          console.error("Common dish add error:", err);
          alert(String(err.message || err));
        }
      });

      container.appendChild(card);
    });

  } catch (err) {
    console.error("error loading common dishes:", err);
    container.innerHTML = `<p style="color:#b00;">${String(err.message || 'error loading common dishes.')}</p>`;
  }
});
// il codice che precede usato dai ristoratori per aggiugere un nuovo piatto al menù 