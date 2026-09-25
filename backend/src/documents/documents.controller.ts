import {
  Controller,
  Post,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  Body,
  Request,
  BadRequestException,
  Version,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { createHash } from 'crypto';
import { extname } from 'path';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiConsumes,
  ApiBody,
} from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { AuthGuard } from '@nestjs/passport';
import { DocumentsService } from './documents.service';
import { ClamScanService } from './clam-scan.service';
import { UploadChunkDto, UploadCompleteDto } from './dto/upload-chunk.dto';
import { User } from '../auth/entities/user.entity';

interface AuthRequest extends Request {
  user: User;
}

/**
 * Allowed MIME types for uploaded trade documents.
 * Maps each permitted MIME type to its expected file extension(s).
 */
const ALLOWED_MIME_TYPES: ReadonlySet<string> = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
]);

/**
 * File extensions that are explicitly blocked regardless of MIME type.
 * Prevents script injection and executable uploads masquerading as documents.
 * Covers common script, executable, and web-exploit extensions.
 */
const BLOCKED_EXTENSIONS: ReadonlySet<string> = new Set([
  '.exe',
  '.bat',
  '.cmd',
  '.sh',
  '.ps1',
  '.psm1',
  '.vbs',
  '.vbe',
  '.js',
  '.jsx',
  '.ts',
  '.tsx',
  '.mjs',
  '.cjs',
  '.php',
  '.asp',
  '.aspx',
  '.jsp',
  '.py',
  '.rb',
  '.pl',
  '.lua',
  '.dll',
  '.so',
  '.dylib',
  '.elf',
  '.svg',
  '.xml',
  '.html',
  '.htm',
  '.xhtml',
  '.zip',
  '.tar',
  '.gz',
  '.7z',
  '.rar',
]);

/**
 * Maximum allowed filename length. Long filenames can be used to exhaust
 * path buffers or obscure the real extension.
 */
const MAX_FILENAME_LENGTH = 255;

/**
 * Sanitizes an uploaded filename:
 * - Strips directory traversal sequences (../, ..\)
 * - Removes null bytes
 * - Collapses whitespace
 * - Truncates to MAX_FILENAME_LENGTH
 */
function sanitizeFilename(raw: string): string {
  return raw
    .replace(/\.\.[/\\]/g, '') // strip directory traversal
    .replace(/\0/g, '') // strip null bytes
    .replace(/\s+/g, ' ') // collapse whitespace
    .trim()
    .slice(0, MAX_FILENAME_LENGTH);
}

@ApiTags('documents')
@ApiBearerAuth('jwt')
@Controller({ path: 'documents', version: '1' })
export class DocumentsController {
  /** In-memory cache: SHA-256(fileBuffer) → upload result, to avoid redundant IPFS calls */
  private readonly ipfsCache = new Map<string, object>();
  /** Temporary in-memory chunked upload sessions: fileId → session */
  private readonly chunkStore = new Map<
    string,
    { chunks: Buffer[]; totalChunks: number; receivedCount: number }
  >();

  constructor(private readonly documentsService: DocumentsService) {}

  @Post()
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @UseGuards(AuthGuard('jwt'))
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({
    summary: 'Upload a trade document (PDF/PNG/JPEG, max 10 MB)',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file', 'doc_type', 'trade_deal_id'],
      properties: {
        file: {
          type: 'string',
          format: 'binary',
          description: 'Document file (PDF, PNG, or JPEG)',
        },
        doc_type: { type: 'string', example: 'bill_of_lading' },
        trade_deal_id: {
          type: 'string',
          example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        },
        signature_asc: {
          type: 'string',
          description:
            'Optional detached PGP/GnuPG armored signature of the file, issued by a trusted certifying authority',
        },
      },
    },
  })
  @ApiResponse({
    status: 201,
    description: 'Document uploaded to IPFS and anchored on Stellar',
  })
  @ApiResponse({
    status: 400,
    description:
      'Missing file, unsupported type, dangerous extension, or file too large',
  })
  @ApiResponse({ status: 422, description: 'Virus detected' })
  @ApiResponse({ status: 503, description: 'Malware scanner unavailable' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Trade deal not found' })
  @ApiResponse({
    status: 429,
    description: 'Too Many Requests – IPFS proxy limit is 20 per minute',
  })
  async uploadDocument(
    @UploadedFile() file: Express.Multer.File,
    @Body()
    body: { doc_type: string; trade_deal_id: string; signature_asc?: string },
    @Request() req: AuthRequest,
  ) {
    if (!file) throw new BadRequestException('File is required');

    // ── 1. Size guard ────────────────────────────────────────────────────────
    if (file.size > 10 * 1024 * 1024) {
      throw new BadRequestException('File exceeds 10 MB limit');
    }

    // ── 2. MIME-type allow-list ──────────────────────────────────────────────
    if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
      throw new BadRequestException(
        'Unsupported file type. Only PDF, PNG, JPEG allowed',
      );
    }

    // ── 3. Filename sanitization & dangerous-extension block ─────────────────
    // Sanitize first so the extension check operates on the cleaned name.
    const originalName: string = file.originalname ?? '';
    const sanitized = sanitizeFilename(originalName);

    const ext = extname(sanitized).toLowerCase();
    if (BLOCKED_EXTENSIONS.has(ext)) {
      throw new BadRequestException(
        `Files with extension "${ext}" are not permitted for security reasons.`,
      );
    }

    // Double-extension check: "invoice.pdf.exe" → ext is ".exe" (already
    // caught above), but "invoice.exe.pdf" is trickier — reject any filename
    // whose second-to-last segment matches a blocked extension.
    const parts = sanitized.split('.');
    if (parts.length >= 3) {
      const penultimateExt = '.' + parts[parts.length - 2].toLowerCase();
      if (BLOCKED_EXTENSIONS.has(penultimateExt)) {
        throw new BadRequestException(
          `Filename contains a potentially dangerous embedded extension ("${penultimateExt}") and was rejected.`,
        );
      }
    }

    // Attach the sanitized filename back onto the multer file object so
    // downstream services (StorageService, IPFS) use the clean name.
    file.originalname = sanitized;

    // ── 4. Malware scan ──────────────────────────────────────────────────────
    // Scan before consulting the cache so every upload request is inspected.
    await this.documentsService.scanBeforeUpload(file, req.user.id);

    // ── 5. Content-hash deduplication cache ──────────────────────────────────
    // SHA-256 of raw bytes uniquely identifies file content. If the same bytes
    // were successfully uploaded before we can skip the IPFS round-trip.
    const contentKey = createHash('sha256').update(file.buffer).digest('hex');
    if (this.ipfsCache.has(contentKey)) {
      return this.ipfsCache.get(contentKey);
    }

    // ── 6. Handle upload (magic-number check + IPFS + Stellar anchor) ────────
    const result = await this.documentsService.handleUpload({
      file,
      docType: body.doc_type,
      tradeDealId: body.trade_deal_id,
      userId: req.user.id,
      signatureAsc: body.signature_asc,
    });

    this.ipfsCache.set(contentKey, result);
    return result;
  }

  @Post('upload-chunk')
  @Throttle({ default: { limit: 100, ttl: 60000 } })
  @UseGuards(AuthGuard('jwt'))
  @UseInterceptors(FileInterceptor('chunk'))
  @ApiOperation({
    summary: 'Upload a single chunk of a large file (max 5 MB per chunk)',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: [
        'chunk',
        'fileId',
        'chunkIndex',
        'totalChunks',
        'docType',
        'tradeDealId',
      ],
      properties: {
        chunk: { type: 'string', format: 'binary' },
        fileId: { type: 'string' },
        chunkIndex: { type: 'integer' },
        totalChunks: { type: 'integer' },
        docType: { type: 'string' },
        tradeDealId: { type: 'string' },
      },
    },
  })
  @ApiResponse({ status: 201, description: 'Chunk received' })
  @ApiResponse({ status: 400, description: 'Invalid chunk' })
  async uploadChunk(
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: UploadChunkDto,
  ) {
    if (!file) throw new BadRequestException('Chunk file is required');
    if (file.size > 5 * 1024 * 1024)
      throw new BadRequestException('Chunk exceeds 5 MB limit');

    const { fileId, chunkIndex, totalChunks } = dto;

    if (chunkIndex >= totalChunks) {
      throw new BadRequestException('chunkIndex must be less than totalChunks');
    }

    let session = this.chunkStore.get(fileId);
    if (!session) {
      session = {
        chunks: new Array(totalChunks).fill(null),
        totalChunks,
        receivedCount: 0,
      };
      this.chunkStore.set(fileId, session);
    }

    if (session.chunks[chunkIndex] !== null) {
      throw new BadRequestException(`Chunk ${chunkIndex} already received`);
    }

    session.chunks[chunkIndex] = file.buffer;
    session.receivedCount += 1;

    return {
      fileId,
      chunkIndex,
      received: session.receivedCount,
      total: totalChunks,
      complete: session.receivedCount === totalChunks,
    };
  }

  @Post('upload-complete')
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @UseGuards(AuthGuard('jwt'))
  @ApiOperation({
    summary: 'Assemble uploaded chunks and finalize document upload',
  })
  @ApiResponse({ status: 201, description: 'Document assembled and uploaded' })
  @ApiResponse({
    status: 400,
    description: 'Missing chunks or invalid request',
  })
  async uploadComplete(
    @Body() dto: UploadCompleteDto,
    @Request() req: AuthRequest,
  ) {
    const { fileId, docType, tradeDealId, fileName, mimeType } = dto;

    const session = this.chunkStore.get(fileId);
    if (!session) {
      throw new BadRequestException('No upload session found for this fileId');
    }

    if (session.receivedCount < session.totalChunks) {
      throw new BadRequestException(
        `Missing chunks: received ${session.receivedCount}/${session.totalChunks}`,
      );
    }

    const assembled = Buffer.concat(session.chunks);
    this.chunkStore.delete(fileId);

    const file: Express.Multer.File = {
      fieldname: 'file',
      originalname: fileName,
      encoding: '7bit',
      mimetype: mimeType,
      size: assembled.length,
      buffer: assembled,
      destination: '',
      filename: fileName,
      path: '',
      stream: null as any,
    };

    const result = await this.documentsService.handleUpload({
      file,
      docType,
      tradeDealId,
      userId: req.user.id,
    });

    return result;
  }
}
