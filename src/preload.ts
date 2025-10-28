import { contextBridge, ipcRenderer } from 'electron';

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  // Product operations
  addProduct: (product: any) => ipcRenderer.invoke('add-product', product),
  getProduct: (barcode: string) => ipcRenderer.invoke('get-product', barcode),
  getAllProducts: () => ipcRenderer.invoke('get-all-products'),
  updateStock: (barcode: string, quantity: number) => ipcRenderer.invoke('update-stock', barcode, quantity),
  
  // Sales operations
  createSale: (saleData: any) => ipcRenderer.invoke('create-sale', saleData),
  getSalesReport: (date?: string) => ipcRenderer.invoke('get-sales-report', date),
  
  // Printer operations
  printReceipt: (receiptData: any) => ipcRenderer.invoke('print-receipt', receiptData),
  testPrinter: () => ipcRenderer.invoke('test-printer'),
});