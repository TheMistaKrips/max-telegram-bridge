// Конфигурация ботов
module.exports = {
    // MAX бот
    max: {
        token: 'f9LHodD0cOLSvQ47jDNoxp9uvAL9ruWKFxApz19VFhxzEsZ-0kLRKviZcJccggze9G9Qj4pYy1DES1vJtvIM',
        // ID группы в MAX (нужно будет заменить на реальный после первого запуска)
        groupId: null // Например: '123456789'
    },

    // Telegram бот (нужно создать через @BotFather)
    telegram: {
        token: '7890821297:AAHFthTMXjN3oQKfQY_NISrWya9u5kmvvck', // Замени на свой токен
        // ID группы в Telegram (нужно будет заменить на реальный)
        groupId: null // Например: -1001234567890
    },

    // Настройки пересылки
    bridge: {
        // Максимальная длина сообщения
        maxMessageLength: 4096,

        // Настройки очереди
        queue: {
            // Интервал отправки сообщений из очереди (мс)
            interval: 1000,
            // Максимальное количество сообщений за интервал
            maxPerInterval: 20
        },

        // Поддерживаемые типы медиа
        supportedMedia: [
            'photo', 'video', 'document',
            'audio', 'voice', 'video_note'
        ]
    }
};