const { google } = require('googleapis');

const GENERAL_SHEET_DEFAULT = 'general_feedback';
const TICKET_SHEET_DEFAULT = 'ticket_feedback';
const STATUS_RECEIVED = 'получено';
const MAX_GENERAL_PROBLEM = 2000;
const MAX_TICKET_PROBLEM = 4000;
const MAX_TICKET_EXPECTED = 4000;
const MAX_TICKET_LLM_RESPONSE = 20000;
const MAX_TICKET_ID = 200;
const MAX_TICKET_URL = 2000;
const MAX_TEAM = 100;
const MAX_VERSION = 100;

function json(res, status, payload) {
  res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.send(JSON.stringify(payload));
}

function readEnv(name, fallback = '') {
  const value = process.env[name];
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function parseServiceAccount() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is not configured.');
  }

  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed.private_key === 'string') {
      parsed.private_key = parsed.private_key.replace(/\\n/g, '\n');
    }
    return parsed;
  } catch (error) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is invalid JSON.');
  }
}

function clampString(value, maxLength, fieldName, { required = false } = {}) {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (required && !normalized) {
    throw new Error(`Field "${fieldName}" is required.`);
  }
  if (normalized.length > maxLength) {
    throw new Error(`Field "${fieldName}" exceeds max length.`);
  }
  return normalized;
}

function normalizePayload(body) {
  if (!body || typeof body !== 'object') {
    throw new Error('Invalid payload.');
  }

  const type = clampString(body.type, 20, 'type', { required: true });
  const team = clampString(body.team, MAX_TEAM, 'team', { required: true });
  const extensionVersion = clampString(body.extensionVersion, MAX_VERSION, 'extensionVersion', { required: true });
  const createdAt = new Date().toISOString();

  if (type === 'general') {
    return {
      type,
      row: [
        clampString(body.problemText, MAX_GENERAL_PROBLEM, 'problemText', { required: true }),
        STATUS_RECEIVED,
        '',
        createdAt,
        extensionVersion,
        team,
        type,
      ],
      sheetName: readEnv('GOOGLE_GENERAL_FEEDBACK_SHEET', GENERAL_SHEET_DEFAULT),
    };
  }

  if (type === 'ticket') {
    return {
      type,
      row: [
        clampString(body.ticketUrl, MAX_TICKET_URL, 'ticketUrl'),
        clampString(body.problemText, MAX_TICKET_PROBLEM, 'problemText', { required: true }),
        clampString(body.expectedText, MAX_TICKET_EXPECTED, 'expectedText', { required: true }),
        clampString(body.llmResponse, MAX_TICKET_LLM_RESPONSE, 'llmResponse'),
        STATUS_RECEIVED,
        '',
        clampString(body.ticketId, MAX_TICKET_ID, 'ticketId'),
        createdAt,
        extensionVersion,
        team,
        type,
      ],
      sheetName: readEnv('GOOGLE_TICKET_FEEDBACK_SHEET', TICKET_SHEET_DEFAULT),
    };
  }

  throw new Error('Unsupported feedback type.');
}

async function appendRow({ sheetName, row }) {
  const spreadsheetId = readEnv('GOOGLE_SPREADSHEET_ID');
  if (!spreadsheetId) {
    throw new Error('GOOGLE_SPREADSHEET_ID is not configured.');
  }

  const auth = new google.auth.GoogleAuth({
    credentials: parseServiceAccount(),
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  const sheets = google.sheets({ version: 'v4', auth });

  await ensureSheetExists(sheets, spreadsheetId, sheetName);

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${sheetName}!A1`,
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: {
      values: [row],
    },
  });
}

async function ensureSheetExists(sheets, spreadsheetId, sheetName) {
  const spreadsheet = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: 'sheets.properties.title',
  });

  const exists = Array.isArray(spreadsheet.data?.sheets) && spreadsheet.data.sheets.some((sheet) => {
    return sheet.properties?.title === sheetName;
  });

  if (exists) return;

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          addSheet: {
            properties: {
              title: sheetName,
            },
          },
        },
      ],
    },
  });
}

module.exports = async (req, res) => {
  const expectedToken = process.env.FEEDBACK_TOKEN;

  if (req.method !== 'POST') {
    return json(res, 405, { error: 'Method not allowed.' });
  }

  if (!expectedToken) {
    return json(res, 500, { error: 'FEEDBACK_TOKEN is not configured on the server.' });
  }

  if (req.headers['x-feedback-token'] !== expectedToken) {
    return json(res, 401, { error: 'Unauthorized' });
  }

  try {
    const normalized = normalizePayload(req.body);
    await appendRow(normalized);
    return json(res, 200, { ok: true });
  } catch (error) {
    const message = error?.message || 'Failed to append feedback.';
    const status = message.startsWith('Field "') || message === 'Invalid payload.' || message === 'Unsupported feedback type.'
      ? 400
      : 500;
    return json(res, status, { error: message });
  }
};
