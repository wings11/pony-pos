import * as sqlite3 from 'sqlite3';
import * as path from 'path';

export interface Product {
  id?: number;
  barcode: string;
  name: string;
  price: number;
  stock: number;
  created_at?: string;
}

export interface Sale {
  id?: number;
  total: number;
  items: SaleItem[];
  created_at?: string;
}

export interface SaleItem {
  barcode: string;
  name: string;
  price: number;
  quantity: number;
}

export class DatabaseManager {
  private db: sqlite3.Database;

  constructor() {
    // Initialize database in user data directory
    const dbPath = path.join(process.cwd(), 'pos-database.db');
    this.db = new sqlite3.Database(dbPath);
  }

  public async initialize(): Promise<void> {
    // Create tables if they don't exist
    return new Promise((resolve, reject) => {
      this.createTables((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  private createTables(callback: (err?: Error) => void): void {
    const createProductsTable = `
      CREATE TABLE IF NOT EXISTS products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        barcode TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        price REAL NOT NULL,
        stock INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `;

    const createSalesTable = `
      CREATE TABLE IF NOT EXISTS sales (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        total REAL NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `;

    const createSaleItemsTable = `
      CREATE TABLE IF NOT EXISTS sale_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sale_id INTEGER NOT NULL,
        barcode TEXT NOT NULL,
        name TEXT NOT NULL,
        price REAL NOT NULL,
        quantity INTEGER NOT NULL,
        FOREIGN KEY (sale_id) REFERENCES sales (id)
      )
    `;

    this.db.serialize(() => {
      this.db.run(createProductsTable);
      this.db.run(createSalesTable);
      this.db.run(createSaleItemsTable, callback);
    });
  }

  public async addProduct(product: Omit<Product, 'id' | 'created_at'>): Promise<number> {
    return new Promise((resolve, reject) => {
      const stmt = this.db.prepare(`
        INSERT INTO products (barcode, name, price, stock)
        VALUES (?, ?, ?, ?)
      `);
      
      const self = this;
      stmt.run(product.barcode, product.name, product.price, product.stock, function(this: any, err: any) {
        if (err) reject(err);
        else resolve(this.lastID);
      });
    });
  }

  public async getProduct(barcode: string): Promise<Product | null> {
    return new Promise((resolve, reject) => {
      this.db.get('SELECT * FROM products WHERE barcode = ?', [barcode], (err: any, row: Product) => {
        if (err) reject(err);
        else resolve(row || null);
      });
    });
  }

  public async getAllProducts(): Promise<Product[]> {
    return new Promise((resolve, reject) => {
      this.db.all('SELECT * FROM products ORDER BY name', (err: any, rows: Product[]) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });
  }

  public async updateStock(barcode: string, newStock: number): Promise<boolean> {
    return new Promise((resolve, reject) => {
      this.db.run('UPDATE products SET stock = ? WHERE barcode = ?', [newStock, barcode], function(this: any, err: any) {
        if (err) reject(err);
        else resolve(this.changes > 0);
      });
    });
  }

  public async createSale(saleData: Omit<Sale, 'id' | 'created_at'>): Promise<number> {
    return new Promise((resolve, reject) => {
      const self = this;
      self.db.serialize(() => {
        self.db.run('BEGIN TRANSACTION');
        
        // Insert sale record
        self.db.run('INSERT INTO sales (total) VALUES (?)', [saleData.total], function(this: any, err: any) {
          if (err) {
            self.db.run('ROLLBACK');
            reject(err);
            return;
          }
          
          const saleId = this.lastID;
          let itemsProcessed = 0;
          const totalItems = saleData.items.length;
          
          if (totalItems === 0) {
            self.db.run('COMMIT');
            resolve(saleId);
            return;
          }
          
          // Insert sale items and update stock
          saleData.items.forEach(item => {
            self.db.run(
              'INSERT INTO sale_items (sale_id, barcode, name, price, quantity) VALUES (?, ?, ?, ?, ?)',
              [saleId, item.barcode, item.name, item.price, item.quantity],
              (err: any) => {
                if (err) {
                  self.db.run('ROLLBACK');
                  reject(err);
                  return;
                }
                
                // Update stock
                self.db.run('UPDATE products SET stock = stock - ? WHERE barcode = ?', [item.quantity, item.barcode], (err: any) => {
                  if (err) {
                    self.db.run('ROLLBACK');
                    reject(err);
                    return;
                  }
                  
                  itemsProcessed++;
                  if (itemsProcessed === totalItems) {
                    self.db.run('COMMIT');
                    resolve(saleId);
                  }
                });
              }
            );
          });
        });
      });
    });
  }

  public async getSalesReport(date?: string): Promise<{ sales: Sale[]; total: number }> {
    return new Promise((resolve, reject) => {
      let query = 'SELECT * FROM sales';
      const params: any[] = [];

      if (date) {
        query += ' WHERE DATE(created_at) = ?';
        params.push(date);
      }

      query += ' ORDER BY created_at DESC';

      this.db.all(query, params, (err: any, salesRows: Sale[]) => {
        if (err) {
          reject(err);
          return;
        }

        if (salesRows.length === 0) {
          resolve({ sales: [], total: 0 });
          return;
        }

        // Get items for each sale
        let salesProcessed = 0;
        const sales = salesRows.map(sale => ({ ...sale, items: [] as SaleItem[] }));

        sales.forEach((sale, index) => {
          this.db.all('SELECT * FROM sale_items WHERE sale_id = ?', [sale.id], (err: any, items: SaleItem[]) => {
            if (err) {
              reject(err);
              return;
            }

            sales[index].items = items || [];
            salesProcessed++;

            if (salesProcessed === sales.length) {
              const total = sales.reduce((sum, sale) => sum + sale.total, 0);
              resolve({ sales, total });
            }
          });
        });
      });
    });
  }

  public close(): void {
    this.db.close();
  }
}