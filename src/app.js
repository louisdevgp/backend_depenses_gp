const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const multer = require("multer");

const app = express();

app.use(helmet());
app.use(cors());
app.use(
  express.json({
    limit: "20mb",
    verify: (req, _res, buf) => {
      if (buf && buf.length) {
        req.rawBody = buf;
      }
    },
  })
);
app.use(morgan("dev"));
app.set("json replacer", (key, value) => {
  return typeof value === "bigint" ? value.toString() : value;
});

app.use("/api", require("./routes"));
app.use("/uploads", express.static(path.join(process.cwd(), "uploads")));

app.get("/health", (req, res) => res.json({ ok: true }));

// Error handler (JSON only, including multer errors)
app.use((err, _req, res, _next) => {
  if (!err) return res.status(500).json({ success: false, message: "Erreur serveur" });

  if (err instanceof multer.MulterError) {
    const msg =
      err.code === "LIMIT_FILE_SIZE"
        ? "Fichier trop volumineux (20MB max)"
        : err.message || "Erreur upload fichier";
    return res.status(400).json({ success: false, message: msg });
  }

  if (err.message) {
    return res.status(400).json({ success: false, message: err.message });
  }

  return res.status(500).json({ success: false, message: "Erreur serveur" });
});

module.exports = app;



