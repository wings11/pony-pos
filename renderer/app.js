// POS System Frontend JavaScript

class POSSystem {
    constructor() {
        this.cart = [];
        this.currentTotal = 0;
        this.currentSale = null;
        this.scannerBuffer = '';
        this.scannerLastKeyTs = 0;
        this.scannerInputGapMs = 60;
        this.pendingDeleteBarcodes = new Map();
        this.salesHistory = [];
        this.filteredSalesHistory = [];
        this.historyFilter = { mode: 'all', startDate: '', endDate: '' };
        this.saleBarcodeCatalog = [];
        this.saleBarcodeSuggestionLimit = 12;
        this.pendingStockUpdate = null;
        this.pendingReturn = null;
        this.pendingSizeSelection = null;
        this.pendingClose = false;
        this.isAdmin = false;

        this.initializeEventListeners();
        this.bootstrap();
    }

    async bootstrap() {
        // Load config first so admin-only UI (cost prices) renders correctly from the start.
        await this.loadAppConfig();
        this.resetSizeRows();
        this.loadProducts();
        this.ensureSaleBarcodeCatalog();
        this.checkPrinterStatus();
        this.focusSaleBarcodeInput();
    }

    itemDisplayName(item) {
        return item.size ? `${item.name} (${item.size})` : item.name;
    }

    // --- Size rows in the Add Product form ---

    sizeRowTemplate() {
        return `
            <div class="size-row">
                <input type="text" class="form-input size-input" list="size-suggestions" autocomplete="off" placeholder="Size (e.g. M, 40)">
                <input type="number" class="form-input stock-input" min="0" value="0" title="Initial stock">
                <button type="button" class="btn btn-danger btn-xs size-row-remove" title="Remove this size">✕</button>
            </div>
        `;
    }

    resetSizeRows() {
        const container = document.getElementById('size-rows');
        if (!container) return;
        container.innerHTML = this.sizeRowTemplate();
        this.updateSizeRowRemoveButtons();
    }

    addSizeRow() {
        const container = document.getElementById('size-rows');
        if (!container) return;
        container.insertAdjacentHTML('beforeend', this.sizeRowTemplate());
        this.updateSizeRowRemoveButtons();
        const rows = container.querySelectorAll('.size-row');
        rows[rows.length - 1].querySelector('.size-input').focus();
    }

    updateSizeRowRemoveButtons() {
        const rows = document.querySelectorAll('#size-rows .size-row');
        rows.forEach((row) => {
            row.querySelector('.size-row-remove').style.display = rows.length > 1 ? '' : 'none';
        });
    }

    handleSizeRowClick(e) {
        const btn = e.target instanceof Element ? e.target.closest('.size-row-remove') : null;
        if (!btn) return;
        btn.closest('.size-row').remove();
        this.updateSizeRowRemoveButtons();
    }

    async loadAppConfig() {
        try {
            const config = await window.electronAPI.getAppConfig();
            this.isAdmin = !!(config && config.adminMode);
        } catch (error) {
            console.error('Error loading app config:', error);
            this.isAdmin = false;
        }
        this.applyAdminVisibility();
    }

    applyAdminVisibility() {
        const costGroup = document.getElementById('original-price-group');
        if (costGroup) {
            costGroup.style.display = this.isAdmin ? '' : 'none';
        }
    }

    // Toast notification system to replace blocking alerts
    showToast(message, type = 'info') {
        const toast = document.getElementById('toast');
        toast.textContent = message;
        toast.className = 'toast show ' + type;
        
        setTimeout(() => {
            toast.classList.remove('show');
        }, 3000);
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
        barcodeInput.addEventListener('input', (e) => {
            this.updateSaleBarcodeSuggestions(e.target.value);
        });
        barcodeInput.addEventListener('focus', () => {
            this.ensureSaleBarcodeCatalog();
            this.updateSaleBarcodeSuggestions(barcodeInput.value);
        });

        document.getElementById('add-item-btn').addEventListener('click', () => this.addItemToCart());
        document.getElementById('clear-cart-btn').addEventListener('click', () => this.clearCart());
        document.getElementById('complete-sale-btn').addEventListener('click', () => this.completeSale());
        document.getElementById('cart-items').addEventListener('click', (e) => this.handleCartClick(e));

        // Add product form
        document.getElementById('add-product-form').addEventListener('submit', (e) => this.addNewProduct(e));
        document.getElementById('scan-new-barcode').addEventListener('click', () => this.scanNewBarcode());
        document.getElementById('add-size-row-btn').addEventListener('click', () => this.addSizeRow());
        document.getElementById('size-rows').addEventListener('click', (e) => this.handleSizeRowClick(e));

        // Size selection at sale time
        document.getElementById('size-select-options').addEventListener('click', (e) => this.handleSizeSelectClick(e));
        document.getElementById('size-select-cancel-btn').addEventListener('click', () => this.closeSizeModal());

        // Search products
        document.getElementById('search-btn').addEventListener('click', () => this.searchProducts());
        document.getElementById('product-search').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.searchProducts();
            }
        });
        document.getElementById('product-list').addEventListener('click', (e) => this.handleProductListClick(e));

        // Modal and printer
        document.getElementById('close-modal-btn').addEventListener('click', () => this.closeModal());
        document.getElementById('print-receipt-btn').addEventListener('click', () => this.printReceipt());
        document.getElementById('test-printer-btn').addEventListener('click', () => this.testPrinter());
        document.getElementById('stock-cancel-btn').addEventListener('click', () => this.closeStockModal());
        document.getElementById('stock-save-btn').addEventListener('click', () => this.submitStockUpdate());
        document.getElementById('stock-modal-input').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.submitStockUpdate();
            }
        });

        // Returns
        document.getElementById('history-list').addEventListener('click', (e) => this.handleHistoryClick(e));
        document.getElementById('return-cancel-btn').addEventListener('click', () => this.closeReturnModal());
        document.getElementById('return-save-btn').addEventListener('click', () => this.submitReturn());
        document.getElementById('return-modal-input').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.submitReturn();
            }
        });

        // Reports button
        document.getElementById('close-btn').addEventListener('click', () => this.closeApplication());
        document.getElementById('reports-btn').addEventListener('click', () => this.showReports());
        document.getElementById('refresh-history-btn').addEventListener('click', () => this.loadSalesHistory());
        document.getElementById('export-history-xls-btn').addEventListener('click', () => this.exportSalesHistory('xlsx'));
        document.getElementById('view-history-visualization-btn').addEventListener('click', () => this.showHistoryVisualization());
        document.getElementById('close-history-visualization-btn').addEventListener('click', () => this.hideHistoryVisualization());
        document.getElementById('history-filter-today').addEventListener('click', () => this.setHistoryFilterPreset('today'));
        document.getElementById('history-filter-7days').addEventListener('click', () => this.setHistoryFilterPreset('7days'));
        document.getElementById('history-filter-30days').addEventListener('click', () => this.setHistoryFilterPreset('30days'));
        document.getElementById('history-filter-all').addEventListener('click', () => this.setHistoryFilterPreset('all'));
        document.getElementById('apply-history-range-btn').addEventListener('click', () => this.applyCustomHistoryRange());

        // Keep scanner workflow stable when window/tab focus changes
        window.addEventListener('focus', () => {
            if (document.getElementById('sale-tab').classList.contains('active')) {
                this.focusSaleBarcodeInput();
            } else if (document.getElementById('add-product-tab').classList.contains('active')) {
                this.focusAddProductBarcodeInput();
            }
        });

        // Capture scanner input globally so cashier never needs to click into an input first.
        document.addEventListener('keydown', (e) => this.handleGlobalScannerKeydown(e), true);
    }

    focusSaleBarcodeInput() {
        const barcodeInput = document.getElementById('barcode-input');
        if (!barcodeInput) return;

        barcodeInput.disabled = false;
        barcodeInput.readOnly = false;
        setTimeout(() => barcodeInput.focus(), 50);
    }

    focusAddProductBarcodeInput() {
        const barcodeInput = document.getElementById('new-barcode');
        if (!barcodeInput) return;

        barcodeInput.disabled = false;
        barcodeInput.readOnly = false;
        setTimeout(() => barcodeInput.focus(), 50);
    }

    isEditableField(element) {
        if (!element) return false;
        if (element.isContentEditable) return true;

        const tag = element.tagName;
        if (tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT') {
            return false;
        }

        return !element.disabled && !element.readOnly;
    }

    handleGlobalScannerKeydown(e) {
        // Ignore key combos and non-printable keys (except Enter used as scanner terminator).
        if (e.altKey || e.ctrlKey || e.metaKey) return;

        const modalActive = document.querySelector('.modal.active');
        if (modalActive) return;

        const activeElement = document.activeElement;
        const activeId = activeElement ? activeElement.id : '';
        const editingNormalField = this.isEditableField(activeElement) &&
            activeId !== 'barcode-input' &&
            activeId !== 'new-barcode';
        if (editingNormalField) return;

        const now = Date.now();
        const isEnter = e.key === 'Enter';
        const isPrintable = e.key.length === 1;

        if (!isEnter && !isPrintable) return;

        // Scanner keystrokes come rapidly; reset if typing is slow like manual typing.
        if (now - this.scannerLastKeyTs > this.scannerInputGapMs) {
            this.scannerBuffer = '';
        }
        this.scannerLastKeyTs = now;

        if (isPrintable) {
            this.scannerBuffer += e.key;
            return;
        }

        // Process scanner barcode on Enter
        const barcode = this.scannerBuffer.trim();
        this.scannerBuffer = '';
        if (!barcode || barcode.length < 4) return;

        const onSaleTab = document.getElementById('sale-tab').classList.contains('active');
        const onAddProductTab = document.getElementById('add-product-tab').classList.contains('active');

        if (onSaleTab) {
            const saleInput = document.getElementById('barcode-input');
            saleInput.value = barcode;
            this.addItemToCart();
            e.preventDefault();
            return;
        }

        if (onAddProductTab) {
            const addInput = document.getElementById('new-barcode');
            const nameInput = document.getElementById('new-name');
            addInput.value = barcode;
            setTimeout(() => {
                if (nameInput && !nameInput.disabled && !nameInput.readOnly) {
                    nameInput.focus();
                    nameInput.select();
                }
            }, 0);
            this.showToast('Barcode scanned', 'success');
            e.preventDefault();
        }
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
            'add-product-tab': 'add-product-content',
            'history-tab': 'history-content'
        };

        const contentId = contentMap[tabId];
        if (contentId) {
            document.getElementById(contentId).classList.add('active');
            
            // Load products when switching to inventory tab
            if (tabId === 'inventory-tab') {
                this.loadProducts();
            } else if (tabId === 'sale-tab') {
                this.focusSaleBarcodeInput();
            } else if (tabId === 'add-product-tab') {
                this.focusAddProductBarcodeInput();
            } else if (tabId === 'history-tab') {
                this.loadSalesHistory();
                this.hideHistoryVisualization();
            }
        }
    }

    async loadSalesHistory() {
        try {
            const report = await window.electronAPI.getSalesReport();
            this.salesHistory = report.sales || [];
            this.applyHistoryFilter();
        } catch (error) {
            console.error('Error loading sales history:', error);
            this.showToast('Error loading sales history', 'error');
        }
    }

    toLocalYMD(date) {
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, '0');
        const d = String(date.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    }

    // SQLite stores created_at as UTC "YYYY-MM-DD HH:MM:SS" with no timezone marker;
    // parse it as UTC so it converts to local time correctly.
    parseSaleDate(createdAt) {
        const text = String(createdAt || '');
        if (/[TZ]|[+-]\d{2}:\d{2}$/.test(text)) {
            return new Date(text);
        }
        return new Date(text.replace(' ', 'T') + 'Z');
    }

    escapeHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    getSaleDateOnly(sale) {
        return this.toLocalYMD(this.parseSaleDate(sale.created_at));
    }

    setHistoryFilterPreset(mode) {
        const today = new Date();
        let start = '';
        let end = '';

        if (mode === 'today') {
            start = this.toLocalYMD(today);
            end = this.toLocalYMD(today);
        } else if (mode === '7days') {
            const startDate = new Date(today);
            startDate.setDate(today.getDate() - 6);
            start = this.toLocalYMD(startDate);
            end = this.toLocalYMD(today);
        } else if (mode === '30days') {
            const startDate = new Date(today);
            startDate.setDate(today.getDate() - 29);
            start = this.toLocalYMD(startDate);
            end = this.toLocalYMD(today);
        }

        this.historyFilter = { mode, startDate: start, endDate: end };
        document.getElementById('history-start-date').value = start;
        document.getElementById('history-end-date').value = end;
        this.applyHistoryFilter();
    }

    applyCustomHistoryRange() {
        const start = document.getElementById('history-start-date').value;
        const end = document.getElementById('history-end-date').value;

        if (!start || !end) {
            this.showToast('Please choose both start and end dates', 'warning');
            return;
        }
        if (start > end) {
            this.showToast('Start date must be before end date', 'warning');
            return;
        }

        this.historyFilter = { mode: 'custom', startDate: start, endDate: end };
        this.applyHistoryFilter();
    }

    applyHistoryFilter() {
        const { mode, startDate, endDate } = this.historyFilter;
        let sales = [...this.salesHistory];

        if (mode !== 'all') {
            sales = sales.filter((sale) => {
                const saleDate = this.getSaleDateOnly(sale);
                return saleDate >= startDate && saleDate <= endDate;
            });
        }

        this.filteredSalesHistory = sales;
        const total = sales.reduce((sum, sale) => sum + Number(sale.total || 0), 0);
        this.renderSalesHistory(sales, total);
    }

    renderSalesHistory(sales, totalRevenue) {
        const summary = document.getElementById('history-summary');
        const list = document.getElementById('history-list');
        if (!summary || !list) return;

        if (!sales || sales.length === 0) {
            summary.innerHTML = 'No sales yet.';
            list.innerHTML = '<p class="cart-empty">No sales history found</p>';
            return;
        }

        const totalItems = sales.reduce((acc, sale) => {
            const saleItems = (sale.items || []).reduce((sum, item) => sum + item.quantity, 0);
            return acc + saleItems;
        }, 0);

        const totalRefunded = sales.reduce((acc, sale) => {
            return acc + (sale.returns || []).reduce((sum, r) => sum + Number(r.price) * Number(r.quantity), 0);
        }, 0);

        const totalReturnedItems = sales.reduce((acc, sale) => {
            return acc + (sale.returns || []).reduce((sum, r) => sum + Number(r.quantity), 0);
        }, 0);
        const netItemsSold = totalItems - totalReturnedItems;

        summary.innerHTML = `
            <strong>Total Sales:</strong> ${sales.length}
            <span class="history-summary-sep">|</span>
            <strong>Total Revenue:</strong> ฿${Number(totalRevenue).toFixed(2)}
            <span class="history-summary-sep">|</span>
            <strong>Refunded:</strong> <span class="refund-amount">฿${totalRefunded.toFixed(2)}</span>
            <span class="history-summary-sep">|</span>
            <strong>Net:</strong> ฿${(Number(totalRevenue) - totalRefunded).toFixed(2)}
            <span class="history-summary-sep">|</span>
            <strong>Items Sold:</strong> ${netItemsSold}${totalReturnedItems > 0 ? ` <span class="refund-amount">(${totalReturnedItems} returned)</span>` : ''}
        `;

        list.innerHTML = sales.map((sale) => {
            const returnedByKey = {};
            (sale.returns || []).forEach((r) => {
                const key = `${r.barcode}||${String(r.size || '')}`;
                returnedByKey[key] = (returnedByKey[key] || 0) + Number(r.quantity);
            });
            const refunded = (sale.returns || []).reduce((sum, r) => sum + Number(r.price) * Number(r.quantity), 0);

            const itemsHtml = (sale.items || []).map((item) => {
                const returned = returnedByKey[`${item.barcode}||${String(item.size || '')}`] || 0;
                const remaining = Number(item.quantity) - returned;
                const returnCell = remaining > 0
                    ? `<button class="btn btn-secondary btn-xs" data-action="return-item"
                           data-sale-id="${sale.id}"
                           data-barcode="${encodeURIComponent(String(item.barcode))}"
                           data-size="${encodeURIComponent(String(item.size || ''))}"
                           data-name="${encodeURIComponent(String(item.name))}"
                           data-max="${remaining}">Return</button>`
                    : '<span class="fully-returned">All returned</span>';

                return `
                    <tr>
                        <td>${this.escapeHtml(this.itemDisplayName(item))}</td>
                        <td>${item.quantity}</td>
                        <td>฿${Number(item.price).toFixed(2)}</td>
                        <td>฿${(Number(item.price) * Number(item.quantity)).toFixed(2)}</td>
                        <td>${returned > 0 ? `<span class="refund-amount">${returned}</span>` : '—'}</td>
                        <td>${returnCell}</td>
                    </tr>
                `;
            }).join('');

            return `
                <div class="history-card">
                    <div class="history-card-head">
                        <div><strong>Sale #${sale.id}</strong></div>
                        <div>${this.parseSaleDate(sale.created_at).toLocaleString()}</div>
                        <div>
                            ${refunded > 0 ? `<span class="refund-amount">Refunded: ฿${refunded.toFixed(2)}</span> ` : ''}
                            <strong>Total: ฿${Number(sale.total).toFixed(2)}</strong>
                        </div>
                    </div>
                    <div class="history-card-body">
                        <table class="history-table">
                            <thead>
                                <tr>
                                    <th>Name</th>
                                    <th>Qty</th>
                                    <th>Price</th>
                                    <th>Line Total</th>
                                    <th>Returned</th>
                                    <th></th>
                                </tr>
                            </thead>
                            <tbody>${itemsHtml}</tbody>
                        </table>
                    </div>
                </div>
            `;
        }).join('');
    }

    handleHistoryClick(e) {
        const clickTarget = e.target instanceof Element ? e.target : null;
        const target = clickTarget ? clickTarget.closest('button[data-action="return-item"]') : null;
        if (!target) return;

        this.openReturnModal({
            saleId: Number(target.dataset.saleId),
            barcode: decodeURIComponent(target.dataset.barcode || ''),
            size: decodeURIComponent(target.dataset.size || ''),
            name: decodeURIComponent(target.dataset.name || ''),
            maxQty: Number(target.dataset.max || 0)
        });
    }

    openReturnModal(info) {
        const modal = document.getElementById('return-modal');
        const productText = document.getElementById('return-modal-product');
        const input = document.getElementById('return-modal-input');
        if (!modal || !productText || !input || !info.saleId || !info.barcode || info.maxQty < 1) {
            this.showToast('Unable to open return dialog', 'error');
            return;
        }

        this.pendingReturn = info;
        productText.textContent = `${this.itemDisplayName(info)} — Sale #${info.saleId} (up to ${info.maxQty} returnable)`;
        input.value = '1';
        input.max = String(info.maxQty);
        modal.classList.add('active');
        setTimeout(() => {
            input.focus();
            input.select();
        }, 0);
    }

    closeReturnModal() {
        const modal = document.getElementById('return-modal');
        if (modal) {
            modal.classList.remove('active');
        }
        this.pendingReturn = null;
    }

    async submitReturn() {
        const input = document.getElementById('return-modal-input');
        if (!input || !this.pendingReturn) {
            return;
        }

        const quantity = parseInt(String(input.value || '').trim(), 10);
        if (isNaN(quantity) || quantity < 1 || quantity > this.pendingReturn.maxQty) {
            this.showToast(`Please enter a quantity between 1 and ${this.pendingReturn.maxQty}`, 'warning');
            input.focus();
            input.select();
            return;
        }

        const saveBtn = document.getElementById('return-save-btn');
        if (saveBtn.disabled) return;
        saveBtn.disabled = true;

        try {
            const refund = await window.electronAPI.createReturn(
                this.pendingReturn.saleId,
                this.pendingReturn.barcode,
                this.pendingReturn.size || '',
                quantity
            );
            this.showToast(`Returned ${quantity} × ${this.itemDisplayName(this.pendingReturn)} — refund ฿${Number(refund).toFixed(2)}`, 'success');
            this.closeReturnModal();
            this.loadSalesHistory();
        } catch (error) {
            console.error('Error processing return:', error);
            const detail = String(error && error.message ? error.message : '')
                .replace(/^Error invoking remote method 'create-return':\s*(Error:\s*)?/, '');
            this.showToast(detail || 'Error processing return', 'error');
        } finally {
            saveBtn.disabled = false;
        }
    }

    async exportSalesHistory(format) {
        try {
            if (!this.salesHistory || this.salesHistory.length === 0) {
                await this.loadSalesHistory();
            }

            if (!this.filteredSalesHistory || this.filteredSalesHistory.length === 0) {
                this.showToast('No sales history to export', 'warning');
                return;
            }

            const result = await window.electronAPI.exportSalesHistory(format, this.filteredSalesHistory, this.historyFilter);
            if (result && result.success) {
                this.showToast(`History exported: ${result.filePath}`, 'success');
            } else if (result && !result.canceled) {
                this.showToast(result.error || 'Export failed', 'error');
            }
        } catch (error) {
            console.error('Error exporting sales history:', error);
            this.showToast('Error exporting sales history', 'error');
        }
    }

    hideHistoryVisualization() {
        const panel = document.getElementById('history-visualization');
        if (panel) {
            panel.classList.remove('active');
        }
    }

    showHistoryVisualization() {
        if (!this.filteredSalesHistory || this.filteredSalesHistory.length === 0) {
            this.showToast('No sales history to visualize', 'warning');
            return;
        }

        const panel = document.getElementById('history-visualization');
        const canvas = document.getElementById('history-chart-canvas');
        if (!panel || !canvas) return;

        panel.classList.add('active');
        this.renderSalesChart(canvas, this.filteredSalesHistory);
        // The panel sits below the sticky action bar; bring it into view.
        setTimeout(() => panel.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
    }

    renderSalesChart(canvas, sales) {
        const dailyTotals = new Map();
        sales.forEach((sale) => {
            const day = this.getSaleDateOnly(sale);
            dailyTotals.set(day, (dailyTotals.get(day) || 0) + Number(sale.total || 0));
        });

        const points = Array.from(dailyTotals.entries())
            .sort((a, b) => a[0].localeCompare(b[0]))
            .slice(-14);

        const labels = points.map((p) => p[0].slice(5));
        const values = points.map((p) => p[1]);
        const max = Math.max(...values, 1);

        const dpr = window.devicePixelRatio || 1;
        const width = canvas.clientWidth || 900;
        const height = 320;
        canvas.width = Math.floor(width * dpr);
        canvas.height = Math.floor(height * dpr);

        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, width, height);

        ctx.fillStyle = '#211B1E';
        ctx.fillRect(0, 0, width, height);

        const left = 58;
        const top = 24;
        const chartW = width - left - 20;
        const chartH = height - top - 56;

        ctx.strokeStyle = '#4A3F44';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(left, top);
        ctx.lineTo(left, top + chartH);
        ctx.lineTo(left + chartW, top + chartH);
        ctx.stroke();

        const count = Math.max(values.length, 1);
        const barGap = 8;
        const barW = Math.max(18, (chartW - (count - 1) * barGap) / count);

        values.forEach((v, i) => {
            const x = left + i * (barW + barGap);
            const h = (v / max) * (chartH - 8);
            const y = top + chartH - h;

            ctx.fillStyle = '#D97795';
            ctx.fillRect(x, y, barW, h);

            ctx.fillStyle = '#D8CCD1';
            ctx.font = '12px Segoe UI';
            ctx.textAlign = 'center';
            ctx.fillText(labels[i], x + barW / 2, top + chartH + 18);
            ctx.fillText(`฿${v.toFixed(0)}`, x + barW / 2, y - 6);
        });

        ctx.fillStyle = '#F2EDE7';
        ctx.font = '600 14px Segoe UI';
        ctx.textAlign = 'left';
        ctx.fillText('Revenue per Day (last 14 days from current filter)', left, 16);
    }

    async addItemToCart() {
        const barcodeInput = document.getElementById('barcode-input');
        const barcode = barcodeInput.value.trim();

        if (!barcode) {
            this.showToast('Please enter a barcode', 'warning');
            this.focusSaleBarcodeInput();
            return;
        }

        try {
            const variants = await window.electronAPI.getProductVariants(barcode);

            if (!variants || variants.length === 0) {
                this.showToast('Product not found', 'error');
                barcodeInput.value = '';
                this.focusSaleBarcodeInput();
                return;
            }

            barcodeInput.value = '';
            this.updateSaleBarcodeSuggestions('');

            if (variants.length === 1) {
                this.addVariantToCart(variants[0]);
                this.focusSaleBarcodeInput();
            } else {
                // Multiple sizes share this barcode — let the cashier pick.
                this.openSizeModal(variants);
            }

        } catch (error) {
            console.error('Error adding item to cart:', error);
            this.showToast('Error adding item to cart', 'error');
            this.focusSaleBarcodeInput();
        }
    }

    addVariantToCart(product) {
        const size = String(product.size || '');
        const displayName = this.itemDisplayName(product);

        if (product.stock <= 0) {
            this.showToast(`${displayName} is out of stock`, 'error');
            return;
        }

        const existingItem = this.cart.find(item => item.barcode === product.barcode && item.size === size);

        if (existingItem) {
            if (existingItem.quantity >= product.stock) {
                this.showToast('Cannot add more items - insufficient stock', 'error');
                return;
            }
            existingItem.quantity += 1;
            this.showToast(`Added another ${displayName}`, 'success');
        } else {
            this.cart.push({
                barcode: product.barcode,
                name: product.name,
                size,
                price: product.price,
                quantity: 1
            });
            this.showToast(`Added ${displayName} to cart`, 'success');
        }

        this.updateCartDisplay();
    }

    openSizeModal(variants) {
        const modal = document.getElementById('size-select-modal');
        const productText = document.getElementById('size-select-product');
        const options = document.getElementById('size-select-options');
        if (!modal || !productText || !options) return;

        this.pendingSizeSelection = variants;
        productText.textContent = `${variants[0].name} — choose a size`;
        options.innerHTML = variants.map((v, index) => `
            <button type="button"
                class="size-option ${v.stock > 0 ? '' : 'size-option-out'}"
                data-index="${index}"
                ${v.stock > 0 ? '' : 'disabled'}>
                <span class="size-option-label">${v.size ? this.escapeHtml(v.size) : 'No size'}</span>
                <span class="size-option-stock">${v.stock > 0 ? `${v.stock} left` : 'out of stock'}</span>
            </button>
        `).join('');
        modal.classList.add('active');
    }

    handleSizeSelectClick(e) {
        const btn = e.target instanceof Element ? e.target.closest('button.size-option:not([disabled])') : null;
        if (!btn || !this.pendingSizeSelection) return;

        const variant = this.pendingSizeSelection[Number(btn.dataset.index)];
        this.closeSizeModal();
        if (variant) {
            this.addVariantToCart(variant);
        }
        this.focusSaleBarcodeInput();
    }

    closeSizeModal() {
        const modal = document.getElementById('size-select-modal');
        if (modal) {
            modal.classList.remove('active');
        }
        this.pendingSizeSelection = null;
        this.focusSaleBarcodeInput();
    }

    updateCartDisplay() {
        const cartItemsDiv = document.getElementById('cart-items');
        const cartTotalSpan = document.getElementById('cart-total');

        if (this.cart.length === 0) {
            cartItemsDiv.innerHTML = '<p class="cart-empty">Cart is empty — scan an item to start</p>';
            this.currentTotal = 0;
        } else {
            cartItemsDiv.innerHTML = this.cart.map(item => {
                const keyAttrs = `data-barcode="${encodeURIComponent(String(item.barcode))}" data-size="${encodeURIComponent(String(item.size || ''))}"`;
                return `
                <div class="cart-item">
                    <div class="cart-item-info">
                        <div class="cart-item-name">${this.escapeHtml(this.itemDisplayName(item))}</div>
                        <div class="cart-item-details">
                            ฿${item.price.toFixed(2)} each
                        </div>
                    </div>
                    <div class="cart-item-controls">
                        <button class="cart-qty-btn" data-action="decrease" ${keyAttrs} title="Decrease quantity">−</button>
                        <span class="cart-qty">${item.quantity}</span>
                        <button class="cart-qty-btn" data-action="increase" ${keyAttrs} title="Increase quantity">+</button>
                        <button class="cart-remove-btn" data-action="remove" ${keyAttrs} title="Remove from cart">✕</button>
                    </div>
                    <div class="cart-item-total">฿${(item.quantity * item.price).toFixed(2)}</div>
                </div>
            `;
            }).join('');

            this.currentTotal = this.cart.reduce((total, item) => total + (item.quantity * item.price), 0);
        }

        cartTotalSpan.textContent = this.currentTotal.toFixed(2);
    }

    handleCartClick(e) {
        const clickTarget = e.target instanceof Element ? e.target : null;
        const target = clickTarget ? clickTarget.closest('button[data-action]') : null;
        if (!target) return;

        const action = target.dataset.action;
        const barcode = decodeURIComponent(target.dataset.barcode || '');
        const size = decodeURIComponent(target.dataset.size || '');

        if (action === 'increase') {
            this.changeCartQuantity(barcode, size, 1);
        } else if (action === 'decrease') {
            this.changeCartQuantity(barcode, size, -1);
        } else if (action === 'remove') {
            this.removeCartItem(barcode, size);
        }
    }

    async changeCartQuantity(barcode, size, delta) {
        const item = this.cart.find(i => i.barcode === barcode && String(i.size || '') === size);
        if (!item) return;

        if (delta > 0) {
            // Re-check current stock of this exact size before allowing an increase.
            try {
                const variants = await window.electronAPI.getProductVariants(barcode);
                const product = (variants || []).find(v => String(v.size || '') === size);
                if (!product || item.quantity + delta > product.stock) {
                    this.showToast('Cannot add more items - insufficient stock', 'error');
                    this.focusSaleBarcodeInput();
                    return;
                }
            } catch (error) {
                console.error('Error checking stock:', error);
                this.showToast('Error checking stock', 'error');
                return;
            }
        }

        item.quantity += delta;
        if (item.quantity <= 0) {
            this.removeCartItem(barcode, size);
            return;
        }

        this.updateCartDisplay();
        this.focusSaleBarcodeInput();
    }

    removeCartItem(barcode, size) {
        const item = this.cart.find(i => i.barcode === barcode && String(i.size || '') === size);
        if (!item) return;

        this.cart = this.cart.filter(i => !(i.barcode === barcode && String(i.size || '') === size));
        this.showToast(`Removed ${this.itemDisplayName(item)} from cart`, 'info');
        this.updateCartDisplay();
        this.focusSaleBarcodeInput();
    }

    clearCart() {
        this.cart = [];
        this.currentTotal = 0;
        this.updateCartDisplay();
        this.focusSaleBarcodeInput();
    }

    async completeSale() {
        if (this.cart.length === 0) {
            this.showToast('Cart is empty', 'warning');
            this.focusSaleBarcodeInput();
            return;
        }

        // Guard against double-clicks creating duplicate sales.
        const completeBtn = document.getElementById('complete-sale-btn');
        if (completeBtn.disabled) return;
        completeBtn.disabled = true;

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
            const detail = String(error && error.message ? error.message : '')
                .replace(/^Error invoking remote method 'create-sale':\s*(Error:\s*)?/, '');
            this.showToast(detail || 'Error completing sale', 'error');
        } finally {
            completeBtn.disabled = false;
        }
    }

    closeModal() {
        document.getElementById('sale-modal').classList.remove('active');
        this.currentSale = null;
        this.focusSaleBarcodeInput();
    }

    async printReceipt() {
        if (!this.currentSale) {
            this.showToast('No sale to print', 'warning');
            return;
        }

        try {
            // Bake the size into the printed item name.
            const receiptData = {
                ...this.currentSale,
                items: (this.currentSale.items || []).map((item) => ({
                    name: this.itemDisplayName(item),
                    price: item.price,
                    quantity: item.quantity
                }))
            };
            const success = await window.electronAPI.printReceipt(receiptData);
            
            if (success) {
                this.showToast('Receipt printed successfully', 'success');
            } else {
                this.showToast('Failed to print receipt. Check printer connection', 'error');
            }
            
            this.closeModal();
            this.focusSaleBarcodeInput();

        } catch (error) {
            console.error('Error printing receipt:', error);
            this.showToast('Error printing receipt', 'error');
            this.focusSaleBarcodeInput();
        }
    }

    async testPrinter() {
        try {
            const success = await window.electronAPI.testPrinter();
            
            if (success) {
                this.showToast('Printer test successful', 'success');
                document.getElementById('printer-status').textContent = 'Printer: Connected';
            } else {
                this.showToast('Printer test failed. Check connection', 'error');
                document.getElementById('printer-status').textContent = 'Printer: Not Connected';
            }

        } catch (error) {
            console.error('Error testing printer:', error);
            this.showToast('Error testing printer', 'error');
        }
    }

    async checkPrinterStatus() {
        // This will be called periodically to check printer status (without printing)
        try {
            const success = await window.electronAPI.checkPrinterConnection();
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
        const originalPriceRaw = document.getElementById('new-original-price').value.trim();
        const originalPrice = this.isAdmin && originalPriceRaw !== '' ? parseFloat(originalPriceRaw) : 0;

        const variants = Array.from(document.querySelectorAll('#size-rows .size-row')).map((row) => ({
            size: row.querySelector('.size-input').value.trim(),
            stock: parseInt(row.querySelector('.stock-input').value, 10)
        }));

        if (!barcode || !name || isNaN(price)) {
            this.showToast('Please fill all fields correctly', 'warning');
            setTimeout(() => document.getElementById('new-barcode').focus(), 100);
            return;
        }

        if (isNaN(originalPrice) || originalPrice < 0) {
            this.showToast('Please enter a valid original price (0 or higher)', 'warning');
            setTimeout(() => document.getElementById('new-original-price').focus(), 100);
            return;
        }

        if (variants.length === 0 || variants.some(v => isNaN(v.stock) || v.stock < 0)) {
            this.showToast('Please enter a valid stock (0 or higher) for every size row', 'warning');
            return;
        }

        if (variants.length > 1) {
            if (variants.some(v => !v.size)) {
                this.showToast('When adding multiple sizes, every row needs a size', 'warning');
                return;
            }
            const distinct = new Set(variants.map(v => v.size.toUpperCase()));
            if (distinct.size !== variants.length) {
                this.showToast('Duplicate sizes in the list — each size must be different', 'warning');
                return;
            }
        }

        try {
            // Check for collisions with sizes already registered under this barcode
            const existing = await window.electronAPI.getProductVariants(barcode);
            if (existing && existing.length > 0) {
                const existingSizes = new Set(existing.map(v => String(v.size || '').toUpperCase()));
                const collision = variants.find(v => existingSizes.has(v.size.toUpperCase()));
                if (collision) {
                    this.showToast(collision.size
                        ? `Size "${collision.size}" already exists for this barcode`
                        : 'This barcode already exists', 'warning');
                    return;
                }
            }

            await window.electronAPI.addProduct({ barcode, name, price, original_price: originalPrice, variants });

            this.showToast(variants.length > 1
                ? `Product added with ${variants.length} sizes`
                : 'Product added successfully', 'success');

            // Clear form
            document.getElementById('add-product-form').reset();
            this.resetSizeRows();

            // Refresh product list if on inventory tab
            if (document.getElementById('inventory-tab').classList.contains('active')) {
                this.loadProducts();
            }

            // Return focus to barcode input for next product
            setTimeout(() => document.getElementById('new-barcode').focus(), 100);

        } catch (error) {
            console.error('Error adding product:', error);
            const detail = String(error && error.message ? error.message : '')
                .replace(/^Error invoking remote method 'add-product':\s*(Error:\s*)?/, '');
            this.showToast(detail || 'Error adding product', 'error');
        }
    }

    scanNewBarcode() {
        // Focus on barcode input for scanning
        const barcodeInput = document.getElementById('new-barcode');
        this.showToast('Ready to scan - Please scan barcode or enter manually', 'info');
        // Ensure input gets focus without blocking
        setTimeout(() => barcodeInput.focus(), 100);
    }

    async loadProducts() {
        try {
            const products = await window.electronAPI.getAllProducts();
            this.saleBarcodeCatalog = [...new Set(products
                .map(product => String(product.barcode || '').trim())
                .filter(Boolean))];
            const barcodeInput = document.getElementById('barcode-input');
            this.updateSaleBarcodeSuggestions(barcodeInput ? barcodeInput.value : '');
            this.updateSizeSuggestions(products);
            this.displayProducts(products);
        } catch (error) {
            console.error('Error loading products:', error);
        }
    }

    // Size is free text; suggest the standard letter sizes plus any size already
    // used in the catalog (shoe numbers, EU sizes, ...) so conventions build up.
    updateSizeSuggestions(products) {
        const list = document.getElementById('size-suggestions');
        if (!list) return;

        const sizes = ['XS', 'S', 'M', 'L', 'XL', 'XXL'];
        const seen = new Set(sizes.map(s => s.toUpperCase()));

        (products || []).forEach((product) => {
            const size = String(product.size || '').trim();
            if (size && !seen.has(size.toUpperCase())) {
                seen.add(size.toUpperCase());
                sizes.push(size);
            }
        });

        list.innerHTML = sizes.map(s => `<option value="${this.escapeHtml(s)}"></option>`).join('');
    }

    async ensureSaleBarcodeCatalog() {
        if (this.saleBarcodeCatalog.length > 0) {
            return;
        }

        try {
            const products = await window.electronAPI.getAllProducts();
            this.saleBarcodeCatalog = [...new Set(products
                .map(product => String(product.barcode || '').trim())
                .filter(Boolean))];
            this.updateSaleBarcodeSuggestions('');
        } catch (error) {
            console.error('Error loading barcode suggestions:', error);
        }
    }

    updateSaleBarcodeSuggestions(inputValue = '') {
        const list = document.getElementById('sale-barcode-suggestions');
        if (!list) return;

        while (list.firstChild) {
            list.removeChild(list.firstChild);
        }

        if (!this.saleBarcodeCatalog || this.saleBarcodeCatalog.length === 0) {
            return;
        }

        const query = String(inputValue || '').trim().toLowerCase();
        let matches = [];

        if (!query) {
            matches = this.saleBarcodeCatalog.slice(0, this.saleBarcodeSuggestionLimit);
        } else {
            const startsWith = [];
            const includes = [];

            this.saleBarcodeCatalog.forEach((barcode) => {
                const value = barcode.toLowerCase();
                if (value.startsWith(query)) {
                    startsWith.push(barcode);
                } else if (value.includes(query)) {
                    includes.push(barcode);
                }
            });

            matches = startsWith.concat(includes).slice(0, this.saleBarcodeSuggestionLimit);
        }

        matches.forEach((barcode) => {
            const option = document.createElement('option');
            option.value = barcode;
            list.appendChild(option);
        });
    }

    async searchProducts() {
        const searchTerm = document.getElementById('product-search').value.trim().toLowerCase();
        
        try {
            const allProducts = await window.electronAPI.getAllProducts();
            const filteredProducts = allProducts.filter(product =>
                product.name.toLowerCase().includes(searchTerm) ||
                product.barcode.toLowerCase().includes(searchTerm) ||
                String(product.size || '').toLowerCase().includes(searchTerm)
            );
            
            this.displayProducts(filteredProducts);
        } catch (error) {
            console.error('Error searching products:', error);
        }
    }

    displayProducts(products) {
        const productList = document.getElementById('product-list');

        if (products.length === 0) {
            productList.innerHTML = '<p class="cart-empty">No products found</p>';
            return;
        }

        // Group size variants under one card per barcode.
        const order = [];
        const byBarcode = new Map();
        products.forEach((product) => {
            if (!byBarcode.has(product.barcode)) {
                byBarcode.set(product.barcode, []);
                order.push(product.barcode);
            }
            byBarcode.get(product.barcode).push(product);
        });

        productList.innerHTML = order.map((barcode) => {
            const variants = byBarcode.get(barcode);
            const first = variants[0];
            const totalStock = variants.reduce((sum, v) => sum + Number(v.stock || 0), 0);
            const cost = Number(first.original_price);

            const variantRows = variants.map((v) => {
                const keyAttrs = `data-barcode="${encodeURIComponent(String(barcode))}" data-size="${encodeURIComponent(String(v.size || ''))}"`;
                return `
                    <div class="variant-row">
                        <span class="product-size-badge">${v.size ? this.escapeHtml(v.size) : '—'}</span>
                        <span class="variant-stock">${v.stock}${v.stock <= 5 ? ' ⚠️' : ''}</span>
                        <button class="btn btn-secondary btn-xs" data-action="update-stock" ${keyAttrs} data-stock="${Number(v.stock)}">Update Stock</button>
                        <button class="btn btn-danger btn-xs" data-action="delete-product" ${keyAttrs} data-name="${encodeURIComponent(String(v.name))}">Delete</button>
                    </div>
                `;
            }).join('');

            return `
                <div class="product-card">
                    <div class="product-name">${this.escapeHtml(first.name)}</div>
                    <div class="product-details">
                        Barcode: ${this.escapeHtml(barcode)}<br>
                        ${this.isAdmin ? `Original Price: ${cost > 0 ? '฿' + cost.toFixed(2) : '—'}<br>` : ''}
                        Selling Price: ฿${Number(first.price).toFixed(2)}<br>
                        Total Stock: ${totalStock}
                    </div>
                    <div class="variant-list">${variantRows}</div>
                </div>
            `;
        }).join('');
    }

    handleProductListClick(e) {
        const clickTarget = e.target instanceof Element ? e.target : null;
        const target = clickTarget ? clickTarget.closest('button[data-action]') : null;
        if (!target) {
            return;
        }

        const action = target.dataset.action;
        const barcode = decodeURIComponent(target.dataset.barcode || '');
        const size = decodeURIComponent(target.dataset.size || '');

        if (action === 'update-stock') {
            const currentStock = Number(target.dataset.stock || 0);
            this.openStockModal(barcode, size, currentStock);
            return;
        }

        if (action === 'delete-product') {
            const productName = decodeURIComponent(target.dataset.name || '');
            this.deleteProduct(barcode, size, productName);
        }
    }

    openStockModal(barcode, size, currentStock) {
        const modal = document.getElementById('stock-modal');
        const productText = document.getElementById('stock-modal-product');
        const input = document.getElementById('stock-modal-input');
        if (!modal || !productText || !input) {
            this.showToast('Unable to open stock update dialog', 'error');
            return;
        }

        this.pendingStockUpdate = { barcode, size, currentStock };
        productText.textContent = `Barcode: ${barcode}${size ? ` — Size: ${size}` : ''} (Current: ${currentStock})`;
        input.value = String(currentStock);
        modal.classList.add('active');
        setTimeout(() => {
            input.focus();
            input.select();
        }, 0);
    }

    closeStockModal() {
        const modal = document.getElementById('stock-modal');
        if (modal) {
            modal.classList.remove('active');
        }
        this.pendingStockUpdate = null;

        if (document.getElementById('inventory-tab').classList.contains('active')) {
            setTimeout(() => {
                const searchInput = document.getElementById('product-search');
                if (searchInput) {
                    searchInput.focus();
                }
            }, 50);
        }
    }

    async submitStockUpdate() {
        const input = document.getElementById('stock-modal-input');
        if (!input || !this.pendingStockUpdate) {
            return;
        }

        const rawValue = String(input.value || '').trim();
        if (!rawValue) {
            this.showToast('Please enter a stock number', 'warning');
            input.focus();
            return;
        }

        const stockNumber = parseInt(rawValue, 10);
        
        if (isNaN(stockNumber) || stockNumber < 0) {
            this.showToast('Please enter a valid stock number (0 or higher)', 'warning');
            input.focus();
            input.select();
            return;
        }

        try {
            await window.electronAPI.updateStock(this.pendingStockUpdate.barcode, this.pendingStockUpdate.size || '', stockNumber);
            this.showToast(`Stock updated to ${stockNumber}`, 'success');
            this.closeStockModal();
            this.loadProducts();
        } catch (error) {
            console.error('Error updating stock:', error);
            this.showToast('Error updating stock', 'error');
        }
    }

    async deleteProduct(barcode, size, productName) {
        const displayName = size ? `${productName} (${size})` : productName;
        const deleteKey = `${barcode}||${size}`;

        // Avoid blocking native confirm dialogs (can cause focus/cursor issues in Electron on Windows).
        // Use a non-blocking double-click confirmation instead.
        if (!this.pendingDeleteBarcodes.has(deleteKey)) {
            const timeoutId = setTimeout(() => {
                this.pendingDeleteBarcodes.delete(deleteKey);
            }, 5000);
            this.pendingDeleteBarcodes.set(deleteKey, timeoutId);
            this.showToast(`Click Delete again within 5s to confirm: ${displayName}`, 'warning');
            return;
        }

        clearTimeout(this.pendingDeleteBarcodes.get(deleteKey));
        this.pendingDeleteBarcodes.delete(deleteKey);

        try {
            const success = await window.electronAPI.deleteProduct(barcode, size || '');

            if (success) {
                this.showToast(`Product "${displayName}" deleted successfully`, 'success');
                this.loadProducts();
            } else {
                this.showToast('Product not found', 'warning');
            }
        } catch (error) {
            console.error('Error deleting product:', error);
            this.showToast('Error deleting product', 'error');
        } finally {
            // Restore input focus workflow after delete.
            if (document.getElementById('sale-tab').classList.contains('active')) {
                this.focusSaleBarcodeInput();
            } else if (document.getElementById('add-product-tab').classList.contains('active')) {
                this.focusAddProductBarcodeInput();
            }
        }
    }

    async showReports() {
        try {
            const today = this.toLocalYMD(new Date());
            const report = await window.electronAPI.getSalesReport(today);
            
            const message = `Daily Sales Report (${today}):\n\n` +
                           `Total Sales: ${report.sales.length}\n` +
                           `Total Revenue: ฿${report.total.toFixed(2)}`;
            
            this.showToast(message, 'info');
        } catch (error) {
            console.error('Error generating report:', error);
            this.showToast('Error generating report', 'error');
        }
    }

    async closeApplication() {
        // One accidental tap shouldn't end the shift; require a second click to confirm.
        if (!this.pendingClose) {
            this.pendingClose = true;
            setTimeout(() => { this.pendingClose = false; }, 5000);
            this.showToast('Click Close again within 5s to exit', 'warning');
            return;
        }

        try {
            await window.electronAPI.closeApp();
        } catch (error) {
            console.error('Error closing app:', error);
            this.showToast('Unable to close app', 'error');
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
