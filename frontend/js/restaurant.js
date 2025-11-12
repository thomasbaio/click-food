const express = require("express");
const fs = require("fs");
const router = express.Router();

const DATA_FILE = "./restaurants.json";

// lettura dati ristoranti
function readData() {
  if (!fs.existsSync(DATA_FILE)) return [];
  return JSON.parse(fs.readFileSync(DATA_FILE));
}

// scrittura dati ristoranti
function writeData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

// crea nuovo ristorante
router.post("/", (req, res) => {
  const data = readData();
  const newRisto = req.body;

  const newId = data.length > 0 ? Math.max(...data.map(r => r.restaurantId)) + 1 : 1;
  newRisto.restaurantId = newId;

  data.push(newRisto);
  writeData(data);

  res.status(201).json(newRisto);
});

// ottieni ristorante per ID
router.get("/:id", (req, res) => {
  const id = parseInt(req.params.id);
  const data = readData();
  const found = data.find(r => r.restaurantId === id);

  if (!found) return res.status(404).send("restaurant not found");
  res.json(found);
});

// modifica ristorante
router.put("/:id", (req, res) => {
  const id = parseInt(req.params.id);
  const data = readData();

  const index = data.findIndex(r => r.restaurantId === id);
  if (index === -1) return res.status(404).send("restaurant not found");

  data[index] = { ...data[index], ...req.body, restaurantId: id };
  writeData(data);

  res.json(data[index]);
});

// elimina ristorante (facoltativo)
router.delete("/:id", (req, res) => {
  const id = parseInt(req.params.id);
  let data = readData();

  const index = data.findIndex(r => r.restaurantId === id);
  if (index === -1) return res.status(404).send("restaurant not found");

  data.splice(index, 1);
  writeData(data);

  res.sendStatus(204);
});

module.exports = router;
