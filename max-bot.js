const { Bot, Attachment, ImageAttachment, VideoAttachment, AudioAttachment, FileAttachment } = require('@maxhub/max-bot-api');

class MaxBot {
    constructor(config, queue, telegramBot) {
        this.config = config;
        this.queue = queue;
        this.telegramBot = telegramBot;
        this.bot = null;
        this.userCache = new Map(); // Кэш пользователей
    }

    async initialize() {
        try {
            this.bot = new Bot(this.config.max.token);

            // Устанавливаем команды
            await this.bot.api.setMyCommands([
                {
                    name: 'start',
                    description: 'Запустить бота'
                },
                {
                    name: 'help',
                    description: 'Показать справку'
                },
                {
                    name: 'stats',
                    description: 'Статистика работы моста'
                },
                {
                    name: 'setgroup',
                    description: 'Установить текущую группу для пересылки'
                }
            ]);

            // Обработчик команд
            this.bot.command('start', this.handleStart.bind(this));
            this.bot.command('help', this.handleHelp.bind(this));
            this.bot.command('stats', this.handleStats.bind(this));
            this.bot.command('setgroup', this.handleSetGroup.bind(this));

            // Обработчик всех сообщений
            this.bot.on('message_created', this.handleMessage.bind(this));

            // Запускаем бота
            this.bot.start();
            console.log('✅ MAX бот успешно запущен');

            return true;
        } catch (error) {
            console.error('❌ Ошибка запуска MAX бота:', error);
            return false;
        }
    }

    async handleStart(ctx) {
        const user = ctx.user();
        await ctx.reply(
            `👋 Привет, ${user || 'пользователь'}!\n\n` +
            `Я бот-мост между MAX и Telegram. ` +
            `Отправь /help чтобы узнать, что я умею.`
        );
    }

    async handleHelp(ctx) {
        await ctx.reply(
            `📚 Доступные команды:\n\n` +
            `/start - Запустить бота\n` +
            `/help - Показать эту справку\n` +
            `/stats - Статистика работы моста\n` +
            `/setgroup - Установить текущую группу для пересылки\n\n` +
            `📎 Поддерживаемые типы медиа:\n` +
            `- Фотографии\n` +
            `- Видео\n` +
            `- Документы\n` +
            `- Аудио\n` +
            `- Голосовые сообщения\n` +
            `- Видеосообщения\n\n` +
            `💬 Для ответа на сообщение используйте функцию reply.`
        );
    }

    async handleStats(ctx) {
        const stats = this.queue.getStats();
        await ctx.reply(
            `📊 Статистика работы моста:\n\n` +
            `Всего сообщений: ${stats.total}\n` +
            `Отправлено: ${stats.sent}\n` +
            `Ошибок: ${stats.failed}\n` +
            `В очереди: ${stats.queueLength}\n` +
            `Ожидают отправки: ${stats.pending}`
        );
    }

    async handleSetGroup(ctx) {
        const chatId = ctx.message.body.chat_id;
        this.config.max.groupId = chatId;
        await ctx.reply(`✅ Текущая группа установлена для пересылки. ID: ${chatId}`);
        console.log(`MAX группа установлена: ${chatId}`);
    }

    async handleMessage(ctx) {
        try {
            const message = ctx.message;
            const chatId = message.body.chat_id;

            // Проверяем, что сообщение из группы и группа настроена
            if (!this.config.max.groupId || chatId !== this.config.max.groupId) {
                return; // Игнорируем сообщения не из настроенной группы
            }

            // Игнорируем служебные сообщения
            if (message.body.type !== 'message_created') {
                return;
            }

            // Получаем информацию об отправителе
            const userId = message.body.from_id;
            let userName = 'Пользователь MAX';

            try {
                // Пытаемся получить имя пользователя
                const userInfo = await this.bot.api.raw.get(`users/${userId}`);
                if (userInfo && userInfo.body) {
                    userName = userInfo.body.name || userInfo.body.username || 'Пользователь MAX';
                    this.userCache.set(userId, userName);
                }
            } catch (error) {
                // Если не удалось получить имя, используем имя из кэша или дефолтное
                userName = this.userCache.get(userId) || 'Пользователь MAX';
            }

            // Формируем текст сообщения
            let text = message.body.text || '';

            // Добавляем информацию об ответе, если есть
            let replyToMessageId = null;
            if (message.body.link && message.body.link.type === 'reply') {
                replyToMessageId = message.body.link.mid;
                text = `[Ответ на сообщение]\n${text}`;
            }

            // Разбиваем длинные сообщения
            const maxLength = this.config.bridge.maxMessageLength - 500; // Оставляем место для префикса
            const messages = this.splitMessage(text, maxLength);

            // Отправляем каждую часть в очередь
            for (let i = 0; i < messages.length; i++) {
                const partText = messages.length > 1
                    ? `${userName} (часть ${i + 1}/${messages.length}):\n${messages[i]}`
                    : `${userName}:\n${messages[i]}`;

                // Обрабатываем вложения
                const attachments = message.body.attachments || [];

                this.queue.add({
                    sendFunction: async () => {
                        if (attachments.length > 0) {
                            // Есть медиа - отправляем с медиа
                            await this.telegramBot.sendMediaGroup(
                                attachments,
                                partText,
                                replyToMessageId
                            );
                        } else {
                            // Только текст
                            await this.telegramBot.sendMessage(
                                partText,
                                replyToMessageId
                            );
                        }
                    }
                });
            }

            console.log(`📨 Сообщение из MAX поставлено в очередь: ${text.substring(0, 50)}...`);

        } catch (error) {
            console.error('Ошибка обработки сообщения из MAX:', error);
        }
    }

    // Разбивка длинных сообщений
    splitMessage(text, maxLength) {
        if (text.length <= maxLength) {
            return [text];
        }

        const parts = [];
        let currentPart = '';

        const sentences = text.split(/(?<=[.!?])\s+/);

        for (const sentence of sentences) {
            if ((currentPart + sentence).length <= maxLength) {
                currentPart += (currentPart ? ' ' : '') + sentence;
            } else {
                if (currentPart) {
                    parts.push(currentPart);
                    currentPart = sentence;
                } else {
                    // Если одно предложение длиннее лимита, режем по словам
                    const words = sentence.split(' ');
                    currentPart = '';
                    for (const word of words) {
                        if ((currentPart + word).length <= maxLength) {
                            currentPart += (currentPart ? ' ' : '') + word;
                        } else {
                            if (currentPart) {
                                parts.push(currentPart);
                                currentPart = word;
                            } else {
                                // Если слово длиннее лимита, режем по символам
                                while (word.length > maxLength) {
                                    parts.push(word.substring(0, maxLength));
                                    word = word.substring(maxLength);
                                }
                                currentPart = word;
                            }
                        }
                    }
                }
            }
        }

        if (currentPart) {
            parts.push(currentPart);
        }

        return parts;
    }
}

module.exports = MaxBot;