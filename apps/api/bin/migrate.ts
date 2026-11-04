import { connect, runMigrations } from "../src/db";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");
const { pool } = connect(url);
await runMigrations(pool);
await pool.end();
console.log("migrations applied");
