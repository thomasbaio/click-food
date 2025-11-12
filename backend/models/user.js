const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
  username:  { type: String, required: true, unique: true, trim: true },
  email:     { type: String, required: true, unique: true, lowercase: true, trim: true },
  password:  { type: String, required: true },
  role:      { type: String, enum: ['cliente', 'ristoratore'], default: 'cliente' },

  // campi ristoratore
  telefono:   { type: String },
  partitaIva: { type: String },
  indirizzo:  { type: String },
  luogo:      { type: String },

  // ID ristorante (unico se presente; i clienti possono non averlo)
  restaurantId: { type: String, default: "", unique: true, sparse: true, index: true },

  // opzionale:
  legacyId:   { type: Number, index: true, sparse: true },

  // blocco info ristorante 
    restaurant: {
    restaurantId: String,
    nome: String,
    telefono: String,
    partitaIva: String,
    indirizzo: String,
    luogo: String
  },

  // preferenza del cliente (tipologia piatto)
  preferenza: { type: String, trim: true }
}, { timestamps: true });

/* ---------- helpers per auto-assegnazione ---------- */
function normalizeRole(s) {
  return String(s || '').trim().toLowerCase();
}
function makeRestaurantId(doc) {
  if (doc.restaurantId) return String(doc.restaurantId);
  if (process.env.DEFAULT_RESTAURANT_ID) return String(process.env.DEFAULT_RESTAURANT_ID);
  if (doc.legacyId != null) return `r_${doc.legacyId}`;
  return String(doc._id);
}

/* ---------- pre-save: normalizza e assegna restaurantId se serve ---------- */
UserSchema.pre('save', function(next) {
  // normalizza role
  const r = normalizeRole(this.role);
  if (r === 'ristoratore' || r === 'restauratore' || r === 'ristorante' || r === 'restaurant') {
    this.role = 'ristoratore';
  } else {
    this.role = 'cliente';
  }

  // se ristoratore e manca restaurantId -> genera
  if (this.role === 'ristoratore' && !this.restaurantId) {
    this.restaurantId = makeRestaurantId(this);
  }
  next();
});

module.exports = mongoose.model('User', UserSchema);

module.exports = mongoose.model('User', UserSchema);
