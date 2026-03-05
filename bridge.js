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

        // Создаем экземпляры ботов
        this.maxBot = new MaxBot(this.config, this.queue, null);
        this.telegramBot = new TelegramBotHandler(this.config, this.queue, null);

        // Устанавливаем ссылки друг на друга
        this.maxBot.telegramBot = this.telegramBot;
        this.telegramBot.maxBot = this.maxBot;

        // Запускаем ботов
        const maxStarted = await this.maxBot.initialize();
        const telegramStarted = await this.telegramBot.initialize();

        if (maxStarted && telegramStarted) {
            console.log('\n✅ Мост успешно запущен!');
            console.log('\n📝 Инструкция по настройке:');
            console.log('1. Добавьте ботов в группы MAX и Telegram');
            console.log('2. В каждой группе отправьте команду /setgroup');
            console.log('3. ID групп автоматически сохранятся в config.js');
            console.log('\n📊 Для просмотра статистики используйте /stats');
        } else {
            console.error('\n❌ Ошибка запуска моста!');
            process.exit(1);
        }
    }

    async stop() {
        console.log('\n🛑 Остановка моста...');

        if (this.maxBot && this.maxBot.bot) {
            this.maxBot.bot.stop();
        }

        if (this.telegramBot && this.telegramBot.bot) {
            this.telegramBot.bot.stopPolling();
        }

        console.log('✅ Мост остановлен');
        process.exit(0);
    }
}

module.exports = Bridge;