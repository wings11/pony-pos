# Pony POS System - Production Setup

## Printer Configuration

Your XP-58 thermal printer is fully configured and ready for production use.

### Quick Start

**Easy startup** - Just double-click the startup script:
```
start-pony-pos.bat
```

**Manual startup** - Run in PowerShell:
```powershell
$env:PRINTER_INTERFACE = 'printer:XP-58 (copy 1)'
npm start
```

### Business Information

The receipts are configured with:
- **Business Name**: Pony POS System
- **Address**: Your Local Store, 123 Main Street, City  
- **Phone**: (555) 123-4567

To customize this information, edit:
- `src/services/PrinterService.ts` (lines 112-116)
- `src/services/WindowsPrinterService.ts` (lines 59-62)

Then run `npm run build` to apply changes.

### Features Ready for Production

✅ **Receipt Printing** - Full sales receipts with itemized details  
✅ **Test Printing** - System verification via IPC test-printer command  
✅ **Automatic Printer Detection** - No manual driver configuration needed  
✅ **Error Handling** - Graceful fallback when connection issues occur  
✅ **Windows Integration** - Direct Win32 API printing for reliability  

### System Architecture

- **Main Process**: Electron app with hardware acceleration disabled for stability
- **Printer Service**: Dual-mode (native thermal + Windows raw printing)  
- **Database**: SQLite for sales, inventory, and reporting
- **UI**: Modern web-based point of sale interface

The system automatically uses Windows raw printing mode for your XP-58, ensuring reliable receipt output without driver conflicts.