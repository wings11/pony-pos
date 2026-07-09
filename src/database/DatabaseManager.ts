import * as sqlite3 from 'sqlite3';
import * as path from 'path';
import * as fs from 'fs';
import { app } from 'electron';

// One row per size variant: the same barcode may appear multiple times with
// different sizes, each tracking its own stock. UNIQUE(barcode, size).
export interface Product {
  id?: number;
  barcode: string;
  name: string;
  price: number;          // selling price
  original_price?: number; // cost price (admin only in UI)
  size: string;            // free text: "M", "XL", "40", ... ('' = no size)
  stock: number;
  created_at?: string;
}

export interface ProductVariantInput {
  size: string;
  stock: number;
}

export interface NewProduct {
  barcode: string;
  name: string;
  price: number;
  original_price?: number;
  variants: ProductVariantInput[];
}

export interface Sale {
  id?: number;
  total: number;
  items: SaleItem[];
  returns?: ReturnRecord[];
  created_at?: string;
}

export interface SaleItem {
  barcode: string;
  name: string;
  size?: string;
  price: number;
  quantity: number;
}

export interface ReturnRecord {
  id?: number;
  sale_id: number;
  barcode: string;
  name: string;
  size?: string;
  price: number;
  quantity: number;
  created_at?: string;
}

export class DatabaseManager {
  private db: sqlite3.Database;

  constructor() {
    // Persist DB in Electron user data directory, not project folder.
    const userDataPath = app.getPath('userData');
    if (!fs.existsSync(userDataPath)) {
      fs.mkdirSync(userDataPath, { recursive: true });
    }
    const dbPath = path.join(userDataPath, 'pos-database.db');

    // First run in this location: adopt the newest existing database from
    // previous locations (dev runs store under appData/Electron; very old
    // versions used the project folder) so data follows the app.
    if (!fs.existsSync(dbPath)) {
      const legacyCandidates = [
        path.join(app.getPath('appData'), 'Electron', 'pos-database.db'),
        path.join(process.cwd(), 'pos-database.db')
      ].filter(p => p !== dbPath && fs.existsSync(p));

      if (legacyCandidates.length > 0) {
        legacyCandidates.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
        fs.copyFileSync(legacyCandidates[0], dbPath);
      }
    }

    this.db = new sqlite3.Database(dbPath);
  }

  public async initialize(): Promise<void> {
    await this.run(`
      CREATE TABLE IF NOT EXISTS products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        barcode TEXT NOT NULL,
        name TEXT NOT NULL,
        price REAL NOT NULL,
        original_price REAL NOT NULL DEFAULT 0,
        size TEXT NOT NULL DEFAULT '',
        stock INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (barcode, size)
      )
    `);

    await this.run(`
      CREATE TABLE IF NOT EXISTS sales (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        total REAL NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await this.run(`
      CREATE TABLE IF NOT EXISTS sale_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sale_id INTEGER NOT NULL,
        barcode TEXT NOT NULL,
        name TEXT NOT NULL,
        size TEXT NOT NULL DEFAULT '',
        price REAL NOT NULL,
        quantity INTEGER NOT NULL,
        FOREIGN KEY (sale_id) REFERENCES sales (id)
      )
    `);

    await this.run(`
      CREATE TABLE IF NOT EXISTS returns (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sale_id INTEGER NOT NULL,
        barcode TEXT NOT NULL,
        name TEXT NOT NULL,
        size TEXT NOT NULL DEFAULT '',
        price REAL NOT NULL,
        quantity INTEGER NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (sale_id) REFERENCES sales (id)
      )
    `);

    // Column migrations for databases created before these columns existed.
    for (const migration of [
      'ALTER TABLE products ADD COLUMN original_price REAL NOT NULL DEFAULT 0',
      'ALTER TABLE products ADD COLUMN size TEXT',
      "ALTER TABLE sale_items ADD COLUMN size TEXT NOT NULL DEFAULT ''",
      "ALTER TABLE returns ADD COLUMN size TEXT NOT NULL DEFAULT ''"
    ]) {
      try {
        await this.run(migration);
      } catch (err: any) {
        if (!String(err?.message || '').includes('duplicate column name')) {
          throw err;
        }
      }
    }

    // Legacy databases have UNIQUE on barcode alone, which blocks size variants.
    // Rebuild the table with UNIQUE(barcode, size) while keeping all data.
    const master = await this.getRow<{ sql: string }>(
      "SELECT sql FROM sqlite_master WHERE type='table' AND name='products'"
    );
    if (master && /barcode\s+TEXT\s+UNIQUE/i.test(master.sql)) {
      await this.run('BEGIN TRANSACTION');
      try {
        await this.run('ALTER TABLE products RENAME TO products_legacy');
        await this.run(`
          CREATE TABLE products (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            barcode TEXT NOT NULL,
            name TEXT NOT NULL,
            price REAL NOT NULL,
            original_price REAL NOT NULL DEFAULT 0,
            size TEXT NOT NULL DEFAULT '',
            stock INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE (barcode, size)
          )
        `);
        await this.run(`
          INSERT INTO products (id, barcode, name, price, original_price, size, stock, created_at)
          SELECT id, barcode, name, price, COALESCE(original_price, 0), COALESCE(size, ''), stock, created_at
          FROM products_legacy
        `);
        await this.run('DROP TABLE products_legacy');
        await this.run('COMMIT');
      } catch (err) {
        try {
          await this.run('ROLLBACK');
        } catch {
          // Ignore rollback failure; the original error is what matters.
        }
        throw err;
      }
    }

    await this.run("UPDATE products SET size = '' WHERE size IS NULL");
  }

  // Insert one row per size variant, atomically.
  public async addProduct(product: NewProduct): Promise<void> {
    const variants = product.variants && product.variants.length > 0
      ? product.variants
      : [{ size: '', stock: 0 }];

    await this.run('BEGIN TRANSACTION');
    try {
      for (const variant of variants) {
        const size = String(variant.size || '').trim();
        try {
          await this.run(
            'INSERT INTO products (barcode, name, price, original_price, size, stock) VALUES (?, ?, ?, ?, ?, ?)',
            [product.barcode, product.name, product.price, product.original_price || 0, size, variant.stock]
          );
        } catch (err: any) {
          if (String(err?.message || '').includes('UNIQUE constraint failed')) {
            throw new Error(size
              ? `Size "${size}" already exists for barcode ${product.barcode}`
              : `Barcode ${product.barcode} already exists`);
          }
          throw err;
        }
      }
      await this.run('COMMIT');
    } catch (err) {
      try {
        await this.run('ROLLBACK');
      } catch {
        // Ignore rollback failure; the original error is what matters.
      }
      throw err;
    }
  }

  public async getProduct(barcode: string): Promise<Product | null> {
    const row = await this.getRow<Product>('SELECT * FROM products WHERE barcode = ?', [barcode]);
    return row || null;
  }

  public async getProductVariants(barcode: string): Promise<Product[]> {
    return this.allRows<Product>('SELECT * FROM products WHERE barcode = ? ORDER BY size', [barcode]);
  }

  public async getAllProducts(): Promise<Product[]> {
    return this.allRows<Product>('SELECT * FROM products ORDER BY name, size');
  }

  public async updateStock(barcode: string, size: string, newStock: number): Promise<boolean> {
    const result = await this.run(
      'UPDATE products SET stock = ? WHERE barcode = ? AND size = ?',
      [newStock, barcode, String(size || '')]
    );
    return result.changes > 0;
  }

  public async deleteProduct(barcode: string, size: string): Promise<boolean> {
    const result = await this.run(
      'DELETE FROM products WHERE barcode = ? AND size = ?',
      [barcode, String(size || '')]
    );
    return result.changes > 0;
  }

  private run(sql: string, params: any[] = []): Promise<{ lastID: number; changes: number }> {
    return new Promise((resolve, reject) => {
      this.db.run(sql, params, function (this: any, err: any) {
        if (err) reject(err);
        else resolve({ lastID: this.lastID, changes: this.changes });
      });
    });
  }

  private allRows<T = any>(sql: string, params: any[] = []): Promise<T[]> {
    return new Promise((resolve, reject) => {
      this.db.all(sql, params, (err: any, rows: T[]) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });
  }

  private getRow<T = any>(sql: string, params: any[] = []): Promise<T | undefined> {
    return new Promise((resolve, reject) => {
      this.db.get(sql, params, (err: any, row: T) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
  }

  public async createSale(saleData: Omit<Sale, 'id' | 'created_at'>): Promise<number> {
    await this.run('BEGIN TRANSACTION');
    try {
      const saleResult = await this.run('INSERT INTO sales (total) VALUES (?)', [saleData.total]);
      const saleId = saleResult.lastID;

      for (const item of saleData.items) {
        const size = String(item.size || '');
        // Guard against overselling: only decrement when enough stock remains.
        const stockResult = await this.run(
          'UPDATE products SET stock = stock - ? WHERE barcode = ? AND size = ? AND stock >= ?',
          [item.quantity, item.barcode, size, item.quantity]
        );
        if (stockResult.changes === 0) {
          throw new Error(`Insufficient stock for "${item.name}${size ? ` (${size})` : ''}"`);
        }

        await this.run(
          'INSERT INTO sale_items (sale_id, barcode, name, size, price, quantity) VALUES (?, ?, ?, ?, ?, ?)',
          [saleId, item.barcode, item.name, size, item.price, item.quantity]
        );
      }

      await this.run('COMMIT');
      return saleId;
    } catch (err) {
      try {
        await this.run('ROLLBACK');
      } catch {
        // Ignore rollback failure; the original error is what matters.
      }
      throw err;
    }
  }

  // Return part of a sale line. Records the return at the price paid at sale time
  // and puts the quantity back into stock. Rejects returning more than was bought
  // (minus anything already returned).
  public async createReturn(saleId: number, barcode: string, size: string, quantity: number): Promise<number> {
    if (!Number.isInteger(quantity) || quantity < 1) {
      throw new Error('Invalid return quantity');
    }
    const sizeValue = String(size || '');

    await this.run('BEGIN TRANSACTION');
    try {
      const line = await this.getRow<{ name: string; price: number; purchased: number }>(
        'SELECT name, price, SUM(quantity) AS purchased FROM sale_items WHERE sale_id = ? AND barcode = ? AND size = ?',
        [saleId, barcode, sizeValue]
      );
      if (!line || !line.purchased) {
        throw new Error('Item not found on this receipt');
      }

      const returnedRow = await this.getRow<{ returned: number }>(
        'SELECT COALESCE(SUM(quantity), 0) AS returned FROM returns WHERE sale_id = ? AND barcode = ? AND size = ?',
        [saleId, barcode, sizeValue]
      );
      const remaining = line.purchased - (returnedRow ? returnedRow.returned : 0);
      if (quantity > remaining) {
        throw new Error(`Only ${remaining} item(s) left to return on this receipt`);
      }

      await this.run(
        'INSERT INTO returns (sale_id, barcode, name, size, price, quantity) VALUES (?, ?, ?, ?, ?, ?)',
        [saleId, barcode, line.name, sizeValue, line.price, quantity]
      );
      // Put stock back; if the product was deleted since the sale, just record the return.
      await this.run('UPDATE products SET stock = stock + ? WHERE barcode = ? AND size = ?', [quantity, barcode, sizeValue]);

      await this.run('COMMIT');
      return line.price * quantity;
    } catch (err) {
      try {
        await this.run('ROLLBACK');
      } catch {
        // Ignore rollback failure; the original error is what matters.
      }
      throw err;
    }
  }

  public async getSalesReport(date?: string): Promise<{ sales: Sale[]; total: number }> {
    let query = 'SELECT * FROM sales';
    const params: any[] = [];

    if (date) {
      // created_at is stored in UTC (CURRENT_TIMESTAMP); compare against the local calendar day.
      query += " WHERE DATE(created_at, 'localtime') = ?";
      params.push(date);
    }

    query += ' ORDER BY created_at DESC';

    const salesRows = await this.allRows<Sale>(query, params);
    const sales: Sale[] = [];

    for (const saleRow of salesRows) {
      const items = await this.allRows<SaleItem>('SELECT * FROM sale_items WHERE sale_id = ?', [saleRow.id]);
      const returns = await this.allRows<ReturnRecord>('SELECT * FROM returns WHERE sale_id = ?', [saleRow.id]);
      sales.push({ ...saleRow, items, returns });
    }

    const total = sales.reduce((sum, sale) => sum + sale.total, 0);
    return { sales, total };
  }

  public close(): void {
    this.db.close();
  }
}
