# POS System for Small Business

A modern Point of Sale (POS) system built with Electron and TypeScript, specifically designed for small businesses selling clothes and cosmetics. Features barcode scanning, inventory management, sales processing, and thermal printer integration.

## Features

- ✅ **Simple Barcode Scanning** - Add products and process sales by scanning barcodes
- ✅ **Local SQLite Database** - No cloud dependency, all data stored locally
- ✅ **Touch-Friendly Interface** - Large buttons designed for non-tech-savvy cashiers
- ✅ **Thermal Printer Integration** - Print receipts with Xprinter XP58IIH support
- ✅ **Inventory Management** - Track stock levels, add new products, update quantities
- ✅ **Sales Reporting** - Daily sales reports and transaction history
- ✅ **Cross-Platform** - Runs on Windows, macOS, and Linux
- ✅ **Android Tablet Ready** - Responsive design suitable for tablet deployment

## Tech Stack

- **Frontend**: HTML5, CSS3, JavaScript (ES6+)
- **Backend**: Electron, Node.js, TypeScript
- **Database**: SQLite3 (local storage)
- **Printer**: ESC/POS commands for thermal printers
- **Build Tools**: TypeScript Compiler, npm scripts

## Quick Start

### Prerequisites

- Node.js (v16 or higher)
- npm or yarn
- USB barcode scanner (optional)
- Xprinter XP58IIH or compatible thermal printer (optional)

### Installation

1. **Clone or download the project**
   ```bash
   cd /home/w1ngs/Desktop/pony
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Build the project**
   ```bash
   npm run build
   ```

4. **Start the application**
   ```bash
   npm start
   ```

### Development

- **Watch mode** (automatically rebuild on changes):
  ```bash
  npm run watch
  ```

- **Development mode** (build + start):
  ```bash
  npm run dev
  ```

## Hardware Setup

### Barcode Scanner
- Connect any USB barcode scanner
- Scanner should be configured to send data as keyboard input
- No additional configuration required

### Thermal Printer (Xprinter XP58IIH)
1. Connect printer via USB or network
2. Update printer configuration in `src/services/PrinterService.ts`
3. For USB connection: Use appropriate COM port
4. For network: Update IP address (default: `192.168.1.100:9100`)

### Android Tablet Deployment
- Build the project and deploy as a web app
- Ensure tablet supports USB-OTG for scanner/printer connectivity
- Use Chrome or compatible browser for best performance

## Usage Guide

### Adding Products
1. Navigate to "Add Product" tab
2. Scan or manually enter barcode
3. Enter product name, price, and initial stock
4. Click "Add Product"

### Making Sales
1. Use "Make Sale" tab (default view)
2. Scan product barcodes or enter manually
3. Items appear in cart with running total
4. Click "Complete Sale" to process transaction
5. Optionally print receipt

### Managing Inventory
1. Go to "Inventory" tab
2. Search for products by name or barcode
3. Update stock quantities as needed
4. View low stock warnings (≤5 items)

### Reports
1. Click "Reports" button in header
2. View daily sales summary
3. Export data as needed

## Project Structure

```
pos-system/
├── src/
│   ├── main.ts                 # Electron main process
│   ├── preload.ts             # Electron preload script
│   ├── database/
│   │   └── DatabaseManager.ts # SQLite database operations
│   └── services/
│       └── PrinterService.ts  # Thermal printer integration
├── renderer/
│   ├── index.html             # Main UI
│   ├── styles.css             # Styling
│   └── app.js                 # Frontend JavaScript
├── dist/                      # Compiled TypeScript output
├── package.json              # Dependencies and scripts
├── tsconfig.json             # TypeScript configuration
└── README.md                 # This file
```

## Configuration

### Database
- SQLite database file: `pos-database.db`
- Created automatically on first run
- Located in project root directory

### Printer Settings
Edit `src/services/PrinterService.ts`:

```typescript
// USB connection
interface: 'printer:Generic_printer_name'

// Network connection  
interface: 'tcp://192.168.1.100:9100'
```

### Business Information
Update receipt header in `PrinterService.ts`:

```typescript
this.printer.println("YOUR BUSINESS NAME");
this.printer.println("Address Line 1");
this.printer.println("Address Line 2");
this.printer.println("Phone: (123) 456-7890");
```

## Troubleshooting

### Application Won't Start
- Ensure Node.js is installed and updated
- Run `npm install` to install dependencies
- Check terminal for error messages

### Database Issues
- Delete `pos-database.db` to reset database
- Ensure write permissions in project directory

### Printer Not Working
- Check printer power and connectivity
- Update printer IP/COM port in configuration
- Test with "Test Printer" button in status bar
- Verify ESC/POS compatibility

### Barcode Scanner Issues
- Ensure scanner is configured for keyboard input mode
- Test scanner in a text editor first
- Check USB connection and drivers

### Performance on Tablets
- Use Chrome browser for best performance
- Enable hardware acceleration if available
- Ensure sufficient RAM (4GB+ recommended)

## Development Notes

### Adding New Features
1. Backend changes: Modify TypeScript files in `src/`
2. Frontend changes: Update `renderer/` files
3. Database changes: Update `DatabaseManager.ts`
4. Rebuild with `npm run build`

### Customization
- Colors and styling: Edit `renderer/styles.css`
- Receipt format: Modify `PrinterService.ts`
- Database schema: Update `DatabaseManager.ts`

## Support

For issues or questions:
1. Check this README for troubleshooting steps
2. Review error messages in terminal/console
3. Ensure all dependencies are installed correctly

## License

MIT License - Free for commercial and personal use.

## Future Enhancements

- [ ] Multi-user support with login system
- [ ] Product categories and advanced filtering
- [ ] Backup and restore functionality
- [ ] Integration with external accounting software
- [ ] Advanced reporting and analytics
- [ ] Customer management system
- [ ] Discount and promotion features