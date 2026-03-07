class MessageQueue {
    constructor(options = {}) {
        this.queue = [];
        this.processing = false;
        this.interval = options.interval || 2000;
        this.maxPerInterval = options.maxPerInterval || 3;
        this.stats = {
            total: 0,
            sent: 0,
            failed: 0
        };
    }

    add(message) {
        this.queue.push({
            ...message,
            id: Date.now() + Math.random(),
            attempts: 0
        });
        this.stats.total++;

        if (!this.processing) {
            this.process();
        }
    }

    async process() {
        if (this.processing || this.queue.length === 0) return;

        this.processing = true;

        const toSend = this.queue.splice(0, this.maxPerInterval);
        const failed = [];

        for (const message of toSend) {
            try {
                console.log(`📤 Отправка сообщения (попытка ${message.attempts + 1})...`);
                await message.sendFunction();
                this.stats.sent++;
                console.log(`✅ Сообщение отправлено`);
            } catch (error) {
                console.error(`❌ Ошибка (попытка ${message.attempts + 1}):`, error.message);

                if (message.attempts < 3) {
                    message.attempts++;
                    failed.push(message);
                    console.log(`🔄 Повтор через ${this.interval}ms`);
                } else {
                    this.stats.failed++;
                    console.error(`❌ Сообщение не отправлено после 3 попыток`);
                }
            }

            await new Promise(r => setTimeout(r, 500));
        }

        if (failed.length > 0) {
            this.queue.unshift(...failed);
        }

        this.processing = false;

        if (this.queue.length > 0) {
            setTimeout(() => this.process(), this.interval);
        }
    }

    getStats() {
        return {
            ...this.stats,
            queueLength: this.queue.length
        };
    }
}

module.exports = MessageQueue;