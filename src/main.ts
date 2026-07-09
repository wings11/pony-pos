import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { DatabaseManager } from './database/DatabaseManager';
import { PrinterService } from './services/PrinterService';
import { ExportService } from './services/ExportService';

interface AppConfig {
  adminMode: boolean;
}

class PosApplication {
  private mainWindow: BrowserWindow | null = null;
  private database: DatabaseManager;
  private printer: PrinterService;
  private exporter: ExportService;
  private appIconPath: string;
  private appConfig: AppConfig = { adminMode: true };

  constructor() {
    this.database = new DatabaseManager();
    this.printer = new PrinterService();
    this.exporter = new ExportService();
    this.appIconPath = path.join(__dirname, '../build/icon-256.png');
  }

  public async initialize(): Promise<void> {
    await app.whenReady();
    this.appConfig = this.loadAppConfig();
    await this.database.initialize();
    this.createWindow();
    this.setupIpcHandlers();
  }

  // Admin mode (default) shows cost prices in the inventory page. A cashier till
  // hides them by launching with --cashier, or by setting "adminMode": false in
  // pos-config.json inside the app's user data folder.
  private loadAppConfig(): AppConfig {
    const config: AppConfig = { adminMode: true };
    const configPath = path.join(app.getPath('userData'), 'pos-config.json');

    try {
      if (fs.existsSync(configPath)) {
        const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        config.adminMode = parsed.adminMode !== false;
      } else {
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
      }
    } catch (err) {
      console.warn('Could not read pos-config.json, using defaults:', err);
    }

    if (process.argv.includes('--cashier')) {
      config.adminMode = false;
    }

    return config;
  }

  private createWindow(): void {
      this.mainWindow = new BrowserWindow({
        width: 1024,
        height: 768,
        icon: this.appIconPath,
        frame: true,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          preload: path.join(__dirname, 'preload.js')
        },
        title: 'Pony POS System',
        fullscreen: false,
        resizable: true
      });
    this.mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));

    // Open DevTools in development
    if (process.env.NODE_ENV === 'development') {
      this.mainWindow.webContents.openDevTools();
    }

    this.mainWindow.on('closed', () => {
      this.mainWindow = null;
    });
  }

  private setupIpcHandlers(): void {
    // Product management
    ipcMain.handle('add-product', async (_, product) => {
      return await this.database.addProduct(product);
    });

    ipcMain.handle('get-product', async (_, barcode) => {
      return await this.database.getProduct(barcode);
    });

    ipcMain.handle('get-product-variants', async (_, barcode) => {
      return await this.database.getProductVariants(barcode);
    });

    ipcMain.handle('get-all-products', async () => {
      return await this.database.getAllProducts();
    });

    ipcMain.handle('update-stock', async (_, barcode, size, quantity) => {
      return await this.database.updateStock(barcode, size, quantity);
    });

    ipcMain.handle('delete-product', async (_, barcode, size) => {
      return await this.database.deleteProduct(barcode, size);
    });

    // Sales management
    ipcMain.handle('create-sale', async (_, saleData) => {
      return await this.database.createSale(saleData);
    });

    ipcMain.handle('get-sales-report', async (_, date) => {
      return await this.database.getSalesReport(date);
    });

    ipcMain.handle('create-return', async (_, saleId: number, barcode: string, size: string, quantity: number) => {
      return await this.database.createReturn(saleId, barcode, size, quantity);
    });

    ipcMain.handle('export-sales-history', async (_, format: 'csv' | 'xls' | 'xlsx' | 'json', sales: any[], filter?: any) => {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

      // Full multi-sheet Excel report
      if (format === 'xlsx') {
        const result = await dialog.showSaveDialog({
          title: 'Export Sales Report',
          defaultPath: `pony-pos-report-${timestamp}.xlsx`,
          filters: [
            { name: 'Excel Workbook', extensions: ['xlsx'] },
            { name: 'All Files', extensions: ['*'] }
          ]
        });

        if (result.canceled || !result.filePath) {
          return { success: false, canceled: true };
        }

        try {
          const products = await this.database.getAllProducts();
          const buffer = await this.exporter.buildSalesWorkbook(sales || [], products, {
            filter: filter || {},
            adminMode: this.appConfig.adminMode
          });
          fs.writeFileSync(result.filePath, buffer);
          return { success: true, filePath: result.filePath };
        } catch (error: any) {
          return { success: false, error: error?.message || 'Failed to export sales report' };
        }
      }

      // Legacy flat formats
      const fileExt = format === 'xls' ? 'xls' : format;
      const defaultPath = `sales-history-${timestamp}.${fileExt}`;

      const result = await dialog.showSaveDialog({
        title: 'Export Sales History',
        defaultPath,
        filters: this.getExportFilters()
      });

      if (result.canceled || !result.filePath) {
        return { success: false, canceled: true };
      }

      try {
        const content = this.serializeSalesExport(format, sales || []);
        fs.writeFileSync(result.filePath, content, 'utf8');
        return { success: true, filePath: result.filePath };
      } catch (error: any) {
        return { success: false, error: error?.message || 'Failed to export sales history' };
      }
    });

    // Printer operations
    ipcMain.handle('print-receipt', async (_, receiptData) => {
      return await this.printer.printReceipt(receiptData);
    });

    ipcMain.handle('test-printer', async () => {
      return await this.printer.testPrint();
    });

    ipcMain.handle('check-printer-connection', async () => {
      return await this.printer.checkConnection();
    });

    ipcMain.handle('get-app-config', async () => {
      return this.appConfig;
    });

    ipcMain.handle('close-app', async () => {
      app.quit();
      return true;
    });
  }

  private getExportFilters() {
    return [
      { name: 'CSV File', extensions: ['csv'] },
      { name: 'Excel File', extensions: ['xls'] },
      { name: 'JSON File', extensions: ['json'] },
      { name: 'All Files', extensions: ['*'] }
    ];
  }

  private serializeSalesExport(format: 'csv' | 'xls' | 'json', sales: any[]): string {
    if (format === 'json') {
      return JSON.stringify(sales, null, 2);
    }

    if (format === 'xls') {
      return this.toExcelHtmlTable(sales);
    }

    return this.toCsv(sales);
  }

  private toCsv(sales: any[]): string {
    const headers = [
      'sale_id',
      'sale_datetime',
      'sale_total',
      'barcode',
      'item_name',
      'item_price',
      'quantity',
      'line_total'
    ];

    const lines: string[] = [headers.join(',')];

    for (const sale of sales) {
      const items = sale.items || [];
      for (const item of items) {
        const lineTotal = Number(item.price) * Number(item.quantity);
        const row = [
          sale.id,
          sale.created_at,
          Number(sale.total).toFixed(2),
          item.barcode,
          item.name,
          Number(item.price).toFixed(2),
          item.quantity,
          lineTotal.toFixed(2)
        ].map((v) => this.escapeCsv(v));
        lines.push(row.join(','));
      }
    }

    return lines.join('\n');
  }

  private escapeCsv(value: any): string {
    const text = String(value ?? '');
    if (/[",\n]/.test(text)) {
      return `"${text.replace(/"/g, '""')}"`;
    }
    return text;
  }

  private toExcelHtmlTable(sales: any[]): string {
    const rows: string[] = [];
    for (const sale of sales) {
      const items = sale.items || [];
      for (const item of items) {
        const lineTotal = Number(item.price) * Number(item.quantity);
        rows.push(`
          <tr>
            <td>${this.escapeHtml(sale.id)}</td>
            <td>${this.escapeHtml(sale.created_at)}</td>
            <td>${Number(sale.total).toFixed(2)}</td>
            <td>${this.escapeHtml(item.barcode)}</td>
            <td>${this.escapeHtml(item.name)}</td>
            <td>${Number(item.price).toFixed(2)}</td>
            <td>${this.escapeHtml(item.quantity)}</td>
            <td>${lineTotal.toFixed(2)}</td>
          </tr>
        `);
      }
    }

    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Sales History</title>
</head>
<body>
  <table border="1">
    <thead>
      <tr>
        <th>sale_id</th>
        <th>sale_datetime</th>
        <th>sale_total</th>
        <th>barcode</th>
        <th>item_name</th>
        <th>item_price</th>
        <th>quantity</th>
        <th>line_total</th>
      </tr>
    </thead>
    <tbody>
      ${rows.join('')}
    </tbody>
  </table>
</body>
</html>`;
  }

  private escapeHtml(value: any): string {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
}

// Disable hardware acceleration early to avoid GPU process crashes on some systems/drivers.
// Must be called before the app 'ready' event.
try {
  app.disableHardwareAcceleration();
  // Also add a command-line switch as a fallback.
  app.commandLine.appendSwitch('disable-gpu');
} catch (e) {
  // If app isn't ready to call these (very rare), ignore and continue — we still try.
  // Any runtime errors will be logged when the app starts.
  console.warn('Could not set GPU flags:', e);
}

// App event handlers
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', async () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    const posApp = new PosApplication();
    await posApp.initialize();
  }
});

// Start the application
const main = async () => {
  const posApp = new PosApplication();
  await posApp.initialize();
};

main().catch(console.error);
