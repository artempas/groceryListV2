# Grocery List App — Design Spec

**Date:** 2026-06-17  
**Status:** Approved

---

## Overview

Мобильное PWA-приложение для составления списков покупок. Каждый пользователь имеет несколько личных списков, каждый список содержит элементы с метаданными о создании и вычёркивании. Архитектура рассчитана на будущее добавление: шаринг списков между пользователями, MCP-сервер, определение категорий товаров через embeddings.

---

## Stack

| Слой | Технология |
|------|-----------|
| Full-stack фреймворк | Next.js 14 (App Router) |
| ORM | Prisma |
| База данных | PostgreSQL + pgvector |
| Аутентификация | bcrypt + JWT (httpOnly cookie, 7 дней) |
| Стили | Tailwind CSS |
| PWA | next-pwa |
| Клиентское состояние | TanStack Query (React Query) |
| Деплой | Docker Compose + Nginx (VPS) |

---

## Структура проекта

```
groceryListV2/
├── app/
│   ├── (auth)/           — страницы /login, /register
│   ├── (app)/            — защищённые страницы /, /lists/:id
│   └── api/              — API Routes
│       ├── auth/         — register, login, logout, me
│       └── lists/        — CRUD списков и элементов
├── components/           — UI компоненты
├── lib/
│   ├── prisma.ts         — Prisma client singleton
│   └── auth.ts           — JWT helpers (sign, verify, cookie)
├── middleware.ts         — защита роутов: редирект на /login если нет валидного cookie
├── prisma/
│   ├── schema.prisma
│   └── migrations/
└── public/
    ├── manifest.json
    └── icons/            — иконки PWA
```

---

## Модель данных (Prisma)

```prisma
model User {
  id           String   @id @default(cuid())
  email        String   @unique
  passwordHash String
  name         String
  createdAt    DateTime @default(now())

  lists        List[]
  createdItems ListItem[] @relation("ItemCreatedBy")
  checkedItems ListItem[] @relation("ItemCheckedBy")
}

model List {
  id        String   @id @default(cuid())
  name      String
  owner     User     @relation(fields: [ownerId], references: [id])
  ownerId   String
  createdAt DateTime @default(now())

  items     ListItem[]  // onDelete: Cascade — удаление списка удаляет все его элементы
  // future: shares ListShare[]
}

model ListItem {
  id          String    @id @default(cuid())
  name        String
  list        List      @relation(fields: [listId], references: [id])
  listId      String
  createdBy   User      @relation("ItemCreatedBy", fields: [createdById], references: [id])
  createdById String
  createdAt   DateTime  @default(now())
  checkedAt   DateTime?
  checkedBy   User?     @relation("ItemCheckedBy", fields: [checkedById], references: [id])
  checkedById String?
}
```

`checkedAt` / `checkedById` — оба null пока элемент не вычеркнут, устанавливаются вместе. Снятие отметки сбрасывает оба в null.

---

## API Routes

### Аутентификация

| Метод | Путь | Описание |
|-------|------|----------|
| POST | `/api/auth/register` | Регистрация: `{ name, email, password }` |
| POST | `/api/auth/login` | Вход: `{ email, password }` → устанавливает cookie |
| POST | `/api/auth/logout` | Выход: сбрасывает cookie |
| GET | `/api/auth/me` | Текущий пользователь (из cookie) |

### Списки

| Метод | Путь | Описание |
|-------|------|----------|
| GET | `/api/lists` | Все списки текущего пользователя |
| POST | `/api/lists` | Создать список: `{ name }` |
| PATCH | `/api/lists/:id` | Переименовать: `{ name }` |
| DELETE | `/api/lists/:id` | Удалить список со всеми элементами |

### Элементы

| Метод | Путь | Описание |
|-------|------|----------|
| GET | `/api/lists/:id/items` | Все элементы списка |
| POST | `/api/lists/:id/items` | Добавить элемент: `{ name }` |
| PATCH | `/api/lists/:id/items/:itemId` | Вычеркнуть / снять отметку: `{ checked: boolean }` |
| DELETE | `/api/lists/:id/items/:itemId` | Удалить элемент |

**Авторизация:** Все защищённые эндпоинты читают JWT из httpOnly cookie.  
- `401` — токен отсутствует или невалиден  
- `403` — попытка обратиться к чужому списку

---

## Фронтенд

### Страницы

| Путь | Описание |
|------|----------|
| `/login` | Форма входа |
| `/register` | Форма регистрации |
| `/` | Все списки пользователя (карточки) |
| `/lists/:id` | Конкретный список с элементами |

### UX

- **Главная:** карточки списков, кнопка "+" снизу для создания нового списка
- **Страница списка:** элементы с чекбоксом; вычеркнутые уходят вниз и отображаются зачёркнутыми; поле ввода нового товара закреплено снизу экрана (как в мессенджерах)
- **Удаление элемента:** свайп влево
- **Состояние:** оптимистичные обновления через TanStack Query — чекбокс реагирует мгновенно без ожидания ответа сервера

### PWA

- `public/manifest.json` — `display: standalone`, иконки, цветовая тема
- Service worker через `next-pwa` — кэширование статики для оффлайн-работы
- Мета-теги `apple-mobile-web-app-capable` для iOS

---

## Деплой (VPS)

```yaml
# docker-compose.yml
services:
  app:
    build: .
    environment:
      DATABASE_URL: postgres://...
      JWT_SECRET: ...
    depends_on: [db]

  db:
    image: pgvector/pgvector:pg16
    volumes:
      - pgdata:/var/lib/postgresql/data

  nginx:
    image: nginx
    ports: ["80:80", "443:443"]
```

Nginx проксирует весь трафик на Next.js контейнер и отдаёт SSL-сертификаты (Let's Encrypt).

---

## Out of Scope (MVP)

- Шаринг списков между пользователями — архитектура готова, реализация позже
- MCP-сервер — отдельный пакет в монорепо, добавляется позже
- Категории товаров через embeddings — pgvector уже в стеке, логика добавляется позже
- Push-уведомления
