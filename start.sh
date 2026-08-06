#!/usr/bin/env bash
# Launcher for macOS and Linux. Windows users run start.bat instead.
set -u
cd "$(dirname "$0")"

echo
echo "  =========================================="
echo "    wesaid"
echo "  =========================================="
echo

# ── Node.js check ───────────────────────────────────────────────────────────
if ! command -v node >/dev/null 2>&1; then
  echo "  Для работы нужен Node.js — он не установлен."
  echo
  if command -v brew >/dev/null 2>&1; then
    echo "  Установить можно так:   brew install node"
  elif command -v apt >/dev/null 2>&1; then
    echo "  Установить можно так:   sudo apt install nodejs npm"
  else
    echo "  Скачайте его здесь:     https://nodejs.org  (версия LTS)"
  fi
  echo
  exit 1
fi

NODE_MAJOR="$(node -v | sed 's/^v//' | cut -d. -f1)"
if [ "$NODE_MAJOR" -lt 18 ]; then
  echo "  [!] Установлен Node.js $(node -v), а нужен 18 или новее."
  echo "      Обновите его: https://nodejs.org"
  echo
  exit 1
fi

echo "  Node.js $(node -v) — подходит"
echo

# ── Dependencies ────────────────────────────────────────────────────────────
if [ ! -d node_modules ]; then
  echo "  Первый запуск: скачиваю необходимые файлы."
  echo "  Это займёт около минуты, нужен интернет."
  echo
  if ! npm install --no-audit --no-fund; then
    echo
    echo "  [!] Не удалось скачать файлы. Проверьте интернет и попробуйте снова."
    echo
    exit 1
  fi
  echo
fi

# Open the browser once the server actually answers, not after a fixed delay.
(
  for _ in $(seq 1 60); do
    if curl -s -o /dev/null http://localhost:3000 2>/dev/null; then
      if command -v open >/dev/null 2>&1; then open http://localhost:3000
      elif command -v xdg-open >/dev/null 2>&1; then xdg-open http://localhost:3000 >/dev/null 2>&1
      fi
      break
    fi
    sleep 1
  done
) &

exec node server/index.js
