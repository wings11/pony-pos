import { app, BrowserWindow, ipcMain } from 'electron';
import * as path from 'path';
import { DatabaseManager } from './database/DatabaseManager';
import { PrinterService } from './services/PrinterService';

class PosApplication {
  private mainWindow: BrowserWindow | null = null;
  private database: DatabaseManager;
  private printer: PrinterService;

  constructor() {
    this.database = new DatabaseManager();
    this.printer = new PrinterService();
  }

  public async initialize(): Promise<void> {
    await app.whenReady();
    await this.database.initialize();
    this.createWindow();
    this.setupIpcHandlers();
  }

  private createWindow(): void {
    this.mainWindow = new BrowserWindow({
      width: 1024,
      height: 768,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, 'preload.js')
      },
      titleBarStyle: 'hidden',
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

    ipcMain.handle('get-all-products', async () => {
      return await this.database.getAllProducts();
    });

    ipcMain.handle('update-stock', async (_, barcode, quantity) => {
      return await this.database.updateStock(barcode, quantity);
    });

    // Sales management
    ipcMain.handle('create-sale', async (_, saleData) => {
      return await this.database.createSale(saleData);
    });

    ipcMain.handle('get-sales-report', async (_, date) => {
      return await this.database.getSalesReport(date);
    });

    // Printer operations
    ipcMain.handle('print-receipt', async (_, receiptData) => {
      return await this.printer.printReceipt(receiptData);
    });

    ipcMain.handle('test-printer', async () => {
      return await this.printer.testPrint();
    });
  }
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