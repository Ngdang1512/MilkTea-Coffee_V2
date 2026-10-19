import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function loadEnvFile() {
  const filePath = resolve(process.cwd(), ".env");
  let contents;
  try {
    contents = readFileSync(filePath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }

  for (const line of contents.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match || match[1] in process.env) continue;
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[match[1]] = value;
  }
}

loadEnvFile();

function parseDatabaseConfig() {
  const dsn = process.env.DB_DSN || "";
  const dsnParts = Object.fromEntries(
    dsn.replace(/^pgsql:/i, "").split(";").filter(Boolean).map(part => {
      const separator = part.indexOf("=");
      return separator < 0 ? [part, ""] : [part.slice(0, separator), part.slice(separator + 1)];
    })
  );

  return {
    host: process.env.PGHOST || dsnParts.host || "127.0.0.1",
    port: Number(process.env.PGPORT || dsnParts.port || 5432),
    database: process.env.PGDATABASE || dsnParts.dbname || "crm_tra_sua_ca_phe",
    user: process.env.PGUSER || process.env.DB_USER || "postgres",
    password: process.env.PGPASSWORD ?? process.env.DB_PASSWORD ?? "",
    max: Number(process.env.PGPOOL_MAX || 10),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000
  };
}

export const config = Object.freeze({
  port: Number(process.env.API_PORT || 3000),
  authSecret: process.env.AUTH_SECRET || "",
  frontendOrigins: (process.env.FRONTEND_ORIGINS || "http://localhost:4173,http://127.0.0.1:4173,http://localhost:4174,http://127.0.0.1:4174,http://localhost:4175,http://127.0.0.1:4175")
    .split(",").map(origin => origin.trim()).filter(Boolean),
  database: parseDatabaseConfig()
});
