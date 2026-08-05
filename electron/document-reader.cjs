'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const {
  Worker,
  isMainThread,
  parentPort,
  workerData,
} = require('node:worker_threads');

const TEXT_EXTENSIONS = new Set([
  '.txt',
  '.md',
  '.markdown',
  '.tex',
  '.html',
  '.htm',
  '.css',
  '.scss',
  '.js',
  '.jsx',
  '.ts',
  '.tsx',
  '.json',
  '.csv',
  '.ipynb',
]);
const OFFICE_TYPES = new Map([
  ['.pdf', 'pdf'],
  ['.docx', 'docx'],
  ['.rtf', 'rtf'],
  ['.epub', 'epub'],
]);
const UNSUPPORTED_EXTENSIONS = new Set(['.doc', '.hwp', '.hwpx']);

const MAX_EXCERPT_CHARS = 50_000;
const MAX_NORMALIZED_CHARS = 2_000_000;
const MAX_SOURCE_SCAN_CHARS = 4_000_000;
const MAX_TEXT_FILE_BYTES = 8 * 1024 * 1024;
const OFFICE_FILE_LIMITS = Object.freeze({
  pdf: 48 * 1024 * 1024,
  docx: 32 * 1024 * 1024,
  rtf: 16 * 1024 * 1024,
  epub: 32 * 1024 * 1024,
});
const MAX_UNCOMPRESSED_BYTES = 96 * 1024 * 1024;
const MAX_ZIP_ENTRIES = 4_096;
const MAX_TABLE_CELLS = 100_000;
const OFFICE_PARSE_TIMEOUT_MS = 30_000;
const MAX_WARNING_CHARS = 1_000;
const OFFICE_WORKER_MODE = 'studyquest-office-parser-v1';

class DocumentReadError extends Error {
  constructor(code, publicMessage) {
    super(publicMessage);
    this.name = 'DocumentReadError';
    this.code = code;
    this.publicMessage = publicMessage;
  }
}

function truncateCodeUnits(value, maxLength) {
  let result = String(value ?? '').slice(0, maxLength);
  if (result && /[\uD800-\uDBFF]/.test(result.at(-1))) result = result.slice(0, -1);
  return result;
}

function cleanWarning(value) {
  return truncateCodeUnits(
    String(value ?? '')
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g, '')
      .replace(/\s+/g, ' ')
      .trim(),
    MAX_WARNING_CHARS,
  );
}

function mergeWarnings(...values) {
  const messages = [];
  for (const value of values.flat(Infinity)) {
    const message = cleanWarning(
      value && typeof value === 'object' && typeof value.message === 'string'
        ? value.message
        : value,
    );
    if (message && !messages.includes(message)) messages.push(message);
  }
  return cleanWarning(messages.join(' '));
}

function cleanExtractedText(value) {
  const source = String(value ?? '');
  const sourceWasLimited = source.length > MAX_SOURCE_SCAN_CHARS;
  let controlsRemoved = false;
  let text = source
    .slice(0, MAX_SOURCE_SCAN_CHARS)
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, () => {
      controlsRemoved = true;
      return '';
    });

  if (typeof text.toWellFormed === 'function') text = text.toWellFormed();
  text = text.trim();

  const normalizedWasLimited = text.length > MAX_NORMALIZED_CHARS;
  if (normalizedWasLimited) text = truncateCodeUnits(text, MAX_NORMALIZED_CHARS);

  return {
    text,
    controlsRemoved,
    wasLimited: sourceWasLimited || normalizedWasLimited,
  };
}

function decodeTextBuffer(buffer) {
  if (!Buffer.isBuffer(buffer)) throw new TypeError('buffer must be a Buffer.');

  let decoded;
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    decoded = buffer.subarray(2).toString('utf16le');
  } else if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    const body = buffer.subarray(2);
    const swapped = Buffer.allocUnsafe(body.length - (body.length % 2));
    for (let index = 0; index < swapped.length; index += 2) {
      swapped[index] = body[index + 1];
      swapped[index + 1] = body[index];
    }
    decoded = swapped.toString('utf16le');
  } else {
    const start = buffer.length >= 3
      && buffer[0] === 0xef
      && buffer[1] === 0xbb
      && buffer[2] === 0xbf
      ? 3
      : 0;
    decoded = buffer.subarray(start).toString('utf8');
  }

  const nullMatches = decoded.match(/\u0000/g)?.length ?? 0;
  if (nullMatches > Math.max(16, Math.floor(decoded.length * 0.01))) {
    throw new DocumentReadError(
      'unsupported_encoding',
      '텍스트 인코딩을 안전하게 판별하지 못했습니다. UTF-8 또는 BOM이 있는 UTF-16 파일을 사용해 주세요.',
    );
  }
  return decoded;
}

async function readFileWithinLimit(filePath, maxBytes, expectedSize) {
  if (Number.isFinite(expectedSize) && expectedSize > maxBytes) {
    throw new DocumentReadError(
      'file_too_large',
      `파일이 본문 추출 크기 제한(${Math.floor(maxBytes / 1024 / 1024)}MB)을 초과합니다.`,
    );
  }

  const handle = await fs.promises.open(filePath, fs.constants.O_RDONLY);
  try {
    const before = await handle.stat();
    if (!before.isFile()) {
      throw new DocumentReadError('not_file', '일반 파일만 본문을 추출할 수 있습니다.');
    }
    if (!Number.isSafeInteger(before.size) || before.size > maxBytes) {
      throw new DocumentReadError(
        'file_too_large',
        `파일이 본문 추출 크기 제한(${Math.floor(maxBytes / 1024 / 1024)}MB)을 초과합니다.`,
      );
    }

    const buffer = Buffer.allocUnsafe(before.size);
    let offset = 0;
    while (offset < buffer.length) {
      const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, offset);
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    const after = await handle.stat();
    if (offset !== before.size || after.size !== before.size) {
      throw new DocumentReadError(
        'file_changed',
        '파일이 읽는 동안 변경되었습니다. 저장을 마친 뒤 다시 등록해 주세요.',
      );
    }
    return buffer;
  } finally {
    await handle.close();
  }
}

function readyResult(rawText, warnings = []) {
  const normalized = cleanExtractedText(rawText);
  const warning = mergeWarnings(
    warnings,
    normalized.controlsRemoved ? '안전하지 않은 제어 문자를 제거했습니다.' : '',
    normalized.wasLimited
      ? `추출 텍스트를 안전 한도 ${MAX_NORMALIZED_CHARS.toLocaleString('en-US')}자에서 잘랐습니다.`
      : '',
    normalized.text.length > MAX_EXCERPT_CHARS
      ? `미리보기에는 앞 ${MAX_EXCERPT_CHARS.toLocaleString('en-US')}자만 포함됩니다.`
      : '',
    !normalized.text ? '문서에서 추출 가능한 텍스트를 찾지 못했습니다. 이미지 OCR은 사용하지 않습니다.' : '',
  );

  return {
    excerpt: truncateCodeUnits(normalized.text, MAX_EXCERPT_CHARS),
    extractedChars: normalized.text.length,
    extractionStatus: 'ready',
    ...(warning ? { warning } : {}),
  };
}

function unsupportedResult(extension) {
  const label = extension || '이 형식';
  return {
    excerpt: '',
    extractedChars: 0,
    extractionStatus: 'unsupported',
    warning: `${label} 문서는 현재 안전한 로컬 본문 추출을 지원하지 않습니다. PDF, DOCX, RTF, EPUB 또는 텍스트 형식으로 변환해 주세요.`,
  };
}

function failedResult(error) {
  const issueMessage = error?.officeIssue?.message;
  const message = error instanceof DocumentReadError
    ? error.publicMessage
    : error?.name === 'AbortError'
      ? `문서 분석이 ${Math.floor(OFFICE_PARSE_TIMEOUT_MS / 1000)}초 제한을 초과했습니다.`
      : mergeWarnings(issueMessage, error?.message)
        || '문서 본문을 안전하게 추출하지 못했습니다.';
  return {
    excerpt: '',
    extractedChars: 0,
    extractionStatus: 'failed',
    warning: cleanWarning(message),
  };
}

async function parseOfficeInWorker(buffer, fileType) {
  const officeParser = require('officeparser');
  const warnings = [];
  const parserConfig = {
    fileType,
    extractAttachments: false,
    ocr: false,
    includeRawContent: false,
    serializeRawContent: false,
    ignoreComments: true,
    ignoreInternalLinks: true,
    outputErrorToConsole: false,
    onWarning: (issue) => warnings.push(issue),
    decompressionLimits: {
      maxUncompressedBytes: MAX_UNCOMPRESSED_BYTES,
      maxZipEntries: MAX_ZIP_ENTRIES,
      maxTableCells: MAX_TABLE_CELLS,
    },
  };
  if (fileType === 'pdf') {
    let localPdfWorker;
    try {
      localPdfWorker = require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs');
    } catch {
      throw new DocumentReadError(
        'pdf_worker_missing',
        '로컬 PDF 분석 구성요소를 찾지 못해 네트워크 대체 경로를 사용하지 않고 중단했습니다.',
      );
    }
    parserConfig.pdfWorkerSrc = pathToFileURL(localPdfWorker).href;
  }

  const ast = await officeParser.parseOffice(buffer, parserConfig);
  const generated = await ast.to('text', {
    includeImages: false,
    includeCharts: false,
    includeFormatting: false,
    renderMetadata: false,
    ignoreInternalLinks: true,
    textConfig: {
      newlineDelimiter: '\n',
      preserveLayout: false,
      renderNotes: true,
    },
  });
  return readyResult(
    typeof generated.value === 'string' ? generated.value : '',
    [...warnings, ...(ast.warnings ?? []), ...(generated.messages ?? [])],
  );
}

function extractOfficeBuffer(buffer, fileType) {
  const payload = buffer.byteOffset === 0 && buffer.byteLength === buffer.buffer.byteLength
    ? buffer.buffer
    : buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer;
    let worker;

    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      worker?.removeAllListeners();
      if (worker) void worker.terminate().catch(() => undefined);
      if (error) reject(error);
      else resolve(result);
    };

    try {
      worker = new Worker(__filename, {
        name: 'StudyQuest document parser',
        workerData: { mode: OFFICE_WORKER_MODE, fileType, payload },
        transferList: [payload],
        resourceLimits: {
          maxOldGenerationSizeMb: 256,
          maxYoungGenerationSizeMb: 32,
          stackSizeMb: 4,
        },
      });
    } catch (error) {
      finish(error);
      return;
    }

    timer = setTimeout(() => {
      finish(new DocumentReadError(
        'timeout',
        `문서 분석이 ${Math.floor(OFFICE_PARSE_TIMEOUT_MS / 1000)}초 제한을 초과했습니다.`,
      ));
    }, OFFICE_PARSE_TIMEOUT_MS);
    timer.unref?.();

    worker.once('message', (message) => {
      if (!message?.ok) {
        finish(new DocumentReadError(
          message?.error?.code || 'office_parse_failed',
          cleanWarning(message?.error?.message) || '문서 본문을 안전하게 추출하지 못했습니다.',
        ));
        return;
      }
      const result = message.result;
      if (
        !result
        || result.extractionStatus !== 'ready'
        || typeof result.excerpt !== 'string'
        || result.excerpt.length > MAX_EXCERPT_CHARS
        || !Number.isSafeInteger(result.extractedChars)
        || result.extractedChars < result.excerpt.length
        || result.extractedChars > MAX_NORMALIZED_CHARS
        || (result.warning !== undefined && (
          typeof result.warning !== 'string' || result.warning.length > MAX_WARNING_CHARS
        ))
      ) {
        finish(new DocumentReadError('invalid_worker_result', '문서 분석 결과가 안전 검증을 통과하지 못했습니다.'));
        return;
      }
      finish(null, result);
    });
    worker.once('error', (error) => {
      const message = error?.code === 'ERR_WORKER_OUT_OF_MEMORY'
        ? '문서가 안전 메모리 한도를 초과했습니다.'
        : cleanWarning(error?.message) || '격리된 문서 분석 프로세스가 실패했습니다.';
      finish(new DocumentReadError('worker_failed', message));
    });
    worker.once('exit', (code) => {
      if (!settled) {
        finish(new DocumentReadError(
          'worker_exited',
          `격리된 문서 분석 프로세스가 결과 없이 종료되었습니다(code ${code}).`,
        ));
      }
    });
  });
}

async function runOfficeWorker() {
  try {
    if (!(workerData?.payload instanceof ArrayBuffer) || !OFFICE_FILE_LIMITS[workerData.fileType]) {
      throw new DocumentReadError('invalid_worker_input', '문서 분석 작업 입력이 올바르지 않습니다.');
    }
    const result = await parseOfficeInWorker(Buffer.from(workerData.payload), workerData.fileType);
    parentPort.postMessage({ ok: true, result });
  } catch (error) {
    parentPort.postMessage({
      ok: false,
      error: {
        code: error?.code || error?.officeIssue?.code || 'office_parse_failed',
        message: cleanWarning(
          error?.publicMessage
          || error?.officeIssue?.message
          || error?.message
          || '문서 본문을 안전하게 추출하지 못했습니다.',
        ),
      },
    });
  } finally {
    parentPort.close();
  }
}

async function extractDocument(filePath, options = {}) {
  const extension = String(options.extension ?? path.extname(filePath)).toLowerCase();
  if (UNSUPPORTED_EXTENSIONS.has(extension)) return unsupportedResult(extension);
  if (!TEXT_EXTENSIONS.has(extension) && !OFFICE_TYPES.has(extension)) {
    return unsupportedResult(extension);
  }

  try {
    if (TEXT_EXTENSIONS.has(extension)) {
      const buffer = await readFileWithinLimit(filePath, MAX_TEXT_FILE_BYTES, options.size);
      return readyResult(decodeTextBuffer(buffer));
    }

    const fileType = OFFICE_TYPES.get(extension);
    const buffer = await readFileWithinLimit(filePath, OFFICE_FILE_LIMITS[fileType], options.size);
    return await extractOfficeBuffer(buffer, fileType);
  } catch (error) {
    return failedResult(error);
  }
}

async function runSelfCheck() {
  const assert = require('node:assert/strict');

  const direct = readyResult(decodeTextBuffer(Buffer.from('\uFEFFStudyQuest\r\ncontrol:\u0000ok', 'utf8')));
  assert.equal(direct.extractionStatus, 'ready');
  assert.equal(direct.excerpt, 'StudyQuest\ncontrol:ok');
  assert.ok(direct.extractedChars > 0);
  assert.ok(direct.excerpt.length <= MAX_EXCERPT_CHARS);

  const excerptLimited = readyResult('x'.repeat(MAX_EXCERPT_CHARS + 123));
  assert.equal(excerptLimited.excerpt.length, MAX_EXCERPT_CHARS);
  assert.equal(excerptLimited.extractedChars, MAX_EXCERPT_CHARS + 123);

  const unsupported = await extractDocument('not-opened.doc');
  assert.equal(unsupported.extractionStatus, 'unsupported');
  assert.equal(unsupported.extractedChars, 0);

  const rtf = Buffer.from('{\\rtf1\\ansi StudyQuest local extraction}', 'ascii');
  const office = await extractOfficeBuffer(rtf, 'rtf');
  assert.equal(office.extractionStatus, 'ready');
  assert.match(office.excerpt, /StudyQuest local extraction/);

  return {
    ok: true,
    directChars: direct.extractedChars,
    officeChars: office.extractedChars,
    excerptLimit: MAX_EXCERPT_CHARS,
  };
}

module.exports = {
  extractDocument,
  cleanExtractedText,
  decodeTextBuffer,
  runSelfCheck,
  limits: Object.freeze({
    maxExcerptChars: MAX_EXCERPT_CHARS,
    maxNormalizedChars: MAX_NORMALIZED_CHARS,
    maxTextFileBytes: MAX_TEXT_FILE_BYTES,
    maxUncompressedBytes: MAX_UNCOMPRESSED_BYTES,
    maxZipEntries: MAX_ZIP_ENTRIES,
    officeParseTimeoutMs: OFFICE_PARSE_TIMEOUT_MS,
  }),
};

if (!isMainThread && workerData?.mode === OFFICE_WORKER_MODE) {
  runOfficeWorker().catch((error) => {
    process.stderr.write(`${cleanWarning(error?.message || error)}\n`);
    process.exitCode = 1;
  });
} else if (require.main === module) {
  runSelfCheck()
    .then((result) => process.stdout.write(`${JSON.stringify(result)}\n`))
    .catch((error) => {
      process.stderr.write(`${cleanWarning(error?.stack || error?.message || error)}\n`);
      process.exitCode = 1;
    });
}
