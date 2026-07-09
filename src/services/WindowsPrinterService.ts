import { spawn } from 'child_process';
import { writeFileSync, unlinkSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import sharp from 'sharp';

export interface ReceiptData {
  saleId: number;
  items: Array<{
    name: string;
    price: number;
    quantity: number;
  }>;
  total: number;
  date: string;
}

// Check if text contains Myanmar Unicode characters (U+1000–U+109F)
function containsMyanmar(text: string): boolean {
  return /[\u1000-\u109F]/.test(text);
}

export class WindowsPrinterService {
  private printerName: string;
  private printerWidth: number = 384; // XP-58 is 58mm = 384 dots at 203 DPI

  constructor(printerName: string = 'XP-58') {
    this.printerName = printerName;
  }

  // Convert text to bitmap image for Myanmar/Unicode support
  async textToBitmap(text: string, fontSize: number = 24, bold: boolean = false): Promise<Buffer> {
    const width = this.printerWidth;
    const lineHeight = fontSize + 15;
    const lines = text.split('\n');
    const height = Math.max(lineHeight * lines.length, lineHeight);
    
    // Create SVG with Myanmar-compatible font
    // Using system fonts that support Myanmar (Noto Sans Myanmar, Myanmar Text, Padauk)
    const fontFamily = 'Myanmar Text, Noto Sans Myanmar, Padauk, sans-serif';
    const fontWeight = bold ? 'bold' : 'normal';
    
    const svgLines = lines.map((line, i) => {
      // Escape XML special characters
      const escaped = line
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
      return `<text x="4" y="${(i + 1) * lineHeight - 4}" font-family="${fontFamily}" font-size="${fontSize}" font-weight="${fontWeight}" fill="black">${escaped}</text>`;
    }).join('\n');
    
    const svg = `
      <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
        <rect width="100%" height="100%" fill="white"/>
        ${svgLines}
      </svg>
    `;
    
    // Convert SVG to 1-bit bitmap
    const image = await sharp(Buffer.from(svg))
      .resize(width, height)
      .threshold(128)
      .raw()
      .toBuffer();
    
    return image;
  }

  // Convert raw pixel data to ESC/POS raster bitmap command
  async createRasterBitmap(text: string, fontSize: number = 24, bold: boolean = false): Promise<Buffer> {
    const width = this.printerWidth;
    const lineHeight = fontSize + 8;
    const lines = text.split('\n');
    const height = Math.max(lineHeight * lines.length, lineHeight);
    
    const fontFamily = 'Myanmar Text, Noto Sans Myanmar, Padauk, sans-serif';
    const fontWeight = bold ? 'bold' : 'normal';
    
    const svgLines = lines.map((line, i) => {
      const escaped = line
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
      return `<text x="4" y="${(i + 1) * lineHeight - 4}" font-family="${fontFamily}" font-size="${fontSize}" font-weight="${fontWeight}" fill="black">${escaped}</text>`;
    }).join('\n');
    
    const svg = `
      <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
        <rect width="100%" height="100%" fill="white"/>
        ${svgLines}
      </svg>
    `;
    
    // Get grayscale raw pixels
    const { data, info } = await sharp(Buffer.from(svg))
      .resize(width, height)
      .grayscale()
      .raw()
      .toBuffer({ resolveWithObject: true });
    
    // Convert to 1-bit per pixel packed format for ESC/POS
    const bytesPerLine = Math.ceil(info.width / 8);
    const bitmapData: number[] = [];
    
    for (let y = 0; y < info.height; y++) {
      for (let byteX = 0; byteX < bytesPerLine; byteX++) {
        let byte = 0;
        for (let bit = 0; bit < 8; bit++) {
          const x = byteX * 8 + bit;
          if (x < info.width) {
            const pixelIndex = y * info.width + x;
            const pixelValue = data[pixelIndex];
            // Black pixel if value < 128 (dark)
            if (pixelValue < 128) {
              byte |= (0x80 >> bit);
            }
          }
        }
        bitmapData.push(byte);
      }
    }
    
    // ESC/POS GS v 0 command for raster bitmap
    // GS v 0 m xL xH yL yH [data]
    const xL = bytesPerLine & 0xFF;
    const xH = (bytesPerLine >> 8) & 0xFF;
    const yL = info.height & 0xFF;
    const yH = (info.height >> 8) & 0xFF;
    
    const command = Buffer.concat([
      Buffer.from([0x1D, 0x76, 0x30, 0x00, xL, xH, yL, yH]), // GS v 0 command
      Buffer.from(bitmapData)
    ]);
    
    return command;
  }

  // Generate ESC/POS commands for thermal printers (text only - no Myanmar support)
  generateReceiptCommandsText(receiptData?: ReceiptData): string {
    // Use simpler commands that work better with XP-58
    let content = '';
    
    // Initialize printer (most compatible command)
    content += '\x1B\x40'; // ESC @ - Initialize
    
    // Simple test content without complex formatting
    if (receiptData) {
      content += 'PONY\n';
      content += 'Your Local Store\n';
      content += '123 Main Street, City\n';
      content += 'Phone: (555) 123-4567\n';
      content += '================================\n';
      content += `Sale #: ${receiptData.saleId || 'TEST'}\n`;
      content += `Date: ${receiptData.date || new Date().toLocaleString()}\n`;
      content += '================================\n';
      
      if (receiptData.items) {
        receiptData.items.forEach(item => {
          content += `${item.name}\n`;
          content += `  ${item.quantity} x $${item.price.toFixed(2)} = $${(item.quantity * item.price).toFixed(2)}\n`;
        });
      }
      
      content += '================================\n';
      content += `TOTAL: $${receiptData.total ? receiptData.total.toFixed(2) : '0.00'}\n`;
    } else {
      // Simple test print
      content += '*** PONY POS TEST ***\n';
      content += 'System: ONLINE\n';
      content += `Time: ${new Date().toLocaleString()}\n`;
      content += 'Printer connection verified\n';
      content += 'Ready for business!\n';
    }
    
    content += '\n================================\n';
    content += '   Thank you for your business!\n';
    content += '       Come back soon!\n';
    content += '================================\n';
    
    // Add some line feeds and try multiple cut commands
    content += '\n\n\n\n';
    content += '\x1D\x56\x42\x00'; // GS V B - Partial cut (more compatible)
    content += '\x1D\x56\x00';     // GS V 0 - Full cut (backup)
    content += '\n\n';
    
    return content;
  }

  // Generate ESC/POS commands with bitmap support for Myanmar text
  async generateReceiptCommands(receiptData?: ReceiptData): Promise<Buffer> {
    const buffers: Buffer[] = [];
    
    // Initialize printer
    buffers.push(Buffer.from([0x1B, 0x40])); // ESC @ - Initialize
    
    // Check if any text contains Myanmar characters
    let hasMyanmar = false;
    if (receiptData?.items) {
      for (const item of receiptData.items) {
        if (containsMyanmar(item.name)) {
          hasMyanmar = true;
          break;
        }
      }
    }
    
    if (receiptData) {
      // Header as text (ASCII only)
      buffers.push(Buffer.from('PONY\n', 'ascii'));
      buffers.push(Buffer.from('Your Local Store\n', 'ascii'));
      buffers.push(Buffer.from('123 Main Street, City\n', 'ascii'));
      buffers.push(Buffer.from('Phone: (555) 123-4567\n', 'ascii'));
      buffers.push(Buffer.from('================================\n', 'ascii'));
      buffers.push(Buffer.from(`Sale #: ${receiptData.saleId || 'TEST'}\n`, 'ascii'));
      buffers.push(Buffer.from(`Date: ${receiptData.date || new Date().toLocaleString()}\n`, 'ascii'));
      buffers.push(Buffer.from('================================\n', 'ascii'));
      
      // Items - render as single line (name + qty + price)
      if (receiptData.items) {
        for (const item of receiptData.items) {
          const itemLine = `${item.name}  ${item.quantity} x $${item.price.toFixed(2)} = $${(item.quantity * item.price).toFixed(2)}`;
          
          if (containsMyanmar(item.name)) {
            // Render entire line as bitmap for Myanmar text
            try {
              const bitmapCmd = await this.createRasterBitmap(itemLine, 24, true);
              buffers.push(bitmapCmd);
            } catch (err) {
              // Fallback to text if bitmap fails
              buffers.push(Buffer.from(`${itemLine}\n`, 'utf8'));
            }
          } else {
            buffers.push(Buffer.from(`${itemLine}\n`, 'ascii'));
          }
        }
      }
      
      buffers.push(Buffer.from('================================\n', 'ascii'));
      buffers.push(Buffer.from(`TOTAL: $${receiptData.total ? receiptData.total.toFixed(2) : '0.00'}\n`, 'ascii'));
    } else {
      // Simple test print
      buffers.push(Buffer.from('*** PONY POS TEST ***\n', 'ascii'));
      buffers.push(Buffer.from('System: ONLINE\n', 'ascii'));
      buffers.push(Buffer.from(`Time: ${new Date().toLocaleString()}\n`, 'ascii'));
      buffers.push(Buffer.from('Printer connection verified\n', 'ascii'));
      buffers.push(Buffer.from('Ready for business!\n', 'ascii'));
    }
    
    buffers.push(Buffer.from('\n================================\n', 'ascii'));
    
    // Render Myanmar thank you message as bitmap for proper display
    try {
      const thankYouBitmap = await this.createRasterBitmap('အားပေးမှုအတွက် ကျေးဇူးတင်ပါသည်။', 23, true);
      buffers.push(thankYouBitmap);
    } catch (err) {
      // Fallback if bitmap fails
      buffers.push(Buffer.from('Thank you for your support!\n', 'ascii'));
    }
    
    buffers.push(Buffer.from('       Come back soon!\n', 'ascii'));
    buffers.push(Buffer.from('================================\n', 'ascii'));
    
    // Line feeds and cut commands
    buffers.push(Buffer.from('\n\n\n\n'));
    buffers.push(Buffer.from([0x1D, 0x56, 0x42, 0x00])); // GS V B - Partial cut
    buffers.push(Buffer.from([0x1D, 0x56, 0x00]));       // GS V 0 - Full cut
    buffers.push(Buffer.from('\n\n'));
    
    return Buffer.concat(buffers);
  }

  async printDirect(content: Buffer | string): Promise<boolean> {
    return new Promise((resolve, reject) => {
      // Create temporary PowerShell script that uses Win32 APIs (OpenPrinter / WritePrinter)
      // We send the bytes as base64 to avoid escaping problems.
      const scriptPath = join(tmpdir(), `print_raw_${Date.now()}.ps1`);
      const contentBuffer = Buffer.isBuffer(content) ? content : Buffer.from(content, 'binary');
      const base64 = contentBuffer.toString('base64');

      const psScript = `
$code = @"
using System;
using System.Runtime.InteropServices;

public class RawPrinterHelper {
    [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
    public struct DOCINFO {
        [MarshalAs(UnmanagedType.LPWStr)] public string pDocName;
        [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile;
        [MarshalAs(UnmanagedType.LPWStr)] public string pDataType;
    }

    [DllImport("winspool.Drv", EntryPoint = "OpenPrinterW", SetLastError = true, CharSet = CharSet.Unicode)]
    public static extern bool OpenPrinter(string szPrinter, out IntPtr hPrinter, IntPtr pd);

    [DllImport("winspool.Drv", EntryPoint = "ClosePrinter")]
    public static extern bool ClosePrinter(IntPtr hPrinter);

    [DllImport("winspool.Drv", EntryPoint = "StartDocPrinterW", SetLastError = true, CharSet = CharSet.Unicode)]
    public static extern bool StartDocPrinter(IntPtr hPrinter, int level, ref DOCINFO di);

    [DllImport("winspool.Drv", EntryPoint = "EndDocPrinter")]
    public static extern bool EndDocPrinter(IntPtr hPrinter);

    [DllImport("winspool.Drv", EntryPoint = "StartPagePrinter")]
    public static extern bool StartPagePrinter(IntPtr hPrinter);

    [DllImport("winspool.Drv", EntryPoint = "EndPagePrinter")]
    public static extern bool EndPagePrinter(IntPtr hPrinter);

    [DllImport("winspool.Drv", EntryPoint = "WritePrinter")]
    public static extern bool WritePrinter(IntPtr hPrinter, IntPtr pBytes, int dwCount, out int dwWritten);

    public static bool SendBytesToPrinter(string printerName, byte[] bytes) {
        IntPtr hPrinter;
        if (!OpenPrinter(printerName, out hPrinter, IntPtr.Zero)) return false;
        DOCINFO di = new DOCINFO();
        di.pDocName = "RAW_PRINT";
        di.pDataType = "RAW";
        if (!StartDocPrinter(hPrinter, 1, ref di)) { ClosePrinter(hPrinter); return false; }
        if (!StartPagePrinter(hPrinter)) { EndDocPrinter(hPrinter); ClosePrinter(hPrinter); return false; }
        IntPtr pUnmanagedBytes = Marshal.AllocCoTaskMem(bytes.Length);
        Marshal.Copy(bytes, 0, pUnmanagedBytes, bytes.Length);
        int dwWritten = 0;
        bool bSuccess = WritePrinter(hPrinter, pUnmanagedBytes, bytes.Length, out dwWritten);
        Marshal.FreeCoTaskMem(pUnmanagedBytes);
        EndPagePrinter(hPrinter);
        EndDocPrinter(hPrinter);
        ClosePrinter(hPrinter);
        return bSuccess;
    }
}
"@

Add-Type -TypeDefinition $code -Language CSharp
$b = [Convert]::FromBase64String("${base64}")
$success = [RawPrinterHelper]::SendBytesToPrinter("${this.printerName}", $b)
if ($success) { Write-Host 'PRINT_SUCCESS' } else { Write-Host 'PRINT_FAILED' ; exit 1 }
`;

      try {
        writeFileSync(scriptPath, psScript, 'utf8');

        const ps = spawn('powershell.exe', ['-ExecutionPolicy', 'Bypass', '-File', scriptPath], {
          stdio: ['pipe', 'pipe', 'pipe']
        });

        let output = '';
        let error = '';

        ps.stdout.on('data', (data: Buffer) => {
          output += data.toString();
        });

        ps.stderr.on('data', (data: Buffer) => {
          error += data.toString();
        });

        ps.on('close', (code: number | null) => {
          try { unlinkSync(scriptPath); } catch (e) {}
          if (code === 0 && output.includes('PRINT_SUCCESS')) {
            resolve(true);
          } else {
            reject(new Error(`Print failed: ${error || output}`));
          }
        });

        ps.on('error', (err: Error) => {
          try { unlinkSync(scriptPath); } catch (e) {}
          reject(new Error(`PowerShell error: ${err.message}`));
        });
      } catch (fileError) {
        reject(new Error(`Failed to create script file: ${fileError}`));
      }
    });
  }

  async testPrint(): Promise<boolean> {
    try {
      const content = await this.generateReceiptCommands();
      await this.printDirect(content);
      return true;
    } catch (error) {
      console.error('Test print failed:', error instanceof Error ? error.message : String(error));
      return false;
    }
  }

  async printReceipt(receiptData: ReceiptData): Promise<boolean> {
    try {
      const content = await this.generateReceiptCommands(receiptData);
      await this.printDirect(content);
      return true;
    } catch (error) {
      console.error('Receipt printing failed:', error instanceof Error ? error.message : String(error));
      return false;
    }
  }

  async checkConnection(): Promise<boolean> {
    try {
      // Check if printer exists without actually printing
      // Use PowerShell to check if the printer name exists
      const psScript = `
        $printer = Get-Printer -Name "${this.printerName}" -ErrorAction SilentlyContinue
        if ($printer) { 
          Write-Host "PRINTER_EXISTS" 
        } else { 
          Write-Host "PRINTER_NOT_FOUND"
          exit 1 
        }
      `;
      
      const scriptPath = join(tmpdir(), `check_printer_${Date.now()}.ps1`);
      writeFileSync(scriptPath, psScript, 'utf8');
      
      return new Promise((resolve) => {
        const ps = spawn('powershell.exe', ['-ExecutionPolicy', 'Bypass', '-File', scriptPath], {
          stdio: ['pipe', 'pipe', 'pipe']
        });

        let output = '';
        ps.stdout.on('data', (data: Buffer) => {
          output += data.toString();
        });

        ps.on('close', (code: number | null) => {
          try { unlinkSync(scriptPath); } catch (e) {}
          resolve(code === 0 && output.includes('PRINTER_EXISTS'));
        });

        ps.on('error', () => {
          try { unlinkSync(scriptPath); } catch (e) {}
          resolve(false);
        });
      });
    } catch (error) {
      return false;
    }
  }
}

