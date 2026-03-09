const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const http = require("http");
const app = require("./app");
const { initRealtime } = require("./realtime");

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || "0.0.0.0";

const server = http.createServer(app);
initRealtime(server);

server.listen(PORT, HOST, () => {
  console.log(`ðŸš€ Server running on http://${HOST}:${PORT}`);
});
