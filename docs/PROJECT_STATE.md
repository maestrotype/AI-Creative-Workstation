# Project State & Handoff
> **Purpose:** This document is the single source of truth for the current development state, recent changes, and immediate next steps. It is designed to be read by AI agents to quickly gain context without traversing Git logs.

## Current Focus
**Branch:** `feat/triposr-3d-sidecar` (and related studio/3D/video work)
**Living plans:** Video + local TTS (not LTX/Wan yet) — [VIDEO_STUDIO_PLAN.md](product/VIDEO_STUDIO_PLAN.md). Revise that file as capabilities and goals change.

**Goal:** Keep product docs aligned with what the Electron + sidecar app actually does.

## Recently Completed
- [x] Initial React + Vite architecture setup with CSS modules.
- [x] Application routing layout (`Shell`, `SideNavigation`).
- [x] `HomePage` baseline (Hero section, `IntentInput` for Quick Create).
- [x] `RecentAssets` component and `homeStore` Zustand integration.
- [x] Basic mock API (`assetApi.ts`) for assets.
- [x] **Data Separation:** Split the mock API and Zustand store state into `Projects` (for "Continue Working") and `Assets` (for "Recent").
- [x] **Continue Working Component:** Build the UI to display recent projects.
- [x] **Inspiration Component:** Build a gallery of curated generation examples.
- [x] **Integrate into HomePage:** Update `HomePage.tsx` to render all sections in the correct order.
- [x] **CreatePage Implementation:** Built the core generation flow (`intent` → `generating` → `result`) with a robust Zustand state machine and realistic mock progress. Resulting mock images now correctly appear in the `HomePage`'s recent assets!
- [x] **Мультиязычность (i18n)**: Установлен `i18next`, переведены все основные страницы и боковое меню на английский и русский языки. На странице `Settings` добавлен переключатель языков.
- [x] **Базовые заглушки экранов**: Сверстаны структурные макеты для `ProjectsPage`, `AssetsPage`, `StudioPage` и `SettingsPage`.

- [x] **Electron Shell**: Настройка Electron и интеграция Vite (через `electron-vite`). Приложение теперь работает как нативное десктопное.
- [x] **Python Sidecar**: Создан Python-процесс на FastAPI для оркестрации инференса. Установлены библиотеки `mlx` и `mlx-lm`. Написан моковый эндпоинт генерации.

## Immediate Next Steps (Pending)
- [x] **База Данных**: Интеграция `better-sqlite3` и `drizzle-orm` в Main-процесс Electron.
- [x] **Studio Page (Менеджер моделей)**: Создание интерфейса для скачивания/подключения локальных моделей (как в LM Studio).
- [x] Connect `Inspiration` click handler to transition to the `CreatePage` автоматически.

## What's Next?
- [x] Подключить реальную Python-генерацию на MLX (через `diffusers` / `mps`) к `CreatePage`.
- [x] Зарегистрировать `asset://` протокол в Electron для отображения сгенерированных локальных картинок в React-компонентах.

## Known Issues / Technical Debt
- `IntentInput` attach button is wired but not yet fully functional (needs file picker logic).
- Обработка ошибок загрузки весов в MLX требует более изящного UI/UX.
