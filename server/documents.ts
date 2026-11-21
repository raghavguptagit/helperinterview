import path from 'node:path';
import * as pdfParseModule from 'pdf-parse';
import mammoth from 'mammoth';

export const MAX_UPLOAD_SIZE_BYTES = 10 * 1024 * 1024; // 10MB

export class DocumentValidationError extends Error {
  status: number;
  code: string;

  constructor(message: string, status = 400, code = 'DOCUMENT_VALIDATION_ERROR') {
    super(message);
    this.name = 'DocumentValidationError';
    this.status = status;
    this.code = code;
  }
}

export function sanitizeFilename(rawName: string | undefined): string {
  const base = path.basename(rawName || 'uploaded_document.txt');
  const cleaned = base.replace(/[^\w.\- ()]/g, '_').trim();
  return cleaned || 'uploaded_document.txt';
}

export function detectFileKind(mimetype: string, filename: string): 'pdf' | 'docx' | 'txt' | 'legacy_doc' | 'unknown' {
  const lowerName = (filename || '').toLowerCase();
  const lowerMime = (mimetype || '').toLowerCase();

  if (lowerName.endsWith('.pdf') || lowerMime === 'application/pdf') {
    return 'pdf';
  }
  if (
    lowerName.endsWith('.docx') ||
    lowerMime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ) {
    return 'docx';
  }
  if (lowerName.endsWith('.doc') || lowerMime === 'application/msword') {
    return 'legacy_doc';
  }
  if (lowerName.endsWith('.txt') || lowerMime === 'text/plain') {
    return 'txt';
  }
  return 'unknown';
}

export function validateUploadedFile(file: {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}): 'pdf' | 'docx' | 'txt' {
  if (!file || !file.buffer) {
    throw new DocumentValidationError('No file was received.', 400, 'VALIDATION_ERROR');
  }

  if (file.size === 0 || file.buffer.length === 0) {
    throw new DocumentValidationError('The uploaded file is empty (0 bytes). Please upload a non-empty PDF, DOCX, or TXT file.', 400, 'EMPTY_FILE');
  }

  if (file.size > MAX_UPLOAD_SIZE_BYTES) {
    throw new DocumentValidationError('File is too large. Maximum allowed file size is 10MB.', 413, 'FILE_TOO_LARGE');
  }

  const kind = detectFileKind(file.mimetype, file.originalname);
  if (kind === 'legacy_doc') {
    throw new DocumentValidationError(
      'Legacy binary .doc format is not supported. Please save/export as .docx, .pdf, or .txt and upload again.',
      400,
      'UNSUPPORTED_FORMAT'
    );
  }
  if (kind === 'unknown') {
    throw new DocumentValidationError(
      'Unsupported file format. Please upload a valid PDF (.pdf), Word (.docx), or plain text (.txt) file.',
      400,
      'UNSUPPORTED_FORMAT'
    );
  }

  // Magic-byte signature checks
  if (kind === 'pdf') {
    const header = file.buffer.subarray(0, 1024).toString('latin1');
    if (!header.includes('%PDF-')) {
      throw new DocumentValidationError(
        'Invalid or corrupted PDF file (missing %PDF header). Please upload a valid PDF document.',
        422,
        'CORRUPTED_PDF'
      );
    }
  } else if (kind === 'docx') {
    // OOXML DOCX files are ZIP archives starting with PK\x03\x04 (or PK\x05\x06)
    const isZip =
      file.buffer.length >= 4 &&
      file.buffer[0] === 0x50 &&
      file.buffer[1] === 0x4b &&
      (file.buffer[2] === 0x03 || file.buffer[2] === 0x05);
    if (!isZip) {
      throw new DocumentValidationError(
        'Invalid or corrupted DOCX file. Please ensure the file is a valid Word (.docx) document.',
        422,
        'CORRUPTED_DOCX'
      );
    }
  } else if (kind === 'txt') {
    // Reject binary files disguised as .txt (contains null bytes)
    const sample = file.buffer.subarray(0, 4096);
    if (sample.includes(0x00)) {
      throw new DocumentValidationError(
        'The uploaded .txt file appears to contain binary data rather than readable text.',
        422,
        'INVALID_TEXT_FILE'
      );
    }
  }

  return kind;
}

export async function extractTextFromBuffer(
  buffer: Buffer,
  mimetype: string,
  filename: string
): Promise<string> {
  const kind = validateUploadedFile({
    originalname: filename,
    mimetype,
    size: buffer.length,
    buffer,
  });

  if (kind === 'pdf') {
    const PDFParseClass: any = (pdfParseModule as any).PDFParse || (pdfParseModule as any).default;
    if (typeof PDFParseClass !== 'function') {
      throw new DocumentValidationError('PDF parser unavailable on server.', 500, 'PARSER_UNAVAILABLE');
    }

    const parser = new PDFParseClass({ data: buffer });
    try {
      if (typeof parser.load === 'function') {
        await parser.load();
      }
      const rawResult: any = typeof parser.getText === 'function' ? await parser.getText() : '';
      let extracted = '';
      if (typeof rawResult === 'string') {
        extracted = rawResult;
      } else if (rawResult && typeof rawResult.text === 'string') {
        extracted = rawResult.text;
      } else if (rawResult && Array.isArray(rawResult.pages)) {
        extracted = rawResult.pages.map((p: any) => p?.text || '').join('\n');
      }

      // Remove pdf-parse page footer markers like "-- 1 of 2 --"
      const cleaned = extracted
        .replace(/\n*--\s*\d+\s+of\s+\d+\s*--\s*\n*/g, '\n')
        .replace(/\r\n/g, '\n')
        .trim();

      if (!cleaned || cleaned.length < 10) {
        throw new DocumentValidationError(
          'No readable text could be extracted from this PDF (it may be a scanned/image-only or empty PDF). Please upload a text-based PDF, DOCX, TXT, or paste the text manually.',
          422,
          'EMPTY_EXTRACTED_TEXT'
        );
      }
      return cleaned;
    } catch (err: any) {
      if (err instanceof DocumentValidationError) throw err;
      throw new DocumentValidationError(
        'Could not parse this PDF file. It may be corrupted, encrypted, or password-protected.',
        422,
        'CORRUPTED_PDF'
      );
    } finally {
      try {
        await parser.destroy?.();
      } catch {
        // Ignore cleanup errors
      }
    }
  }

  if (kind === 'docx') {
    try {
      const result = await mammoth.extractRawText({ buffer });
      const cleaned = (result?.value || '').replace(/\r\n/g, '\n').trim();
      if (!cleaned || cleaned.length < 10) {
        throw new DocumentValidationError(
          'This DOCX file appears to be empty or contains no readable text.',
          422,
          'EMPTY_EXTRACTED_TEXT'
        );
      }
      return cleaned;
    } catch (err: any) {
      if (err instanceof DocumentValidationError) throw err;
      throw new DocumentValidationError(
        'Could not parse this DOCX file. Please ensure it is not corrupted or password-protected.',
        422,
        'CORRUPTED_DOCX'
      );
    }
  }

  // Plain text
  const text = buffer.toString('utf-8').replace(/\r\n/g, '\n').trim();
  if (!text || text.length < 10) {
    throw new DocumentValidationError(
      'The uploaded text file is empty or too short (minimum 10 characters required).',
      422,
      'EMPTY_EXTRACTED_TEXT'
    );
  }
  return text;
}
