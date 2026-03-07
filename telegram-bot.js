const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const FormData = require('form-data');

class TelegramBotHandler {
    constructor(config, queue, maxBot) {
        this.config = config;
        this.queue = queue;
        this.maxBot = maxBot;
        this.bot = null;
        this.downloadsDir = path.join(__dirname, 'downloads');
        this.maxApiUrl = 'https://platform-api.max.ru';

        if (!fs.existsSync(this.downloadsDir)) {
            fs.mkdirSync(this.downloadsDir, { recursive: true });
        }
    }

    async initialize() {
        try {
            console.log('🔄 Подключение к Telegram API...');

            this.bot = new TelegramBot(this.config.telegram.token, {
                polling: true
            });

            const me = await this.bot.getMe();
            console.log(`✅ Telegram бот: @${me.username}`);

            this.bot.onText(/\/setgroup/, (msg) => {
                const chatId = msg.chat.id;
                this.config.telegram.groupId = chatId;
                this.bot.sendMessage(chatId, `✅ Telegram группа установлена! ID: ${chatId}`);
                console.log(`✅ Telegram группа установлена: ${chatId}`);
            });

            this.bot.onText(/\/stats/, (msg) => {
                const stats = this.queue.getStats();
                this.bot.sendMessage(
                    msg.chat.id,
                    `📊 Статистика:\n` +
                    `В очереди: ${stats.queueLength}\n` +
                    `Отправлено: ${stats.sent || 0}\n` +
                    `Ошибок: ${stats.failed || 0}`
                );
            });

            this.bot.on('message', async (msg) => {
                try {
                    if (msg.text?.startsWith('/')) return;

                    if (!this.config.telegram.groupId || msg.chat.id !== this.config.telegram.groupId) return;

                    if (!this.config.max.groupId) {
                        this.bot.sendMessage(msg.chat.id, '⚠️ Сначала установите группу в MAX через /setgroup');
                        return;
                    }

                    console.log('📩 Получено сообщение из Telegram для пересылки');

                    const tgMsgId = msg.message_id;
                    const userName = msg.from.first_name || msg.from.username || 'Пользователь Telegram';

                    // Определяем тип медиа
                    let mediaInfo = null;

                    if (msg.photo) {
                        const photo = msg.photo[msg.photo.length - 1];
                        mediaInfo = {
                            type: 'photo',
                            fileId: photo.file_id,
                            fileName: `photo_${Date.now()}.jpg`
                        };
                    } else if (msg.video) {
                        mediaInfo = {
                            type: 'video',
                            fileId: msg.video.file_id,
                            fileName: msg.video.file_name || `video_${Date.now()}.mp4`
                        };
                    } else if (msg.document) {
                        mediaInfo = {
                            type: 'document',
                            fileId: msg.document.file_id,
                            fileName: msg.document.file_name || `document_${Date.now()}.bin`
                        };
                    } else if (msg.audio) {
                        mediaInfo = {
                            type: 'audio',
                            fileId: msg.audio.file_id,
                            fileName: msg.audio.file_name || `audio_${Date.now()}.mp3`
                        };
                    } else if (msg.voice) {
                        mediaInfo = {
                            type: 'voice',
                            fileId: msg.voice.file_id,
                            fileName: `voice_${Date.now()}.ogg`
                        };
                    } else if (msg.video_note) {
                        mediaInfo = {
                            type: 'video_note',
                            fileId: msg.video_note.file_id,
                            fileName: `video_note_${Date.now()}.mp4`
                        };
                    }

                    // Получаем ID для ответа
                    let maxReplyTo = null;
                    if (msg.reply_to_message) {
                        maxReplyTo = global.msgMap.get(`tg_${msg.reply_to_message.message_id}`);
                        console.log(`📎 Ответ на Telegram сообщение ${msg.reply_to_message.message_id} -> MAX ID: ${maxReplyTo}`);
                    }

                    this.queue.add({
                        sendFunction: async () => {
                            try {
                                let sentMax;

                                if (mediaInfo) {
                                    console.log(`📤 Загружаю медиа в MAX: ${mediaInfo.type}`);

                                    // Получаем ссылку на файл из Telegram
                                    const fileLink = await this.bot.getFileLink(mediaInfo.fileId);
                                    console.log(`📥 Ссылка на файл: ${fileLink}`);

                                    // Скачиваем файл
                                    const tempFilePath = path.join(this.downloadsDir, `tg_${Date.now()}_${mediaInfo.fileName}`);

                                    const response = await axios({
                                        method: 'GET',
                                        url: fileLink,
                                        responseType: 'arraybuffer',
                                        timeout: 60000
                                    });

                                    fs.writeFileSync(tempFilePath, response.data);
                                    console.log(`✅ Файл скачан: ${response.data.length} байт`);

                                    let uploadResult;
                                    let attachment;
                                    let token = null;

                                    try {
                                        // ДЛЯ ДОКУМЕНТОВ ИСПОЛЬЗУЕМ НОВЫЙ API
                                        if (mediaInfo.type === 'document') {
                                            console.log('📄 Загрузка документа через API...');

                                            // Получаем URL для загрузки файла
                                            const uploadUrlResponse = await axios({
                                                method: 'POST',
                                                url: `${this.maxApiUrl}/uploads?type=file`,
                                                headers: {
                                                    'Authorization': this.config.max.token
                                                }
                                            });

                                            const uploadUrl = uploadUrlResponse.data.url;
                                            console.log(`📥 Получен URL для загрузки: ${uploadUrl}`);

                                            // Загружаем файл в MAX
                                            const formData = new FormData();
                                            formData.append('data', fs.createReadStream(tempFilePath));

                                            const uploadResponse = await axios({
                                                method: 'POST',
                                                url: uploadUrl,
                                                headers: {
                                                    ...formData.getHeaders()
                                                },
                                                data: formData,
                                                maxContentLength: Infinity,
                                                maxBodyLength: Infinity
                                            });

                                            console.log(`✅ Файл загружен в MAX`);

                                            // Получаем токен
                                            const responseData = uploadResponse.data;

                                            if (typeof responseData === 'string') {
                                                try {
                                                    const parsed = JSON.parse(responseData);
                                                    token = parsed.token || parsed.id || parsed.file_id;
                                                } catch (e) {
                                                    token = responseData;
                                                }
                                            } else {
                                                token = responseData.token || responseData.id || responseData.file_id;
                                            }

                                            if (token) {
                                                console.log(`✅ Получен токен: ${token}`);
                                                attachment = {
                                                    type: 'file',
                                                    payload: { token }
                                                };
                                            }

                                            // Пауза для обработки
                                            await new Promise(resolve => setTimeout(resolve, 2000));

                                        } else {
                                            // ДЛЯ ФОТО, ВИДЕО, АУДИО ИСПОЛЬЗУЕМ СТАРЫЙ МЕТОД
                                            console.log('🎨 Загрузка медиа через старый метод...');

                                            if (mediaInfo.type === 'photo') {
                                                uploadResult = await this.maxBot.bot.api.uploadImage({
                                                    source: fs.readFileSync(tempFilePath)
                                                });
                                            } else if (mediaInfo.type === 'video' || mediaInfo.type === 'video_note') {
                                                uploadResult = await this.maxBot.bot.api.uploadVideo({
                                                    source: tempFilePath
                                                });
                                            } else if (mediaInfo.type === 'audio' || mediaInfo.type === 'voice') {
                                                uploadResult = await this.maxBot.bot.api.uploadAudio({
                                                    source: tempFilePath
                                                });
                                            }

                                            console.log(`✅ Файл загружен в MAX API`);
                                            console.log(`📦 Ответ от MAX:`, JSON.stringify(uploadResult).substring(0, 200));

                                            // ИЗВЛЕКАЕМ ТОКЕН ДЛЯ ФОТО (ОСОБАЯ СТРУКТУРА)
                                            if (uploadResult) {
                                                // Для фото может быть структура { photos: { "id": { token: "..." } } }
                                                if (uploadResult.photos) {
                                                    const photoKeys = Object.keys(uploadResult.photos);
                                                    if (photoKeys.length > 0) {
                                                        const firstPhoto = uploadResult.photos[photoKeys[0]];
                                                        token = firstPhoto?.token;
                                                        console.log(`✅ Найден токен в photos: ${token}`);
                                                    }
                                                }
                                                // Для видео/аудио может быть прямой token
                                                else if (uploadResult.token) {
                                                    token = uploadResult.token;
                                                }
                                                else if (uploadResult.payload?.token) {
                                                    token = uploadResult.payload.token;
                                                }
                                                else if (uploadResult.id) {
                                                    token = uploadResult.id;
                                                }
                                                else if (uploadResult.file_id) {
                                                    token = uploadResult.file_id;
                                                }

                                                // Если не нашли, пробуем распарсить строку
                                                if (!token && typeof uploadResult === 'string') {
                                                    try {
                                                        const parsed = JSON.parse(uploadResult);
                                                        if (parsed.photos) {
                                                            const photoKeys = Object.keys(parsed.photos);
                                                            if (photoKeys.length > 0) {
                                                                token = parsed.photos[photoKeys[0]]?.token;
                                                            }
                                                        } else {
                                                            token = parsed.token || parsed.id || parsed.file_id;
                                                        }
                                                    } catch (e) { }
                                                }
                                            }

                                            if (token) {
                                                console.log(`✅ Получен токен: ${token}`);

                                                let maxType = mediaInfo.type;
                                                if (mediaInfo.type === 'photo') maxType = 'image';
                                                else if (mediaInfo.type === 'voice') maxType = 'audio';
                                                else if (mediaInfo.type === 'video_note') maxType = 'video';

                                                attachment = {
                                                    type: maxType,
                                                    payload: { token }
                                                };
                                            } else {
                                                console.log('⚠️ Токен не найден в ответе');
                                            }
                                        }

                                        if (attachment) {
                                            // Отправляем сообщение с вложением
                                            const options = {
                                                format: 'html',
                                                attachments: [attachment]
                                            };

                                            if (maxReplyTo) {
                                                options.link = { type: 'reply', mid: maxReplyTo };
                                                console.log(`🔄 Будет ответ на MAX сообщение: ${maxReplyTo}`);
                                            }

                                            const caption = msg.caption ? `<b>${userName} (Telegram):</b>\n${msg.caption}` : '';

                                            console.log(`📤 Отправляю в MAX с вложением...`);
                                            sentMax = await this.maxBot.bot.api.sendMessageToChat(
                                                this.config.max.groupId,
                                                caption,
                                                options
                                            );
                                            console.log(`✅ Сообщение с медиа отправлено в MAX`);
                                        } else {
                                            console.log('⚠️ Не удалось получить токен, отправляю как текст');

                                            // Отправляем как текст с информацией
                                            const text = `<b>${userName} (Telegram):</b>\n[Файл: ${mediaInfo.fileName}]`;
                                            const options = { format: 'html' };
                                            if (maxReplyTo) {
                                                options.link = { type: 'reply', mid: maxReplyTo };
                                            }
                                            sentMax = await this.maxBot.bot.api.sendMessageToChat(
                                                this.config.max.groupId,
                                                text,
                                                options
                                            );
                                        }

                                    } catch (uploadError) {
                                        console.error('❌ Ошибка загрузки в MAX:', uploadError.message);
                                        if (uploadError.response) {
                                            console.error('Детали:', uploadError.response.data);
                                        }

                                        // Отправляем как текст с информацией
                                        const text = `<b>${userName} (Telegram):</b>\n[Файл: ${mediaInfo.fileName}]`;
                                        const options = { format: 'html' };
                                        if (maxReplyTo) {
                                            options.link = { type: 'reply', mid: maxReplyTo };
                                        }
                                        sentMax = await this.maxBot.bot.api.sendMessageToChat(
                                            this.config.max.groupId,
                                            text,
                                            options
                                        );
                                    } finally {
                                        // Удаляем временный файл
                                        try { fs.unlinkSync(tempFilePath); } catch (e) { }
                                    }

                                } else if (msg.text) {
                                    // Отправляем текст
                                    const options = { format: 'html' };

                                    if (maxReplyTo) {
                                        options.link = { type: 'reply', mid: maxReplyTo };
                                        console.log(`🔄 Будет ответ на MAX сообщение: ${maxReplyTo}`);
                                    }

                                    const text = `<b>${userName} (Telegram):</b>\n${msg.text}`;

                                    console.log(`📤 Отправляю текст в MAX...`);
                                    sentMax = await this.maxBot.bot.api.sendMessageToChat(
                                        this.config.max.groupId,
                                        text,
                                        options
                                    );
                                    console.log(`✅ Текст отправлен в MAX`);
                                }

                                // Сохраняем связь сообщений
                                if (sentMax) {
                                    const sentMid = sentMax?.body?.mid || sentMax?.mid;
                                    if (sentMid) {
                                        global.msgMap.set(`tg_${tgMsgId}`, sentMid);
                                        global.msgMap.set(`max_${sentMid}`, tgMsgId);
                                        console.log(`🔗 Связано TG:${tgMsgId} <-> MAX:${sentMid}`);
                                    }
                                }

                            } catch (error) {
                                console.error('❌ Ошибка отправки в MAX:', error.message);
                                throw error;
                            }
                        }
                    });

                } catch (error) {
                    console.error('Ошибка обработки:', error);
                }
            });

            return true;

        } catch (error) {
            console.error('❌ Ошибка Telegram:', error.message);
            return false;
        }
    }
}

module.exports = TelegramBotHandler;