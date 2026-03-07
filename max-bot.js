const { Bot } = require('@maxhub/max-bot-api');
const fs = require('fs');
const path = require('path');
const axios = require('axios');

class MaxBot {
    constructor(config, queue, telegramBot) {
        this.config = config;
        this.queue = queue;
        this.telegramBot = telegramBot;
        this.bot = null;
        this.downloadsDir = path.join(__dirname, 'downloads');

        if (!fs.existsSync(this.downloadsDir)) {
            fs.mkdirSync(this.downloadsDir, { recursive: true });
        }
    }

    async initialize() {
        try {
            console.log('🔄 Подключение к MAX API...');

            this.bot = new Bot(this.config.max.token);

            this.bot.on('message_created', (ctx) => {
                this.handleMessage(ctx).catch(console.error);
            });

            this.bot.start();

            console.log('✅ MAX бот запущен');

            await new Promise(resolve => setTimeout(resolve, 2000));
            return true;

        } catch (error) {
            console.error('❌ Ошибка запуска MAX бота:', error.message);
            return false;
        }
    }

    async handleMessage(ctx) {
        try {
            const message = ctx.message;
            const chatId = message?.recipient?.chat_id;
            const text = message?.body?.text || '';

            if (text === '/setgroup') {
                this.config.max.groupId = chatId;
                await ctx.reply(`✅ MAX группа установлена! ID: ${chatId}`);
                console.log(`✅ MAX группа установлена: ${chatId}`);
                return;
            }

            if (!this.config.max.groupId || chatId !== this.config.max.groupId) {
                return;
            }

            if (message?.sender?.is_bot) return;

            console.log('📩 Получено сообщение из MAX для пересылки');

            const maxMid = message?.body?.mid;
            const userName = message?.sender?.first_name || message?.sender?.name || 'Пользователь MAX';
            const attachments = message?.body?.attachments || [];

            // Получаем ID для ответа
            let tgReplyTo = null;
            if (message?.body?.link && message.body.link.type === 'reply') {
                tgReplyTo = global.msgMap.get(`max_${message.body.link.mid}`);
                console.log(`📎 Ответ на MAX сообщение ${message.body.link.mid} -> Telegram ID: ${tgReplyTo}`);
            }

            this.queue.add({
                sendFunction: async () => {
                    try {
                        // Базовые опции для Telegram
                        const tgOptions = {
                            parse_mode: 'HTML'
                        };

                        // Добавляем reply_to_message_id для ответа
                        if (tgReplyTo) {
                            tgOptions.reply_to_message_id = Number(tgReplyTo);
                            console.log(`🔄 Будет ответ на сообщение Telegram ID: ${tgReplyTo}`);
                        }

                        const finalText = text ? `<b>${userName} (MAX):</b>\n${text}` : '';

                        if (attachments.length > 0) {
                            // Отправляем каждое вложение отдельно
                            for (let i = 0; i < attachments.length; i++) {
                                const att = attachments[i];
                                const url = att.payload?.url || att.url;

                                if (!url) continue;

                                let tempFilePath = null;

                                try {
                                    // Получаем имя файла из MAX
                                    let fileName = att.payload?.name || att.name || '';

                                    // Если имя пустое, создаем на основе типа
                                    if (!fileName) {
                                        if (att.type === 'image' || att.type === 'photo') {
                                            fileName = `image_${Date.now()}.jpg`;
                                        } else if (att.type === 'video') {
                                            fileName = `video_${Date.now()}.mp4`;
                                        } else if (att.type === 'audio') {
                                            fileName = `audio_${Date.now()}.mp3`;
                                        } else if (att.type === 'voice') {
                                            fileName = `voice_${Date.now()}.ogg`;
                                        } else {
                                            fileName = `file_${Date.now()}.bin`;
                                        }
                                    } else {
                                        // Проверяем расширение
                                        const ext = path.extname(fileName);
                                        if (!ext) {
                                            if (att.type === 'image' || att.type === 'photo') {
                                                fileName += '.jpg';
                                            } else if (att.type === 'video') {
                                                fileName += '.mp4';
                                            } else if (att.type === 'audio') {
                                                fileName += '.mp3';
                                            } else if (att.type === 'voice') {
                                                fileName += '.ogg';
                                            } else {
                                                fileName += '.bin';
                                            }
                                        }
                                    }

                                    console.log(`📥 Скачиваю файл: ${fileName}`);

                                    tempFilePath = path.join(this.downloadsDir, `max_${Date.now()}_${i}_${fileName}`);

                                    const response = await axios({
                                        method: 'GET',
                                        url: url,
                                        responseType: 'arraybuffer',
                                        timeout: 30000
                                    });

                                    fs.writeFileSync(tempFilePath, response.data);
                                    console.log(`✅ Файл скачан: ${response.data.length} байт`);

                                    // Подпись только для первого файла
                                    const fileCaption = (i === 0 && finalText) ? finalText : '';

                                    // Опции для отправки файла
                                    const fileOptions = {
                                        caption: fileCaption,
                                        parse_mode: 'HTML'
                                    };

                                    // Добавляем reply_to_message_id ТОЛЬКО для первого файла
                                    if (i === 0 && tgReplyTo) {
                                        fileOptions.reply_to_message_id = Number(tgReplyTo);
                                    }

                                    let sentTgMsg;

                                    // Отправляем в Telegram
                                    if (att.type === 'image' || att.type === 'photo') {
                                        sentTgMsg = await this.telegramBot.bot.sendPhoto(
                                            this.config.telegram.groupId,
                                            tempFilePath,
                                            fileOptions
                                        );
                                    } else if (att.type === 'video') {
                                        sentTgMsg = await this.telegramBot.bot.sendVideo(
                                            this.config.telegram.groupId,
                                            tempFilePath,
                                            fileOptions
                                        );
                                    } else if (att.type === 'audio' || att.type === 'voice') {
                                        sentTgMsg = await this.telegramBot.bot.sendAudio(
                                            this.config.telegram.groupId,
                                            tempFilePath,
                                            fileOptions
                                        );
                                    } else {
                                        sentTgMsg = await this.telegramBot.bot.sendDocument(
                                            this.config.telegram.groupId,
                                            tempFilePath,
                                            fileOptions
                                        );
                                    }

                                    console.log(`✅ Файл отправлен в Telegram: ${fileName}`);

                                    // Сохраняем связь для ответов
                                    if (i === 0 && sentTgMsg && sentTgMsg.message_id && maxMid) {
                                        global.msgMap.set(`tg_${sentTgMsg.message_id}`, maxMid);
                                        global.msgMap.set(`max_${maxMid}`, sentTgMsg.message_id);
                                        console.log(`🔗 Связано MAX:${maxMid} <-> TG:${sentTgMsg.message_id}`);
                                    }

                                } catch (fileError) {
                                    console.error(`❌ Ошибка с файлом:`, fileError.message);
                                    throw fileError;
                                } finally {
                                    if (tempFilePath && fs.existsSync(tempFilePath)) {
                                        try { fs.unlinkSync(tempFilePath); } catch (e) { }
                                    }
                                }
                            }
                        } else if (finalText) {
                            // Отправляем только текст
                            const sentTgMsg = await this.telegramBot.bot.sendMessage(
                                this.config.telegram.groupId,
                                finalText,
                                tgOptions
                            );
                            console.log(`✅ Текст отправлен в Telegram`);

                            if (sentTgMsg && sentTgMsg.message_id && maxMid) {
                                global.msgMap.set(`tg_${sentTgMsg.message_id}`, maxMid);
                                global.msgMap.set(`max_${maxMid}`, sentTgMsg.message_id);
                                console.log(`🔗 Связано MAX:${maxMid} <-> TG:${sentTgMsg.message_id}`);
                            }
                        }

                    } catch (error) {
                        console.error('❌ Ошибка отправки в Telegram:', error);
                        throw error;
                    }
                }
            });

        } catch (error) {
            console.error('Ошибка:', error);
        }
    }
}

module.exports = MaxBot;