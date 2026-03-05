// Класс для управления очередью сообщений
class MessageQueue {
    constructor(options = {}) {
        this.queue = [];
        this.processing = false;
        this.interval = options.interval || 1000;
        this.maxPerInterval = options.maxPerInterval || 20;
        this.stats = {
            total: 0,
            sent: 0,
            failed: 0,
            pending: 0
        };
    }

    // Добавить сообщение в очередь
    add(message) {
        this.queue.push({
            ...message,
            id: `${Date.now()}-${Math.random()}`,
            timestamp: Date.now(),
            attempts: 0
        });
        this.stats.total++;
        this.stats.pending++;

        if (!this.processing) {
            this.process();
        }

        return this.queue.length;
    }

    // Обработка очереди
    async process() {
        if (this.processing || this.queue.length === 0) {
            return;
        }

        this.processing = true;

        try {
            // Берем сообщения для отправки в этом интервале
            const toSend = this.queue.splice(0, this.maxPerInterval);

            // Отправляем сообщения параллельно
            const promises = toSend.map(async (message) => {
                try {
                    await message.sendFunction();
                    this.stats.sent++;
                    this.stats.pending--;
                    return { success: true, message };
                } catch (error) {
                    console.error(`Ошибка отправки сообщения ${message.id}:`, error);

                    // Пробуем снова, если не превышен лимит попыток
                    if (message.attempts < 3) {
                        message.attempts++;
                        this.queue.push(message);
                    } else {
                        this.stats.failed++;
                        this.stats.pending--;
                        console.error(`Сообщение ${message.id} окончательно не отправлено после 3 попыток`);
                    }
                    return { success: false, message };
                }
            });

            await Promise.all(promises);

            // Если остались сообщения, планируем следующую отправку
            if (this.queue.length > 0) {
                setTimeout(() => {
                    this.processing = false;
                    this.process();
                }, this.interval);
            } else {
                this.processing = false;
            }

        } catch (error) {
            console.error('Ошибка обработки очереди:', error);
            this.processing = false;

            // Пробуем снова через интервал
            if (this.queue.length > 0) {
                setTimeout(() => this.process(), this.interval);
            }
        }
    }

    // Получить статистику очереди
    getStats() {
        return {
            ...this.stats,
            queueLength: this.queue.length
        };
    }

    // Очистить очередь
    clear() {
        this.queue = [];
        this.stats.pending = 0;
    }
}

module.exports = MessageQueue;