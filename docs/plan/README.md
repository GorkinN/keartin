# План разработки: локальный генератор постов

Локальное веб-приложение для генерации постов в соцсети (русский язык) на связке RAG + Ollama + Flux.1-dev.

Код пишется **только после OK на текущий этап**. После каждого этапа — отчёт и ожидание подтверждения.

Живые документы (не этот план): [ARCHITECTURE.md](../ARCHITECTURE.md), [DECISIONS.md](../DECISIONS.md).

**Сейчас:** этап 1 принят (стрим Ollama). Следующий код — [этап 2](stages/02-image-gpu.md) (Flux + GpuManager), после OK на его микро-план.

## Как пользоваться этой папкой

1. Прочитать общие разделы (архитектура, решения, риски, регламент).
2. Согласованные решения — в [DECISIONS.md](../DECISIONS.md); черновик обсуждения — [03-decisions.md](03-decisions.md).
3. Перед стартом этапа N открыть его файл в `stages/` и утвердить микро-план.
4. После этапа обновить [docs/ARCHITECTURE.md](../ARCHITECTURE.md) и статус ниже.

## Состав

| Файл | Содержание |
|------|------------|
| [00-overview.md](00-overview.md) | Цель, окружение, стек, продуктовые требования |
| [01-architecture.md](01-architecture.md) | Компоненты, разбиение на сервисы, GpuManager |
| [02-repository.md](02-repository.md) | Дерево монорепо и ключевые файлы |
| [03-decisions.md](03-decisions.md) | Технические решения, требующие согласования (в т.ч. кэш Hugging Face) |
| [04-risks.md](04-risks.md) | Риски и узкие места (12 ГБ VRAM, Windows, RU, HF-кэш) |
| [05-workflow.md](05-workflow.md) | Регламент итераций |
| [stages/00-scaffold.md](stages/00-scaffold.md) | Этап 0. Каркас |
| [stages/01-text-generation.md](stages/01-text-generation.md) | Этап 1. Генерация текста |
| [stages/02-image-gpu.md](stages/02-image-gpu.md) | Этап 2. Flux + GpuManager |
| [stages/03-rag.md](stages/03-rag.md) | Этап 3. RAG |
| [stages/04-pipeline.md](stages/04-pipeline.md) | Этап 4. Полный AI-pipeline |
| [stages/05-nestjs.md](stages/05-nestjs.md) | Этап 5. NestJS-бэкенд |
| [stages/06-frontend.md](stages/06-frontend.md) | Этап 6. Frontend |
| [stages/07-polish.md](stages/07-polish.md) | Этап 7. Полировка |

## Статус этапов

| Этап | Название | Статус |
|------|----------|--------|
| 0 | Каркас проекта | выполнен (2026-09-20) |
| 1 | Локальная генерация текста | выполнен, принят (2026-09-20) |
| 2 | Локальная генерация изображений + GPU | не начат |
| 3 | RAG | не начат |
| 4 | Полный AI-pipeline | не начат |
| 5 | NestJS-бэкенд | не начат |
| 6 | Frontend | не начат |
| 7 | Полировка | не начат |

Горизонт: **8 итераций**, не один вечер. Самые рискованные — этапы 2 (VRAM) и 3 (парсеры).
