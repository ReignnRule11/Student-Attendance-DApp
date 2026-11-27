import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { loadConfig } from "./config.ts";
import { backupDatabase, openDatabase } from "./db.ts";

const config = loadConfig();
const db = openDatabase(config.databasePath);
const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const targetPath = resolve(
  process.env.BACKUP_PATH?.trim() ||
    `${dirname(config.databasePath)}/backups/attendance-${timestamp}.db`,
);

mkdirSync(dirname(targetPath), { recursive: true });
backupDatabase(db, targetPath);
db.close();
console.log(`Database backup created at ${targetPath}`);
