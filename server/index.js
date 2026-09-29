const config = require("./config");
const { openDatabase } = require("./database/db");
const { createApp } = require("./app");

openDatabase(config.databaseUrl);

const host = process.env.HOST || "0.0.0.0";
app.listen(config.port, host, () => {
  console.log(`InvoiceFlow running at http://${host}:${config.port}`);
});
