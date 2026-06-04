/**
 * Import leads from Cleaned_Leads.xlsx into MongoDB.
 *
 * Usage (from backend/):
 *   npm run import:leads              — create new contacts only (skip duplicates)
 *   npm run import:leads:update       — create new + update existing by phone
 *   npm run import:leads -- --update-existing   — same as update script
 */
import { execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { connectMongo } from '../src/store/mongo';
import { importLeads, type LeadImportRow } from '../src/services/leadImportService';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const updateExisting =
  process.argv.includes('--update-existing') || process.argv.includes('--update');

async function main() {
  const xlsxPath = path.resolve(__dirname, '../../Cleaned_Leads.xlsx');
  const parser = path.join(__dirname, 'parse-cleaned-leads.py');
  const json = execSync(`python "${parser}" "${xlsxPath}"`, { encoding: 'utf-8' });
  const leads: LeadImportRow[] = JSON.parse(json);

  await connectMongo();
  console.log(`[import] Parsed ${leads.length} leads from spreadsheet`);
  console.log(`[import] Mode: ${updateExisting ? 'create + update existing' : 'create only (skip duplicates)'}`);

  const stats = await importLeads(leads, { updateExisting });

  console.log(
    `[import] Done — created: ${stats.created}, updated: ${stats.updated}, skipped: ${stats.skipped}, failed: ${stats.failed}`
  );
  if (stats.errors.length > 0) {
    console.log('[import] First errors:', stats.errors.slice(0, 5));
  }
  process.exit(stats.failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
