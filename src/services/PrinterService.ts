import { ThermalPrinter, PrinterTypes, CharacterSet, BreakLine } from 'node-thermal-printer';

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

export class PrinterService {
  private printer: ThermalPrinter;

  constructor() {
    this.printer = new ThermalPrinter({
      type: PrinterTypes.EPSON,
      interface: 'tcp://192.168.1.100:9100', // Update with your printer IP
      characterSet: CharacterSet.PC852_LATIN2,
      removeSpecialCharacters: false,
      lineCharacter: "=",
      breakLine: BreakLine.WORD,
      options:{
        timeout: 5000,
      }
    });
  }

  public async testPrint(): Promise<boolean> {
    try {
      this.printer.clear();
      this.printer.alignCenter();
      this.printer.setTextSize(1, 1);
      this.printer.println("POS System Test Print");
      this.printer.println("Printer is working correctly!");
      this.printer.newLine();
      this.printer.println(`Test Date: ${new Date().toLocaleString()}`);
      this.printer.cut();
      
      const isConnected = await this.printer.isPrinterConnected();
      if (isConnected) {
        await this.printer.execute();
        return true;
      }
      return false;
    } catch (error) {
      console.error('Printer test failed:', error);
      return false;
    }
  }

  public async printReceipt(receiptData: ReceiptData): Promise<boolean> {
    try {
      this.printer.clear();
      
      // Header
      this.printer.alignCenter();
      this.printer.setTextSize(1, 1);
      this.printer.println("YOUR BUSINESS NAME");
      this.printer.setTextNormal();
      this.printer.println("Address Line 1");
      this.printer.println("Address Line 2");
      this.printer.println("Phone: (123) 456-7890");
      this.printer.drawLine();
      
      // Sale details
      this.printer.alignLeft();
      this.printer.println(`Sale #: ${receiptData.saleId}`);
      this.printer.println(`Date: ${receiptData.date}`);
      this.printer.drawLine();
      
      // Items
      this.printer.setTextSize(0, 0);
      for (const item of receiptData.items) {
        const line = `${item.name}`;
        this.printer.println(line);
        const priceLine = `  ${item.quantity} x $${item.price.toFixed(2)} = $${(item.quantity * item.price).toFixed(2)}`;
        this.printer.println(priceLine);
      }
      
      this.printer.drawLine();
      
      // Total
      this.printer.setTextSize(1, 1);
      this.printer.println(`TOTAL: $${receiptData.total.toFixed(2)}`);
      this.printer.setTextNormal();
      
      this.printer.newLine();
      this.printer.alignCenter();
      this.printer.println("Thank you for your business!");
      this.printer.println("Come back soon!");
      
      this.printer.newLine();
      this.printer.cut();
      
      const isConnected = await this.printer.isPrinterConnected();
      if (isConnected) {
        await this.printer.execute();
        return true;
      }
      return false;
    } catch (error) {
      console.error('Receipt printing failed:', error);
      return false;
    }
  }

  public async checkConnection(): Promise<boolean> {
    try {
      return await this.printer.isPrinterConnected();
    } catch (error) {
      console.error('Printer connection check failed:', error);
      return false;
    }
  }
}