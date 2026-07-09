import ExcelJS from 'exceljs';
import type { Sale, Product } from '../database/DatabaseManager';

export interface ExportFilter {
  mode?: string;
  startDate?: string;
  endDate?: string;
}

export interface ExportOptions {
  filter: ExportFilter;
  adminMode: boolean;
}

const HEADER_FILL: ExcelJS.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FF4F7A8F' }
};
const MONEY_FMT = '#,##0.00';

export class ExportService {
  // SQLite stores created_at as UTC "YYYY-MM-DD HH:MM:SS"; parse as UTC.
  private parseUtc(createdAt: any): Date {
    const text = String(createdAt || '');
    if (/[TZ]|[+-]\d{2}:\d{2}$/.test(text)) {
      return new Date(text);
    }
    return new Date(text.replace(' ', 'T') + 'Z');
  }

  private fmtDateTime(d: Date): string {
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  }

  private fmtDate(d: Date): string {
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }

  private styleHeaderRow(row: ExcelJS.Row): void {
    row.eachCell((cell) => {
      cell.fill = HEADER_FILL;
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.alignment = { vertical: 'middle' };
    });
  }

  private periodLabel(filter: ExportFilter): string {
    if (!filter || !filter.mode || filter.mode === 'all') return 'All time';
    if (filter.mode === 'today') return `Today (${filter.startDate})`;
    if (filter.startDate && filter.endDate) return `${filter.startDate} to ${filter.endDate}`;
    return filter.mode;
  }

  public async buildSalesWorkbook(sales: Sale[], products: Product[], options: ExportOptions): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Pony POS';
    wb.created = new Date();

    // Current cost per variant, for estimated-profit figures (admin only).
    const costByKey = new Map<string, number>();
    products.forEach((p) => {
      costByKey.set(`${p.barcode}||${String(p.size || '')}`, Number(p.original_price || 0));
    });

    // ---- aggregate once, reuse across sheets ----
    let grossRevenue = 0;
    let itemsSold = 0;
    let refunded = 0;
    let itemsReturned = 0;
    let estCogsSold = 0;
    let estCogsReturned = 0;
    const soldBarcodes = new Set<string>();

    interface DayAgg { salesCount: number; items: number; gross: number; refunds: number; }
    const days = new Map<string, DayAgg>();
    const dayOf = (createdAt: any) => this.fmtDate(this.parseUtc(createdAt));
    const getDay = (key: string): DayAgg => {
      if (!days.has(key)) days.set(key, { salesCount: 0, items: 0, gross: 0, refunds: 0 });
      return days.get(key)!;
    };

    for (const sale of sales) {
      grossRevenue += Number(sale.total || 0);
      const day = getDay(dayOf(sale.created_at));
      day.salesCount += 1;
      day.gross += Number(sale.total || 0);

      for (const item of sale.items || []) {
        const qty = Number(item.quantity || 0);
        itemsSold += qty;
        day.items += qty;
        soldBarcodes.add(item.barcode);
        estCogsSold += qty * (costByKey.get(`${item.barcode}||${String(item.size || '')}`) || 0);
      }

      for (const r of sale.returns || []) {
        const amount = Number(r.price) * Number(r.quantity);
        refunded += amount;
        itemsReturned += Number(r.quantity || 0);
        getDay(dayOf(r.created_at)).refunds += amount;
        estCogsReturned += Number(r.quantity || 0) * (costByKey.get(`${r.barcode}||${String(r.size || '')}`) || 0);
      }
    }

    const netRevenue = grossRevenue - refunded;
    const estCogsNet = estCogsSold - estCogsReturned;

    // ================= Sheet 1: Summary =================
    const summary = wb.addWorksheet('Summary');
    summary.columns = [{ width: 34 }, { width: 24 }];

    const title = summary.addRow(['Pony POS — Sales Report']);
    title.font = { bold: true, size: 16 };
    summary.addRow([]);
    summary.addRow(['Generated', this.fmtDateTime(new Date())]);
    summary.addRow(['Period', this.periodLabel(options.filter)]);
    summary.addRow([]);

    const metric = (label: string, value: number | string, money = false) => {
      const row = summary.addRow([label, value]);
      row.getCell(1).font = { bold: true };
      if (money) row.getCell(2).numFmt = MONEY_FMT;
      return row;
    };

    metric('Total Sales (receipts)', sales.length);
    metric('Gross Revenue (฿)', grossRevenue, true);
    metric('Refunded (฿)', refunded, true);
    metric('Net Revenue (฿)', netRevenue, true);
    metric('Items Sold', itemsSold);
    metric('Items Returned', itemsReturned);
    metric('Net Items Sold', itemsSold - itemsReturned);
    metric('Distinct Products Sold', soldBarcodes.size);

    if (options.adminMode) {
      summary.addRow([]);
      metric('Est. Cost of Goods Sold (฿)', estCogsNet, true);
      metric('Est. Profit (฿)', netRevenue - estCogsNet, true);
      const note = summary.addRow(['Note: cost figures use current cost prices, not cost at sale time.']);
      note.getCell(1).font = { italic: true, size: 9, color: { argb: 'FF6C757D' } };
    }

    // ================= Sheet 2: Sales =================
    const salesSheet = wb.addWorksheet('Sales');
    salesSheet.columns = [
      { header: 'Sale #', key: 'id', width: 9 },
      { header: 'Date & Time', key: 'dt', width: 20 },
      { header: 'Barcode', key: 'barcode', width: 18 },
      { header: 'Item', key: 'name', width: 28 },
      { header: 'Size', key: 'size', width: 9 },
      { header: 'Unit Price (฿)', key: 'price', width: 14 },
      { header: 'Qty', key: 'qty', width: 7 },
      { header: 'Line Total (฿)', key: 'line', width: 14 },
      { header: 'Returned Qty', key: 'rqty', width: 13 },
      { header: 'Refunded (฿)', key: 'refund', width: 13 },
      { header: 'Net Line (฿)', key: 'net', width: 13 },
      { header: 'Receipt Total (฿)', key: 'total', width: 16 }
    ];
    this.styleHeaderRow(salesSheet.getRow(1));
    salesSheet.views = [{ state: 'frozen', ySplit: 1 }];
    salesSheet.autoFilter = { from: 'A1', to: 'L1' };

    for (const sale of sales) {
      const returnedByKey = new Map<string, number>();
      (sale.returns || []).forEach((r) => {
        const key = `${r.barcode}||${String(r.size || '')}`;
        returnedByKey.set(key, (returnedByKey.get(key) || 0) + Number(r.quantity));
      });

      for (const item of sale.items || []) {
        const rqty = returnedByKey.get(`${item.barcode}||${String(item.size || '')}`) || 0;
        const lineTotal = Number(item.price) * Number(item.quantity);
        const refundAmt = Number(item.price) * rqty;
        salesSheet.addRow({
          id: sale.id,
          dt: this.fmtDateTime(this.parseUtc(sale.created_at)),
          barcode: item.barcode,
          name: item.name,
          size: String(item.size || ''),
          price: Number(item.price),
          qty: Number(item.quantity),
          line: lineTotal,
          rqty,
          refund: refundAmt,
          net: lineTotal - refundAmt,
          total: Number(sale.total)
        });
      }
    }
    ['price', 'line', 'refund', 'net', 'total'].forEach((key) => {
      salesSheet.getColumn(key).numFmt = MONEY_FMT;
    });

    // ================= Sheet 3: Returns =================
    const returnsSheet = wb.addWorksheet('Returns');
    returnsSheet.columns = [
      { header: 'Return Date', key: 'dt', width: 20 },
      { header: 'Sale #', key: 'saleId', width: 9 },
      { header: 'Sale Date', key: 'saleDt', width: 20 },
      { header: 'Barcode', key: 'barcode', width: 18 },
      { header: 'Item', key: 'name', width: 28 },
      { header: 'Size', key: 'size', width: 9 },
      { header: 'Qty', key: 'qty', width: 7 },
      { header: 'Unit Price (฿)', key: 'price', width: 14 },
      { header: 'Refund (฿)', key: 'refund', width: 13 }
    ];
    this.styleHeaderRow(returnsSheet.getRow(1));
    returnsSheet.views = [{ state: 'frozen', ySplit: 1 }];
    returnsSheet.autoFilter = { from: 'A1', to: 'I1' };

    for (const sale of sales) {
      for (const r of sale.returns || []) {
        returnsSheet.addRow({
          dt: this.fmtDateTime(this.parseUtc(r.created_at)),
          saleId: sale.id,
          saleDt: this.fmtDateTime(this.parseUtc(sale.created_at)),
          barcode: r.barcode,
          name: r.name,
          size: String(r.size || ''),
          qty: Number(r.quantity),
          price: Number(r.price),
          refund: Number(r.price) * Number(r.quantity)
        });
      }
    }
    ['price', 'refund'].forEach((key) => {
      returnsSheet.getColumn(key).numFmt = MONEY_FMT;
    });

    // ================= Sheet 4: Daily Breakdown =================
    const daily = wb.addWorksheet('Daily Breakdown');
    daily.columns = [
      { header: 'Date', key: 'date', width: 14 },
      { header: 'Sales', key: 'sales', width: 9 },
      { header: 'Items Sold', key: 'items', width: 12 },
      { header: 'Gross (฿)', key: 'gross', width: 14 },
      { header: 'Refunds (฿)', key: 'refunds', width: 14 },
      { header: 'Net (฿)', key: 'net', width: 14 }
    ];
    this.styleHeaderRow(daily.getRow(1));
    daily.views = [{ state: 'frozen', ySplit: 1 }];

    const sortedDays = Array.from(days.keys()).sort();
    for (const key of sortedDays) {
      const d = days.get(key)!;
      daily.addRow({
        date: key,
        sales: d.salesCount,
        items: d.items,
        gross: d.gross,
        refunds: d.refunds,
        net: d.gross - d.refunds
      });
    }
    const totalRow = daily.addRow({
      date: 'TOTAL',
      sales: sales.length,
      items: itemsSold,
      gross: grossRevenue,
      refunds: refunded,
      net: netRevenue
    });
    totalRow.font = { bold: true };
    ['gross', 'refunds', 'net'].forEach((key) => {
      daily.getColumn(key).numFmt = MONEY_FMT;
    });

    // ================= Sheet 5: Inventory (current snapshot) =================
    const inv = wb.addWorksheet('Inventory');
    const invColumns: Partial<ExcelJS.Column>[] = [
      { header: 'Barcode', key: 'barcode', width: 18 },
      { header: 'Item', key: 'name', width: 28 },
      { header: 'Size', key: 'size', width: 9 },
      { header: 'Stock', key: 'stock', width: 9 },
      { header: 'Selling Price (฿)', key: 'price', width: 16 },
      { header: 'Stock Value @ Sell (฿)', key: 'valueSell', width: 20 }
    ];
    if (options.adminMode) {
      invColumns.push(
        { header: 'Cost Price (฿)', key: 'cost', width: 14 },
        { header: 'Stock Value @ Cost (฿)', key: 'valueCost', width: 20 },
        { header: 'Margin/Unit (฿)', key: 'margin', width: 15 },
        { header: 'Margin %', key: 'marginPct', width: 10 }
      );
    }
    inv.columns = invColumns;
    this.styleHeaderRow(inv.getRow(1));
    inv.views = [{ state: 'frozen', ySplit: 1 }];
    inv.autoFilter = { from: 'A1', to: options.adminMode ? 'J1' : 'F1' };

    let totalUnits = 0;
    let totalValueSell = 0;
    let totalValueCost = 0;
    for (const p of products) {
      const stock = Number(p.stock || 0);
      const price = Number(p.price || 0);
      const cost = Number(p.original_price || 0);
      totalUnits += stock;
      totalValueSell += stock * price;
      totalValueCost += stock * cost;

      const row: any = {
        barcode: p.barcode,
        name: p.name,
        size: String(p.size || ''),
        stock,
        price,
        valueSell: stock * price
      };
      if (options.adminMode) {
        row.cost = cost;
        row.valueCost = stock * cost;
        row.margin = price - cost;
        row.marginPct = price > 0 ? (price - cost) / price : 0;
      }
      inv.addRow(row);
    }
    const invTotal: any = { name: 'TOTAL', stock: totalUnits, valueSell: totalValueSell };
    if (options.adminMode) invTotal.valueCost = totalValueCost;
    const invTotalRow = inv.addRow(invTotal);
    invTotalRow.font = { bold: true };

    ['price', 'valueSell'].forEach((key) => {
      inv.getColumn(key).numFmt = MONEY_FMT;
    });
    if (options.adminMode) {
      ['cost', 'valueCost', 'margin'].forEach((key) => {
        inv.getColumn(key).numFmt = MONEY_FMT;
      });
      inv.getColumn('marginPct').numFmt = '0.0%';
    }

    const data = await wb.xlsx.writeBuffer();
    return Buffer.from(data as ArrayBuffer);
  }
}
