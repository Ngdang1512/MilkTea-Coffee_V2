import pg from "pg";
import { config } from "./config.js";

const { Pool } = pg;

export const pool = new Pool(config.database);
pool.on("error", error => {
  console.error("Lỗi kết nối PostgreSQL không mong đợi:", error.message);
});

export async function transaction(work) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
