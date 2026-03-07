const config = require('./config');
const Bridge = require('./bridge');
const fs = require('fs');
const path = require('path');

global.msgMap = new Map();

function cleanupTempFiles() {
    const downloadsDir = path.join(__dirname, 'downloads');
    if (fs.existsSync(downloadsDir)) {
        try {
            const files = fs.readdirSync(downloadsDir);
            for (const file of files) {
                fs.unlinkSync(path.join(downloadsDir, file));
            }
            console.log('🧹 Временные файлы очищены');
        } catch (e) {
            console.error('⚠️ Ошибка очистки:', e);
        }
    }
}

process.on('SIGINT', () => {
    console.log('\n🛑 Остановка...');
    cleanupTempFiles();
    if (global.bridge) {
        global.bridge.stop();
    } else {
        process.exit(0);
    }
});

process.on('SIGTERM', () => {
    console.log('\n🛑 Остановка...');
    cleanupTempFiles();
    if (global.bridge) {
        global.bridge.stop();
    } else {
        process.exit(0);
    }
});

process.on('uncaughtException', (error) => {
    console.error('❌ Необработанная ошибка:', error);
});

process.on('unhandledRejection', (reason) => {
    console.error('❌ Необработанный reject:', reason);
});

async function main() {
    console.log('🤖 MAX-Telegram Bridge\n');

    const downloadsDir = path.join(__dirname, 'downloads');
    if (!fs.existsSync(downloadsDir)) {
        fs.mkdirSync(downloadsDir, { recursive: true });
    }

    const bridge = new Bridge(config);
    global.bridge = bridge;
    await bridge.initialize();
}

main().catch(console.error);