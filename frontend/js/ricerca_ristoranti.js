async function cercaRistoranti() {
  const nome = document.getElementById("nome").value.toLowerCase();
  const luogo = document.getElementById("luogo").value.toLowerCase();
  const lista = document.getElementById("risultati-ristoranti");

  lista.innerHTML = " Loading...";

  // base URL dinamico: locale oppure Render
  const isLocal = location.hostname === "localhost" || location.hostname === "127.0.0.1";
  const API_BASE = isLocal ? "http://localhost:3000" : "https://restaurant-management-wzhj.onrender.com";

  try {
    const res = await fetch(`${API_BASE}/users/restaurants`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const ristoranti = await res.json();

    const filtrati = ristoranti.filter(r => {
      const matchNome = !nome || r.nome?.toLowerCase().includes(nome);
      const matchLuogo = !luogo || r.location?.toLowerCase().includes(luogo);
      return matchNome && matchLuogo;
    });

    if (filtrati.length === 0) {
      lista.innerHTML = "<li>No restaurants found.</li>";
    } else {
      lista.innerHTML = filtrati.map(r => `
        <li>
          <strong>${r.nome || "No name"}</strong><br>
             ${r.location || "N/A"}<br>
             ${r.telefono || "N/A"}<br>
              VAT No.: ${r.partitaIVA || "N/A"}
        </li>
      `).join("");
    }

  } catch (err) {
    console.error("Search error:", err);
    lista.innerHTML = "<li> error while searching for restaurants.</li>";
  }
}
// questo pezzo di codice si occupa di cercare i ristoranti che sono registrati
// li cerca tramite nome e luogo e se c'è il match allora mostra i ristoranti del luogo oppure 
// i ristornate con quel nome