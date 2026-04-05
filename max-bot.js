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
            this.bot = new Bot(this.config.max.token);
            this.bot.on('message_created', (ctx) => {
                this.handleMessage(ctx).catch(console.error);
            });
            this.bot.start();
            await new Promise((r) => setTimeout(r, 2000));
            return true;
        } catch (error) {
            console.error('MAX bot:', error.message);
            return false;
        }
    }

    resolveFileName(att) {
        let fileName = att.payload?.name || att.name || '';
        if (fileName) {
            if (!path.extname(fileName)) {
                const map = { image: '.jpg', photo: '.jpg', video: '.mp4', audio: '.mp3', voice: '.ogg' };
                fileName += map[att.type] || '.bin';
            }
            return fileName;
        }
        const fallback = {
            image: `image_${Date.now()}.jpg`,
            photo: `image_${Date.now()}.jpg`,
            video: `video_${Date.now()}.mp4`,
            audio: `audio_${Date.now()}.mp3`,
            voice: `voice_${Date.now()}.ogg`
        };
        return fallback[att.type] || `file_${Date.now()}.bin`;
    }

    async handleMessage(ctx) {
        try {
            const message = ctx.message;
            const chatId = message?.recipient?.chat_id;
            const text = message?.body?.text || '';

            if (text === '/setgroup') {
                this.config.max.groupId = chatId;
                await ctx.reply(`Группа MAX привязана, chat_id: ${chatId}`);
                return;
            }

            if (!this.config.max.groupId || chatId !== this.config.max.groupId) return;
            if (message?.sender?.is_bot) return;

            const maxMid = message?.mid ?? message?.body?.mid;
            const userName = message?.sender?.first_name || message?.sender?.name || 'MAX user';
            const attachments = message?.body?.attachments || [];

            let tgReplyTo = null;
            const replyLink =
                message?.link?.type === 'reply'
                    ? message.link
                    : message?.body?.link?.type === 'reply'
                      ? message.body.link
                      : null;

            if (replyLink) {
                const parentMid = replyLink.message?.mid;
                if (parentMid != null && parentMid !== '') {
                    tgReplyTo = global.msgMap.get(`max_${parentMid}`);
                    if (!tgReplyTo) {
                        console.warn('no tg id for MAX mid', parentMid);
                    }
                } else {
                    console.warn('reply without message.mid');
                }
            }

            if (maxMid) {
                global.msgMap.set(`max_${maxMid}`, null);
            }

            this.queue.add({
                sendFunction: async () => {
                    const tgOptions = { parse_mode: 'HTML' };
                    if (tgReplyTo) {
                        tgOptions.reply_to_message_id = Number(tgReplyTo);
                    }

                    const finalText = text ? `<b>${userName} (MAX):</b>\n${text}` : '';

                    if (attachments.length > 0) {
                        let firstSentMessageId = null;

                        for (let i = 0; i < attachments.length; i++) {
                            const att = attachments[i];
                            const url = att.payload?.url || att.url;
                            if (!url) continue;

                            const fileName = this.resolveFileName(att);
                            const tempFilePath = path.join(
                                this.downloadsDir,
                                `max_${Date.now()}_${i}_${fileName}`
                            );

                            try {
                                const response = await axios({
                                    method: 'GET',
                                    url,
                                    responseType: 'arraybuffer',
                                    timeout: 30000
                                });
                                fs.writeFileSync(tempFilePath, response.data);

                                const fileCaption = i === 0 && finalText ? finalText : '';
                                const fileOptions = {
                                    caption: fileCaption,
                                    parse_mode: 'HTML'
                                };
                                if (i === 0 && tgReplyTo) {
                                    fileOptions.reply_to_message_id = Number(tgReplyTo);
                                }

                                let sentTgMsg;
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

                                if (i === 0 && sentTgMsg?.message_id) {
                                    firstSentMessageId = sentTgMsg.message_id;
                                }
                            } catch (fileError) {
                                console.error('MAX→TG file:', fileError.message);
                                throw fileError;
                            } finally {
                                if (fs.existsSync(tempFilePath)) {
                                    try {
                                        fs.unlinkSync(tempFilePath);
                                    } catch (_) {}
                                }
                            }
                        }

                        if (maxMid && firstSentMessageId) {
                            global.msgMap.set(`max_${maxMid}`, firstSentMessageId);
                            global.msgMap.set(`tg_${firstSentMessageId}`, maxMid);
                        }
                    } else if (finalText) {
                        const sentTgMsg = await this.telegramBot.bot.sendMessage(
                            this.config.telegram.groupId,
                            finalText,
                            tgOptions
                        );
                        if (sentTgMsg?.message_id && maxMid) {
                            global.msgMap.set(`max_${maxMid}`, sentTgMsg.message_id);
                            global.msgMap.set(`tg_${sentTgMsg.message_id}`, maxMid);
                        }
                    }
                }
            });
        } catch (error) {
            console.error('handleMessage:', error);
        }
    }
}

module.exports = MaxBot;
