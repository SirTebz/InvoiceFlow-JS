const path = require("path");
const express = require("express");
const helmet = require("helmet");
const { attachUser } = require("./middleware/auth");
const apiRouter = require("./routes/api");
const { openDatabase } = require("./database/db");

function createApp(options = {}) {
  if (options.databaseUrl) openDatabase(options.databaseUrl);
  const app = express();
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(express.json({ limit: "4mb" }));
  app.use(express.urlencoded({ extended: true }));
  app.use(attachUser);
  app.use("/api", apiRouter);
  app.use(express.static(path.join(__dirname, "..", "client")));
  app.get("*", (_req, res) => res.sendFile(path.join(__dirname, "..", "client", "index.html")));
  app.use((err, _req, res, _next) => {
    console.error(err);
    res.status(500).json({ error: { message: "Something went wrong. Please try again." } });
  });
  return app;
}

module.exports = { createApp };
