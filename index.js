const config = require('./config');
const Bridge = require('./bridge');
const fs = require('fs');
const path = require('path');

global.msgMap = new Map();

function cleanupTempFiles() {
    const downloadsDir = path.join(__dirname, 'downloads');
    if (!fs.existsSync(downloadsDir)) return;
    try {
        for (const file of fs.readdirSync(downloadsDir)) {
            fs.unlinkSync(path.join(downloadsDir, file));
        }
        console.log('downloads cleared');
    } catch (e) {
        console.error('cleanup failed:', e);
    }
}

function onShutdown() {
    console.log('shutting down');
    cleanupTempFiles();
    if (global.bridge) {
        global.bridge.stop();
    } else {
        process.exit(0);
    }
}

process.on('SIGINT', onShutdown);
process.on('SIGTERM', onShutdown);
process.on('uncaughtException', (err) => console.error('uncaughtException:', err));
process.on('unhandledRejection', (reason) => console.error('unhandledRejection:', reason));

async function main() {
    console.log('MAX-Telegram bridge');

    const downloadsDir = path.join(__dirname, 'downloads');
    if (!fs.existsSync(downloadsDir)) {
        fs.mkdirSync(downloadsDir, { recursive: true });
    }

    const bridge = new Bridge(config);
    global.bridge = bridge;
    await bridge.initialize();
}

main().catch(console.error);
