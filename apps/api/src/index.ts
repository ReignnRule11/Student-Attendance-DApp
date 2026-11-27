import { serve } from "@hono/node-server";
import { createApiApp } from "./app.ts";
import { loadConfig } from "./config.ts";
import { openDatabase } from "./db.ts";
import {
  createSepoliaClient,
  resolveOnChainRole,
  syncContractEvents,
} from "./indexer.ts";

const config = loadConfig();
const db = openDatabase(config.databasePath);
const client = createSepoliaClient(config.sepoliaRpcUrl);

const triggerSync = () =>
  syncContractEvents({
    db,
    client,
    contractAddress: config.contractAddress,
    defaultStartBlock: config.startBlock,
  });

const app = createApiApp({
  db,
  config,
  resolveRole: (wallet) => resolveOnChainRole(client, config.contractAddress, wallet),
  triggerSync,
});

serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(
    `Student Attendance API listening on http://localhost:${info.port} (contract ${config.contractAddress})`,
  );
});

if (config.enableIndexer) {
  void triggerSync().catch((err) => {
    console.error("Initial Sepolia event sync failed:", err);
  });
  setInterval(() => {
    void triggerSync().catch((err) => {
      console.error("Periodic Sepolia event sync failed:", err);
    });
  }, config.indexerIntervalMs);
}
