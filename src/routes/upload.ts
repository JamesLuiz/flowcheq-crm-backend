import { Router } from 'express';
import multer from 'multer';
import { asyncHandler } from '../middleware/auth';
import { parseCsvBuffer, parseXlsxBuffer } from '../services/fileImportService';
import { importLeads } from '../services/leadImportService';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok =
      file.mimetype === 'text/csv' ||
      file.mimetype === 'application/vnd.ms-excel' ||
      file.mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
      /\.(csv|xlsx|xls)$/i.test(file.originalname);
    cb(null, ok);
  },
});

const router = Router();

router.post(
  '/contacts/upload',
  upload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) {
      res.status(400).json({ error: 'CSV or XLSX file required (field name: file)' });
      return;
    }

    const updateExisting = req.query.updateExisting === 'true' || req.body?.updateExisting === true;
    const name = req.file.originalname.toLowerCase();
    let leads;
    try {
      if (name.endsWith('.csv')) {
        leads = parseCsvBuffer(req.file.buffer);
      } else if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
        leads = parseXlsxBuffer(req.file.buffer);
      } else {
        res.status(400).json({ error: 'Unsupported file type. Use .csv or .xlsx' });
        return;
      }
    } catch (e) {
      res.status(400).json({ error: e instanceof Error ? e.message : 'Failed to parse file' });
      return;
    }

    if (leads.length === 0) {
      res.status(400).json({ error: 'No valid rows found. Need Business Name and Phone columns.' });
      return;
    }

    const stats = await importLeads(leads, { updateExisting });
    res.status(201).json({
      ...stats,
      parsed: leads.length,
      updateExisting,
      errors: stats.errors.slice(0, 30),
    });
  })
);

export default router;
