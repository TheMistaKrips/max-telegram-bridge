const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const FormData = require('form-data');
const mime = require('mime-types');

class TelegramBotHandler {
    constructor(config, queue, maxBot) {
        this.config = config;
        this.queue = queue;
        this.maxBot = maxBot;
        this.bot = null;
        this.userCache = new Map();
    }

    async initialize() {
        try {
            this.bot = new TelegramBot(this.config.telegram.token, {
                polling: true
            });

            // Устанавливаем команды
            await this.bot.setMyCommands([
                { command: 'start', description: 'Запустить бота' },
                { command: 'help', description: 'Показать справку' },
                { command: 'stats', description: 'Статистика работы моста' },
                { command: 'setgroup', description: 'Установить текущую группу для пересылки' }
            ]);

            // Обработчики команд
            this.bot.onText(/\/start/, this.handleStart.bind(this));
            this.bot.onText(/\/help/, this.handleHelp.bind(this));
            this.bot.onText(/\/stats/, this.handleStats.bind(this));
            this.bot.onText(/\/setgroup/, this.handleSetGroup.bind(this));

            // Обработчик всех сообщений
            this.bot.on('message', this.handleMessage.bind(this));

            // Обработчик медиа
            this.bot.on('photo', this.handlePhoto.bind(this));
            this.bot.on('video', this.handleVideo.bind(this));
            this.bot.on('document', this.handleDocument.bind(this));
            this.bot.on('audio', this.handleAudio.bind(this));
            this.bot.on('voice', this.handleVoice.bind(this));
            this.bot.on('video_note', this.handleVideoNote.bind(this));

            console.log('✅ Telegram бот успешно запущен');
            return true;
        } catch (error) {
            console.error('❌ Ошибка запуска Telegram бота:', error);
            return false;
        }
    }

    async handleStart(msg) {
        const chatId = msg.chat.id;
        const userName = msg.from.first_name || 'пользователь';

        await this.bot.sendMessage(
            chatId,
            `👋 Привет, ${userName}!\n\n` +
            `Я бот-мост между Telegram и MAX. ` +
            `Отправь /help чтобы узнать, что я умею.`
        );
    }

    async handleHelp(msg) {
        const chatId = msg.chat.id;
        await this.bot.sendMessage(
            chatId,
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

    async handleStats(msg) {
        const chatId = msg.chat.id;
        const stats = this.queue.getStats();
        await this.bot.sendMessage(
            chatId,
            `📊 Статистика работы моста:\n\n` +
            `Всего сообщений: ${stats.total}\n` +
            `Отправлено: ${stats.sent}\n` +
            `Ошибок: ${stats.failed}\n` +
            `В очереди: ${stats.queueLength}\n` +
            `Ожидают отправки: ${stats.pending}`
        );
    }

    async handleSetGroup(msg) {
        const chatId = msg.chat.id;
        this.config.telegram.groupId = chatId;
        await this.bot.sendMessage(chatId, `✅ Текущая группа установлена для пересылки. ID: ${chatId}`);
        console.log(`Telegram группа установлена: ${chatId}`);
    }

    async handleMessage(msg) {
        try {
            const chatId = msg.chat.id;

            // Проверяем, что сообщение из группы и группа настроена
            if (!this.config.telegram.groupId || chatId !== this.config.telegram.groupId) {
                return;
            }

            // Игнорируем служебные сообщения
            if (msg.text && msg.text.startsWith('/')) {
                return;
            }

            // Получаем информацию об отправителе
            const userName = msg.from.first_name ||
                msg.from.username ||
                'Пользователь Telegram';

            // Проверяем, есть ли ответ на другое сообщение
            let replyToText = '';
            if (msg.reply_to_message) {
                const repliedUser = msg.reply_to_message.from.first_name ||
                    msg.reply_to_message.from.username ||
                    'пользователь';
                replyToText = `[Ответ пользователю ${repliedUser}]\n`;
            }

            // Формируем текст
            let text = msg.text || '';

            // Разбиваем длинные сообщения
            const maxLength = this.config.bridge.maxMessageLength - 500;
            const messages = this.splitMessage(text, maxLength);

            // Отправляем каждую часть в очередь
            for (let i = 0; i < messages.length; i++) {
                const partText = messages.length > 1
                    ? `${userName} (Telegram) (часть ${i + 1}/${messages.length}):\n${replyToText}${messages[i]}`
                    : `${userName} (Telegram):\n${replyToText}${messages[i]}`;

                this.queue.add({
                    sendFunction: async () => {
                        await this.maxBot.bot.api.sendMessageToChat(
                            this.config.max.groupId,
                            partText,
                            { format: 'html' }
                        );
                    }
                });
            }

            console.log(`📨 Сообщение из Telegram поставлено в очередь: ${text.substring(0, 50)}...`);

        } catch (error) {
            console.error('Ошибка обработки сообщения из Telegram:', error);
        }
    }

    async handlePhoto(msg) {
        await this.handleMedia(msg, 'photo');
    }

    async handleVideo(msg) {
        await this.handleMedia(msg, 'video');
    }

    async handleDocument(msg) {
        await this.handleMedia(msg, 'document');
    }

    async handleAudio(msg) {
        await this.handleMedia(msg, 'audio');
    }

    async handleVoice(msg) {
        await this.handleMedia(msg, 'voice');
    }

    async handleVideoNote(msg) {
        await this.handleMedia(msg, 'video_note');
    }

    async handleMedia(msg, mediaType) {
        try {
            const chatId = msg.chat.id;

            if (!this.config.telegram.groupId || chatId !== this.config.telegram.groupId) {
                return;
            }

            const userName = msg.from.first_name ||
                msg.from.username ||
                'Пользователь Telegram';

            const caption = msg.caption || '';
            const fileId = this.getFileId(msg, mediaType);

            if (!fileId) {
                console.error('Не удалось получить file_id для медиа');
                return;
            }

            // Получаем ссылку на файл
            const fileLink = await this.bot.getFileLink(fileId);

            // Скачиваем файл
            const response = await axios({
                method: 'GET',
                url: fileLink,
                responseType: 'stream'
            });

            // Загружаем в MAX
            let attachment;
            switch (mediaType) {
                case 'photo':
                    attachment = await this.maxBot.bot.api.uploadImage({
                        source: response.data
                    });
                    break;
                case 'video':
                case 'video_note':
                    attachment = await this.maxBot.bot.api.uploadVideo({
                        source: response.data
                    });
                    break;
                case 'audio':
                case 'voice':
                    attachment = await this.maxBot.bot.api.uploadAudio({
                        source: response.data
                    });
                    break;
                case 'document':
                    attachment = await this.maxBot.bot.api.uploadFile({
                        source: response.data
                    });
                    break;
            }

            // Отправляем в очередь
            this.queue.add({
                sendFunction: async () => {
                    await this.maxBot.bot.api.sendMessageToChat(
                        this.config.max.groupId,
                        `${userName} (Telegram) отправил ${this.getMediaTypeName(mediaType)}${caption ? ': ' + caption : ''}`,
                        {
                            attachments: [attachment.toJson()],
                            format: 'html'
                        }
                    );
                }
            });

            console.log(`📨 Медиа из Telegram поставлено в очередь: ${mediaType}`);

        } catch (error) {
            console.error('Ошибка обработки медиа из Telegram:', error);
        }
    }

    getFileId(msg, mediaType) {
        switch (mediaType) {
            case 'photo':
                return msg.photo[msg.photo.length - 1].file_id;
            case 'video':
                return msg.video.file_id;
            case 'document':
                return msg.document.file_id;
            case 'audio':
                return msg.audio.file_id;
            case 'voice':
                return msg.voice.file_id;
            case 'video_note':
                return msg.video_note.file_id;
            default:
                return null;
        }
    }

    getMediaTypeName(mediaType) {
        const names = {
            photo: 'фото',
            video: 'видео',
            video_note: 'видеосообщение',
            document: 'документ',
            audio: 'аудио',
            voice: 'голосовое сообщение'
        };
        return names[mediaType] || mediaType;
    }

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

    async sendMessage(text, replyToMessageId = null) {
        try {
            await this.bot.sendMessage(this.config.telegram.groupId, text, {
                reply_to_message_id: replyToMessageId
            });
        } catch (error) {
            console.error('Ошибка отправки сообщения в Telegram:', error);
            throw error;
        }
    }

    async sendMediaGroup(attachments, caption, replyToMessageId = null) {
        // TODO: Реализовать отправку группы медиа в Telegram
        // Пока отправляем как обычное сообщение
        await this.sendMessage(caption, replyToMessageId);
    }
}

module.exports = TelegramBotHandler;