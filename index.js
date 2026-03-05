const config = require('./config');
const Bridge = require('./bridge');

// Обработка завершения программы
process.on('SIGINT', () => {
    console.log('\n🛑 Получен сигнал завершения...');
    if (global.bridge) {
        global.bridge.stop();
    } else {
        process.exit(0);
    }
});

process.on('SIGTERM', () => {
    console.log('\n🛑 Получен сигнал завершения...');
    if (global.bridge) {
        global.bridge.stop();
    } else {
        process.exit(0);
    }
});

// Обработка необработанных ошибок
process.on('uncaughtException', (error) => {
    console.error('❌ Необработанная ошибка:', error);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Необработанный reject:', reason);
});

// Запуск моста
async function main() {
    console.log('🤖 MAX-Telegram Bridge');
    console.log('=======================\n');

    // Проверяем настройки
    if (!config.telegram.token || config.telegram.token === 'YOUR_TELEGRAM_BOT_TOKEN') {
        console.error('❌ Ошибка: Не указан токен Telegram бота!');
        console.log('1. Создайте бота в @BotFather');
        console.log('2. Получите токен');
        console.log('3. Укажите его в config.js');
        process.exit(1);
    }

    // Создаем и запускаем мост
    const bridge = new Bridge(config);
    global.bridge = bridge; // Сохраняем для обработки сигналов

    await bridge.initialize();
}

// Запускаем приложение
main().catch(error => {
    console.error('❌ Критическая ошибка:', error);
    process.exit(1);
});