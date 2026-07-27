// Prisma 7 reads the datasource URL from here rather than from schema.prisma.
//
// DATABASE_URL lives in .env (gitignored) and looks like:
//   sqlserver://192.168.1.104:1433;database=ata_erp;user=ata_app;password=...;trustServerCertificate=true
import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: process.env["DATABASE_URL"],
  },
});
