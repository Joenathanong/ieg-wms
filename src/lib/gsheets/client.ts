import { google } from 'googleapis';

let _sheets: ReturnType<typeof google.sheets> | null = null;

export function getSheetsClient() {
  if (_sheets) return _sheets;

  const credentials = JSON.parse(
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON ?? '{}'
  );

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  _sheets = google.sheets({ version: 'v4', auth });
  return _sheets;
}

export const SPREADSHEET_ID = process.env.GOOGLE_SPREADSHEET_ID ?? '';
export const SHEET_NAME     = process.env.GOOGLE_SHEET_NAME ?? 'List_PO';
