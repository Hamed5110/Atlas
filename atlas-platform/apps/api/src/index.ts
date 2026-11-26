import { createApp } from "./app.js";
import { config } from "./config.js";
import { closeDb } from "./db/pool.js";

const app = createApp();

const server = app.listen(config.port, config.host, () => {
  console.log(`ATLAS Platform API listening on http://${config.host}:${config.port}`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    server.close();
    await closeDb();
    process.exit(0);
  });
}
