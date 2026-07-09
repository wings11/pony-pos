import { contextBridge, ipcRenderer } from 'electron';

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  // Product operations
  addProduct: (product: any) => ipcRenderer.invoke('add-product', product),
  getProduct: (barcode: string) => ipcRenderer.invoke('get-product', barcode),
  getProductVariants: (barcode: string) => ipcRenderer.invoke('get-product-variants', barcode),
  getAllProducts: () => ipcRenderer.invoke('get-all-products'),
  updateStock: (barcode: string, size: string, quantity: number) =>
    ipcRenderer.invoke('update-stock', barcode, size, quantity),
  deleteProduct: (barcode: string, size: string) => ipcRenderer.invoke('delete-product', barcode, size),

  // Sales operations
  createSale: (saleData: any) => ipcRenderer.invoke('create-sale', saleData),
  createReturn: (saleId: number, barcode: string, size: string, quantity: number) =>
    ipcRenderer.invoke('create-return', saleId, barcode, size, quantity),
  getSalesReport: (date?: string) => ipcRenderer.invoke('get-sales-report', date),
  exportSalesHistory: (format: 'csv' | 'xls' | 'xlsx' | 'json', sales: any[], filter?: any) =>
    ipcRenderer.invoke('export-sales-history', format, sales, filter),
  
  // Printer operations
  printReceipt: (receiptData: any) => ipcRenderer.invoke('print-receipt', receiptData),
  testPrinter: () => ipcRenderer.invoke('test-printer'),
  checkPrinterConnection: () => ipcRenderer.invoke('check-printer-connection'),

  // App configuration
  getAppConfig: () => ipcRenderer.invoke('get-app-config'),

  // Window/application operations
  closeApp: () => ipcRenderer.invoke('close-app'),
});
