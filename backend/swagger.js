
const path = require("path");
const swaggerJSDoc = require("swagger-jsdoc");
const swaggerUi = require("swagger-ui-express");

/* -------- servers -------- */
const PROD_URL =
  process.env.RENDER_EXTERNAL_URL ||
  process.env.PUBLIC_BASE_URL ||
  process.env.BASE_URL ||
  "";

const servers = PROD_URL
  ? [{ url: PROD_URL, description: "Prod" }]
  : [
      { url: "http://localhost:3000", description: "Dev" },
      { url: "https://restaurant-management-wzhj.onrender.com", description: "Prod (statico)" },
    ];

/* --------- definizione openAPI --------- */
const options = {
  definition: {
    openapi: "3.0.3",
    info: {
      title: "Click&Food API",
      version: "1.0.0",
      description:
        "API per ristoratori, piatti, ordini e autenticazione. documentazione openAPI 3 per il progetto Click&Food.",
    },
    servers,
    tags: [
      { name: "fetch", description: "endpoint di lettura/ricerca contenuti" },
      { name: "Users", description: "registrazione, login e profilo" },
      { name: "Restaurants", description: "anagrafica ristoranti" },
      { name: "Meals", description: "gestione piatti per ristorante" },
      { name: "Orders", description: "creazione ordini e gestione stati" },
      { name: "database", description: "stato/health del server e del DB" },
    ],
    components: {
      securitySchemes: {
        bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
      },
      parameters: {
        RestaurantIdQ: {
          in: "query",
          name: "restaurantId",
          schema: { type: "string" },
          description: "Filtra per ristorante (es. r_o)",
          example: "r_o",
        },
        IdPath: {
          in: "path",
          name: "id",
          required: true,
          schema: { type: "string" },
          description: "ID risorsa (ObjectId o id numerico)",
        },
        Page: {
          in: "query",
          name: "page",
          schema: { type: "integer", minimum: 1, default: 1 },
          description: "Numero pagina",
        },
        Limit: {
          in: "query",
          name: "limit",
          schema: { type: "integer", minimum: 1, maximum: 100, default: 20 },
          description: "Elementi per pagina",
        },
      },
      responses: {
        NotFound: {
          description: "Risorsa non trovata",
          content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
        },
        Unauthorized: {
          description: "Non autorizzato / credenziali errate o token mancante",
          content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
        },
        ValidationError: {
          description: "Dati non validi",
          content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
        },
      },
      schemas: {
        /* ------------ USERS ------------ */
        User: {
          type: "object",
          required: ["username", "role"],
          properties: {
            id: { type: "integer", example: 1 },
            _id: { type: "string", example: "66f1b3c1a2e4e9a1c9b0d123" },
            username: { type: "string", example: "thomas" },
            email: { type: "string", format: "email", example: "baiocchithomas19@gmail.com" },
            password: { type: "string", example: "••••••••" },
            role: { type: "string", enum: ["cliente", "ristoratore"], example: "ristoratore" },
            telefono: { type: "string", example: "+39 333 1234567" },
            luogo: { type: "string", example: "Milano" },
            partitaIva: { type: "string", example: "IT12345678901" },
            indirizzo: { type: "string", example: "Via Roma 1" },
            restaurantId: { type: "string", example: "r_o" },
            preferenza: { type: "string", example: "pizza" },
          },
        },
        LoginRequest: {
          oneOf: [
            {
              type: "object",
              required: ["email", "password"],
              properties: {
                email: { type: "string", format: "email", example: "baiocchithomas19@gmail.com" },
                password: { type: "string", example: "••••••••" },
              },
            },
            {
              type: "object",
              required: ["username", "password"],
              properties: {
                username: { type: "string", example: "thomas" },
                password: { type: "string", example: "••••••••" },
              },
            },
          ],
        },
        LoginResponse: {
          type: "object",
          properties: {
            token: { type: "string", example: "eyJhbGciOi..." },
            user: { $ref: "#/components/schemas/User" },
          },
        },

        /* ------------ piatti ------------ */
        Meal: {
          type: "object",
          required: ["nome", "prezzo", "restaurantId"],
          properties: {
            _id: { type: "string", example: "66f1b3c1a2e4e9a1c9b0d123" },
            idmeals: { type: "integer", example: 123 },
            restaurantId: { type: "string", example: "r_o" },
            nome: { type: "string", example: "Margherita" },
            tipologia: { type: "string", example: "pizza" },
            prezzo: { type: "number", example: 7.5 },
            foto: { type: "string", format: "uri", example: "https://cdn.example.com/pizza.jpg" },
            ingredienti: {
              type: "array",
              items: { type: "string" },
              example: ["pomodoro", "mozzarella", "basilico"],
            },
            ingredients: {
              type: "array",
              items: { type: "string" },
              description: "Alias di 'ingredienti' in lettura",
              example: ["pomodoro", "mozzarella", "basilico"],
              readOnly: true,
            },
            ingredient: {
              type: "string",
              description: "Lista ingredienti in stringa",
              example: "pomodoro, mozzarella, basilico",
              readOnly: true,
            },
            origine: { type: "string", example: "personalizzato" },
            isCommon: { type: "boolean", example: false },
          },
        },
        MealInput: {
          type: "object",
          required: ["restaurantId", "nome"],
          properties: {
            restaurantId: { oneOf: [{ type: "string" }, { type: "number" }], example: "r_o" },
            nome: { type: "string", description: "Alias: name, strMeal", example: "Margherita" },
            tipologia: { type: "string", description: "Alias: category, strCategory", example: "pizza" },
            prezzo: { type: "number", example: 7.5 },
            foto: {
              type: "string",
              description: "Alias: image, strMealThumb",
              example: "https://cdn.example.com/pizza.jpg",
            },
            ingredients: { type: "array", items: { type: "string" }, example: ["pomodoro", "mozzarella"] },
            isCommon: { type: "boolean", example: false },
            origine: { type: "string", example: "personalizzato" },
          },
          additionalProperties: true,
        },

        /* ------------ ristorante ------------ */
        Restaurant: {
          type: "object",
          required: ["restaurantId", "name"],
          properties: {
            restaurantId: { type: "string", example: "r_o" },
            name: { type: "string", example: "Pizzeria Da Mario" },
            phone: { type: "string", example: "+39 02 1234567" },
            piva: { type: "string", example: "IT12345678901" },
            address: { type: "string", example: "Via Torino 22" },
            place: { type: "string", example: "Milano" },
          },
        },

        /* ------------ ordini ------------ */
        OrderItem: {
          type: "object",
          required: ["idmeals", "qty", "price"],
          properties: {
            idmeals: { type: "integer", example: 123 },
            qty: { type: "integer", example: 2 },
            price: { type: "number", example: 7.5 },
          },
        },
        Order: {
          type: "object",
          required: ["userId", "restaurantId", "items", "total", "status"],
          properties: {
            id: { type: "integer", example: 501 },
            userId: { type: "string", example: "1" },
            restaurantId: { type: "string", example: "r_o" },
            items: { type: "array", items: { $ref: "#/components/schemas/OrderItem" } },
            total: { type: "number", example: 15.0 },
            status: {
              type: "string",
              enum: ["ordinato", "preparazione", "consegna", "consegnato", "ritirato", "annullato"],
              example: "ordinato",
            },
            payment: {
              type: "object",
              properties: {
                method: { type: "string", example: "card" },
                paid: { type: "boolean", example: true },
              },
            },
            createdAt: { type: "string", format: "date-time" },
          },
        },

        /* ------------ errore ------------ */
        Error: {
          type: "object",
          properties: {
            message: { type: "string", example: "Errore descrittivo" },
            details: { type: "array", items: { type: "string" } },
          },
        },
      },
    },
    // security: [{ bearerAuth: [] }], // abilita se la maggior parte delle rotte richiede JWT
  },

  /* --- Scansiona i file di route REALI --- */
  apis: [
    path.join(__dirname, "db.js"),
    path.join(__dirname, "meals.js"),
    path.join(__dirname, "order.js"),
    path.join(__dirname, "restaurant.js"),
    path.join(__dirname, "user.js"),
    path.join(__dirname, "login.js"),
    path.join(__dirname, "register.js"),
    path.join(__dirname, "routes/**/*.js"),
  ],
};

const spec = swaggerJSDoc(options);

/* --------- mount UI + json --------- */
function setupSwagger(app) {
  app.use(
    "/api-docs",
    swaggerUi.serve,
    swaggerUi.setup(spec, {
      explorer: true,
      swaggerOptions: {
        persistAuthorization: true,
        tagsSorter: "alpha",
        operationsSorter: "alpha",
      },
    })
  );
  app.get("/api-docs.json", (_req, res) => res.json(spec));
}

module.exports = { setupSwagger, spec };
