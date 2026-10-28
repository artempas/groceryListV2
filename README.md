This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## Категоризация товаров

Товары автоматически распределяются по категориям через эмбеддинги OpenRouter.

Переменные окружения:

- `OPENROUTER_API_KEY` — ключ OpenRouter (обязателен для категоризации).
- `OPENROUTER_EMBEDDING_MODEL` — модель эмбеддингов (по умолчанию `openai/text-embedding-3-small`).
- `OPENROUTER_PROXY_URL` — URL HTTP(S)-прокси (`http://user:pass@host:port`), через который направляются запросы к OpenRouter. Нужен, если `openrouter.ai` недоступен напрямую из продакшн-сети. Если не задан, используется `HTTPS_PROXY`/`https_proxy`, если они установлены.
- `CATEGORY_MATCH_THRESHOLD` — минимальная косинусная близость для присвоения категории (по умолчанию `0.30`).

Векторы категорий предвычислены в `lib/category-vectors.json`. Перегенерировать
после изменения списка категорий или модели:

```bash
npx tsx scripts/build-category-embeddings.ts
```

## Вход через SSO (OpenID Connect / Authentik)

Помимо входа по паролю можно включить вход через любой OIDC-провайдер. На
странице входа появится кнопка «Войти через …».

Настройка в Authentik:

1. **Applications → Providers → Create → OAuth2/OpenID Provider**.
   - Client type: **Confidential**.
   - Redirect URIs: `https://<ваш-домен>/api/auth/oidc/callback` (strict).
   - Signing Key: любой сертификат (например, `authentik Self-signed Certificate`).
     Без ключа токены подписываются client secret (HS256) — это тоже поддерживается.
   - Scopes: `openid`, `email`, `profile` (по умолчанию).
2. **Applications → Create**, привяжите к нему провайдер. Slug приложения
   входит в issuer URL. Кто может входить — настраивается политиками/группами
   на приложении в Authentik.
3. Задайте переменные окружения:

- `APP_URL` — публичный адрес приложения (`https://grocery.example.com`), из него
  строится redirect URI. Если не задан, используется origin запроса, что за
  reverse-proxy может оказаться внутренним адресом.
- `OIDC_ISSUER` — OpenID Configuration Issuer из провайдера,
  например `https://auth.example.com/application/o/grocery/`.
- `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` — из провайдера.
- `OIDC_PROVIDER_NAME` — подпись на кнопке (по умолчанию `SSO`).
- `OIDC_SCOPES` — запрашиваемые scopes (по умолчанию `openid email profile`).
- `OIDC_TRUST_EMAIL` — `true`, чтобы считать email от провайдера подтверждённым,
  даже если `email_verified` не равен `true`.

Как сопоставляются аккаунты:

- при первом входе через SSO создаётся новый пользователь без пароля;
- если уже есть аккаунт с тем же email, он привязывается к SSO-идентичности,
  только если провайдер вернул `email_verified: true` (или задан
  `OIDC_TRUST_EMAIL=true`). Иначе вход отклоняется — войдите по паролю;
- дальнейшие входы идут по `sub` провайдера, так что смена email в Authentik
  не ломает вход.
