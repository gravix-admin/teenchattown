require("dotenv").config({ quiet: true });

const path = require("path");
const express = require("express");
const cors = require("cors");
const { initSchema } = require("./services/schema");
const { attachUser } = require("./middleware/auth");

const authRoutes = require("./routes/auth");
const chatRoutes = require("./routes/chat");
const socialRoutes = require("./routes/social");
const adminRoutes = require("./routes/admin");

const app = express();
const port = Number(process.env.PORT || 3000);

app.use(cors());
app.use(express.json({ limit: "6mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(attachUser);
app.use("/uploads", express.static(path.join(__dirname, "uploads")));
app.use(express.static(path.join(__dirname, "public")));

app.use("/api/auth", authRoutes);
app.use("/api/chat", chatRoutes);
app.use("/api/social", socialRoutes);
app.use("/api/admin", adminRoutes);

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, name: "Teens Town Chat" });
});

app.get(/.*/, (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

initSchema()
  .then(() => {
    app.listen(port, () => {
      console.log(`Teens Town Chat running on http://127.0.0.1:${port}`);
    });
  })
  .catch((error) => {
    console.error("Could not start Teens Town Chat.");
    console.error(error.message);
    if ((process.env.DB_PASSWORD || "").includes("YOUR_PASSWORD")) {
      console.error("Edit .env and replace DB_PASSWORD=YOUR_PASSWORD with your real MySQL password.");
    }
    process.exit(1);
  });
