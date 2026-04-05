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
        this.MAX_TEXT_LENGTH = 3600;
        if (!fs.existsSync(this.downloadsDir)) {
            fs.mkdirSync(this.downloadsDir, { recursive: true });
        }
    }

    splitMessageForMax(text) {
        if (text.length <= this.MAX_TEXT_LENGTH) return [text];
        const parts = [];
        let remaining = text;
        while (remaining.length > this.MAX_TEXT_LENGTH) {
            let splitAt = remaining.lastIndexOf(' ', this.MAX_TEXT_LENGTH);
            if (splitAt === -1) splitAt = this.MAX_TEXT_LENGTH;
            parts.push(remaining.substring(0, splitAt));
            remaining = remaining.substring(splitAt).trimStart();
        }
        if (remaining.length > 0) parts.push(remaining);
        return parts;
    }

    parseUploadToken(responseData) {
        if (typeof responseData === 'string') {
            try {
                const parsed = JSON.parse(responseData);
                return parsed.token || parsed.id || parsed.file_id;
            } catch {
                return responseData;
            }
        }
        return responseData.token || responseData.id || responseData.file_id;
    }

    tokenFromUploadResult(uploadResult) {
        if (!uploadResult) return null;
        let token = null;
        if (uploadResult.photos) {
            const keys = Object.keys(uploadResult.photos);
            if (keys.length) token = uploadResult.photos[keys[0]]?.token;
        } else if (uploadResult.token) {
            token = uploadResult.token;
        } else if (uploadResult.payload?.token) {
            token = uploadResult.payload.token;
        } else if (uploadResult.id) {
            token = uploadResult.id;
        } else if (uploadResult.file_id) {
            token = uploadResult.file_id;
        }
        if (!token && typeof uploadResult === 'string') {
            try {
                const parsed = JSON.parse(uploadResult);
                if (parsed.photos) {
                    const keys = Object.keys(parsed.photos);
                    if (keys.length) token = parsed.photos[keys[0]]?.token;
                } else {
                    token = parsed.token || parsed.id || parsed.file_id;
                }
            } catch {
                /* ignore */
            }
        }
        return token;
    }

    async sendTextToMax(userName, text, options = {}) {
        const fullText = `<b>${userName} (Telegram):</b>\n${text}`;
        const parts = this.splitMessageForMax(fullText);

        if (parts.length === 1) {
            return this.maxBot.bot.api.sendMessageToChat(
                this.config.max.groupId,
                parts[0],
                options
            );
        }

        const results = [];
        for (let i = 0; i < parts.length; i++) {
            let messageToSend = parts[i];
            const partOptions = { ...options };

            if (i === 0) {
                messageToSend = `${parts[i]}\n\n[Продолжение следует...]`;
            } else if (i === parts.length - 1) {
                messageToSend = `[Продолжение ${i + 1}/${parts.length}]\n${parts[i]}\n\n[Сообщение завершено]`;
            } else {
                messageToSend = `[Продолжение ${i + 1}/${parts.length}]\n${parts[i]}`;
            }

            if (i > 0 && partOptions.link) delete partOptions.link;

            const result = await this.maxBot.bot.api.sendMessageToChat(
                this.config.max.groupId,
                messageToSend,
                partOptions
            );
            results.push(result);
            if (i < parts.length - 1) {
                await new Promise((r) => setTimeout(r, 150));
            }
        }
        return results;
    }

    async initialize() {
        try {
            this.bot = new TelegramBot(this.config.telegram.token, { polling: true });
            const me = await this.bot.getMe();
            console.log('telegram:', me.username);

            this.bot.onText(/\/setgroup/, (msg) => {
                const chatId = msg.chat.id;
                this.config.telegram.groupId = chatId;
                this.bot.sendMessage(chatId, `Группа Telegram привязана, chat_id: ${chatId}`);
            });

            this.bot.onText(/\/stats/, (msg) => {
                const s = this.queue.getStats();
                this.bot.sendMessage(
                    msg.chat.id,
                    `Очередь: ${s.queueLength}\nОтправлено: ${s.sent || 0}\nОшибок: ${s.failed || 0}`
                );
            });

            this.bot.on('message', async (msg) => {
                try {
                    if (msg.text?.startsWith('/')) return;
                    if (!this.config.telegram.groupId || msg.chat.id !== this.config.telegram.groupId) {
                        return;
                    }
                    if (!this.config.max.groupId) {
                        this.bot.sendMessage(
                            msg.chat.id,
                            'Сначала привяжите группу в MAX командой /setgroup'
                        );
                        return;
                    }

                    const tgMsgId = msg.message_id;
                    const userName = msg.from.first_name || msg.from.username || 'Telegram user';

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

                    let maxReplyTo = null;
                    if (msg.reply_to_message) {
                        maxReplyTo = global.msgMap.get(`tg_${msg.reply_to_message.message_id}`);
                    }

                    this.queue.add({
                        sendFunction: async () => {
                            let sentMax;

                            if (mediaInfo) {
                                const fileLink = await this.bot.getFileLink(mediaInfo.fileId);
                                const tempFilePath = path.join(
                                    this.downloadsDir,
                                    `tg_${Date.now()}_${mediaInfo.fileName}`
                                );

                                const response = await axios({
                                    method: 'GET',
                                    url: fileLink,
                                    responseType: 'arraybuffer',
                                    timeout: 60000
                                });
                                fs.writeFileSync(tempFilePath, response.data);

                                let uploadResult;
                                let attachment;
                                let token = null;

                                try {
                                    if (mediaInfo.type === 'document') {
                                        const uploadUrlResponse = await axios({
                                            method: 'POST',
                                            url: `${this.maxApiUrl}/uploads?type=file`,
                                            headers: { Authorization: this.config.max.token }
                                        });
                                        const uploadUrl = uploadUrlResponse.data.url;
                                        const formData = new FormData();
                                        formData.append('data', fs.createReadStream(tempFilePath));
                                        const uploadResponse = await axios({
                                            method: 'POST',
                                            url: uploadUrl,
                                            headers: formData.getHeaders(),
                                            data: formData,
                                            maxContentLength: Infinity,
                                            maxBodyLength: Infinity
                                        });
                                        token = this.parseUploadToken(uploadResponse.data);
                                        if (token) {
                                            attachment = { type: 'file', payload: { token } };
                                        }
                                        await new Promise((r) => setTimeout(r, 2000));
                                    } else {
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
                                        token = this.tokenFromUploadResult(uploadResult);
                                        if (token) {
                                            let maxType = mediaInfo.type;
                                            if (mediaInfo.type === 'photo') maxType = 'image';
                                            else if (mediaInfo.type === 'voice') maxType = 'audio';
                                            else if (mediaInfo.type === 'video_note') maxType = 'video';
                                            attachment = { type: maxType, payload: { token } };
                                        }
                                    }

                                    if (attachment) {
                                        const options = {
                                            format: 'html',
                                            attachments: [attachment]
                                        };
                                        if (maxReplyTo) {
                                            options.link = { type: 'reply', mid: maxReplyTo };
                                        }

                                        const caption = msg.caption
                                            ? `<b>${userName} (Telegram):</b>\n${msg.caption}`
                                            : '';

                                        if (caption.length > this.MAX_TEXT_LENGTH) {
                                            const captionParts = this.splitMessageForMax(caption);
                                            sentMax = await this.maxBot.bot.api.sendMessageToChat(
                                                this.config.max.groupId,
                                                captionParts[0],
                                                options
                                            );
                                            for (let i = 1; i < captionParts.length; i++) {
                                                const partOptions = { format: 'html' };
                                                if (maxReplyTo && i === 1) {
                                                    partOptions.link = { type: 'reply', mid: maxReplyTo };
                                                }
                                                await new Promise((r) => setTimeout(r, 150));
                                                await this.maxBot.bot.api.sendMessageToChat(
                                                    this.config.max.groupId,
                                                    captionParts[i],
                                                    partOptions
                                                );
                                            }
                                        } else {
                                            sentMax = await this.maxBot.bot.api.sendMessageToChat(
                                                this.config.max.groupId,
                                                caption,
                                                options
                                            );
                                        }
                                    } else {
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
                                    console.error('upload to MAX:', uploadError.message);
                                    if (uploadError.response?.data) {
                                        console.error(uploadError.response.data);
                                    }
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
                                    try {
                                        fs.unlinkSync(tempFilePath);
                                    } catch (_) {}
                                }
                            } else if (msg.text) {
                                const options = { format: 'html' };
                                if (maxReplyTo) {
                                    options.link = { type: 'reply', mid: maxReplyTo };
                                }
                                const results = await this.sendTextToMax(userName, msg.text, options);
                                sentMax = Array.isArray(results) ? results[0] : results;
                            }

                            if (sentMax) {
                                const sentMid = sentMax?.body?.mid || sentMax?.mid;
                                if (sentMid) {
                                    global.msgMap.set(`tg_${tgMsgId}`, sentMid);
                                    global.msgMap.set(`max_${sentMid}`, tgMsgId);
                                }
                            }
                        }
                    });
                } catch (error) {
                    console.error('telegram message handler:', error);
                }
            });

            return true;
        } catch (error) {
            console.error('telegram bot:', error.message);
            return false;
        }
    }
}

module.exports = TelegramBotHandler;
