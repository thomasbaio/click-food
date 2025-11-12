const mongoose = require("mongoose");

const mealSchema = new mongoose.Schema(
  {
    restaurantId: { type: String, required: true },     // niente index/unique sul campo
    idmeals:      { type: Number, required: true },     // niente index/unique sul campo

    // campi descrittivi
    nome:       { type: String, default: "Senza nome" },
    tipologia:  { type: String, default: "Altro" },
    prezzo:     { type: Number, default: 0 },
    foto:       { type: String, default: "" },

    // ingredienti (canonico + alias, NON indicizzati)
    ingredienti: { type: [String], default: [] },
    ingredients: { type: [String], default: [] },
    ingredient:  { type: String,  default: "" },

    // meta
    origine:  { type: String, default: "personalizzato" },
    isCommon: { type: Boolean, default: false },
  },
  { timestamps: true, autoIndex: true }
);

//indice composto UNICO!
mealSchema.index(
  { restaurantId: 1, idmeals: 1 },
  { unique: true, name: "uniq_restaurant_meal" }
);

// per /common-meals
mealSchema.index({ isCommon: 1 });
mealSchema.index({ origine: 1 });

module.exports = mongoose.models.Meal || mongoose.model("Meal", mealSchema);
