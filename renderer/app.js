// POS System Frontend JavaScript

class POSSystem {
    constructor() {
        this.cart = [];
        this.currentTotal = 0;
        this.currentSale = null;
        
        this.initializeEventListeners();
        this.loadProducts();
        this.checkPrinterStatus();
    }

    initializeEventListeners() {
        // Tab switching
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', (e) => this.switchTab(e.target.id));
        });

        // Barcode input for sale
        const barcodeInput = document.getElementById('barcode-input');
        barcodeInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.addItemToCart();
            }
        });

        document.getElementById('add-item-btn').addEventListener('click', () => this.addItemToCart());
        document.getElementById('clear-cart-btn').addEventListener('click', () => this.clearCart());
        document.getElementById('complete-sale-btn').addEventListener('click', () => this.completeSale());

        // Add product form
        document.getElementById('add-product-form').addEventListener('submit', (e) => this.addNewProduct(e));
        document.getElementById('scan-new-barcode').addEventListener('click', () => this.scanNewBarcode());

        // Search products
        document.getElementById('search-btn').addEventListener('click', () => this.searchProducts());
        document.getElementById('product-search').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.searchProducts();
            }
        });

        // Modal and printer
        document.getElementById('close-modal-btn').addEventListener('click', () => this.closeModal());
        document.getElementById('print-receipt-btn').addEventListener('click', () => this.printReceipt());
        document.getElementById('test-printer-btn').addEventListener('click', () => this.testPrinter());

        // Reports button
        document.getElementById('reports-btn').addEventListener('click', () => this.showReports());
    }

    switchTab(tabId) {
        // Remove active class from all tabs and content
        document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));

        // Add active class to clicked tab
        document.getElementById(tabId).classList.add('active');

        // Show corresponding content
        const contentMap = {
            'sale-tab': 'sale-content',
            'inventory-tab': 'inventory-content',
            'add-product-tab': 'add-product-content'
        };

        const contentId = contentMap[tabId];
        if (contentId) {
            document.getElementById(contentId).classList.add('active');
            
            // Load products when switching to inventory tab
            if (tabId === 'inventory-tab') {
                this.loadProducts();
            }
        }
    }

    async addItemToCart() {
        const barcodeInput = document.getElementById('barcode-input');
        const barcode = barcodeInput.value.trim();
        
        if (!barcode) {
            alert('Please enter a barcode');
            return;
        }

        try {
            const product = await window.electronAPI.getProduct(barcode);
            
            if (!product) {
                alert('Product not found');
                return;
            }

            if (product.stock <= 0) {
                alert('Product is out of stock');
                return;
            }

            // Check if item already in cart
            const existingItem = this.cart.find(item => item.barcode === barcode);
            
            if (existingItem) {
                if (existingItem.quantity >= product.stock) {
                    alert('Cannot add more items - insufficient stock');
                    return;
                }
                existingItem.quantity += 1;
            } else {
                this.cart.push({
                    barcode: product.barcode,
                    name: product.name,
                    price: product.price,
                    quantity: 1
                });
            }

            this.updateCartDisplay();
            barcodeInput.value = '';
            barcodeInput.focus();

        } catch (error) {
            console.error('Error adding item to cart:', error);
            alert('Error adding item to cart');
        }
    }

    updateCartDisplay() {
        const cartItemsDiv = document.getElementById('cart-items');
        const cartTotalSpan = document.getElementById('cart-total');

        if (this.cart.length === 0) {
            cartItemsDiv.innerHTML = '<p style="text-align: center; color: #6c757d;">Cart is empty</p>';
            this.currentTotal = 0;
        } else {
            cartItemsDiv.innerHTML = this.cart.map(item => `
                <div class="cart-item">
                    <div class="cart-item-info">
                        <div class="cart-item-name">${item.name}</div>
                        <div class="cart-item-details">
                            ${item.quantity} × $${item.price.toFixed(2)}
                        </div>
                    </div>
                    <div class="cart-item-total">$${(item.quantity * item.price).toFixed(2)}</div>
                </div>
            `).join('');

            this.currentTotal = this.cart.reduce((total, item) => total + (item.quantity * item.price), 0);
        }

        cartTotalSpan.textContent = this.currentTotal.toFixed(2);
    }

    clearCart() {
        this.cart = [];
        this.currentTotal = 0;
        this.updateCartDisplay();
    }

    async completeSale() {
        if (this.cart.length === 0) {
            alert('Cart is empty');
            return;
        }

        try {
            const saleData = {
                total: this.currentTotal,
                items: this.cart
            };

            const saleId = await window.electronAPI.createSale(saleData);
            
            this.currentSale = {
                id: saleId,
                ...saleData,
                date: new Date().toLocaleString()
            };

            // Show success modal
            document.getElementById('modal-total').textContent = this.currentTotal.toFixed(2);
            document.getElementById('sale-modal').classList.add('active');

            // Clear cart
            this.clearCart();

        } catch (error) {
            console.error('Error completing sale:', error);
            alert('Error completing sale');
        }
    }

    closeModal() {
        document.getElementById('sale-modal').classList.remove('active');
        this.currentSale = null;
    }

    async printReceipt() {
        if (!this.currentSale) {
            alert('No sale to print');
            return;
        }

        try {
            const success = await window.electronAPI.printReceipt(this.currentSale);
            
            if (success) {
                alert('Receipt printed successfully');
            } else {
                alert('Failed to print receipt. Check printer connection.');
            }
            
            this.closeModal();

        } catch (error) {
            console.error('Error printing receipt:', error);
            alert('Error printing receipt');
        }
    }

    async testPrinter() {
        try {
            const success = await window.electronAPI.testPrinter();
            
            if (success) {
                alert('Printer test successful');
                document.getElementById('printer-status').textContent = 'Printer: Connected';
            } else {
                alert('Printer test failed. Check connection.');
                document.getElementById('printer-status').textContent = 'Printer: Not Connected';
            }

        } catch (error) {
            console.error('Error testing printer:', error);
            alert('Error testing printer');
        }
    }

    async checkPrinterStatus() {
        // This will be called periodically to check printer status
        try {
            const success = await window.electronAPI.testPrinter();
            const statusElement = document.getElementById('printer-status');
            statusElement.textContent = success ? 'Printer: Connected' : 'Printer: Not Connected';
        } catch (error) {
            document.getElementById('printer-status').textContent = 'Printer: Error';
        }
    }

    async addNewProduct(e) {
        e.preventDefault();

        const barcode = document.getElementById('new-barcode').value.trim();
        const name = document.getElementById('new-name').value.trim();
        const price = parseFloat(document.getElementById('new-price').value);
        const stock = parseInt(document.getElementById('new-stock').value);

        if (!barcode || !name || isNaN(price) || isNaN(stock)) {
            alert('Please fill all fields correctly');
            return;
        }

        try {
            // Check if product already exists
            const existing = await window.electronAPI.getProduct(barcode);
            if (existing) {
                alert('Product with this barcode already exists');
                return;
            }

            await window.electronAPI.addProduct({ barcode, name, price, stock });
            
            alert('Product added successfully');
            
            // Clear form
            document.getElementById('add-product-form').reset();
            
            // Refresh product list if on inventory tab
            if (document.getElementById('inventory-tab').classList.contains('active')) {
                this.loadProducts();
            }

        } catch (error) {
            console.error('Error adding product:', error);
            alert('Error adding product');
        }
    }

    scanNewBarcode() {
        // Focus on barcode input for scanning
        document.getElementById('new-barcode').focus();
        alert('Please scan the barcode or enter it manually');
    }

    async loadProducts() {
        try {
            const products = await window.electronAPI.getAllProducts();
            this.displayProducts(products);
        } catch (error) {
            console.error('Error loading products:', error);
        }
    }

    async searchProducts() {
        const searchTerm = document.getElementById('product-search').value.trim().toLowerCase();
        
        try {
            const allProducts = await window.electronAPI.getAllProducts();
            const filteredProducts = allProducts.filter(product => 
                product.name.toLowerCase().includes(searchTerm) ||
                product.barcode.includes(searchTerm)
            );
            
            this.displayProducts(filteredProducts);
        } catch (error) {
            console.error('Error searching products:', error);
        }
    }

    displayProducts(products) {
        const productList = document.getElementById('product-list');
        
        if (products.length === 0) {
            productList.innerHTML = '<p style="text-align: center; color: #6c757d;">No products found</p>';
            return;
        }

        productList.innerHTML = products.map(product => `
            <div class="product-card">
                <div class="product-name">${product.name}</div>
                <div class="product-details">
                    Barcode: ${product.barcode}<br>
                    Price: $${product.price.toFixed(2)}<br>
                    Stock: ${product.stock} ${product.stock <= 5 ? '⚠️ Low Stock' : ''}
                </div>
                <div class="product-actions">
                    <button class="btn btn-secondary btn-small" onclick="posSystem.editStock('${product.barcode}')">
                        Update Stock
                    </button>
                </div>
            </div>
        `).join('');
    }

    async editStock(barcode) {
        const newStock = prompt('Enter new stock quantity:');
        
        if (newStock === null || newStock === '') return;
        
        const stockNumber = parseInt(newStock);
        
        if (isNaN(stockNumber) || stockNumber < 0) {
            alert('Please enter a valid stock number');
            return;
        }

        try {
            await window.electronAPI.updateStock(barcode, stockNumber);
            alert('Stock updated successfully');
            this.loadProducts();
        } catch (error) {
            console.error('Error updating stock:', error);
            alert('Error updating stock');
        }
    }

    async showReports() {
        try {
            const today = new Date().toISOString().split('T')[0];
            const report = await window.electronAPI.getSalesReport(today);
            
            const message = `Daily Sales Report (${today}):\n\n` +
                           `Total Sales: ${report.sales.length}\n` +
                           `Total Revenue: $${report.total.toFixed(2)}`;
            
            alert(message);
        } catch (error) {
            console.error('Error generating report:', error);
            alert('Error generating report');
        }
    }
}

// Initialize the POS system when the page loads
let posSystem;

document.addEventListener('DOMContentLoaded', () => {
    posSystem = new POSSystem();
    
    // Check printer status every 30 seconds
    setInterval(() => {
        posSystem.checkPrinterStatus();
    }, 30000);
});