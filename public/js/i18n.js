// ─── i18n - Internationalization ──────────────────────────────────────────────
const STRINGS = {
  ru: {
    // Auth
    'auth.login': 'Войти', 'auth.register': 'Создать аккаунт',
    'auth.username': 'Имя пользователя', 'auth.password': 'Пароль',
    'auth.displayName': 'Отображаемое имя', 'auth.local': 'Только локально — данные хранятся на вашем ПК 🔒',
    'auth.signing': 'Входим...', 'auth.creating': 'Создаём...', 'auth.tagline': 'Ваш локальный AI-компаньон',
    // Nav
    'nav.home': 'Главная', 'nav.discover': 'Открыть', 'nav.create': 'Создать', 'nav.account': 'Профиль', 'nav.settings': 'Настройки',
    // Home
    'home.welcome': 'С возвращением', 'home.subtitle': 'Продолжите или начните новый диалог',
    'home.new': 'Новый персонаж', 'home.recent': 'Недавние чаты',
    // Characters
    'char.create': 'Новый персонаж', 'char.edit': 'Редактировать персонажа',
    'char.name': 'Имя *', 'char.desc': 'Краткое описание', 'char.system': 'Системный промпт',
    'char.greetings': 'Первые сообщения', 'char.greetings.hint': 'Одно из них выбирается случайно при старте чата. До 50 штук.',
    'char.addGreeting': '+ Добавить приветствие', 'char.visibility': 'Видимость',
    'char.private': 'Приватный', 'char.public': 'Публичный',
    'char.private.desc': 'Только вы', 'char.public.desc': 'Видят все',
    'char.import': 'Импорт', 'char.import.hint': 'PNG карточки Chub.ai или JSON',
    'char.save': 'Сохранить', 'char.cancel': 'Отмена', 'char.delete': 'Удалить',
    'char.avatar': 'Загрузить', 'char.avatar.hint': 'PNG/JPG или эмодзи',
    'char.system.hint': 'Описание характера. {{char}} = имя персонажа, {{user}} = ваше имя',
    'char.empty': 'Нет персонажей', 'char.empty.hint': 'Создайте первого или импортируйте с Chub.ai',
    // Chat
    'chat.clear': 'Очистить чат', 'chat.delete': 'Удалить чат',
    'chat.input': 'Сообщение...', 'chat.hint': 'Enter — отправить · Shift+Enter — новая строка',
    'chat.online': '● В сети', 'chat.copy': 'Копировать', 'chat.regen': 'Перегенерировать',
    'chat.edit': 'Редактировать', 'chat.no.provider': 'Нет провайдера. Перейдите в Настройки.',
    'chat.empty': 'Выберите персонажа', 'chat.empty.sub': 'и начните разговор',
    // Settings
    'settings.title': 'Настройки', 'settings.providers': 'API Провайдеры', 'settings.model': 'Параметры модели',
    'settings.appearance': 'Внешний вид', 'settings.language': 'Язык', 'settings.app': 'Приложение',
    'settings.add.provider': '+ Добавить провайдер', 'settings.no.providers': 'Провайдеры не настроены',
    'settings.theme': 'Тема', 'settings.theme.dark': 'Тёмная', 'settings.theme.light': 'Светлая',
    'settings.accent': 'Акцентный цвет', 'settings.autoscroll': 'Автопрокрутка',
    'settings.autoscroll.desc': 'Прокручивать вниз при новых сообщениях',
    'settings.animations': 'Анимации', 'settings.animations.desc': 'Анимация сообщений и переходов',
    'settings.sound': 'Звуки', 'settings.sound.desc': 'Звук при получении сообщения',
    // Model params
    'param.temperature': 'Температура', 'param.temperature.low': 'Точно', 'param.temperature.high': 'Творчески',
    'param.maxTokens': 'Макс. токенов', 'param.maxTokens.hint': 'Длина ответа',
    'param.topP': 'Top P', 'param.topK': 'Top K',
    'param.context': 'Контекст (сообщений)', 'param.context.hint': 'Сколько сообщений помнит',
    'param.preset.creative': 'Творческий', 'param.preset.balanced': 'Сбалансированный', 'param.preset.precise': 'Точный',
    'param.global.system': 'Глобальный системный промпт',
    'param.global.system.hint': 'Добавляется ко всем персонажам поверх их системника',
    // Discover
    'discover.title': 'Открыть персонажей', 'discover.subtitle': 'Все доступные персонажи',
    // Profile
    'profile.edit': 'Редактировать профиль', 'profile.displayName': 'Отображаемое имя',
    'profile.username': 'Имя пользователя', 'profile.bio': 'О себе',
    'profile.password': 'Новый пароль', 'profile.save': 'Сохранить',
    'profile.logout': 'Выйти', 'profile.banner': 'Сменить баннер', 'profile.avatar': 'Сменить аватар',
    // Toast
    'toast.saved': 'Сохранено!', 'toast.deleted': 'Удалено', 'toast.copied': 'Скопировано!',
    'toast.imported': 'Импортировано!', 'toast.error': 'Ошибка',
    // Setup
    'setup.title': 'Настройка AI', 'setup.subtitle': 'Подключите любой OpenAI-совместимый провайдер',
    'setup.name': 'Название', 'setup.url': 'Base URL', 'setup.key': 'API Ключ',
    'setup.model': 'Модель', 'setup.save': 'Сохранить и продолжить →',
    'setup.skip': 'Пропустить',
  },
  en: {
    'auth.login': 'Sign In', 'auth.register': 'Create Account',
    'auth.username': 'Username', 'auth.password': 'Password',
    'auth.displayName': 'Display Name', 'auth.local': 'Local only — data stays on your PC 🔒',
    'auth.signing': 'Signing in...', 'auth.creating': 'Creating...', 'auth.tagline': 'Your local AI companion hub',
    'nav.home': 'Home', 'nav.discover': 'Discover', 'nav.create': 'Create', 'nav.account': 'Account', 'nav.settings': 'Settings',
    'home.welcome': 'Welcome back', 'home.subtitle': 'Pick up where you left off or start fresh',
    'home.new': 'New Character', 'home.recent': 'Recent Chats',
    'char.create': 'New Character', 'char.edit': 'Edit Character',
    'char.name': 'Name *', 'char.desc': 'Short description', 'char.system': 'System Prompt',
    'char.greetings': 'First Messages', 'char.greetings.hint': 'One is randomly chosen when starting a chat. Up to 50.',
    'char.addGreeting': '+ Add Greeting', 'char.visibility': 'Visibility',
    'char.private': 'Private', 'char.public': 'Public',
    'char.private.desc': 'Only you', 'char.public.desc': 'Visible to everyone',
    'char.import': 'Import', 'char.import.hint': 'Chub.ai PNG cards or JSON files',
    'char.save': 'Save', 'char.cancel': 'Cancel', 'char.delete': 'Delete',
    'char.avatar': 'Upload', 'char.avatar.hint': 'PNG/JPG or emoji',
    'char.system.hint': 'Personality definition. {{char}} = character name, {{user}} = your name',
    'char.empty': 'No characters yet', 'char.empty.hint': 'Create your first or import from Chub.ai',
    'chat.clear': 'Clear chat', 'chat.delete': 'Delete chat',
    'chat.input': 'Message...', 'chat.hint': 'Enter to send · Shift+Enter for new line',
    'chat.online': '● Online', 'chat.copy': 'Copy', 'chat.regen': 'Regenerate',
    'chat.edit': 'Edit', 'chat.no.provider': 'No provider configured. Go to Settings.',
    'chat.empty': 'Select a character', 'chat.empty.sub': 'to start chatting',
    'settings.title': 'Settings', 'settings.providers': 'API Providers', 'settings.model': 'Model Parameters',
    'settings.appearance': 'Appearance', 'settings.language': 'Language', 'settings.app': 'App',
    'settings.add.provider': '+ Add Provider', 'settings.no.providers': 'No providers configured',
    'settings.theme': 'Theme', 'settings.theme.dark': 'Dark', 'settings.theme.light': 'Light',
    'settings.accent': 'Accent Color', 'settings.autoscroll': 'Auto-scroll',
    'settings.autoscroll.desc': 'Scroll down on new messages',
    'settings.animations': 'Animations', 'settings.animations.desc': 'Message and transition animations',
    'settings.sound': 'Sounds', 'settings.sound.desc': 'Sound on incoming message',
    'param.temperature': 'Temperature', 'param.temperature.low': 'Precise', 'param.temperature.high': 'Creative',
    'param.maxTokens': 'Max Tokens', 'param.maxTokens.hint': 'Response length',
    'param.topP': 'Top P', 'param.topK': 'Top K',
    'param.context': 'Context (messages)', 'param.context.hint': 'How many messages it remembers',
    'param.preset.creative': 'Creative', 'param.preset.balanced': 'Balanced', 'param.preset.precise': 'Precise',
    'param.global.system': 'Global System Prompt',
    'param.global.system.hint': 'Added on top of every character\'s system prompt',
    'discover.title': 'Discover Characters', 'discover.subtitle': 'All available characters',
    'profile.edit': 'Edit Profile', 'profile.displayName': 'Display Name',
    'profile.username': 'Username', 'profile.bio': 'Bio',
    'profile.password': 'New Password', 'profile.save': 'Save',
    'profile.logout': 'Sign Out', 'profile.banner': 'Change Banner', 'profile.avatar': 'Change Avatar',
    'toast.saved': 'Saved!', 'toast.deleted': 'Deleted', 'toast.copied': 'Copied!',
    'toast.imported': 'Imported!', 'toast.error': 'Error',
    'setup.title': 'Configure AI', 'setup.subtitle': 'Connect any OpenAI-compatible API provider',
    'setup.name': 'Name', 'setup.url': 'Base URL', 'setup.key': 'API Key',
    'setup.model': 'Model', 'setup.save': 'Save & Continue →',
    'setup.skip': 'Skip for now',
  }
};

const i18n = {
  lang: localStorage.getItem('tavern_lang') || 'ru',

  t(key) {
    return STRINGS[this.lang]?.[key] || STRINGS['en']?.[key] || key;
  },

  setLang(lang) {
    this.lang = lang;
    localStorage.setItem('tavern_lang', lang);
    document.documentElement.lang = lang;
    // Dispatch event to re-render
    window.dispatchEvent(new CustomEvent('langChange'));
  }
};

// Shorthand
const t = (key) => i18n.t(key);
