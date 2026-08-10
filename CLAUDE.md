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
Весь бэкенд — один файл `server/index.js`. Express.js, файловое хранилище (JSON), без БД.

Основные зоны в файле:
- Слой хранилища: кэш в памяти + дебаунс-запись, атомарно (tmp+rename), ротация `.bak1/.bak2`,
  автовосстановление повреждённого JSON. Флаш на SIGINT/SIGTERM/exit.
- Шифрование (AES-256-GCM), ключ выводится из пароля и живёт только в памяти
  (`Map<userId, keyBuffer>`). Ключа нет → `requireUser` отдаёт 401 `NEED_UNLOCK`,
  фронт просит пароль (`/api/auth/unlock`). Смена пароля (`/api/auth/password`)
  перешифровывает все данные пользователя.
- JWT-аутентификация (90 дней, persistent `.jwtsecret`)
- API: `/api/auth/*`, `/api/characters/*`, `/api/chats/*`, `/api/settings`,
  `/api/chat/stream`, `/api/provider/test`, `/api/models`, `/api/local/detect`,
  `/api/backup`, `/api/restore`, `/api/netinfo`
- Прокси до Chub.AI (`/api/chub/*`) и переводчик (MyMemory)

Данные: `data/*.json` + `data/avatars/` (картинки лежат файлами, в JSON только путь).

Шифруются (префикс `enc:`): API-ключи, системные промты и описания **приватных**
персонажей, контент сообщений. Публичные персонажи хранятся открыто — иначе их
не смогли бы прочитать другие пользователи.

### Frontend
Vanilla JS, без фреймворков и без сборщика. `public/js/` — модули-синглтоны с методами `init()` / `render()` / `load()`.

Ключевые модули:
- `util.js` — `esc/escAttr/escJs` (экранирование обязательно: имена персонажей
  приходят с Chub.AI) и `humanError()` — маппинг ошибок провайдера в понятный текст
- `app.js` — роутинг между views (`home`, `chat`, `discover`, `settings`), модалка разблокировки
- `chat.js` — стриминг через `ReadableStream` (SSE от `/api/chat/stream`), черновики, «Стоп»
- `wizard.js` — визард первого запуска с реальной проверкой подключения
- `characters.js` + `charwizard.js` — управление и импорт персонажей
- `discover.js` — поиск по Chub.AI
- `settings.js` + `modelloader.js` — сервисы и параметры модели
- `qr.js` — автономный генератор QR (версии 1–6, уровень M), без внешних зависимостей
- `passkey.js` — вход/разблокировка по Windows Hello / Touch ID через WebAuthn PRF;
  пароль оборачивается локальным секретом устройства, сервер об этом не знает
- `i18n.js` — все пользовательские строки; язык по умолчанию берётся из системного

### LLM Providers
Поддерживаются: OpenAI, OpenRouter, Anthropic, VseGPT, Ollama, LM Studio, Groq, Together AI, Mistral, DeepSeek, Cohere, xAI, Custom.
Добавить нового провайдера — дописать объект в массив `API_PRESETS` в `server/index.js`.

### LLM dialects
По умолчанию всё идёт в `${baseUrl}/chat/completions` с `Authorization: Bearer`.
Anthropic говорит иначе — `/v1/messages`, заголовок `x-api-key`, отдельное поле
`system` и свой формат SSE; за это отвечают `buildUpstream()` и `anthropicToOpenAI()`
в `server/index.js`. Новый провайдер с другим протоколом добавляется туда же.

### Startup
При каждом старте сервер: генерирует/загружает JWT-секрет, чистит битые записи персонажей,
мигрирует plaintext-пароли в bcrypt, выносит base64-картинки из JSON в `data/avatars/`,
форсит DNS 8.8.8.8 (для Docker/WSL/VPN). Если порт занят — берёт следующий свободный.

### Сборка в один файл (pkg)
`npm run build` собирает `server/index.js` + `public/**` в исполняемые файлы под
Windows/macOS/Linux через `@yao-pkg/pkg` (см. `.github/workflows/build.yml` — реальные
релизы собираются там). Внутри упакованного бинарника код лежит в read-only снапшоте,
поэтому все пути к пользовательским данным (`APP_ROOT` в `server/index.js`) переключаются
на папку рядом с exe через `process.pkg`, а не на `__dirname`.

`package.json` жёстко фиксирует `@yao-pkg/pkg-fetch` на `3.5.34` через `overrides` —
версии `3.6.x` вычисляют номер релиза `v3.6`, которого в `yao-pkg/pkg-fetch` на GitHub
никогда не публиковали, и сборка молча уходит в компиляцию Node из исходников
(десятки минут). Не снимать оверрайд без проверки, что актуальная версия `pkg-fetch`
действительно имеет опубликованный релиз с этим номером.
