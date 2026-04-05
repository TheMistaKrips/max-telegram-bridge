class MessageQueue {
    constructor(options = {}) {
        this.queue = [];
        this.processing = false;
        this.interval = options.interval || 2000;
        this.maxPerInterval = options.maxPerInterval || 3;
        this.stats = { total: 0, sent: 0, failed: 0 };
    }

    add(message) {
        this.queue.push({ ...message, attempts: 0 });
        this.stats.total++;
        if (!this.processing) this.process();
    }

    async process() {
        if (this.processing || this.queue.length === 0) return;

        this.processing = true;
        const batch = this.queue.splice(0, this.maxPerInterval);
        const failed = [];

        for (const item of batch) {
            try {
                await item.sendFunction();
                this.stats.sent++;
            } catch (error) {
                console.error('queue send error:', error.message);
                if (item.attempts < 3) {
                    item.attempts++;
                    failed.push(item);
                } else {
                    this.stats.failed++;
                }
            }
            await new Promise((r) => setTimeout(r, 500));
        }

        if (failed.length) this.queue.unshift(...failed);
        this.processing = false;

        if (this.queue.length > 0) {
            setTimeout(() => this.process(), this.interval);
        }
    }

    getStats() {
        return { ...this.stats, queueLength: this.queue.length };
    }
}

module.exports = MessageQueue;
