import { ThermalPrinter, PrinterTypes, CharacterSet, BreakLine } from 'node-thermal-printer';
import { WindowsPrinterService } from './WindowsPrinterService';

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
  private printer: ThermalPrinter | null = null;
  private windowsPrinter: WindowsPrinterService | null = null;
  private useWindowsPrinter: boolean = false;

  constructor() {
    // Allow overriding the printer interface via environment variable so USB/Windows printers
    // can be used without editing source. Examples:
    //  - TCP: "tcp://192.168.1.100:9100"
    //  - Windows printer name: "printer:XPrinter 58IIH"
    //  - USB by vendor/product (when supported): "usb://0x0416:0x5011"
    const printerInterface = process.env.PRINTER_INTERFACE || 'tcp://192.168.1.100:9100';

    // Try to set up node-thermal-printer first
    let printerDriver: any = null;
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      printerDriver = require('printer');
      
      this.printer = new ThermalPrinter({
        type: PrinterTypes.EPSON,
        interface: printerInterface,
        driver: printerDriver,
        characterSet: CharacterSet.PC852_LATIN2,
        removeSpecialCharacters: false,
        lineCharacter: "=",
        breakLine: BreakLine.WORD,
        options: {
          timeout: 5000,
        }
      });
    } catch (err) {
      this.useWindowsPrinter = true;
      
      // Extract printer name from interface if it's in the format "printer:NAME"
      let printerName = 'XP-58 (copy 1)'; // Default
      if (printerInterface.startsWith('printer:')) {
        printerName = printerInterface.substring(8);
      }
      
      this.windowsPrinter = new WindowsPrinterService(printerName);
      console.log('Printer initialized:', printerName);
    }
  }

  public async testPrint(): Promise<boolean> {
    if (this.useWindowsPrinter && this.windowsPrinter) {
      return await this.windowsPrinter.testPrint();
    }

    if (!this.printer) {
      console.error('No printer available');
      return false;
    }

    try {
      this.printer.clear();
      this.printer.alignCenter();
      this.printer.setTextSize(1, 1);
      this.printer.println("PONY POS SYSTEM");
      this.printer.println("Printer Ready!");
      this.printer.newLine();
      this.printer.println(`${new Date().toLocaleString()}`);
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
    if (this.useWindowsPrinter && this.windowsPrinter) {
      return await this.windowsPrinter.printReceipt(receiptData);
    }

    if (!this.printer) {
      console.error('No printer available');
      return false;
    }

    try {
      this.printer.clear();
      
      // Header
      this.printer.alignCenter();
      this.printer.setTextSize(1, 1);
      this.printer.println("PONY");
      this.printer.setTextNormal();
      this.printer.println("Your Local Store");
      this.printer.println("123 Main Street, City");
      this.printer.println("Phone: (555) 123-4567");
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
        const priceLine = `  ${item.quantity} x ฿${item.price.toFixed(2)} = ฿${(item.quantity * item.price).toFixed(2)}`;
        this.printer.println(priceLine);
      }
      
      this.printer.drawLine();
      
      // Total
      this.printer.setTextSize(1, 1);
      this.printer.println(`TOTAL: ฿${receiptData.total.toFixed(2)}`);
      this.printer.setTextNormal();
      
      this.printer.newLine();
      this.printer.alignCenter();
      this.printer.println("အားပေးမှုအတွက် ကျေးဇူးတင်ပါသည်။");
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
    if (this.useWindowsPrinter && this.windowsPrinter) {
      return await this.windowsPrinter.checkConnection();
    }

    if (!this.printer) {
      return false;
    }

    try {
      return await this.printer.isPrinterConnected();
    } catch (error) {
      console.error('Printer connection check failed:', error);
      return false;
    }
  }
}
