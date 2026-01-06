require("dotenv").config();
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const path = require("path");

const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json({ limit: "20mb" }));
app.use(morgan("dev"));
app.set("json replacer", (key, value) => {
  return typeof value === "bigint" ? value.toString() : value;
});

app.use("/api", require("./routes"));
app.use("/uploads", express.static(path.join(process.cwd(), "uploads")));

app.get("/health", (req, res) => res.json({ ok: true }));

module.exports = app;



