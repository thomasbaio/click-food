const mongoose = require("mongoose");

const AddressSchema = new mongoose.Schema(
  {
    via: { type: String, trim: true },
    citta: { type: String, trim: true },
    cap: { type: String, trim: true },
  },
  { _id: false }
);

const HoursSchema = new mongoose.Schema(
  {
    // es: { lun: "12:00-15:00,19:00-23:00", mar: "...", ... }
    lun: String, mar: String, mer: String, gio: String, ven: String, sab: String, dom: String,
  },
  { _id: false }
);

const RestaurantSchema = new mongoose.Schema(
  {
    // riferimento all'utente ristoratore che possiede il ristorante
    ownerUserId: { type: String, required: true, index: true },

    // identificatore "umano" opzionale
    code: { type: String, trim: true, index: true }, // es: "r_o"

    nome: { type: String, required: true, trim: true },
    luogo: { type: String, trim: true },             // città/zona usata in ricerca
    telefono: { type: String, trim: true },
    partitaIVA: { type: String, trim: true, unique: true, sparse: true },

    indirizzo: AddressSchema,

    descrizione: { type: String, trim: true },
    foto: { type: String, trim: true }, // URL logo/cover

    tipologie: [{ type: String, trim: true }], // es: ["pizza","sushi","veg"]

    orari: HoursSchema,

    attivo: { type: Boolean, default: true },
  },
  { timestamps: true }
);

// indici utili per ricerca
RestaurantSchema.index({ nome: "text", luogo: "text", tipologie: 1 });

module.exports = mongoose.model("Restaurant", RestaurantSchema);
