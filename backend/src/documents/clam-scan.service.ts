import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as net from 'net';

export interface ScanResult {
  isClean: boolean;
  virusName?: string;
}

/**
 * Connects to a ClamAV daemon over TCP and streams the file buffer for scanning.
 * Uses the INSTREAM command protocol (chunk-based streaming).
 */
@Injectable()
export class ClamScanService {
  private readonly logger = new Logger(ClamScanService.name);
  private readonly host: string;
  private readonly port: number;

  constructor(private readonly config: ConfigService) {
    this.host = config.get<string>('CLAMAV_HOST', 'clamav');
    this.port = config.get<number>('CLAMAV_PORT', 3310);
  }

  async scan(buffer: Buffer): Promise<ScanResult> {
    return new Promise((resolve, reject) => {
      const socket = net.createConnection(this.port, this.host);
      const chunks: Buffer[] = [];

      socket.setTimeout(15000);

      socket.on('connect', () => {
        // Send INSTREAM command
        socket.write('zINSTREAM\0');

        // Send chunk: 4-byte big-endian length + data
        const sizeBuffer = Buffer.alloc(4);
        sizeBuffer.writeUInt32BE(buffer.length, 0);
        socket.write(sizeBuffer);
        socket.write(buffer);

        // Terminate stream with zero-length chunk
        const end = Buffer.alloc(4);
        end.writeUInt32BE(0, 0);
        socket.write(end);
      });

      socket.on('data', (data) => {
        chunks.push(data);
      });

      socket.on('end', () => {
        const response = Buffer.concat(chunks).toString('utf8').trim();
        this.logger.debug(`ClamAV response: ${response}`);

        if (response.includes('OK')) {
          resolve({ isClean: true });
        } else if (response.includes('FOUND')) {
          // Format: "stream: VirusName FOUND"
          const match = response.match(/stream:\s+(.+?)\s+FOUND/);
          resolve({ isClean: false, virusName: match?.[1] ?? 'Unknown' });
        } else {
          reject(new Error(`Unexpected ClamAV response: ${response}`));
        }
      });

      socket.on('timeout', () => {
        socket.destroy();
        reject(new Error('ClamAV scan timed out'));
      });

      socket.on('error', (err) => {
        this.logger.error(`ClamAV connection error: ${err.message}`);
        reject(err);
      });
    });
  }
}
