const { google } = require('googleapis');

const GENERAL_SHEET_DEFAULT = 'general_feedback';
const TICKET_SHEET_DEFAULT = 'ticket_feedback';
const STATUS_RECEIVED = 'получено';
const STATUS_IN_PROGRESS = 'в работе';
const STATUS_DONE = 'выполнено';
const STATUS_DEFERRED = 'отложено';
const STATUS_VALUES = [STATUS_RECEIVED, STATUS_IN_PROGRESS, STATUS_DONE, STATUS_DEFERRED];

const MAX_GENERAL_PROBLEM = 2000;
const MAX_TICKET_PROBLEM = 4000;
const MAX_TICKET_EXPECTED = 4000;
const MAX_TICKET_LLM_RESPONSE = 20000;
const MAX_TICKET_ID = 200;
const MAX_TICKET_URL = 2000;
const MAX_TEAM = 100;
const MAX_VERSION = 100;

const SHEET_CONFIGS = {
  general: {
    defaultTitle: GENERAL_SHEET_DEFAULT,
    headers: ['problem_text', 'status', 'comment', 'created_at', 'extension_version', 'team', 'report_type'],
    columnWidths: [420, 140, 240, 190, 160, 120, 120],
    statusColumnIndex: 1,
    llmColumnIndex: null,
  },
  ticket: {
    defaultTitle: TICKET_SHEET_DEFAULT,
    headers: ['ticket_url', 'problem_text', 'expected_text', 'llm_response', 'status', 'comment', 'ticket_id', 'created_at', 'extension_version', 'team', 'report_type'],
    columnWidths: [280, 340, 340, 560, 140, 240, 120, 190, 160, 120, 120],
    statusColumnIndex: 4,
    llmColumnIndex: 3,
  },
};

function json(res, status, payload) {
  applyCors(res);
  res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.send(JSON.stringify(payload));
}

function applyCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Feedback-Token');
  res.setHeader('Access-Control-Max-Age', '86400');
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
  } catch (_) {
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

function toColor(red, green, blue) {
  return { red, green, blue };
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
      sheetType: 'general',
      sheetName: readEnv('GOOGLE_GENERAL_FEEDBACK_SHEET', GENERAL_SHEET_DEFAULT),
      row: [
        clampString(body.problemText, MAX_GENERAL_PROBLEM, 'problemText', { required: true }),
        STATUS_RECEIVED,
        '',
        createdAt,
        extensionVersion,
        team,
        type,
      ],
    };
  }

  if (type === 'ticket') {
    return {
      type,
      sheetType: 'ticket',
      sheetName: readEnv('GOOGLE_TICKET_FEEDBACK_SHEET', TICKET_SHEET_DEFAULT),
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
    };
  }

  throw new Error('Unsupported feedback type.');
}

async function appendRow({ sheetType, sheetName, row }) {
  const spreadsheetId = readEnv('GOOGLE_SPREADSHEET_ID');
  if (!spreadsheetId) {
    throw new Error('GOOGLE_SPREADSHEET_ID is not configured.');
  }

  const auth = new google.auth.GoogleAuth({
    credentials: parseServiceAccount(),
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  const sheets = google.sheets({ version: 'v4', auth });
  const sheetConfig = SHEET_CONFIGS[sheetType];

  const sheetMeta = await ensureSheetExists(sheets, spreadsheetId, sheetName);
  await ensureSheetStructure(sheets, spreadsheetId, sheetMeta, sheetConfig);

  const appendResponse = await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${sheetName}!A1`,
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: {
      values: [row],
    },
  });

  const appendedRowNumber = parseUpdatedRowNumber(appendResponse.data?.updates?.updatedRange);
  if (appendedRowNumber !== null) {
    await autoResizeAppendedRow(sheets, spreadsheetId, sheetMeta.sheetId, appendedRowNumber);
  }
}

async function ensureSheetExists(sheets, spreadsheetId, sheetName) {
  const spreadsheet = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: 'sheets(properties(sheetId,title,index),conditionalFormats)',
  });

  const existing = Array.isArray(spreadsheet.data?.sheets)
    ? spreadsheet.data.sheets.find((sheet) => sheet.properties?.title === sheetName)
    : null;

  if (existing) {
    return {
      sheetId: existing.properties.sheetId,
      title: existing.properties.title,
      conditionalFormatCount: Array.isArray(existing.conditionalFormats) ? existing.conditionalFormats.length : 0,
    };
  }

  const createResponse = await sheets.spreadsheets.batchUpdate({
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

  const createdSheet = createResponse.data?.replies?.[0]?.addSheet?.properties;
  return {
    sheetId: createdSheet?.sheetId,
    title: createdSheet?.title || sheetName,
    conditionalFormatCount: 0,
  };
}

async function ensureSheetStructure(sheets, spreadsheetId, sheetMeta, sheetConfig) {
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${sheetMeta.title}!A1`,
    valueInputOption: 'RAW',
    requestBody: {
      values: [sheetConfig.headers],
    },
  });

  const requests = [];

  requests.push({
    updateSheetProperties: {
      properties: {
        sheetId: sheetMeta.sheetId,
        gridProperties: {
          frozenRowCount: 1,
        },
      },
      fields: 'gridProperties.frozenRowCount',
    },
  });

  requests.push({
    repeatCell: {
      range: {
        sheetId: sheetMeta.sheetId,
        startRowIndex: 0,
        endRowIndex: 1,
      },
      cell: {
        userEnteredFormat: {
          backgroundColor: toColor(0.91, 0.94, 0.98),
          textFormat: {
            bold: true,
            foregroundColor: toColor(0.10, 0.14, 0.22),
          },
          horizontalAlignment: 'CENTER',
          verticalAlignment: 'MIDDLE',
          wrapStrategy: 'WRAP',
        },
      },
      fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment,wrapStrategy)',
    },
  });

  requests.push({
    updateDimensionProperties: {
      range: {
        sheetId: sheetMeta.sheetId,
        dimension: 'ROWS',
        startIndex: 0,
        endIndex: 1,
      },
      properties: {
        pixelSize: 36,
      },
      fields: 'pixelSize',
    },
  });

  for (let index = 0; index < sheetConfig.columnWidths.length; index += 1) {
    requests.push({
      updateDimensionProperties: {
        range: {
          sheetId: sheetMeta.sheetId,
          dimension: 'COLUMNS',
          startIndex: index,
          endIndex: index + 1,
        },
        properties: {
          pixelSize: sheetConfig.columnWidths[index],
        },
        fields: 'pixelSize',
      },
    });
  }

  requests.push({
    repeatCell: {
      range: {
        sheetId: sheetMeta.sheetId,
        startRowIndex: 1,
      },
      cell: {
        userEnteredFormat: {
          verticalAlignment: 'TOP',
          wrapStrategy: 'WRAP',
        },
      },
      fields: 'userEnteredFormat(verticalAlignment,wrapStrategy)',
    },
  });

  if (sheetConfig.llmColumnIndex !== null) {
    requests.push({
      repeatCell: {
        range: {
          sheetId: sheetMeta.sheetId,
          startRowIndex: 1,
          startColumnIndex: sheetConfig.llmColumnIndex,
          endColumnIndex: sheetConfig.llmColumnIndex + 1,
        },
        cell: {
          userEnteredFormat: {
            verticalAlignment: 'TOP',
            wrapStrategy: 'CLIP',
          },
        },
        fields: 'userEnteredFormat(verticalAlignment,wrapStrategy)',
      },
    });
  }

  requests.push({
    setDataValidation: {
      range: {
        sheetId: sheetMeta.sheetId,
        startRowIndex: 1,
        startColumnIndex: sheetConfig.statusColumnIndex,
        endColumnIndex: sheetConfig.statusColumnIndex + 1,
      },
      rule: {
        condition: {
          type: 'ONE_OF_LIST',
          values: STATUS_VALUES.map((status) => ({ userEnteredValue: status })),
        },
        strict: true,
        showCustomUi: true,
      },
    },
  });

  requests.push({
    repeatCell: {
      range: {
        sheetId: sheetMeta.sheetId,
        startRowIndex: 1,
        startColumnIndex: sheetConfig.statusColumnIndex,
        endColumnIndex: sheetConfig.statusColumnIndex + 1,
      },
      cell: {
        userEnteredFormat: {
          horizontalAlignment: 'CENTER',
          verticalAlignment: 'MIDDLE',
          textFormat: {
            bold: true,
          },
        },
      },
      fields: 'userEnteredFormat(horizontalAlignment,verticalAlignment,textFormat.bold)',
    },
  });

  for (let index = sheetMeta.conditionalFormatCount - 1; index >= 0; index -= 1) {
    requests.push({
      deleteConditionalFormatRule: {
        sheetId: sheetMeta.sheetId,
        index,
      },
    });
  }

  for (const statusRule of buildStatusRules(sheetMeta.sheetId, sheetConfig.statusColumnIndex)) {
    requests.push(statusRule);
  }

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests },
  });
}

function buildStatusRules(sheetId, statusColumnIndex) {
  return [
    createStatusRule(sheetId, statusColumnIndex, STATUS_RECEIVED, toColor(0.99, 0.95, 0.80), toColor(0.55, 0.36, 0.00)),
    createStatusRule(sheetId, statusColumnIndex, STATUS_IN_PROGRESS, toColor(0.86, 0.92, 0.99), toColor(0.05, 0.29, 0.58)),
    createStatusRule(sheetId, statusColumnIndex, STATUS_DONE, toColor(0.85, 0.94, 0.83), toColor(0.11, 0.46, 0.14)),
    createStatusRule(sheetId, statusColumnIndex, STATUS_DEFERRED, toColor(0.92, 0.92, 0.92), toColor(0.29, 0.29, 0.29)),
  ];
}

function createStatusRule(sheetId, statusColumnIndex, statusValue, backgroundColor, foregroundColor) {
  return {
    addConditionalFormatRule: {
      rule: {
        ranges: [
          {
            sheetId,
            startRowIndex: 1,
            startColumnIndex: statusColumnIndex,
            endColumnIndex: statusColumnIndex + 1,
          },
        ],
        booleanRule: {
          condition: {
            type: 'TEXT_EQ',
            values: [{ userEnteredValue: statusValue }],
          },
          format: {
            backgroundColor,
            textFormat: {
              bold: true,
              foregroundColor,
            },
          },
        },
      },
      index: 0,
    },
  };
}

function parseUpdatedRowNumber(updatedRange) {
  if (typeof updatedRange !== 'string') return null;
  const match = updatedRange.match(/![A-Z]+(\d+)(?::[A-Z]+(\d+))?$/);
  if (!match) return null;
  return Number.parseInt(match[1], 10) || null;
}

async function autoResizeAppendedRow(sheets, spreadsheetId, sheetId, oneBasedRowNumber) {
  const startIndex = oneBasedRowNumber - 1;
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          autoResizeDimensions: {
            dimensions: {
              sheetId,
              dimension: 'ROWS',
              startIndex,
              endIndex: startIndex + 1,
            },
          },
        },
      ],
    },
  });
}

module.exports = async (req, res) => {
  const expectedToken = process.env.FEEDBACK_TOKEN;

  if (req.method === 'OPTIONS') {
    applyCors(res);
    return res.status(204).end();
  }

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
