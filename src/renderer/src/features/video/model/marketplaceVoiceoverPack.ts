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
  /** Short look label. Plain language, shown in «Вид». */
  viewRu: string;
  /** Recording steps for the person filming. Not spoken. */
  shootRu: string;
  voiceoverRu: string;
  voiceoverEn: string;
}

export const MARKETPLACE_V0_BLOCKS: MarketplaceScenarioBlock[] = [
  {
    id: 'block-a',
    code: 'A',
    title: 'Angular 3D Ecommerce',
    titleRu: 'Что это за продукт',
    startSec: 0,
    endSec: 12,
    viewRu: 'неподвижный скрин',
    visualCue: 'Still of the homepage, no clicks. Title: Angular 3D Ecommerce. Second line: Angular 17 storefront · NestJS API · PostgreSQL · Three.js.',
    shootRu: 'Откройте главную магазина и ничего не нажимайте. Снимите скриншот. На экране титр Angular 3D Ecommerce и вторая строка: Angular 17 storefront · NestJS API · PostgreSQL · Three.js. При склейке приложение само медленно приблизит этот скриншот.',
    voiceoverRu: 'Это готовый интернет-магазин: витрина на Angular 17, API на NestJS, база PostgreSQL, 3D на Three.js. В архиве исходники, Docker Compose и документация. Покупатель поднимает магазин у себя, а не встраивает виджет в чужой сайт.',
    voiceoverEn: 'This is a finished online store: an Angular 17 storefront, a NestJS API, PostgreSQL, and 3D on Three.js. The archive includes the source, Docker Compose, and the docs. The buyer runs the shop on their own machine, not as a widget dropped into someone else’s site.',
  },
  {
    id: 'block-b',
    code: 'B',
    title: 'Homepage Product Stage',
    titleRu: 'Главная и Product Stage',
    startSec: 12,
    endSec: 52,
    viewRu: 'живая запись',
    visualCue: 'Live recording. / or /home, the block under the hero. Do not replace this chapter with a still.',
    shootRu: 'Запись экрана. Страница / или /home, блок под hero. Заголовок блока: Turn it in 3D.\n1. Проведите курсор по hero. 3D у hero выключен — так и оставьте, на камеру не включайте.\n2. Остановитесь на Product Stage. Потяните модель влево-вправо и вверх. Колёсико здесь не приближает: так задумано, чтобы страница не застревала. Покажите поворот модели.\n3. Справа внизу нажмите другую миниатюру. Модель сменится с сумки на кроссовок или наоборот. Рядом должны быть имя, цена, Add to cart и View details.\n4. Нажмите View details и перейдите на карточку товара.\nФутер не листайте и меню не открывайте.',
    voiceoverRu: 'На главной не слайдер картинок, а сцена каталога. Покупатель крутит модель сумки или кроссовка и переключает товары миниатюрами. Сцена берёт GLB из карточек: Saddle Crossbody, Weekend Tote, Court Runner, City Loafer. Те же файлы лежат в комплекте, магазин открывается без своего 3D-художника. Кнопка ведёт на обычную карточку товара.',
    voiceoverEn: 'The homepage is not a picture slider. It is a catalog stage. A shopper turns a bag or a sneaker and switches products with the thumbnails. The stage reads the GLB from the product cards: Saddle Crossbody, Weekend Tote, Court Runner, and City Loafer. Those files ship in the package, so the store opens without a 3D artist. The button goes to a normal product page.',
  },
  {
    id: 'block-c',
    code: 'C',
    title: 'Light · Dark · Aurora',
    titleRu: 'Темы и языки',
    startSec: 52,
    endSec: 78,
    viewRu: 'живая запись',
    visualCue: 'Stay on the storefront header. Themes on the storefront are Light, Dark, Aurora.',
    shootRu: 'Останьтесь на витрине, шапка справа.\n1. Откройте переключатель темы. На витрине только Light, Dark и Aurora.\n2. Переключите Light, затем Dark, затем Aurora. После каждого переключения подождите около секунды, чтобы был виден фон.\n3. Верните Light или оставьте Aurora — как ровнее смотрится модель.\n4. Откройте язык и переключите EN на UA или RU. Дождитесь, пока шапка и заголовок сменят язык. До конца ролика верните EN.\nАдминку здесь не открывайте.',
    voiceoverRu: 'Три темы витрины: светлая, тёмная и Aurora. Цвета собраны токенами, отдельные экраны перекрашивать не нужно. Рядом языки: английский, украинский и русский, строки лежат в файлах переводов. Тема витрины и тема админки запоминаются отдельно.',
    voiceoverEn: 'Three storefront themes: light, dark, and Aurora. The colors are tokens, so individual screens do not need a repaint. Next to that, English, Ukrainian, and Russian, with the strings in translation files. The storefront theme and the admin theme are remembered separately.',
  },
  {
    id: 'block-d',
    code: 'D',
    title: 'Catalog and product page',
    titleRu: 'Каталог и карточка',
    startSec: 78,
    endSec: 120,
    viewRu: 'живая запись',
    visualCue: 'Shop, then Court Runner ($129.99, shoes). No 3D on the catalog card.',
    shootRu: 'Меню Shop, затем карточка Court Runner, $129.99, категория shoes.\n1. На /shop покажите сетку. Проведите курсор по карточке: фото, цена, рейтинг, бейдж special, сердце и кнопка в корзину. Модели на карточке нет.\n2. Если виден фильтр категории, выберите Shoes.\n3. Откройте Court Runner. Слева в галерее нажмите миниатюру с бейджем 3D. Большое фото сменится на модель. Потяните её и один раз приблизьте колёсиком.\n4. Нажмите Expand 3D. Откроется полный экран: вкладки Photo и 3D, кнопка назад. Покрутите секунду и вернитесь.\n5. Под фото покажите вкладки Description, Specifications, Delivery и кнопку Add to cart. Размеры EU 38–46 уже заполнены.\nНиже этих вкладок не уходите.',
    voiceoverRu: 'Каталог — обычный магазин: категории, цена, избранное, корзина. 3D не навязывается каждой карточке. Наушники и футболка остаются фотографиями. У обуви и сумок в галерее есть кадр 3D. Покупатель крутит модель рядом с ценой и характеристиками, может открыть её на весь экран и сразу положить товар в корзину. Для обуви, мебели и аксессуаров это и есть причина брать шаблон, а не плоскую витрину.',
    voiceoverEn: 'The catalog is an ordinary shop: categories, price, wishlist, and cart. 3D is not forced onto every card. Headphones and the t-shirt stay photographs. Shoes and bags have a 3D frame in the gallery. The shopper turns the model next to the price and the specs, can open it full screen, and can put the product in the cart. For shoes, furniture, and accessories, that is the reason to take this template instead of a flat storefront.',
  },
  {
    id: 'block-e',
    code: 'E',
    title: 'Cart and checkout',
    titleRu: 'Корзина и оплата',
    startSec: 120,
    endSec: 152,
    viewRu: 'живая запись',
    visualCue: 'Add Court Runner, cart modal, /checkout. Stripe and LiqPay are test-mode. PayPal is mock. Do not enter a real card.',
    shootRu: '1. На карточке Court Runner нажмите Add to cart.\n2. Откройте корзину иконкой в шапке. В окне видны имя, цена, количество и итог. Количество можно изменить один раз.\n3. Перейдите на /checkout. В кадре степпер: корзина, оформление, оплата. Слева итог и бесплатная доставка. Справа введите Demo Buyer и demo@example.com. Настоящий телефон и карту не вводите.\n4. Дойдите до способов оплаты. В кадре должны читаться Stripe, LiqPay и PayPal. Если у PayPal написано demo или mock, эту подпись не закрывайте.\nОплату не завершайте. Если страница просит данные карты, уйдите с неё. Ключи платежей в кадр не попадают.',
    voiceoverRu: 'Дальше обычный магазинный путь: корзина, контакты, доставка, выбор оплаты. Stripe и LiqPay подключаются ключами и в демо работают в тестовом режиме. PayPal в интерфейсе есть, но пока это mock: живой PayPal API появится после Client ID и Secret. В листинге это написано прямо, на видео скрывать не нужно.',
    voiceoverEn: 'Next is the ordinary shop path: cart, contacts, delivery, and a payment choice. Stripe and LiqPay connect with keys and, in the demo, run in test mode. PayPal is in the interface, but it is still a mock: a live PayPal API appears after a Client ID and Secret. The listing says this outright, and the video does not need to hide it.',
  },
  {
    id: 'block-f',
    code: 'F',
    title: 'Admin',
    titleRu: 'Админка',
    startSec: 152,
    endSec: 182,
    viewRu: 'живая запись',
    visualCue: '/admin/dashboard. Password already entered. Themes: Light, Dark, Ice, Ember. Do not open Integrations.',
    shootRu: 'Пароль введите до записи. Страницу входа можно показать пустой одну секунду и сразу оказаться внутри. Поле пароля в кадре не держите.\nОткройте /admin/dashboard.\n1. Покажите карточки товаров, заказов, пользователей, выручки и график. Нулевые заказы — нормально: через 3 секунды идите дальше. Чужие суммы не подставляйте.\n2. Медленно проведите курсор по меню, не открывая каждый пункт: Dashboard, Products, Categories, Orders, Users, Messages, Page sections, Pages, SEO, Payments, Integrations, Settings.\n3. Откройте переключатель темы. Должны быть видны Light, Dark, Ice и Ember. Включите Ember на секунду и верните тему, в которой удобно снимать форму товара.\nIntegrations не открывайте. В Settings не листайте до ключей оплаты.',
    voiceoverRu: 'Админка отдельно от витрины: заказы, товары, категории, пользователи, сообщения, SEO и платежи. Темы админки свои: к светлой и тёмной добавляются Ice и Ember. Ember на витрине не выбирается. Цифры на дашборде считаются из заказов, в чистой установке они пустые, пока не пройдёт первая продажа.',
    voiceoverEn: 'The admin is separate from the storefront: orders, products, categories, users, messages, SEO, and payments. Its themes are its own: light and dark, plus Ice and Ember. Ember cannot be chosen on the storefront. The dashboard numbers come from orders. On a fresh install they stay empty until the first sale.',
  },
  {
    id: 'block-g',
    code: 'G',
    title: 'Photos and GLB',
    titleRu: 'Фото, GLB и AI',
    startSec: 182,
    endSec: 220,
    viewRu: 'живая запись',
    visualCue: 'Products → Court Runner → Edit. Show the attached GLB. Do not run Generate with AI.',
    shootRu: 'Products → Court Runner → Edit. Приблизьте кадр к блоку 3D.\n1. Прокрутите к фото. Наведите курсор на Remove background и Optimize. Новый файл не загружайте. Если своего ключа нет, тумблер не включайте.\n2. Прокрутите к 3D Experience. Модель кроссовка уже крутится — потяните её. Кнопки скачать, заменить и удалить только покажите. Файл с диска не выбирайте.\n3. Покажите кнопку Generate with AI и откройте список: Tripo3D, Meshy, Hunyuan, Luma, Hugging Face и свой webhook. Генерацию не запускайте.',
    voiceoverRu: 'В форме товара два медиаблока. Фото можно оптимизировать и снять фон через Remove.bg, если вставлен свой ключ. Рядом зона GLB: файл перетаскивается с компьютера, до 50 МБ, и сразу крутится в том же просмотрщике, что на витрине. Кнопка AI собирает модель по фото через внешний сервис — Tripo, Meshy, Hunyuan, Luma или бесплатный Hugging Face. Это дополнительная возможность со своим ключом, в ролик генерацию не ставим: она идёт несколько минут и не входит в работу магазина без ключа. Магазин из коробки живёт на готовых GLB.',
    voiceoverEn: 'The product form has two media blocks. Photos can be optimized, and the background can be removed through Remove.bg when the buyer’s own key is set. Next to that is the GLB area: a file is dragged from the computer, up to 50 MB, and it turns in the same viewer as on the storefront. The AI button builds a model from a photo through Tripo, Meshy, Hunyuan, Luma, or free Hugging Face. That is an extra, with the buyer’s own key. This video does not run a generation: it takes several minutes and the shop does not depend on it. Out of the box, the store runs on the included GLB files.',
  },
  {
    id: 'block-h',
    code: 'H',
    title: 'Page sections',
    titleRu: 'Конструктор страниц',
    startSec: 220,
    endSec: 250,
    viewRu: 'живая запись',
    visualCue: '/admin/sections. Desktop then Smartphone. Do not save, do not run Quick Start, do not delete sections.',
    shootRu: 'Откройте /admin/sections.\n1. Покажите список секций главной. Сверху в демо: hero, Product Stage, хиты и категории.\n2. Нажмите превью Desktop, затем Smartphone. Рамка сузится, витрина перерисуется. Планшет и складной экран можно не снимать.\n3. Откройте секцию Product Stage и не сохраняйте. В форме видно, что сцена берёт товары категорий bags, clothing и shoes. Закройте без Save.\nQuick Start не нажимайте и секции не удаляйте. Долгий поворот модели на телефоне не снимайте.',
    voiceoverRu: 'Главная собирается секциями, не правкой шаблона. Секцию можно дублировать, выключить и перетащить. Справа живое превью: десктоп, планшет, телефон и складной экран. Product Stage — одна из секций: в ней выбирается, какие товары каталога крутятся на главной. Есть мастер быстрого старта главной и шаблоны страниц, на видео достаточно списка и превью телефона.',
    voiceoverEn: 'The homepage is built from sections, not by editing the template. A section can be duplicated, turned off, and dragged. On the right is a live preview: desktop, tablet, phone, and a foldable screen. Product Stage is one of those sections: it chooses which catalog products turn on the homepage. There is a homepage quick start and page templates. For the video, the list and the phone preview are enough.',
  },
  {
    id: 'block-i',
    code: 'I',
    title: 'What is in the zip',
    titleRu: 'Что в архиве',
    startSec: 250,
    endSec: 266,
    viewRu: 'неподвижный скрин',
    visualCue: 'Still of the storefront in Aurora, or docs/client/index.html. Four on-screen points, not a paragraph.',
    shootRu: 'Скриншот витрины в теме Aurora или страницы docs/client/index.html. На экране титр What is in the zip и четыре пункта: Source + admin, Demo GLB included, Docker Compose, Stripe and LiqPay. Терминал не показывайте. При склейке приложение само медленно приблизит этот скриншот.',
    voiceoverRu: 'В комплекте исходники Angular и NestJS, демо-фото и два GLB, сид каталога, Docker Compose, Swagger на /api/docs и хаб документации. Лицензия исходников MIT. Покупатель подставляет свои ключи оплаты и при желании ключ AI. Отдельный хостинг базы и живой PayPal в архив не входят.',
    voiceoverEn: 'The package includes the Angular and NestJS source, demo photos and two GLB files, a catalog seed, Docker Compose, Swagger at /api/docs, and the documentation hub. The source license is MIT. The buyer adds their own payment keys and, if they want, an AI key. A separate database host and a live PayPal account are not in the archive.',
  },
];

export const MARKETPLACE_PROJECT_BRIEF = `Angular 3D Ecommerce — screencast of a finished store for CodeCanyon and Gumroad.
The buyer should see the shop, not a slide deck: homepage with Product Stage, catalog, a product page with a GLB, cart, checkout, themes, three languages, and the admin.
Storefront themes are Light, Dark, and Aurora. Admin adds Ice and Ember. There is no Glass theme in the switcher.
3D is not on the catalog card. Orbit lives on the homepage Product Stage, on the product gallery thumbnail marked 3D, and in the full-screen viewer.
Demo GLBs ship in the package: Saddle Crossbody, Weekend Tote, Court Runner, City Loafer. T-shirt, headphones, mat, and mug are photos only.
Stripe and LiqPay are real providers in test mode. PayPal is marked mock until Client ID and Secret. Keys live in Admin → Settings. Payments is a transaction log, not the key form.
Do not run Generate with AI. Do not promise a part-color configurator. Do not show .env, the admin password, or provider keys.`;

export const MARKETPLACE_BRIEF_RU = `Скринкаст Angular 3D Ecommerce для CodeCanyon и Gumroad. Покупатель видит магазин, а не презентацию: главную с Product Stage, каталог, карточку с GLB, корзину, оформление, темы, три языка и админку. В админке — дашборд, форма товара с фото и GLB, конструктор секций с превью телефона. Stripe и LiqPay — реальные провайдеры в тестовом режиме, PayPal показан как mock. Ключи, .env и пароли в кадр не попадают. Демо-модели сумок и обуви уже в комплекте, отдельный 3D-пакет покупателю не нужен.`;

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
        role: block.code === 'A' ? 'hook' : block.code === 'I' ? 'cta' : 'body',
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
