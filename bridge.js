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
        this.telegramBot = new TelegramBotHandler(this.config, this.queue, null);
        this.maxBot = new MaxBot(this.config, this.queue, this.telegramBot);
        this.telegramBot.maxBot = this.maxBot;

        const telegramOk = await this.telegramBot.initialize();
        if (!telegramOk) {
            console.error('telegram bot failed to start');
            process.exit(1);
        }

        const maxOk = await this.maxBot.initialize();
        if (maxOk) {
            console.log('bridge running; /setgroup in MAX group, then in Telegram group');
        } else {
            console.error('MAX bot failed to start');
        }
    }

    async stop() {
        if (this.telegramBot?.bot) {
            await this.telegramBot.bot.stopPolling();
        }
        process.exit(0);
    }
}

module.exports = Bridge;
