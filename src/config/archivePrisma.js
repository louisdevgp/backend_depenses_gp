const { PrismaClient } = require("@prisma/client");
const mainPrisma = require("./prisma");

const DEFAULT_ARCHIVE_DB = "devgp_gp_v1_archive";

let archivePrisma = null;
let archiveUrlCache = "";

function archiveDatabaseUrl() {
  return String(process.env.V1_ARCHIVE_DATABASE_URL || "").trim();
}

function archiveDbName() {
  const raw = String(process.env.V1_ARCHIVE_DB || DEFAULT_ARCHIVE_DB).trim();
  if (!/^[a-zA-Z0-9_]+$/.test(raw)) {
    const err = new Error("Nom de base archive V1 invalide");
    err.statusCode = 500;
    throw err;
  }
  return raw;
}

function assertTableName(name) {
  if (!/^[a-zA-Z0-9_]+$/.test(String(name || ""))) {
    const err = new Error("Nom de table archive V1 invalide");
    err.statusCode = 500;
    throw err;
  }
}

function useDedicatedArchiveConnection() {
  return Boolean(archiveDatabaseUrl());
}

function getArchivePrisma() {
  const url = archiveDatabaseUrl();
  if (!url) return mainPrisma;

  if (!archivePrisma || archiveUrlCache !== url) {
    archivePrisma = new PrismaClient({
      datasources: {
        db: { url },
      },
    });
    archiveUrlCache = url;
  }

  return archivePrisma;
}

function archiveTable(name) {
  assertTableName(name);
  if (useDedicatedArchiveConnection()) return `\`${name}\``;
  return `\`${archiveDbName()}\`.\`${name}\``;
}

module.exports = {
  getArchivePrisma,
  archiveTable,
  useDedicatedArchiveConnection,
};
