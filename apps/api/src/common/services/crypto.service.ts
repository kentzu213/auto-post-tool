import { Injectable } from '@nestjs/common';
import * as crypto from 'crypto';

@Injectable()
export class CryptoService {
  private readonly algorithm = 'aes-256-gcm';
  private readonly key: Buffer;

  constructor() {
    const hexKey = process.env.ENCRYPTION_KEY;
    if (!hexKey) {
      throw new Error('CRITICAL: ENCRYPTION_KEY environment variable is required.');
    }
    this.key = Buffer.from(hexKey, 'hex');
    
    if (this.key.length !== 32) {
      throw new Error('ENCRYPTION_KEY must be exactly 32 bytes (64 hex characters)!');
    }
  }

  /**
   * Mã hóa text sử dụng AES-256-GCM
   * @param text Văn bản thuần túy cần mã hóa
   * @returns Chuỗi định dạng iv:encryptedText:authTag (hex)
   */
  encrypt(text: string): string {
    if (!text) return '';
    
    const iv = crypto.randomBytes(12); // GCM chuẩn dùng IV 12 bytes
    const cipher = crypto.createCipheriv(this.algorithm, this.key, iv);
    
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    const authTag = cipher.getAuthTag().toString('hex');
    
    return `${iv.toString('hex')}:${encrypted}:${authTag}`;
  }

  /**
   * Giải mã text được mã hóa bằng AES-256-GCM
   * @param encryptedText Chuỗi iv:encryptedText:authTag (hex)
   * @returns Văn bản giải mã thuần túy
   */
  decrypt(encryptedText: string): string {
    if (!encryptedText) return '';
    
    const parts = encryptedText.split(':');
    if (parts.length !== 3) {
      throw new Error('Invalid encrypted text format!');
    }
    
    const iv = Buffer.from(parts[0], 'hex');
    const encrypted = parts[1];
    const authTag = Buffer.from(parts[2], 'hex');
    
    const decipher = crypto.createDecipheriv(this.algorithm, this.key, iv);
    decipher.setAuthTag(authTag);
    
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  }
}
