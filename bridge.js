const MessageQueue = require('./queue');
const MaxBot = require('./max-bot');
const TelegramBotHandler = require('./telegram-bot');

class Bridge {
    constructor(config) {
        this.config = config;
        this.queue = new MessageQueue(config.bridge.queue);
        this.maxBot = null;
        this.telegramBot = null;
    }

    async initialize() {
        console.log('🚀 Инициализация моста MAX-Telegram...\n');

        this.telegramBot = new TelegramBotHandler(this.config, this.queue, null);
        this.maxBot = new MaxBot(this.config, this.queue, this.telegramBot);

        this.telegramBot.maxBot = this.maxBot;

        console.log('🔄 Запуск Telegram бота...');
        const telegramStarted = await this.telegramBot.initialize();

        if (!telegramStarted) {
            console.error('❌ Telegram бот не запущен');
            process.exit(1);
        }

        console.log('🔄 Запуск MAX бота...');
        const maxStarted = await this.maxBot.initialize();

        if (maxStarted) {
            console.log('\n✅ Мост успешно запущен!');
            console.log('\n📝 Настройка:');
            console.log('1. В MAX группе отправьте /setgroup');
            console.log('2. В Telegram группе отправьте /setgroup');
        } else {
            console.error('\n❌ MAX бот не запущен');
        }
    }

    async stop() {
        console.log('\n🛑 Остановка...');
        if (this.telegramBot?.bot) {
            await this.telegramBot.bot.stopPolling();
        }
        process.exit(0);
    }
}

module.exports = Bridge;