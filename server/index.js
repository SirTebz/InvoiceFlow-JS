const config = require("./config");
const { openDatabase } = require("./database/db");
const { createApp } = require("./app");

openDatabase(config.databaseUrl);

const app = createApp();
app.listen(config.port, () => {
  console.log(`InvoiceFlow running at http://localhost:${config.port}`);
});
