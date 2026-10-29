/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Server-only dependencies, loaded from node_modules instead of bundled: pg, and the export
  // libraries (Excel, PDF, Word — app/api/export).
  serverExternalPackages: ["pg", "exceljs", "jspdf", "jspdf-autotable", "docx"],
};

module.exports = nextConfig;
