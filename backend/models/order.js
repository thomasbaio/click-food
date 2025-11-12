const mongoose = require("mongoose");

/* ------------------------ sotto-schema item ------------------------ */
const OrderItemSchema = new mongoose.Schema(
  {
    mealId: { type: String, required: true }, // id piatto (string o _id)
    name:   { type: String },                 // snapshot nome (opzionale ma consigliato)
    qty:    { type: Number, required: true, min: 1, default: 1 },
    price:  { type: Number },                 // prezzo unitario snapshot
  },
  { _id: false }
);

/* ------------------------ schema ordine ------------------------ */
const OrderSchema = new mongoose.Schema(
  {
    // ---- compatibilità con vecchie API / frontend ----
    id: { type: Number, index: true },           // ID incrementale (settato dalla rotta)
    username: { type: String, index: true },     // username del cliente (compatto)

    // ---- campi "nuovi" che già usavi ----
    userId: { type: String, index: true },       // ID utente
    restaurantId: { type: String, index: true }, // es: "r_o"

    // snapshot degli articoli acquistati
    items: { type: [OrderItemSchema], default: [], required: true },

    // lista semplice di ID (utile per ricerche veloci)
    meals: { type: [String], default: [] },

    // totale ordine
    total: { type: Number, default: 0, min: 0 },

    // ---- stato ordine ----
    // flusso tipico: ordinato -> preparazione -> ritirato
    status: {
      type: String,
      enum: ["ordinato", "preparazione", "ritirato" ],
      default: "ordinato",
      index: true,
    },

    // ---- pagamento ----
    payment: {
      method: { type: String, enum: ["carta","online"], default: "carta" },
      paid: { type: Boolean, default: false },
      transactionId: String,
    },

    // ---- tracciamento ritiro ----
    ritiratoAt: Date,                  // quando è stato segnato "ritirato"
    ritiroConfermato: { type: Boolean, default: false },       // conferma ritiro lato backend
    clienteConfermaRitiro: { type: Boolean, default: false },  // flag inviato dal client
  },
  { timestamps: true }
);

/* ------------------------ utility interne ------------------------ */

// calcola totale e lista meals dagli items
function recomputeTotals(doc) {
  let tot = 0;
  const ids = [];
  for (const it of doc.items || []) {
    const qty = Number(it.qty || 1);
    const price = Number(it.price || 0);
    if (it.mealId) ids.push(String(it.mealId));
    tot += qty * (isNaN(price) ? 0 : price);
  }
  doc.total = Number(tot.toFixed(2));
  if (!Array.isArray(doc.meals) || doc.meals.length !== ids.length) {
    doc.meals = ids;
  }
}

// normalizza eventuali valori legacy provenienti da versione con delivery
function normalizeLegacy(doc) {
  // mappa stati : "consegna" -> "preparazione", "consegnato" -> "ritirato"
  const legacy = String(doc.status || "");
  if (legacy === "consegna") {
    doc.status = "preparazione";
  } else if (legacy === "consegnato") {
    doc.status = "ritirato";
    if (!doc.ritiratoAt) doc.ritiratoAt = new Date();
    if (!doc.ritiroConfermato) doc.ritiroConfermato = true;
  }


/* ------------------------ hook ------------------------ */
OrderSchema.pre("validate", function (next) {
  normalizeLegacy(this);
  next();
});

OrderSchema.pre("save", function (next) {
  normalizeLegacy(this);
  recomputeTotals(this);

  // timestamp coerenti con cambio stato
  if (this.isModified("status")) {
    const s = String(this.status || "");
    if (s === "ritirato" && !this.ritiratoAt) {
      this.ritiratoAt = new Date();
    }
    if (s === "ritirato") {
      this.ritiroConfermato = true;
    }
  }

  next();
});

/* ------------------------ indici utili ------------------------ */
OrderSchema.index({ createdAt: -1 });
OrderSchema.index({ id: -1 }); // per nextOrderId e fetch per id

module.exports = mongoose.model("Order", OrderSchema);

