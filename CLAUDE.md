# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm start      # запуск сервера (http://localhost:3000)
npm run dev    # то же самое
```

Нет build-шага — чистый Node.js, никакой компиляции.

## Architecture

**Full-stack SPA** — локальный AI-чат с персонажами. Альтернатива SillyTavern.

### Backend
Весь бэкенд — один файл `server/index.js` (~900 строк). Express.js, файловое хранилище (JSON), без БД.

Основные зоны в файле:
- Шифрование (AES-256-GCM) + ключи в памяти (`Map<userId, keyBuffer>`), не на диске
- JWT-аутентификация (90 дней, persistent `.jwtsecret`)
- API endpoints: `/api/auth/*`, `/api/characters/*`, `/api/chats/*`, `/api/settings`, `/api/chat/stream`
- Прокси до Chub.AI (`/api/chub/*`) и переводчик (MyMemory)

Данные: `data/characters.json` (~28MB), `data/chats.json` (~27MB), `data/users.json`, `data/settings.json`.

Шифруются (префикс `enc:`): API-ключи, системные промты, описания персонажей, контент сообщений.

### Frontend
Vanilla JS, без фреймворков и без сборщика. `public/js/` — модули-синглтоны с методами `init()` / `render()` / `load()`.

Ключевые модули:
- `app.js` — роутинг между views (`home`, `chat`, `discover`, `settings`)
- `chat.js` — стриминг через `ReadableStream` (SSE от `/api/chat/stream`)
- `characters.js` + `charwizard.js` — управление и импорт персонажей
- `discover.js` — поиск по Chub.AI
- `settings.js` + `modelloader.js` — провайдеры и параметры модели
- `i18n.js` — i18n, русский по умолчанию

### LLM Providers
Поддерживаются: OpenAI, OpenRouter, Anthropic, VseGPT, Ollama, LM Studio, Groq, Together AI, Mistral, DeepSeek, Cohere, xAI, Custom.
Добавить нового провайдера — дописать объект в массив `API_PRESETS` в `server/index.js`.

### Startup
При каждом старте сервер: генерирует/загружает JWT-секрет, чистит битые записи персонажей, мигрирует plaintext-пароли в bcrypt, форсит DNS 8.8.8.8 (для Docker/WSL/VPN).
