# Knowledge Base Workspace

Этот каталог хранит исходные правила оценки, из которых собирается system prompt.

## Как читать

1. [profiles/incidents.json](/Users/denis/Desktop/ETG/AgentAssistant/knowledge_base/profiles/incidents.json)
   Показывает состав профиля и список файлов.
2. [_CORE_instruction.md](/Users/denis/Desktop/ETG/AgentAssistant/knowledge_base/_CORE_instruction.md)
   Хранит универсальный контракт ответа.
3. [abbr.md](/Users/denis/Desktop/ETG/AgentAssistant/knowledge_base/abbr.md)
   Общие сокращения.
4. [incident_classification.md](/Users/denis/Desktop/ETG/AgentAssistant/knowledge_base/incident_classification.md)
   Специфика классификации для incidents.
5. Нужные indicator files из `soft_skills/` и `hard_skills/`.

## Правила сортировки

- универсальные правила живут в `_CORE_instruction.md`;
- частная логика индикаторов живет только в indicator files;
- profile json определяет состав набора, а код — канонический порядок сборки;
- один индикатор = один файл;
- если правило относится только к одному индикатору, оно не должно дублироваться в core.

## Канонический порядок сборки

Фактический порядок секций задается runtime-кодом, а не только списком в profile:

1. `_CORE_instruction.md`
2. `abbr.md`
3. `extra_files`, например `incident_classification.md`
4. `soft_skills`
5. `hard_skills`

Если порядок в profile и итоговый assembled prompt кажутся конкурирующими, доверяй коду из `src/lib/kb_contract.js`.

## Где смотреть связанный runtime

- KB assembly reference: [docs/details/09_knowledge_base.md](/Users/denis/Desktop/ETG/AgentAssistant/docs/details/09_knowledge_base.md)
- loader/runtime contract: [src/lib/kb_contract.js](/Users/denis/Desktop/ETG/AgentAssistant/src/lib/kb_contract.js)
- release loader: [src/lib/kb_loader.js](/Users/denis/Desktop/ETG/AgentAssistant/src/lib/kb_loader.js)
