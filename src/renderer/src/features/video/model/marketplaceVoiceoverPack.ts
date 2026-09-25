import type { VoiceoverSession } from './voiceoverSession';
import { emptyVoiceoverSession } from './voiceoverSession';

export interface MarketplaceScenarioBlock {
  id: string;
  code: string;
  title: string;
  titleRu: string;
  startSec: number;
  endSec: number;
  visualCue: string;
  /** What to record. The spoken line lives in voiceoverRu. */
  shootRu: string;
  voiceoverRu: string;
  voiceoverEn: string;
}

export const MARKETPLACE_V0_BLOCKS: MarketplaceScenarioBlock[] = [
  {
    id: 'block-a',
    code: 'A',
    title: 'Intro & 3D Storefront',
    titleRu: 'Что это',
    startSec: 0,
    endSec: 35,
    visualCue: 'Title card 3s: Angular 3D Ecommerce. Cut to homepage (Light), slow pan over Product Stage; orbit one model once.',
    shootRu: 'Титр 3 секунды: Angular 3D Ecommerce. Дальше главная в теме Light: медленно пройти Product Stage и один раз покрутить модель. Не уходить в каталог.',
    voiceoverRu: 'Это Angular 3D Ecommerce — полноценный full-stack шаблон интернет-магазина: витрина на Angular 17, API на NestJS, PostgreSQL, админка и интерактивный 3D-просмотр товаров на Three.js. Не лендинг-заглушка, а рабочий стартер под кастом и деплой — для агентств и команд, которым нужна 3D-примерка обуви, сумок, мебели или коллекционных товаров.',
    voiceoverEn: 'This is Angular 3D Ecommerce — a complete full-stack storefront starter: Angular 17 frontend, NestJS API, PostgreSQL, admin dashboard, and interactive Three.js 3D product view. Not a static mockup, but a production-ready starter for agencies and teams selling footwear, bags, furniture, or collectibles.',
  },
  {
    id: 'block-b',
    code: 'B',
    title: 'Themes & Language',
    titleRu: 'Темы и языки',
    startSec: 35,
    endSec: 65,
    visualCue: 'Theme switch: Light → Dark → Glass (1s each). Language switch: EN → UA → RU in header.',
    shootRu: 'В шапке витрины переключить Light → Dark → Glass, по секунде на тему. Затем язык: EN → UA → RU, чтобы сменились подписи. Админскую Dark Glass здесь не открывать.',
    voiceoverRu: 'Дизайн на токенах: четыре темы. На витрине — Light, Dark и Glass; в админке к ним добавляется Dark Glass. Переключение сразу, без зашитых цветов в компонентах. Языки из коробки: английский, украинский и русский.',
    voiceoverEn: 'Built on design tokens: four themes. Storefront uses Light, Dark, and Glass; admin adds Dark Glass. Switching is instant, with no hardcoded component colors. Languages out of the box: English, Ukrainian, and Russian.',
  },
  {
    id: 'block-c',
    code: 'C',
    title: 'Catalog & 3D PDP',
    titleRu: 'Каталог и 3D',
    startSec: 65,
    endSec: 115,
    visualCue: 'Open Shop, scroll grid. Open PDP with GLB: toggle image ↔ 3D, drag orbit, zoom. Scroll to tabs & similar products.',
    shootRu: 'Открыть Shop, прокрутить сетку и один фильтр. Зайти в товар с GLB: переключить фото ↔ 3D, покрутить и приблизить. Доскроллить до вкладок и похожих товаров. Избранное — один клик, без долгого списка.',
    voiceoverRu: 'Каталог, фильтры, карточки и карточка товара в духе современных маркетплейсов. Главная фишка — Three.js: покупатель крутит GLB-модель прямо на странице. Есть бандл демо-моделей, чтобы шаблон работал сразу после установки. Похожие товары и избранное уже вшиты в сценарий витрины.',
    voiceoverEn: 'Catalog, filters, product cards, and a modern marketplace PDP. The signature feature is Three.js: customers orbit and zoom GLB 3D models right in the browser. Includes a starter 3D model bundle so it works immediately after install. Related items and wishlist are already wired in.',
  },
  {
    id: 'block-d',
    code: 'D',
    title: 'Cart & Checkout',
    titleRu: 'Корзина и заказ',
    startSec: 115,
    endSec: 145,
    visualCue: 'Add to cart from PDP or Product Stage → cart modal with line item. Checkout page: highlight Stripe & payment method list.',
    shootRu: 'Добавить товар в корзину с карточки или Product Stage. Открыть корзину с позицией. На оформлении показать Stripe и список методов. PayPal только если на экране видно, что это mock. Ключи и секреты не показывать.',
    voiceoverRu: 'Корзина, избранное, оформление заказа. Stripe подключён по-настоящему — ключи задаются в админке. LiqPay готов для региональных платежей. PayPal в интерфейсе есть, но в режиме mock — это честно подписано, без ложных обещаний live API.',
    voiceoverEn: 'Cart, wishlist, and frictionless checkout. Real Stripe integration — keys configured directly in the admin. LiqPay ready for regional payments. PayPal is present in the UI as a clear mock, with honest labeling and no fake live promises.',
  },
  {
    id: 'block-e',
    code: 'E',
    title: 'Admin: Dashboard & Catalog',
    titleRu: 'Админка',
    startSec: 145,
    endSec: 190,
    visualCue: '/admin/login → dashboard with KPIs. Products list → open edit form. Show fields: name locales, price, stock, category.',
    shootRu: 'Войти в /admin/login, не зачитывать пароль. Дашборд: цифры заказов и выручки, без долгого стояния. Список товаров → форма: названия на языках, цена, остаток, категория. Заказы и пользователи — по одному экрану.',
    voiceoverRu: 'Админка на JWT: дашборд, товары, заказы, пользователи. Создаёте и редактируете каталог, статусы заказов и доступы. Это не «статичный HTML-тема», а связка витрины с NestJS API — со Swagger-документацией по адресу api slash docs.',
    voiceoverEn: 'JWT-secured admin dashboard: products, orders, and user management. Create and update your catalog, order statuses, and permissions. Not a static theme, but a real NestJS API backend with complete Swagger documentation at api slash docs.',
  },
  {
    id: 'block-f',
    code: 'F',
    title: 'Media: Remove.bg & 3D GLB',
    titleRu: 'Фото и 3D',
    startSec: 190,
    endSec: 240,
    visualCue: 'In product form: upload image → toggle Remove background → process. Upload/attach GLB zone → save → show on storefront.',
    shootRu: 'В форме товара: загрузить фото и включить удаление фона, если ключ Remove.bg есть. Если ключа нет — показать переключатель и сказать, что без ключа фон не снимается. Затем зона GLB, сохранить и сразу открыть этот товар на витрине.',
    voiceoverRu: 'Загрузка медиа прямо из админки. Для фото можно включить удаление фона через Remove.bg и оптимизацию — удобно для витрины fashion и аксессуаров. Отдельно — загрузка 3D-моделей GLB: модель сразу появляется у товара на витрине. Есть опциональный Cloudinary и экспериментальная AI-генерация 3D по ключам провайдера — Tripo и другие; без ваших ключей это не «магия из коробки», а готовый каркас интеграций.',
    voiceoverEn: 'Direct media management in the admin. For photos, toggle Remove.bg background removal and optimization — perfect for apparel and accessory catalogs. Upload GLB 3D models and they instantly render on the storefront. Ready-to-wire integrations for Cloudinary and AI 3D providers like Tripo.',
  },
  {
    id: 'block-g',
    code: 'G',
    title: 'CMS Sections & SEO',
    titleRu: 'Конструктор',
    startSec: 240,
    endSec: 275,
    visualCue: 'Admin → Sections: disable/enable Product Stage, refresh home. SEO and integrations settings masked.',
    shootRu: 'Админка → секции: выключить Product Stage, обновить главную, включить обратно. SEO и интеграции открыть так, чтобы ключи были скрыты или замазаны.',
    voiceoverRu: 'Секции и страницы управляются из CMS: герои, Product Stage, сетки, FAQ и другие блоки. Можно собрать витрину под бренд без правки ядра. Плюс SEO-настройки и централизованные интеграции — платежи, почта, ключи AI — в одном месте.',
    voiceoverEn: 'Dynamic CMS section management: Hero banners, Product Stage, feature grids, and FAQ blocks. Customize your storefront layout without editing code. Plus SEO controls and centralized integration keys for payments, email, and AI tools in one unified panel.',
  },
  {
    id: 'block-h',
    code: 'H',
    title: 'Stack, Docker & CTA',
    titleRu: 'Стек и финал',
    startSec: 275,
    endSec: 310,
    visualCue: '5s terminal montage: npm start or docker compose up. Open docs hub. End card with feature bullets and support email.',
    shootRu: 'Коротко терминал: docker compose up или npm start, без прокрутки секретов в .env. Открыть docs/client. Финальный титр: Angular 17, NestJS, PostgreSQL, Three.js, Stripe. Ссылку на демо не выдумывать, если её ещё нет.',
    voiceoverRu: 'Стек: Angular 17, NestJS 10, PostgreSQL, TypeORM, Docker Compose, путь SSR. В комплекте документация для покупателя, демо-ассеты и честный список возможностей. Angular 3D Ecommerce — берите, кастомизируйте, деплойте. Ссылки на демо и документацию — в описании товара.',
    voiceoverEn: 'Modern tech stack: Angular 17, NestJS 10, PostgreSQL, TypeORM, and Docker Compose with SSR readiness. Complete buyer documentation, demo assets, and honest feature specs included. Angular 3D Ecommerce — build, customize, and ship faster. Links in description.',
  },
];

export const MARKETPLACE_PROJECT_BRIEF = `Angular 3D Ecommerce — full-stack Angular 17 + NestJS + Three.js
Audience: CodeCanyon / Gumroad buyers (agencies, freelancers).
Key selling points:
1. Full-stack starter: Angular 17 storefront, NestJS API, PostgreSQL, JWT admin dashboard.
2. Interactive Three.js: Customers orbit, drag, and zoom 3D GLB models directly on the PDP and Product Stage.
3. 4 visual themes: Light, Dark, Glass on the storefront; Dark Glass in admin. Languages: EN, UA, RU.
4. Real Stripe checkout + LiqPay regional payments + transparent PayPal mock.
5. Admin media suite: automatic background removal via Remove.bg, GLB uploads, CMS section management.
6. Docker Compose, SSR path, full Swagger API docs.`;

export const MARKETPLACE_BRIEF_RU = `Angular 3D Ecommerce — магазин на Angular 17, API на NestJS, PostgreSQL и 3D на Three.js.
Для кого: покупатели на CodeCanyon и Gumroad, агентства и фрилансеры.
Что показать:
1. Это не лендинг: витрина, каталог, карточка, корзина, заказы и админка.
2. Покупатель крутит GLB на карточке и на Product Stage. Демо-модели уже в комплекте.
3. Темы витрины: Light, Dark, Glass. В админке ещё Dark Glass. Языки: EN, UA, RU.
4. Stripe боевой, LiqPay для региона, PayPal в интерфейсе помечен как mock.
5. В админке: дашборд, товары, заказы, пользователи, секции витрины, SEO.
6. Фото с удалением фона через Remove.bg по ключу, загрузка GLB, Docker Compose и документация.
Секреты, ключи и .env в кадре не показывать.`;

export function marketplaceVoiceoverSession(): VoiceoverSession {
  return {
    ...emptyVoiceoverSession(),
    projectContext: MARKETPLACE_BRIEF_RU,
    scriptPrompt: 'Демо Angular 3D Ecommerce для маркетплейса',
    status: 'scripted',
    script: {
      segments: MARKETPLACE_V0_BLOCKS.map((block) => ({
        start_sec: block.startSec,
        end_sec: block.endSec,
        text: block.voiceoverRu,
        role: block.code === 'A' ? 'hook' : block.code === 'H' ? 'cta' : 'body',
        purpose: block.titleRu,
        visual_summary: block.shootRu,
        speak: true,
        window_sec: block.endSec - block.startSec,
        target_words: Math.round(((block.endSec - block.startSec) / 60) * 130 * 0.75),
      })),
      meta: {
        tone: 'commercial',
        language: 'ru',
        words_per_min: 130,
        provider: 'preset',
        model: 'preset:marketplace_v0',
      },
    },
  };
}
