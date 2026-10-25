import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { passwordHash } from "./security.js";
const file = process.env.DB_PATH ?? "/data/gateway.sqlite";
mkdirSync(dirname(file), { recursive: true });
export const db = new DatabaseSync(file);
db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY,email TEXT UNIQUE NOT NULL,name TEXT NOT NULL,role TEXT NOT NULL CHECK(role IN ('admin','member')),password_hash TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions(hash TEXT PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id),expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS api_keys(id INTEGER PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id),name TEXT NOT NULL,hash TEXT UNIQUE NOT NULL,prefix TEXT NOT NULL,revoked INTEGER NOT NULL DEFAULT 0,created TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS invites(id INTEGER PRIMARY KEY,email TEXT NOT NULL,name TEXT NOT NULL,hash TEXT UNIQUE NOT NULL,expires INTEGER NOT NULL,used INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS servers(id TEXT PRIMARY KEY,name TEXT NOT NULL,url TEXT NOT NULL,enabled INTEGER NOT NULL DEFAULT 1,secret_ref TEXT,auth_type TEXT NOT NULL DEFAULT 'none',header_name TEXT);
CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY,user_id INTEGER NOT NULL,user_email TEXT NOT NULL,server_id TEXT NOT NULL,server_name TEXT NOT NULL,tool TEXT NOT NULL,timestamp TEXT NOT NULL,duration_ms INTEGER NOT NULL,outcome TEXT NOT NULL,error TEXT);
`);
export const run = (sql: string, ...args: SQLInputValue[]) =>
  db.prepare(sql).run(...args);
export const one = (sql: string, ...args: SQLInputValue[]) =>
  db.prepare(sql).get(...args) as any;
export const all = (sql: string, ...args: SQLInputValue[]) =>
  db.prepare(sql).all(...args) as any[];
export function seed() {
  if (!one("SELECT id FROM users LIMIT 1")) {
    if (!process.env.ADMIN_PASSWORD)
      throw new Error("ADMIN_PASSWORD is required for initial setup");
    run(
      "INSERT INTO users(email,name,role,password_hash) VALUES(?,?,?,?)",
      process.env.ADMIN_EMAIL ?? "rohit@example.test",
      "Rohit",
      "admin",
      passwordHash(process.env.ADMIN_PASSWORD),
    );
  }
  // Run only for a new database: an admin removal stays removed after restarts.
  db.exec(
    "CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL)",
  );
  if (!one("SELECT value FROM settings WHERE key='seeded'")) {
    for (const id of ["woocommerce", "time", "math"])
      run(
        "INSERT INTO servers(id,name,url,secret_ref,auth_type,header_name) VALUES(?,?,?,?,?,?)",
        id,
        id === "woocommerce" ? "WooCommerce" : id === "time" ? "Time" : "Math",
        `http://${process.env.SERVICE_PREFIX ?? "urumi-platform"}-${id}:8000/mcp`,
        `urumi-upstream-${id}`,
        id === "math" ? "header" : "bearer",
        id === "math" ? "X-Upstream-Key" : null,
      );
    run("INSERT INTO settings VALUES('seeded','1')");
  }
}
